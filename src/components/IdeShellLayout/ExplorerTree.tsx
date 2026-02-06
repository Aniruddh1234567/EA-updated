import {
  ApartmentOutlined,
  AppstoreOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  CheckOutlined,
  CloudOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  FileTextOutlined,
  ForkOutlined,
  FundProjectionScreenOutlined,
  PlusOutlined,
  ProjectOutlined,
  SafetyOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Alert, Button, Checkbox, Descriptions, Dropdown, Form, Input, Modal, Select, Space, Tag, Tree, Typography, message, notification } from 'antd';
import type { MenuProps } from 'antd';
import type { DataNode, TreeProps } from 'antd/es/tree';
import React from 'react';
import { useModel } from '@umijs/max';
import { useIdeShell } from './index';
import styles from './style.module.less';
import { useIdeSelection } from '@/ide/IdeSelectionContext';
import { useEaRepository } from '@/ea/EaRepositoryContext';
import { dispatchIdeCommand } from '@/ide/ideCommands';
import type { ObjectType, RelationshipType } from '@/pages/dependency-view/utils/eaMetaModel';
import {
  OBJECT_TYPE_DEFINITIONS,
  RELATIONSHIP_TYPE_DEFINITIONS,
  isValidRelationshipType,
} from '@/pages/dependency-view/utils/eaMetaModel';
import { isCustomFrameworkModelingEnabled } from '@/repository/customFrameworkConfig';
import { isObjectTypeAllowedForReferenceFramework } from '@/repository/referenceFrameworkPolicy';
import { hasRepositoryPermission, type RepositoryRole } from '@/repository/accessControl';
import { guardInitializationForModeling } from '@/repository/elementCreationPolicy';
import { updateViewRoot } from '../../../backend/views/ViewRepositoryStore';
import { ViewStore } from '@/diagram-studio/view-runtime/ViewStore';
import type { ViewInstance } from '@/diagram-studio/viewpoints/ViewInstance';
import { ViewpointRegistry } from '@/diagram-studio/viewpoints/ViewpointRegistry';
import { isObjectTypeEnabledForFramework } from '@/repository/customFrameworkConfig';
import { useSeedSampleData } from '@/ea/useSeedSampleData';
import type { ModelingState } from '@/ea/DesignWorkspaceStore';
import { listBaselines, getBaselineById } from '../../../backend/baselines/BaselineStore';
import type { Baseline } from '../../../backend/baselines/Baseline';
import { listPlateaus, getPlateauById } from '../../../backend/roadmap/PlateauStore';
import type { Plateau } from '../../../backend/roadmap/Plateau';
import { getRoadmapById, listRoadmaps } from '../../../backend/roadmap/RoadmapStore';
import type { Roadmap } from '../../../backend/roadmap/Roadmap';

const ROOT_KEYS = {
  business: 'explorer:business',
  application: 'explorer:application',
  technology: 'explorer:technology',
  implMig: 'explorer:implementation-migration',
  governance: 'explorer:governance',
  views: 'explorer:views',
  baselines: 'explorer:baselines',
} as const;

const ENTERPRISE_FULLY_EXPANDED_KEYS: readonly string[] = [
  ROOT_KEYS.business,
  ROOT_KEYS.application,
  ROOT_KEYS.technology,
  ROOT_KEYS.implMig,
  ROOT_KEYS.governance,
  ROOT_KEYS.views,
  ROOT_KEYS.baselines,

  'explorer:business:enterprises',
  'explorer:business:capabilities',
  'explorer:business:business-services',
  'explorer:business:processes',
  'explorer:business:departments',

  'explorer:application:applications',
  'explorer:application:application-services',
  'explorer:application:interfaces',
  'explorer:technology:nodes',
  'explorer:technology:compute',
  'explorer:technology:runtime',
  'explorer:technology:database',
  'explorer:technology:infrastructure-services',

  'explorer:implmig:programmes',
  'explorer:implmig:projects',
  'explorer:implmig:plateaus',

  'explorer:governance:principles',
  'explorer:governance:requirements',
  'explorer:governance:standards',

  'explorer:views:business',
  'explorer:views:application',
  'explorer:views:technology',
  'explorer:views:roadmaps',
  'explorer:baselines:list',
];

const KEY = {
  element: (id: string) => `explorer:element:${id}`,
  view: (id: string) => `explorer:view:${id}`,
  baseline: (id: string) => `explorer:baseline:${id}`,
  plateau: (id: string) => `explorer:plateau:${id}`,
  roadmap: (id: string) => `explorer:roadmap:${id}`,
} as const;

/** Get the collection key for a given element type (for auto-expanding after creation) */
const getCollectionKeyForType = (type: ObjectType): string | null => {
  switch (type) {
    case 'Enterprise':
      return 'explorer:business:enterprises';
    case 'Capability':
      return 'explorer:business:capabilities';
    case 'BusinessService':
      return 'explorer:business:business-services';
    case 'BusinessProcess':
      return 'explorer:business:processes';
    case 'Department':
      return 'explorer:business:departments';
    case 'Application':
      return 'explorer:application:applications';
    case 'ApplicationService':
      return 'explorer:application:application-services';
    case 'Interface':
      return 'explorer:application:interfaces';
    case 'Node':
      return 'explorer:technology:nodes';
    case 'Compute':
      return 'explorer:technology:compute';
    case 'Runtime':
      return 'explorer:technology:runtime';
    case 'Database':
      return 'explorer:technology:database';
    case 'Technology':
    case 'Storage':
    case 'API':
    case 'MessageBroker':
    case 'IntegrationPlatform':
    case 'CloudService':
      return 'explorer:technology:infrastructure-services';
    case 'Programme':
      return 'explorer:implmig:programmes';
    case 'Project':
      return 'explorer:implmig:projects';
    case 'Principle':
      return 'explorer:governance:principles';
    case 'Requirement':
      return 'explorer:governance:requirements';
    case 'Standard':
      return 'explorer:governance:standards';
    default:
      return null;
  }
};

/** Get the parent root key for a given element type */
const getRootKeyForType = (type: ObjectType): string | null => {
  switch (type) {
    case 'Enterprise':
    case 'Capability':
    case 'BusinessService':
    case 'BusinessProcess':
    case 'Department':
      return ROOT_KEYS.business;
    case 'Application':
    case 'ApplicationService':
    case 'Interface':
      return ROOT_KEYS.application;
    case 'Node':
    case 'Compute':
    case 'Runtime':
    case 'Database':
    case 'Technology':
    case 'Storage':
    case 'API':
    case 'MessageBroker':
    case 'IntegrationPlatform':
    case 'CloudService':
      return ROOT_KEYS.technology;
    case 'Programme':
    case 'Project':
      return ROOT_KEYS.implMig;
    case 'Principle':
    case 'Requirement':
    case 'Standard':
      return ROOT_KEYS.governance;
    default:
      return null;
  }
};

const BUSINESS_UNIT_ENTERPRISE_PLACEHOLDER_KEY = 'explorer:business:enterprises:root-placeholder';

const normalizeId = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// GLOBAL RULE: Roadmaps describe change over time. Roadmaps never modify architecture truth. Truth is modified only in the active repository workspace.
const PLANNING_READONLY_MESSAGE = '';

const isSoftDeleted = (attributes: Record<string, unknown> | null | undefined) => Boolean((attributes as any)?._deleted === true);

const nameForObject = (obj: { id: string; attributes?: Record<string, unknown> }) => {
  const raw = (obj.attributes as any)?.name;
  const name = typeof raw === 'string' ? raw.trim() : '';
  return name || obj.id;
};

const frameworksForObject = (obj: { attributes?: Record<string, unknown> } | null | undefined): string[] => {
  const attrs = obj?.attributes as any;
  if (!attrs) return [];
  const rawList = Array.isArray(attrs.frameworks) ? attrs.frameworks : [];
  const rawSingle = typeof attrs.framework === 'string' ? [attrs.framework] : [];
  const rawRef = typeof attrs.referenceFramework === 'string' ? [attrs.referenceFramework] : [];
  const combined = [...rawList, ...rawSingle, ...rawRef]
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);
  return Array.from(new Set(combined));
};

const lifecycleOptionsForFramework = (
  referenceFramework: string | null | undefined,
  lifecycleCoverage: string | null | undefined,
): string[] => {
  if (referenceFramework === 'TOGAF') {
    if (lifecycleCoverage === 'To-Be') return ['Target'];
    if (lifecycleCoverage === 'As-Is') return ['Baseline'];
    return ['Baseline', 'Target'];
  }
  if (lifecycleCoverage === 'To-Be') return ['To-Be'];
  if (lifecycleCoverage === 'As-Is') return ['As-Is'];
  return ['As-Is', 'To-Be'];
};

const defaultLifecycleStateForFramework = (
  referenceFramework: string | null | undefined,
  lifecycleCoverage: string | null | undefined,
): string => {
  if (referenceFramework === 'TOGAF') {
    return lifecycleCoverage === 'To-Be' ? 'Target' : 'Baseline';
  }
  return lifecycleCoverage === 'To-Be' ? 'To-Be' : 'As-Is';
};

const MODELING_STATE_TAGS: Record<ModelingState, { label: string; color: string }> = {
  DRAFT: { label: 'Draft', color: 'gold' },
  COMMITTED: { label: 'Committed', color: 'green' },
  REVIEW_READY: { label: 'Review ready', color: 'blue' },
  APPROVED: { label: 'Approved', color: 'geekblue' },
};

const modelingStateForObject = (obj: { attributes?: Record<string, unknown> } | null | undefined): ModelingState | null => {
  const raw = (obj?.attributes as any)?.modelingState;
  return raw && raw in MODELING_STATE_TAGS ? (raw as ModelingState) : null;
};

const titleForObjectType = (type: ObjectType): string => {
  switch (type) {
    case 'Enterprise':
      return 'Enterprise';
    case 'Capability':
      return 'Capability';
    case 'BusinessService':
      return 'Business Service';
    case 'BusinessProcess':
      return 'Business Process';
    case 'Department':
      return 'Department';
    case 'Application':
      return 'Application';
    case 'ApplicationService':
      return 'Application Service';
    case 'Interface':
      return 'Interface';
    case 'Node':
      return 'Node';
    case 'Compute':
      return 'Compute';
    case 'Runtime':
      return 'Runtime';
    case 'Database':
      return 'Database';
    case 'Storage':
      return 'Storage';
    case 'API':
      return 'API';
    case 'MessageBroker':
      return 'Message Broker';
    case 'IntegrationPlatform':
      return 'Integration Platform';
    case 'CloudService':
      return 'Cloud Service';
    case 'Technology':
      return 'Technology';
    case 'Programme':
      return 'Programme';
    case 'Project':
      return 'Project';
    case 'Principle':
      return 'Principle';
    case 'Requirement':
      return 'Requirement';
    case 'Standard':
      return 'Standard';
    default:
      return String(type);
  }
};

const defaultIdPrefixForType = (type: ObjectType) => {
  switch (type) {
    case 'Enterprise':
      return 'ent-';
    case 'Application':
      return 'app-';
    case 'ApplicationService':
      return 'appsvc-';
    case 'Interface':
      return 'iface-';
    case 'Node':
      return 'node-';
    case 'Compute':
      return 'compute-';
    case 'Runtime':
      return 'runtime-';
    case 'Database':
      return 'db-';
    case 'Storage':
      return 'storage-';
    case 'API':
      return 'api-';
    case 'MessageBroker':
      return 'mb-';
    case 'IntegrationPlatform':
      return 'int-';
    case 'CloudService':
      return 'cloud-';
    case 'Technology':
      return 'tech-';
    case 'Programme':
      return 'prog-';
    case 'Project':
      return 'proj-';
    case 'Capability':
      return 'cap-';
    case 'BusinessService':
      return 'bizsvc-';
    case 'BusinessProcess':
      return 'proc-';
    case 'Department':
      return 'dept-';
    case 'Principle':
      return 'principle-';
    case 'Requirement':
      return 'req-';
    case 'Standard':
      return 'std-';
    default:
      return `${String(type).toLowerCase()}-`;
  }
};

/** Generate a UUID using crypto.randomUUID with fallback */
const generateUUID = (): string => {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fallback below
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
};

/** Generate a unique element ID with type prefix and UUID */
const generateElementId = (type: ObjectType): string => {
  const prefix = defaultIdPrefixForType(type);
  const uuid = generateUUID();
  return `${prefix}${uuid}`;
};

const objectLeaves = (args: {
  objectsById: Map<string, { id: string; type: ObjectType; attributes: Record<string, unknown> }>;
  type: ObjectType;
  icon: React.ReactNode;
}): DataNode[] => {
  const { objectsById, type, icon } = args;
  const items = Array.from(objectsById.values()).filter((o) => o.type === type && !isSoftDeleted(o.attributes));
  items.sort((a, b) => nameForObject(a).localeCompare(nameForObject(b)) || a.id.localeCompare(b.id));
  return items.map((o) => ({
    key: KEY.element(o.id),
    title: nameForObject(o),
    icon,
    isLeaf: true,
    data: { elementId: o.id, elementType: o.type },
  }));
};

const objectLeavesForTypes = (args: {
  objectsById: Map<string, { id: string; type: ObjectType; attributes: Record<string, unknown> }>;
  types: readonly ObjectType[];
  iconForType: (type: ObjectType) => React.ReactNode;
}): DataNode[] => {
  const { objectsById, types, iconForType } = args;
  const typeSet = new Set(types);
  const items = Array.from(objectsById.values()).filter((o) => typeSet.has(o.type) && !isSoftDeleted(o.attributes));
  items.sort((a, b) => nameForObject(a).localeCompare(nameForObject(b)) || a.id.localeCompare(b.id));
  return items.map((o) => ({
    key: KEY.element(o.id),
    title: nameForObject(o),
    icon: iconForType(o.type),
    isLeaf: true,
    data: { elementId: o.id, elementType: o.type },
  }));
};

type RelationshipRecord = { fromId: string; toId: string; type: RelationshipType };

const HIERARCHY_RELATIONSHIP_TYPES: readonly RelationshipType[] = ['OWNS', 'HAS', 'DECOMPOSES_TO', 'COMPOSED_OF', 'SUPPORTED_BY'];

const relationshipHierarchy = (args: {
  objectsById: Map<string, { id: string; type: ObjectType; attributes: Record<string, unknown> }>;
  relationships: RelationshipRecord[];
  allowedTypes: readonly ObjectType[];
  allowedRelationshipTypes: readonly RelationshipType[];
  iconForType: (t: ObjectType) => React.ReactNode;
  keySuffix?: string;
}): DataNode[] => {
  const { objectsById, relationships, allowedTypes, allowedRelationshipTypes, iconForType, keySuffix } = args;

  const elementKey = (id: string) => (keySuffix ? `${KEY.element(id)}:${keySuffix}` : KEY.element(id));

  const nodes = Array.from(objectsById.values()).filter(
    (o) => allowedTypes.includes(o.type) && !isSoftDeleted(o.attributes),
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const edges: Array<{ parent: string; child: string }> = [];
  const filteredRels = relationships
    .filter((r) => allowedRelationshipTypes.includes(r.type as RelationshipType) && byId.has(r.fromId) && byId.has(r.toId))
    .sort((a, b) => a.fromId.localeCompare(b.fromId) || a.toId.localeCompare(b.toId));

  filteredRels.forEach((r) => {
    if (r.fromId === r.toId) return;
    edges.push({ parent: r.fromId, child: r.toId });
  });

  const parentFor = new Map<string, string>();
  const childrenFor = new Map<string, string[]>();

  const attach = (parentId: string, childId: string) => {
    if (parentId === childId) return;
    if (parentFor.has(childId)) return;
    parentFor.set(childId, parentId);
    if (!childrenFor.has(parentId)) childrenFor.set(parentId, []);
    childrenFor.get(parentId)!.push(childId);
  };

  edges.forEach((e) => attach(e.parent, e.child));

  const dataNodes = new Map<string, DataNode>();
  nodes.forEach((n) => {
    dataNodes.set(n.id, {
      key: elementKey(n.id),
      title: nameForObject(n),
      icon: iconForType(n.type),
      isLeaf: true,
      data: { elementId: n.id, elementType: n.type },
      children: [],
    });
  });

  childrenFor.forEach((childrenIds, parentId) => {
    const parentNode = dataNodes.get(parentId);
    if (!parentNode) return;
    parentNode.isLeaf = false;
    parentNode.children = childrenIds
      .map((cid) => dataNodes.get(cid))
      .filter((c): c is DataNode => Boolean(c))
      .sort((a, b) => String(a.title).localeCompare(String(b.title)));
  });

  const roots: DataNode[] = [];
  dataNodes.forEach((node, id) => {
    const parentId = parentFor.get(id);
    if (!parentId || !dataNodes.has(parentId)) {
      roots.push(node);
    }
  });

  roots.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  return roots;
};

const capabilityHierarchy = (args: {
  objectsById: Map<string, { id: string; type: ObjectType; attributes: Record<string, unknown> }>;
  relationships: RelationshipRecord[];
  icon: React.ReactNode;
}): DataNode[] => {
  const { objectsById, relationships, icon } = args;
  return relationshipHierarchy({
    objectsById,
    relationships,
    allowedTypes: ['Capability', 'CapabilityCategory', 'SubCapability'],
    allowedRelationshipTypes: ['DECOMPOSES_TO', 'COMPOSED_OF'],
    iconForType: () => icon,
    keySuffix: 'capability-hierarchy',
  });
};

const enterpriseHierarchy = (args: {
  objectsById: Map<string, { id: string; type: ObjectType; attributes: Record<string, unknown> }>;
  relationships: RelationshipRecord[];
  enterpriseIcon: React.ReactNode;
  departmentIcon: React.ReactNode;
}): DataNode[] => {
  const { objectsById, relationships, enterpriseIcon, departmentIcon } = args;
  return relationshipHierarchy({
    objectsById,
    relationships,
    allowedTypes: ['Enterprise', 'Department'],
    allowedRelationshipTypes: ['OWNS', 'HAS'],
    iconForType: (t) => (t === 'Department' ? departmentIcon : enterpriseIcon),
    keySuffix: 'enterprise-departments',
  });
};

const enterpriseCapabilityHierarchy = (args: {
  objectsById: Map<string, { id: string; type: ObjectType; attributes: Record<string, unknown> }>;
  relationships: RelationshipRecord[];
  enterpriseIcon: React.ReactNode;
  capabilityIcon: React.ReactNode;
}): DataNode[] => {
  const { objectsById, relationships, enterpriseIcon, capabilityIcon } = args;
  return relationshipHierarchy({
    objectsById,
    relationships,
    allowedTypes: ['Enterprise', 'Capability', 'CapabilityCategory', 'SubCapability'],
    allowedRelationshipTypes: ['OWNS', 'DECOMPOSES_TO', 'COMPOSED_OF'],
    iconForType: (t) => (t === 'Enterprise' ? enterpriseIcon : capabilityIcon),
    keySuffix: 'enterprise-capabilities',
  });
};

const programmeHierarchy = (args: {
  objectsById: Map<string, { id: string; type: ObjectType; attributes: Record<string, unknown> }>;
  relationships: RelationshipRecord[];
  programmeIcon: React.ReactNode;
  projectIcon: React.ReactNode;
}): DataNode[] => {
  const { objectsById, relationships, programmeIcon, projectIcon } = args;
  return relationshipHierarchy({
    objectsById,
    relationships,
    allowedTypes: ['Programme', 'Project'],
    allowedRelationshipTypes: ['DELIVERS', 'IMPLEMENTS', 'OWNS'],
    iconForType: (t) => (t === 'Project' ? projectIcon : programmeIcon),
    keySuffix: 'programme-hierarchy',
  });
};


const applicationsByLifecycleGrouping = (args: {
  objectsById: Map<string, { id: string; type: ObjectType; attributes: Record<string, unknown> }>;
  applicationIcon: React.ReactNode;
}): DataNode[] => {
  const { objectsById, applicationIcon } = args;
  const apps = Array.from(objectsById.values()).filter((o) => o.type === 'Application' && !isSoftDeleted(o.attributes));

  const groups = new Map<string, DataNode[]>();
  const normalize = (v: unknown) => {
    const t = typeof v === 'string' ? v.trim() : '';
    return t || 'Unspecified';
  };

  const makeAppNode = (app: typeof apps[number]): DataNode => ({
    key: KEY.element(app.id),
    title: nameForObject(app),
    icon: applicationIcon,
    isLeaf: true,
    data: { elementId: app.id, elementType: app.type },
  });

  apps.forEach((app) => {
    const lifecycle = normalize((app.attributes as any)?.lifecycleState);
    if (!groups.has(lifecycle)) groups.set(lifecycle, []);
    groups.get(lifecycle)!.push(makeAppNode(app));
  });

  const nodes: DataNode[] = [];
  groups.forEach((children, lifecycle) => {
    children.sort((a, b) => String(a.title).localeCompare(String(b.title)) || String(a.key).localeCompare(String(b.key)));
    nodes.push({
      key: `explorer:application:lifecycle:${lifecycle}`,
      title: `Lifecycle: ${lifecycle}`,
      icon: applicationIcon,
      isLeaf: false,
      selectable: false,
      children,
    });
  });

  nodes.sort((a, b) => String(a.title).localeCompare(String(b.title)) || String(a.key).localeCompare(String(b.key)));
  return nodes;
};

const technologiesByLayerGrouping = (args: {
  objectsById: Map<string, { id: string; type: ObjectType; attributes: Record<string, unknown> }>;
  technologyIcon: React.ReactNode;
}): DataNode[] => {
  const { objectsById, technologyIcon } = args;
  const techs = Array.from(objectsById.values()).filter((o) => o.type === 'Technology' && !isSoftDeleted(o.attributes));

  const normalizeLayer = (attrs: Record<string, unknown> | undefined | null): string => {
    const raw =
      (attrs as any)?.technologyType ||
      (attrs as any)?.technologyCategory ||
      (attrs as any)?.category ||
      (attrs as any)?.layer;
    const val = typeof raw === 'string' ? raw.trim() : '';
    if (!val) return 'Unspecified';
    const upper = val.toLowerCase();
    if (upper.includes('infra')) return 'Infrastructure';
    if (upper.includes('platform')) return 'Platform';
    if (upper.includes('runtime')) return 'Runtime';
    return val;
  };

  const byLayer = new Map<string, DataNode[]>();

  const makeTechNode = (t: typeof techs[number]): DataNode => ({
    key: KEY.element(t.id),
    title: nameForObject(t),
    icon: technologyIcon,
    isLeaf: true,
    data: { elementId: t.id, elementType: t.type },
  });

  techs.forEach((t) => {
    const layer = normalizeLayer(t.attributes);
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(makeTechNode(t));
  });

  const nodes: DataNode[] = [];
  byLayer.forEach((children, layer) => {
    children.sort((a, b) => String(a.title).localeCompare(String(b.title)) || String(a.key).localeCompare(String(b.key)));
    nodes.push({
      key: `explorer:technology:layer:${layer}`,
      title: `Layer: ${layer}`,
      icon: technologyIcon,
      isLeaf: false,
      selectable: false,
      children,
    });
  });

  nodes.sort((a, b) => String(a.title).localeCompare(String(b.title)) || String(a.key).localeCompare(String(b.key)));
  return nodes;
};

const countLiveObjectsByType = (
  objectsById: Map<string, { id: string; type: ObjectType; attributes: Record<string, unknown> }>,
  type: ObjectType,
): number => {
  let count = 0;
  for (const o of objectsById.values()) {
    if (o.type !== type) continue;
    if (isSoftDeleted(o.attributes)) continue;
    count += 1;
  }
  return count;
};

const categorizeViewByViewpoint = (view: ViewInstance): 'business' | 'application' | 'technology' => {
  const viewpoint = ViewpointRegistry.get(view.viewpointId);
  if (!viewpoint) return 'business';

  const businessTypes = new Set<ObjectType>([
    'Enterprise',
    'Department',
    'CapabilityCategory',
    'Capability',
    'SubCapability',
    'BusinessService',
    'BusinessProcess',
    'Programme',
    'Project',
  ]);
  const applicationTypes = new Set<ObjectType>([
    'Application',
    'ApplicationService',
    'Interface',
  ]);
  const technologyTypes = new Set<ObjectType>([
    'Technology',
    'Node',
    'Compute',
    'Runtime',
    'Database',
    'Storage',
    'API',
    'MessageBroker',
    'IntegrationPlatform',
    'CloudService',
  ]);

  let businessScore = 0;
  let applicationScore = 0;
  let technologyScore = 0;
  viewpoint.allowedElementTypes.forEach((t) => {
    if (businessTypes.has(t)) businessScore += 1;
    if (applicationTypes.has(t)) applicationScore += 1;
    if (technologyTypes.has(t)) technologyScore += 1;
  });

  if (applicationScore >= businessScore && applicationScore >= technologyScore) return 'application';
  if (technologyScore >= businessScore && technologyScore >= applicationScore) return 'technology';
  return 'business';
};

const groupSavedViews = (views: ViewInstance[]) => {
  const business: ViewInstance[] = [];
  const application: ViewInstance[] = [];
  const technology: ViewInstance[] = [];

  views.forEach((view) => {
    const bucket = categorizeViewByViewpoint(view);
    if (bucket === 'application') application.push(view);
    else if (bucket === 'technology') technology.push(view);
    else business.push(view);
  });

  const sorter = (a: ViewInstance, b: ViewInstance) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  business.sort(sorter);
  application.sort(sorter);
  technology.sort(sorter);

  return { business, application, technology };
};

const inferHierarchyRelationshipType = (parentType: ObjectType | undefined, childType: ObjectType | undefined): RelationshipType | null => {
  if (!parentType || !childType) return null;
  for (const relType of HIERARCHY_RELATIONSHIP_TYPES) {
    const def = RELATIONSHIP_TYPE_DEFINITIONS[relType];
    if (!def) continue;
    const pairs = def.allowedEndpointPairs;
    if (pairs && pairs.length > 0) {
      if (pairs.some((p) => p.from === parentType && p.to === childType)) return relType;
      continue;
    }
    if (def.fromTypes.includes(parentType) && def.toTypes.includes(childType)) return relType;
  }
  return null;
};

const ExplorerTree: React.FC = () => {
  const { initialState } = useModel('@@initialState');
  const { selection, setSelection, setSelectedElement, setActiveElement } = useIdeSelection();
  const { openRouteTab, openWorkspaceTab, openPropertiesPanel, hierarchyEditingEnabled, studioMode, requestStudioViewSwitch } = useIdeShell();
  const { eaRepository, setEaRepository, trySetEaRepository, metadata, initializationState } = useEaRepository();
  // Force full platform access in local mode.
  const userRole: RepositoryRole = 'Owner';

  const [relationshipModalOpen, setRelationshipModalOpen] = React.useState(false);
  const [relationshipSource, setRelationshipSource] = React.useState<{ id: string; type: ObjectType; name: string } | null>(null);
  const [selectedRelationshipType, setSelectedRelationshipType] = React.useState<RelationshipType | ''>('');
  const [selectedTargetId, setSelectedTargetId] = React.useState<string>('');
  const createModalOpenRef = React.useRef(false);
  const [baselinePreview, setBaselinePreview] = React.useState<Baseline | null>(null);
  const [baselinePreviewOpen, setBaselinePreviewOpen] = React.useState(false);
  const [addToViewModalOpen, setAddToViewModalOpen] = React.useState(false);
  const [addToViewTarget, setAddToViewTarget] = React.useState<{ id: string; name: string; type: ObjectType } | null>(null);
  const [addToViewViewId, setAddToViewViewId] = React.useState<string>('');
  const [viewsRefreshToken, setViewsRefreshToken] = React.useState(0);
  const [applicationGrouping, setApplicationGrouping] = React.useState<'flat' | 'lifecycle'>(() => {
    try {
      const stored = localStorage.getItem('ea.applicationGrouping');
      if (stored === 'lifecycle') return stored;
    } catch {
      // ignore storage failures
    }
    return 'flat';
  });

  const actor = initialState?.currentUser?.name || initialState?.currentUser?.userid || 'ui';

  const savedViews = React.useMemo(() => ViewStore.list().filter((v) => v.status === 'SAVED'), [viewsRefreshToken]);

  const customFrameworkActive =
    (metadata?.enabledFrameworks?.includes('Custom') ?? false) || metadata?.referenceFramework === 'Custom';
  const customModelingEnabled = customFrameworkActive
    ? isCustomFrameworkModelingEnabled('Custom', metadata?.frameworkConfig ?? undefined)
    : true;

  const enabledFrameworks = React.useMemo(
    () =>
      (metadata?.enabledFrameworks && metadata.enabledFrameworks.length > 0)
        ? metadata.enabledFrameworks
        : (metadata?.referenceFramework ? [metadata.referenceFramework] : []),
    [metadata?.enabledFrameworks, metadata?.referenceFramework],
  );

  const isTypeEnabledByFramework = React.useCallback(
    (type: ObjectType): boolean => {
      if (enabledFrameworks.length === 0) return true;
      return enabledFrameworks.some((framework) => {
        if (framework === 'Custom') {
          if (!customModelingEnabled) return false;
          return isObjectTypeEnabledForFramework('Custom', metadata?.frameworkConfig ?? undefined, type);
        }
        return isObjectTypeAllowedForReferenceFramework(framework, type);
      });
    },
    [customModelingEnabled, enabledFrameworks, metadata?.frameworkConfig],
  );

  const isTypeAllowedByScope = React.useCallback(
    (type: ObjectType): boolean => {
      const scope = metadata?.architectureScope ?? null;
      if (scope === 'Programme') {
        return new Set<ObjectType>(['Programme', 'Project', 'Capability', 'Application']).has(type);
      }
      if (scope === 'Domain') {
        return new Set<ObjectType>(['Capability', 'BusinessService', 'Application', 'ApplicationService', 'Interface']).has(type);
      }
      return true;
    },
    [metadata?.architectureScope],
  );

  const creatableTypeOptions = React.useMemo(() => {
    const types = Object.keys(OBJECT_TYPE_DEFINITIONS) as ObjectType[];
    const filtered = types.filter((t) => isTypeEnabledByFramework(t) && isTypeAllowedByScope(t));
    filtered.sort((a, b) => titleForObjectType(a).localeCompare(titleForObjectType(b)));
    return filtered.map((t) => ({ value: t, label: titleForObjectType(t) }));
  }, [isTypeAllowedByScope, isTypeEnabledByFramework]);

  const openCreateTypePicker = React.useCallback((allowedTypes?: readonly ObjectType[]) => {
    message.info('Create new elements from the EA Toolbox. Explorer is for browsing and reuse.');
    return;
    if (isReadOnlyMode) {
      message.warning('Read-only mode: creation is disabled.');
      return;
    }
    if (!eaRepository) {
      message.warning('No repository loaded. Create a repository first.');
      return;
    }
    const allowedSet = allowedTypes && allowedTypes.length > 0 ? new Set(allowedTypes) : null;
    const options = allowedSet
      ? creatableTypeOptions.filter((opt) => allowedSet.has(opt.value as ObjectType))
      : creatableTypeOptions;
    if (options.length === 0) {
      message.warning('No element types are enabled for creation in the current framework/scope.');
      return;
    }
    let selectedType: ObjectType | '' = '';
    Modal.confirm({
      title: 'Create element',
      okText: 'Next',
      cancelText: 'Cancel',
      content: (
        <Form layout="vertical">
          <Form.Item label="Element Type" required>
            <Select
              placeholder="Select element type"
              options={options}
              onChange={(v) => {
                selectedType = v as ObjectType;
              }}
            />
          </Form.Item>
        </Form>
      ),
      onOk: () => {
        if (!selectedType) {
          message.error('Select an element type.');
          return Promise.reject();
        }
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            createObject(selectedType);
            resolve();
          }, 0);
        });
      },
    });
  }, [createObject, creatableTypeOptions, eaRepository, isReadOnlyMode, permissionGuard]);

  const [refreshToken, setRefreshToken] = React.useState(0);
  const { openSeedSampleDataModal, isRepoEmpty, hasRepository } = useSeedSampleData();
  const [seedBannerDismissed, setSeedBannerDismissed] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem('ea.seed.banner.dismissed') === 'true';
    } catch {
      return false;
    }
  });

  const dismissSeedBanner = React.useCallback(() => {
    setSeedBannerDismissed(true);
    try {
      localStorage.setItem('ea.seed.banner.dismissed', 'true');
    } catch {
      // ignore storage failures
    }
  }, []);

  React.useEffect(() => {
    const handler = () => setViewsRefreshToken((v) => v + 1);
    window.addEventListener('ea:viewsChanged', handler);
    return () => window.removeEventListener('ea:viewsChanged', handler);
  }, []);

  React.useEffect(() => {
    if (!addToViewModalOpen) return;
    if (savedViews.length === 0) {
      setAddToViewViewId('');
      return;
    }
    if (!savedViews.some((v) => v.id === addToViewViewId)) {
      setAddToViewViewId(savedViews[0].id);
    }
  }, [addToViewModalOpen, addToViewViewId, savedViews]);

  React.useEffect(() => {
    try {
      localStorage.setItem('ea.applicationGrouping', applicationGrouping);
    } catch {
      // ignore storage failures
    }
  }, [applicationGrouping]);

  const [showTechnologyInProgrammeScope, setShowTechnologyInProgrammeScope] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem('ea.programmeScope.showTechnology') === 'true';
    } catch {
      return false;
    }
  });

  const setShowTechnologyFlag = React.useCallback((next: boolean) => {
    setShowTechnologyInProgrammeScope(next);
    try {
      localStorage.setItem('ea.programmeScope.showTechnology', next ? 'true' : 'false');
    } catch {
      // Best-effort.
    }
  }, []);

  const handleConfirmAddToView = React.useCallback(() => {
    if (!addToViewTarget) {
      setAddToViewModalOpen(false);
      return;
    }
    const view = addToViewViewId ? ViewStore.get(addToViewViewId) : null;
    if (!view) {
      message.error('Select a view to add to.');
      return;
    }

    const viewpoint = ViewpointRegistry.get(view.viewpointId);
    if (viewpoint) {
      const allowed = new Set(viewpoint.allowedElementTypes.map((t) => t.toLowerCase()));
      if (!allowed.has(addToViewTarget.type.toLowerCase())) {
        message.warning('Element type is not allowed by the view viewpoint.');
        return;
      }
    }

    const existingIds = view.scope.kind === 'ManualSelection' ? [...view.scope.elementIds] : [];
    const nextIds = Array.from(new Set([...existingIds, addToViewTarget.id]));
    const nextView: ViewInstance = {
      ...view,
      scope: {
        kind: 'ManualSelection',
        elementIds: nextIds,
      },
    };

    ViewStore.save(nextView);
    message.success(`Added ${addToViewTarget.name} to ${view.name}.`);
    setAddToViewModalOpen(false);
    setAddToViewTarget(null);
  }, [addToViewTarget, addToViewViewId]);

  const permissionGuard = React.useCallback((_: any) => false, []);

  const isReadOnlyMode = (metadata?.governanceMode ?? 'Advisory') === 'Advisory';
  const readOnlyLabel = React.useCallback(
    (label: string) => (isReadOnlyMode ? `${label} (read-only)` : label),
    [isReadOnlyMode],
  );

  const initializationGuard = React.useCallback((_: any) => false, []);

  const initializeEnterprise = React.useCallback(() => {
    if (permissionGuard('initializeEnterprise')) return;
    if (initializationState?.status === 'initialized') {
      message.info('Enterprise already initialized.');
      return;
    }
    if (!eaRepository) {
      message.warning('No repository loaded. Create a repository first.');
      return;
    }

    const liveEnterprises = countLiveObjectsByType(eaRepository.objects, 'Enterprise');
    if (liveEnterprises > 0) {
      message.info('Enterprise already initialized.');
      return;
    }

    const elementId = generateElementId('Enterprise');
    const createdAt = new Date().toISOString();
    const suggestedName = (metadata?.organizationName ?? '').trim();
    let name = '';
    let description = '';
    let ownerId = '';
    let lifecycleState = '';
    let admPhase = '';
    const isStrictGovernance = metadata?.governanceMode === 'Strict';
    const lifecycleOptions = lifecycleOptionsForFramework(metadata?.referenceFramework, metadata?.lifecycleCoverage);
    const lifecyclePlaceholder = defaultLifecycleStateForFramework(metadata?.referenceFramework, metadata?.lifecycleCoverage);

    Modal.confirm({
      title: 'Initialize Enterprise Architecture',
      okText: 'Initialize',
      cancelText: 'Cancel',
      content: (
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>
              Enterprise Name <span style={{ color: '#ff4d4f' }}>*</span>
            </div>
            <input
              defaultValue={name}
              placeholder={suggestedName ? `e.g., ${suggestedName}` : 'Enter enterprise name'}
              onChange={(e) => {
                name = e.target.value;
              }}
              style={{ width: '100%', padding: 8, border: '1px solid #d9d9d9', borderRadius: 6 }}
            />
            <Typography.Text type="secondary">
              Enterprise nodes represent legal/organizational entities. The name is user-defined and will not sync from other elements.
            </Typography.Text>
          </div>
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>Description</div>
            <textarea
              defaultValue={description}
              placeholder="Enter description (optional)"
              onChange={(e) => {
                description = e.target.value;
              }}
              style={{ width: '100%', padding: 8, border: '1px solid #d9d9d9', borderRadius: 6, minHeight: 100, resize: 'vertical' }}
            />
          </div>
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>
              Lifecycle State <span style={{ color: '#ff4d4f' }}>*</span>
            </div>
            <Select
              placeholder={`Select lifecycle state (suggested: ${lifecyclePlaceholder})`}
              options={lifecycleOptions.map((v) => ({ value: v, label: v }))}
              onChange={(v) => {
                lifecycleState = String(v);
              }}
            />
          </div>
          {metadata?.referenceFramework === 'TOGAF' ? (
            <div>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>
                ADM Phase <span style={{ color: '#ff4d4f' }}>*</span>
              </div>
              <Input
                placeholder="Enter ADM phase (e.g., A)"
                onChange={(e) => {
                  admPhase = e.target.value;
                }}
              />
            </div>
          ) : null}
          {isStrictGovernance ? (
            <div>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>
                Owner <span style={{ color: '#ff4d4f' }}>*</span>
              </div>
              <Select
                placeholder="Select owner"
                options={[{ value: elementId, label: `Self (${elementId})` }]}
                value={ownerId || undefined}
                onChange={(v) => {
                  ownerId = String(v);
                }}
              />
              <Typography.Text type="secondary">
                Strict mode requires an explicit owner. Enterprise roots may only own themselves.
              </Typography.Text>
            </div>
          ) : null}
        </div>
      ),
      onOk: () => {
        const finalName = (name ?? '').trim();
        if (!finalName) {
          message.error('Enterprise name is required.');
          return Promise.reject();
        }

        const finalOwnerId = (ownerId ?? '').trim();
        if (isStrictGovernance && !finalOwnerId) {
          message.error('Owner is required in Strict mode.');
          return Promise.reject();
        }
        const finalLifecycle = (lifecycleState ?? '').trim();
        if (!finalLifecycle) {
          message.error('Lifecycle state is required.');
          return Promise.reject();
        }
        if (metadata?.referenceFramework === 'TOGAF') {
          const finalPhase = (admPhase ?? '').trim();
          if (!finalPhase) {
            message.error('ADM phase is required for TOGAF.');
            return Promise.reject();
          }
        }

        const next = eaRepository.clone();
        const existingEnterpriseCount = countLiveObjectsByType(next.objects, 'Enterprise');
        if (existingEnterpriseCount > 0) {
          message.info('Enterprise already initialized.');
          return Promise.reject();
        }

        const res = next.addObject({
          id: elementId,
          type: 'Enterprise',
          attributes: {
            name: finalName,
            description: (description ?? '').trim(),
            elementType: 'Enterprise',
            createdBy: actor,
            createdAt,
            lastModifiedAt: createdAt,
            lastModifiedBy: actor,
            lifecycleState: finalLifecycle,
            ...(metadata?.referenceFramework === 'TOGAF' ? { admPhase: admPhase.trim() } : {}),
            ...(isStrictGovernance
              ? {
                  ownerId: finalOwnerId,
                  ownerType: 'Enterprise',
                }
              : {}),
          },
        });
        if (!res.ok) {
          message.error(res.error);
          return Promise.reject();
        }

        const applied = trySetEaRepository(next);
        if (!applied.ok) return Promise.reject();

        setExpandedKeys((prev) => {
          const nextKeys = new Set(prev);
          nextKeys.add(ROOT_KEYS.business);
          nextKeys.add('explorer:business:enterprises');
          return Array.from(nextKeys);
        });

        message.success('Enterprise initialized. Modeling unlocked.');
        return Promise.resolve();
      },
    });
  }, [actor, eaRepository, initializationState?.status, metadata?.organizationName, permissionGuard, setExpandedKeys, trySetEaRepository]);

  const normalizeDomainId = React.useCallback((value: unknown): string | null => {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return null;
    return raw.toLowerCase();
  }, []);

  const computeTargetOptions = React.useCallback(
    (relationshipType: RelationshipType, source: { id: string; type: ObjectType }) => {
      if (!eaRepository) return [] as Array<{ value: string; label: string; type: string }>;
      const relDef = RELATIONSHIP_TYPE_DEFINITIONS[relationshipType];
      if (!relDef) return [] as Array<{ value: string; label: string; type: string }>;

      const currentDomainId = normalizeDomainId(metadata?.repositoryName);
      const sourceDomain = normalizeDomainId((eaRepository.objects.get(source.id)?.attributes as any)?.domainId) ?? currentDomainId;

      const pairs = relDef.allowedEndpointPairs;

      return Array.from(eaRepository.objects.values())
        .filter((o) => o.id !== source.id)
        .filter((o) => (o.attributes as any)?._deleted !== true)
        .filter((o) => {
          const toType = o.type as ObjectType;
          if (pairs && pairs.length > 0) return pairs.some((p) => p.from === (source.type as ObjectType) && p.to === toType);
          return relDef.toTypes.includes(toType);
        })
        .filter((o) => {
          const scope = metadata?.architectureScope ?? null;
          if (scope === 'Domain') {
            const targetDomain = normalizeDomainId((o.attributes as any)?.domainId) ?? currentDomainId;
            if (sourceDomain && targetDomain && sourceDomain !== targetDomain) return false;
          }
          if (scope === 'Business Unit' && relationshipType === 'OWNS') {
            if (source.type === 'Enterprise' && o.type === 'Enterprise') return false;
          }
          return true;
        })
        .map((o) => {
          const displayName =
            typeof o.attributes?.name === 'string' && o.attributes.name.trim() ? String(o.attributes.name) : o.id;
          return { value: o.id, label: `${displayName} · ${o.type} · ${o.id}`, type: o.type };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
    },
    [eaRepository, metadata?.architectureScope, metadata?.repositoryName, normalizeDomainId],
  );

  const [expandedKeys, setExpandedKeys] = React.useState<React.Key[]>(() => {
    const enabledFrameworks = (metadata?.enabledFrameworks && metadata.enabledFrameworks.length > 0)
      ? metadata.enabledFrameworks
      : (metadata?.referenceFramework ? [metadata.referenceFramework] : []);
    if (enabledFrameworks.length === 1 && enabledFrameworks[0] === 'Custom' && !customModelingEnabled) {
      return [ROOT_KEYS.views];
    }
    const scope = metadata?.architectureScope ?? null;
    if (scope === 'Enterprise') return [...ENTERPRISE_FULLY_EXPANDED_KEYS];
    if (scope === 'Business Unit') return [ROOT_KEYS.business, ROOT_KEYS.application, ROOT_KEYS.technology];
    if (scope === 'Domain') return [ROOT_KEYS.business, ROOT_KEYS.application];
    if (scope === 'Programme') return [ROOT_KEYS.implMig, 'explorer:implmig:programmes', 'explorer:implmig:plateaus', ROOT_KEYS.views, 'explorer:views:roadmaps'];
    return [ROOT_KEYS.business, ROOT_KEYS.application, ROOT_KEYS.technology, ROOT_KEYS.implMig, 'explorer:implmig:plateaus', ROOT_KEYS.governance, ROOT_KEYS.views];
  });

  React.useEffect(() => {
    // Recompute default expansion when creating/loading a repository.
    const enabledFrameworks = (metadata?.enabledFrameworks && metadata.enabledFrameworks.length > 0)
      ? metadata.enabledFrameworks
      : (metadata?.referenceFramework ? [metadata.referenceFramework] : []);
    if (enabledFrameworks.length === 1 && enabledFrameworks[0] === 'Custom' && !customModelingEnabled) {
      setExpandedKeys([ROOT_KEYS.views]);
      return;
    }
    const scope = metadata?.architectureScope ?? null;
    if (scope === 'Enterprise') {
      setExpandedKeys([...ENTERPRISE_FULLY_EXPANDED_KEYS]);
    } else if (scope === 'Business Unit') {
      setExpandedKeys([ROOT_KEYS.business, ROOT_KEYS.application, ROOT_KEYS.technology]);
    } else if (scope === 'Domain') {
      setExpandedKeys([ROOT_KEYS.business, ROOT_KEYS.application]);
    } else if (scope === 'Programme') {
      setExpandedKeys([ROOT_KEYS.implMig, 'explorer:implmig:programmes', 'explorer:implmig:plateaus', ROOT_KEYS.views, 'explorer:views:roadmaps']);
    } else {
      setExpandedKeys([ROOT_KEYS.business, ROOT_KEYS.application, ROOT_KEYS.technology, ROOT_KEYS.implMig, 'explorer:implmig:plateaus', ROOT_KEYS.governance, ROOT_KEYS.views]);
    }
  }, [customModelingEnabled, metadata?.architectureScope, metadata?.enabledFrameworks, metadata?.referenceFramework]);

  // Listen for repository/views changes to refresh the explorer tree
  React.useEffect(() => {
    const handler = () => setRefreshToken((x) => x + 1);
    try {
      window.addEventListener('ea:repositoryChanged', handler);
      window.addEventListener('ea:viewsChanged', handler);
      return () => {
        window.removeEventListener('ea:repositoryChanged', handler);
        window.removeEventListener('ea:viewsChanged', handler);
      };
    } catch {
      return;
    }
  }, []);

  const views = React.useMemo<ViewInstance[]>(() => {
    try {
      return ViewStore.list();
    } catch {
      return [];
    }
  }, [refreshToken]);

  const [treeHeight, setTreeHeight] = React.useState<number>(520);

  React.useEffect(() => {
    const recomputeHeight = () => {
      if (typeof window === 'undefined') return;
      const proposed = window.innerHeight - 220;
      const bounded = Math.max(360, Math.min(960, proposed));
      setTreeHeight(bounded);
    };

    recomputeHeight();
    window.addEventListener('resize', recomputeHeight);
    return () => window.removeEventListener('resize', recomputeHeight);
  }, []);

  const saveRelationshipFromModal = React.useCallback(() => {
    setRelationshipModalOpen(false);
  }, []);

  const normalizeElementKey = React.useCallback((rawKey: string) => {
    const trimmed = rawKey.replace('explorer:element:', '').trim();
    const suffixIndex = trimmed.indexOf(':');
    return suffixIndex === -1 ? trimmed : trimmed.slice(0, suffixIndex);
  }, []);

  const { treeData, elementKeyIndex } = React.useMemo(() => {
    const objectsById = eaRepository?.objects ?? new Map();
    const viewCats = groupSavedViews(views.filter((v) => v.status === 'SAVED'));
    const scope = metadata?.architectureScope ?? null;
    const enabledFrameworks = (metadata?.enabledFrameworks && metadata.enabledFrameworks.length > 0)
      ? metadata.enabledFrameworks
      : (metadata?.referenceFramework ? [metadata.referenceFramework] : []);
    const isCustomBlankCanvas =
      enabledFrameworks.length === 1 && enabledFrameworks[0] === 'Custom' && !customModelingEnabled;
    const baselines = listBaselines();
    const plateaus = listPlateaus();
    const roadmaps = listRoadmaps();
    const isObjectTypeVisible = (type: ObjectType): boolean => {
      const frameworks = (metadata?.enabledFrameworks && metadata.enabledFrameworks.length > 0)
        ? metadata.enabledFrameworks
        : (metadata?.referenceFramework ? [metadata.referenceFramework] : []);
      if (frameworks.length === 0) return true;
      return frameworks.some((framework) => {
        if (framework === 'Custom') {
          return isObjectTypeEnabledForFramework('Custom', metadata?.frameworkConfig ?? undefined, type);
        }
        return isObjectTypeAllowedForReferenceFramework(framework, type);
      });
    };
    const collectionNode = (args: {
      key: string;
      title: string;
      icon: React.ReactNode;
      children: DataNode[];
    }): DataNode => ({
      key: args.key,
      title: args.title,
      icon: args.icon,
      selectable: true,
      children: args.children,
    });

    const viewLeaf = (v: ViewInstance): DataNode => {
      const viewpoint = ViewpointRegistry.get(v.viewpointId);
      const label = viewpoint?.name ?? v.viewpointId;
      return {
        key: KEY.view(v.id),
        title: (
          <span>
            {v.name} <span style={{ color: '#8c8c8c' }}>({label})</span>
          </span>
        ),
        icon: <FileTextOutlined />,
        isLeaf: true,
      };
    };

    const baselineLeaf = (b: Baseline): DataNode => ({
      key: KEY.baseline(b.id),
      title: b.name || b.id,
      icon: <FileTextOutlined />,
      isLeaf: true,
      data: { baselineId: b.id },
    });

    const plateauLeaf = (p: Plateau): DataNode => ({
      key: KEY.plateau(p.id),
      title: p.name,
      icon: <FundProjectionScreenOutlined />,
      isLeaf: true,
      data: { plateauId: p.id },
    });

    const roadmapLeaf = (r: Roadmap): DataNode => ({
      key: KEY.roadmap(r.id),
      title: r.name,
      icon: <FundProjectionScreenOutlined />,
      isLeaf: true,
      data: { roadmapId: r.id },
    });

    const enterpriseLeaves = objectLeaves({ objectsById, type: 'Enterprise', icon: <ApartmentOutlined /> });

    const initializeDisabled = !hasRepositoryPermission(userRole, 'initializeEnterprise');

    const enterpriseInitializationCta: DataNode = {
      key: 'explorer:business:enterprises:init-cta',
      title: (
        <div style={{ display: 'grid', gap: 8 }}>
          <Typography.Text strong style={{ margin: 0 }}>No Enterprise defined.</Typography.Text>
          <Typography.Text type="secondary" style={{ margin: 0 }}>
            Initialize the Enterprise Architecture to begin modeling.
          </Typography.Text>
          <Button
            type="primary"
            size="small"
            onClick={initializeEnterprise}
            disabled={initializeDisabled}
            title={initializeDisabled ? 'You have read-only access.' : undefined}
          >
            Initialize Enterprise
          </Button>
        </div>
      ),
      icon: <ApartmentOutlined />,
      isLeaf: true,
      selectable: false,
    };

    const enterpriseChildren: DataNode[] =
      enterpriseLeaves.length > 0
        ? enterpriseLeaves
        : initializationState?.status === 'uninitialized'
          ? [enterpriseInitializationCta]
          : [
              {
                key: 'explorer:business:enterprises:empty',
                title: 'No enterprises yet',
                icon: <FileTextOutlined />,
                isLeaf: true,
                selectable: false,
              },
            ];

    const businessUnitEnterpriseChildren: DataNode[] =
      enterpriseLeaves.length > 0
        ? enterpriseLeaves
        : initializationState?.status === 'uninitialized'
          ? [enterpriseInitializationCta]
          : [
              {
                key: BUSINESS_UNIT_ENTERPRISE_PLACEHOLDER_KEY,
                title: 'Business Unit (root)',
                icon: <ApartmentOutlined />,
                isLeaf: true,
              },
            ];

    // Business layer sections are peers; ordering implies layer grouping only (no ownership).
    const businessChildren: DataNode[] = (() => {
      if (scope === 'Domain') {
        return [
          ...(isObjectTypeVisible('Capability')
            ? [
                collectionNode({
                  key: 'explorer:business:capabilities',
                  title: 'Capabilities',
                  icon: <ApartmentOutlined />,
                  children: objectLeavesForTypes({
                    objectsById,
                    types: ['Capability', 'CapabilityCategory', 'SubCapability'],
                    iconForType: () => <ApartmentOutlined />,
                  }),
                }),
              ]
            : []),
          ...(isObjectTypeVisible('BusinessService')
            ? [
                collectionNode({
                  key: 'explorer:business:business-services',
                  title: 'Business Services',
                  icon: <ForkOutlined />,
                  children: objectLeaves({ objectsById, type: 'BusinessService', icon: <ForkOutlined /> }),
                }),
              ]
            : []),
        ];
      }

      if (scope === 'Programme') {
        return isObjectTypeVisible('Capability')
          ? [
              collectionNode({
                key: 'explorer:business:capabilities',
                title: 'Capabilities',
                icon: <ApartmentOutlined />,
                children: objectLeavesForTypes({
                  objectsById,
                  types: ['Capability', 'CapabilityCategory', 'SubCapability'],
                  iconForType: () => <ApartmentOutlined />,
                }),
              }),
            ]
          : [];
      }

      return [
        ...(isObjectTypeVisible('Enterprise')
          ? [
              collectionNode({
                key: 'explorer:business:enterprises',
                title: 'Enterprises',
                icon: <ApartmentOutlined />,
                children: scope === 'Business Unit' ? businessUnitEnterpriseChildren : enterpriseChildren,
              }),
            ]
          : []),
        ...(isObjectTypeVisible('Capability')
          ? [
              collectionNode({
                key: 'explorer:business:capabilities',
                title: 'Capabilities',
                icon: <ApartmentOutlined />,
                children: objectLeavesForTypes({
                  objectsById,
                  types: ['Capability', 'CapabilityCategory', 'SubCapability'],
                  iconForType: () => <ApartmentOutlined />,
                }),
              }),
            ]
          : []),
        ...(isObjectTypeVisible('BusinessService')
          ? [
              collectionNode({
                key: 'explorer:business:business-services',
                title: 'Business Services',
                icon: <ForkOutlined />,
                children: objectLeaves({ objectsById, type: 'BusinessService', icon: <ForkOutlined /> }),
              }),
            ]
          : []),
        ...(isObjectTypeVisible('BusinessProcess')
          ? [
              collectionNode({
                key: 'explorer:business:processes',
                title: 'Business Processes',
                icon: <ForkOutlined />,
                children: objectLeaves({ objectsById, type: 'BusinessProcess', icon: <ForkOutlined /> }),
              }),
            ]
          : []),
        ...(isObjectTypeVisible('Department')
          ? [
              collectionNode({
                key: 'explorer:business:departments',
                title: 'Departments',
                icon: <TeamOutlined />,
                  children: objectLeaves({ objectsById, type: 'Department', icon: <TeamOutlined /> }),
              }),
            ]
          : []),
      ];
    })();

    const businessRoot: DataNode = {
      key: ROOT_KEYS.business,
      title: 'Business',
      icon: <DatabaseOutlined />,
      children: businessChildren,
    };

    const applicationCollectionChildren =
      applicationGrouping === 'lifecycle'
        ? applicationsByLifecycleGrouping({ objectsById, applicationIcon: <AppstoreOutlined /> })
        : objectLeaves({ objectsById, type: 'Application', icon: <AppstoreOutlined /> });

    const applicationChildren: DataNode[] = [
      ...(isObjectTypeVisible('Application')
        ? [
            collectionNode({
              key: 'explorer:application:applications',
              title: 'Applications',
              icon: <AppstoreOutlined />,
              children: applicationCollectionChildren,
            }),
          ]
        : []),
      ...((scope === 'Programme') || !isObjectTypeVisible('ApplicationService')
        ? []
        : [
            collectionNode({
              key: 'explorer:application:application-services',
              title: 'Application Services',
              icon: <AppstoreOutlined />,
              children: objectLeaves({ objectsById, type: 'ApplicationService', icon: <AppstoreOutlined /> }),
            }),
          ]),
      ...((scope === 'Programme') || !isObjectTypeVisible('Interface')
        ? []
        : [
            collectionNode({
              key: 'explorer:application:interfaces',
              title: 'Interfaces',
              icon: <AppstoreOutlined />,
              children: objectLeaves({ objectsById, type: 'Interface', icon: <AppstoreOutlined /> }),
            }),
          ]),
    ];

    const applicationRoot: DataNode = {
      key: ROOT_KEYS.application,
      title: 'Application',
      icon: <DatabaseOutlined />,
      children: applicationChildren,
    };

    const technologyChildren: DataNode[] = [
      ...(isObjectTypeVisible('Node')
        ? [
            collectionNode({
              key: 'explorer:technology:nodes',
              title: 'Nodes',
              icon: <CloudOutlined />,
              children: objectLeaves({ objectsById, type: 'Node', icon: <CloudOutlined /> }),
            }),
          ]
        : []),
      ...(isObjectTypeVisible('Compute')
        ? [
            collectionNode({
              key: 'explorer:technology:compute',
              title: 'Compute',
              icon: <CloudOutlined />,
              children: objectLeaves({ objectsById, type: 'Compute', icon: <CloudOutlined /> }),
            }),
          ]
        : []),
      ...(isObjectTypeVisible('Runtime')
        ? [
            collectionNode({
              key: 'explorer:technology:runtime',
              title: 'Runtime',
              icon: <CloudOutlined />,
              children: objectLeaves({ objectsById, type: 'Runtime', icon: <CloudOutlined /> }),
            }),
          ]
        : []),
      ...(isObjectTypeVisible('Database')
        ? [
            collectionNode({
              key: 'explorer:technology:database',
              title: 'Database',
              icon: <CloudOutlined />,
              children: objectLeaves({ objectsById, type: 'Database', icon: <CloudOutlined /> }),
            }),
          ]
        : []),
      ...(isObjectTypeVisible('Technology') ||
      isObjectTypeVisible('Storage') ||
      isObjectTypeVisible('API') ||
      isObjectTypeVisible('MessageBroker') ||
      isObjectTypeVisible('IntegrationPlatform') ||
      isObjectTypeVisible('CloudService')
        ? [
            collectionNode({
              key: 'explorer:technology:infrastructure-services',
              title: 'Infrastructure Services',
              icon: <CloudOutlined />,
              children: objectLeavesForTypes({
                objectsById,
                types: ['Technology', 'Storage', 'API', 'MessageBroker', 'IntegrationPlatform', 'CloudService'],
                iconForType: () => <CloudOutlined />,
              }),
            }),
          ]
        : []),
    ];

    const technologyRoot: DataNode = {
      key: ROOT_KEYS.technology,
      title: 'Technology',
      icon: <DatabaseOutlined />,
      children: technologyChildren,
    };

    const makeSavedViewsEmpty = (suffix: string): DataNode => ({
      key: `explorer:views:saved:empty:${suffix}`,
      title: 'No saved views',
      icon: <FileTextOutlined />,
      isLeaf: true,
      selectable: false,
    });

    const savedViewsGroups: DataNode[] =
      viewCats.business.length === 0 && viewCats.application.length === 0 && viewCats.technology.length === 0
        ? [makeSavedViewsEmpty('all')]
        : [
            {
              key: 'explorer:views:saved:business',
              title: 'Business Views',
              icon: <ApartmentOutlined />,
              children: viewCats.business.length > 0 ? viewCats.business.map(viewLeaf) : [makeSavedViewsEmpty('business')],
            },
            {
              key: 'explorer:views:saved:application',
              title: 'Application Views',
              icon: <ApartmentOutlined />,
              children: viewCats.application.length > 0 ? viewCats.application.map(viewLeaf) : [makeSavedViewsEmpty('application')],
            },
            {
              key: 'explorer:views:saved:technology',
              title: 'Technology Views',
              icon: <ApartmentOutlined />,
              children: viewCats.technology.length > 0 ? viewCats.technology.map(viewLeaf) : [makeSavedViewsEmpty('technology')],
            },
          ];

    const viewsRoot: DataNode = {
      key: ROOT_KEYS.views,
      title: 'Views',
      icon: <ApartmentOutlined />,
      children: [
        {
          key: 'explorer:views:saved',
          title: 'Saved Views',
          icon: <ApartmentOutlined />,
          children: savedViewsGroups,
        },
        {
          key: 'explorer:views:roadmaps',
          title: 'Roadmaps',
          icon: <ApartmentOutlined />,
          children: roadmaps.map(roadmapLeaf),
        },
      ],
    };

    const tree: DataNode[] = (() => {
      if (isCustomBlankCanvas) {
        return [
        {
          key: 'explorer:blank-canvas',
          title: 'Blank canvas (Custom)',
          icon: <DatabaseOutlined />,
          selectable: true,
          children: [
            {
              key: 'explorer:blank-canvas:hint',
              title: 'Define at least one element type in Metamodel to enable modeling',
              icon: <ProjectOutlined />,
              isLeaf: true,
            },
          ],
        },
        viewsRoot,
        ];
      }

      if (scope === 'Business Unit') {
        return [businessRoot, applicationRoot, technologyRoot].filter((n) => n.children.length > 0);
      }

      if (scope === 'Domain') {
        return [businessRoot, applicationRoot].filter((n) => n.children.length > 0);
      }

      if (scope === 'Programme') {
        const implMigRoot: DataNode = {
          key: ROOT_KEYS.implMig,
          title: 'Implementation & Migration',
          icon: <DatabaseOutlined />,
          children: [
            collectionNode({
              key: 'explorer:implmig:programmes',
              title: 'Programmes',
              icon: <ProjectOutlined />,
              children: objectLeaves({ objectsById, type: 'Programme', icon: <ProjectOutlined /> }),
            }),
            collectionNode({
              key: 'explorer:implmig:projects',
              title: 'Projects',
              icon: <FundProjectionScreenOutlined />,
              children: objectLeaves({ objectsById, type: 'Project', icon: <FundProjectionScreenOutlined /> }),
            }),
            collectionNode({
              key: 'explorer:implmig:plateaus',
              title: 'Plateaus',
              icon: <FundProjectionScreenOutlined />,
              children: plateaus.map(plateauLeaf),
            }),
          ],
        };

        const programmeViewsRoot: DataNode = {
          key: ROOT_KEYS.views,
          title: 'Views',
          icon: <ApartmentOutlined />,
          children: [
            {
              key: 'explorer:views:saved',
              title: 'Saved Views',
              icon: <ApartmentOutlined />,
              children: savedViewsGroups,
            },
            {
              key: 'explorer:views:roadmaps',
              title: 'Roadmaps',
              icon: <ApartmentOutlined />,
              children: roadmaps.map(roadmapLeaf),
            },
          ],
        };

        return [
          implMigRoot,
          programmeViewsRoot,
          ...[applicationRoot, businessRoot, ...(showTechnologyInProgrammeScope ? [technologyRoot] : [])].filter(
            (n) => n.children.length > 0,
          ),
        ];
      }

      return [
        ...[businessRoot, applicationRoot, technologyRoot].filter((n) => n.children.length > 0),
        {
          key: ROOT_KEYS.implMig,
          title: 'Implementation & Migration',
          icon: <DatabaseOutlined />,
          children: [
            collectionNode({
              key: 'explorer:implmig:programmes',
              title: 'Programmes',
              icon: <ProjectOutlined />,
              children: objectLeaves({ objectsById, type: 'Programme', icon: <ProjectOutlined /> }),
            }),
            collectionNode({
              key: 'explorer:implmig:projects',
              title: 'Projects',
              icon: <FundProjectionScreenOutlined />,
              children: objectLeaves({ objectsById, type: 'Project', icon: <FundProjectionScreenOutlined /> }),
            }),
            collectionNode({
              key: 'explorer:implmig:plateaus',
              title: 'Plateaus',
              icon: <FundProjectionScreenOutlined />,
              children: plateaus.map(plateauLeaf),
            }),
          ],
        },
        {
          key: ROOT_KEYS.governance,
          title: 'Governance',
          icon: <DatabaseOutlined />,
          children: [
            collectionNode({
              key: 'explorer:governance:principles',
              title: 'Principles',
              icon: <SafetyOutlined />,
              children: objectLeaves({ objectsById, type: 'Principle', icon: <SafetyOutlined /> }),
            }),
            collectionNode({
              key: 'explorer:governance:requirements',
              title: 'Requirements',
              icon: <FileTextOutlined />,
              children: objectLeaves({ objectsById, type: 'Requirement', icon: <FileTextOutlined /> }),
            }),
            collectionNode({
              key: 'explorer:governance:standards',
              title: 'Standards',
              icon: <FileTextOutlined />,
              children: objectLeaves({ objectsById, type: 'Standard', icon: <FileTextOutlined /> }),
            }),
          ],
        },
        viewsRoot,
        {
          key: ROOT_KEYS.baselines,
          title: 'Baselines',
          icon: <SafetyOutlined />,
          children:
            baselines.length === 0
              ? [
                  {
                    key: 'explorer:baselines:empty',
                    title: 'No baselines yet',
                    icon: <FileTextOutlined />,
                    isLeaf: true,
                    selectable: false,
                  },
                ]
              : baselines.map(baselineLeaf),
        },
      ];
    })();

    const index = new Map<string, string>();
    const walk = (nodes: DataNode[]) => {
      nodes.forEach((node) => {
        const data = (node as any)?.data as { elementId?: string } | undefined;
        if (data?.elementId && typeof node.key === 'string' && !index.has(data.elementId)) {
          index.set(data.elementId, node.key);
        }
        if (node.children) walk(node.children);
      });
    };
    walk(tree);

    return { treeData: tree, elementKeyIndex: index } as const;
  }, [applicationGrouping, customModelingEnabled, eaRepository, initializationState?.status, initializeEnterprise, metadata?.architectureScope, metadata?.referenceFramework, refreshToken, showTechnologyInProgrammeScope, userRole, views]);

  const selectedKeysFromContext = React.useMemo(() => {
    const key = selection?.keys?.[0];
    if (!key) return [] as React.Key[];
    if (typeof key === 'string' && key.startsWith('explorer:element:')) {
      const id = normalizeElementKey(key);
      const mapped = elementKeyIndex.get(id);
      if (mapped) return [mapped];
      return [key];
    }
    if (typeof key === 'string' && key.startsWith('explorer:')) return [key];
    if (typeof key === 'string') {
      const mapped = elementKeyIndex.get(key);
      return [mapped ?? KEY.element(key)];
    }
    return [] as React.Key[];
  }, [elementKeyIndex, normalizeElementKey, selection?.keys]);

  const parentByKey = React.useMemo(() => {
    const map = new Map<string, string | null>();

    const walk = (nodes: DataNode[], parent: string | null) => {
      nodes.forEach((node) => {
        if (typeof node.key === 'string') {
          map.set(node.key, parent);
          if (node.children) walk(node.children, node.key);
        }
      });
    };

    walk(treeData, null);
    return map;
  }, [treeData]);

  const activePathAncestors = React.useMemo(() => {
    const selected = selectedKeysFromContext[0];
    if (typeof selected !== 'string') return new Set<string>();

    const ancestors = new Set<string>();
    let cursor: string | null = selected;
    while (cursor) {
      const parent = parentByKey.get(cursor) ?? null;
      if (!parent) break;
      ancestors.add(parent);
      cursor = parent;
    }

    return ancestors;
  }, [parentByKey, selectedKeysFromContext]);

  const handleDrop: TreeProps['onDrop'] = React.useCallback(
    (info) => {
      if (!eaRepository) return;
      if (!hierarchyEditingEnabled) return;
      if (info.dropToGap) return;

      const targetKey = typeof info.node?.key === 'string' ? info.node.key : '';
      const dragKey = typeof info.dragNode?.key === 'string' ? info.dragNode.key : '';
      if (!targetKey.startsWith('explorer:element:') || !dragKey.startsWith('explorer:element:')) return;

      // Prevent cycles: do not allow dropping into a descendant of the dragged node.
      let cursor: string | null = targetKey;
      while (cursor) {
        if (cursor === dragKey) return;
        cursor = parentByKey.get(cursor) ?? null;
      }

      const parentData = (info.node as any)?.data as { elementId?: string; elementType?: ObjectType };
      const childData = (info.dragNode as any)?.data as { elementId?: string; elementType?: ObjectType };
      if (!parentData?.elementId || !parentData?.elementType) return;
      if (!childData?.elementId || !childData?.elementType) return;
      if (parentData.elementId === childData.elementId) return;

      const relationshipType = inferHierarchyRelationshipType(parentData.elementType, childData.elementType);
      if (!relationshipType) return; // Invalid endpoint pair for hierarchy changes → silent no-op.

      const existingHierarchyRels = eaRepository.relationships.filter((r) => r.toId === childData.elementId);
      const alreadyLinked = existingHierarchyRels.some(
        (r) =>
          (HIERARCHY_RELATIONSHIP_TYPES as readonly RelationshipType[]).includes(r.type as RelationshipType) &&
          r.fromId === parentData.elementId &&
          r.type === relationshipType,
      );
      if (alreadyLinked) return; // Nothing to change.

      if (permissionGuard('createRelationship')) return;

      const parentObj = eaRepository.objects.get(parentData.elementId);
      const childObj = eaRepository.objects.get(childData.elementId);
      const parentLabel = parentObj ? nameForObject(parentObj) : parentData.elementId;
      const childLabel = childObj ? nameForObject(childObj) : childData.elementId;

      Modal.confirm({
        title: 'Change hierarchy?',
        okText: 'Apply',
        cancelText: 'Cancel',
        content: (
          <div style={{ display: 'grid', gap: 4 }}>
            <span>
              Create {relationshipType} from <strong>{parentLabel}</strong> to <strong>{childLabel}</strong>.
            </span>
            <Typography.Text type="secondary">
              Existing hierarchy links to {childLabel} will be removed first.
            </Typography.Text>
          </div>
        ),
        onOk: () => {
          const next = eaRepository.clone();

          next.relationships = next.relationships.filter((r) => {
            const relType = r.type as RelationshipType;
            if (!(HIERARCHY_RELATIONSHIP_TYPES as readonly RelationshipType[]).includes(relType)) return true;
            return r.toId !== childData.elementId;
          });

          const addRes = next.addRelationship({
            fromId: parentData.elementId,
            toId: childData.elementId,
            type: relationshipType,
            attributes: { createdBy: actor },
          });
          if (!addRes.ok) {
            message.error(addRes.error);
            return Promise.reject();
          }

          const applied = trySetEaRepository(next);
          if (!applied.ok) return Promise.reject();

          message.success('Hierarchy updated.');
          try {
            window.dispatchEvent(new Event('ea:repositoryChanged'));
            window.dispatchEvent(new Event('ea:relationshipsChanged'));
          } catch {
            // Best-effort only.
          }
          return Promise.resolve();
        },
      });
    },
    [actor, eaRepository, parentByKey, permissionGuard, trySetEaRepository],
  );

  const createObject = React.useCallback(
    (type: ObjectType) => {
      message.info('Create new elements from the EA Toolbox. Explorer is for browsing and reuse.');
      return;
      if (isReadOnlyMode) {
        message.warning('Read-only mode: creation is disabled.');
        return;
      }
      if (permissionGuard('createElement')) return;
      if (!eaRepository) {
        message.warning('No repository loaded. Create a repository first.');
        return;
      }

      const enabledFrameworks = (metadata?.enabledFrameworks && metadata.enabledFrameworks.length > 0)
        ? metadata.enabledFrameworks
        : (metadata?.referenceFramework ? [metadata.referenceFramework] : []);
      const allowedByFramework = enabledFrameworks.length === 0
        ? true
        : enabledFrameworks.some((framework) => {
            if (framework === 'Custom') {
              if (!customModelingEnabled) return false;
              return isObjectTypeEnabledForFramework('Custom', metadata?.frameworkConfig ?? undefined, type);
            }
            return isObjectTypeAllowedForReferenceFramework(framework, type);
          });
      if (!allowedByFramework) {
        message.warning('Element type is not enabled for the selected framework(s).');
        return;
      }

      if (metadata?.architectureScope === 'Programme') {
        const programmeCount = countLiveObjectsByType(eaRepository.objects, 'Programme');
        if (programmeCount < 1 && type !== 'Programme') {
          message.warning('Create at least one Programme before creating other elements.');
          return;
        }
        const allowed: ReadonlySet<ObjectType> = new Set(['Programme', 'Project', 'Capability', 'Application']);
        if (!allowed.has(type)) {
          message.warning('Programme scope is focused: only Programmes, Projects, Capabilities, and Applications can be created.');
          return;
        }
      }

      if (metadata?.architectureScope === 'Domain') {
        const allowed: ReadonlySet<ObjectType> = new Set([
          'Capability',
          'BusinessService',
          'Application',
          'ApplicationService',
        ]);
        if (!allowed.has(type)) {
          message.warning(
            'Domain scope is focused: only Capabilities, Business Services, Applications, and Application Services can be created.',
          );
          return;
        }
      }

      if (metadata?.architectureScope === 'Business Unit' && type === 'Enterprise') {
        const liveEnterprises = countLiveObjectsByType(eaRepository.objects, 'Enterprise');
        if (liveEnterprises >= 1) {
          message.warning('Business Unit scope allows exactly one Enterprise root.');
          return;
        }
      }

      // Generate UUID-based element ID
      const elementId = generateElementId(type);
      const createdAt = new Date().toISOString();

      let name = '';
      let description = '';
      let ownerId = '';
      let lifecycleState = '';
      let admPhase = '';

      const isStrictGovernance = metadata?.governanceMode === 'Strict';

      const ownerCandidates = Array.from(eaRepository.objects.values())
        .filter((o) => !isSoftDeleted(o.attributes) && (o.type === 'Enterprise' || o.type === 'Department'))
        .map((o) => ({ id: o.id, type: o.type, title: nameForObject(o) }))
        .sort((a, b) => (a.type + a.title + a.id).localeCompare(b.type + b.title + b.id));

      const lifecycleOptions = lifecycleOptionsForFramework(metadata?.referenceFramework, metadata?.lifecycleCoverage);
      const lifecyclePlaceholder = defaultLifecycleStateForFramework(metadata?.referenceFramework, metadata?.lifecycleCoverage);

      const ownerOptions: Array<{ label: string; options: Array<{ value: string; label: string }> }> = [
        ...(isStrictGovernance && (type === 'Enterprise' || type === 'Department')
          ? [
              {
                label: 'Self',
                options: [{ value: elementId, label: `Self (${elementId})` }],
              },
            ]
          : []),
        {
          label: 'Enterprise',
          options: ownerCandidates
            .filter((o) => o.type === 'Enterprise')
            .map((o) => ({ value: o.id, label: `${o.title} (${o.id})` })),
        },
        {
          label: 'Department',
          options: ownerCandidates
            .filter((o) => o.type === 'Department')
            .map((o) => ({ value: o.id, label: `${o.title} (${o.id})` })),
        },
      ].filter((g) => g.options.length > 0);

      if (createModalOpenRef.current) return;
      createModalOpenRef.current = true;

      Modal.confirm({
        title: `Create ${titleForObjectType(type)}`,
        okText: 'Create',
        cancelText: 'Cancel',
        maskStyle: { backdropFilter: 'none', backgroundColor: 'rgba(0, 0, 0, 0.45)' },
        afterClose: () => {
          createModalOpenRef.current = false;
        },
        content: (
          <Form layout="vertical">
            <Form.Item label="Name" required>
              <Input
                defaultValue={name}
                placeholder="Enter name"
                onChange={(e) => {
                  name = e.target.value;
                }}
              />
            </Form.Item>
            <Form.Item label="Description">
              <Input.TextArea
                defaultValue={description}
                placeholder="Enter description (optional)"
                autoSize={{ minRows: 3, maxRows: 6 }}
                onChange={(e) => {
                  description = e.target.value;
                }}
              />
            </Form.Item>
            <Form.Item label="Lifecycle State" required>
              <Select
                placeholder={`Select lifecycle state (suggested: ${lifecyclePlaceholder})`}
                options={lifecycleOptions.map((v) => ({ value: v, label: v }))}
                onChange={(v) => {
                  lifecycleState = String(v);
                }}
              />
            </Form.Item>
            {metadata?.referenceFramework === 'TOGAF' ? (
              <Form.Item label="ADM Phase" required>
                <Input
                  placeholder="Enter ADM phase (e.g., A)"
                  onChange={(e) => {
                    admPhase = e.target.value;
                  }}
                />
              </Form.Item>
            ) : null}
            {type === 'Enterprise' ? (
              <Typography.Text type="secondary">
                Enterprise nodes are created explicitly and never inherit names from Capabilities, Applications, or Technologies.
              </Typography.Text>
            ) : null}
            {isStrictGovernance ? (
              <Form.Item label="Owner" required>
                <Select
                  placeholder="Select owner"
                  showSearch
                  optionFilterProp="label"
                  options={ownerOptions}
                  value={ownerId || undefined}
                  onChange={(v) => {
                    ownerId = String(v);
                  }}
                />
              </Form.Item>
            ) : null}
          </Form>
        ),
        onOk: () => {
          const finalName = (name ?? '').trim();
          if (!finalName) {
            message.error('Name is required.');
            return Promise.reject();
          }

          const finalOwnerId = (ownerId ?? '').trim();
          if (isStrictGovernance) {
            if (!finalOwnerId) {
              message.error('Owner is required in Strict mode.');
              return Promise.reject();
            }
            if ((type !== 'Enterprise' && type !== 'Department') || finalOwnerId !== elementId) {
              const owner = eaRepository.objects.get(finalOwnerId);
              if (!owner || isSoftDeleted(owner.attributes) || (owner.type !== 'Enterprise' && owner.type !== 'Department')) {
                message.error('Owner must reference an existing Enterprise or Department.');
                return Promise.reject();
              }
            }
          }

          if (!eaRepository) return Promise.reject();
          const finalLifecycle = (lifecycleState ?? '').trim();
          if (!finalLifecycle) {
            message.error('Lifecycle state is required.');
            return Promise.reject();
          }
          if (metadata?.referenceFramework === 'TOGAF') {
            const finalPhase = (admPhase ?? '').trim();
            if (!finalPhase) {
              message.error('ADM phase is required for TOGAF.');
              return Promise.reject();
            }
          }
          const next = eaRepository.clone();
          const res = next.addObject({
            id: elementId,
            type,
            attributes: {
              name: finalName,
              description: (description ?? '').trim(),
              elementType: type,
              createdBy: actor,
              createdAt,
              lastModifiedAt: createdAt,
              lastModifiedBy: actor,
              lifecycleState: finalLifecycle,
              ...(metadata?.referenceFramework === 'TOGAF' ? { admPhase: admPhase.trim() } : {}),
              ...(isStrictGovernance
                ? {
                    ownerId: finalOwnerId,
                    ownerType:
                      finalOwnerId === elementId
                        ? type
                        : (eaRepository.objects.get(finalOwnerId)?.type ?? undefined),
                  }
                : {}),
              ...(metadata?.architectureScope === 'Domain'
                ? { domainId: (metadata?.repositoryName ?? '').trim() || 'domain' }
                : {}),
            },
          });
          if (!res.ok) {
            message.error(res.error);
            return Promise.reject();
          }

          // Note: NO relationships are auto-created

          const applied = trySetEaRepository(next);
          if (!applied.ok) return Promise.reject();

          // Auto-expand the collection to show the newly created element
          const collectionKey = getCollectionKeyForType(type);
          const rootKey = getRootKeyForType(type);
          if (collectionKey || rootKey) {
            setExpandedKeys((prev) => {
              const next = new Set(prev);
              if (rootKey) next.add(rootKey);
              if (collectionKey) next.add(collectionKey);
              return Array.from(next);
            });
          }

          message.success(`${titleForObjectType(type)} created.`);
          setRefreshToken((x) => x + 1);
          createModalOpenRef.current = false;
          return undefined;
        },
        onCancel: () => {
          createModalOpenRef.current = false;
        },
      });
    },
    [
      actor,
      customModelingEnabled,
      eaRepository,
      initializationGuard,
      metadata?.architectureScope,
      metadata?.frameworkConfig,
      metadata?.governanceMode,
      metadata?.referenceFramework,
      permissionGuard,
      setExpandedKeys,
      setRefreshToken,
      trySetEaRepository,
    ],
  );

  const duplicateObject = React.useCallback(
    (id: string) => {
      if (isReadOnlyMode) {
        message.warning('Read-only mode: duplication is disabled.');
        return;
      }
      if (permissionGuard('createElement')) return;
      if (!eaRepository) return;
      const src = eaRepository.objects.get(id);
      if (!src) return;

      const enabledFrameworks = (metadata?.enabledFrameworks && metadata.enabledFrameworks.length > 0)
        ? metadata.enabledFrameworks
        : (metadata?.referenceFramework ? [metadata.referenceFramework] : []);
      const allowedByFramework = enabledFrameworks.length === 0
        ? true
        : enabledFrameworks.some((framework) => {
            if (framework === 'Custom') {
              if (!customModelingEnabled) return false;
              return isObjectTypeEnabledForFramework('Custom', metadata?.frameworkConfig ?? undefined, src.type as any);
            }
            return isObjectTypeAllowedForReferenceFramework(framework, src.type as any);
          });
      if (!allowedByFramework) {
        message.warning('Element type is not enabled for the selected framework(s).');
        return;
      }

      if (metadata?.architectureScope === 'Business Unit' && src.type === 'Enterprise') {
        message.warning('Business Unit scope allows exactly one Enterprise root.');
        return;
      }

      const next = eaRepository.clone();
      const newId = generateElementId(src.type);
      const createdAt = new Date().toISOString();
      const res = next.addObject({
        id: newId,
        type: src.type,
        attributes: {
          ...(src.attributes ?? {}),
          name: `${nameForObject(src)} (Copy)`,
          elementType: src.type,
          createdBy: actor,
          createdAt,
          lastModifiedAt: createdAt,
          lastModifiedBy: actor,
          lifecycleState: (src.attributes as any)?.lifecycleState === 'To-Be' ? 'To-Be' : 'As-Is',
        },
      });
      if (!res.ok) {
        message.error(res.error);
        return;
      }

      // Note: NO relationships are auto-created for duplicated elements

      const applied = trySetEaRepository(next);
      if (!applied.ok) return;

      setRefreshToken((x) => x + 1);
      message.success('Element duplicated.');
    },
    [
      actor,
      customModelingEnabled,
      eaRepository,
      metadata?.architectureScope,
      metadata?.frameworkConfig,
      metadata?.referenceFramework,
      permissionGuard,
      trySetEaRepository,
    ],
  );

  const deleteObject = React.useCallback(
    (id: string) => {
      if (isReadOnlyMode) {
        message.warning('Read-only mode: deletion is disabled.');
        return;
      }
      if (permissionGuard('deleteElement')) return;
      if (!eaRepository) return;
      const obj = eaRepository.objects.get(id);
      if (!obj) return;

      if (metadata?.architectureScope === 'Business Unit' && obj.type === 'Enterprise') {
        message.warning('Business Unit scope requires exactly one Enterprise root; it cannot be deleted.');
        return;
      }

      const impacted = eaRepository.relationships.filter((r) => r.fromId === id || r.toId === id);
      const impactedCount = impacted.length;
      const impactedPreview = impacted.slice(0, 10).map((r) => {
        const source = eaRepository.objects.get(r.fromId);
        const target = eaRepository.objects.get(r.toId);
        const sourceName = source ? nameForObject(source) : r.fromId;
        const targetName = target ? nameForObject(target) : r.toId;
        return `${sourceName} —${r.type}→ ${targetName}`;
      });
      let removeRelationships = false;

      Modal.confirm({
        title: 'Delete element?',
        content: (
          <div style={{ display: 'grid', gap: 8 }}>
            <Typography.Text>
              Deletes "{nameForObject(obj)}" from the repository. Relationships are kept unless explicitly removed.
            </Typography.Text>
            <div>
              <Typography.Text type="secondary">Impacted relationships ({impactedCount})</Typography.Text>
              {impactedCount === 0 ? (
                <Typography.Text type="secondary" style={{ display: 'block' }}>
                  None
                </Typography.Text>
              ) : (
                <ul style={{ margin: '6px 0 0 16px' }}>
                  {impactedPreview.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                  {impactedCount > impactedPreview.length ? (
                    <li>…and {impactedCount - impactedPreview.length} more</li>
                  ) : null}
                </ul>
              )}
            </div>
            <Checkbox
              onChange={(e) => {
                removeRelationships = e.target.checked;
              }}
            >
              Also delete impacted relationships
            </Checkbox>
          </div>
        ),
        okText: 'Delete',
        okButtonProps: { danger: true },
        cancelText: 'Cancel',
        onOk: () => {
          if (!eaRepository) return;
          const next = eaRepository.clone();
          if (removeRelationships) {
            next.relationships = next.relationships.filter((r) => r.fromId !== id && r.toId !== id);
          }
          // Best-effort: mark as deleted (hard delete is implemented in EaRepository next iteration).
          const res = next.updateObjectAttributes(id, { _deleted: true }, 'merge');
          if (!res.ok) {
            message.error(res.error);
            return;
          }

          const applied = trySetEaRepository(next);
          if (!applied.ok) return;

          setRefreshToken((x) => x + 1);
          message.success('Element deleted.');
        },
      });
    },
    [eaRepository, metadata?.architectureScope, permissionGuard, trySetEaRepository],
  );

  const deleteView = React.useCallback((viewId: string) => {
    if (permissionGuard('editView')) return;
    const view = ViewStore.get(viewId);
    const isOwner = userRole === 'Owner';
    const isCreator = view?.createdBy === actor;
    if (!isOwner && !isCreator) {
      message.warning('Only the view creator or repository owner can delete this view.');
      return;
    }
    Modal.confirm({
      title: 'Delete view?',
      content: 'Deleting a diagram does not delete architecture data. Only the view definition is removed.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: () => {
        const removed = ViewStore.remove(viewId);
        if (!removed) {
          message.error('Failed to delete view.');
          return;
        }
        dispatchIdeCommand({ type: 'workspace.closeMatchingTabs', prefix: `studio:view:${viewId}` });
        setRefreshToken((x) => x + 1);
        message.success('View deleted.');
      },
    });
  }, [actor, permissionGuard, userRole]);

  const renameView = React.useCallback(
    (viewId: string) => {
      if (permissionGuard('editView')) return;
      const view = ViewStore.get(viewId);
      if (!view) {
        message.error('View not found.');
        return;
      }
      let nextName = view.name;
      Modal.confirm({
        title: 'Rename view',
        okText: 'Rename',
        cancelText: 'Cancel',
        content: (
          <Input
            defaultValue={view.name}
            onChange={(e) => {
              nextName = e.target.value;
            }}
            placeholder="View name"
          />
        ),
        onOk: () => {
          const name = (nextName ?? '').trim();
          if (!name) {
            message.error('Name is required.');
            return Promise.reject();
          }
          ViewStore.update(view.id, (current) => ({
            ...current,
            name,
          }));
          try {
            window.dispatchEvent(new Event('ea:viewsChanged'));
          } catch {
            // Best-effort only.
          }
          setViewsRefreshToken((x) => x + 1);
          message.success('View renamed.');
        },
      });
    },
    [permissionGuard],
  );

  const duplicateView = React.useCallback(
    (viewId: string) => {
      if (permissionGuard('editView')) return;
      const view = ViewStore.get(viewId);
      if (!view) {
        message.error('View not found.');
        return;
      }
      const now = new Date().toISOString();
      const newId = `view_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const copy: ViewInstance = {
        ...view,
        id: newId,
        name: `${view.name} Copy`,
        createdAt: now,
        createdBy: actor,
        status: 'DRAFT',
      };
      const saved = ViewStore.save(copy);
      try {
        window.dispatchEvent(new Event('ea:viewsChanged'));
      } catch {
        // Best-effort only.
      }
      setViewsRefreshToken((x) => x + 1);
      openRouteTab(`/views/${saved.id}`);
      message.success('View duplicated.');
    },
    [actor, openRouteTab, permissionGuard],
  );

  const exportView = React.useCallback((viewId: string, format: 'png' | 'json') => {
    try {
      window.dispatchEvent(new CustomEvent('ea:studio.view.export', { detail: { viewId, format } }));
    } catch {
      // Best-effort only.
    }
  }, []);

  const openForKey = React.useCallback(
    (key: string, opts?: { openMode?: 'new' | 'replace' }) => {
      const scope = metadata?.architectureScope ?? null;
      // Root nodes open the most common catalog / view for that domain.
      if (key === ROOT_KEYS.business) {
        if (scope === 'Programme') {
          openWorkspaceTab({ type: 'catalog', catalog: 'capabilities' });
          return;
        }
        openWorkspaceTab({ type: 'catalog', catalog: scope === 'Domain' ? 'capabilities' : 'enterprises' });
        return;
      }
      if (key === ROOT_KEYS.application) {
        openWorkspaceTab({ type: 'catalog', catalog: 'applications' });
        return;
      }
      if (key === ROOT_KEYS.technology) {
        openWorkspaceTab({ type: 'catalog', catalog: 'infrastructureServices' });
        return;
      }
      if (key === ROOT_KEYS.implMig) {
        openWorkspaceTab({ type: 'catalog', catalog: 'programmes' });
        return;
      }
      if (key === ROOT_KEYS.governance) {
        openWorkspaceTab({ type: 'catalog', catalog: 'principles' });
        return;
      }
      if (key === ROOT_KEYS.views) {
        // Views are managed under the Diagrams activity; keep this as a no-op open.
        openRouteTab('/workspace');
        return;
      }
      if (key === ROOT_KEYS.baselines) {
        // Baselines are read-only snapshots; no navigation on root click.
        return;
      }

      // Second-level catalogs.
      if (key === 'explorer:business:enterprises') {
        openWorkspaceTab({ type: 'catalog', catalog: 'enterprises' });
        return;
      }
      if (key === BUSINESS_UNIT_ENTERPRISE_PLACEHOLDER_KEY) {
        openWorkspaceTab({ type: 'catalog', catalog: 'enterprises' });
        return;
      }
      if (key === 'explorer:business:capabilities') {
        openWorkspaceTab({ type: 'catalog', catalog: 'capabilities' });
        return;
      }
      if (key === 'explorer:business:business-services') {
        openWorkspaceTab({ type: 'catalog', catalog: 'businessServices' });
        return;
      }
      if (key === 'explorer:business:processes') {
        openWorkspaceTab({ type: 'catalog', catalog: 'processes' });
        return;
      }
      if (key === 'explorer:business:departments') {
        openWorkspaceTab({ type: 'catalog', catalog: 'departments' });
        return;
      }
      if (key === 'explorer:application:applications') {
        openWorkspaceTab({ type: 'catalog', catalog: 'applications' });
        return;
      }
      if (key === 'explorer:application:application-services') {
        openWorkspaceTab({ type: 'catalog', catalog: 'applicationServices' });
        return;
      }
      if (key === 'explorer:application:interfaces') {
        openWorkspaceTab({ type: 'catalog', catalog: 'interfaces' });
        return;
      }
      if (key === 'explorer:technology:nodes') {
        openWorkspaceTab({ type: 'catalog', catalog: 'nodes' });
        return;
      }
      if (key === 'explorer:technology:compute') {
        openWorkspaceTab({ type: 'catalog', catalog: 'compute' });
        return;
      }
      if (key === 'explorer:technology:runtime') {
        openWorkspaceTab({ type: 'catalog', catalog: 'runtime' });
        return;
      }
      if (key === 'explorer:technology:database') {
        openWorkspaceTab({ type: 'catalog', catalog: 'databases' });
        return;
      }
      if (key === 'explorer:technology:infrastructure-services') {
        openWorkspaceTab({ type: 'catalog', catalog: 'infrastructureServices' });
        return;
      }
      if (key === 'explorer:implmig:programmes') {
        openWorkspaceTab({ type: 'catalog', catalog: 'programmes' });
        return;
      }

      if (key === 'explorer:implmig:projects') {
        openWorkspaceTab({ type: 'catalog', catalog: 'projects' });
        return;
      }

      if (key === 'explorer:implmig:plateaus') {
        return;
      }

      if (key === 'explorer:governance:principles') {
        openWorkspaceTab({ type: 'catalog', catalog: 'principles' });
        return;
      }
      if (key === 'explorer:governance:requirements') {
        openWorkspaceTab({ type: 'catalog', catalog: 'requirements' });
        return;
      }

      if (key.startsWith('explorer:views:')) {
        if (key === 'explorer:views:roadmaps') {
          const roadmaps = listRoadmaps();
          if (roadmaps.length > 0) {
            openWorkspaceTab({ type: 'roadmap', roadmapId: roadmaps[0]!.id });
          }
          return;
        }
        openRouteTab('/workspace');
        return;
      }

      if (key.startsWith('explorer:roadmap:')) {
        const roadmapId = key.replace('explorer:roadmap:', '').trim();
        const roadmap = getRoadmapById(roadmapId);
        if (!roadmap) {
          message.error('Roadmap not found.');
          return;
        }
        openWorkspaceTab({ type: 'roadmap', roadmapId });
        return;
      }

      if (key.startsWith('explorer:baseline:')) {
        const baselineId = key.replace('explorer:baseline:', '').trim();
        const baseline = getBaselineById(baselineId);
        if (!baseline) {
          message.error('Baseline not found.');
          return;
        }
        openWorkspaceTab({ type: 'baseline', baselineId });
        return;
      }

      if (key.startsWith('explorer:plateau:')) {
        const plateauId = key.replace('explorer:plateau:', '').trim();
        const plateau = getPlateauById(plateauId);
        if (!plateau) {
          message.error('Plateau not found.');
          return;
        }
        openWorkspaceTab({ type: 'plateau', plateauId });
        return;
      }

      if (key.startsWith('explorer:view:')) {
        const viewId = key.replace('explorer:view:', '').trim();
        if (viewId) {
          if (studioMode) {
            setSelectedElement(null);
            setSelection({ kind: 'none', keys: [] });
            requestStudioViewSwitch(viewId, { openMode: opts?.openMode ?? 'replace' });
            return;
          }
          openRouteTab(`/views/${viewId}`);
        }
        return;
      }

      if (key.startsWith('explorer:element:')) {
        const id = normalizeElementKey(key);
        const obj = eaRepository?.objects.get(id);
        if (!obj) return;
        openPropertiesPanel({ elementId: obj.id, elementType: obj.type, dock: 'right', readOnly: false });
        return;
      }

      openRouteTab('/workspace');
    },
    [
      eaRepository,
      metadata?.architectureScope,
      metadata?.repositoryName,
      normalizeElementKey,
      openPropertiesPanel,
      openRouteTab,
      openWorkspaceTab,
      requestStudioViewSwitch,
      setSelectedElement,
      setSelection,
      studioMode,
    ],
  );

  const menuForKey = React.useCallback(
    (key: string) => {
      const withMenuOnClick = (items: MenuProps['items']) => {
        const actionMap = new Map<string, () => void>();
        const walk = (list?: MenuProps['items']) => {
          list?.forEach((item) => {
            if (!item) return;
            const typedItem = item as any;
            const itemKey = typedItem?.key;
            const handler = typedItem?.onClick as (() => void) | undefined;
            if (itemKey !== undefined && handler) actionMap.set(String(itemKey), handler);
            if (typedItem?.children) walk(typedItem.children as MenuProps['items']);
          });
        };
        walk(items);

        return {
          items,
          onClick: ({ key: clickedKey }) => {
            const handler = actionMap.get(String(clickedKey));
            if (handler) handler();
          },
        } as MenuProps;
      };

      if (metadata?.architectureScope === 'Programme' && key === ROOT_KEYS.implMig) {
        const show = showTechnologyInProgrammeScope;

        return withMenuOnClick([
            {
              key: 'openProgrammes',
              label: 'Open Programmes Catalog',
              onClick: () => openWorkspaceTab({ type: 'catalog', catalog: 'programmes' }),
            },
            {
              key: 'toggleTechnology',
              label: show ? 'Hide Technology Layer' : 'Show Technology Layer',
              onClick: () => {
                setShowTechnologyFlag(!show);
              },
            },
            {
              key: 'refresh',
              label: 'Refresh',
              onClick: () => setRefreshToken((x) => x + 1),
            },
          ]);
      }

      if (key === BUSINESS_UNIT_ENTERPRISE_PLACEHOLDER_KEY) {
        return withMenuOnClick([
            {
              key: 'create',
              icon: <PlusOutlined />,
              label: 'Create in Toolbox',
              disabled: true,
              onClick: () => {
                message.info('Create new elements from the EA Toolbox.');
              },
            },
            {
              key: 'open',
              label: 'Open Enterprises Catalog',
              onClick: () => openWorkspaceTab({ type: 'catalog', catalog: 'enterprises' }),
            },
          ]);
      }

      // Collections: Create / Import / Bulk Edit / Refresh
      const collectionToCreateTypes: Record<string, readonly ObjectType[] | undefined> = {
        'explorer:business:enterprises': ['Enterprise'],
        'explorer:business:capabilities': ['Capability', 'CapabilityCategory', 'SubCapability'],
        'explorer:business:business-services': ['BusinessService'],
        'explorer:business:processes': ['BusinessProcess'],
        'explorer:business:departments': ['Department'],
        'explorer:application:applications': ['Application'],
        'explorer:application:application-services': ['ApplicationService'],
        'explorer:application:interfaces': ['Interface'],
        'explorer:technology:nodes': ['Node'],
        'explorer:technology:compute': ['Compute'],
        'explorer:technology:runtime': ['Runtime'],
        'explorer:technology:database': ['Database'],
        'explorer:technology:infrastructure-services': ['Technology', 'Storage', 'API', 'MessageBroker', 'IntegrationPlatform', 'CloudService'],
        'explorer:implmig:programmes': ['Programme'],
        'explorer:implmig:projects': ['Project'],
        'explorer:governance:principles': ['Principle'],
        'explorer:governance:requirements': ['Requirement'],
        'explorer:governance:standards': ['Standard'],
      };

      const createTypes = collectionToCreateTypes[key];
      if (createTypes) {
        const canCreateElement = !isReadOnlyMode && hasRepositoryPermission(userRole, 'createElement');
        const canImport = !isReadOnlyMode && hasRepositoryPermission(userRole, 'import');
        const canBulkEdit = !isReadOnlyMode && hasRepositoryPermission(userRole, 'bulkEdit');
        const csvEntityForType: Partial<Record<ObjectType, string>> = {
          Capability: 'Capabilities',
          BusinessProcess: 'BusinessProcesses',
          Application: 'Applications',
          Technology: 'Technologies',
          Programme: 'Programmes',
        };
        const csvEntity = csvEntityForType[createTypes[0]];
        const createLabel = 'Create in Toolbox';
        const importLabel = canImport ? 'Import (CSV / Excel)' : readOnlyLabel('Import (CSV / Excel)');
        const bulkLabel = canBulkEdit ? 'Bulk Edit' : readOnlyLabel('Bulk Edit');

        const createDisabled = true;
        const importDisabled = !canImport;
        const bulkDisabled = !canBulkEdit;

        const items = [
            {
              key: 'create',
              icon: <PlusOutlined />,
              label: createLabel,
              disabled: createDisabled,
              onClick: () => {
                message.info('Create new elements from the EA Toolbox.');
              },
            },
          {
            key: 'import',
            label: importLabel,
            disabled: importDisabled,
            onClick: () => {
              if (!canImport) {
                permissionGuard('import');
                return;
              }
              const target = csvEntity ? `/interoperability?csvEntity=${encodeURIComponent(csvEntity)}` : '/interoperability';
              openRouteTab(target);
              message.info(csvEntity ? `Opening Import Wizard for ${titleForObjectType(createType)}.` : 'Opening Import Wizard.');
            },
          },
          {
            key: 'bulk',
            label: bulkLabel,
            disabled: bulkDisabled,
            onClick: () => {
              if (!canBulkEdit) {
                permissionGuard('bulkEdit');
                return;
              }
              const target = csvEntity ? `/interoperability?csvEntity=${encodeURIComponent(csvEntity)}` : '/interoperability';
              openRouteTab(target);
              message.info(
                csvEntity
                  ? `Opening Import Wizard for bulk updates to ${titleForObjectType(createType)}.`
                  : 'Opening Import Wizard for bulk updates.',
              );
            },
          },
          {
            key: 'refresh',
            label: 'Refresh',
            onClick: () => setRefreshToken((x) => x + 1),
          },
        ];

        if (key === 'explorer:application:applications') {
          const menuItem = (
            mode: typeof applicationGrouping,
            label: string,
          ): {
            key: string;
            label: string;
            icon?: React.ReactNode;
            onClick: () => void;
          } => ({
            key: `app-group-${mode}`,
            label,
            icon: applicationGrouping === mode ? <CheckOutlined /> : undefined,
            onClick: () => setApplicationGrouping(mode),
          });

          items.push({ type: 'divider', key: 'app-group-divider' });
          items.push(menuItem('flat', 'Grouping: Flat'));
          items.push(menuItem('lifecycle', 'Grouping: By Lifecycle'));
        }

        return withMenuOnClick(items);
      }

      // Element: Open Properties / Duplicate / Delete
      if (key.startsWith('explorer:element:')) {
        const id = normalizeElementKey(key);
        const obj = eaRepository?.objects.get(id);
        const isBusinessUnitRootEnterprise =
          metadata?.architectureScope === 'Business Unit' && obj?.type === 'Enterprise';
        const canCreateRelationship = !isReadOnlyMode && hasRepositoryPermission(userRole, 'createRelationship');
        const canEditView = !isReadOnlyMode && hasRepositoryPermission(userRole, 'editView');
        const canCreateElement = !isReadOnlyMode && hasRepositoryPermission(userRole, 'createElement');
        const canDeleteElement = !isReadOnlyMode && hasRepositoryPermission(userRole, 'deleteElement');
        const relationshipDisabled = !canCreateRelationship;
        const addToViewDisabled = !canEditView;
        const duplicateDisabled = !canCreateElement;
        const deleteDisabled = isBusinessUnitRootEnterprise || !canDeleteElement;
        return withMenuOnClick([
            {
              key: 'open',
              label: 'Open Properties',
              onClick: () => {
                if (!obj) return;
                openPropertiesPanel({ elementId: obj.id, elementType: obj.type, dock: 'right', readOnly: false });
              },
            },
            {
              key: 'rel',
              label: 'Create Relationship',
              disabled: relationshipDisabled,
              onClick: () => {
                if (!obj) return;
                if (relationshipDisabled) {
                  message.warning('Read-only mode: relationship creation is disabled.');
                  return;
                }
                setRelationshipSource({ id: obj.id, type: obj.type, name: nameForObject(obj) });
                setSelectedRelationshipType('');
                setSelectedTargetId('');
                setRelationshipModalOpen(true);
              },
            },
            {
              key: 'addToView',
              label: 'Add to View',
              disabled: addToViewDisabled,
              onClick: () => {
                if (!obj) return;
                if (addToViewDisabled) {
                  message.warning('Read-only mode: view updates are disabled.');
                  return;
                }
                if (savedViews.length === 0) {
                  message.warning('No saved views available. Create a view first.');
                  return;
                }
                setAddToViewTarget({ id: obj.id, name: nameForObject(obj), type: obj.type });
                setAddToViewViewId((prev) => prev || savedViews[0]?.id || '');
                setAddToViewModalOpen(true);
              },
            },
            {
              key: 'impact',
              label: 'Impact Analysis',
              onClick: () => {
                if (!obj) return;
                const name = nameForObject(obj);
                openWorkspaceTab({ type: 'impact-element', elementId: obj.id, elementName: name, elementType: obj.type });
              },
            },
            {
              key: 'dup',
              label: 'Duplicate',
              disabled: duplicateDisabled,
              onClick: () => {
                if (!obj) return;
                if (duplicateDisabled) {
                  message.warning('Read-only mode: duplication is disabled.');
                  return;
                }
                duplicateObject(obj.id);
              },
            },
            {
              key: 'del',
              icon: <DeleteOutlined />,
              danger: true,
              label: 'Delete',
              disabled: deleteDisabled,
              onClick: () => {
                if (!obj) return;
                if (deleteDisabled) {
                  message.warning('Read-only mode: deletion is disabled.');
                  return;
                }
                deleteObject(obj.id);
              },
            },
          ]);
      }

      // View: Open / Delete
      if (key.startsWith('explorer:view:')) {
        const viewId = key.replace('explorer:view:', '').trim();
        const view = ViewStore.get(viewId);
        const deleteViewDisabled = !(userRole === 'Owner' || view?.createdBy === actor);
        const editViewDisabled = !canEditView;
        return withMenuOnClick(
          [
            {
              key: 'open',
              label: 'Open View (Runtime)',
              onClick: () => openRouteTab(`/views/${viewId}`),
            },
            ...(canEditView
              ? [
                  {
                    key: 'open-studio',
                    label: 'Edit in Studio',
                    onClick: () =>
                      window.dispatchEvent(
                        new CustomEvent('ea:studio.view.open', { detail: { viewId, openMode: 'replace' } }),
                      ),
                  },
                  {
                    key: 'open-studio-new',
                    label: 'Open in Studio (new tab)',
                    onClick: () =>
                      window.dispatchEvent(
                        new CustomEvent('ea:studio.view.open', { detail: { viewId, openMode: 'new' } }),
                      ),
                  },
                ]
              : []),
            {
              key: 'rename',
              label: 'Rename',
              icon: <EditOutlined />,
              disabled: editViewDisabled,
              onClick: () => renameView(viewId),
            },
            {
              key: 'duplicate',
              label: 'Duplicate',
              icon: <PlusSquareOutlined />,
              disabled: editViewDisabled,
              onClick: () => duplicateView(viewId),
            },
            {
              key: 'export-png',
              label: 'Export PNG',
              onClick: () => exportView(viewId, 'png'),
            },
            {
              key: 'export-json',
              label: 'Export JSON',
              onClick: () => exportView(viewId, 'json'),
            },
            {
              key: 'delete',
              icon: <DeleteOutlined />,
              danger: true,
              label: deleteViewDisabled ? 'Delete View (creator/owner only)' : 'Delete View',
              disabled: deleteViewDisabled,
              onClick: () => deleteView(viewId),
            },
          ],
        );
      }

      if (key.startsWith('explorer:roadmap:')) {
        const roadmapId = key.replace('explorer:roadmap:', '').trim();
        return withMenuOnClick([
            {
              key: 'open',
              label: 'Open Roadmap (read-only)',
              onClick: () => openWorkspaceTab({ type: 'roadmap', roadmapId }),
            },
          ]);
      }

      if (key.startsWith('explorer:plateau:')) {
        const plateauId = key.replace('explorer:plateau:', '').trim();
        return withMenuOnClick([
            {
              key: 'open',
              label: 'Open Plateau (read-only)',
              onClick: () => openWorkspaceTab({ type: 'plateau', plateauId }),
            },
          ]);
      }

      if (key.startsWith('explorer:baseline:')) {
        const baselineId = key.replace('explorer:baseline:', '').trim();
        return withMenuOnClick([
            {
              key: 'open',
              label: 'Open Baseline (read-only)',
              onClick: () => openWorkspaceTab({ type: 'baseline', baselineId }),
            },
            {
              key: 'preview',
              label: 'Preview baseline metadata',
              onClick: () => {
                const baseline = getBaselineById(baselineId);
                if (!baseline) {
                  message.error('Baseline not found.');
                  return;
                }
                setBaselinePreview(baseline);
                setBaselinePreviewOpen(true);
              },
            },
          ]);
      }

      return withMenuOnClick([
          {
            key: 'refresh',
            label: 'Refresh',
            onClick: () => setRefreshToken((x) => x + 1),
          },
        ]);
    },
    [
      computeTargetOptions,
      createObject,
      creatableTypeOptions,
      deleteObject,
      deleteView,
      duplicateObject,
      eaRepository,
      initializationGuard,
      initializationState?.status,
      metadata?.architectureScope,
      normalizeElementKey,
      openCreateTypePicker,
      openForKey,
      openPropertiesPanel,
      openRouteTab,
      openWorkspaceTab,
      permissionGuard,
      readOnlyLabel,
      setBaselinePreview,
      setBaselinePreviewOpen,
      setShowTechnologyFlag,
      showTechnologyInProgrammeScope,
      updateViewRoot,
      userRole,
      views,
    ],
  );

  return (
    <div className={styles.explorerTree}>
      {hasRepository && isRepoEmpty && !seedBannerDismissed ? (
        <Alert
          type="info"
          showIcon
          closable
          onClose={dismissSeedBanner}
          message="Repository is empty"
          description={
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Typography.Text>Seed sample architecture data to avoid blank diagrams.</Typography.Text>
              <Button size="small" type="primary" onClick={openSeedSampleDataModal}>
                Seed sample architecture
              </Button>
            </Space>
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}
      {isReadOnlyMode ? (
        <Typography.Text type="warning" style={{ display: 'block', marginBottom: 8 }}>
          Read-only mode: navigation only. Create, rename, and delete actions are disabled.
        </Typography.Text>
      ) : null}
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
        Create new elements from the EA Toolbox. Drag elements from Explorer to reuse them on the canvas.
      </Typography.Text>
      <Tree
        virtual
        height={treeHeight}
        itemHeight={34}
        showIcon
        showLine={{ showLeafIcon: false }}
        blockNode
        draggable={false}
        selectable
        expandAction={false}
        expandedKeys={expandedKeys}
        onExpand={(next) => setExpandedKeys(next)}
        selectedKeys={selectedKeysFromContext}
        treeData={treeData}
        switcherIcon={({ expanded }) => (expanded ? <CaretDownOutlined /> : <CaretRightOutlined />)}
        showIcon={false}
        titleRender={(node) => {
          const k = typeof node.key === 'string' ? node.key : '';
          const isPathAncestor = typeof node.key === 'string' && activePathAncestors.has(node.key);
          const data = (node as any)?.data as { elementId?: string; elementType?: string } | undefined;
          const obj = data?.elementId ? eaRepository?.objects.get(data.elementId) : undefined;
          const modelingState = modelingStateForObject(obj ?? null);
          const frameworkTags = frameworksForObject(obj);
          const canDrag = Boolean((node as any)?.data?.elementId && (node as any)?.data?.elementType);
          const handleDragStart = (event: React.DragEvent<HTMLSpanElement>) => {
            if (!canDrag) return;
            const dragData = (node as any)?.data as { elementId?: string; elementType?: string } | undefined;
            if (!dragData?.elementId || !dragData?.elementType) return;
            event.stopPropagation();
            event.dataTransfer.setData('application/x-ea-element-id', dragData.elementId);
            event.dataTransfer.setData('application/x-ea-element-type', dragData.elementType);
            event.dataTransfer.setData('text/plain', dragData.elementId);
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.dropEffect = 'copy';
          };
          const stateTag = modelingState ? (
            <Tag key={`state-${modelingState}`} color={MODELING_STATE_TAGS[modelingState].color}>
              {MODELING_STATE_TAGS[modelingState].label}
            </Tag>
          ) : null;
          return (
            <Dropdown trigger={['contextMenu']} menu={menuForKey(k)}>
              <span
                className={isPathAncestor ? styles.pathActive : undefined}
                draggable={canDrag}
                onDragStart={handleDragStart}
                title={canDrag ? 'Drag to canvas to reuse this element' : undefined}
              >
                {stateTag || frameworkTags.length > 0 ? (
                  <Space size={6}>
                    <span>{node.title as any}</span>
                    {stateTag}
                    {frameworkTags.map((tag) => (
                      <Tag key={tag} color="blue">
                        {tag}
                      </Tag>
                    ))}
                  </Space>
                ) : (
                  <span>{node.title as any}</span>
                )}
              </span>
            </Dropdown>
          );
        }}
        onSelect={(selectedKeys: React.Key[], info) => {
          const key = selectedKeys?.[0];
          if (typeof key !== 'string') return;

          // Explorer rule: caret/switcher click should ONLY expand/collapse.
          const target = (info?.nativeEvent?.target as HTMLElement | null) ?? null;
          if (target?.closest?.('.ant-tree-switcher')) return;

          const data = (info?.node as any)?.data as { elementId?: string; elementType?: string };
          const effectiveKey = data?.elementId ? KEY.element(data.elementId) : key;
          const native = info?.nativeEvent as MouseEvent | KeyboardEvent | undefined;
          const modifier = Boolean(native && (native.metaKey || native.ctrlKey || native.shiftKey));
          const openMode = modifier ? 'new' : 'replace';

          setSelection({ kind: 'repository', keys: [effectiveKey] });
          if (effectiveKey.startsWith('explorer:element:')) {
            if (data?.elementId && data?.elementType) {
              setSelectedElement({ id: data.elementId, type: data.elementType, source: 'Explorer' });
            } else {
              const id = normalizeElementKey(effectiveKey);
              setSelectedElement({ id, type: 'Unknown', source: 'Explorer' });
            }
          }
          openForKey(effectiveKey, { openMode });
        }}
        onRightClick={(info) => {
          const key = typeof info?.node?.key === 'string' ? (info.node.key as string) : '';
          if (key.startsWith('explorer:element:')) {
            const data = (info?.node as any)?.data as { elementId?: string; elementType?: string };
            if (data?.elementId && data?.elementType) {
              setSelectedElement({ id: data.elementId, type: data.elementType, source: 'Explorer' });
            } else {
              const id = normalizeElementKey(key);
              setSelectedElement({ id, type: 'Unknown', source: 'Explorer' });
            }
          }
        }}
      />

      <Modal
        open={relationshipModalOpen}
        title="Create Relationship"
        onCancel={() => setRelationshipModalOpen(false)}
        onOk={saveRelationshipFromModal}
        okText="Save"
        destroyOnClose
      >
        {relationshipSource ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <Typography.Text type="secondary">Source Element</Typography.Text>
              <Input
                value={`${relationshipSource.name} · ${relationshipSource.type} · ${relationshipSource.id}`}
                disabled
                style={{ marginTop: 4 }}
              />
            </div>

            <div>
              <Typography.Text type="secondary">Relationship Type</Typography.Text>
              <Select
                value={selectedRelationshipType || undefined}
                options={(() => {
                  if (!relationshipSource) return [] as any[];
                  const def = OBJECT_TYPE_DEFINITIONS[relationshipSource.type as ObjectType];
                  const allowed = (def?.allowedOutgoingRelationships ?? []).filter((t) => {
                    if (!isValidRelationshipType(t)) return false;
                    const relDef = RELATIONSHIP_TYPE_DEFINITIONS[t];
                    return Boolean(relDef && relDef.fromTypes.includes(relationshipSource.type as ObjectType));
                  }) as RelationshipType[];
                  return allowed.map((t) => ({ value: t, label: t }));
                })()}
                onChange={(val) => {
                  const nextType = val as RelationshipType;
                  setSelectedRelationshipType(nextType);
                  const nextTargets = computeTargetOptions(nextType, relationshipSource);
                  setSelectedTargetId(nextTargets[0]?.value ?? '');
                }}
                placeholder="Select relationship type"
                style={{ width: '100%', marginTop: 4 }}
              />
            </div>

            <div>
              <Typography.Text type="secondary">Target Element</Typography.Text>
              <Select
                showSearch
                optionFilterProp="label"
                value={selectedTargetId || undefined}
                options={selectedRelationshipType && relationshipSource ? computeTargetOptions(selectedRelationshipType, relationshipSource) : []}
                onChange={(val) => setSelectedTargetId(String(val))}
                placeholder="Select target"
                style={{ width: '100%', marginTop: 4 }}
                disabled={!selectedRelationshipType}
              />
            </div>
          </div>
        ) : (
          <Typography.Text type="secondary">No source element selected.</Typography.Text>
        )}
      </Modal>

      <Modal
        open={addToViewModalOpen}
        title="Add to View"
        onCancel={() => setAddToViewModalOpen(false)}
        onOk={handleConfirmAddToView}
        okText="Add"
        okButtonProps={{ disabled: !addToViewViewId || !addToViewTarget }}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Typography.Text type="secondary">Target view</Typography.Text>
            <Select
              value={addToViewViewId || undefined}
              options={savedViews.map((v) => ({
                value: v.id,
                label: `${v.name} (${v.viewpointId})`,
              }))}
              onChange={(val) => setAddToViewViewId(val as string)}
              style={{ width: '100%', marginTop: 6 }}
              placeholder="Choose a view"
            />
          </div>

          {addToViewTarget ? (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              Adds {addToViewTarget.name} ({addToViewTarget.type}) to the view scope. No elements or relationships are created.
            </Typography.Paragraph>
          ) : (
            <Typography.Text type="secondary">Select an element first, then choose Add to View.</Typography.Text>
          )}
        </Space>
      </Modal>

      <Modal
        open={baselinePreviewOpen}
        title={baselinePreview?.name || 'Baseline'}
        onCancel={() => {
          setBaselinePreview(null);
          setBaselinePreviewOpen(false);
        }}
        footer={null}
        destroyOnClose
      >
        {baselinePreview ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Text type="secondary">
              Read-only snapshot. Editing or deleting baselines is not allowed from Explorer.
            </Typography.Text>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="Baseline id">{baselinePreview.id}</Descriptions.Item>
              <Descriptions.Item label="Created at">{baselinePreview.createdAt}</Descriptions.Item>
              <Descriptions.Item label="Created by">{baselinePreview.createdBy ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Description">{baselinePreview.description ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Elements captured">{baselinePreview.elements.length}</Descriptions.Item>
              <Descriptions.Item label="Relationships captured">{baselinePreview.relationships.length}</Descriptions.Item>
              <Descriptions.Item label="Source revisions">{`${baselinePreview.source.elementsRevision} | ${baselinePreview.source.relationshipsRevision}`}</Descriptions.Item>
            </Descriptions>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
};

export default ExplorerTree;
