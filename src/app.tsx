import {
  ApartmentOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  ProjectOutlined,
} from '@ant-design/icons';
import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import { ProDescriptions, SettingDrawer } from '@ant-design/pro-components';
import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { Link, useLocation } from '@umijs/max';
import React from 'react';
import { Checkbox, Collapse, Descriptions, Drawer, Dropdown, Form, Input, Modal, Select, Tree, Typography, theme as antdTheme } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { AvatarDropdown, AvatarName } from '@/components';
import IdeShellLayout from '@/components/IdeShellLayout';
import ExplorerTree from '@/components/IdeShellLayout/ExplorerTree';
import DiagramsTree from '@/components/IdeShellLayout/DiagramsTree';
import AnalysisTree from '@/components/IdeShellLayout/AnalysisTree';
import MetamodelSidebar from '@/components/IdeShellLayout/MetamodelSidebar';
import SettingsPanel from '@/components/IdeShellLayout/SettingsPanel';
import defaultSettings from '../config/defaultSettings';
import { errorConfig } from './requestErrorConfig';
import {
  EA_LAYERS,
  OBJECT_TYPE_DEFINITIONS,
  RELATIONSHIP_TYPE_DEFINITIONS,
  type EaLayer,
  type ObjectType,
  type RelationshipType,
} from '@/pages/dependency-view/utils/eaMetaModel';
import { EaRepositoryProvider, useEaRepository } from '@/ea/EaRepositoryContext';
import { EaProjectProvider } from '@/ea/EaProjectContext';
import ProjectGate from '@/ea/ProjectGate';
import { IdeSelectionProvider } from '@/ide/IdeSelectionContext';
import RepositoryGate from '@/repository/RepositoryGate';
import FirstLaunch from '@/pages/first-launch';
import {
  canCreateObjectTypeForLifecycleCoverage,
  defaultLifecycleStateForLifecycleCoverage,
} from '@/repository/lifecycleCoveragePolicy';
import {
  isLifecycleStateAllowedForReferenceFramework,
  isObjectTypeAllowedForReferenceFramework,
} from '@/repository/referenceFrameworkPolicy';
import { isCustomFrameworkModelingEnabled, isObjectTypeEnabledForFramework } from '@/repository/customFrameworkConfig';
import { runtimeEnv } from '@/runtime/runtimeEnv';
import { message } from '@/ea/eaConsole';
import { ThemeProvider } from '@/theme/ThemeContext';

const isDev = process.env.NODE_ENV === 'development';
const isDevOrTest = isDev || process.env.CI;

const defaultLifecycleStateForFramework = (
  referenceFramework: string | null | undefined,
  lifecycleCoverage: string | null | undefined,
): string => {
  // Lifecycle Coverage uses As-Is/To-Be. TOGAF uses Baseline/Target.
  if (referenceFramework === 'TOGAF') {
    return lifecycleCoverage === 'To-Be' ? 'Target' : 'Baseline';
  }
  return defaultLifecycleStateForLifecycleCoverage(lifecycleCoverage as any);
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

type MetamodelSelection =
  | { kind: 'objectType'; layer: EaLayer; type: ObjectType }
  | { kind: 'relationshipType'; layer: EaLayer; type: RelationshipType };

type CatalogueSelection = { kind: 'catalogueObject'; objectId: string };

type DrawerSelection = MetamodelSelection | CatalogueSelection;

const buildMetamodelTreeData = (): DataNode[] => {
  const objectTypesByLayer = new Map<EaLayer, ObjectType[]>();
  const relationshipTypesByLayer = new Map<EaLayer, RelationshipType[]>();

  for (const layer of EA_LAYERS) {
    objectTypesByLayer.set(layer, []);
    relationshipTypesByLayer.set(layer, []);
  }

  (Object.keys(OBJECT_TYPE_DEFINITIONS) as ObjectType[]).forEach((type) => {
    const def = OBJECT_TYPE_DEFINITIONS[type];
    objectTypesByLayer.get(def.layer)?.push(type);
  });

  (Object.keys(RELATIONSHIP_TYPE_DEFINITIONS) as RelationshipType[]).forEach((type) => {
    const def = RELATIONSHIP_TYPE_DEFINITIONS[type];
    relationshipTypesByLayer.get(def.layer)?.push(type);
  });

  for (const [layer, list] of objectTypesByLayer) list.sort((a, b) => a.localeCompare(b));
  for (const [layer, list] of relationshipTypesByLayer) list.sort((a, b) => a.localeCompare(b));

  return EA_LAYERS.map((layer) => ({
    key: `layer:${layer}`,
    title: layer,
    selectable: false,
    children: [
      {
        key: `layer:${layer}:objects`,
        title: 'Element Types',
        selectable: false,
        children: (objectTypesByLayer.get(layer) ?? []).map((type) => ({
          key: `objectType:${type}`,
          title: type,
          isLeaf: true,
        })),
      },
      {
        key: `layer:${layer}:relationships`,
        title: 'Relationship Types',
        selectable: false,
        children: (relationshipTypesByLayer.get(layer) ?? []).map((type) => ({
          key: `relationshipType:${type}`,
          title: type,
          isLeaf: true,
        })),
      },
    ],
  }));
};

const getLayerForObjectType = (type: ObjectType): EaLayer => OBJECT_TYPE_DEFINITIONS[type].layer;
const getLayerForRelationshipType = (type: RelationshipType): EaLayer => RELATIONSHIP_TYPE_DEFINITIONS[type].layer;

const parseMetamodelSelection = (key: string): MetamodelSelection | undefined => {
  if (key.startsWith('objectType:')) {
    const type = key.replace('objectType:', '') as ObjectType;
    if (!OBJECT_TYPE_DEFINITIONS[type]) return undefined;
    return { kind: 'objectType', type, layer: getLayerForObjectType(type) };
  }
  if (key.startsWith('relationshipType:')) {
    const type = key.replace('relationshipType:', '') as RelationshipType;
    if (!RELATIONSHIP_TYPE_DEFINITIONS[type]) return undefined;
    return { kind: 'relationshipType', type, layer: getLayerForRelationshipType(type) };
  }
  return undefined;
};

const parseCatalogueSelection = (key: string): CatalogueSelection | undefined => {
  if (!key.startsWith('catalogueObject:')) return undefined;
  const objectId = key.replace('catalogueObject:', '').trim();
  if (!objectId) return undefined;
  return { kind: 'catalogueObject', objectId };
};

const parseCatalogueTypeKey = (key: string): ObjectType | undefined => {
  if (!key.startsWith('catalogueType:')) return undefined;
  return key.replace('catalogueType:', '').trim() as ObjectType;
};

const isSoftDeleted = (attributes: Record<string, unknown>) => attributes._deleted === true;

const makeUniqueId = (repoObjectIds: Set<string>, base: string) => {
  const normalized = (base ?? '').trim() || 'new';
  if (!repoObjectIds.has(normalized)) return normalized;
  let i = 2;
  while (repoObjectIds.has(`${normalized}-${i}`)) i += 1;
  return `${normalized}-${i}`;
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
    case 'Technology':
      return 'tech-';
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
    case 'Programme':
      return 'prog-';
    case 'CapabilityCategory':
      return 'capcat-';
    case 'Capability':
      return 'cap-';
    case 'SubCapability':
      return 'subcap-';
    case 'BusinessService':
      return 'bizsvc-';
    case 'BusinessProcess':
      return 'proc-';
    case 'Project':
      return 'proj-';
    case 'Department':
      return 'dept-';
    default:
      return `${String(type).toLowerCase()}-`;
  }
};

const EaExplorerSiderContent: React.FC<{
  view?: 'explorer' | 'metamodel' | 'catalogues' | 'diagrams';
}> = ({ view = 'explorer' }) => {
  const { eaRepository, setEaRepository, trySetEaRepository, metadata } = useEaRepository();
  if (!eaRepository) return null;

  const location = useLocation();
  const [activeKeys, setActiveKeys] = React.useState<string[]>(['Workspace', 'Metamodel', 'Catalogues', 'Diagrams']);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [selection, setSelection] = React.useState<DrawerSelection | undefined>(undefined);
  const isReadOnlyMode = false;

  const treeData = React.useMemo(() => buildMetamodelTreeData(), []);

  const onMetamodelSelect = (selectedKeys: React.Key[]) => {
    const key = selectedKeys[0];
    if (typeof key !== 'string') return;
    const next = parseMetamodelSelection(key);
    if (!next) return;
    setSelection(next);
    setDrawerOpen(true);
  };

  const catalogueTreeData = React.useMemo<DataNode[]>(() => {
    const byType = (type: ObjectType) => {
      const items = Array.from(eaRepository.objects.values()).filter(
        (o) => o.type === type && !isSoftDeleted(o.attributes),
      );
      items.sort((a, b) => {
        const aName = (typeof a.attributes.name === 'string' && a.attributes.name.trim()) ? String(a.attributes.name) : a.id;
        const bName = (typeof b.attributes.name === 'string' && b.attributes.name.trim()) ? String(b.attributes.name) : b.id;
        return aName.localeCompare(bName);
      });
      return items;
    };

    const capCategory = byType('CapabilityCategory');
    const capability = byType('Capability');
    const subCapability = byType('SubCapability');
    const enterprises = byType('Enterprise');
    const businessServices = byType('BusinessService');
    const processes = byType('BusinessProcess');
    const departments = byType('Department');
    const applications = byType('Application');
    const applicationServices = byType('ApplicationService');
    const interfaces = byType('Interface');
    const technology = byType('Technology');
    const nodes = byType('Node');
    const compute = byType('Compute');
    const runtime = byType('Runtime');
    const databases = byType('Database');
    const storage = byType('Storage');
    const apis = byType('API');
    const messageBrokers = byType('MessageBroker');
    const integrationPlatforms = byType('IntegrationPlatform');
    const cloudServices = byType('CloudService');
    const programmes = byType('Programme');

    const leaf = (id: string, title: string): DataNode => ({
      key: `catalogueObject:${id}`,
      title,
      isLeaf: true,
    });

    const toLeaves = (items: { id: string; attributes: Record<string, unknown> }[]) =>
      items.map((o) => {
        const name = typeof o.attributes.name === 'string' && o.attributes.name.trim() ? String(o.attributes.name) : o.id;
        return leaf(o.id, name);
      });

    return [
      {
        key: 'catalogues:business',
        title: 'Business',
        selectable: false,
        children: [
          {
            key: 'catalogueType:Enterprise',
            title: 'Enterprises',
            selectable: false,
            children: toLeaves(enterprises),
          },
          {
            key: 'catalogues:capabilities',
            title: 'Capabilities',
            selectable: false,
            children: [
              {
                key: 'catalogueType:CapabilityCategory',
                title: 'CapabilityCategory',
                selectable: false,
                children: toLeaves(capCategory),
              },
              {
                key: 'catalogueType:Capability',
                title: 'Capability',
                selectable: false,
                children: toLeaves(capability),
              },
              {
                key: 'catalogueType:SubCapability',
                title: 'SubCapability',
                selectable: false,
                children: toLeaves(subCapability),
              },
            ],
          },
          {
            key: 'catalogueType:BusinessService',
            title: 'Business Services',
            selectable: false,
            children: toLeaves(businessServices),
          },
          {
            key: 'catalogueType:BusinessProcess',
            title: 'Business Processes',
            selectable: false,
            children: toLeaves(processes),
          },
          {
            key: 'catalogueType:Department',
            title: 'Departments',
            selectable: false,
            children: toLeaves(departments),
          },
        ],
      },
      {
        key: 'catalogues:application',
        title: 'Application',
        selectable: false,
        children: [
          {
            key: 'catalogueType:Application',
            title: 'Applications',
            selectable: false,
            children: toLeaves(applications),
          },
          {
            key: 'catalogueType:ApplicationService',
            title: 'Application Services',
            selectable: false,
            children: toLeaves(applicationServices),
          },
          {
            key: 'catalogueType:Interface',
            title: 'Interfaces',
            selectable: false,
            children: toLeaves(interfaces),
          },
        ],
      },
      {
        key: 'catalogues:technology',
        title: 'Technology',
        selectable: false,
        children: [
          {
            key: 'catalogueType:Node',
            title: 'Nodes',
            selectable: false,
            children: toLeaves(nodes),
          },
          {
            key: 'catalogueType:Compute',
            title: 'Compute',
            selectable: false,
            children: toLeaves(compute),
          },
          {
            key: 'catalogueType:Runtime',
            title: 'Runtime',
            selectable: false,
            children: toLeaves(runtime),
          },
          {
            key: 'catalogueType:Database',
            title: 'Databases',
            selectable: false,
            children: toLeaves(databases),
          },
          {
            key: 'catalogueType:Technology',
            title: 'Infrastructure Services',
            selectable: false,
            children: toLeaves([
              ...technology,
              ...storage,
              ...apis,
              ...messageBrokers,
              ...integrationPlatforms,
              ...cloudServices,
            ]),
          },
        ],
      },
      {
        key: 'catalogueType:Programme',
        title: 'Programmes',
        selectable: false,
        children: toLeaves(programmes),
      },
    ];
  }, [eaRepository]);

  const selectCatalogueObject = React.useCallback((objectId: string) => {
    setSelection({ kind: 'catalogueObject', objectId });
    setDrawerOpen(true);
  }, []);

  const createNewElement = React.useCallback(
    (type: ObjectType) => {
      message.info('Create new elements from the EA Toolbox. Explorer is for browsing and reuse.');
      return;
      if (isReadOnlyMode) {
        message.warning('Read-only mode: creation is disabled.');
        return;
      }
      if (metadata?.referenceFramework === 'Custom') {
        if (!isCustomFrameworkModelingEnabled('Custom', metadata?.frameworkConfig ?? undefined)) {
          message.warning('Custom framework: define at least one element type in Metamodel to enable modeling.');
          return;
        }
        if (!isObjectTypeEnabledForFramework('Custom', metadata?.frameworkConfig ?? undefined, type)) {
          message.warning(`Custom framework: element type "${type}" is not enabled.`);
          return;
        }
      }

      if (!isObjectTypeAllowedForReferenceFramework(metadata?.referenceFramework, type)) {
        message.warning(`Type "${type}" is not enabled for the selected Reference Framework.`);
        return;
      }

      const lifecycleGuard = canCreateObjectTypeForLifecycleCoverage(metadata?.lifecycleCoverage, type);
      if (!lifecycleGuard.ok) {
        message.warning(lifecycleGuard.reason);
        return;
      }

      const existingIds = new Set<string>(eaRepository.objects.keys());
      const prefix = defaultIdPrefixForType(type);
      const nextNumber = (() => {
        const re = new RegExp(`^${prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(\\d+)$`);
        let max = 0;
        for (const id of existingIds) {
          const m = id.match(re);
          if (!m) continue;
          const n = Number.parseInt(m[1], 10);
          if (!Number.isNaN(n)) max = Math.max(max, n);
        }
        return max + 1;
      })();

      const id = makeUniqueId(existingIds, `${prefix}${nextNumber}`);
      let name = '';
      let lifecycleState = '';
      let hideFromDiagrams = false;
      let admPhase = '';
      const lifecycleOptions = lifecycleOptionsForFramework(metadata?.referenceFramework, metadata?.lifecycleCoverage);
      const lifecyclePlaceholder = defaultLifecycleStateForFramework(metadata?.referenceFramework, metadata?.lifecycleCoverage);

      Modal.confirm({
        title: `Create ${type}`,
        okText: 'Create',
        cancelText: 'Cancel',
        content: (
          <Form layout="vertical">
            <Form.Item label="ID">
              <Input value={id} readOnly />
            </Form.Item>
            <Form.Item label="Name" required>
              <Input
                placeholder="Enter name"
                onChange={(e) => {
                  name = e.target.value;
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
            <Form.Item>
              <Checkbox
                onChange={(e) => {
                  hideFromDiagrams = e.target.checked;
                }}
              >
                Hide from diagrams initially
              </Checkbox>
            </Form.Item>
          </Form>
        ),
        onOk: () => {
          const finalName = name.trim();
          if (!finalName) {
            message.error('Name is required.');
            return Promise.reject();
          }
          const finalLifecycle = (lifecycleState ?? '').trim();
          if (!finalLifecycle) {
            message.error('Lifecycle state is required.');
            return Promise.reject();
          }
          if (!isLifecycleStateAllowedForReferenceFramework(metadata?.referenceFramework, finalLifecycle)) {
            message.warning('Lifecycle state is not allowed for the selected Reference Framework.');
            return Promise.reject();
          }
          if (metadata?.referenceFramework === 'TOGAF') {
            const finalPhase = admPhase.trim();
            if (!finalPhase) {
              message.error('ADM phase is required for TOGAF.');
              return Promise.reject();
            }
          }

          const attributes: Record<string, unknown> = {
            name: finalName,
            lifecycleState: finalLifecycle,
            ...(hideFromDiagrams ? { hiddenFromDiagrams: true } : {}),
          };
          if (metadata?.referenceFramework === 'TOGAF') {
            attributes.admPhase = admPhase.trim();
          }

          const next = eaRepository.clone();
          const res = next.addObject({ id, type, attributes });
          if (!res.ok) {
            message.error(res.error);
            return Promise.reject();
          }
          const applied = trySetEaRepository(next);
          if (!applied.ok) return Promise.reject();
          selectCatalogueObject(id);
          return Promise.resolve();
        },
      });
    },
    [eaRepository, metadata?.frameworkConfig, metadata?.lifecycleCoverage, metadata?.referenceFramework, selectCatalogueObject, trySetEaRepository],
  );

  const duplicateElement = React.useCallback(
    (objectId: string) => {
      if (isReadOnlyMode) {
        message.warning('Read-only mode: duplication is disabled.');
        return;
      }
      const source = eaRepository.objects.get(objectId);
      if (!source) {
        message.error('Cannot duplicate: object not found.');
        return;
      }

      if (metadata?.referenceFramework === 'Custom') {
        if (!isCustomFrameworkModelingEnabled('Custom', metadata?.frameworkConfig ?? undefined)) {
          message.warning('Custom framework: define at least one element type in Metamodel to enable modeling.');
          return;
        }
        if (!isObjectTypeEnabledForFramework('Custom', metadata?.frameworkConfig ?? undefined, source.type)) {
          message.warning(`Custom framework: element type "${source.type}" is not enabled.`);
          return;
        }
      }

      if (!isObjectTypeAllowedForReferenceFramework(metadata?.referenceFramework, source.type)) {
        message.warning(`Type "${source.type}" is not enabled for the selected Reference Framework.`);
        return;
      }

      const lifecycleGuard = canCreateObjectTypeForLifecycleCoverage(metadata?.lifecycleCoverage, source.type);
      if (!lifecycleGuard.ok) {
        message.warning(lifecycleGuard.reason);
        return;
      }

      const existingIds = new Set<string>(eaRepository.objects.keys());
      const id = makeUniqueId(existingIds, `${source.id}-copy`);
      let name = '';
      let lifecycleState = '';
      let admPhase = '';
      let copyOwnership = false;
      let copyAdmPhase = false;
      const lifecycleOptions = lifecycleOptionsForFramework(metadata?.referenceFramework, metadata?.lifecycleCoverage);
      const lifecyclePlaceholder = defaultLifecycleStateForFramework(metadata?.referenceFramework, metadata?.lifecycleCoverage);
      const hasOwnership = Boolean((source.attributes as any)?.ownerId || (source.attributes as any)?.ownerType);

      Modal.confirm({
        title: `Duplicate ${source.type}`,
        okText: 'Duplicate',
        cancelText: 'Cancel',
        content: (
          <Form layout="vertical">
            <Form.Item label="New ID">
              <Input value={id} readOnly />
            </Form.Item>
            <Form.Item label="New Name" required>
              <Input
                placeholder="Enter name"
                onChange={(e) => {
                  name = e.target.value;
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
                <Checkbox
                  onChange={(e) => {
                    copyAdmPhase = e.target.checked;
                  }}
                >
                  Copy ADM phase from source
                </Checkbox>
              </Form.Item>
            ) : null}
            {hasOwnership ? (
              <Form.Item>
                <Checkbox
                  onChange={(e) => {
                    copyOwnership = e.target.checked;
                  }}
                >
                  Copy ownership fields (ownerId/ownerType)
                </Checkbox>
              </Form.Item>
            ) : null}
          </Form>
        ),
        onOk: () => {
          const finalName = name.trim();
          if (!finalName) {
            message.error('Name is required.');
            return Promise.reject();
          }
          const finalLifecycle = (lifecycleState ?? '').trim();
          if (!finalLifecycle) {
            message.error('Lifecycle state is required.');
            return Promise.reject();
          }
          if (!isLifecycleStateAllowedForReferenceFramework(metadata?.referenceFramework, finalLifecycle)) {
            message.warning('Lifecycle state is not allowed for the selected Reference Framework.');
            return Promise.reject();
          }
          let finalAdmPhase = '';
          if (metadata?.referenceFramework === 'TOGAF') {
            finalAdmPhase = copyAdmPhase
              ? String((source.attributes as any)?.admPhase ?? '').trim()
              : admPhase.trim();
            if (!finalAdmPhase) {
              message.error('ADM phase is required for TOGAF.');
              return Promise.reject();
            }
          }

          const { ownerId, ownerType, ...restAttributes } = (source.attributes ?? {}) as Record<string, unknown>;
          const attributes: Record<string, unknown> = {
            ...restAttributes,
            name: finalName,
            lifecycleState: finalLifecycle,
          };
          if (metadata?.referenceFramework === 'TOGAF') {
            attributes.admPhase = finalAdmPhase;
          }
          if (copyOwnership && hasOwnership) {
            attributes.ownerId = ownerId;
            attributes.ownerType = ownerType;
          }

          const next = eaRepository.clone();
          const res = next.addObject({ id, type: source.type, attributes });
          if (!res.ok) {
            message.error(res.error);
            return Promise.reject();
          }
          const applied = trySetEaRepository(next);
          if (!applied.ok) return Promise.reject();
          selectCatalogueObject(id);
          return Promise.resolve();
        },
      });
    },
    [eaRepository, metadata?.frameworkConfig, metadata?.lifecycleCoverage, metadata?.referenceFramework, selectCatalogueObject, trySetEaRepository],
  );

  const softDeleteElement = React.useCallback(
    (objectId: string) => {
      if (isReadOnlyMode) {
        message.warning('Read-only mode: deletion is disabled.');
        return;
      }
      const existing = eaRepository.objects.get(objectId);
      if (!existing) {
        message.error('Cannot delete: object not found.');
        return;
      }
      const impacted = eaRepository.relationships.filter((r) => r.fromId === objectId || r.toId === objectId);
      const impactedCount = impacted.length;
      const impactedPreview = impacted.slice(0, 10).map((r) => {
        const source = eaRepository.objects.get(r.fromId);
        const target = eaRepository.objects.get(r.toId);
        const sourceName = source && typeof source.attributes?.name === 'string' && source.attributes.name.trim()
          ? String(source.attributes.name)
          : r.fromId;
        const targetName = target && typeof target.attributes?.name === 'string' && target.attributes.name.trim()
          ? String(target.attributes.name)
          : r.toId;
        return `${sourceName} —${r.type}→ ${targetName}`;
      });
      let removeRelationships = false;

      Modal.confirm({
        title: 'Delete element?',
        okText: 'Delete',
        okButtonProps: { danger: true },
        cancelText: 'Cancel',
        content: (
          <div style={{ display: 'grid', gap: 8 }}>
            <Typography.Text>
              Deletes "{typeof existing.attributes?.name === 'string' && existing.attributes.name.trim() ? existing.attributes.name : existing.id}".
              Relationships are kept unless explicitly removed.
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
        onOk: () => {
          const next = eaRepository.clone();
          if (removeRelationships) {
            next.relationships = next.relationships.filter((r) => r.fromId !== objectId && r.toId !== objectId);
          }
          const res = next.updateObjectAttributes(
            objectId,
            { _deleted: true, deletedAt: Date.now(), hiddenFromDiagrams: true },
            'merge',
          );
          if (!res.ok) {
            message.error(res.error);
            return Promise.reject();
          }

          const applied = trySetEaRepository(next);
          if (!applied.ok) return Promise.reject();
          if (selection?.kind === 'catalogueObject' && selection.objectId === objectId) {
            setDrawerOpen(false);
            setSelection(undefined);
          }
          return Promise.resolve();
        },
      });
    },
    [eaRepository, selection, trySetEaRepository],
  );

  const renderCatalogueTitle = React.useCallback(
    (node: any) => {
      const nodeKey = typeof node?.key === 'string' ? node.key : '';
      const objectSelection = parseCatalogueSelection(nodeKey);
      const typeFromKey = parseCatalogueTypeKey(nodeKey);

      const items = [] as any[];
      if (typeFromKey) {
        items.push({ key: 'new', label: 'Create in Toolbox', disabled: true });
      }

      if (objectSelection) {
        const selectedType = eaRepository.objects.get(objectSelection.objectId)?.type;
        items.push(
          { key: 'new', label: 'Create in Toolbox', disabled: true },
          { key: 'duplicate', label: 'Duplicate', disabled: isReadOnlyMode },
          { type: 'divider' },
          { key: 'delete', label: 'Delete (soft delete)', danger: true, disabled: isReadOnlyMode },
        );
      }

      if (items.length === 0) return <span>{node.title}</span>;

      return (
        <Dropdown
          trigger={['contextMenu']}
          menu={{
            items,
            onClick: ({ key }) => {
              if (key === 'new') {
                const targetType =
                  typeFromKey ??
                  (objectSelection ? eaRepository.objects.get(objectSelection.objectId)?.type : undefined);
                if (targetType) createNewElement(targetType);
                return;
              }
              if (!objectSelection) return;
              if (key === 'duplicate') duplicateElement(objectSelection.objectId);
              if (key === 'delete') softDeleteElement(objectSelection.objectId);
            },
          }}
        >
          <span style={{ display: 'inline-flex', width: '100%' }}>{node.title}</span>
        </Dropdown>
      );
    },
    [createNewElement, duplicateElement, eaRepository.objects, metadata?.lifecycleCoverage, softDeleteElement],
  );

  const onCatalogueSelect = (selectedKeys: React.Key[]) => {
    const key = selectedKeys[0];
    if (typeof key !== 'string') return;
    const next = parseCatalogueSelection(key);
    if (!next) return;
    setSelection(next);
    setDrawerOpen(true);
  };

  const drawerTitle = selection
    ? selection.kind === 'objectType'
      ? `Element Type: ${selection.type}`
      : selection.kind === 'relationshipType'
        ? `Relationship Type: ${selection.type}`
        : `Catalogue Item: ${selection.objectId}`
    : 'EA Explorer';

  const drawerBody = (() => {
    if (!selection) return null;

    if (selection.kind === 'catalogueObject') {
      const obj = eaRepository.objects.get(selection.objectId);
      if (!obj) {
        return <Typography.Text type="secondary">Object not found in repository.</Typography.Text>;
      }

      const dataSource = {
        id: obj.id,
        type: obj.type,
        ...obj.attributes,
        name:
          typeof obj.attributes.name === 'string' && obj.attributes.name.trim() ? obj.attributes.name : obj.id,
      } as Record<string, unknown>;

      const editableKeys = new Set<string>(['name']);
      if (obj.type === 'Application') {
        editableKeys.add('criticality');
        editableKeys.add('lifecycle');
      }
      if (obj.type === 'CapabilityCategory' || obj.type === 'Capability' || obj.type === 'SubCapability') {
        editableKeys.add('category');
      }

      const columns = [
        { title: 'ID', dataIndex: 'id', editable: false, copyable: true },
        { title: 'Type', dataIndex: 'type', editable: false },
        {
          title: 'Name',
          dataIndex: 'name',
          formItemProps: { rules: [{ required: true, message: 'Name is required' }] },
        },
      ] as any[];

      if (editableKeys.has('category')) {
        columns.push({ title: 'Category', dataIndex: 'category' });
      }

      if (obj.type === 'Application') {
        columns.push(
          {
            title: 'Criticality',
            dataIndex: 'criticality',
            valueType: 'select',
            valueEnum: {
              high: { text: 'high' },
              medium: { text: 'medium' },
              low: { text: 'low' },
            },
          },
          {
            title: 'Lifecycle',
            dataIndex: 'lifecycle',
            valueType: 'select',
            valueEnum: {
              planned: { text: 'planned' },
              active: { text: 'active' },
              deprecated: { text: 'deprecated' },
            },
          },
        );
      }

      return (
        <ProDescriptions
          column={1}
          bordered
          size="small"
          dataSource={dataSource as any}
          columns={columns}
          editable={{
            onSave: async (_key: unknown, record: any) => {
              const patch: Record<string, unknown> = {};
              for (const k of editableKeys) {
                if (record[k] !== undefined) patch[k] = record[k];
              }
              const next = eaRepository.clone();
              const res = next.updateObjectAttributes(obj.id, patch, 'merge');
              if (!res.ok) return;
              trySetEaRepository(next);
            },
          }}
        />
      );
    }

    if (selection.kind === 'objectType') {
      const def = OBJECT_TYPE_DEFINITIONS[selection.type];
      if (!def) {
        return <Typography.Text type="secondary">Unknown object type.</Typography.Text>;
      }
      const attributes = def.attributes ?? [];
      const outgoing = def.allowedOutgoingRelationships ?? [];
      const incoming = def.allowedIncomingRelationships ?? [];
      return (
        <>
          <Typography.Paragraph style={{ marginBottom: 12 }}>{def.description}</Typography.Paragraph>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Layer">{def.layer}</Descriptions.Item>
            <Descriptions.Item label="Attributes">
              {attributes.length ? attributes.join(', ') : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Allowed Outgoing Relationships">
              {outgoing.length ? outgoing.join(', ') : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Allowed Incoming Relationships">
              {incoming.length ? incoming.join(', ') : '—'}
            </Descriptions.Item>
          </Descriptions>
        </>
      );
    }

    const def = RELATIONSHIP_TYPE_DEFINITIONS[selection.type];
    if (!def) {
      return <Typography.Text type="secondary">Unknown relationship type.</Typography.Text>;
    }
    const relAttributes = def.attributes ?? [];
    return (
      <>
        <Typography.Paragraph style={{ marginBottom: 12 }}>{def.description}</Typography.Paragraph>
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="Layer">{def.layer}</Descriptions.Item>
          <Descriptions.Item label="From Types">{def.fromTypes.join(', ')}</Descriptions.Item>
          <Descriptions.Item label="To Types">{def.toTypes.join(', ')}</Descriptions.Item>
          <Descriptions.Item label="Attributes">{relAttributes.length ? relAttributes.join(', ') : '—'}</Descriptions.Item>
        </Descriptions>
      </>
    );
  })();

  const workspacePanel = (
    <div style={{ opacity: 0.7, fontSize: 12 }}>
      Navigation scaffolding (v1): no routing changes.
    </div>
  );

  const metamodelPanel = (
    <Tree
      treeData={treeData}
      defaultExpandAll
      onSelect={onMetamodelSelect}
      selectedKeys={
        selection?.kind === 'objectType' || selection?.kind === 'relationshipType'
          ? [`${selection.kind}:${selection.type}`]
          : []
      }
    />
  );

  const cataloguesPanel = (
    <Tree
      treeData={catalogueTreeData}
      defaultExpandAll
      onSelect={onCatalogueSelect}
      titleRender={renderCatalogueTitle}
      selectedKeys={selection?.kind === 'catalogueObject' ? [`catalogueObject:${selection.objectId}`] : []}
    />
  );

  const mainBody = (() => {
    if (view === 'metamodel') return metamodelPanel;
    if (view === 'catalogues') return cataloguesPanel;
    if (view === 'diagrams') return null;

    return (
      <Collapse
        size="small"
        activeKey={activeKeys}
        onChange={(keys) => setActiveKeys(Array.isArray(keys) ? (keys as string[]) : [String(keys)])}
        items={[
          {
            key: 'Workspace',
            label: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <FolderOpenOutlined /> Workspace
              </span>
            ),
            children: workspacePanel,
          },
          {
            key: 'Metamodel',
            label: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <ProjectOutlined /> Metamodel
              </span>
            ),
            children: metamodelPanel,
          },
          {
            key: 'Catalogues',
            label: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <DatabaseOutlined /> Catalogues
              </span>
            ),
            children: cataloguesPanel,
          },
          {
            key: 'Diagrams',
            label: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <ApartmentOutlined /> Diagrams
              </span>
            ),
            children: (
              <Typography.Text type="secondary">Define catalog data before creating views.</Typography.Text>
            ),
          },
        ]}
      />
    );
  })();

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 8 }}>
      {mainBody}

      <Drawer
        title={drawerTitle}
        placement="right"
        width={420}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        {drawerBody}
      </Drawer>
    </div>
  );
};

/**
 * @see https://umijs.org/docs/api/runtime-config#getinitialstate
 * */
export async function getInitialState(): Promise<{
  settings?: Partial<LayoutSettings>;
  currentUser?: API.CurrentUser;
  loading?: boolean;
  fetchUserInfo?: () => Promise<API.CurrentUser | undefined>;
  runtimeEnv: {
    isDesktop: boolean;
    isWeb: boolean;
    density: 'compact' | 'normal';
  };
}> {
  const { ensureLocalUser } = await import('@/repository/localUserBootstrap');
  const bootstrap = ensureLocalUser();

  return {
    settings: defaultSettings as Partial<LayoutSettings>,
    currentUser: bootstrap.ok
      ? { name: bootstrap.value.displayName, userid: bootstrap.value.id, access: 'admin' }
      : undefined,
    runtimeEnv,
  };
}

// Theme algorithm (compact + light/dark) is now managed by <ThemeProvider> in rootContainer.
// This export only passes through existing config without overriding the algorithm.
export const antd = (memo: Record<string, any>) => {
  return memo;
};

// ProLayout 支持的api https://procomponents.ant.design/components/layout
export const layout: RunTimeLayoutConfig = ({
  initialState,
  setInitialState,
}) => {
  return {
    ...initialState?.settings,
    headerRender: false,
    headerHeight: 0,
    fixedHeader: false,
    headerTitleRender: false,
    logo: false,
    title: false,
    footerRender: false,
    contentStyle: { padding: 0, height: '100vh', overflow: 'hidden' },
    menuHeaderRender: undefined,
    menuRender: false,
    // 自定义 403 页面
    // unAccessible: <div>unAccessible</div>,
    // 增加一个 loading 的状态
    childrenRender: (children) => {
      // if (initialState?.loading) return <PageLoading />;
      const pathname = typeof window !== 'undefined' ? window.location?.pathname || '' : '';
      if (pathname.startsWith('/studio')) {
        return children;
      }
      return (
        <RepositoryGate
          shell={
            <ProjectGate
              shell={
                <>
                  <IdeShellLayout
                    sidebars={{
                      explorer: <ExplorerTree />,
                      diagrams: <DiagramsTree />,
                      analysis: <AnalysisTree />,
                      metamodel: <MetamodelSidebar />,
                      settings: <SettingsPanel />,
                    }}
                  >
                    {children}
                  </IdeShellLayout>
                  {isDevOrTest && (
                    <SettingDrawer
                      disableUrlParams
                      enableDarkTheme={false}
                      settings={initialState?.settings}
                      onSettingChange={(settings) => {
                        setInitialState((preInitialState) => ({
                          ...preInitialState,
                          settings: {
                            ...settings,
                            navTheme: 'light',
                          },
                        }));
                      }}
                    />
                  )}
                </>
              }
            >
              <FirstLaunch />
            </ProjectGate>
          }
        >
          <FirstLaunch />
        </RepositoryGate>
      );
    },
    navTheme: 'light',
  };
};

/**
 * @name request 配置，可以配置错误处理
 * 它基于 axios 和 ahooks 的 useRequest 提供了一套统一的网络请求和错误处理方案。
 * @doc https://umijs.org/docs/max/request#配置
 */
export const request: RequestConfig = {
  baseURL: isDev ? '' : 'https://proapi.azurewebsites.net',
  ...errorConfig,
};

export function rootContainer(container: React.ReactNode) {
  return (
    <ThemeProvider>
      <EaProjectProvider>
        <EaRepositoryProvider>
          <IdeSelectionProvider>{container}</IdeSelectionProvider>
        </EaRepositoryProvider>
      </EaProjectProvider>
    </ThemeProvider>
  );
}
