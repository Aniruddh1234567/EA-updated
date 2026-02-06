import React from 'react';
import { Alert, Button, Collapse, Descriptions, Dropdown, Empty, Form, Input, InputNumber, Modal, Radio, Select, Space, Switch, Tabs, Tag, Tooltip, Typography, message, theme } from 'antd';
import { AppstoreOutlined, ArrowsAltOutlined, CloudOutlined, CloseOutlined, DeleteOutlined, DragOutlined, EditOutlined, EllipsisOutlined, InfoCircleOutlined, LinkOutlined, LogoutOutlined, NodeIndexOutlined, PlusSquareOutlined, SelectOutlined, ShrinkOutlined } from '@ant-design/icons';
import { useModel } from '@umijs/max';
import cytoscape, { type Core } from 'cytoscape';

import styles from './style.module.less';
import { EA_CONNECTOR_REGISTRY, EA_SHAPE_REGISTRY, hasRegisteredEaShape } from '@/ea/archimateShapeRegistry';
import { OBJECT_TYPE_DEFINITIONS, RELATIONSHIP_TYPE_DEFINITIONS, type EaLayer, type EaObjectTypeDefinition, type ObjectType, type RelationshipType } from '@/pages/dependency-view/utils/eaMetaModel';
import { isObjectTypeAllowedForReferenceFramework } from '@/repository/referenceFrameworkPolicy';
import { canCreateObjectTypeForLifecycleCoverage } from '@/repository/lifecycleCoveragePolicy';
import { isCustomFrameworkModelingEnabled, isObjectTypeEnabledForFramework } from '@/repository/customFrameworkConfig';
import { useEaRepository } from '@/ea/EaRepositoryContext';
import { useIdeShell } from './index';
import { useIdeSelection } from '@/ide/IdeSelectionContext';
import { ENABLE_RBAC, hasRepositoryPermission, type RepositoryRole } from '@/repository/accessControl';
import { TRACEABILITY_CHECK_IDS, buildGovernanceDebt } from '@/ea/governanceValidation';
import { recordAuditEvent } from '@/repository/auditLog';
import { ViewStore } from '@/diagram-studio/view-runtime/ViewStore';
import { ViewLayoutStore } from '@/diagram-studio/view-runtime/ViewLayoutStore';
import { ViewpointRegistry } from '@/diagram-studio/viewpoints/ViewpointRegistry';
import { resolveViewScope } from '@/diagram-studio/viewpoints/resolveViewScope';
import type { ViewInstance } from '@/diagram-studio/viewpoints/ViewInstance';
import type { EaRepository } from '@/pages/dependency-view/utils/eaRepository';
import type {
  DesignWorkspace,
  DesignWorkspaceLayout,
  DesignWorkspaceLayoutEdge,
  DesignWorkspaceLayoutNode,
  DesignWorkspaceScope,
  DesignWorkspaceStagedElement,
  DesignWorkspaceStagedRelationship,
  DesignWorkspaceStatus,
} from '@/ea/DesignWorkspaceStore';

type StudioShellProps = {
  propertiesPanel: React.ReactNode;
  viewSwitchPanel?: React.ReactNode;
  onRequestProperties?: () => void;
  onRequestCloseViewSwitch?: () => void;
  designWorkspace: DesignWorkspace;
  onUpdateWorkspace: (next: DesignWorkspace) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onExit: (opts?: { suppressRefresh?: boolean }) => void;
  viewContext?: { viewId: string; readOnly?: boolean };
};

type DesignWorkspaceForm = {
  name: string;
  description?: string;
  scope?: DesignWorkspaceScope;
  status: DesignWorkspaceStatus;
};

type ViewSummaryForm = {
  purpose?: string;
  scope?: string;
  insights?: string;
};

type StudioMode = 'Explore' | 'Analyze' | 'Design' | 'Model';

type QuickCreateForm = {
  type: ObjectType;
  name: string;
  description?: string;
};

type BulkEditForm = {
  namePrefix?: string;
  nameSuffix?: string;
  description?: string;
};

type StudioToolMode = 'SELECT' | 'CREATE_ELEMENT' | 'CREATE_RELATIONSHIP' | 'CREATE_FREE_CONNECTOR' | 'PAN';

type FreeShapeKind =
  | 'rectangle'
  | 'rounded-rectangle'
  | 'circle'
  | 'diamond'
  | 'text'
  | 'swimlane'
  | 'container'
  | 'group'
  | 'boundary'
  | 'annotation';

type FreeShape = {
  id: string;
  kind: FreeShapeKind;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type FreeConnectorKind = 'arrow' | 'line';

type FreeConnector = {
  id: string;
  source: string;
  target: string;
  kind: FreeConnectorKind;
};

type StudioViewTab = {
  key: string;
  viewId: string;
  name: string;
  readOnly?: boolean;
};

type ViewTabState = {
  viewId: string;
  view: ViewInstance | null;
  saveStatus: 'saved' | 'saving' | 'dirty';
  lastSavedSignature: string;
};

type ViewLifecycleState = 'DRAFT' | 'SAVED' | 'READ-ONLY';

enum RightPanelMode {
  STUDIO = 'STUDIO',
  SELECTION = 'SELECTION',
  VIEW_SWITCH = 'VIEW_SWITCH',
}


const defaultIdPrefixForType = (type: ObjectType): string => {
  switch (type) {
    case 'Capability':
      return 'cap-';
    case 'Application':
      return 'app-';
    case 'Technology':
      return 'tech-';
    case 'Node':
      return 'node-';
    case 'Runtime':
      return 'rt-';
    case 'Database':
      return 'db-';
    case 'API':
      return 'api-';
    case 'MessageBroker':
      return 'mb-';
    case 'CloudService':
      return 'cloud-';
    default:
      return `${String(type).toLowerCase()}-`;
  }
};

const TECHNICAL_TERMS = [
  'api',
  'application',
  'app',
  'database',
  'server',
  'cloud',
  'platform',
  'infrastructure',
  'network',
  'system',
  'software',
  'hardware',
  'integration',
  'interface',
  'runtime',
  'compute',
  'storage',
  'message',
  'broker',
  'queue',
  'pipeline',
  'middleware',
  'technology',
  'tech',
];

const PHYSICAL_TERMS = [
  'server',
  'database',
  'db',
  'host',
  'node',
  'vm',
  'virtual machine',
  'cluster',
  'container',
  'kubernetes',
  'k8s',
  'docker',
  'runtime',
  'compute',
  'storage',
  'network',
  'router',
  'switch',
  'firewall',
  'load balancer',
  'gateway',
  'infra',
  'infrastructure',
];

const findTechnicalTerm = (text: string): string | null => {
  const normalized = String(text ?? '').toLowerCase();
  if (!normalized.trim()) return null;
  for (const term of TECHNICAL_TERMS) {
    const pattern = new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(normalized)) return term;
  }
  return null;
};

const findPhysicalTerm = (text: string): string | null => {
  const normalized = String(text ?? '').toLowerCase();
  if (!normalized.trim()) return null;
  for (const term of PHYSICAL_TERMS) {
    const pattern = new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(normalized)) return term;
  }
  return null;
};

const isItOwned = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return /\b(it|information technology)\b/i.test(normalized);
};

const PROCESS_VERBS = [
  'Place',
  'Process',
  'Approve',
  'Validate',
  'Verify',
  'Assess',
  'Review',
  'Fulfill',
  'Manage',
  'Handle',
  'Create',
  'Update',
  'Resolve',
  'Reconcile',
  'Notify',
  'Onboard',
  'Register',
  'Close',
  'Issue',
  'Capture',
  'Monitor',
  'Deliver',
];

const isVerbBasedProcessName = (name: string): boolean => {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return false;
  const first = trimmed.split(/\s+/)[0];
  return PROCESS_VERBS.some((verb) => verb.toLowerCase() === first.toLowerCase());
};

const generateUUID = (): string => {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
};

const generateElementId = (type: ObjectType): string => {
  return `${defaultIdPrefixForType(type)}${generateUUID()}`;
};

const GRID_SIZE = 20;
const ALIGN_THRESHOLD = 6;
const LARGE_GRAPH_THRESHOLD = 200;
const DRAG_THROTTLE_MS = 50;
const REPO_SNAPSHOT_KEY = 'ea.repository.snapshot.v1';
const DRAFT_EDGE_ID = '__draft_edge__';
const WORKSPACE_TAB_KEY = '__studio_workspace__';
const createViewTabKey = (viewId: string) => `view:${viewId}:${generateUUID()}`;
const STUDIO_RIGHT_PANEL_MIN_WIDTH = 280;
const STUDIO_RIGHT_PANEL_MAX_WIDTH = 520;
const STUDIO_RIGHT_PANEL_WIDTH_KEY = 'ea.studio.right.width';
const buildStudioRightPanelWidthKey = (userId: string) => `${STUDIO_RIGHT_PANEL_WIDTH_KEY}:${encodeURIComponent(userId)}`;
const getStudioRightPanelMaxWidth = () => {
  if (typeof window === 'undefined') return STUDIO_RIGHT_PANEL_MAX_WIDTH;
  if (window.innerWidth < 1200) return Math.min(STUDIO_RIGHT_PANEL_MAX_WIDTH, Math.floor(window.innerWidth * 0.4));
  return STUDIO_RIGHT_PANEL_MAX_WIDTH;
};


const layoutPositionsForView = (view: ViewInstance): Record<string, { x: number; y: number }> => {
  const fromMetadata = (view.layoutMetadata as any)?.positions;
  if (fromMetadata && typeof fromMetadata === 'object') return fromMetadata as Record<string, { x: number; y: number }>;
  return ViewLayoutStore.get(view.id);
};

const downloadJson = (filename: string, data: unknown) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const downloadDataUrl = (filename: string, dataUrl: string) => {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.click();
};

const isMarkedForRemoval = (attributes?: Record<string, unknown> | null): boolean => {
  return Boolean((attributes as any)?._deleted === true);
};

const normalizeAttributesForCompare = (attributes?: Record<string, unknown> | null) => {
  const raw = { ...(attributes ?? {}) } as Record<string, unknown>;
  delete (raw as any).lastModifiedAt;
  delete (raw as any).lastModifiedBy;
  return raw;
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
};

const nameForObject = (obj: { id: string; attributes?: Record<string, unknown> }) => {
  const raw = (obj.attributes as any)?.name;
  const name = typeof raw === 'string' ? raw.trim() : '';
  return name || obj.id;
};

const areAttributesEqual = (a?: Record<string, unknown> | null, b?: Record<string, unknown> | null) => {
  const left = normalizeAttributesForCompare(a);
  const right = normalizeAttributesForCompare(b);
  return stableStringify(left) === stableStringify(right);
};

const buildSvgIcon = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const resolveEaShapeForObjectType = (
  type: ObjectType | string,
): 'round-rectangle' | 'rectangle' | 'ellipse' | 'diamond' | 'hexagon' | null => {
  return EA_DEFAULT_VISUAL_BY_TYPE.get(type as ObjectType)?.shape ?? null;
};

type EaVisualShape = 'round-rectangle' | 'rectangle' | 'ellipse' | 'diamond' | 'hexagon';
type EaVisualKind = string;
type EaVisual = {
  kind: EaVisualKind;
  type: ObjectType;
  layer: EaLayer;
  label: string;
  shape: EaVisualShape;
  icon: string;
  color?: string;
  border?: string;
};

const EA_VISUALS: EaVisual[] = EA_SHAPE_REGISTRY.map((entry) => ({
  kind: entry.kind,
  type: entry.type,
  layer: entry.layer,
  label: entry.label,
  shape: entry.canvas.shape,
  icon: entry.svgPath,
  color: 'transparent',
  border: 'transparent',
}));

const EA_VISUAL_BY_KIND = new Map(EA_VISUALS.map((v) => [v.kind, v] as const));
const EA_DEFAULT_VISUAL_BY_TYPE = (() => {
  const map = new Map<ObjectType, EaVisual>();
  EA_VISUALS.forEach((v) => {
    if (!map.has(v.type)) map.set(v.type, v);
  });
  return map;
})();


const resolveEaVisualForElement = (args: {
  type: ObjectType;
  attributes?: Record<string, unknown> | null;
  visualKindOverride?: string | null;
}): EaVisual | null => {
  const rawKind = args.visualKindOverride ?? (args.attributes as any)?.eaVisualKind;
  const kind = typeof rawKind === 'string' ? rawKind.trim() : '';
  if (kind && EA_VISUAL_BY_KIND.has(kind)) {
    const visual = EA_VISUAL_BY_KIND.get(kind)!;
    if (visual.type === args.type) return visual;
  }
  return EA_DEFAULT_VISUAL_BY_TYPE.get(args.type) ?? null;
};

const buildEaVisualData = (args: {
  type: ObjectType;
  attributes?: Record<string, unknown> | null;
  visualKindOverride?: string | null;
}) => {
  const visual = resolveEaVisualForElement(args);
  if (!visual) {
    return {
      eaShape: undefined,
      eaIcon: undefined,
      eaColor: undefined,
      eaBorder: undefined,
      eaVisualKind: undefined,
    } as const;
  }
  return {
    eaShape: visual.shape,
    eaIcon: visual.icon,
    eaColor: visual.color,
    eaBorder: visual.border,
    eaVisualKind: visual.kind,
  } as const;
};

const FREE_SHAPE_DEFINITIONS: Array<{
  kind: FreeShapeKind;
  label: string;
  icon: string;
  width: number;
  height: number;
  shape: 'rectangle' | 'round-rectangle' | 'ellipse' | 'diamond';
}> = [
  {
    kind: 'rectangle',
    label: 'Rectangle',
    icon: buildSvgIcon(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="#595959" stroke-width="1.4"/></svg>',
    ),
    width: 140,
    height: 90,
    shape: 'rectangle',
  },
  {
    kind: 'rounded-rectangle',
    label: 'Rounded Rectangle',
    icon: buildSvgIcon(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="4" fill="none" stroke="#595959" stroke-width="1.4"/></svg>',
    ),
    width: 150,
    height: 95,
    shape: 'round-rectangle',
  },
  {
    kind: 'circle',
    label: 'Circle',
    icon: buildSvgIcon(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6" fill="none" stroke="#595959" stroke-width="1.4"/></svg>',
    ),
    width: 90,
    height: 90,
    shape: 'ellipse',
  },
  {
    kind: 'diamond',
    label: 'Diamond',
    icon: buildSvgIcon(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><polygon points="10,3 17,10 10,17 3,10" fill="none" stroke="#595959" stroke-width="1.4"/></svg>',
    ),
    width: 100,
    height: 100,
    shape: 'diamond',
  },
  {
    kind: 'text',
    label: 'Text Box',
    icon: buildSvgIcon(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path d="M4 5h12M10 5v10" stroke="#595959" stroke-width="1.4" stroke-linecap="round"/></svg>',
    ),
    width: 160,
    height: 60,
    shape: 'rectangle',
  },
  {
    kind: 'swimlane',
    label: 'Swimlane',
    icon: buildSvgIcon(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="#595959" stroke-width="1.4"/><line x1="3" y1="10" x2="17" y2="10" stroke="#595959" stroke-width="1.2"/></svg>',
    ),
    width: 220,
    height: 120,
    shape: 'round-rectangle',
  },
  {
    kind: 'container',
    label: 'Container',
    icon: buildSvgIcon(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="#595959" stroke-width="1.4" stroke-dasharray="3 2"/></svg>',
    ),
    width: 240,
    height: 140,
    shape: 'round-rectangle',
  },
  {
    kind: 'group',
    label: 'Group',
    icon: buildSvgIcon(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><rect x="3" y="5" width="14" height="10" rx="2" fill="none" stroke="#595959" stroke-width="1.4" stroke-dasharray="4 2"/><rect x="5" y="3" width="6" height="4" rx="1" fill="none" stroke="#595959" stroke-width="1.2"/></svg>',
    ),
    width: 260,
    height: 160,
    shape: 'round-rectangle',
  },
  {
    kind: 'boundary',
    label: 'Boundary',
    icon: buildSvgIcon(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="#595959" stroke-width="1.4" stroke-dasharray="1 2"/></svg>',
    ),
    width: 260,
    height: 160,
    shape: 'round-rectangle',
  },
  {
    kind: 'annotation',
    label: 'Annotation',
    icon: buildSvgIcon(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="#595959" stroke-width="1.4"/><line x1="5" y1="8" x2="15" y2="8" stroke="#595959" stroke-width="1.2"/><line x1="5" y1="12" x2="12" y2="12" stroke="#595959" stroke-width="1.2"/></svg>',
    ),
    width: 180,
    height: 90,
    shape: 'round-rectangle',
  },
];

const FREE_CONNECTOR_DEFINITIONS: Array<{ kind: FreeConnectorKind; label: string; icon: string }> = [
  {
    kind: 'arrow',
    label: 'Arrow',
    icon: buildSvgIcon(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><line x1="4" y1="10" x2="14" y2="10" stroke="#595959" stroke-width="1.6"/><polygon points="14,6 18,10 14,14" fill="#595959"/></svg>',
    ),
  },
  {
    kind: 'line',
    label: 'Line',
    icon: buildSvgIcon(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><line x1="4" y1="10" x2="16" y2="10" stroke="#595959" stroke-width="1.6"/></svg>',
    ),
  },
];

const StudioShell: React.FC<StudioShellProps> = ({
  propertiesPanel,
  viewSwitchPanel,
  onRequestProperties,
  onRequestCloseViewSwitch,
  designWorkspace,
  onUpdateWorkspace,
  onDeleteWorkspace,
  onExit,
  viewContext,
}) => {
  const { token } = theme.useToken();
  const { initialState } = useModel('@@initialState');
  const { openPropertiesPanel } = useIdeShell();
  const { selection } = useIdeSelection();
  const { eaRepository, metadata, trySetEaRepository } = useEaRepository();
  const actor =
    initialState?.currentUser?.name || initialState?.currentUser?.userid || 'studio';
  const rightPanelStorageKey = React.useMemo(() => {
    const rawId = initialState?.currentUser?.userid || initialState?.currentUser?.name || 'anonymous';
    return buildStudioRightPanelWidthKey(rawId);
  }, [initialState?.currentUser?.name, initialState?.currentUser?.userid]);
  const userRole: RepositoryRole = React.useMemo(() => {
    if (!ENABLE_RBAC) return 'Owner';
    const access = initialState?.currentUser?.access;
    if (access === 'admin') return 'Owner';
    if (access === 'architect' || access === 'user') return 'Architect';
    return 'Viewer';
  }, [initialState?.currentUser?.access]);
  const hasModelingAccess =
    hasRepositoryPermission(userRole, 'createElement') ||
    hasRepositoryPermission(userRole, 'editElement') ||
    hasRepositoryPermission(userRole, 'createRelationship') ||
    hasRepositoryPermission(userRole, 'editRelationship');
  const commitContextLocked = React.useMemo(() => {
    const key = selection?.activeDocument?.key ?? '';
    return key.startsWith('baseline:') || key.startsWith('plateau:') || key.startsWith('roadmap:');
  }, [selection?.activeDocument?.key]);
  const [stagedElements, setStagedElements] = React.useState<DesignWorkspaceStagedElement[]>(
    () => designWorkspace?.stagedElements ?? [],
  );
  const [stagedRelationships, setStagedRelationships] = React.useState<DesignWorkspaceStagedRelationship[]>(
    () => designWorkspace?.stagedRelationships ?? [],
  );
  const stagedSyncSignatureRef = React.useRef<string | null>(null);
  const resolveElementVisualLabel = React.useCallback(
    (type: ObjectType, visualKind?: string | null) => {
      const visual = resolveEaVisualForElement({ type, visualKindOverride: visualKind ?? undefined });
      return visual?.label ?? type;
    },
    [],
  );
  const pendingElementLabel = React.useMemo(
    () => (pendingElementType ? resolveElementVisualLabel(pendingElementType, pendingElementVisualKind) : null),
    [pendingElementType, pendingElementVisualKind, resolveElementVisualLabel],
  );
  const createElementHelperText = React.useMemo(() => {
    if (toolMode !== 'CREATE_ELEMENT' || !pendingElementType) return null;
    if (pendingElementNameDraft) return `Click on canvas to place "${pendingElementNameDraft.name}"`;
    return `Click on canvas to name and place ${pendingElementLabel ?? pendingElementType}`;
  }, [pendingElementLabel, pendingElementNameDraft, pendingElementType, toolMode]);
  const createElementFloatingHint = React.useMemo(() => {
    if (toolMode !== 'CREATE_ELEMENT' || !pendingElementType) return null;
    if (pendingElementNameDraft) return `Placing: ${pendingElementNameDraft.name}`;
    return `Naming: ${pendingElementLabel ?? pendingElementType}`;
  }, [pendingElementLabel, pendingElementNameDraft, pendingElementType, toolMode]);

  const hasStagedChanges = stagedElements.length > 0 || stagedRelationships.length > 0;
  const commitDisabled = !hasStagedChanges || !hasModelingAccess || commitContextLocked || !eaRepository;
  const iterativeModeling = designWorkspace.mode === 'ITERATIVE';
  const modeBadge = React.useMemo(() => {
    if (!hasModelingAccess) return { label: 'Read-only', color: 'default' as const };
    if (designWorkspace.status === 'DRAFT') return { label: 'Draft', color: 'gold' as const };
    return { label: 'Studio', color: 'blue' as const };
  }, [designWorkspace.status, hasModelingAccess]);
  const cyRef = React.useRef<Core | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [form] = Form.useForm<{ name: string; description?: string }>();
  const [freeShapeForm] = Form.useForm<{ label: string }>();
  const [workspaceForm] = Form.useForm<DesignWorkspaceForm>();
  const [viewSummaryForm] = Form.useForm<ViewSummaryForm>();
  const [quickCreateForm] = Form.useForm<QuickCreateForm>();
  const [bulkEditForm] = Form.useForm<BulkEditForm>();
  const [repoEndpointForm] = Form.useForm<{ repositoryElementId: string }>();
  const [relationshipAttributesForm] = Form.useForm<Record<string, string>>();
  const guidanceIgnoreStorageKey = React.useMemo(
    () => `ea.studio.guidance.ignore.${designWorkspace.id}`,
    [designWorkspace.id],
  );
  const designPromptIgnoreStorageKey = React.useMemo(
    () => `ea.studio.designPrompts.ignore.${designWorkspace.id}`,
    [designWorkspace.id],
  );
  const [ignoredGuidance, setIgnoredGuidance] = React.useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(guidanceIgnoreStorageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as string[];
      return Array.isArray(parsed) ? parsed.filter((m) => typeof m === 'string') : [];
    } catch {
      return [];
    }
  });
  const [ignoredDesignPrompts, setIgnoredDesignPrompts] = React.useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(designPromptIgnoreStorageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as string[];
      return Array.isArray(parsed) ? parsed.filter((m) => typeof m === 'string') : [];
    } catch {
      return [];
    }
  });

  const [workspaceModalOpen, setWorkspaceModalOpen] = React.useState(false);
  const [studioRightWidth, setStudioRightWidth] = React.useState<number>(() => {
    try {
      const raw = localStorage.getItem(rightPanelStorageKey);
      const parsed = raw ? Number(raw) : NaN;
      const maxWidth = getStudioRightPanelMaxWidth();
      if (Number.isFinite(parsed)) return Math.min(maxWidth, Math.max(STUDIO_RIGHT_PANEL_MIN_WIDTH, parsed));
    } catch {
      // Best-effort only.
    }
    return Math.min(getStudioRightPanelMaxWidth(), 360);
  });
  const studioRightRafRef = React.useRef<number | null>(null);
  const studioRightPendingRef = React.useRef<number | null>(null);
  const initialViewTabRef = React.useRef<StudioViewTab | null>(null);
  if (!initialViewTabRef.current && viewContext?.viewId) {
    const view = ViewStore.get(viewContext.viewId);
    initialViewTabRef.current = {
      key: createViewTabKey(viewContext.viewId),
      viewId: viewContext.viewId,
      name: view?.name ?? viewContext.viewId,
      readOnly: viewContext.readOnly,
    };
  }
  const [activeView, setActiveView] = React.useState<ViewInstance | null>(null);
  const [viewTabs, setViewTabs] = React.useState<StudioViewTab[]>(() => {
    if (!initialViewTabRef.current) return [];
    return [initialViewTabRef.current];
  });
  const [viewTabStateById, setViewTabStateById] = React.useState<Record<string, ViewTabState>>(() => {
    if (!initialViewTabRef.current) return {};
    const view = ViewStore.get(initialViewTabRef.current.viewId) ?? null;
    const positions = (view?.layoutMetadata as any)?.positions ?? {};
    const freeShapes = (view?.layoutMetadata as any)?.freeShapes ?? [];
    const freeConnectors = (view?.layoutMetadata as any)?.freeConnectors ?? [];
    return {
      [initialViewTabRef.current.key]: {
        viewId: initialViewTabRef.current.viewId,
        view,
        saveStatus: 'saved',
        lastSavedSignature: stableStringify({ positions, freeShapes, freeConnectors }),
      },
    };
  });
  const [activeTabKey, setActiveTabKey] = React.useState<string>(() =>
    initialViewTabRef.current?.key ?? WORKSPACE_TAB_KEY,
  );
  const [pendingExport, setPendingExport] = React.useState<{ viewId: string; format: 'png' | 'json' } | null>(null);
  const activeViewTab = React.useMemo(
    () => (activeTabKey === WORKSPACE_TAB_KEY ? null : viewTabs.find((tab) => tab.key === activeTabKey) ?? null),
    [activeTabKey, viewTabs],
  );
  const activeViewId = activeViewTab?.viewId ?? null;
  const activeViewState = React.useMemo(
    () => (activeTabKey && activeTabKey !== WORKSPACE_TAB_KEY ? viewTabStateById[activeTabKey] ?? null : null),
    [activeTabKey, viewTabStateById],
  );
  const viewSaveStatus = activeViewState?.saveStatus ?? 'saved';
  const activeViewName = React.useMemo(
    () => (activeView?.name ?? (activeViewId ? activeViewId : null)),
    [activeView, activeViewId],
  );
  const viewReadOnly = Boolean(activeViewTab?.readOnly ?? viewContext?.readOnly);
  const [studioModeLevel, setStudioModeLevel] = React.useState<StudioMode>('Model');
  const [presentationView, setPresentationView] = React.useState(false);
  React.useEffect(() => {
    if (activeTabKey === WORKSPACE_TAB_KEY) {
      setStudioModeLevel('Model');
      return;
    }
    if (activeViewId) {
      setStudioModeLevel('Explore');
    }
  }, [activeTabKey, activeViewId]);
  const canAnalyzeMode = studioModeLevel !== 'Explore' && !presentationView;
  const canDiagramMode = (studioModeLevel === 'Design' || studioModeLevel === 'Model') && !presentationView;
  const canModelMode = studioModeLevel === 'Model' && !presentationView;
  const presentationReadOnly = viewReadOnly || presentationView;
  const showToolbox = canDiagramMode;
  const toolboxInteractionDisabled = viewReadOnly || !canDiagramMode;
  const [toolboxCollapsed, setToolboxCollapsed] = React.useState(false);
  const [toolboxExpanded, setToolboxExpanded] = React.useState(false);
  const toolboxPrevWidthRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const summary = (activeView?.layoutMetadata as any)?.summary as ViewSummaryForm | undefined;
    viewSummaryForm.setFieldsValue({
      purpose: summary?.purpose ?? '',
      scope: summary?.scope ?? '',
      insights: summary?.insights ?? '',
    });
  }, [activeView, viewSummaryForm]);

  const saveViewSummary = React.useCallback(async () => {
    if (!activeView || presentationReadOnly) return;
    try {
      const values = await viewSummaryForm.validateFields();
      const next: ViewInstance = {
        ...activeView,
        layoutMetadata: {
          ...(activeView.layoutMetadata ?? {}),
          summary: {
            purpose: (values.purpose ?? '').trim(),
            scope: (values.scope ?? '').trim(),
            insights: (values.insights ?? '').trim(),
          },
        },
      };
      ViewStore.save(next);
      setActiveView(next);
      try {
        window.dispatchEvent(new Event('ea:viewsChanged'));
      } catch {
        // Best-effort only.
      }
      message.success('View summary updated.');
    } catch {
      // validation handled by Form
    }
  }, [activeView, presentationReadOnly, viewSummaryForm]);
  const isViewBoundWorkspace = Boolean(viewContext?.viewId);
  const viewBoundName = React.useMemo(() => {
    if (!isViewBoundWorkspace) return null;
    const view = viewContext?.viewId ? ViewStore.get(viewContext.viewId) : null;
    return (view?.name ?? activeViewName ?? viewContext?.viewId ?? '').trim() || null;
  }, [activeViewName, isViewBoundWorkspace, viewContext?.viewId]);
  const toggleToolboxExpanded = React.useCallback(() => {
    const maxWidth = getStudioRightPanelMaxWidth();
    setToolboxExpanded((prev) => {
      if (!prev) {
        toolboxPrevWidthRef.current = studioRightWidth;
        setStudioRightWidth(maxWidth);
        return true;
      }
      const fallback = toolboxPrevWidthRef.current ?? 360;
      const next = Math.min(maxWidth, Math.max(STUDIO_RIGHT_PANEL_MIN_WIDTH, fallback));
      setStudioRightWidth(next);
      toolboxPrevWidthRef.current = null;
      return false;
    });
  }, [studioRightWidth]);
  const workspaceDisplayName = React.useMemo(() => {
    const direct = (designWorkspace.name ?? '').trim();
    if (direct) return direct;
    if (viewBoundName) return viewBoundName;
    return 'Untitled Workspace';
  }, [designWorkspace.name, viewBoundName]);
  const [quickCreateOpen, setQuickCreateOpen] = React.useState(false);
  const [quickCreatePlacement, setQuickCreatePlacement] = React.useState<{ x: number; y: number } | null>(null);
  const [quickCreateType, setQuickCreateType] = React.useState<ObjectType | null>(null);
  const [bulkEditOpen, setBulkEditOpen] = React.useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = React.useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = React.useState<string | null>(null);
  const [selectedFreeShapeId, setSelectedFreeShapeId] = React.useState<string | null>(null);
  const [selectedFreeConnectorId, setSelectedFreeConnectorId] = React.useState<string | null>(null);
  const [freeShapes, setFreeShapes] = React.useState<FreeShape[]>([]);
  const [freeConnectors, setFreeConnectors] = React.useState<FreeConnector[]>([]);
  const [pendingFreeConnectorKind, setPendingFreeConnectorKind] = React.useState<FreeConnectorKind | null>(null);
  const [freeConnectorSourceId, setFreeConnectorSourceId] = React.useState<string | null>(null);
  const [nodeContextMenu, setNodeContextMenu] = React.useState<
    { x: number; y: number; nodeId: string } | null
  >(null);
  const [pendingChildCreation, setPendingChildCreation] = React.useState<
    { parentId: string; relationshipType: RelationshipType } | null
  >(null);
  const [validationGateOpen, setValidationGateOpen] = React.useState(false);
  const stagedInitRef = React.useRef(false);
  const relationshipLabelOverrides = React.useMemo<Partial<Record<RelationshipType, string>>>(
    () => ({
      SERVED_BY: 'Serves',
      USES: 'Uses',
      REALIZES: 'Realizes',
      DEPLOYED_ON: 'Deploys On',
      DEPENDS_ON: 'Depends On',
      INTEGRATES_WITH: 'Integrates With',
      CONNECTS_TO: 'Communicates With',
      REALIZED_BY: 'Realized By',
      EXPOSES: 'Exposes',
      PROVIDED_BY: 'Provided By',
      USED_BY: 'Used By',
      SUPPORTS: 'Supports',
      OWNS: 'Owns',
      HAS: 'Has',
      TRIGGERS: 'Triggers',
      COMPOSED_OF: 'Composed Of',
      DECOMPOSES_TO: 'Decomposes To',
      CONSUMES: 'Consumes',
      DELIVERS: 'Delivers',
      IMPLEMENTS: 'Implements',
      IMPACTS: 'Impacts',
    }),
    [],
  );
  const resolveRelationshipLabel = React.useCallback(
    (type: RelationshipType) => relationshipLabelOverrides[type] || type.replace(/_/g, ' '),
    [relationshipLabelOverrides],
  );
  type RelationshipStyle = 'directed' | 'dependency' | 'association' | 'flow';
  const RELATIONSHIP_STYLE_BY_TYPE: Partial<Record<RelationshipType, RelationshipStyle>> = {
    DEPENDS_ON: 'dependency',
    USES: 'dependency',
    INTEGRATES_WITH: 'association',
    CONNECTS_TO: 'association',
    OWNS: 'association',
    HAS: 'association',
    REALIZES: 'directed',
    REALIZED_BY: 'directed',
    SERVED_BY: 'directed',
    EXPOSES: 'directed',
    PROVIDED_BY: 'directed',
    USED_BY: 'directed',
    SUPPORTS: 'directed',
    DEPLOYED_ON: 'flow',
    TRIGGERS: 'flow',
    CONSUMES: 'flow',
    DECOMPOSES_TO: 'association',
    COMPOSED_OF: 'association',
    DELIVERS: 'flow',
    IMPLEMENTS: 'directed',
    IMPACTS: 'flow',
  };
  const relationshipStyleForType = React.useCallback(
    (type: RelationshipType): RelationshipStyle => RELATIONSHIP_STYLE_BY_TYPE[type] ?? 'directed',
    [],
  );
  const RELATIONSHIP_SHORT_LABELS: Partial<Record<RelationshipType, string>> = {
    SERVED_BY: 'S',
    USES: 'U',
    REALIZES: 'R',
    REALIZED_BY: 'RB',
    DEPLOYED_ON: 'D',
    CONNECTS_TO: 'C',
    INTEGRATES_WITH: 'I',
    OWNS: 'O',
    HAS: 'H',
    TRIGGERS: 'T',
    EXPOSES: 'E',
    PROVIDED_BY: 'P',
    USED_BY: 'UB',
    SUPPORTS: 'SP',
    DEPENDS_ON: 'DP',
    CONSUMES: 'CN',
    COMPOSED_OF: 'CO',
    DECOMPOSES_TO: 'DC',
    DELIVERS: 'DL',
    IMPLEMENTS: 'IM',
    IMPACTS: 'IA',
  };
  const buildRelationshipIcon = React.useCallback(
    (label: string, style: RelationshipStyle, variant: 'tool' | 'connector') => {
      const strokeDash = style === 'dependency' ? '4 2' : style === 'flow' ? '1 2' : '0';
      const arrow = style === 'association' ? '' : '<polygon points="12,4 15,8 12,12" fill="#434343"/>';
      const textSize = label.length > 2 ? 5 : 6.5;
      return buildSvgIcon(
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><line x1="2" y1="8" x2="12" y2="8" stroke="#434343" stroke-width="1.2" stroke-dasharray="${strokeDash}"/>${arrow}<text x="2" y="6" font-size="${textSize}" fill="#434343" font-family="Arial" font-weight="700">${label}</text>${variant === 'connector' ? '<circle cx="2" cy="8" r="1" fill="#434343"/>' : ''}</svg>`,
      );
    },
    [],
  );
  const resolveRelationshipIcon = React.useCallback(
    (type: RelationshipType, variant: 'tool' | 'connector') => {
      const shortLabel = RELATIONSHIP_SHORT_LABELS[type] || type.slice(0, 2);
      const style = relationshipStyleForType(type);
      return buildRelationshipIcon(shortLabel, style, variant);
    },
    [buildRelationshipIcon, relationshipStyleForType],
  );
  const ensureToolboxElementType = React.useCallback((type: ObjectType, label?: string, visualKind?: string | null) => {
    const visual = resolveEaVisualForElement({ type, visualKindOverride: visualKind ?? undefined });
    if (!visual || !visual.icon || !visual.shape) {
      message.error(
        `Toolbox item "${label ?? type}" is missing an EA Shape Registry SVG mapping (ArchiMate/drawio).`,
      );
      return null;
    }
    return visual;
  }, []);
  const ensureToolboxRelationshipType = React.useCallback((type: RelationshipType, label?: string) => {
    if (!RELATIONSHIP_TYPE_DEFINITIONS[type]) {
      message.error(`Toolbox item "${label ?? type}" is not yet wired to the canvas (missing relationship mapping).`);
      return false;
    }
    return true;
  }, []);
  const studioHeaderRef = React.useRef<HTMLDivElement | null>(null);
  const studioLeftRef = React.useRef<HTMLDivElement | null>(null);
  const studioRightRef = React.useRef<HTMLDivElement | null>(null);
  const [placementModeActive, setPlacementModeActive] = React.useState(false);
  const [placementGuide, setPlacementGuide] = React.useState<{ x: number; y: number } | null>(null);
  const [createHintPos, setCreateHintPos] = React.useState<{ x: number; y: number } | null>(null);
  const [elementDragAnchor, setElementDragAnchor] = React.useState<{ x: number; y: number } | null>(null);
  const [elementDragGhost, setElementDragGhost] = React.useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [elementDragActive, setElementDragActive] = React.useState(false);
  const beginStudioRightResize: React.MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = studioRightWidth;

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const maxWidth = getStudioRightPanelMaxWidth();
      const next = Math.max(STUDIO_RIGHT_PANEL_MIN_WIDTH, Math.min(maxWidth, startWidth + delta));
      studioRightPendingRef.current = next;
      if (studioRightRafRef.current !== null) return;
      studioRightRafRef.current = window.requestAnimationFrame(() => {
        studioRightRafRef.current = null;
        if (studioRightPendingRef.current !== null) {
          setStudioRightWidth(studioRightPendingRef.current);
        }
      });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  React.useEffect(() => {
    onRequestCloseViewSwitch?.();
    setRightPanelMode(RightPanelMode.STUDIO);
    setLastNonSwitchMode(RightPanelMode.STUDIO);
  }, [activeTabKey, onRequestCloseViewSwitch]);

  React.useEffect(() => {
    if (!activeViewId) return;
    onRequestCloseViewSwitch?.();
    setRightPanelMode(RightPanelMode.STUDIO);
    setLastNonSwitchMode(RightPanelMode.STUDIO);
  }, [activeViewId, onRequestCloseViewSwitch]);

  const ensureViewTabState = React.useCallback(
    (tabKey: string, viewId: string, view?: ViewInstance | null, opts?: { force?: boolean }) => {
      if (!tabKey || !viewId) return;
      setViewTabStateById((prev) => {
        if (!opts?.force && prev[tabKey]) return prev;
        const resolved = view ?? ViewStore.get(viewId) ?? null;
        const positions = (resolved?.layoutMetadata as any)?.positions ?? {};
        const freeShapes = (resolved?.layoutMetadata as any)?.freeShapes ?? [];
        const freeConnectors = (resolved?.layoutMetadata as any)?.freeConnectors ?? [];
        return {
          ...prev,
          [tabKey]: {
            viewId,
            view: resolved,
            saveStatus: 'saved',
            lastSavedSignature: stableStringify({ positions, freeShapes, freeConnectors }),
          },
        };
      });
    },
    [],
  );

  const ensureViewTab = React.useCallback(
    (viewId: string, opts?: { readOnly?: boolean; mode?: 'new' | 'replace' | 'existing' }) => {
      if (!viewId) return;
      const resolved = ViewStore.get(viewId) ?? null;
      const name = resolved?.name ?? viewId;
      const mode = opts?.mode ?? 'new';
      let effectiveMode = mode;

      if (mode === 'replace' && activeTabKey !== WORKSPACE_TAB_KEY) {
        const activeState = viewTabStateById[activeTabKey];
        if (activeState?.saveStatus === 'dirty' || activeState?.saveStatus === 'saving') {
          message.warning('Current tab has unsaved changes. Opened a new tab instead.');
          effectiveMode = 'new';
        }
      }

      if (effectiveMode === 'existing') {
        const existing = viewTabs.find((tab) => tab.viewId === viewId) ?? null;
        if (existing) {
          setViewTabs((prev) =>
            prev.map((tab) =>
              tab.key === existing.key ? { ...tab, name, readOnly: opts?.readOnly } : tab,
            ),
          );
          ensureViewTabState(existing.key, viewId, resolved);
          setActiveTabKey(existing.key);
          return;
        }
      }

      if (effectiveMode === 'replace' && activeTabKey !== WORKSPACE_TAB_KEY) {
        const targetKey = activeTabKey;
        setViewTabs((prev) =>
          prev.map((tab) =>
            tab.key === targetKey ? { ...tab, viewId, name, readOnly: opts?.readOnly } : tab,
          ),
        );
        ensureViewTabState(targetKey, viewId, resolved, { force: true });
        setActiveTabKey(targetKey);
        return;
      }

      const tabKey = createViewTabKey(viewId);
      setViewTabs((prev) => [...prev, { key: tabKey, viewId, name, readOnly: opts?.readOnly }]);
      ensureViewTabState(tabKey, viewId, resolved, { force: true });
      setActiveTabKey(tabKey);
    },
    [activeTabKey, ensureViewTabState, viewTabStateById, viewTabs],
  );

  const closeViewTab = React.useCallback(
    (tabKey: string) => {
      setViewTabs((prev) => {
        const next = prev.filter((tab) => tab.key !== tabKey);
        if (activeTabKey === tabKey) {
          const fallback = next[next.length - 1]?.key ?? WORKSPACE_TAB_KEY;
          setActiveTabKey(fallback);
        }
        return next;
      });
      setViewTabStateById((prev) => {
        if (!prev[tabKey]) return prev;
        const { [tabKey]: _removed, ...rest } = prev;
        return rest;
      });
    },
    [activeTabKey],
  );

  React.useEffect(() => {
    if (!viewContext?.viewId) return;
    ensureViewTab(viewContext.viewId, { readOnly: viewContext.readOnly, mode: 'existing' });
  }, [ensureViewTab, viewContext?.readOnly, viewContext?.viewId]);

  React.useEffect(() => {
    setViewTabStateById((prev) => {
      let nextState = prev;
      viewTabs.forEach((tab) => {
        const view = ViewStore.get(tab.viewId) ?? null;
        const existing = nextState[tab.key];
        if (existing && existing.view === view) return;
        const positions = (view?.layoutMetadata as any)?.positions ?? {};
        const freeShapes = (view?.layoutMetadata as any)?.freeShapes ?? [];
        const freeConnectors = (view?.layoutMetadata as any)?.freeConnectors ?? [];
        const nextEntry: ViewTabState = {
          viewId: tab.viewId,
          view,
          saveStatus: existing?.saveStatus ?? 'saved',
          lastSavedSignature: existing?.lastSavedSignature ?? stableStringify({ positions, freeShapes, freeConnectors }),
        };
        nextState = nextState === prev ? { ...prev } : nextState;
        nextState[tab.key] = nextEntry;
      });
      return nextState;
    });
  }, [viewTabs]);

  React.useEffect(() => {
    const refreshTabs = () => {
      setViewTabs((prev) =>
        prev.map((tab) => {
          const view = ViewStore.get(tab.viewId);
          if (!view?.name || view.name === tab.name) return tab;
          return { ...tab, name: view.name };
        }),
      );
      setViewTabStateById((prev) => {
        let nextState = prev;
        Object.keys(prev).forEach((id) => {
          const existing = nextState[id];
          if (!existing) return;
          const view = ViewStore.get(existing.viewId) ?? null;
          if (existing && existing.view === view) return;
          const positions = (view?.layoutMetadata as any)?.positions ?? {};
          const freeShapes = (view?.layoutMetadata as any)?.freeShapes ?? [];
          const freeConnectors = (view?.layoutMetadata as any)?.freeConnectors ?? [];
          const nextEntry: ViewTabState = {
            viewId: existing.viewId,
            view,
            saveStatus: existing?.saveStatus ?? 'saved',
            lastSavedSignature: existing?.lastSavedSignature ?? stableStringify({ positions, freeShapes, freeConnectors }),
          };
          nextState = nextState === prev ? { ...prev } : nextState;
          nextState[id] = nextEntry;
        });
        return nextState;
      });
    };

    window.addEventListener('ea:viewsChanged', refreshTabs);
    return () => window.removeEventListener('ea:viewsChanged', refreshTabs);
  }, []);

  React.useEffect(() => {
    const onStudioViewOpen = (event: Event) => {
      const e = event as CustomEvent<{ viewId?: string; readOnly?: boolean; openMode?: 'new' | 'replace' | 'existing' }>;
      const viewId = (e.detail?.viewId ?? '').trim();
      if (!viewId) return;
      ensureViewTab(viewId, { readOnly: e.detail?.readOnly, mode: e.detail?.openMode ?? 'new' });
    };

    const onStudioViewExport = (event: Event) => {
      const e = event as CustomEvent<{ viewId?: string; format?: 'png' | 'json' }>;
      const viewId = (e.detail?.viewId ?? '').trim();
      if (!viewId) return;
      const format = e.detail?.format ?? 'json';
      ensureViewTab(viewId, { mode: 'existing' });
      setPendingExport({ viewId, format });
    };

    window.addEventListener('ea:studio.view.open', onStudioViewOpen as EventListener);
    window.addEventListener('ea:studio.view.export', onStudioViewExport as EventListener);
    return () => {
      window.removeEventListener('ea:studio.view.open', onStudioViewOpen as EventListener);
      window.removeEventListener('ea:studio.view.export', onStudioViewExport as EventListener);
    };
  }, [ensureViewTab]);

  React.useEffect(() => {
    if (!pendingExport) return;
    if (activeViewId !== pendingExport.viewId) return;
    if (!activeView) return;
    const format = pendingExport.format;
    if (format === 'json') {
      const positions = layoutPositionsForView(activeView);
      downloadJson(`${activeView.name || activeView.id}.json`, {
        view: activeView,
        layoutPositions: positions,
      });
      setPendingExport(null);
      return;
    }

    if (!cyRef.current) {
      message.error('Failed to export PNG.');
      setPendingExport(null);
      return;
    }
    try {
      const dataUrl = cyRef.current.png({ bg: '#ffffff', full: true });
      downloadDataUrl(`${activeView.name || activeView.id}.png`, dataUrl);
    } catch {
      message.error('Failed to export PNG.');
    }
    setPendingExport(null);
  }, [activeView, activeViewId, pendingExport]);

  React.useEffect(() => {
    if (!activeViewId || activeTabKey === WORKSPACE_TAB_KEY) {
      setActiveView(null);
      return;
    }

    const refresh = () => {
      const next = ViewStore.get(activeViewId) ?? null;
      setActiveView(next);
      setViewTabStateById((prev) => {
        const existing = prev[activeTabKey];
        if (existing?.view === next) return prev;
        const positions = (next?.layoutMetadata as any)?.positions ?? {};
        const freeShapes = (next?.layoutMetadata as any)?.freeShapes ?? [];
        const freeConnectors = (next?.layoutMetadata as any)?.freeConnectors ?? [];
        return {
          ...prev,
          [activeTabKey]: {
            viewId: activeViewId,
            view: next,
            saveStatus: existing?.saveStatus ?? 'saved',
            lastSavedSignature: existing?.lastSavedSignature ?? stableStringify({ positions, freeShapes, freeConnectors }),
          },
        };
      });
    };

    refresh();
    window.addEventListener('ea:viewsChanged', refresh);
    return () => window.removeEventListener('ea:viewsChanged', refresh);
  }, [activeTabKey, activeViewId]);

  React.useEffect(() => {
    if (activeTabKey !== WORKSPACE_TAB_KEY && !viewTabs.some((tab) => tab.key === activeTabKey)) {
      setActiveTabKey(viewTabs[viewTabs.length - 1]?.key ?? WORKSPACE_TAB_KEY);
    }
  }, [activeTabKey, viewTabs]);
  const elementDragMovedRef = React.useRef(false);
  const suppressNextTapRef = React.useRef(false);
  const draggingRef = React.useRef(false);
  const connectionPointerIdRef = React.useRef<number | null>(null);
  const connectionPointerActiveRef = React.useRef(false);
  const connectionDragLockRef = React.useRef(false);
  const [connectionDragLocked, setConnectionDragLocked] = React.useState(false);
  const connectionDragPositionsRef = React.useRef<Map<string, { x: number; y: number }>>(new Map());
  const draftAnchorPosRef = React.useRef<{ x: number; y: number } | null>(null);
  const draftTargetIdRef = React.useRef<string | null>(null);
  const toolModeRef = React.useRef<StudioToolMode>('SELECT');
  const relationshipEligibilityRef = React.useRef<Map<string, Set<string>>>(new Map());
  const [alignmentGuides, setAlignmentGuides] = React.useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });
  const [commitOpen, setCommitOpen] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [repoEndpointOpen, setRepoEndpointOpen] = React.useState(false);
  const [repoEndpointMode, setRepoEndpointMode] = React.useState<'source' | 'target'>('target');
  const [toolMode, setToolMode] = React.useState<StudioToolMode>('SELECT');
  const [lastAutoSaveAt, setLastAutoSaveAt] = React.useState<string | null>(null);
  const [isLargeGraph, setIsLargeGraph] = React.useState(false);
  const dragThrottleRef = React.useRef(0);
  const [relationshipDraft, setRelationshipDraft] = React.useState<{
    sourceId: string | null;
    targetId: string | null;
    valid: boolean | null;
    message: string | null;
    dragging: boolean;
  }>({
    sourceId: null,
    targetId: null,
    valid: null,
    message: null,
    dragging: false,
  });
  const relationshipDraftRef = React.useRef(relationshipDraft);
  const freeConnectorDragRef = React.useRef<{ sourceId: string | null; dragging: boolean }>({
    sourceId: null,
    dragging: false,
  });
  const freeConnectorSourceIdRef = React.useRef<string | null>(null);
  const pendingRelationshipTypeRef = React.useRef<RelationshipType | null>(null);
  const pendingFreeConnectorKindRef = React.useRef<FreeConnectorKind | null>(null);
  const suppressConnectionTapRef = React.useRef(false);

  const updateRelationshipDraft = React.useCallback((next: {
    sourceId: string | null;
    targetId: string | null;
    valid: boolean | null;
    message: string | null;
    dragging: boolean;
  }) => {
    relationshipDraftRef.current = next;
    setRelationshipDraft(next);
  }, []);

  React.useEffect(() => {
    relationshipDraftRef.current = relationshipDraft;
  }, [relationshipDraft]);

  React.useEffect(() => {
    freeConnectorSourceIdRef.current = freeConnectorSourceId;
  }, [freeConnectorSourceId]);

  React.useEffect(() => {
    pendingRelationshipTypeRef.current = pendingRelationshipType;
  }, [pendingRelationshipType]);

  React.useEffect(() => {
    toolModeRef.current = toolMode;
  }, [toolMode]);

  React.useEffect(() => {
    pendingFreeConnectorKindRef.current = pendingFreeConnectorKind;
  }, [pendingFreeConnectorKind]);

  const [layerVisibility, setLayerVisibility] = React.useState<{
    Business: boolean;
    Application: boolean;
    Technology: boolean;
    'Implementation & Migration': boolean;
    Governance: boolean;
  }>({
    Business: true,
    Application: true,
    Technology: true,
    'Implementation & Migration': true,
    Governance: true,
  });
  const [gridSize, setGridSize] = React.useState(GRID_SIZE);
  const [snapTemporarilyDisabled, setSnapTemporarilyDisabled] = React.useState(false);

  const snapToGridCenter = React.useCallback(
    (pos: { x: number; y: number }) => {
      const size = Math.max(4, Math.round(gridSize));
      return {
        x: Math.round(pos.x / size) * size,
        y: Math.round(pos.y / size) * size,
      };
    },
    [gridSize],
  );

  const [pendingElementType, setPendingElementType] = React.useState<ObjectType | null>(null);
  const [pendingElementVisualKind, setPendingElementVisualKind] = React.useState<string | null>(null);
  const [placement, setPlacement] = React.useState<{ x: number; y: number } | null>(null);
  const [createModalOpen, setCreateModalOpen] = React.useState(false);
  const [pendingRelationshipType, setPendingRelationshipType] = React.useState<RelationshipType | null>(null);
  const [relationshipSourceId, setRelationshipSourceId] = React.useState<string | null>(null);
  const [relationshipTargetId, setRelationshipTargetId] = React.useState<string | null>(null);
  const [auditPreviewOpen, setAuditPreviewOpen] = React.useState(false);
  const [propertiesExpanded, setPropertiesExpanded] = React.useState(false);
  const [pendingElementDraft, setPendingElementDraft] = React.useState<
    | {
        type: ObjectType;
        name: string;
        description: string;
        placement: { x: number; y: number } | null;
        visualKind?: string | null;
      }
    | null
  >(null);
  const [pendingElementNameDraft, setPendingElementNameDraft] = React.useState<
    | {
        type: ObjectType;
        name: string;
        description: string;
        visualKind?: string | null;
      }
    | null
  >(null);
  const [pendingFreeShapeDraft, setPendingFreeShapeDraft] = React.useState<
    | {
        id: string;
        kind: FreeShapeKind;
      }
    | null
  >(null);
  const [freeShapeModalOpen, setFreeShapeModalOpen] = React.useState(false);


  const handleOpenProperties = React.useCallback(() => {
    propertiesOverrideRef.current = true;
    onRequestProperties?.();
    setRightPanelMode(RightPanelMode.SELECTION);
    setPropertiesExpanded(true);
  }, [onRequestProperties]);

  const closeRightPanel = React.useCallback(() => {
    onRequestCloseViewSwitch?.();
    setRightPanelMode(RightPanelMode.STUDIO);
    setLastNonSwitchMode(RightPanelMode.STUDIO);
  }, [onRequestCloseViewSwitch]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (rightPanelMode === RightPanelMode.STUDIO) return;
      event.preventDefault();
      closeRightPanel();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeRightPanel, rightPanelMode]);

  const activeViewpoint = React.useMemo(() => {
    const view = activeView ?? (viewContext?.viewId ? ViewStore.get(viewContext.viewId) : null);
    if (!view) return null;
    return ViewpointRegistry.get(view.viewpointId) ?? null;
  }, [activeView, viewContext?.viewId]);

  const paletteElementTypes = React.useMemo(() => {
    const seen = new Set<ObjectType>();
    return EA_VISUALS.map((visual) => visual.type).filter((type) => {
      if (seen.has(type)) return false;
      seen.add(type);
      return Boolean(OBJECT_TYPE_DEFINITIONS[type]);
    });
  }, []);

  const frameworkFilteredElementTypes = React.useMemo(() => {
    if (!metadata) return paletteElementTypes;
    return paletteElementTypes.filter((type) => {
      if (!isObjectTypeAllowedForReferenceFramework(metadata.referenceFramework, type)) return false;
      if (metadata.referenceFramework === 'Custom') {
        if (!isCustomFrameworkModelingEnabled('Custom', metadata.frameworkConfig ?? undefined)) return false;
        return isObjectTypeEnabledForFramework('Custom', metadata.frameworkConfig ?? undefined, type);
      }
      return true;
    });
  }, [metadata, paletteElementTypes]);

  const visiblePaletteElementTypes = React.useMemo(() => {
    return frameworkFilteredElementTypes.filter((type) => {
      const def = OBJECT_TYPE_DEFINITIONS[type];
      if (!def) return false;
      return layerVisibility[def.layer] !== false;
    });
  }, [frameworkFilteredElementTypes, layerVisibility]);

  const toolboxComponentItems = React.useMemo(() => {
    const allowedTypeSet = new Set(visiblePaletteElementTypes);
    return EA_VISUALS.filter((visual) => visual.layer !== 'Technology' && allowedTypeSet.has(visual.type));
  }, [visiblePaletteElementTypes]);

  const toolboxTechnologyItems = React.useMemo(() => {
    const allowedTypeSet = new Set(visiblePaletteElementTypes);
    return EA_VISUALS.filter((visual) => visual.layer === 'Technology' && allowedTypeSet.has(visual.type));
  }, [visiblePaletteElementTypes]);

  const paletteRelationships = React.useMemo(() => {
    const allowed = EA_CONNECTOR_REGISTRY.map((entry) => entry.type) as RelationshipType[];
    const visibleElementSet = new Set(visiblePaletteElementTypes);
    return allowed
      .map((type) => RELATIONSHIP_TYPE_DEFINITIONS[type])
      .filter(Boolean)
      .filter((relDef) => {
        if (!relDef) return false;
        if (layerVisibility[relDef.layer] === false) return false;
        const pairs = relDef.allowedEndpointPairs ?? [];
        if (Array.isArray(pairs) && pairs.length > 0) {
          return pairs.some((pair) => visibleElementSet.has(pair.from) && visibleElementSet.has(pair.to));
        }
        return (
          relDef.fromTypes.some((from) => visibleElementSet.has(from)) &&
          relDef.toTypes.some((to) => visibleElementSet.has(to))
        );
      });
  }, [layerVisibility, visiblePaletteElementTypes]);

  const visualByType = React.useMemo(() => {
    return new Map(EA_VISUALS.map((entry) => [entry.type, entry] as const));
  }, []);

  const renderTypeIcon = React.useCallback(
    (type?: ObjectType | null) => {
      if (!type) {
        return (
          <span className={styles.studioTypeIcon} style={{ background: '#d9d9d9' }}>
            ?
          </span>
        );
      }
      const visual = visualByType.get(type as any);
      if (visual?.icon) {
        return <img src={visual.icon} alt={type} width={16} height={16} />;
      }
      const layer = OBJECT_TYPE_DEFINITIONS[type]?.layer;
      const layerColor: Record<string, string> = {
        Business: '#95de64',
        Application: '#69b1ff',
        Technology: '#ffd666',
        'Implementation & Migration': '#ff9c6e',
        Governance: '#b37feb',
      };
      const bg = layer ? layerColor[layer] : '#d9d9d9';
      return (
        <span className={styles.studioTypeIcon} style={{ background: bg }}>
          {type.charAt(0).toUpperCase()}
        </span>
      );
    },
    [visualByType],
  );

  const applyLayerVisibility = React.useCallback(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const elementType = node.data('elementType') as ObjectType | undefined;
        const layer = elementType ? OBJECT_TYPE_DEFINITIONS[elementType]?.layer : null;
        const visible = layer ? layerVisibility[layer] !== false : true;
        node.toggleClass('layerHidden', !visible);
      });

      cy.edges().forEach((edge) => {
        const sourceHidden = edge.source().hasClass('layerHidden');
        const targetHidden = edge.target().hasClass('layerHidden');
        edge.toggleClass('layerHidden', sourceHidden || targetHidden);
      });
    });
  }, [layerVisibility]);


  const workspaceStatusColor: Record<DesignWorkspaceStatus, string> = {
    DRAFT: 'gold',
    COMMITTED: 'green',
    DISCARDED: 'red',
  };

  const stagedElementById = React.useMemo(() => {
    return new Map(stagedElements.map((e) => [e.id, e] as const));
  }, [stagedElements]);

  const requiredElementAttributes = React.useCallback((type: ObjectType): string[] => {
    const def = OBJECT_TYPE_DEFINITIONS[type];
    if (!def || def.layer !== 'Technology') return [];
    return def.attributes.filter((attr) => attr !== 'name' && attr !== 'description');
  }, []);

  const validateStudioElementType = React.useCallback(
    (type: ObjectType): boolean => {
      if (!OBJECT_TYPE_DEFINITIONS[type]) {
        message.error(`Element type "${type}" is not allowed in Studio.`);
        return false;
      }

      if (!metadata) {
        message.error('Repository metadata is not available.');
        return false;
      }

      if (metadata.referenceFramework === 'Custom') {
        if (!isCustomFrameworkModelingEnabled('Custom', metadata.frameworkConfig ?? undefined)) {
          message.warning('Custom framework: define at least one element type in Metamodel to enable modeling.');
          return false;
        }

        if (!isObjectTypeEnabledForFramework('Custom', metadata.frameworkConfig ?? undefined, type)) {
          message.warning(`Custom framework: element type "${type}" is not enabled.`);
          return false;
        }
      }

      if (!isObjectTypeAllowedForReferenceFramework(metadata.referenceFramework, type)) {
        message.warning(`Type "${type}" is not enabled for the selected Reference Framework.`);
        return false;
      }

      if (!hasRegisteredEaShape(type)) {
        message.error(`EA Shape Registry mapping is missing for element type "${type}". Creation is blocked.`);
        return false;
      }

      const lifecycleGuard = canCreateObjectTypeForLifecycleCoverage(metadata.lifecycleCoverage, type);
      if (!lifecycleGuard.ok) {
        message.warning(lifecycleGuard.reason);
        return false;
      }

      return true;
    },
    [metadata],
  );

  const toCanvasPosition = React.useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current || !cyRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const renderedX = clientX - rect.left;
    const renderedY = clientY - rect.top;
    const pan = cyRef.current.pan();
    const zoom = cyRef.current.zoom();
    return {
      x: (renderedX - pan.x) / zoom,
      y: (renderedY - pan.y) / zoom,
    };
  }, []);

  const findNodeAtPosition = React.useCallback((pos: { x: number; y: number }) => {
    if (!cyRef.current) return null;
    const cy = cyRef.current;
    const nodes = cy.nodes().filter((n) => {
      if (n.data('draftTarget')) return false;
      const bb = n.boundingBox({ includeNodes: true, includeLabels: false, includeShadows: false });
      return pos.x >= bb.x1 && pos.x <= bb.x2 && pos.y >= bb.y1 && pos.y <= bb.y2;
    });
    return nodes.length ? nodes[0] : null;
  }, []);


  const getCanvasCenterPosition = React.useCallback(() => {
    if (!containerRef.current || !cyRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    return toCanvasPosition(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [toCanvasPosition]);

  const addFreeShape = React.useCallback(
    (kind: FreeShapeKind, position: { x: number; y: number }, labelOverride?: string) => {
      const def = FREE_SHAPE_DEFINITIONS.find((shape) => shape.kind === kind);
      if (!def) return null;
      const id = `free-shape-${generateUUID()}`;
      const nextShape: FreeShape = {
        id,
        kind: def.kind,
        label: labelOverride ?? '',
        x: position.x,
        y: position.y,
        width: def.width,
        height: def.height,
      };
      setFreeShapes((prev) => [...prev, nextShape]);
      if (cyRef.current) {
        cyRef.current.add({
          data: {
            id,
            label: nextShape.label,
            freeShape: true,
            freeShapeKind: nextShape.kind,
            width: nextShape.width,
            height: nextShape.height,
            shape: def.shape,
          },
          position: { x: position.x, y: position.y },
        });
        const node = cyRef.current.getElementById(id);
        if (node && !node.empty()) {
          node.grabbable(!viewReadOnly);
          node.select();
        }
      }
      setSelectedFreeShapeId(id);
      return id;
    },
    [viewReadOnly],
  );

  const openFreeShapeCreate = React.useCallback(
    (kind: FreeShapeKind, position: { x: number; y: number }) => {
      const id = addFreeShape(kind, position, '');
      if (!id) return;
      setPendingFreeShapeDraft({ id, kind });
      freeShapeForm.setFieldsValue({ label: '' });
      setFreeShapeModalOpen(true);
    },
    [addFreeShape, freeShapeForm],
  );

  const updateFreeShape = React.useCallback((id: string, patch: Partial<FreeShape>) => {
    setFreeShapes((prev) =>
      prev.map((shape) => (shape.id === id ? { ...shape, ...patch } : shape)),
    );
    if (!cyRef.current) return;
    const node = cyRef.current.getElementById(id);
    if (!node || node.empty()) return;
    if (typeof patch.label === 'string') node.data('label', patch.label);
    if (typeof patch.width === 'number') node.data('width', patch.width);
    if (typeof patch.height === 'number') node.data('height', patch.height);
  }, []);

  const currentRepositoryUpdatedAt = React.useMemo(() => {
    try {
      const raw = localStorage.getItem(REPO_SNAPSHOT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { updatedAt?: string };
      return typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null;
    } catch {
      return null;
    }
  }, []);

  const governanceMode = metadata?.governanceMode ?? 'Advisory';

  const resolveElementLabel = React.useCallback(
    (id: string): { label: string; type: ObjectType } | null => {
      const staged = stagedElementById.get(id);
      if (staged) return { label: staged.name || id, type: staged.type };
      const repoObj = eaRepository?.objects.get(id);
      if (!repoObj) return null;
      const name = (repoObj.attributes as any)?.name;
      const label = typeof name === 'string' && name.trim() ? name.trim() : id;
      return { label, type: repoObj.type };
    },
    [eaRepository, stagedElementById],
  );

  const hierarchyRelationshipType = React.useMemo<RelationshipType | null>(() => {
    if (!activeViewpoint?.allowedRelationshipTypes?.length) return null;
    if (activeViewpoint.allowedRelationshipTypes.includes('DECOMPOSES_TO')) return 'DECOMPOSES_TO';
    if (activeViewpoint.allowedRelationshipTypes.includes('COMPOSED_OF')) return 'COMPOSED_OF';
    return null;
  }, [activeViewpoint]);

  const isHierarchicalView = Boolean(hierarchyRelationshipType);

  const quickCreateTypeOptions = React.useMemo(() => {
    const baseTypes = [...visiblePaletteElementTypes];
    const seen = new Set<ObjectType>();
    return baseTypes
      .filter((type) => {
        if (seen.has(type)) return false;
        seen.add(type);
        return Boolean(OBJECT_TYPE_DEFINITIONS[type]);
      })
      .map((type) => ({ value: type, label: type }));
  }, [visiblePaletteElementTypes]);

  const resolveChildCreationSpec = React.useCallback(
    (parentType: ObjectType | null): { relationshipType: RelationshipType; childType: ObjectType } | null => {
      if (!parentType) return null;
      if (!hierarchyRelationshipType) return null;
      const relDef = RELATIONSHIP_TYPE_DEFINITIONS[hierarchyRelationshipType];
      if (!relDef) return null;
      const parentDef = OBJECT_TYPE_DEFINITIONS[parentType];
      if (!parentDef?.allowedOutgoingRelationships?.includes(hierarchyRelationshipType)) return null;

      const allowedByView = (activeViewpoint?.allowedElementTypes ?? []) as ObjectType[];
      const candidateTypes = (() => {
        const pairs = relDef.allowedEndpointPairs ?? [];
        if (Array.isArray(pairs) && pairs.length > 0) {
          return pairs.filter((p) => p.from === parentType).map((p) => p.to as ObjectType);
        }
        if (!relDef.fromTypes.includes(parentType)) return [] as ObjectType[];
        return relDef.toTypes as ObjectType[];
      })();

      const filtered = candidateTypes.filter((type) => allowedByView.length === 0 || allowedByView.includes(type));
      const preferredByParent: Partial<Record<ObjectType, ObjectType>> = {
        CapabilityCategory: 'Capability',
        Capability: 'SubCapability',
      };
      const preferred = preferredByParent[parentType];
      if (preferred && filtered.includes(preferred)) {
        return { relationshipType: hierarchyRelationshipType, childType: preferred };
      }
      if (filtered.length > 0) {
        return { relationshipType: hierarchyRelationshipType, childType: filtered[0] };
      }
      if (allowedByView.length > 0) {
        const fallback = allowedByView.find((type) => type !== parentType) ?? allowedByView[0];
        if (fallback) return { relationshipType: hierarchyRelationshipType, childType: fallback };
      }
      return null;
    },
    [activeViewpoint?.allowedElementTypes, hierarchyRelationshipType],
  );

  const childPlacementForParent = React.useCallback(
    (parentId: string) => {
      if (!cyRef.current) return getCanvasCenter();
      const node = cyRef.current.getElementById(parentId);
      if (node && !node.empty()) {
        const pos = node.position();
        return { x: pos.x + 180, y: pos.y + 120 };
      }
      return getCanvasCenter();
    },
    [getCanvasCenter],
  );

  const selectedStagedElements = React.useMemo(() => {
    if (selectedNodeIds.length === 0) return [] as DesignWorkspaceStagedElement[];
    const selectedSet = new Set(selectedNodeIds);
    return stagedElements.filter((e) => selectedSet.has(e.id));
  }, [selectedNodeIds, stagedElements]);

  const stagedSelectedElement = React.useMemo(() => {
    if (selectedStagedElements.length !== 1) return null;
    return selectedStagedElements[0];
  }, [selectedStagedElements]);

  const stagedSelectedRelationship = React.useMemo(() => {
    if (!selectedEdgeId) return null;
    return stagedRelationships.find((r) => r.id === selectedEdgeId) ?? null;
  }, [selectedEdgeId, stagedRelationships]);

  const stagedSelectedElementExistsInRepo = React.useMemo(() => {
    if (!stagedSelectedElement || !eaRepository) return false;
    return eaRepository.objects.has(stagedSelectedElement.id);
  }, [eaRepository, stagedSelectedElement]);

  const stagedSelectedRelationshipExistsInRepo = React.useMemo(() => {
    if (!stagedSelectedRelationship || !eaRepository) return false;
    return Boolean(
      eaRepository.relationships.find((rel) =>
        rel.id === stagedSelectedRelationship.id ||
        (rel.fromId === stagedSelectedRelationship.fromId &&
          rel.toId === stagedSelectedRelationship.toId &&
          rel.type === stagedSelectedRelationship.type),
      ),
    );
  }, [eaRepository, stagedSelectedRelationship]);

  const selectedNodeId = React.useMemo(
    () => (selectedNodeIds.length === 1 ? selectedNodeIds[0] : null),
    [selectedNodeIds],
  );

  const selectedNodeType = React.useMemo(() => {
    if (!selectedNodeId) return null;
    return resolveElementLabel(selectedNodeId)?.type ?? null;
  }, [resolveElementLabel, selectedNodeId]);

  const selectedChildCreationSpec = React.useMemo(() => {
    if (!selectedNodeType) return null;
    return resolveChildCreationSpec(selectedNodeType);
  }, [resolveChildCreationSpec, selectedNodeType]);

  const canAddChild = Boolean(
    activeViewId &&
    activeTabKey !== WORKSPACE_TAB_KEY &&
    selectedNodeId &&
    selectedChildCreationSpec &&
    canDiagramMode &&
    !viewReadOnly &&
    designWorkspace.status === 'DRAFT',
  );

  const canContextMenuDecompose = React.useMemo(() => {
    if (!nodeContextMenu?.nodeId) return false;
    if (!activeViewId || activeTabKey === WORKSPACE_TAB_KEY) return false;
    if (!canDiagramMode) return false;
    if (viewReadOnly || designWorkspace.status !== 'DRAFT') return false;
    const nodeType = resolveElementLabel(nodeContextMenu.nodeId)?.type ?? null;
    return Boolean(nodeType && resolveChildCreationSpec(nodeType));
  }, [activeTabKey, activeViewId, canDiagramMode, designWorkspace.status, nodeContextMenu?.nodeId, resolveChildCreationSpec, resolveElementLabel, viewReadOnly]);

  const selectedExistingElement = React.useMemo(() => {
    if (!iterativeModeling || !selectedNodeId) return null;
    if (stagedElementById.has(selectedNodeId)) return null;
    return eaRepository?.objects.get(selectedNodeId) ?? null;
  }, [eaRepository, iterativeModeling, selectedNodeId, stagedElementById]);

  const selectedFreeShape = React.useMemo(() => {
    if (!selectedFreeShapeId) return null;
    return freeShapes.find((shape) => shape.id === selectedFreeShapeId) ?? null;
  }, [freeShapes, selectedFreeShapeId]);

  const compactSelectedElement = React.useMemo(() => {
    if (stagedSelectedElement) {
      return {
        name: stagedSelectedElement.name || stagedSelectedElement.id,
        type: stagedSelectedElement.type,
      };
    }
    if (selectedExistingElement) {
      const name = (selectedExistingElement.attributes as any)?.name;
      return {
        name: typeof name === 'string' && name.trim() ? name.trim() : selectedExistingElement.id,
        type: selectedExistingElement.type,
      };
    }
    if (selectedNodeId) {
      const resolved = resolveElementLabel(selectedNodeId);
      if (resolved) return { name: resolved.label, type: resolved.type };
    }
    return null;
  }, [resolveElementLabel, selectedExistingElement, selectedNodeId, stagedSelectedElement]);

  const compactWarningCount = React.useMemo(() => {
    if (!validationGateOpen || !validationSummary) return 0;
    return validationSummary.warningCount;
  }, [validationGateOpen, validationSummary]);

  const resolveExistingRelationship = React.useCallback(
    (edgeId: string) => {
      const edge = cyRef.current?.getElementById(edgeId);
      const edgeData = edge && !edge.empty() ? edge.data() : null;
      if (edgeData?.governanceWarning) return null;
      const fromId = String(edgeData?.source ?? '');
      const toId = String(edgeData?.target ?? '');
      const type = edgeData?.relationshipType as RelationshipType | undefined;
      if (!fromId || !toId || !type) return null;
      const repoMatch = eaRepository?.relationships.find(
        (rel) =>
          rel.id === edgeId ||
          (rel.fromId === fromId && rel.toId === toId && rel.type === type),
      );
      return {
        id: repoMatch?.id ?? edgeId,
        fromId,
        toId,
        type,
        attributes: { ...(repoMatch?.attributes ?? {}) },
      };
    },
    [eaRepository],
  );

  const selectedExistingRelationship = React.useMemo(() => {
    if (!iterativeModeling || !selectedEdgeId) return null;
    if (stagedSelectedRelationship) return null;
    return resolveExistingRelationship(selectedEdgeId);
  }, [iterativeModeling, resolveExistingRelationship, selectedEdgeId, stagedSelectedRelationship]);

  React.useEffect(() => {
    if (!stagedSelectedRelationship) {
      relationshipAttributesForm.resetFields();
      return;
    }

    const relDef = RELATIONSHIP_TYPE_DEFINITIONS[stagedSelectedRelationship.type];
    const attrs = stagedSelectedRelationship.attributes ?? {};
    const nextValues: Record<string, string> = {};
    (relDef?.attributes ?? []).forEach((attr) => {
      const value = (attrs as any)?.[attr];
      if (typeof value === 'string') {
        nextValues[attr] = value;
      } else if (value === null || value === undefined) {
        nextValues[attr] = '';
      } else {
        nextValues[attr] = String(value);
      }
    });
    relationshipAttributesForm.setFieldsValue(nextValues);
  }, [relationshipAttributesForm, stagedSelectedRelationship?.id, stagedSelectedRelationship?.type]);

  const deleteStagedElement = React.useCallback(
    (elementId: string) => {
      setValidationGateOpen(true);
      const applied = applyRepositoryTransaction((repo) => {
        if (!repo.objects.has(elementId)) return { ok: true } as const;
        repo.objects.delete(elementId);
        repo.relationships = repo.relationships.filter((r) => r.fromId !== elementId && r.toId !== elementId);
        return { ok: true } as const;
      });
      if (!applied.ok) {
        message.error(applied.error);
        return;
      }
      setStagedElements((prev) => prev.filter((el) => el.id !== elementId));
      setStagedRelationships((prev) => prev.filter((rel) => rel.fromId !== elementId && rel.toId !== elementId));
      if (cyRef.current) {
        const cy = cyRef.current;
        cy.remove(`node#${elementId}`);
        cy.edges().filter((e) => e.data('source') === elementId || e.data('target') === elementId).remove();
        setIsLargeGraph(cy.nodes().length > LARGE_GRAPH_THRESHOLD);
      }
      setSelectedNodeIds((prev) => prev.filter((id) => id !== elementId));
    },
    [applyRepositoryTransaction],
  );

  const deleteStagedRelationship = React.useCallback(
    (relationshipId: string) => {
      setValidationGateOpen(true);
      const applied = applyRepositoryTransaction((repo) => {
        repo.relationships = repo.relationships.filter((r) => r.id !== relationshipId);
        return { ok: true } as const;
      });
      if (!applied.ok) {
        message.error(applied.error);
        return;
      }
      setStagedRelationships((prev) => prev.filter((rel) => rel.id !== relationshipId));
      if (cyRef.current) {
        cyRef.current.remove(`edge#${relationshipId}`);
      }
      setSelectedEdgeId((prev) => (prev === relationshipId ? null : prev));
    },
    [applyRepositoryTransaction],
  );

  const clearRelationshipDraftArtifacts = React.useCallback(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    cy.getElementById(DRAFT_EDGE_ID)?.remove();
    removeDraftTarget();
    cy.nodes().removeClass('validTarget').removeClass('invalidTarget').removeClass('validTargetCandidate').removeClass('connectionSource');
  }, [removeDraftTarget]);

  const lockNodesForConnection = React.useCallback(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    const allNodes = cy.nodes();
    allNodes.ungrabify();
    allNodes.lock();
    const shouldSkip = (node: any) => Boolean(node?.data?.('draftTarget'));
    cy.nodes().forEach((node) => {
      if (shouldSkip(node)) return;
      node.lock();
      node.grabify(false);
      node.grabbable(false);
    });
  }, []);

  const restoreNodesAfterConnection = React.useCallback(() => {
    if (!cyRef.current) {
      connectionDragPositionsRef.current.clear();
      return;
    }
    const cy = cyRef.current;
    const allNodes = cy.nodes();
    allNodes.unlock();
    allNodes.grabify();
    if (connectionDragPositionsRef.current.size > 0) {
      connectionDragPositionsRef.current.forEach((pos, id) => {
        const node = cy.getElementById(id);
        if (node && !node.empty()) node.position({ x: pos.x, y: pos.y });
      });
    }
    cy.nodes().forEach((node) => {
      node.unlock();
      const isStaged = Boolean(node.data('staged'));
      const isFreeShape = Boolean(node.data('freeShape'));
      const shouldGrab = !presentationView && !viewReadOnly && (isFreeShape || isStaged || iterativeModeling);
      node.grabify(shouldGrab);
      node.grabbable(shouldGrab);
    });
    connectionDragPositionsRef.current.clear();
  }, [iterativeModeling, presentationView, viewReadOnly]);

  const releaseConnectionDragLock = React.useCallback(() => {
    if (!connectionDragLockRef.current && !connectionDragLocked) return;
    restoreNodesAfterConnection();
    connectionDragLockRef.current = false;
    setConnectionDragLocked(false);
  }, [connectionDragLocked, restoreNodesAfterConnection]);

  const cancelConnectionInteraction = React.useCallback(() => {
    if (!relationshipDraftRef.current.dragging) return;
    updateRelationshipDraft({ sourceId: null, targetId: null, valid: null, message: null, dragging: false });
    setRelationshipSourceId(null);
    setRelationshipTargetId(null);
    clearRelationshipDraftArtifacts();
    releaseConnectionDragLock();
    setPendingRelationshipType(null);
    pendingRelationshipTypeRef.current = null;
    setToolMode('SELECT');
    toolModeRef.current = 'SELECT';
  }, [clearRelationshipDraftArtifacts, releaseConnectionDragLock, updateRelationshipDraft]);

  const ensureDraftTargetId = React.useCallback(() => {
    if (!draftTargetIdRef.current) {
      draftTargetIdRef.current = `draft-target-${generateUUID()}`;
    }
    return draftTargetIdRef.current;
  }, []);

  const removeDraftTarget = React.useCallback(() => {
    if (!cyRef.current) return;
    cyRef.current.nodes('[draftTarget]').remove();
    draftTargetIdRef.current = null;
    draftAnchorPosRef.current = null;
  }, []);

  const ensureDraftTargetAt = React.useCallback((pos: { x: number; y: number }) => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    const targetId = ensureDraftTargetId();
    const target = cy.getElementById(targetId);
    if (target.empty()) {
      cy.add({ data: { id: targetId, draftTarget: true }, position: { x: pos.x, y: pos.y }, classes: '' });
      draftAnchorPosRef.current = { x: pos.x, y: pos.y };
      return;
    }
    target.position({ x: pos.x, y: pos.y });
    draftAnchorPosRef.current = { x: pos.x, y: pos.y };
  }, [ensureDraftTargetId]);

  const getFallbackAnchorPos = React.useCallback((sourceId?: string | null) => {
    if (draftAnchorPosRef.current) return draftAnchorPosRef.current;
    const fallbackSourceId = sourceId ?? relationshipDraftRef.current.sourceId;
    if (!fallbackSourceId) return null;
    const sourcePos = connectionDragPositionsRef.current.get(fallbackSourceId);
    if (!sourcePos) return null;
    return { x: sourcePos.x + 40, y: sourcePos.y };
  }, []);

  const updateDraftEdgeTarget = React.useCallback(
    (pos?: { x: number; y: number } | null, hoverNode?: any | null, forceSnap = false, sourceId?: string | null) => {
      if (!cyRef.current) return;
      const edge = cyRef.current.getElementById(DRAFT_EDGE_ID);
      if (!edge || edge.empty()) return;
      if (hoverNode && !hoverNode.empty() && (forceSnap || hoverNode.hasClass('validTargetCandidate'))) {
        edge.data('target', String(hoverNode.id()));
        edge.style('target-endpoint', 'outside-to-node');
        return;
      }
      const nextPos = pos ?? getFallbackAnchorPos(sourceId);
      if (!nextPos) return;
      ensureDraftTargetAt(nextPos);
      edge.data('target', ensureDraftTargetId());
      edge.style('target-endpoint', 'outside-to-node');
    },
    [ensureDraftTargetAt, ensureDraftTargetId, getFallbackAnchorPos],
  );

  const refreshConnectionPositionSnapshot = React.useCallback(() => {
    if (!cyRef.current) return;
    const snapshot = new Map<string, { x: number; y: number }>();
    cyRef.current.nodes().forEach((node) => {
      const nodeId = String(node.id());
      if (!nodeId || node.data('draftTarget')) return;
      snapshot.set(nodeId, { x: node.position('x'), y: node.position('y') });
    });
    connectionDragPositionsRef.current = snapshot;
  }, []);

  const resetToolDrafts = React.useCallback(() => {
    setPendingElementType(null);
    setPendingElementVisualKind(null);
    setPendingRelationshipType(null);
    setPendingFreeConnectorKind(null);
    setRelationshipSourceId(null);
    setRelationshipTargetId(null);
    setFreeConnectorSourceId(null);
    setRelationshipDraft({ sourceId: null, targetId: null, valid: null, message: null, dragging: false });
    freeConnectorDragRef.current = { sourceId: null, dragging: false };
    suppressConnectionTapRef.current = false;
    setPlacementModeActive(false);
    setPlacementGuide(null);
    setCreateHintPos(null);
    clearRelationshipDraftArtifacts();
    releaseConnectionDragLock();
  }, [clearRelationshipDraftArtifacts, releaseConnectionDragLock]);

  React.useEffect(() => {
    if (!viewReadOnly) return;
    resetToolDrafts();
    setToolMode('SELECT');
  }, [resetToolDrafts, viewReadOnly]);

  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (toolModeRef.current !== 'CREATE_RELATIONSHIP') return;
      cancelConnectionInteraction();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [cancelConnectionInteraction]);

  React.useEffect(() => {
    if (toolMode === 'CREATE_RELATIONSHIP' && !pendingRelationshipType) {
      setToolMode('SELECT');
      toolModeRef.current = 'SELECT';
      pendingRelationshipTypeRef.current = null;
    }
  }, [pendingRelationshipType, toolMode]);

  React.useEffect(() => {
    if (toolMode === 'CREATE_RELATIONSHIP' || toolMode === 'CREATE_FREE_CONNECTOR') {
      if (!connectionDragLockRef.current) {
        connectionDragLockRef.current = true;
        setConnectionDragLocked(true);
      }
      lockNodesForConnection();
      return;
    }
    if (!relationshipDraftRef.current.dragging && !freeConnectorDragRef.current.dragging) {
      releaseConnectionDragLock();
    }
  }, [lockNodesForConnection, releaseConnectionDragLock, toolMode]);

  React.useEffect(() => {
    if (toolMode !== 'CREATE_RELATIONSHIP' && toolMode !== 'CREATE_FREE_CONNECTOR') {
      if (connectionDragLockRef.current) {
        releaseConnectionDragLock();
      }
      return;
    }
    if (toolMode === 'CREATE_RELATIONSHIP' && !relationshipDraft.dragging && connectionDragLockRef.current) {
      releaseConnectionDragLock();
    }
    if (toolMode === 'CREATE_FREE_CONNECTOR' && !freeConnectorDragRef.current.dragging && connectionDragLockRef.current) {
      releaseConnectionDragLock();
    }
  }, [relationshipDraft.dragging, releaseConnectionDragLock, toolMode]);

  React.useEffect(() => {
    if (!cyRef.current) return;
    if (toolMode === 'CREATE_RELATIONSHIP' || toolMode === 'CREATE_FREE_CONNECTOR') return;
    refreshConnectionPositionSnapshot();
  }, [refreshConnectionPositionSnapshot, stagedElements.length, stagedRelationships.length, toolMode]);

  React.useEffect(() => {
    if (toolMode !== 'CREATE_RELATIONSHIP' || !pendingRelationshipType || !cyRef.current) {
      relationshipEligibilityRef.current = new Map();
      return;
    }
    const cy = cyRef.current;
    const next = new Map<string, Set<string>>();
    cy.nodes().forEach((n) => {
      const sourceId = String(n.id());
      if (!sourceId) return;
      next.set(sourceId, getValidTargetsForSource(sourceId, pendingRelationshipType));
    });
    relationshipEligibilityRef.current = next;
  }, [getValidTargetsForSource, pendingRelationshipType, toolMode]);

  React.useEffect(() => {
    if (toolMode === 'CREATE_FREE_CONNECTOR' && !pendingFreeConnectorKind) {
      setToolMode('SELECT');
    }
  }, [pendingFreeConnectorKind, toolMode]);

  React.useEffect(() => {
    if (!presentationView) return;
    resetToolDrafts();
    setToolMode('SELECT');
  }, [presentationView, resetToolDrafts]);

  React.useEffect(() => {
    if (!canDiagramMode && (toolMode === 'CREATE_ELEMENT' || toolMode === 'CREATE_RELATIONSHIP' || toolMode === 'CREATE_FREE_CONNECTOR')) {
      resetToolDrafts();
      setToolMode('SELECT');
    }
  }, [canDiagramMode, resetToolDrafts, toolMode]);

  const cancelCreation = React.useCallback(() => {
    setPendingElementType(null);
    setPendingElementVisualKind(null);
    setPlacement(null);
    setCreateModalOpen(false);
    setAuditPreviewOpen(false);
    setPendingElementDraft(null);
    setPendingRelationshipType(null);
    setRelationshipSourceId(null);
    setRelationshipTargetId(null);
    setQuickCreateOpen(false);
    setRepoEndpointOpen(false);
    setRelationshipDraft({ sourceId: null, targetId: null, valid: null, message: null, dragging: false });
    freeConnectorDragRef.current = { sourceId: null, dragging: false };
    suppressConnectionTapRef.current = false;
    setPlacementModeActive(false);
    setPlacementGuide(null);
    clearRelationshipDraftArtifacts();
    releaseConnectionDragLock();
    setPendingChildCreation(null);
  }, [clearRelationshipDraftArtifacts, releaseConnectionDragLock]);

  const stagedValidationErrors = React.useMemo(() => {
    if (iterativeModeling) return [] as string[];
    const errors: string[] = [];
    const activeElements = stagedElements.filter((el) => !isMarkedForRemoval(el.attributes));
    const activeRelationships = stagedRelationships.filter((rel) => !isMarkedForRemoval(rel.attributes));
    const traceabilityCheckEnabled = activeElements.some(
      (el) => el.modelingState === 'REVIEW_READY' || el.modelingState === 'APPROVED',
    );

    for (const el of activeElements) {
      if (!el.name || !el.name.trim()) errors.push(`Element ${el.id}: name is required.`);
      if (el.type === 'Capability') {
        const nameText = el.name ?? '';
        const descriptionText = typeof el.description === 'string' ? el.description : '';
        const offending = findTechnicalTerm(`${nameText} ${descriptionText}`);
        if (offending) {
          errors.push(`Capability ${el.name || el.id}: technical term "${offending}" is not allowed in name/description.`);
        }
        const attrs = el.attributes ?? {};
        const ownerRole = (attrs as any)?.ownerRole;
        const owningUnit = (attrs as any)?.owningUnit;
        if (isItOwned(ownerRole) || isItOwned(owningUnit)) {
          errors.push(`Capability ${el.name || el.id}: ownership must not be assigned to IT.`);
        }
        const lifecycleStatus = (attrs as any)?.lifecycleStatus;
        if (lifecycleStatus === 'Deprecated' || lifecycleStatus === 'Retired') {
          errors.push(`Capability ${el.name || el.id}: lifecycle must be stable (not Deprecated/Retired).`);
        }
      }
      if (el.type === 'BusinessProcess') {
        if (!isVerbBasedProcessName(el.name ?? '')) {
          errors.push(`BusinessProcess ${el.name || el.id}: name must start with a verb (e.g., "Place Order").`);
        }
      }
      if (el.type === 'Application') {
        const nameText = el.name ?? '';
        const descriptionText = typeof el.description === 'string' ? el.description : '';
        const offending = findPhysicalTerm(`${nameText} ${descriptionText}`);
        if (offending) {
          errors.push(
            `Application ${el.name || el.id}: name/description must be logical (no physical infrastructure term "${offending}").`,
          );
        }
      }
      const requiredAttrs = requiredElementAttributes(el.type);
      if (requiredAttrs.length > 0) {
        const attrs = el.attributes ?? {};
        requiredAttrs.forEach((attr) => {
          const value = (attrs as any)?.[attr];
          const missing =
            value === null ||
            value === undefined ||
            (typeof value === 'string' && !value.trim());
          if (missing) {
            errors.push(`Element ${el.id}: ${attr} is required.`);
          }
        });
      }
    }
    if (cyRef.current) {
      cyRef.current
        .nodes()
        .filter((n) => !n.data('freeShape'))
        .forEach((n) => {
          const label = String(n.data('label') ?? '').trim();
          if (!label) {
            errors.push(`Element ${String(n.id())}: canvas label is missing.`);
          }
        });
    }
    for (const rel of activeRelationships) {
      if (!rel.fromId || !rel.toId) errors.push(`Relationship ${rel.id}: missing endpoints.`);
      const sourceOk = rel.fromId ? Boolean(resolveElementLabel(rel.fromId)) : false;
      const targetOk = rel.toId ? Boolean(resolveElementLabel(rel.toId)) : false;
      if (!sourceOk || !targetOk) {
        errors.push(`Relationship ${rel.id}: endpoints must exist in workspace or repository.`);
      }
      const sourceStaged = stagedElementById.has(rel.fromId);
      const targetStaged = stagedElementById.has(rel.toId);
      if (!sourceStaged && !targetStaged) {
        errors.push(`Relationship ${rel.id}: at least one endpoint must be staged in Studio.`);
      }
      const relDef = RELATIONSHIP_TYPE_DEFINITIONS[rel.type];
      const requiredAttrs = relDef?.attributes ?? [];
      if (requiredAttrs.length > 0) {
        const attrs = (rel as DesignWorkspaceStagedRelationship).attributes ?? {};
        requiredAttrs.forEach((attr) => {
          const value = (attrs as any)?.[attr];
          const missing =
            value === null ||
            value === undefined ||
            (typeof value === 'string' && !value.trim());
          if (missing) {
            errors.push(`Relationship ${rel.id}: ${attr} is required.`);
          }
        });
      }
    }
    return errors;
  }, [iterativeModeling, requiredElementAttributes, resolveElementLabel, stagedElements, stagedRelationships]);

  const mandatoryCommitRelationshipErrors = React.useMemo(() => {
    if (iterativeModeling) return [] as string[];
    if (!eaRepository) return [] as string[];
    const errors: string[] = [];
    const activeElements = stagedElements.filter((el) => !isMarkedForRemoval(el.attributes));
    const activeRelationships = stagedRelationships.filter((rel) => !isMarkedForRemoval(rel.attributes));
    const elementTypeById = new Map<string, ObjectType>();
    const elementAttrsById = new Map<string, Record<string, unknown>>();
    const traceabilityCheckEnabled = activeElements.some(
      (el) => el.modelingState === 'REVIEW_READY' || el.modelingState === 'APPROVED',
    );

    eaRepository.objects.forEach((obj) => {
      elementTypeById.set(obj.id, obj.type);
      elementAttrsById.set(obj.id, obj.attributes ?? {});
    });
    activeElements.forEach((el) => {
      elementTypeById.set(el.id, el.type);
      elementAttrsById.set(el.id, el.attributes ?? {});
    });

    const relationships = [
      ...eaRepository.relationships.map((rel) => ({
        fromId: rel.fromId,
        toId: rel.toId,
        type: rel.type,
      })),
      ...activeRelationships.map((rel) => ({
        fromId: rel.fromId,
        toId: rel.toId,
        type: rel.type,
      })),
    ];

    const typeOf = (id: string) => elementTypeById.get(id);
    const isEnterprise = (t?: ObjectType) => t === 'Enterprise';
    const isDepartment = (t?: ObjectType) => t === 'Department';

    const countRelationships = (predicate: (rel: { fromId: string; toId: string; type: RelationshipType }) => boolean) =>
      relationships.filter(predicate).length;

    for (const el of activeElements) {
      const attrs = elementAttrsById.get(el.id) ?? {};
      const ownerId = typeof (attrs as any)?.ownerId === 'string' ? String((attrs as any).ownerId).trim() : '';
      if (!ownerId) {
        errors.push(`${el.type} ${el.name || el.id} is missing owner (Enterprise/Department).`);
      } else if (!(isEnterprise(typeOf(ownerId)) || isDepartment(typeOf(ownerId)))) {
        errors.push(`${el.type} ${el.name || el.id} has invalid owner reference (${ownerId}).`);
      } else if ((el.type === 'Enterprise' || el.type === 'Department') && ownerId === el.id) {
        // self-ownership allowed
      }

      if (el.type === 'Capability' || el.type === 'SubCapability' || el.type === 'Application' || el.type === 'Programme') {
        const owningCount = countRelationships(
          (r) => r.type === 'OWNS' && r.toId === el.id && isEnterprise(typeOf(r.fromId)),
        );
        if (owningCount !== 1) {
          errors.push(`${el.type} ${el.name || el.id} must have exactly one owning Enterprise via OWNS.`);
        }
      }

      if (el.type === 'Department') {
        const owningCount = countRelationships(
          (r) => r.type === 'HAS' && r.toId === el.id && isEnterprise(typeOf(r.fromId)),
        );
        if (owningCount !== 1) {
          errors.push(`Department ${el.name || el.id} must belong to exactly one Enterprise via HAS.`);
        }
      }

      if (el.type === 'Capability') {
        const invalid = relationships.some((r) => {
          if (r.fromId !== el.id && r.toId !== el.id) return false;
          const fromType = typeOf(r.fromId);
          const toType = typeOf(r.toId);
          const isHierarchy =
            (r.type === 'DECOMPOSES_TO' || r.type === 'COMPOSED_OF') &&
            ['Capability', 'SubCapability', 'CapabilityCategory'].includes(String(fromType)) &&
            ['Capability', 'SubCapability', 'CapabilityCategory'].includes(String(toType));
          const isRealizedByProcess =
            r.type === 'REALIZED_BY' && fromType === 'Capability' && toType === 'BusinessProcess' && r.fromId === el.id;
          return !(isHierarchy || isRealizedByProcess);
        });
        if (invalid) {
          errors.push(
            `Capability ${el.name || el.id} can only participate in capability hierarchy (DECOMPOSES_TO/COMPOSED_OF) or be realized by a BusinessProcess via REALIZED_BY.`,
          );
        }
      }

      if (el.type === 'ApplicationService' && traceabilityCheckEnabled) {
        const providerCount = countRelationships(
          (r) => r.type === 'PROVIDED_BY' && r.fromId === el.id && typeOf(r.toId) === 'Application',
        );
        if (providerCount !== 1) {
          errors.push(`ApplicationService ${el.name || el.id} must belong to exactly one Application via PROVIDED_BY.`);
        }
        const usageCount = countRelationships(
          (r) => r.type === 'USED_BY' && r.fromId === el.id && ['Application', 'BusinessProcess'].includes(String(typeOf(r.toId))),
        );
        if (usageCount < 1) {
          errors.push(`ApplicationService ${el.name || el.id} must be used by at least one Application or BusinessProcess via USED_BY.`);
        }
      }

      if (el.type === 'Application' && traceabilityCheckEnabled) {
        const servesCount = countRelationships(
          (r) => r.type === 'SERVED_BY' && r.toId === el.id && typeOf(r.fromId) === 'BusinessProcess',
        );
        if (servesCount < 1) {
          errors.push(`Application ${el.name || el.id} must be served to at least one BusinessProcess via SERVED_BY.`);
        }
      }
    }

    return errors;
  }, [eaRepository, iterativeModeling, stagedElements, stagedRelationships]);

  const validateRelationshipEndpoints = React.useCallback(
    (sourceId: string, targetId: string, type: RelationshipType) => {
      const source = resolveElementLabel(sourceId);
      const target = resolveElementLabel(targetId);
      if (!source || !target) {
        return { valid: false, message: 'Select valid source and target elements.' };
      }
      const relDef = RELATIONSHIP_TYPE_DEFINITIONS[type];
      if (!relDef) return { valid: false, message: 'Unknown relationship type.' };
      const pairs = relDef.allowedEndpointPairs ?? [];
      const valid =
        (Array.isArray(pairs) && pairs.length > 0
          ? pairs.some((p) => p.from === source.type && p.to === target.type)
          : relDef.fromTypes.includes(source.type) && relDef.toTypes.includes(target.type));
      if (!valid) {
        return {
          valid: false,
          message: `Invalid endpoints: ${source.type} → ${target.type} for ${type.replace(/_/g, ' ')}`,
        };
      }
      return { valid: true, message: `${source.type} → ${target.type} valid.` };
    },
    [iterativeModeling, resolveElementLabel, stagedElementById],
  );

  const getValidTargetsForSource = React.useCallback(
    (sourceId: string, type: RelationshipType) => {
      const source = resolveElementLabel(sourceId);
      if (!source) return new Set<string>();
      const relDef = RELATIONSHIP_TYPE_DEFINITIONS[type];
      if (!relDef) return new Set<string>();
      const validTargets = new Set<string>();
      const pairs = relDef.allowedEndpointPairs ?? [];

      cyRef.current?.nodes().forEach((node) => {
        const targetId = String(node.id());
        if (targetId === sourceId) return;
        const target = resolveElementLabel(targetId);
        if (!target) return;

        const valid =
          (Array.isArray(pairs) && pairs.length > 0
            ? pairs.some((p) => p.from === source.type && p.to === target.type)
            : relDef.fromTypes.includes(source.type) && relDef.toTypes.includes(target.type));
        if (valid) validTargets.add(targetId);
      });

      return validTargets;
    },
    [iterativeModeling, resolveElementLabel, stagedElementById],
  );

  const repositoryElementOptions = React.useMemo(() => {
    if (!eaRepository) return [];
    return Array.from(eaRepository.objects.values()).map((obj) => {
      const name = (obj.attributes as any)?.name;
      const label = typeof name === 'string' && name.trim() ? `${name} (${obj.type})` : `${obj.id} (${obj.type})`;
      return { value: obj.id, label };
    });
  }, [eaRepository]);

  const getAlignmentGuideForNode = React.useCallback((nodeId: string) => {
    if (!cyRef.current) return { x: null as number | null, y: null as number | null };
    const cy = cyRef.current;
    const node = cy.getElementById(nodeId);
    if (!node || node.empty()) return { x: null, y: null };
    const pos = node.position();
    const halfW = node.outerWidth() / 2;
    const halfH = node.outerHeight() / 2;
    const nodeXs = [pos.x, pos.x - halfW, pos.x + halfW];
    const nodeYs = [pos.y, pos.y - halfH, pos.y + halfH];

    let nearestX: number | null = null;
    let nearestY: number | null = null;
    let minDx = Number.POSITIVE_INFINITY;
    let minDy = Number.POSITIVE_INFINITY;

    cy.nodes().forEach((n) => {
      if (n.id() === nodeId) return;
      const p = n.position();
      const nHalfW = n.outerWidth() / 2;
      const nHalfH = n.outerHeight() / 2;
      const otherXs = [p.x, p.x - nHalfW, p.x + nHalfW];
      const otherYs = [p.y, p.y - nHalfH, p.y + nHalfH];

      nodeXs.forEach((x) => {
        otherXs.forEach((ox) => {
          const dx = Math.abs(ox - x);
          if (dx < minDx && dx <= ALIGN_THRESHOLD) {
            minDx = dx;
            nearestX = ox;
          }
        });
      });

      nodeYs.forEach((y) => {
        otherYs.forEach((oy) => {
          const dy = Math.abs(oy - y);
          if (dy < minDy && dy <= ALIGN_THRESHOLD) {
            minDy = dy;
            nearestY = oy;
          }
        });
      });
    });

    return { x: nearestX, y: nearestY };
  }, []);

  const snapPosition = React.useCallback(
    (nodeId: string) => {
      if (!cyRef.current) return;
      const cy = cyRef.current;
      const node = cy.getElementById(nodeId);
      if (!node || node.empty()) return;
      const pos = node.position();
      const guides = getAlignmentGuideForNode(nodeId);
      const size = Math.max(4, Math.round(gridSize));
      const snapX = guides.x ?? Math.round(pos.x / size) * size;
      const snapY = guides.y ?? Math.round(pos.y / size) * size;
      node.position({ x: snapX, y: snapY });
    },
    [getAlignmentGuideForNode, gridSize],
  );

  const getCanvasCenter = React.useCallback(() => {
    if (!cyRef.current) return { x: 0, y: 0 };
    const extent = cyRef.current.extent();
    return {
      x: (extent.x1 + extent.x2) / 2,
      y: (extent.y1 + extent.y2) / 2,
    };
  }, []);

  const distributeSelectedNodes = React.useCallback(
    (axis: 'x' | 'y') => {
      if (!cyRef.current) return;
      const cy = cyRef.current;
      const nodes = selectedNodeIds
        .map((id) => cy.getElementById(id))
        .filter((n) => n && !n.empty() && (iterativeModeling || n.data('staged')));

      if (nodes.length < 3) {
        message.info(iterativeModeling ? 'Select at least three elements to distribute.' : 'Select at least three staged elements to distribute.');
        return;
      }

      const sorted = nodes.slice().sort((a, b) => {
        const aPos = a.position();
        const bPos = b.position();
        return axis === 'x' ? aPos.x - bPos.x : aPos.y - bPos.y;
      });

      const firstPos = sorted[0].position();
      const lastPos = sorted[sorted.length - 1].position();
      const span = axis === 'x' ? lastPos.x - firstPos.x : lastPos.y - firstPos.y;
      if (!Number.isFinite(span) || span === 0) return;

      const step = span / (sorted.length - 1);
      sorted.forEach((node, index) => {
        const pos = node.position();
        if (axis === 'x') {
          node.position({ x: firstPos.x + step * index, y: pos.y });
        } else {
          node.position({ x: pos.x, y: firstPos.y + step * index });
        }
      });

      setAlignmentGuides({ x: null, y: null });
    },
    [iterativeModeling, selectedNodeIds],
  );

  const resetLayout = React.useCallback(() => {
    if (!cyRef.current) return;
    cyRef.current.layout({ name: 'grid', fit: true, avoidOverlap: true }).run();
  }, []);

  const cleanAlignToGrid = React.useCallback(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    cy.nodes().forEach((node) => {
      if (!iterativeModeling && !node.data('staged') && !node.data('freeShape')) return;
      snapPosition(String(node.id()));
    });
    setAlignmentGuides({ x: null, y: null });
  }, [iterativeModeling, snapPosition]);

  const buildFreeShapesFromCanvas = React.useCallback((): FreeShape[] => {
    if (!cyRef.current) return [];
    return cyRef.current
      .nodes('[freeShape]')
      .toArray()
      .map((node) => {
        const data = node.data();
        return {
          id: String(node.id()),
          kind: data.freeShapeKind as FreeShapeKind,
          label: String(data.label ?? ''),
          x: node.position('x'),
          y: node.position('y'),
          width: Number(data.width ?? node.width() ?? 120),
          height: Number(data.height ?? node.height() ?? 80),
        };
      });
  }, []);

  const buildFreeConnectorsFromCanvas = React.useCallback((): FreeConnector[] => {
    if (!cyRef.current) return [];
    return cyRef.current
      .edges('[freeConnector]')
      .toArray()
      .map((edge) => {
        const data = edge.data();
        return {
          id: String(edge.id()),
          source: String(data.source ?? edge.source().id()),
          target: String(data.target ?? edge.target().id()),
          kind: (data.freeConnectorKind as FreeConnectorKind) ?? 'arrow',
        };
      });
  }, []);

  const buildLayoutFromCanvas = React.useCallback((): DesignWorkspaceLayout => {
    if (!cyRef.current) return { nodes: [], edges: [] };
    const cy = cyRef.current;
    const nodes: DesignWorkspaceLayoutNode[] = cy
      .nodes()
      .filter((n) => !n.data('freeShape'))
      .toArray()
      .map((n) => {
        const id = String(n.id());
        const data = n.data();
        const fallback = stagedElementById.get(id);
        return {
          id,
          label: String(data?.label ?? fallback?.name ?? id),
          elementType: (data?.elementType ?? fallback?.type) as ObjectType,
          x: n.position('x'),
          y: n.position('y'),
        };
      });

    const edges: DesignWorkspaceLayoutEdge[] = cy
      .edges()
      .filter((e) => !e.data('freeConnector') && !e.data('governanceWarning'))
      .toArray()
      .map((e) => {
        const id = String(e.id());
        const data = e.data();
        const fallback = stagedRelationships.find((r) => r.id === id);
        return {
          id,
          source: String(data?.source ?? fallback?.fromId ?? ''),
          target: String(data?.target ?? fallback?.toId ?? ''),
          relationshipType: (data?.relationshipType ?? fallback?.type) as RelationshipType,
        };
      })
      .filter((e) => e.source && e.target && e.relationshipType);

    return { nodes, edges };
  }, [stagedElementById, stagedRelationships]);

  const buildViewPositionsFromCanvas = React.useCallback(() => {
    const layout = buildLayoutFromCanvas();
    const positions = layout.nodes.reduce<Record<string, { x: number; y: number }>>((acc, node) => {
      acc[node.id] = { x: node.x, y: node.y };
      return acc;
    }, {});
    return { layout, positions };
  }, [buildLayoutFromCanvas]);

  const saveActiveView = React.useCallback(
    (opts?: { silent?: boolean }) => {
      if (!activeViewId || !activeView || viewReadOnly || activeTabKey === WORKSPACE_TAB_KEY) return;
      setValidationGateOpen(true);
      const { positions } = buildViewPositionsFromCanvas();
      const nextFreeShapes = buildFreeShapesFromCanvas();
      const nextFreeConnectors = buildFreeConnectorsFromCanvas();
      const signature = stableStringify({ positions, freeShapes: nextFreeShapes, freeConnectors: nextFreeConnectors });
      const lastSignature = viewTabStateById[activeTabKey]?.lastSavedSignature ?? '';
      if (signature === lastSignature) {
        if (viewTabStateById[activeTabKey]?.saveStatus === 'dirty') {
          setViewTabStateById((prev) => ({
            ...prev,
            [activeTabKey]: {
              viewId: activeViewId,
              view: activeView,
              saveStatus: 'saved',
              lastSavedSignature: lastSignature,
            },
          }));
        }
        return;
      }

      setViewTabStateById((prev) => ({
        ...prev,
        [activeTabKey]: {
          viewId: activeViewId,
          view: activeView,
          saveStatus: 'saving',
          lastSavedSignature: prev[activeTabKey]?.lastSavedSignature ?? '',
        },
      }));
      const next: ViewInstance = {
        ...activeView,
        layoutMetadata: {
          ...(activeView.layoutMetadata ?? {}),
          positions,
          freeShapes: nextFreeShapes,
          freeConnectors: nextFreeConnectors,
          annotations: (activeView.layoutMetadata as any)?.annotations ?? [],
          filters: (activeView.layoutMetadata as any)?.filters,
        },
        status: 'SAVED',
      };
      ViewStore.save(next);
      try {
        window.dispatchEvent(new Event('ea:viewsChanged'));
      } catch {
        // Best-effort only.
      }
      setActiveView(next);
      setViewTabStateById((prev) => ({
        ...prev,
        [activeTabKey]: {
          viewId: activeViewId,
          view: next,
          saveStatus: 'saved',
          lastSavedSignature: signature,
        },
      }));
      if (!opts?.silent) message.success('View saved.');
    },
    [activeTabKey, activeView, activeViewId, buildFreeConnectorsFromCanvas, buildFreeShapesFromCanvas, buildViewPositionsFromCanvas, viewReadOnly, viewTabStateById],
  );

  const buildLayoutFromView = React.useCallback(
    (view: ViewInstance): DesignWorkspaceLayout | null => {
      if (!eaRepository) return null;
      const resolution = resolveViewScope({ view, repository: eaRepository });
      const positions = ((view.layoutMetadata as any)?.positions as Record<string, { x: number; y: number }> | undefined)
        ?? loadViewLayoutPositions(view.id);
      const existingNodeMap = new Map((designWorkspace.layout?.nodes ?? []).map((n) => [n.id, n] as const));

      const nodes: DesignWorkspaceLayoutNode[] = resolution.elements.map((el, index) => {
        const saved = positions[el.id] ?? existingNodeMap.get(el.id);
        const fallbackX = 80 + (index % 4) * 180;
        const fallbackY = 80 + Math.floor(index / 4) * 140;
        return {
          id: el.id,
          label: ((el.attributes as any)?.name as string) || el.id,
          elementType: el.type,
          x: saved?.x ?? fallbackX,
          y: saved?.y ?? fallbackY,
        };
      });

      const nodeIdSet = new Set(nodes.map((n) => n.id));
      stagedElements.forEach((el, index) => {
        if (nodeIdSet.has(el.id)) return;
        const existing = existingNodeMap.get(el.id);
        const offset = nodes.length + index;
        const fallbackX = 80 + (offset % 4) * 180;
        const fallbackY = 80 + Math.floor(offset / 4) * 140;
        nodes.push({
          id: el.id,
          label: el.name || el.id,
          elementType: el.type,
          x: existing?.x ?? fallbackX,
          y: existing?.y ?? fallbackY,
        });
      });

      const edges: DesignWorkspaceLayoutEdge[] = resolution.relationships.map((rel) => ({
        id: rel.id ?? `${rel.fromId}__${rel.toId}__${rel.type}`,
        source: rel.fromId,
        target: rel.toId,
        relationshipType: rel.type,
      }));

      const edgeIdSet = new Set(edges.map((e) => e.id));
      stagedRelationships.forEach((rel) => {
        if (edgeIdSet.has(rel.id)) return;
        edges.push({
          id: rel.id,
          source: rel.fromId,
          target: rel.toId,
          relationshipType: rel.type,
        });
      });

      return { nodes, edges };
    },
    [designWorkspace.layout?.nodes, eaRepository, stagedElements, stagedRelationships],
  );

  React.useEffect(() => {
    if (pendingRelationshipType) return;
    setRelationshipDraft({ sourceId: null, targetId: null, valid: null, message: null, dragging: false });
  }, [pendingRelationshipType]);

  React.useEffect(() => {
    if (!activeViewId || !activeView || activeTabKey === WORKSPACE_TAB_KEY) return;
    const positions = (activeView.layoutMetadata as any)?.positions ?? {};
    const freeShapes = (activeView.layoutMetadata as any)?.freeShapes ?? [];
    const freeConnectors = (activeView.layoutMetadata as any)?.freeConnectors ?? [];
    const signature = stableStringify({ positions, freeShapes, freeConnectors });
    setViewTabStateById((prev) => {
      const existing = prev[activeTabKey];
      if (existing?.lastSavedSignature === signature && existing?.saveStatus === 'saved' && existing?.view === activeView) {
        return prev;
      }
      return {
        ...prev,
        [activeTabKey]: {
          viewId: activeViewId,
          view: activeView,
          saveStatus: 'saved',
          lastSavedSignature: signature,
        },
      };
    });
  }, [activeTabKey, activeView, activeViewId]);

  React.useEffect(() => {
    if (!activeViewId || !cyRef.current) return;
    if (viewReadOnly || activeTabKey === WORKSPACE_TAB_KEY) return;
    const cy = cyRef.current;
    const markDirty = () =>
      setViewTabStateById((prev) => {
        const existing = prev[activeTabKey];
        if (!existing) return prev;
        if (existing.saveStatus === 'dirty') return prev;
        return {
          ...prev,
          [activeTabKey]: {
            ...existing,
            saveStatus: 'dirty',
          },
        };
      });
    cy.on('position', 'node', markDirty);
    cy.on('add', markDirty);
    cy.on('remove', markDirty);
    cy.on('data', 'node', markDirty);
    cy.on('data', 'edge', markDirty);
    return () => {
      cy.off('position', 'node', markDirty);
      cy.off('add', markDirty);
      cy.off('remove', markDirty);
      cy.off('data', 'node', markDirty);
      cy.off('data', 'edge', markDirty);
    };
  }, [activeTabKey, activeViewId, viewReadOnly]);

  React.useEffect(() => {
    if (!activeViewId || viewReadOnly || activeTabKey === WORKSPACE_TAB_KEY) return;
    const timer = window.setInterval(() => {
      if (viewSaveStatus === 'dirty') saveActiveView({ silent: true });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeTabKey, activeViewId, saveActiveView, viewReadOnly, viewSaveStatus]);

  const applyRepositoryTransaction = React.useCallback(
    (mutator: (repo: EaRepository) => { ok: true } | { ok: false; error: string }) => {
      if (!eaRepository) return { ok: false, error: 'No repository loaded.' } as const;
      const nextRepo = eaRepository.clone();
      const result = mutator(nextRepo);
      if (!result.ok) return result;
      return trySetEaRepository(nextRepo);
    },
    [eaRepository, trySetEaRepository],
  );

  const applyStagedChangesToRepository = React.useCallback(
    (options?: { silent?: boolean }) => {
      if (!eaRepository) return;
      if (!hasModelingAccess || commitContextLocked) return;

      const signature = stableStringify({
        elements: stagedElements.map((el) => ({
          id: el.id,
          type: el.type,
          name: el.name,
          description: el.description,
          attributes: el.attributes ?? {},
          modelingState: el.modelingState,
        })),
        relationships: stagedRelationships.map((rel) => ({
          id: rel.id,
          type: rel.type,
          fromId: rel.fromId,
          toId: rel.toId,
          attributes: rel.attributes ?? {},
          modelingState: rel.modelingState,
        })),
      });

      if (signature === stagedSyncSignatureRef.current) return;

      const nowIso = new Date().toISOString();
      const nextRepo = eaRepository.clone();
      let changeCount = 0;

      const findRelationshipInRepo = (
        rel: DesignWorkspaceStagedRelationship,
        relationships: typeof nextRepo.relationships,
      ) => (
        relationships.find((r) => r.id === rel.id) ??
        relationships.find((r) => r.fromId === rel.fromId && r.toId === rel.toId && r.type === rel.type)
      );

      const removeElementFromRepo = (elementId: string) => {
        if (!nextRepo.objects.has(elementId)) return;
        nextRepo.objects.delete(elementId);
        nextRepo.relationships = nextRepo.relationships.filter((r) => r.fromId !== elementId && r.toId !== elementId);
      };

      for (const el of stagedElements) {
        const exists = nextRepo.objects.get(el.id);
        if (isMarkedForRemoval(el.attributes)) {
          if (exists) {
            removeElementFromRepo(el.id);
            changeCount += 1;
          }
          continue;
        }

        const attrs: Record<string, unknown> = { ...(el.attributes ?? {}) };
        if (typeof el.name === 'string') attrs.name = el.name.trim();
        if (typeof el.description === 'string') attrs.description = el.description;
        if (!attrs.modelingState) attrs.modelingState = el.modelingState ?? 'DRAFT';

        if (!exists) {
          if (!attrs.createdAt) attrs.createdAt = el.createdAt || nowIso;
          if (!attrs.createdBy) attrs.createdBy = el.createdBy || actor;
          if (!attrs.lastModifiedAt) attrs.lastModifiedAt = attrs.createdAt;
          if (!attrs.lastModifiedBy) attrs.lastModifiedBy = attrs.createdBy;

          const res = nextRepo.addObject({ id: el.id, type: el.type, attributes: attrs });
          if (!res.ok) {
            if (!options?.silent) message.error(res.error);
            return;
          }
          changeCount += 1;
          continue;
        }

        const existingAttrs = exists.attributes ?? {};
        const createdAt = typeof (existingAttrs as any)?.createdAt === 'string'
          ? (existingAttrs as any).createdAt
          : (attrs.createdAt ?? el.createdAt ?? nowIso);
        const createdBy = typeof (existingAttrs as any)?.createdBy === 'string'
          ? (existingAttrs as any).createdBy
          : (attrs.createdBy ?? el.createdBy ?? actor);
        attrs.createdAt = createdAt;
        attrs.createdBy = createdBy;

        if (!areAttributesEqual(existingAttrs, attrs)) {
          attrs.lastModifiedAt = nowIso;
          attrs.lastModifiedBy = actor;
          const res = nextRepo.updateObjectAttributes(el.id, attrs, 'replace');
          if (!res.ok) {
            if (!options?.silent) message.error(res.error);
            return;
          }
          changeCount += 1;
        }
      }

      const removedElementIds = new Set(
        stagedElements.filter((el) => isMarkedForRemoval(el.attributes)).map((el) => el.id),
      );

      for (const rel of stagedRelationships) {
        if (removedElementIds.has(rel.fromId) || removedElementIds.has(rel.toId)) continue;
        if (isMarkedForRemoval(rel.attributes)) {
          const existing = findRelationshipInRepo(rel, nextRepo.relationships);
          if (existing) {
            nextRepo.relationships = nextRepo.relationships.filter((r) => r.id !== existing.id);
            changeCount += 1;
          }
          continue;
        }

        const existing = findRelationshipInRepo(rel, nextRepo.relationships);
        const attrs: Record<string, unknown> = { ...(rel.attributes ?? {}) };
        if (!attrs.modelingState) attrs.modelingState = rel.modelingState ?? 'DRAFT';

        if (!existing) {
          if (!attrs.createdAt) attrs.createdAt = rel.createdAt || nowIso;
          if (!attrs.createdBy) attrs.createdBy = rel.createdBy || actor;
          if (!attrs.lastModifiedAt) attrs.lastModifiedAt = attrs.createdAt;
          if (!attrs.lastModifiedBy) attrs.lastModifiedBy = attrs.createdBy;

          const res = nextRepo.addRelationship({
            id: rel.id,
            fromId: rel.fromId,
            toId: rel.toId,
            type: rel.type,
            attributes: attrs,
          });
          if (!res.ok) {
            if (!options?.silent) message.error(res.error);
            return;
          }
          changeCount += 1;
          continue;
        }

        const existingAttrs = existing.attributes ?? {};
        const createdAt = typeof (existingAttrs as any)?.createdAt === 'string'
          ? (existingAttrs as any).createdAt
          : (attrs.createdAt ?? rel.createdAt ?? nowIso);
        const createdBy = typeof (existingAttrs as any)?.createdBy === 'string'
          ? (existingAttrs as any).createdBy
          : (attrs.createdBy ?? rel.createdBy ?? actor);
        attrs.createdAt = createdAt;
        attrs.createdBy = createdBy;

        if (!areAttributesEqual(existingAttrs, attrs)) {
          attrs.lastModifiedAt = nowIso;
          attrs.lastModifiedBy = actor;
          const nextRel = {
            ...existing,
            attributes: { ...attrs },
          };
          const index = nextRepo.relationships.findIndex((r) => r.id === existing.id);
          if (index >= 0) nextRepo.relationships[index] = nextRel;
          changeCount += 1;
        }
      }

      if (changeCount === 0) {
        stagedSyncSignatureRef.current = signature;
        return;
      }

      const applied = trySetEaRepository(nextRepo);
      if (!applied.ok) {
        if (!options?.silent) message.error(applied.error);
        return;
      }

      stagedSyncSignatureRef.current = signature;
    },
    [actor, commitContextLocked, eaRepository, hasModelingAccess, stagedElements, stagedRelationships, trySetEaRepository],
  );

  React.useEffect(() => {
    applyStagedChangesToRepository({ silent: true });
  }, [applyStagedChangesToRepository]);

  const stageElement = React.useCallback(
    (input: {
      type: ObjectType;
      name: string;
      description?: string;
      placement?: { x: number; y: number } | null;
      id?: string;
      visualKind?: string | null;
    }) => {
      setValidationGateOpen(true);
      const id = input.id ?? generateElementId(input.type);
      const createdAt = new Date().toISOString();
      const applyRes = applyRepositoryTransaction((repo) => {
        const res = repo.addObject({
          id,
          type: input.type,
          attributes: {
            name: input.name,
            description: input.description ?? '',
            elementType: input.type,
            eaVisualKind: input.visualKind ?? undefined,
            createdAt,
            createdBy: actor,
            lastModifiedAt: createdAt,
            lastModifiedBy: actor,
            modelingState: 'DRAFT',
          },
        });
        if (!res.ok) return { ok: false, error: res.error } as const;
        return { ok: true } as const;
      });
      if (!applyRes.ok) {
        message.error(applyRes.error);
        return '';
      }
      const staged: DesignWorkspaceStagedElement = {
        id,
        kind: 'element',
        type: input.type,
        name: input.name,
        description: input.description,
        attributes: {},
        createdAt,
        createdBy: actor,
        modelingState: 'DRAFT',
        status: 'STAGED',
      };

      setStagedElements((prev) => [...prev, staged]);

      if (cyRef.current) {
        const visualData = buildEaVisualData({ type: input.type, visualKindOverride: input.visualKind ?? undefined });
        cyRef.current.add({
          data: {
            id,
            label: input.name,
            elementType: input.type,
            staged: true,
            ...visualData,
          },
          position: input.placement ? { x: input.placement.x, y: input.placement.y } : undefined,
        });
        const node = cyRef.current.getElementById(id);
        if (node && !node.empty()) {
          node.data('label', input.name);
          node.data('eaShape', visualData.eaShape);
          node.data('eaIcon', visualData.eaIcon);
          node.data('eaColor', visualData.eaColor);
          node.data('eaBorder', visualData.eaBorder);
          node.data('eaVisualKind', visualData.eaVisualKind);
          node.grabbable(true);
          node.select();
        }
        setIsLargeGraph(cyRef.current.nodes().length > LARGE_GRAPH_THRESHOLD);
      }

      setSelectedEdgeId(null);
      setSelectedNodeIds([id]);
      setSelectedFreeShapeId(null);
      setSelectedFreeConnectorId(null);

      return id;
    },
      [actor, applyRepositoryTransaction, relationshipStyleForType],
    );

  const stageRelationship = React.useCallback(
    (input: { fromId: string; toId: string; type: RelationshipType }) => {
      setValidationGateOpen(true);
      const createdAt = new Date().toISOString();
      const relationshipId = `rel-${generateUUID()}`;
      const applyRes = applyRepositoryTransaction((repo) => {
        const res = repo.addRelationship({
          id: relationshipId,
          fromId: input.fromId,
          toId: input.toId,
          type: input.type,
          attributes: {
            createdAt,
            createdBy: actor,
            lastModifiedAt: createdAt,
            lastModifiedBy: actor,
            modelingState: 'DRAFT',
          },
        });
        if (!res.ok) return { ok: false, error: res.error } as const;
        return { ok: true } as const;
      });
      if (!applyRes.ok) {
        message.error(applyRes.error);
        return '';
      }
      const staged: DesignWorkspaceStagedRelationship = {
        id: relationshipId,
        kind: 'relationship',
        fromId: input.fromId,
        toId: input.toId,
        type: input.type,
        attributes: {},
        createdAt,
        createdBy: actor,
        modelingState: 'DRAFT',
        status: 'STAGED',
      };

      setStagedRelationships((prev) => [...prev, staged]);

      if (cyRef.current) {
        cyRef.current.add({
          data: {
            id: relationshipId,
            source: input.fromId,
            target: input.toId,
            relationshipType: input.type,
            relationshipStyle: relationshipStyleForType(input.type),
            staged: true,
          },
        });
        const edge = cyRef.current.getElementById(relationshipId);
        if (edge && !edge.empty()) edge.select();
      }

      setSelectedNodeIds([]);
      setSelectedEdgeId(relationshipId);
      setSelectedFreeShapeId(null);
      setSelectedFreeConnectorId(null);
      return relationshipId;
    },
    [actor, applyRepositoryTransaction],
  );

  const formatInlineWarningLabel = React.useCallback((message?: string) => {
    const base = (message ?? 'Invalid relationship').trim() || 'Invalid relationship';
    const max = 48;
    const truncated = base.length > max ? `${base.slice(0, Math.max(0, max - 1))}…` : base;
    return `⚠ ${truncated}`;
  }, []);

  const clearGovernanceWarningEdges = React.useCallback(
    (input: { fromId: string; toId: string; type: RelationshipType }) => {
      if (!cyRef.current) return;
      const cy = cyRef.current;
      cy.edges()
        .filter((e) =>
          Boolean(e.data('governanceWarning')) &&
          String(e.data('relationshipType') ?? '') === input.type &&
          String(e.data('source') ?? e.source().id()) === input.fromId &&
          String(e.data('target') ?? e.target().id()) === input.toId,
        )
        .remove();
    },
    [],
  );

  const addGovernanceWarningEdge = React.useCallback(
    (input: { fromId: string; toId: string; type: RelationshipType; message?: string }) => {
      if (!cyRef.current) return '';
      clearGovernanceWarningEdges({ fromId: input.fromId, toId: input.toId, type: input.type });
      const warningId = `warn-rel-${generateUUID()}`;
      const warningLabel = formatInlineWarningLabel(input.message);
      cyRef.current.add({
        data: {
          id: warningId,
          source: input.fromId,
          target: input.toId,
          relationshipType: input.type,
          relationshipStyle: relationshipStyleForType(input.type),
          governanceWarning: true,
          warningLabel,
          warningMessage: input.message ?? '',
        },
      });
      return warningId;
    },
    [clearGovernanceWarningEdges, formatInlineWarningLabel, relationshipStyleForType],
  );

  const createRelationshipFromCanvas = React.useCallback(
    (input: { fromId: string; toId: string; type: RelationshipType }) => {
      setValidationGateOpen(true);
      const createdAt = new Date().toISOString();
      const relationshipId = `rel-${generateUUID()}`;
      const applyRes = applyRepositoryTransaction((repo) => {
        const res = repo.addRelationship({
          id: relationshipId,
          fromId: input.fromId,
          toId: input.toId,
          type: input.type,
          attributes: {
            createdAt,
            createdBy: actor,
            lastModifiedAt: createdAt,
            lastModifiedBy: actor,
            modelingState: 'DRAFT',
          },
        });
        if (!res.ok) return { ok: false, error: res.error } as const;
        return { ok: true } as const;
      });
      if (!applyRes.ok) {
        return { ok: false, error: applyRes.error } as const;
      }

      const staged: DesignWorkspaceStagedRelationship = {
        id: relationshipId,
        kind: 'relationship',
        fromId: input.fromId,
        toId: input.toId,
        type: input.type,
        attributes: {},
        createdAt,
        createdBy: actor,
        modelingState: 'DRAFT',
        status: 'STAGED',
      };

      setStagedRelationships((prev) => [...prev, staged]);

      if (cyRef.current) {
        cyRef.current.add({
          data: {
            id: relationshipId,
            source: input.fromId,
            target: input.toId,
            relationshipType: input.type,
            relationshipStyle: relationshipStyleForType(input.type),
            staged: true,
          },
        });
        const edge = cyRef.current.getElementById(relationshipId);
        if (edge && !edge.empty()) edge.select();
      }

      setSelectedNodeIds([]);
      setSelectedEdgeId(relationshipId);
      setSelectedFreeShapeId(null);
      setSelectedFreeConnectorId(null);
      clearGovernanceWarningEdges({ fromId: input.fromId, toId: input.toId, type: input.type });
      return { ok: true, id: relationshipId } as const;
    },
    [actor, applyRepositoryTransaction, clearGovernanceWarningEdges, relationshipStyleForType],
  );

  const stageExistingElement = React.useCallback(
    (elementId: string, placement?: { x: number; y: number }) => {
      if (!eaRepository) return;
      const existing = eaRepository.objects.get(elementId);
      if (!existing) {
        message.error('Selected element no longer exists in the repository.');
        return;
      }
      setValidationGateOpen(true);
      const attrs = { ...(existing.attributes ?? {}) } as Record<string, unknown>;
      const name = typeof attrs.name === 'string' && attrs.name.trim() ? attrs.name.trim() : existing.id;
      const description = typeof attrs.description === 'string' ? attrs.description : '';
      const createdAt = typeof attrs.createdAt === 'string' ? attrs.createdAt : new Date().toISOString();
      const createdBy = typeof attrs.createdBy === 'string' ? attrs.createdBy : actor;
      const modelingState = (attrs.modelingState as any) ?? 'DRAFT';

      const staged: DesignWorkspaceStagedElement = {
        id: existing.id,
        kind: 'element',
        type: existing.type as ObjectType,
        name,
        description,
        attributes: attrs,
        createdAt,
        createdBy,
        modelingState,
        status: 'STAGED',
      };

      if (!stagedElementById.has(elementId)) {
        setStagedElements((prev) => [...prev, staged]);
      }

      if (cyRef.current) {
        const cy = cyRef.current;
        const node = cy.getElementById(existing.id);
        const visualData = buildEaVisualData({ type: existing.type as ObjectType, attributes: attrs });
        if (node && !node.empty()) {
          node.data('staged', true);
          node.data('label', name);
          node.data('elementType', existing.type);
          node.data('eaShape', visualData.eaShape);
          node.data('eaIcon', visualData.eaIcon);
          node.data('eaColor', visualData.eaColor);
          node.data('eaBorder', visualData.eaBorder);
          node.data('eaVisualKind', visualData.eaVisualKind);
          node.grabbable(true);
          if (placement) {
            node.position({ x: placement.x, y: placement.y });
          }
          node.select();
        } else {
          cy.add({
            data: {
              id: existing.id,
              label: name,
              elementType: existing.type,
              staged: true,
              ...visualData,
            },
            position: placement ? { x: placement.x, y: placement.y } : undefined,
          });
          const added = cy.getElementById(existing.id);
          if (added && !added.empty()) {
            added.data('label', name);
            added.data('elementType', existing.type);
            added.data('eaShape', visualData.eaShape);
            added.data('eaIcon', visualData.eaIcon);
            added.data('eaColor', visualData.eaColor);
            added.data('eaBorder', visualData.eaBorder);
            added.data('eaVisualKind', visualData.eaVisualKind);
            added.grabbable(true);
            added.select();
          }
        }
        setIsLargeGraph(cy.nodes().length > LARGE_GRAPH_THRESHOLD);
      }

      setSelectedEdgeId(null);
      setSelectedNodeIds([existing.id]);
      setSelectedFreeShapeId(null);
      setSelectedFreeConnectorId(null);
      message.success(placement ? 'Element added to canvas.' : 'Element staged for editing.');
    },
    [actor, eaRepository, stagedElementById],
  );

  const stageExistingRelationship = React.useCallback(
    (edgeId: string) => {
      if (!edgeId) return;
      if (stagedRelationships.some((rel) => rel.id === edgeId)) return;
      const resolved = resolveExistingRelationship(edgeId);
      if (!resolved) {
        message.error('Selected relationship could not be resolved.');
        return;
      }
      setValidationGateOpen(true);
      const attrs = { ...(resolved.attributes ?? {}) } as Record<string, unknown>;
      const createdAt = typeof attrs.createdAt === 'string' ? attrs.createdAt : new Date().toISOString();
      const createdBy = typeof attrs.createdBy === 'string' ? attrs.createdBy : actor;
      const modelingState = (attrs.modelingState as any) ?? 'DRAFT';

      const staged: DesignWorkspaceStagedRelationship = {
        id: resolved.id,
        kind: 'relationship',
        type: resolved.type,
        fromId: resolved.fromId,
        toId: resolved.toId,
        attributes: attrs,
        createdAt,
        createdBy,
        modelingState,
        status: 'STAGED',
      };

      setStagedRelationships((prev) => [...prev, staged]);

      if (cyRef.current) {
        const edge = cyRef.current.getElementById(edgeId);
        if (edge && !edge.empty()) {
          edge.data('staged', true);
          edge.data('relationshipStyle', relationshipStyleForType(resolved.type as RelationshipType));
          edge.select();
        }
      }

      setSelectedNodeIds([]);
      setSelectedEdgeId(edgeId);
      message.success('Relationship staged for editing.');
    },
    [actor, relationshipStyleForType, resolveExistingRelationship, stagedRelationships],
  );

  const confirmRelationshipDraft = React.useCallback(() => {
    if (!pendingRelationshipType || !relationshipSourceId || !relationshipTargetId) return;
    setValidationGateOpen(true);
    const relationshipId = stageRelationship({
      fromId: relationshipSourceId,
      toId: relationshipTargetId,
      type: pendingRelationshipType,
    });
    if (!relationshipId) return;

    if (cyRef.current) {
      cyRef.current.add({
        data: {
          id: relationshipId,
          source: relationshipSourceId,
          target: relationshipTargetId,
          relationshipType: pendingRelationshipType,
          staged: true,
        },
      });
      const edge = cyRef.current.getElementById(relationshipId);
      if (edge && !edge.empty()) edge.select();
    }

    setSelectedNodeIds([]);
    setSelectedEdgeId(relationshipId);
    setRelationshipSourceId(null);
    setRelationshipTargetId(null);
    setRelationshipDraft({ sourceId: null, targetId: null, valid: null, message: null, dragging: false });
    // Relationship properties can be edited later via Inspector.
  }, [pendingRelationshipType, relationshipSourceId, relationshipTargetId, stageRelationship]);

  const startChildCreation = React.useCallback(
    (parentId: string) => {
      message.info('Create new elements from the EA Toolbox, then connect them to create child relationships.');
      return;
    },
    [],
  );

  const handleQuickCreate = React.useCallback(
    async (keepOpen: boolean) => {
      try {
        if (designWorkspace.status !== 'DRAFT') {
          message.warning('Workspace is read-only. Reopen draft to create elements.');
          return;
        }
        const values = await quickCreateForm.validateFields();
        const name = String(values.name || '').trim();
        if (!name) {
          message.error('Name is required.');
          return;
        }
        const type = values.type as ObjectType;
        if (!validateStudioElementType(type)) {
          return;
        }
        const id = stageElement({
          type,
          name,
          description: String(values.description || '').trim(),
          placement: quickCreatePlacement,
        });
        if (!id) return;
        openPropertiesPanel({ elementId: id, elementType: type, dock: 'right', readOnly: false });
        message.success(`${type} created in repository.`);

        if (pendingChildCreation) {
          const validation = validateRelationshipEndpoints(
            pendingChildCreation.parentId,
            id,
            pendingChildCreation.relationshipType,
          );
          if (!validation.valid) {
            message.warning(validation.message || 'Child relationship not created.');
          } else {
            const relId = stageRelationship({
              fromId: pendingChildCreation.parentId,
              toId: id,
              type: pendingChildCreation.relationshipType,
            });
            if (relId) message.success('Child linked via decomposition.');
          }
          setPendingChildCreation(null);
        }

        if (keepOpen) {
          quickCreateForm.setFieldsValue({ name: '', description: '' });
          return;
        }

        setQuickCreateOpen(false);
        setQuickCreatePlacement(null);
        setQuickCreateType(null);
        quickCreateForm.resetFields();
      } catch {
        // validation handled by Form
      }
    },
    [designWorkspace.status, openPropertiesPanel, pendingChildCreation, quickCreateForm, quickCreatePlacement, stageElement, stageRelationship, validateRelationshipEndpoints, validateStudioElementType],
  );

  const updateWorkspaceStatus = React.useCallback(
    (status: DesignWorkspaceStatus) => {
      const layout = buildLayoutFromCanvas();
      const next: DesignWorkspace = {
        ...designWorkspace,
        status,
        updatedAt: new Date().toISOString(),
        layout,
        stagedElements,
        stagedRelationships,
      };
      onUpdateWorkspace(next);
    },
    [buildLayoutFromCanvas, designWorkspace, onUpdateWorkspace, stagedElements, stagedRelationships],
  );

  const discardWorkspaceNow = React.useCallback(() => {
    const nowIso = new Date().toISOString();
    const nextWorkspace: DesignWorkspace = {
      ...designWorkspace,
      status: 'DISCARDED',
      updatedAt: nowIso,
      layout: { nodes: [], edges: [] },
      stagedElements: [],
      stagedRelationships: [],
    };
    onUpdateWorkspace(nextWorkspace);
    recordAuditEvent({
      userId: actor,
      repositoryName: metadata?.repositoryName ?? designWorkspace.repositoryName,
      timestamp: nowIso,
      action: `workspace.discard name="${designWorkspace.name}"`,
    });
    setStagedElements([]);
    setStagedRelationships([]);
    if (cyRef.current) cyRef.current.elements().remove();
    setDiscardOpen(false);
    message.success('Workspace discarded. View unchanged.');
    onExit({ suppressRefresh: true });
  }, [actor, designWorkspace, metadata?.repositoryName, onExit, onUpdateWorkspace]);

  const saveWorkspaceDraft = React.useCallback(() => {
    if (designWorkspace.status === 'COMMITTED') {
      message.warning('Workspace is committed. Reopen draft to save new changes.');
      return;
    }
    setValidationGateOpen(true);
    const layout = buildLayoutFromCanvas();
    const next: DesignWorkspace = {
      ...designWorkspace,
      status: 'DRAFT',
      updatedAt: new Date().toISOString(),
      repositoryUpdatedAt: currentRepositoryUpdatedAt ?? designWorkspace.repositoryUpdatedAt,
      layout,
      stagedElements,
      stagedRelationships,
    };
    onUpdateWorkspace(next);
    message.success('Workspace saved (draft).');
  }, [buildLayoutFromCanvas, currentRepositoryUpdatedAt, designWorkspace, onUpdateWorkspace, stagedElements, stagedRelationships]);

  React.useEffect(() => {
    const onAction = (ev: Event) => {
      const e = ev as CustomEvent<{ requestId?: string; action?: 'save' | 'discard' }>;
      const requestId = e.detail?.requestId ?? '';
      const action = e.detail?.action;
      if (!action) return;

      if (action === 'save') {
        saveWorkspaceDraft();
        onExit({ suppressRefresh: true });
      }

      if (action === 'discard') {
        discardWorkspaceNow();
      }

      try {
        window.dispatchEvent(new CustomEvent('ea:studio.action.completed', { detail: { requestId, action } }));
      } catch {
        // ignore
      }
    };

    window.addEventListener('ea:studio.action', onAction as EventListener);
    return () => window.removeEventListener('ea:studio.action', onAction as EventListener);
  }, [discardWorkspaceNow, onExit, saveWorkspaceDraft]);

  const autoSaveWorkspace = React.useCallback(() => {
    if (designWorkspace.status === 'DISCARDED') return;
    const layout = buildLayoutFromCanvas();
    const next: DesignWorkspace = {
      ...designWorkspace,
      updatedAt: new Date().toISOString(),
      repositoryUpdatedAt: currentRepositoryUpdatedAt ?? designWorkspace.repositoryUpdatedAt,
      layout,
      stagedElements,
      stagedRelationships,
    };
    onUpdateWorkspace(next);
    setLastAutoSaveAt(next.updatedAt);
  }, [buildLayoutFromCanvas, currentRepositoryUpdatedAt, designWorkspace, onUpdateWorkspace, stagedElements, stagedRelationships]);

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      autoSaveWorkspace();
    }, 60000);
    return () => window.clearInterval(interval);
  }, [autoSaveWorkspace]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() ?? '';
      const isEditable = tag === 'input' || tag === 'textarea' || target?.isContentEditable;
      if (isEditable && event.key !== 'Escape') return;

      if (event.key === 'Alt') {
        setSnapTemporarilyDisabled(true);
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        cancelCreation();
        setToolMode('SELECT');
        resetToolDrafts();
        return;
      }

      if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        message.info('Create new elements from the EA Toolbox. Drag from Explorer to reuse existing elements.');
        return;
      }

      if (event.key === 'Delete') {
        if (viewReadOnly) return;
        if (selectedStagedElements.length > 0) {
          event.preventDefault();
          selectedStagedElements.forEach((el) => deleteStagedElement(el.id));
          return;
        }
        if (stagedSelectedRelationship) {
          event.preventDefault();
          deleteStagedRelationship(stagedSelectedRelationship.id);
        }
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setSnapTemporarilyDisabled(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [cancelCreation, deleteStagedElement, deleteStagedRelationship, resetToolDrafts, selectedStagedElements, stagedSelectedRelationship, viewReadOnly]);

  const commitWorkspace = React.useCallback(() => {
    setValidationGateOpen(true);
    if (!hasStagedChanges) {
      message.info('No staged changes to commit.');
      return;
    }

    if (!eaRepository) {
      message.error('No repository loaded. Commit is unavailable.');
      return;
    }

    if (!hasModelingAccess) {
      message.error('Commit blocked: repository is read-only or you lack modeling permission.');
      return;
    }

    if (commitContextLocked) {
      message.error('Commit blocked: Baseline, Plateau, and Roadmap contexts are read-only.');
      return;
    }

    if (stagedValidationErrors.length > 0) {
      Modal.error({
        title: 'Cannot commit workspace',
        content: (
          <div>
            <Typography.Paragraph type="secondary">
              Fix validation errors before committing.
            </Typography.Paragraph>
            <ul style={{ marginTop: 8, paddingLeft: 18 }}>
              {stagedValidationErrors.slice(0, 6).map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          </div>

        ),
      });
      return;
    }

    if (mandatoryCommitRelationshipErrors.length > 0) {
      Modal.error({
        title: 'Mandatory relationships required',
        content: (
          <div>
            <Typography.Paragraph type="secondary">
              Add required relationships before committing the workspace.
            </Typography.Paragraph>
            <ul style={{ marginTop: 8, paddingLeft: 18 }}>
              {mandatoryCommitRelationshipErrors.slice(0, 8).map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
            {mandatoryCommitRelationshipErrors.length > 8 ? (
              <Typography.Text type="secondary">+{mandatoryCommitRelationshipErrors.length - 8} more</Typography.Text>
            ) : null}
          </div>
        ),
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const nextRepo = eaRepository.clone();

    const addedElements: DesignWorkspaceStagedElement[] = [];
    const modifiedElements: DesignWorkspaceStagedElement[] = [];
    const removedElements: DesignWorkspaceStagedElement[] = [];
    const addedRelationships: DesignWorkspaceStagedRelationship[] = [];
    const modifiedRelationships: DesignWorkspaceStagedRelationship[] = [];
    const removedRelationships: DesignWorkspaceStagedRelationship[] = [];

    const findRelationshipInRepo = (
      rel: DesignWorkspaceStagedRelationship,
      relationships: typeof nextRepo.relationships,
    ) => {
      return (
        relationships.find((r) => r.id === rel.id) ??
        relationships.find((r) => r.fromId === rel.fromId && r.toId === rel.toId && r.type === rel.type)
      );
    };

    const removeElementFromRepo = (elementId: string) => {
      nextRepo.objects.delete(elementId);
      nextRepo.relationships = nextRepo.relationships.filter((r) => r.fromId !== elementId && r.toId !== elementId);
    };

    for (const el of stagedElements) {
      const exists = nextRepo.objects.get(el.id);
      if (isMarkedForRemoval(el.attributes)) {
        if (exists) {
          removedElements.push(el);
          removeElementFromRepo(el.id);
        }
        continue;
      }

      const attrs: Record<string, unknown> = { ...(el.attributes ?? {}) };
      if (typeof el.name === 'string') attrs.name = el.name.trim();
      if (typeof el.description === 'string') attrs.description = el.description;
      if (!attrs.modelingState) attrs.modelingState = el.modelingState ?? 'DRAFT';

      if (!exists) {
        if (!attrs.createdAt) attrs.createdAt = el.createdAt || nowIso;
        if (!attrs.createdBy) attrs.createdBy = el.createdBy || actor;
        if (!attrs.lastModifiedAt) attrs.lastModifiedAt = attrs.createdAt;
        if (!attrs.lastModifiedBy) attrs.lastModifiedBy = attrs.createdBy;

        const res = nextRepo.addObject({ id: el.id, type: el.type, attributes: attrs });
        if (!res.ok) {
          Modal.error({
            title: 'Commit failed',
            content: `Element ${el.id}: ${res.error}`,
          });
          return;
        }
        addedElements.push(el);
        continue;
      }

      const existingAttrs = exists.attributes ?? {};
      const createdAt = typeof (existingAttrs as any)?.createdAt === 'string' ? (existingAttrs as any).createdAt : (attrs.createdAt ?? el.createdAt ?? nowIso);
      const createdBy = typeof (existingAttrs as any)?.createdBy === 'string' ? (existingAttrs as any).createdBy : (attrs.createdBy ?? el.createdBy ?? actor);
      attrs.createdAt = createdAt;
      attrs.createdBy = createdBy;

      if (!areAttributesEqual(existingAttrs, attrs)) {
        attrs.lastModifiedAt = nowIso;
        attrs.lastModifiedBy = actor;
        const res = nextRepo.updateObjectAttributes(el.id, attrs, 'replace');
        if (!res.ok) {
          Modal.error({
            title: 'Commit failed',
            content: `Element ${el.id}: ${res.error}`,
          });
          return;
        }
        modifiedElements.push(el);
      }
    }

    const removedElementIds = new Set(removedElements.map((el) => el.id));

    for (const rel of stagedRelationships) {
      if (removedElementIds.has(rel.fromId) || removedElementIds.has(rel.toId)) {
        continue;
      }
      if (isMarkedForRemoval(rel.attributes)) {
        const existing = findRelationshipInRepo(rel, nextRepo.relationships);
        if (existing) {
          nextRepo.relationships = nextRepo.relationships.filter((r) => r.id !== existing.id);
          removedRelationships.push(rel);
        }
        continue;
      }

      const existing = findRelationshipInRepo(rel, nextRepo.relationships);
      const attrs: Record<string, unknown> = { ...(rel.attributes ?? {}) };
      if (!attrs.modelingState) attrs.modelingState = rel.modelingState ?? 'DRAFT';

      if (!existing) {
        if (!attrs.createdAt) attrs.createdAt = rel.createdAt || nowIso;
        if (!attrs.createdBy) attrs.createdBy = rel.createdBy || actor;
        if (!attrs.lastModifiedAt) attrs.lastModifiedAt = attrs.createdAt;
        if (!attrs.lastModifiedBy) attrs.lastModifiedBy = attrs.createdBy;

        const res = nextRepo.addRelationship({
          id: rel.id,
          fromId: rel.fromId,
          toId: rel.toId,
          type: rel.type,
          attributes: attrs,
        });
        if (!res.ok) {
          Modal.error({
            title: 'Commit failed',
            content: `Relationship ${rel.id}: ${res.error}`,
          });
          return;
        }
        addedRelationships.push(rel);
        continue;
      }

      const existingAttrs = existing.attributes ?? {};
      const createdAt = typeof (existingAttrs as any)?.createdAt === 'string' ? (existingAttrs as any).createdAt : (attrs.createdAt ?? rel.createdAt ?? nowIso);
      const createdBy = typeof (existingAttrs as any)?.createdBy === 'string' ? (existingAttrs as any).createdBy : (attrs.createdBy ?? rel.createdBy ?? actor);
      attrs.createdAt = createdAt;
      attrs.createdBy = createdBy;

      if (!areAttributesEqual(existingAttrs, attrs)) {
        attrs.lastModifiedAt = nowIso;
        attrs.lastModifiedBy = actor;
        const nextRel = {
          ...existing,
          attributes: { ...attrs },
        };
        const index = nextRepo.relationships.findIndex((r) => r.id === existing.id);
        if (index >= 0) {
          nextRepo.relationships[index] = nextRel;
        }
        modifiedRelationships.push(rel);
      }
    }

    const changeCount =
      addedElements.length +
      modifiedElements.length +
      removedElements.length +
      addedRelationships.length +
      modifiedRelationships.length +
      removedRelationships.length;

    if (changeCount > 0) {
      const applied = trySetEaRepository(nextRepo);
      if (!applied.ok) {
        Modal.error({
          title: 'Commit failed',
          content: `Repository update blocked: ${applied.error}`,
        });
        return;
      }
    }

    recordAuditEvent({
      userId: actor,
      repositoryName: metadata?.repositoryName ?? designWorkspace.repositoryName,
      timestamp: nowIso,
      action: `workspace.commit name="${designWorkspace.name}" added=${addedElements.length + addedRelationships.length} modified=${modifiedElements.length + modifiedRelationships.length} removed=${removedElements.length + removedRelationships.length}`,
    });

    addedElements.forEach((el) => {
      recordAuditEvent({
        userId: actor,
        repositoryName: metadata?.repositoryName ?? designWorkspace.repositoryName,
        timestamp: nowIso,
        action: `workspace.commit.add element id="${el.id}" type="${el.type}"`,
      });
    });

    modifiedElements.forEach((el) => {
      recordAuditEvent({
        userId: actor,
        repositoryName: metadata?.repositoryName ?? designWorkspace.repositoryName,
        timestamp: nowIso,
        action: `workspace.commit.modify element id="${el.id}" type="${el.type}"`,
      });
    });

    removedElements.forEach((el) => {
      recordAuditEvent({
        userId: actor,
        repositoryName: metadata?.repositoryName ?? designWorkspace.repositoryName,
        timestamp: nowIso,
        action: `workspace.commit.remove element id="${el.id}" type="${el.type}"`,
      });
    });

    addedRelationships.forEach((rel) => {
      recordAuditEvent({
        userId: actor,
        repositoryName: metadata?.repositoryName ?? designWorkspace.repositoryName,
        timestamp: nowIso,
        action: `workspace.commit.add relationship id="${rel.id}" type="${rel.type}" from="${rel.fromId}" to="${rel.toId}"`,
      });
    });

    modifiedRelationships.forEach((rel) => {
      recordAuditEvent({
        userId: actor,
        repositoryName: metadata?.repositoryName ?? designWorkspace.repositoryName,
        timestamp: nowIso,
        action: `workspace.commit.modify relationship id="${rel.id}" type="${rel.type}" from="${rel.fromId}" to="${rel.toId}"`,
      });
    });

    removedRelationships.forEach((rel) => {
      recordAuditEvent({
        userId: actor,
        repositoryName: metadata?.repositoryName ?? designWorkspace.repositoryName,
        timestamp: nowIso,
        action: `workspace.commit.remove relationship id="${rel.id}" type="${rel.type}" from="${rel.fromId}" to="${rel.toId}"`,
      });
    });

    const layout = buildLayoutFromCanvas();
    const nextWorkspace: DesignWorkspace = {
      ...designWorkspace,
      status: 'COMMITTED',
      updatedAt: nowIso,
      repositoryUpdatedAt: changeCount > 0 ? nowIso : (currentRepositoryUpdatedAt ?? designWorkspace.repositoryUpdatedAt),
      layout,
      stagedElements: stagedElements.map((el) => ({ ...el, status: 'COMMITTED' })),
      stagedRelationships: stagedRelationships.map((rel) => ({ ...rel, status: 'COMMITTED' })),
    };

    onUpdateWorkspace(nextWorkspace);
    setCommitOpen(false);
    message.success('Workspace committed and locked.');
    message.success('View updated from committed workspace changes.');
    try {
      window.dispatchEvent(new Event('ea:repositoryChanged'));
      window.dispatchEvent(new Event('ea:relationshipsChanged'));
      window.dispatchEvent(new Event('ea:viewsChanged'));
    } catch {
      // Best-effort only.
    }
  }, [actor, buildLayoutFromCanvas, commitContextLocked, designWorkspace, eaRepository, hasModelingAccess, hasStagedChanges, metadata?.repositoryName, onUpdateWorkspace, stagedElements, stagedRelationships, stagedValidationErrors, trySetEaRepository]);

  React.useEffect(() => {
    if (!containerRef.current) return undefined;

    if (!cyRef.current) {
      cyRef.current = cytoscape({
        container: containerRef.current,
        elements: [],
        layout: { name: 'grid', fit: true, avoidOverlap: true } as const,
        style: [
          {
            selector: 'node',
            style: {
              label: 'data(label)',
              'text-valign': 'center',
              'text-halign': 'center',
              'text-wrap': 'wrap',
              'text-max-width': 120,
              'text-background-color': '#ffffff',
              'text-background-opacity': 0.6,
              'text-background-padding': 2,
              'background-color': '#f0f0f0',
              color: '#1f1f1f',
              'border-color': '#d9d9d9',
              'border-width': 1,
              'font-size': 11,
              'font-weight': 600,
              width: 120,
              height: 48,
              shape: 'round-rectangle',
              'z-index': 10,
            },
          },
          {
            selector: 'node[eaShape]',
            style: {
              shape: 'data(eaShape)',
            },
          },
          {
            selector: 'node[eaIcon]',
            style: {
              'background-image': 'data(eaIcon)',
              'background-fit': 'contain',
              'background-width': '100%',
              'background-height': '100%',
              'background-position-x': '50%',
              'background-position-y': '50%',
              'text-margin-x': 0,
              'background-color': 'transparent',
              'border-color': 'transparent',
            },
          },
          {
            selector: 'edge',
            style: {
              width: 2,
              'line-color': '#8c8c8c',
              'target-arrow-color': '#8c8c8c',
              'target-arrow-shape': 'vee',
              'curve-style': 'straight',
              'arrow-scale': 1.2,
              'target-endpoint': 'outside-to-node',
              'z-index': 1,
              'z-compound-depth': 'bottom',
              label: 'data(relationshipType)',
              'font-size': 8,
              'text-background-color': '#fff',
              'text-background-opacity': 0.7,
              'text-rotation': 'autorotate',
            },
          },
          {
            selector: 'edge[governanceWarning]',
            style: {
              width: 1.6,
              'line-color': '#ff4d4f',
              'target-arrow-color': '#ff4d4f',
              'target-arrow-shape': 'triangle',
              'line-style': 'dashed',
              label: 'data(warningLabel)',
              color: '#a8071a',
              'font-size': 8,
              'text-background-color': '#fff1f0',
              'text-background-opacity': 0.85,
              'text-background-padding': 2,
              'text-rotation': 'autorotate',
            },
          },
          {
            selector: 'edge[relationshipStyle = "dependency"]',
            style: {
              'line-style': 'dashed',
              'target-arrow-shape': 'vee',
              width: 2,
            },
          },
          {
            selector: 'edge[relationshipStyle = "directed"]',
            style: {
              'target-arrow-shape': 'vee',
              width: 2,
            },
          },
          {
            selector: 'edge[relationshipStyle = "association"]',
            style: {
              'line-style': 'solid',
              'target-arrow-shape': 'none',
              width: 2,
            },
          },
          {
            selector: 'edge[relationshipStyle = "flow"]',
            style: {
              'line-style': 'dotted',
              'target-arrow-shape': 'triangle',
              width: 2,
            },
          },
          {
            selector: 'node[freeShape]',
            style: {
              label: 'data(label)',
              'text-valign': 'center',
              'text-halign': 'center',
              'text-wrap': 'wrap',
              'text-max-width': 140,
              'background-color': '#ffffff',
              'background-opacity': 1,
              'border-color': '#8c8c8c',
              'border-width': 1,
              'border-style': 'dashed',
              'font-weight': 500,
              width: 'data(width)',
              height: 'data(height)',
              shape: 'data(shape)',
            },
          },
          {
            selector: 'node[freeShapeKind = "text"]',
            style: {
              'background-opacity': 0,
              'border-style': 'dotted',
            },
          },
          {
            selector: 'node[freeShapeKind = "annotation"]',
            style: {
              'background-color': '#fffbe6',
              'border-color': '#faad14',
            },
          },
          {
            selector: 'node[freeShapeKind = "group"]',
            style: {
              'background-color': '#f5f5f5',
              'border-style': 'dashed',
              'border-width': 1.5,
            },
          },
          {
            selector: 'node[freeShapeKind = "boundary"]',
            style: {
              'background-opacity': 0,
              'border-style': 'dotted',
              'border-width': 1.5,
            },
          },
          {
            selector: 'edge[freeConnector]',
            style: {
              width: 1.5,
              'line-color': '#faad14',
              'target-arrow-color': '#faad14',
              'target-arrow-shape': 'none',
              'line-style': 'dashed',
              label: '',
            },
          },
          {
            selector: 'edge[freeConnectorKind = "arrow"]',
            style: {
              'target-arrow-shape': 'triangle',
              'line-style': 'dashed',
            },
          },
          {
            selector: 'edge[freeConnectorKind = "line"]',
            style: {
              'target-arrow-shape': 'none',
              'line-style': 'solid',
            },
          },
          {
            selector: 'node[staged]',
            style: {
              'border-color': '#fa8c16',
              'border-width': 2,
              'border-style': 'dashed',
              'background-color': '#fff7e6',
              color: '#ad4e00',
            },
          },
          {
            selector: 'node.layerHidden',
            style: {
              display: 'none',
            },
          },
          {
            selector: 'edge.layerHidden',
            style: {
              display: 'none',
            },
          },
          {
            selector: 'edge[staged]',
            style: {
              'line-color': '#fa8c16',
              'target-arrow-color': '#fa8c16',
              'line-style': 'dashed',
              'font-weight': 700,
            },
          },
          {
            selector: 'edge[draft]',
            style: {
              width: 2,
              'line-color': '#91caff',
              'target-arrow-color': '#91caff',
              'target-arrow-shape': 'none',
              'curve-style': 'straight',
              label: '',
              'text-opacity': 0,
              'text-background-opacity': 0,
              opacity: 1,
            },
          },
          {
            selector: 'edge[draft][relationshipStyle = "dependency"]',
            style: {
              'line-style': 'dashed',
              'target-arrow-shape': 'none',
            },
          },
          {
            selector: 'edge[draft][relationshipStyle = "association"]',
            style: {
              'line-style': 'solid',
              'target-arrow-shape': 'none',
            },
          },
          {
            selector: 'edge[draft][relationshipStyle = "flow"]',
            style: {
              'line-style': 'dotted',
              'target-arrow-shape': 'none',
            },
          },
          {
            selector: 'edge[draft][freeConnectorKind = "line"]',
            style: {
              'target-arrow-shape': 'none',
              'line-style': 'solid',
            },
          },
          {
            selector: 'edge.dragEdgesHidden',
            style: {
              display: 'none',
            },
          },
          {
            selector: 'node.validTarget',
            style: {
              'border-color': '#52c41a',
              'border-width': 2,
              'border-style': 'solid',
            },
          },
          {
            selector: 'node.connectionSource',
            style: {
              'border-color': '#1677ff',
              'border-width': 2,
              'border-style': 'solid',
              'box-shadow-color': '#91caff',
              'box-shadow-blur': 6,
              'box-shadow-spread': 2,
            },
          },
          {
            selector: 'node[draftTarget]',
            style: {
              opacity: 0,
              width: 1,
              height: 1,
              'border-width': 0,
              events: 'no',
            },
          },
        ],
        userZoomingEnabled: true,
        userPanningEnabled: true,
        boxSelectionEnabled: true,
        autounselectify: false,
        autoungrabify: false,
      });
    }

    const applyToolMode = () => {
      if (!cyRef.current) return;
      const cy = cyRef.current;
      const currentToolMode = toolModeRef.current;
      const panEnabled = currentToolMode === 'PAN';
      const selectEnabled = currentToolMode === 'SELECT';
      const connectionMode = currentToolMode === 'CREATE_RELATIONSHIP' || currentToolMode === 'CREATE_FREE_CONNECTOR';
      cy.userPanningEnabled(panEnabled);
      cy.boxSelectionEnabled(selectEnabled);
      cy.autoungrabify(panEnabled || connectionDragLockRef.current || connectionMode);
    };

    applyToolMode();

    const handleTap = (evt: any) => {
      if (!cyRef.current) return;
      const currentToolMode = toolModeRef.current;
      const currentRelationshipType = pendingRelationshipTypeRef.current;
      const currentFreeConnectorKind = pendingFreeConnectorKindRef.current;

      if (currentToolMode === 'CREATE_ELEMENT' && suppressNextTapRef.current) {
        suppressNextTapRef.current = false;
        return;
      }

      if (suppressConnectionTapRef.current) {
        suppressConnectionTapRef.current = false;
        return;
      }

      if (currentToolMode === 'CREATE_FREE_CONNECTOR' && evt.target === cyRef.current) {
        setFreeConnectorSourceId(null);
        return;
      }

      if (currentToolMode === 'CREATE_ELEMENT' && pendingElementType && placementModeActive && evt.target === cyRef.current) {
        if (!validateStudioElementType(pendingElementType)) return;
        const pos = evt.position ?? evt.cyPosition ?? { x: 0, y: 0 };
        if (pendingElementNameDraft) {
          const id = stageElement({
            type: pendingElementNameDraft.type,
            name: pendingElementNameDraft.name,
            description: pendingElementNameDraft.description,
            placement: { x: pos.x, y: pos.y },
            visualKind: pendingElementNameDraft.visualKind,
          });
          if (!id) return;
          openPropertiesPanel({ elementId: id, elementType: pendingElementNameDraft.type, dock: 'right', readOnly: false });
          setPendingElementNameDraft(null);
          setPendingElementType(null);
          setPlacement(null);
          setToolMode('SELECT');
          setPlacementModeActive(false);
          resetToolDrafts();
          return;
        }
        setPlacement({ x: pos.x, y: pos.y });
        form.setFieldsValue({ name: `New ${pendingElementLabel ?? pendingElementType}`, description: '' });
        setCreateModalOpen(true);
        setToolMode('SELECT');
        setPlacementModeActive(false);
        return;
      }

      if (
        currentToolMode === 'CREATE_RELATIONSHIP' &&
        currentRelationshipType &&
        evt.target !== cyRef.current &&
        !relationshipDraftRef.current.dragging
      ) {
        const node = evt.target;
        const id = String(node.id());
        if (!id) return;

        if (!relationshipSourceId) {
          setRelationshipSourceId(id);
          if (cyRef.current) {
            cyRef.current.nodes().removeClass('connectionSource');
            node.addClass('connectionSource');
          }
          updateRelationshipDraft({
            sourceId: id,
            targetId: null,
            valid: null,
            message: 'Source selected. Choose a target to connect.',
            dragging: false,
          });
          return;
        }

        if (relationshipSourceId === id) return;

        const validation = validateRelationshipEndpoints(relationshipSourceId, id, currentRelationshipType);
        if (!validation.valid) {
          addGovernanceWarningEdge({
            fromId: relationshipSourceId,
            toId: id,
            type: pendingRelationshipType,
            message: validation.message ?? 'Invalid relationship.',
          });
          setRelationshipSourceId(null);
          setRelationshipTargetId(null);
          updateRelationshipDraft({ sourceId: null, targetId: null, valid: false, message: validation.message ?? null, dragging: false });
          clearRelationshipDraftArtifacts();
          return;
        }

        const creation = createRelationshipFromCanvas({
          fromId: relationshipSourceId,
          toId: id,
          type: currentRelationshipType,
        });
        if (!creation.ok) {
          addGovernanceWarningEdge({
            fromId: relationshipSourceId,
            toId: id,
            type: pendingRelationshipType,
            message: creation.error ?? 'Invalid relationship.',
          });
        }
        setRelationshipSourceId(null);
        setRelationshipTargetId(null);
        updateRelationshipDraft({ sourceId: null, targetId: null, valid: null, message: null, dragging: false });
        clearRelationshipDraftArtifacts();
      }

      if (currentToolMode === 'CREATE_FREE_CONNECTOR' && currentFreeConnectorKind && evt.target !== cyRef.current) {
        const node = evt.target;
        const id = String(node.id());
        if (!id) return;
        if (!freeConnectorSourceId) {
          setFreeConnectorSourceId(id);
          message.info('Free connector: choose a target node.');
          return;
        }
        if (freeConnectorSourceId === id) return;
        const edgeId = `free-conn-${generateUUID()}`;
        cyRef.current?.add({
          data: {
            id: edgeId,
            source: freeConnectorSourceId,
            target: id,
            freeConnector: true,
            freeConnectorKind: currentFreeConnectorKind,
          },
        });
        setFreeConnectors((prev) => [...prev, { id: edgeId, source: freeConnectorSourceId, target: id, kind: currentFreeConnectorKind }]);
        setFreeConnectorSourceId(null);
        setToolMode('SELECT');
        setPendingFreeConnectorKind(null);
      }
    };

    const handleDragStart = (evt: any) => {
      if (!cyRef.current) return;
      const currentToolMode = toolModeRef.current;
      const currentRelationshipType = pendingRelationshipTypeRef.current;
      const currentFreeConnectorKind = pendingFreeConnectorKindRef.current;
      const node = evt.target;
      if (!node || node === cyRef.current) return;
      if (node.data('draftTarget')) return;
      const sourceId = String(node.id());
      if (!sourceId) return;
      const cy = cyRef.current;
      const dragPos =
        evt?.position ??
        evt?.cyPosition ??
        connectionDragPositionsRef.current.get(sourceId) ??
        undefined;
      if (currentToolMode === 'CREATE_FREE_CONNECTOR' && currentFreeConnectorKind) {
        suppressConnectionTapRef.current = true;
        freeConnectorDragRef.current = { sourceId, dragging: true };
        setFreeConnectorSourceId(sourceId);
        if (cy.getElementById(DRAFT_EDGE_ID).empty()) {
          cy.add({
            data: {
              id: DRAFT_EDGE_ID,
              source: sourceId,
              target: sourceId,
              draft: true,
              freeConnectorKind: currentFreeConnectorKind,
            },
          });
        } else {
          const edge = cy.getElementById(DRAFT_EDGE_ID);
          edge.data('source', sourceId);
          edge.data('target', sourceId);
          edge.data('freeConnectorKind', currentFreeConnectorKind);
        }
        updateDraftEdgeTarget(dragPos, null, true, sourceId);
        return;
      }
      if (!currentRelationshipType) return;
      if (relationshipDraftRef.current.dragging && relationshipDraftRef.current.sourceId === sourceId) return;
      if (!cy.getElementById(DRAFT_EDGE_ID).empty()) {
        cy.getElementById(DRAFT_EDGE_ID).remove();
      }
      removeDraftTarget();
      cy.nodes().removeClass('connectionSource');
      node.addClass('connectionSource');
      connectionPointerActiveRef.current = true;
      connectionDragLockRef.current = true;
      setConnectionDragLocked(true);
      lockNodesForConnection();
      const pointerId = evt?.originalEvent?.pointerId;
      if (typeof pointerId === 'number') {
        connectionPointerIdRef.current = pointerId;
        if (containerRef.current) {
          try {
            containerRef.current.setPointerCapture(pointerId);
          } catch {
            // Best-effort only.
          }
        }
      }
      suppressConnectionTapRef.current = true;
      const validTargets = relationshipEligibilityRef.current.get(sourceId) || getValidTargetsForSource(sourceId, currentRelationshipType);

      cy.nodes().forEach((n) => {
        const id = String(n.id());
        if (id === sourceId) return;
        n.removeClass('validTarget');
        n.removeClass('invalidTarget');
        n.removeClass('validTargetCandidate');
        if (validTargets.has(id)) n.addClass('validTargetCandidate');
      });

      cy.add({
        data: {
          id: DRAFT_EDGE_ID,
          source: sourceId,
          target: sourceId,
          draft: true,
          relationshipStyle: relationshipStyleForType(currentRelationshipType),
          relationshipType: currentRelationshipType,
        },
      });
      updateDraftEdgeTarget(dragPos, null, true, sourceId);
      setRelationshipSourceId(sourceId);
      setRelationshipTargetId(null);
      updateRelationshipDraft({
        sourceId,
        targetId: null,
        valid: null,
        message: 'Drag to a target element to validate.',
        dragging: true,
      });
    };

    const handleDragOverNode = (evt: any) => {
      const currentToolMode = toolModeRef.current;
      const currentRelationshipType = pendingRelationshipTypeRef.current;
      if (currentToolMode !== 'CREATE_RELATIONSHIP' || !currentRelationshipType) return;
      if (!relationshipDraftRef.current.dragging || !relationshipDraftRef.current.sourceId) return;
      if (!cyRef.current) return;
      if (cyRef.current.getElementById(DRAFT_EDGE_ID).empty()) return;
      const node = evt.target;
      if (!node || node === cyRef.current) return;
      const targetId = String(node.id());
      if (!targetId || targetId === relationshipDraftRef.current.sourceId) return;
      cyRef.current?.nodes().removeClass('validTarget').removeClass('invalidTarget');
      const validation = validateRelationshipEndpoints(relationshipDraftRef.current.sourceId, targetId, currentRelationshipType);
      cyRef.current?.nodes().removeClass('validTarget').removeClass('invalidTarget');
      if (validation.valid) {
        node.addClass('validTarget');
      } else {
        node.addClass('invalidTarget');
      }
      const edge = cyRef.current.getElementById(DRAFT_EDGE_ID);
      if (!edge.empty()) {
        if (validation.valid) {
          edge.data('target', targetId);
          edge.style('target-endpoint', 'outside-to-node');
        }
      }
      updateRelationshipDraft({
        sourceId: relationshipDraftRef.current.sourceId,
        targetId,
        valid: validation.valid,
        message: validation.message,
        dragging: true,
      });
    };

    const handleDragOutNode = (evt: any) => {
      const currentToolMode = toolModeRef.current;
      const currentRelationshipType = pendingRelationshipTypeRef.current;
      if (currentToolMode !== 'CREATE_RELATIONSHIP' || !currentRelationshipType) return;
      if (!relationshipDraftRef.current.dragging) return;
      if (!cyRef.current) return;
      if (cyRef.current.getElementById(DRAFT_EDGE_ID).empty()) return;
      const node = evt.target;
      if (!node || node === cyRef.current) return;
      node.removeClass('validTarget');
      node.removeClass('invalidTarget');
      const edge = cyRef.current.getElementById(DRAFT_EDGE_ID);
      if (!edge.empty()) {
        updateDraftEdgeTarget(getFallbackAnchorPos(relationshipDraftRef.current.sourceId), null, false, relationshipDraftRef.current.sourceId);
      }
    };

    const handleDragEnd = (evt: any) => {
      const currentToolMode = toolModeRef.current;
      const currentRelationshipType = pendingRelationshipTypeRef.current;
      if (currentToolMode === 'CREATE_FREE_CONNECTOR' && freeConnectorDragRef.current.dragging) {
        const node = evt.target;
        if (!node || node === cyRef.current) {
          freeConnectorDragRef.current = { sourceId: null, dragging: false };
          setFreeConnectorSourceId(null);
          cyRef.current?.getElementById(DRAFT_EDGE_ID)?.remove();
          removeDraftTarget();
          return;
        }
        const targetId = String(node.id());
        const sourceId = freeConnectorDragRef.current.sourceId;
        if (!targetId || !sourceId || targetId === sourceId) {
          freeConnectorDragRef.current = { sourceId: null, dragging: false };
          setFreeConnectorSourceId(null);
          cyRef.current?.getElementById(DRAFT_EDGE_ID)?.remove();
          removeDraftTarget();
          return;
        }
        const edgeId = `free-conn-${generateUUID()}`;
        const connectorKind = pendingFreeConnectorKindRef.current ?? 'arrow';
        cyRef.current?.add({
          data: {
            id: edgeId,
            source: sourceId,
            target: targetId,
            freeConnector: true,
            freeConnectorKind: connectorKind,
          },
        });
        setFreeConnectors((prev) => [...prev, { id: edgeId, source: sourceId, target: targetId, kind: connectorKind }]);
        freeConnectorDragRef.current = { sourceId: null, dragging: false };
        setFreeConnectorSourceId(null);
        setToolMode('SELECT');
        setPendingFreeConnectorKind(null);
        cyRef.current?.getElementById(DRAFT_EDGE_ID)?.remove();
        removeDraftTarget();
        return;
      }
      if (currentToolMode !== 'CREATE_RELATIONSHIP' || !currentRelationshipType) return;
      if (!relationshipDraftRef.current.dragging || !relationshipDraftRef.current.sourceId) return;
      const node = evt.target;
      if (!node || node === cyRef.current) {
        updateRelationshipDraft({ sourceId: null, targetId: null, valid: null, message: null, dragging: false });
        setRelationshipSourceId(null);
        setRelationshipTargetId(null);
        cyRef.current?.getElementById(DRAFT_EDGE_ID)?.remove();
        removeDraftTarget();
        cyRef.current?.nodes().removeClass('validTarget').removeClass('invalidTarget').removeClass('validTargetCandidate');
        releaseConnectionDragLock();
        setPendingRelationshipType(null);
        pendingRelationshipTypeRef.current = null;
        setToolMode('SELECT');
        toolModeRef.current = 'SELECT';
        return;
      }

      const targetId = String(node.id());
      if (!targetId || targetId === relationshipDraftRef.current.sourceId) {
        updateRelationshipDraft({ sourceId: null, targetId: null, valid: null, message: null, dragging: false });
        setRelationshipSourceId(null);
        setRelationshipTargetId(null);
        cyRef.current?.getElementById(DRAFT_EDGE_ID)?.remove();
        removeDraftTarget();
        cyRef.current?.nodes().removeClass('validTarget').removeClass('invalidTarget').removeClass('validTargetCandidate');
        releaseConnectionDragLock();
        setPendingRelationshipType(null);
        pendingRelationshipTypeRef.current = null;
        setToolMode('SELECT');
        toolModeRef.current = 'SELECT';
        return;
      }

      if (!node.hasClass('validTargetCandidate')) {
        updateRelationshipDraft({ sourceId: null, targetId: null, valid: false, message: null, dragging: false });
        setRelationshipSourceId(null);
        setRelationshipTargetId(null);
        cyRef.current?.getElementById(DRAFT_EDGE_ID)?.remove();
        removeDraftTarget();
        cyRef.current?.nodes().removeClass('validTarget').removeClass('invalidTarget').removeClass('validTargetCandidate');
        releaseConnectionDragLock();
        setPendingRelationshipType(null);
        pendingRelationshipTypeRef.current = null;
        setToolMode('SELECT');
        toolModeRef.current = 'SELECT';
        return;
      }

      const validation = validateRelationshipEndpoints(relationshipDraftRef.current.sourceId, targetId, currentRelationshipType);
      if (!validation.valid) {
        updateRelationshipDraft({ sourceId: null, targetId: null, valid: false, message: null, dragging: false });
        setRelationshipSourceId(null);
        setRelationshipTargetId(null);
        cyRef.current?.getElementById(DRAFT_EDGE_ID)?.remove();
        removeDraftTarget();
        cyRef.current?.nodes().removeClass('validTarget').removeClass('invalidTarget').removeClass('validTargetCandidate');
        releaseConnectionDragLock();
        setPendingRelationshipType(null);
        pendingRelationshipTypeRef.current = null;
        setToolMode('SELECT');
        toolModeRef.current = 'SELECT';
        return;
      }

      const creation = createRelationshipFromCanvas({
        fromId: relationshipDraftRef.current.sourceId,
        toId: targetId,
        type: currentRelationshipType,
      });
      if (!creation.ok) {
        // Silent failure to avoid disrupting the drag flow.
      }
      updateRelationshipDraft({ sourceId: null, targetId: null, valid: null, message: null, dragging: false });
      cyRef.current?.getElementById(DRAFT_EDGE_ID)?.remove();
      removeDraftTarget();
      cyRef.current?.nodes().removeClass('validTarget').removeClass('invalidTarget').removeClass('validTargetCandidate');
      setRelationshipSourceId(null);
      setRelationshipTargetId(null);
      setPendingRelationshipType(null);
      pendingRelationshipTypeRef.current = null;
      setToolMode('SELECT');
      toolModeRef.current = 'SELECT';
      releaseConnectionDragLock();
    };

    const handleDragCancel = () => {
      if (!relationshipDraftRef.current.dragging && !freeConnectorDragRef.current.dragging) return;
      updateRelationshipDraft({ sourceId: null, targetId: null, valid: null, message: null, dragging: false });
      freeConnectorDragRef.current = { sourceId: null, dragging: false };
      setFreeConnectorSourceId(null);
      cyRef.current?.getElementById(DRAFT_EDGE_ID)?.remove();
      removeDraftTarget();
      cyRef.current?.nodes().removeClass('validTarget').removeClass('invalidTarget').removeClass('validTargetCandidate');
      releaseConnectionDragLock();
      setPendingRelationshipType(null);
      pendingRelationshipTypeRef.current = null;
      setToolMode('SELECT');
      toolModeRef.current = 'SELECT';
    };

    const handleMouseMove = (evt: any) => {
      if (!relationshipDraftRef.current.dragging && !freeConnectorDragRef.current.dragging) return;
      if (!cyRef.current) return;
      if (relationshipDraftRef.current.dragging && cyRef.current.getElementById(DRAFT_EDGE_ID).empty()) return;
      const pos = evt.position ?? evt.cyPosition;
      if (!pos) return;
      if (relationshipDraftRef.current.dragging) {
        const hoverNode = findNodeAtPosition(pos);
        cyRef.current.nodes().removeClass('validTarget').removeClass('invalidTarget');
        if (hoverNode && !hoverNode.empty() && hoverNode.hasClass('validTargetCandidate')) {
          hoverNode.addClass('validTarget');
          updateDraftEdgeTarget(pos, hoverNode);
        } else {
          updateDraftEdgeTarget(pos, null, false, relationshipDraftRef.current.sourceId);
        }
      } else if (freeConnectorDragRef.current.dragging) {
        const hoverNode = findNodeAtPosition(pos);
        updateDraftEdgeTarget(pos, hoverNode, true, freeConnectorDragRef.current.sourceId);
      }
    };

    const handleNodeDrag = (evt: any) => {
      if (!cyRef.current) return;
      if (toolModeRef.current !== 'SELECT') return;
      if (connectionDragLockRef.current) return;
      const node = evt.target;
      if (!node || node === cyRef.current) return;
      if (!iterativeModeling && !node.data('staged') && !node.data('freeShape')) return;
      // No-op during drag to avoid React updates and extra work.
    };

    const handleNodeDragFree = (evt: any) => {
      if (!cyRef.current) return;
      if (toolModeRef.current !== 'SELECT') {
        return;
      }
      if (connectionDragLockRef.current) return;
      const node = evt.target;
      if (!node || node === cyRef.current) return;
      if (!iterativeModeling && !node.data('staged') && !node.data('freeShape')) return;
      draggingRef.current = false;
      cyRef.current.edges().removeClass('dragEdgesHidden');

      const restoreNodeSize = (n: any) => {
        const prev = n.scratch('_dragSizeLock') as
          | {
              width?: string;
              height?: string;
              textWrap?: string;
              textMaxWidth?: string;
            }
          | undefined;
        if (prev) {
          if (prev.width != null) n.style('width', prev.width);
          if (prev.height != null) n.style('height', prev.height);
          if (prev.textWrap != null) n.style('text-wrap', prev.textWrap);
          if (prev.textMaxWidth != null) n.style('text-max-width', prev.textMaxWidth);
        }
        n.removeScratch('_dragSizeLock');
      };

      if (!snapTemporarilyDisabled) {
        const selected = cyRef.current.nodes(':selected');
        if (selected.length > 1) {
          selected.forEach((n) => {
            if (!iterativeModeling && !n.data('staged') && !n.data('freeShape')) return;
            const pos = n.position();
            const snapped = snapToGridCenter({ x: pos.x, y: pos.y });
            n.position({ x: snapped.x, y: snapped.y });
          });
        } else {
          const pos = node.position();
          const snapped = snapToGridCenter({ x: pos.x, y: pos.y });
          node.position({ x: snapped.x, y: snapped.y });
        }
      }

      const selected = cyRef.current.nodes(':selected');
      if (selected.length > 1) {
        selected.forEach((n) => restoreNodeSize(n));
      } else {
        restoreNodeSize(node);
      }
      setAlignmentGuides({ x: null, y: null });
      refreshConnectionPositionSnapshot();
    };

    const handleNodeGrab = (evt: any) => {
      if (!cyRef.current) return;
      if (toolModeRef.current !== 'SELECT') return;
      if (connectionDragLockRef.current) return;
      const node = evt.target as any;
      if (!node || node === cyRef.current) return;
      if (!iterativeModeling && !node.data('staged') && !node.data('freeShape')) return;
      draggingRef.current = true;
      cyRef.current.edges().addClass('dragEdgesHidden');

      const applySizeLock = (n: any) => {
        if (n.scratch('_dragSizeLock')) return;
        n.scratch('_dragSizeLock', {
          width: n.style('width'),
          height: n.style('height'),
          textWrap: n.style('text-wrap'),
          textMaxWidth: n.style('text-max-width'),
        });
        const width = n.width();
        const height = n.height();
        n.style('width', `${width}`);
        n.style('height', `${height}`);
        n.style('text-wrap', 'none');
        n.style('text-max-width', `${width}`);
      };

      const selected = cyRef.current.nodes(':selected');
      if (node.selected() && selected.length > 1) {
        selected.forEach((n) => applySizeLock(n));
      } else {
        applySizeLock(node);
      }
    };

    const handleDoubleTap = (evt: any) => {
      if (!cyRef.current) return;
      if (evt.target !== cyRef.current) return;
      message.info('Create new elements from the EA Toolbox. Drag from Explorer to reuse existing elements.');
    };

    const handleSelectionChange = () => {
      if (!cyRef.current) return;
      if (draggingRef.current) return;
      const selectedNodes = cyRef.current.nodes(':selected');
      const freeNodes = selectedNodes.filter((n) => n.data('freeShape'));
      const eaNodes = selectedNodes.filter((n) => !n.data('freeShape'));
      setSelectedNodeIds(eaNodes.map((n) => String(n.id())));
      setSelectedFreeShapeId(freeNodes.length === 1 ? String(freeNodes[0].id()) : null);

      const selectedEdges = cyRef.current.edges(':selected');
      const freeEdges = selectedEdges.filter((e) => e.data('freeConnector'));
      const eaEdges = selectedEdges.filter((e) => !e.data('freeConnector') && !e.data('governanceWarning'));
      setSelectedEdgeId(eaEdges.length ? String(eaEdges[0].id()) : null);
      setSelectedFreeConnectorId(freeEdges.length ? String(freeEdges[0].id()) : null);
    };

    const handleContextMenu = (evt: any) => {
      if (!evt?.target || evt.target === cyRef.current) return;
      if (evt.target.data?.('freeShape')) return;
      if (!isHierarchicalView || !hierarchyRelationshipType) return;
      const nodeId = String(evt.target.id());
      if (!nodeId) return;
      const original = evt.originalEvent as MouseEvent | undefined;
      if (!original) return;
      original.preventDefault();
      setNodeContextMenu({ x: original.clientX, y: original.clientY, nodeId });
    };

    const handleNodePositionChange = (evt: any) => {
      if (!cyRef.current) return;
      const currentToolMode = toolModeRef.current;
      if (currentToolMode !== 'CREATE_RELATIONSHIP' && currentToolMode !== 'CREATE_FREE_CONNECTOR') return;
      const node = evt.target;
      if (!node || node === cyRef.current) return;
      const nodeId = String(node.id());
      if (!nodeId || node.data('draftTarget')) return;
      const snapshot = connectionDragPositionsRef.current.get(nodeId);
      if (!snapshot) return;
      const pos = evt?.position ?? evt?.cyPosition;
      if (!pos) return;
      if (Math.abs(pos.x - snapshot.x) < 0.01 && Math.abs(pos.y - snapshot.y) < 0.01) return;
      console.error(`[Studio] Node position mutated during connection mode: ${nodeId}`);
    };

    cyRef.current.on('tap', handleTap);
    cyRef.current.on('grab', 'node', handleNodeGrab);
    cyRef.current.on('drag', 'node', handleNodeDrag);
    cyRef.current.on('dragfree', 'node', handleNodeDragFree);
    cyRef.current.on('mousedown', 'node', handleDragStart);
    cyRef.current.on('tapstart', 'node', handleDragStart);
    cyRef.current.on('mouseover', 'node', handleDragOverNode);
    cyRef.current.on('mouseout', 'node', handleDragOutNode);
    cyRef.current.on('mouseup', 'node', handleDragEnd);
    cyRef.current.on('tapend', 'node', handleDragEnd);
    cyRef.current.on('mouseup', handleDragCancel);
    cyRef.current.on('tapend', handleDragCancel);
    cyRef.current.on('mousemove', handleMouseMove);
    cyRef.current.on('dbltap', handleDoubleTap);
    cyRef.current.on('dblclick', handleDoubleTap);
    cyRef.current.on('select unselect', 'node', handleSelectionChange);
    cyRef.current.on('select unselect', 'edge', handleSelectionChange);
    cyRef.current.on('cxttap', 'node', handleContextMenu);
    cyRef.current.on('position', 'node', handleNodePositionChange);

    return () => {
      cyRef.current?.removeListener('tap', handleTap);
      cyRef.current?.removeListener('grab', 'node', handleNodeGrab);
      cyRef.current?.removeListener('drag', 'node', handleNodeDrag);
      cyRef.current?.removeListener('dragfree', 'node', handleNodeDragFree);
      cyRef.current?.removeListener('mousedown', handleDragStart);
      cyRef.current?.removeListener('tapstart', handleDragStart);
      cyRef.current?.removeListener('mouseover', handleDragOverNode);
      cyRef.current?.removeListener('mouseout', handleDragOutNode);
      cyRef.current?.removeListener('mouseup', handleDragEnd);
      cyRef.current?.removeListener('tapend', handleDragEnd);
      cyRef.current?.removeListener('mouseup', handleDragCancel);
      cyRef.current?.removeListener('tapend', handleDragCancel);
      cyRef.current?.removeListener('mousemove', handleMouseMove);
      cyRef.current?.removeListener('dbltap', handleDoubleTap);
      cyRef.current?.removeListener('dblclick', handleDoubleTap);
      cyRef.current?.removeListener('select unselect', 'node', handleSelectionChange);
      cyRef.current?.removeListener('select unselect', 'edge', handleSelectionChange);
      cyRef.current?.removeListener('cxttap', 'node', handleContextMenu);
      cyRef.current?.removeListener('position', 'node', handleNodePositionChange);
      draggingRef.current = false;
    };
  }, [addGovernanceWarningEdge, canDiagramMode, clearRelationshipDraftArtifacts, createRelationshipFromCanvas, getAlignmentGuideForNode, getFallbackAnchorPos, getValidTargetsForSource, hierarchyRelationshipType, isHierarchicalView, isLargeGraph, iterativeModeling, lockNodesForConnection, openPropertiesPanel, pendingElementType, pendingElementVisualKind, refreshConnectionPositionSnapshot, releaseConnectionDragLock, removeDraftTarget, resolveElementLabel, snapPosition, updateDraftEdgeTarget, updateRelationshipDraft, validateRelationshipEndpoints]);

  React.useEffect(() => {
    return () => {
      try {
        cyRef.current?.destroy();
      } catch {
        // Best-effort only.
      } finally {
        cyRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    if (!nodeContextMenu) return;
    const handleDismiss = () => setNodeContextMenu(null);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNodeContextMenu(null);
    };
    window.addEventListener('click', handleDismiss);
    window.addEventListener('contextmenu', handleDismiss);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', handleDismiss);
      window.removeEventListener('contextmenu', handleDismiss);
      window.removeEventListener('keydown', handleKey);
    };
  }, [nodeContextMenu]);

  React.useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    const panEnabled = toolMode === 'PAN';
    const selectEnabled = toolMode === 'SELECT';
    const connectionMode = toolMode === 'CREATE_RELATIONSHIP' || toolMode === 'CREATE_FREE_CONNECTOR';
    cy.userPanningEnabled(presentationView ? true : panEnabled);
    cy.boxSelectionEnabled(presentationView ? false : selectEnabled);
    cy.autoungrabify(presentationView ? true : panEnabled || connectionDragLocked || connectionMode);
    if (presentationView || connectionDragLocked || connectionMode) {
      cy.nodes().forEach((node) => node.grabbable(false));
    }
  }, [connectionDragLocked, presentationView, toolMode]);

  React.useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    const fontSize = presentationView ? 14 : 11;
    cy.style().selector('node').style('font-size', fontSize).update();
    if (presentationView || connectionDragLocked) {
      cy.nodes().forEach((node) => node.grabbable(false));
    } else {
      cy.nodes().forEach((node) => {
        const isStaged = Boolean(node.data('staged'));
        const isFreeShape = Boolean(node.data('freeShape'));
        node.grabbable(!viewReadOnly && (isFreeShape || isStaged || iterativeModeling));
      });
    }
  }, [connectionDragLocked, iterativeModeling, presentationView, toolMode, viewReadOnly]);

  React.useEffect(() => {
    applyLayerVisibility();
  }, [applyLayerVisibility, stagedElements, stagedRelationships]);

  React.useEffect(() => {
    if (!cyRef.current || !eaRepository) return;
    const cy = cyRef.current;
    cy.nodes().filter((n) => !n.data('freeShape')).forEach((n) => {
      const id = String(n.id());
      const repoObj = eaRepository.objects.get(id);
      if (!repoObj) return;
      const nextName = nameForObject(repoObj);
      if (n.data('label') !== nextName) n.data('label', nextName);
      const nextType = repoObj.type as ObjectType;
      const visualData = buildEaVisualData({ type: nextType, attributes: repoObj.attributes ?? undefined });
      n.data('elementType', nextType);
      n.data('eaShape', visualData.eaShape);
      n.data('eaIcon', visualData.eaIcon);
      n.data('eaColor', visualData.eaColor);
      n.data('eaBorder', visualData.eaBorder);
      n.data('eaVisualKind', visualData.eaVisualKind);
    });
    cy.nodes().filter((n) => n.data('freeShape')).forEach((n) => {
      const label = String(n.data('label') ?? '').trim();
      const kind = String(n.data('freeShapeKind') ?? '');
      const def = FREE_SHAPE_DEFINITIONS.find((s) => s.kind === kind as FreeShapeKind);
      if (def && label === def.label) {
        n.data('label', '');
      }
    });
  }, [eaRepository, stagedElements.length]);

  const lastWorkspaceSyncRef = React.useRef<{ id: string; updatedAt: string } | null>(null);

  React.useEffect(() => {
    const last = lastWorkspaceSyncRef.current;
    if (!last || last.id !== designWorkspace.id || last.updatedAt !== designWorkspace.updatedAt) {
      setStagedElements(designWorkspace.stagedElements ?? []);
      setStagedRelationships(designWorkspace.stagedRelationships ?? []);
      lastWorkspaceSyncRef.current = { id: designWorkspace.id, updatedAt: designWorkspace.updatedAt };
    }
  }, [designWorkspace.id, designWorkspace.updatedAt, designWorkspace.stagedElements, designWorkspace.stagedRelationships]);

  React.useEffect(() => {
    if (!cyRef.current) return;
    try {
      const workspace: DesignWorkspace = {
        ...designWorkspace,
        stagedElements,
        stagedRelationships,
      };
      const viewLayout = activeViewId && activeView ? buildLayoutFromView(activeView) : null;
      const viewFreeShapes = (activeView?.layoutMetadata as any)?.freeShapes ?? [];
      const viewFreeConnectors = (activeView?.layoutMetadata as any)?.freeConnectors ?? [];
      const freeShapesSeed = activeViewId && activeView ? viewFreeShapes : freeShapes;
      const freeConnectorsSeed = activeViewId && activeView ? viewFreeConnectors : freeConnectors;
      if (activeViewId && activeView) {
        setFreeShapes(viewFreeShapes);
        setFreeConnectors(viewFreeConnectors);
      }
      const cy = cyRef.current;
      cy.elements().remove();
      const baseNodes = viewLayout?.nodes ?? workspace.layout?.nodes;
      const nodes: DesignWorkspaceLayoutNode[] = baseNodes
        ? [...baseNodes]
        : workspace.stagedElements.map((el, index) => ({
          id: el.id,
          label: el.name,
          elementType: el.type,
          x: 80 + (index % 3) * 160,
          y: 80 + Math.floor(index / 3) * 120,
        }));

      if (baseNodes) {
        const nodeIdSet = new Set(nodes.map((n) => n.id));
        workspace.stagedElements.forEach((el, index) => {
          if (nodeIdSet.has(el.id)) return;
          const offset = nodes.length + index;
          nodes.push({
            id: el.id,
            label: el.name,
            elementType: el.type,
            x: 80 + (offset % 3) * 160,
            y: 80 + Math.floor(offset / 3) * 120,
          });
        });
      }

      const baseEdges = viewLayout?.edges ?? workspace.layout?.edges;
      const edges: DesignWorkspaceLayoutEdge[] = baseEdges
        ? [...baseEdges]
        : workspace.stagedRelationships.map((rel) => ({
          id: rel.id,
          source: rel.fromId,
          target: rel.toId,
          relationshipType: rel.type,
        }));

      if (baseEdges) {
        const edgeIdSet = new Set(edges.map((e) => e.id));
        workspace.stagedRelationships.forEach((rel) => {
          if (edgeIdSet.has(rel.id)) return;
          edges.push({
            id: rel.id,
            source: rel.fromId,
            target: rel.toId,
            relationshipType: rel.type,
          });
        });
      }
      const stagedElementIdSet = new Set(workspace.stagedElements.map((el) => el.id));
      const stagedRelationshipIdSet = new Set(workspace.stagedRelationships.map((rel) => rel.id));
      nodes.forEach((n) => {
        const isStaged = stagedElementIdSet.has(n.id);
        const repoObj = eaRepository?.objects.get(n.id);
        const repoName = repoObj ? nameForObject(repoObj) : n.label;
        const repoType = (repoObj?.type as ObjectType | undefined) ?? (n.elementType as ObjectType | undefined);
        const visualData = repoType
          ? buildEaVisualData({ type: repoType, attributes: repoObj?.attributes ?? undefined })
          : { eaShape: undefined, eaIcon: undefined, eaColor: undefined, eaBorder: undefined, eaVisualKind: undefined };
        cy.add({
          data: {
            id: n.id,
            label: repoName,
            elementType: repoType ?? n.elementType,
            staged: isStaged,
            ...visualData,
          },
          position: { x: n.x, y: n.y },
        });
        const node = cy.getElementById(n.id);
        if (node && !node.empty()) {
          node.grabbable(!viewReadOnly && (Boolean(isStaged) || iterativeModeling));
        }
      });
      edges.forEach((e) => {
        const isStaged = stagedRelationshipIdSet.has(e.id);
        cy.add({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            relationshipType: e.relationshipType,
            relationshipStyle: relationshipStyleForType(e.relationshipType as RelationshipType),
            staged: isStaged,
          },
        });
      });
      freeShapesSeed.forEach((shape: FreeShape) => {
        cy.add({
          data: {
            id: shape.id,
            label: shape.label,
            freeShape: true,
            freeShapeKind: shape.kind,
            width: shape.width,
            height: shape.height,
            shape: FREE_SHAPE_DEFINITIONS.find((s) => s.kind === shape.kind)?.shape ?? 'round-rectangle',
          },
          position: { x: shape.x, y: shape.y },
        });
        const node = cy.getElementById(shape.id);
        if (node && !node.empty()) {
          node.grabbable(!viewReadOnly);
        }
      });
      freeConnectorsSeed.forEach((connector: FreeConnector) => {
        cy.add({
          data: {
            id: connector.id,
            source: connector.source,
            target: connector.target,
            freeConnector: true,
            freeConnectorKind: connector.kind,
          },
        });
      });
      setIsLargeGraph(cy.nodes().length > LARGE_GRAPH_THRESHOLD);
      if (!workspace.layout?.nodes?.length && nodes.length > 0) {
        cy.layout({ name: 'grid', fit: true, avoidOverlap: true }).run();
      }
      applyLayerVisibility();
    } catch {
      message.error('Workspace load failed. Staged items were not applied.');
      cyRef.current?.elements().remove();
    }
  }, [activeView, activeViewId, applyLayerVisibility, buildLayoutFromView, designWorkspace, eaRepository, iterativeModeling, stagedElements, stagedRelationships, viewReadOnly]);

  const handleExit = React.useCallback(() => {
    if (stagedElements.length > 0 || stagedRelationships.length > 0) {
      Modal.confirm({
        title: 'Exit Studio with uncommitted changes?',
        content: 'Choose how to handle your draft workspace before leaving Studio.',
        okText: 'Save Workspace',
        cancelText: 'Cancel',
        okButtonProps: { type: 'primary' },
        onOk: () => {
          saveWorkspaceDraft();
          onExit();
        },
        onCancel: () => {
          // Cancel exit
        },
        footer: (_, { OkBtn, CancelBtn }) => (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button
              type="primary"
              disabled={commitDisabled}
              onClick={() => {
                setCommitOpen(true);
                Modal.destroyAll();
              }}
            >
              Commit Workspace
            </Button>
            <Button
              danger
              onClick={() => {
                setDiscardOpen(true);
                Modal.destroyAll();
              }}
            >
              Discard Workspace
            </Button>
            <CancelBtn />
            <OkBtn />
          </div>
        ),
      });
      return;
    }

    setPendingElementType(null);
    setPendingElementVisualKind(null);
    setPlacement(null);
    setCreateModalOpen(false);
    setAuditPreviewOpen(false);
    setPendingElementDraft(null);
    setPendingRelationshipType(null);
    setRelationshipSourceId(null);
    setRelationshipTargetId(null);
    setPlacementModeActive(false);
    setPlacementGuide(null);
    form.resetFields();
    onExit();
  }, [form, onExit, saveWorkspaceDraft, stagedElements.length, stagedRelationships.length]);

  React.useEffect(() => {
    if (!stagedInitRef.current) {
      stagedInitRef.current = true;
      return;
    }
    if (stagedElements.length > 0 || stagedRelationships.length > 0) {
      setValidationGateOpen(true);
    }
  }, [stagedElements.length, stagedRelationships.length]);

  const governance = React.useMemo(() => {
    if (!eaRepository) return null;
    try {
      return buildGovernanceDebt(eaRepository, new Date(), {
        lifecycleCoverage: metadata?.lifecycleCoverage ?? null,
        governanceMode: metadata?.governanceMode ?? null,
      });
    } catch {
      return null;
    }
  }, [eaRepository, metadata?.governanceMode, metadata?.lifecycleCoverage]);

  const validationSummary = React.useMemo(() => {
    if (!governance) return null;
    const repoFindings = governance.repoReport.findings ?? [];
    const relFindings = governance.relationshipReport.findings ?? [];
    const isErrorSeverity = (sev?: string) => sev === 'ERROR' || sev === 'BLOCKER';
    const isWarningSeverity = (sev?: string) => sev === 'WARNING';
    const isInfoSeverity = (sev?: string) => sev === 'INFO';
    const errors = [...repoFindings, ...relFindings].filter((f) => isErrorSeverity(f.severity));
    const warnings = [...repoFindings, ...relFindings].filter((f) => isWarningSeverity(f.severity));
    const infos = [...repoFindings, ...relFindings].filter((f) => isInfoSeverity(f.severity));
    const issueErrors = (
      (governance.invalidRelationshipInserts ?? []).filter((issue) => isErrorSeverity(issue.severity))
    ).map((issue) => `Relationship insert: ${issue.message}`);
    const issueWarnings = (
      (governance.invalidRelationshipInserts ?? []).filter((issue) => isWarningSeverity(issue.severity))
    ).map((issue) => `Relationship insert: ${issue.message}`);
    const issueInfos = (
      (governance.invalidRelationshipInserts ?? []).filter((issue) => isInfoSeverity(issue.severity))
    ).map((issue) => `Relationship insert: ${issue.message}`);
    const lifecycleErrorIssues = (
      (governance.lifecycleTagMissingIds ?? []).filter((issue) => isErrorSeverity(issue.severity))
    ).map((issue) => `Lifecycle tag missing: ${issue.id}`);
    const lifecycleWarningIssues = (
      (governance.lifecycleTagMissingIds ?? []).filter((issue) => isWarningSeverity(issue.severity))
    ).map((issue) => `Lifecycle tag missing: ${issue.id}`);
    const lifecycleInfoIssues = (
      (governance.lifecycleTagMissingIds ?? []).filter((issue) => isInfoSeverity(issue.severity))
    ).map((issue) => `Lifecycle tag missing: ${issue.id}`);
    const extraErrors = issueErrors.length + lifecycleErrorIssues.length;
    const extraWarnings = issueWarnings.length + lifecycleWarningIssues.length;
    const extraInfos = issueInfos.length + lifecycleInfoIssues.length;

    const errorMessages = [...errors.map((f) => f.message), ...issueErrors, ...lifecycleErrorIssues];
    const warningMessages = [...warnings.map((f) => f.message), ...issueWarnings, ...lifecycleWarningIssues];
    const infoMessages = [...infos.map((f) => f.message), ...issueInfos, ...lifecycleInfoIssues];

    if (iterativeModeling) {
      const guidance = [...errorMessages, ...warningMessages, ...infoMessages];
      return {
        errorCount: 0,
        warningCount: 0,
        infoCount: guidance.length,
        errorHighlights: [],
        warningHighlights: [],
        infoHighlights: guidance.slice(0, 3),
      };
    }

    return {
      errorCount: errors.length + extraErrors,
      warningCount: warnings.length + extraWarnings,
      infoCount: infos.length + extraInfos,
      errorHighlights: errorMessages.slice(0, 3),
      warningHighlights: warningMessages.slice(0, 3),
      infoHighlights: infoMessages.slice(0, 3),
    };
  }, [governance, iterativeModeling]);

  React.useEffect(() => {
    try {
      localStorage.setItem(guidanceIgnoreStorageKey, JSON.stringify(ignoredGuidance));
    } catch {
      // Best-effort only.
    }
  }, [guidanceIgnoreStorageKey, ignoredGuidance]);

  React.useEffect(() => {
    try {
      localStorage.setItem(designPromptIgnoreStorageKey, JSON.stringify(ignoredDesignPrompts));
    } catch {
      // Best-effort only.
    }
  }, [designPromptIgnoreStorageKey, ignoredDesignPrompts]);

  const designModePrompts = React.useMemo(
    () => [
      {
        id: 'EA_ONLY_DESIGN',
        title: 'Prompt 1 · EA-first design',
        description:
          'Design mode prioritizes EA semantics. Use EA element and relationship types from the metamodel and the active viewpoint. Free diagram shapes are visual-only and do not affect the EA model.',
      },
      {
        id: 'NO_GENERIC_DRAWING',
        title: 'Prompt 2 · Visual-only free shapes',
        description:
          'Free diagram shapes and connectors are allowed for visual context only. They must never be treated as EA elements or relationships.',
      },
      {
        id: 'NODE_PALETTE_EA_ONLY',
        title: 'Prompt 3 · Node palette',
        description:
          'All nodes available for design must come from the EA metamodel (Business, Application, Technology, Implementation & Migration, Governance).',
      },
      {
        id: 'CONNECTOR_PALETTE_EA_ONLY',
        title: 'Prompt 4 · Connector palette',
        description: 'All connectors must represent a valid EA relationship type.',
      },
      {
        id: 'DESIGN_WITHOUT_SEMANTICS_LOSS',
        title: 'Prompt 5 · Design without semantics loss',
        description: 'Visual freedom must never violate EA semantics or layer rules.',
      },
      {
        id: 'FLEXIBLE_LAYOUT',
        title: 'Prompt 6 · Flexible layout',
        description: 'Allow users to freely position, resize, and align EA nodes to express their design intent.',
      },
      {
        id: 'INTENTIONAL_CONNECTIONS',
        title: 'Prompt 7 · Intentional connections',
        description: 'A connection must always require the user to select an explicit relationship type.',
      },
      {
        id: 'PARTIAL_DESIGNS_ALLOWED',
        title: 'Prompt 8 · Partial designs allowed',
        description: 'Allow incomplete or evolving designs as long as no invalid relationships exist.',
      },
      {
        id: 'VISUAL_GROUPING',
        title: 'Prompt 9 · Visual grouping',
        description: 'Allow visual grouping and layout patterns without creating semantic relationships.',
      },
      {
        id: 'EA_GUARDRAILS',
        title: 'Prompt 10 · EA guardrails',
        description:
          'When a design action violates EA rules, block it and explain the correct EA-compliant alternative.',
      },
    ],
    [],
  );

  const visibleDesignPrompts = React.useMemo(() => {
    if (studioModeLevel !== 'Design') return [] as typeof designModePrompts;
    return designModePrompts.filter((prompt) => !ignoredDesignPrompts.includes(prompt.id));
  }, [designModePrompts, ignoredDesignPrompts, studioModeLevel]);

  const dismissDesignPrompt = React.useCallback((promptId: string) => {
    setIgnoredDesignPrompts((prev) => (prev.includes(promptId) ? prev : [...prev, promptId]));
  }, []);

  const GUIDANCE_RULE_LABELS: Record<string, string> = {
    CAPABILITY_MISSING_OWNER: 'Capabilities missing owner',
    APPLICATION_MISSING_LIFECYCLE: 'Applications missing lifecycle',
    TECHNOLOGY_PAST_SUPPORT_END_DATE: 'Technology past support end date',
    APPLICATION_DEPENDS_ON_SELF: 'Application depends on itself',
    APPLICATION_DEPENDENCY_MISSING_STRENGTH: 'Application dependency missing strength',
    PROGRAMME_IMPACTS_RETIRED_ELEMENT: 'Programme impacts retired element',
    PROCESS_MISSING_CAPABILITY_PARENT: 'Process missing capability parent',
    EA_REQUIRED_OWNER: 'Missing owner',
    EA_INVALID_OWNER: 'Invalid owner',
    EA_ENTERPRISE_OWNERSHIP: 'Enterprise ownership required',
    EA_DEPARTMENT_REQUIRES_ENTERPRISE: 'Department requires enterprise',
    EA_BUSINESS_SERVICE_REQUIRES_CAPABILITY: 'Business service missing capability',
    EA_CAPABILITY_REQUIRES_APPLICATION_SERVICE_SUPPORT: 'Capability missing application service support',
    EA_APPLICATION_SERVICE_REQUIRES_APPLICATION: 'Application service missing application',
    EA_APPLICATION_SERVICE_REQUIRES_USAGE: 'Application service missing usage',
    EA_APPLICATION_NO_PHYSICAL_TERMS: 'Application name is physical/infra',
    EA_APPLICATION_REQUIRES_BUSINESS_PROCESS: 'Application missing business process support',
    EA_REQUIRED_NAME: 'Missing name',
    EA_FORBIDDEN_TECHNOLOGY_BUSINESS_LINK: 'Forbidden technology-business link',
    RELATIONSHIP_INSERT: 'Relationship insert issues',
    LIFECYCLE_TAG: 'Lifecycle tag missing',
  };

  const extractGuidanceCount = (message: string): number => {
    const match = message.match(/:\s*(\d+)\s/);
    if (!match) return 1;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : 1;
  };

  const extractGuidanceScope = (message: string): string | null => {
    const idx = message.indexOf(':');
    if (idx <= 0) return null;
    return message.slice(0, idx).trim();
  };

  const resolveGuidanceLabel = (checkId?: string, message?: string): string => {
    const base = (checkId && GUIDANCE_RULE_LABELS[checkId]) || checkId || 'Guidance';
    const scope = message ? extractGuidanceScope(message) : null;
    if (!scope || scope === 'Unknown') return base;
    if (base.toLowerCase().includes(scope.toLowerCase())) return base;
    return `${scope} · ${base}`;
  };

  type GuidanceItem = {
    id: string;
    ruleKey: string;
    ruleLabel: string;
    detail: string;
    count: number;
  };

  const guidanceItems = React.useMemo(() => {
    if (!governance) return [] as GuidanceItem[];
    const items: GuidanceItem[] = [];

    const shouldInclude = (severity?: string) => iterativeModeling || severity === 'INFO';
    const pushItem = (ruleKey: string, ruleLabel: string, detail: string, severity?: string) => {
      if (!shouldInclude(severity)) return;
      items.push({
        id: detail,
        ruleKey,
        ruleLabel,
        detail,
        count: extractGuidanceCount(detail),
      });
    };

    governance.repoReport.findings.forEach((f) => {
      const checkId = String((f as any).checkId ?? 'REPO');
      pushItem(checkId, resolveGuidanceLabel(checkId, f.message), f.message, f.severity);
    });
    governance.relationshipReport.findings.forEach((f) => {
      const checkId = String((f as any).checkId ?? 'RELATIONSHIP');
      pushItem(checkId, resolveGuidanceLabel(checkId, f.message), f.message, f.severity);
    });
    governance.invalidRelationshipInserts.forEach((issue) => {
      const ruleKey = 'RELATIONSHIP_INSERT';
      pushItem(ruleKey, resolveGuidanceLabel(ruleKey, issue.message), issue.message, issue.severity);
    });
    governance.lifecycleTagMissingIds.forEach((issue) => {
      const ruleKey = 'LIFECYCLE_TAG';
      pushItem(ruleKey, resolveGuidanceLabel(ruleKey, issue.message), issue.message, issue.severity);
    });

    return items;
  }, [governance, iterativeModeling]);

  const visibleGuidanceItems = React.useMemo(
    () => guidanceItems.filter((item) => !ignoredGuidance.includes(item.detail)),
    [guidanceItems, ignoredGuidance],
  );

  const guidanceGroups = React.useMemo(() => {
    const grouped = new Map<string, { ruleKey: string; ruleLabel: string; count: number; items: GuidanceItem[] }>();
    for (const item of visibleGuidanceItems) {
      const entry = grouped.get(item.ruleKey);
      if (!entry) {
        grouped.set(item.ruleKey, {
          ruleKey: item.ruleKey,
          ruleLabel: item.ruleLabel,
          count: item.count,
          items: [item],
        });
        continue;
      }
      entry.count += item.count;
      entry.items.push(item);
    }
    return Array.from(grouped.values()).sort((a, b) => a.ruleLabel.localeCompare(b.ruleLabel));
  }, [visibleGuidanceItems]);

  const visibleGuidanceCount = React.useMemo(
    () => visibleGuidanceItems.reduce((sum, item) => sum + item.count, 0),
    [visibleGuidanceItems],
  );

  const validationCount = React.useMemo(() => {
    if (!validationGateOpen || !validationSummary) return 0;
    return validationSummary.errorCount + validationSummary.warningCount + validationSummary.infoCount;
  }, [validationGateOpen, validationSummary]);

  const isDev = process.env.NODE_ENV === 'development';

  React.useEffect(() => {
    if (!isDev) return;
    const leftPrimaryActions: string[] = [];
    const commandBarPrimaryActions = ['toolMode', 'layerVisibility', 'modelingCatalog', 'workspaceContext', 'workspaceActions'];
    const rightPrimaryActions: string[] = [];

    const violations: string[] = [];
    if (leftPrimaryActions.length > 0) {
      violations.push(`Left palette contains primary actions: ${leftPrimaryActions.join(', ')}`);
    }
    if (commandBarPrimaryActions.length === 0) {
      violations.push('Yellow Studio panel missing primary actions.');
    }
    if (rightPrimaryActions.length > 0) {
      violations.push(`Right panel contains primary actions: ${rightPrimaryActions.join(', ')}`);
    }

    if (violations.length > 0) {
      console.warn('[StudioLayout] Primary action placement violation', violations);
    }
  }, [isDev]);

  React.useEffect(() => {
    if (!isDev) return;

    const getScrollableElements = (root: HTMLElement | null) => {
      if (!root) return [] as HTMLElement[];
      const elements = Array.from(root.querySelectorAll<HTMLElement>('*'));
      return elements.filter((el) => {
        const style = getComputedStyle(el);
        const overflowY = style.overflowY;
        if (overflowY !== 'auto' && overflowY !== 'scroll') return false;
        return el.scrollHeight > el.clientHeight + 1;
      });
    };

    const yellowScrollables = getScrollableElements(studioHeaderRef.current);
    if (yellowScrollables.length > 0) {
      console.warn('[StudioLayout] Yellow panel should not scroll.');
    }

    const leftScrollables = getScrollableElements(studioLeftRef.current);
    if (leftScrollables.length > 1) {
      console.warn('[StudioLayout] Left panel contains more than one scrollbar.');
    }

    const rightScrollables = getScrollableElements(studioRightRef.current);
    if (rightScrollables.length > 1) {
      console.warn('[StudioLayout] Right panel contains more than one scrollbar.');
    }

    const rightCatalogs = studioRightRef.current?.querySelectorAll('[data-role="catalog-list"]') ?? [];
    if (rightCatalogs.length > 0) {
      console.warn('[StudioLayout] Catalog browsing detected inside inspector panel.');
    }
  }, [isDev]);

  const stagedChangeCount = React.useMemo(
    () => stagedElements.length + stagedRelationships.length,
    [stagedElements.length, stagedRelationships.length],
  );

  const viewSaveLabel = React.useMemo(() => {
    if (!activeViewId) return null;
    if (viewReadOnly) return 'Read-only';
    if (viewSaveStatus === 'saving') return 'Saving…';
    if (viewSaveStatus === 'dirty') return 'Unsaved changes';
    return 'Saved';
  }, [activeViewId, viewReadOnly, viewSaveStatus]);

  const handleRenameActiveView = React.useCallback(() => {
    if (!activeViewId || !activeView) return;
    if (viewReadOnly) {
      message.warning('This view is read-only. Rename is disabled.');
      return;
    }
    let nextName = activeView.name;
    Modal.confirm({
      title: 'Rename view',
      okText: 'Rename',
      cancelText: 'Cancel',
      content: (
        <Input
          defaultValue={activeView.name}
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
        ViewStore.update(activeView.id, (current) => ({
          ...current,
          name,
        }));
        try {
          window.dispatchEvent(new Event('ea:viewsChanged'));
        } catch {
          // Best-effort only.
        }
        message.success('View renamed.');
      },
    });
  }, [activeView, activeViewId, viewReadOnly]);

  const handleDuplicateActiveView = React.useCallback(() => {
    if (!activeView) return;
    if (viewReadOnly) {
      message.warning('This view is read-only. Duplicate is disabled.');
      return;
    }
    const now = new Date().toISOString();
    const newId = `view_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const copy: ViewInstance = {
      ...activeView,
      id: newId,
      name: `${activeView.name} Copy`,
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
    ensureViewTab(saved.id, { mode: 'new' });
    message.success('View duplicated.');
  }, [activeView, actor, ensureViewTab, viewReadOnly]);

  const handleDeleteActiveView = React.useCallback(() => {
    if (!activeView) return;
    const isOwner = userRole === 'Owner';
    const isCreator = activeView.createdBy === actor;
    if (!isOwner && !isCreator) {
      message.warning('Only the view creator or repository owner can delete this view.');
      return;
    }
    Modal.confirm({
      title: 'Delete view?',
      content: 'Deleting a view removes only the view definition. Repository content remains unchanged.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: () => {
        const removed = ViewStore.remove(activeView.id);
        if (!removed) {
          message.error('Delete failed. View not found.');
          return;
        }
        if (activeTabKey !== WORKSPACE_TAB_KEY) closeViewTab(activeTabKey);
        try {
          window.dispatchEvent(new Event('ea:viewsChanged'));
        } catch {
          // Best-effort only.
        }
        message.success('View deleted.');
      },
    });
  }, [activeTabKey, activeView, actor, closeViewTab, userRole]);

  const handleExportActiveViewJson = React.useCallback(() => {
    if (!activeView) return;
    const positions = layoutPositionsForView(activeView);
    downloadJson(`${activeView.name || activeView.id}.json`, {
      view: activeView,
      layoutPositions: positions,
    });
  }, [activeView]);

  const handleExportActiveViewPng = React.useCallback(() => {
    if (!cyRef.current || !activeView) return;
    try {
      const dataUrl = cyRef.current.png({ bg: '#ffffff', full: true });
      downloadDataUrl(`${activeView.name || activeView.id}.png`, dataUrl);
    } catch {
      message.error('Failed to export PNG.');
    }
  }, [activeView]);

  const getLifecycleState = React.useCallback(
    (tab: StudioViewTab): ViewLifecycleState => {
      if (tab.readOnly) return 'READ-ONLY';
      const status = viewTabStateById[tab.key]?.saveStatus ?? 'saved';
      if (status === 'dirty' || status === 'saving') return 'DRAFT';
      return 'SAVED';
    },
    [viewTabStateById],
  );

  const lifecycleTagColor: Record<ViewLifecycleState, string> = {
    DRAFT: 'gold',
    SAVED: 'green',
    'READ-ONLY': 'default',
  };

  const [rightPanelMode, setRightPanelMode] = React.useState<RightPanelMode>(RightPanelMode.STUDIO);
  const [lastNonSwitchMode, setLastNonSwitchMode] = React.useState<RightPanelMode>(RightPanelMode.STUDIO);
  const propertiesOverrideRef = React.useRef(false);
  const [panelResetToken, setPanelResetToken] = React.useState<{ studio: number; selection: number; viewSwitch: number }>(
    {
      studio: 0,
      selection: 0,
      viewSwitch: 0,
    },
  );
  const previousRightPanelModeRef = React.useRef<RightPanelMode>(rightPanelMode);

  React.useEffect(() => {
    if (viewSwitchPanel && rightPanelMode !== RightPanelMode.VIEW_SWITCH) {
      if (propertiesOverrideRef.current) return;
      if (rightPanelMode !== RightPanelMode.VIEW_SWITCH) setLastNonSwitchMode(rightPanelMode);
      setRightPanelMode(RightPanelMode.VIEW_SWITCH);
      return;
    }
    if (!viewSwitchPanel && rightPanelMode === RightPanelMode.VIEW_SWITCH) {
      setRightPanelMode(lastNonSwitchMode);
    }
  }, [lastNonSwitchMode, rightPanelMode, viewSwitchPanel]);

  React.useEffect(() => {
    if (!viewSwitchPanel && propertiesOverrideRef.current) {
      propertiesOverrideRef.current = false;
    }
  }, [viewSwitchPanel]);

  const resetPanelState = React.useCallback(
    (mode: RightPanelMode) => {
      setPanelResetToken((prev) => {
        if (mode === RightPanelMode.SELECTION) return { ...prev, selection: prev.selection + 1 };
        if (mode === RightPanelMode.VIEW_SWITCH) return { ...prev, viewSwitch: prev.viewSwitch + 1 };
        return { ...prev, studio: prev.studio + 1 };
      });

      if (mode === RightPanelMode.SELECTION) {
        setPropertiesExpanded(false);
        setBulkEditOpen(false);
        bulkEditForm.resetFields();
        relationshipAttributesForm.resetFields();
      }

      if (mode === RightPanelMode.VIEW_SWITCH) {
        propertiesOverrideRef.current = false;
      }
    },
    [bulkEditForm, relationshipAttributesForm],
  );

  React.useEffect(() => {
    const previous = previousRightPanelModeRef.current;
    if (previous !== rightPanelMode) {
      resetPanelState(previous);
      previousRightPanelModeRef.current = rightPanelMode;
    }
  }, [resetPanelState, rightPanelMode]);

  React.useEffect(() => {
    try {
      localStorage.setItem(rightPanelStorageKey, String(studioRightWidth));
    } catch {
      // Best-effort only.
    }
  }, [rightPanelStorageKey, studioRightWidth]);

  React.useEffect(() => {
    const clamp = () => {
      const maxWidth = getStudioRightPanelMaxWidth();
      setStudioRightWidth((prev) => Math.min(maxWidth, Math.max(STUDIO_RIGHT_PANEL_MIN_WIDTH, prev)));
    };

    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, []);

  const RightPanelController: React.FC<{ title: string; children: React.ReactNode; onClose?: () => void }> = ({
    title,
    children,
    onClose,
  }) => (
    <div className={styles.studioRightSection}>
      <div className={styles.studioRightHeader}>
        <Typography.Text strong>{title}</Typography.Text>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Close panel"
          onClick={onClose}
        >
          <CloseOutlined />
        </button>
      </div>
      <div className={styles.studioRightBody}>{children}</div>
    </div>
  );

  const commitImpactPreview = React.useMemo(() => {
    const stagedTypeSet = new Set(stagedElements.map((el) => el.type));
    const stagedIdSet = new Set(stagedElements.map((el) => el.id));
    const views = ViewStore.list();

    const impactedViews = views.filter((view) => {
      const viewpoint = ViewpointRegistry.get(view.viewpointId);
      if (!viewpoint) return false;
      if (view.scope?.kind === 'ManualSelection') {
        return (view.scope.elementIds ?? []).some((id) => stagedIdSet.has(id));
      }
      return viewpoint.allowedElementTypes.some((t) => stagedTypeSet.has(t));
    });

    const relationshipTypes = Array.from(
      stagedRelationships.reduce((acc, rel) => {
        acc.add(rel.type);
        return acc;
      }, new Set<RelationshipType>()),
    );

    return {
      impactedViews,
      relationshipTypes,
    };
  }, [stagedElements, stagedRelationships]);

  const studioTabItems = React.useMemo(
    () => [
      { key: WORKSPACE_TAB_KEY, label: 'Workspace', closable: false },
      ...viewTabs.map((tab) => {
        const state = getLifecycleState(tab);
        const modeLabel = tab.readOnly ? 'READ-ONLY' : 'EDITABLE';
        return {
          key: tab.key,
          closable: true,
          label: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span>{tab.name}</span>
              <Tag color={lifecycleTagColor[state]} style={{ marginInlineEnd: 0 }}>
                {state}
              </Tag>
              <Tag color={tab.readOnly ? 'red' : 'blue'} style={{ marginInlineEnd: 0 }}>
                {modeLabel}
              </Tag>
            </span>
          ),
        };
      }),
    ],
    [getLifecycleState, viewTabs],
  );

  const diagramTypeName = React.useMemo(() => activeViewpoint?.name ?? 'Studio Workspace', [activeViewpoint?.name]);
  const diagramTypeDescription = React.useMemo(
    () =>
      activeViewpoint?.description ??
      'Free-form workspace. Diagram type controls the visual grammar, allowed elements, and relationships.',
    [activeViewpoint?.description],
  );
  const toolboxPanel = showToolbox ? (
    <div className={styles.studioToolboxPanel}>
      <div className={styles.studioToolboxHeader}>
        <div className={styles.studioToolboxTitle}>
          <AppstoreOutlined />
          <Typography.Text strong>Toolbox</Typography.Text>
        </div>
        <div className={styles.studioToolboxActions}>
          <Tooltip title={toolboxExpanded ? 'Restore width' : 'Expand to full width'}>
            <Button
              size="small"
              type="text"
              icon={toolboxExpanded ? <ShrinkOutlined /> : <ArrowsAltOutlined />}
              aria-label={toolboxExpanded ? 'Restore toolbox width' : 'Expand toolbox'}
              onClick={toggleToolboxExpanded}
            />
          </Tooltip>
          <Tooltip title={toolboxCollapsed ? 'Expand toolbox' : 'Collapse toolbox'}>
            <Button
              size="small"
              type="text"
              icon={toolboxCollapsed ? <AppstoreOutlined /> : <CloseOutlined />}
              aria-label={toolboxCollapsed ? 'Expand toolbox' : 'Collapse toolbox'}
              onClick={() =>
                setToolboxCollapsed((prev) => {
                  const next = !prev;
                  if (next && toolboxExpanded) toggleToolboxExpanded();
                  return next;
                })
              }
            />
          </Tooltip>
        </div>
      </div>
      {!toolboxCollapsed ? (
        <Tabs
          className={styles.studioToolboxTabs}
          size="small"
          items={[
            {
              key: 'components',
              label: 'Components',
              children: (
                toolboxComponentItems.length === 0 ? (
                  <Typography.Text type="secondary" className={styles.studioToolboxEmpty}>
                    No components available for this viewpoint.
                  </Typography.Text>
                ) : (
                  <div className={styles.studioToolboxGrid}>
                    {toolboxComponentItems.map((item) => {
                      const displayLabel = item.label;
                      return (
                        <Tooltip key={`${item.kind}`} title={displayLabel}>
                          <button
                            type="button"
                            className={
                              toolMode === 'CREATE_ELEMENT' && pendingElementType === item.type && pendingElementVisualKind === item.kind
                                ? styles.studioToolboxIconButtonActive
                                : styles.studioToolboxIconButton
                            }
                            disabled={toolboxInteractionDisabled}
                            draggable={!toolboxInteractionDisabled}
                            onDragStart={(e) => {
                              if (toolboxInteractionDisabled) return;
                              if (!ensureToolboxElementType(item.type as ObjectType, displayLabel, item.kind)) return;
                              e.dataTransfer.setData('application/x-ea-element-type', String(item.type));
                              e.dataTransfer.setData('application/x-ea-visual-kind', String(item.kind));
                              e.dataTransfer.effectAllowed = 'copy';
                              setPendingElementType(item.type as ObjectType);
                              setPendingElementVisualKind(item.kind);
                              setToolMode('CREATE_ELEMENT');
                            }}
                            onClick={() => {
                              if (toolboxInteractionDisabled) return;
                              if (!ensureToolboxElementType(item.type as ObjectType, displayLabel, item.kind)) return;
                              setPendingElementType(item.type as ObjectType);
                              setPendingElementVisualKind(item.kind);
                              setPendingRelationshipType(null);
                              setRelationshipSourceId(null);
                              setRelationshipTargetId(null);
                              setPlacementModeActive(false);
                              setPlacement(null);
                              setPendingElementNameDraft(null);
                              setToolMode('SELECT');
                              form.setFieldsValue({ name: `New ${displayLabel}`, description: '' });
                              setCreateModalOpen(true);
                              message.info(`Name ${displayLabel} to continue placement.`);
                            }}
                            aria-label={`Create ${displayLabel}`}
                          >
                            <span className={styles.studioToolboxIcon}>
                              <img src={item.icon} alt="" className={styles.studioToolboxIconImage} />
                            </span>
                          </button>
                        </Tooltip>
                      );
                    })}
                  </div>
                )
              ),
            },
            {
              key: 'nodes',
              label: 'Nodes',
              children: (
                toolboxTechnologyItems.length === 0 ? (
                  <Typography.Text type="secondary" className={styles.studioToolboxEmpty}>
                    No nodes available for this viewpoint.
                  </Typography.Text>
                ) : (
                  <div className={styles.studioToolboxGrid}>
                    {toolboxTechnologyItems.map((item) => {
                      const displayLabel = item.label;
                      return (
                        <Tooltip key={`${item.kind}`} title={displayLabel}>
                          <button
                            type="button"
                            className={
                              toolMode === 'CREATE_ELEMENT' && pendingElementType === item.type && pendingElementVisualKind === item.kind
                                ? styles.studioToolboxIconButtonActive
                                : styles.studioToolboxIconButton
                            }
                            disabled={toolboxInteractionDisabled}
                            draggable={!toolboxInteractionDisabled}
                            onDragStart={(e) => {
                              if (toolboxInteractionDisabled) return;
                              if (!ensureToolboxElementType(item.type as ObjectType, displayLabel, item.kind)) return;
                              e.dataTransfer.setData('application/x-ea-element-type', String(item.type));
                              e.dataTransfer.setData('application/x-ea-visual-kind', String(item.kind));
                              e.dataTransfer.effectAllowed = 'copy';
                              setPendingElementType(item.type as ObjectType);
                              setPendingElementVisualKind(item.kind);
                              setToolMode('CREATE_ELEMENT');
                            }}
                            onClick={() => {
                              if (toolboxInteractionDisabled) return;
                              if (!ensureToolboxElementType(item.type as ObjectType, displayLabel, item.kind)) return;
                              setPendingElementType(item.type as ObjectType);
                              setPendingElementVisualKind(item.kind);
                              setPendingRelationshipType(null);
                              setRelationshipSourceId(null);
                              setRelationshipTargetId(null);
                              setPlacementModeActive(false);
                              setPlacement(null);
                              setPendingElementNameDraft(null);
                              setToolMode('SELECT');
                              form.setFieldsValue({ name: `New ${displayLabel}`, description: '' });
                              setCreateModalOpen(true);
                              message.info(`Name ${displayLabel} to continue placement.`);
                            }}
                            aria-label={`Create ${displayLabel}`}
                          >
                            <span className={styles.studioToolboxIcon}>
                              <img src={item.icon} alt="" className={styles.studioToolboxIconImage} />
                            </span>
                          </button>
                        </Tooltip>
                      );
                    })}
                  </div>
                )
              ),
            },
            {
              key: 'connections',
              label: 'Connections',
              children: (
                paletteRelationships.length === 0 ? (
                  <Typography.Text type="secondary" className={styles.studioToolboxEmpty}>
                    No connections available for this viewpoint.
                  </Typography.Text>
                ) : (
                  <div className={styles.studioToolboxGrid}>
                    {paletteRelationships.map((t) => {
                      const label = resolveRelationshipLabel(t.type);
                      return (
                        <Tooltip key={t.type} title={label}>
                          <button
                            type="button"
                            className={
                              toolMode === 'CREATE_RELATIONSHIP' && pendingRelationshipType === t.type
                                ? styles.studioToolboxIconButtonActive
                                : styles.studioToolboxIconButton
                            }
                            disabled={toolboxInteractionDisabled}
                            draggable={!toolboxInteractionDisabled}
                            onDragStart={(e) => {
                              if (toolboxInteractionDisabled) return;
                              if (!ensureToolboxRelationshipType(t.type as RelationshipType, label)) return;
                              e.dataTransfer.setData('application/x-ea-relationship-type', String(t.type));
                              e.dataTransfer.effectAllowed = 'copy';
                              setToolMode('CREATE_RELATIONSHIP');
                              setPendingRelationshipType(t.type as RelationshipType);
                              toolModeRef.current = 'CREATE_RELATIONSHIP';
                              pendingRelationshipTypeRef.current = t.type as RelationshipType;
                              setPendingElementType(null);
                              setPendingElementVisualKind(null);
                              setRelationshipSourceId(null);
                              setRelationshipTargetId(null);
                              setPlacementModeActive(false);
                            }}
                            onClick={() => {
                              if (toolboxInteractionDisabled) return;
                              if (!ensureToolboxRelationshipType(t.type as RelationshipType, label)) return;
                              setToolMode('CREATE_RELATIONSHIP');
                              setPendingRelationshipType(t.type as RelationshipType);
                              toolModeRef.current = 'CREATE_RELATIONSHIP';
                              pendingRelationshipTypeRef.current = t.type as RelationshipType;
                              setPendingElementType(null);
                              setPendingElementVisualKind(null);
                              setRelationshipSourceId(null);
                              setRelationshipTargetId(null);
                              setPlacementModeActive(false);
                              // Relationship creation starts immediately on drag from a source node.
                            }}
                            aria-label={`Create ${label}`}
                          >
                            <span className={styles.studioToolboxIcon}>
                              <img src={resolveRelationshipIcon(t.type as RelationshipType, 'tool')} alt="" className={styles.studioToolboxIconImage} />
                            </span>
                          </button>
                        </Tooltip>
                      );
                    })}
                  </div>
                )
              ),
            },
            {
              key: 'connectors',
              label: 'Connectors',
              children: (
                paletteRelationships.length === 0 ? (
                  <Typography.Text type="secondary" className={styles.studioToolboxEmpty}>
                    No connectors available for this viewpoint.
                  </Typography.Text>
                ) : (
                  <div className={styles.studioToolboxGrid}>
                    {paletteRelationships.map((t) => {
                      const label = resolveRelationshipLabel(t.type);
                      return (
                        <Tooltip key={t.type} title={label}>
                          <button
                            type="button"
                            className={
                              toolMode === 'CREATE_RELATIONSHIP' && pendingRelationshipType === t.type
                                ? styles.studioToolboxIconButtonActive
                                : styles.studioToolboxIconButton
                            }
                            disabled={toolboxInteractionDisabled}
                            draggable={!toolboxInteractionDisabled}
                            onDragStart={(e) => {
                              if (toolboxInteractionDisabled) return;
                              if (!ensureToolboxRelationshipType(t.type as RelationshipType, label)) return;
                              e.dataTransfer.setData('application/x-ea-relationship-type', String(t.type));
                              e.dataTransfer.effectAllowed = 'copy';
                              setToolMode('CREATE_RELATIONSHIP');
                              setPendingRelationshipType(t.type as RelationshipType);
                              toolModeRef.current = 'CREATE_RELATIONSHIP';
                              pendingRelationshipTypeRef.current = t.type as RelationshipType;
                              setPendingElementType(null);
                              setPendingElementVisualKind(null);
                              setRelationshipSourceId(null);
                              setRelationshipTargetId(null);
                              setPlacementModeActive(false);
                            }}
                            onClick={() => {
                              if (toolboxInteractionDisabled) return;
                              if (!ensureToolboxRelationshipType(t.type as RelationshipType, label)) return;
                              setToolMode('CREATE_RELATIONSHIP');
                              setPendingRelationshipType(t.type as RelationshipType);
                              toolModeRef.current = 'CREATE_RELATIONSHIP';
                              pendingRelationshipTypeRef.current = t.type as RelationshipType;
                              setPendingElementType(null);
                              setPendingElementVisualKind(null);
                              setRelationshipSourceId(null);
                              setRelationshipTargetId(null);
                              setPlacementModeActive(false);
                              // Relationship creation starts immediately on drag from a source node.
                            }}
                            aria-label={`Create ${label}`}
                          >
                            <span className={styles.studioToolboxIcon}>
                              <img src={resolveRelationshipIcon(t.type as RelationshipType, 'connector')} alt="" className={styles.studioToolboxIconImage} />
                            </span>
                          </button>
                        </Tooltip>
                      );
                    })}
                  </div>
                )
              ),
            },
          ]}
        />
      ) : null}
    </div>
  ) : null;

  return (
    <div className={styles.studioShell} style={{ borderColor: token.colorWarningBorder }}>
      <div
        className={styles.studioHeader}
        style={{ background: token.colorWarningBg, borderColor: token.colorWarningBorder }}
        ref={studioHeaderRef}
      >
        <div className={styles.studioCommandRow}>
          <div className={styles.studioRibbonGroupSmall}>
            <Tooltip title="Studio mode controls which diagramming and modeling tools are visible.">
              <Radio.Group
                size="small"
                value={studioModeLevel}
                onChange={(e) => setStudioModeLevel(e.target.value)}
              >
                <Radio.Button value="Explore">Explore</Radio.Button>
                <Radio.Button value="Analyze">Analyze</Radio.Button>
                <Radio.Button value="Design">Design</Radio.Button>
                <Radio.Button value="Model">Model</Radio.Button>
              </Radio.Group>
            </Tooltip>
          </div>
          <div className={styles.studioRibbonGroupSmall}>
            <Tooltip title={`Diagram Type: ${diagramTypeDescription}`}>
              <div className={styles.studioRibbonItemMuted} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <NodeIndexOutlined style={{ color: token.colorTextSecondary }} />
                <Typography.Text style={{ color: token.colorTextSecondary }}>
                  Diagram Type: {diagramTypeName}
                </Typography.Text>
              </div>
            </Tooltip>
          </div>
          <div className={styles.studioRibbonGroupSmall}>
            <Tooltip title="Presentation View hides modeling tools, locks layout, and enlarges labels.">
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Typography.Text style={{ color: token.colorTextSecondary }}>Presentation View</Typography.Text>
                <Switch size="small" checked={presentationView} onChange={setPresentationView} />
              </div>
            </Tooltip>
          </div>
          {canAnalyzeMode ? (
            <div className={styles.studioRibbonGroup}>
              <div className={styles.studioRibbonGroupContent}>
                <div className={styles.studioRibbonToggleGroup}>
                  {([
                    'Business',
                    'Application',
                    'Technology',
                    'Implementation & Migration',
                    'Governance',
                  ] as const).map((layer) => (
                    <Button
                      key={layer}
                      size="small"
                      type="text"
                      className={layerVisibility[layer] ? styles.studioRibbonToggleActive : styles.studioRibbonToggle}
                      onClick={() => {
                        setLayerVisibility((prev) => ({ ...prev, [layer]: !prev[layer] }));
                      }}
                    >
                      {layer}
                    </Button>
                  ))}
                </div>
                <div className={styles.studioRibbonItemCompact}>
                  <InputNumber
                    size="small"
                    min={8}
                    max={80}
                    step={2}
                    value={gridSize}
                    onChange={(value) => {
                      const next = Number(value);
                      if (!Number.isFinite(next)) return;
                      setGridSize(Math.max(4, Math.round(next)));
                    }}
                  />
                </div>
                <Tooltip title="Alt to disable snap">
                  <InfoCircleOutlined className={styles.studioRibbonHintIcon} />
                </Tooltip>
              </div>
            </div>
          ) : null}
          <div className={styles.studioRibbonGroupMuted}>
            <div className={styles.studioRibbonItemMutedLabel}>{workspaceDisplayName}</div>
            <Tag color={isViewBoundWorkspace ? 'geekblue' : 'default'}>
              {isViewBoundWorkspace ? 'VIEW-BOUND' : 'FREE WORKSPACE'}
            </Tag>
            <Tag color={workspaceStatusColor[designWorkspace.status]}>{designWorkspace.status}</Tag>
            {designWorkspace.scope ? (
              <div className={styles.studioRibbonItemMuted}>Scope: {designWorkspace.scope}</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.studioSubHeader}>
        <div className={styles.studioSubHeaderLeft}>
          <Typography.Text strong className={styles.studioSubHeaderTitle}>
            {workspaceDisplayName}
          </Typography.Text>
          {currentRepositoryUpdatedAt &&
          designWorkspace.repositoryUpdatedAt &&
          currentRepositoryUpdatedAt !== designWorkspace.repositoryUpdatedAt ? (
            <Tag color="gold" style={{ marginInlineStart: 0 }}>
              Repository updated
            </Tag>
          ) : null}
          {designWorkspace.status === 'DISCARDED' ? (
            <Tag color={workspaceStatusColor.DISCARDED}>Discarded</Tag>
          ) : null}
          <Typography.Text type="secondary" className={styles.studioSubHeaderLabel}>
            {designWorkspace.description || 'No workspace description'}
          </Typography.Text>
        </div>
        <div className={styles.studioSubHeaderRight}>
          <Typography.Text type="secondary" className={styles.studioSubHeaderMeta}>
            Staged: {stagedChangeCount}
          </Typography.Text>
          <Typography.Text type="secondary" className={styles.studioSubHeaderMeta}>
            Validation: {validationCount}
          </Typography.Text>
        </div>
      </div>

      {visibleDesignPrompts.length > 0 ? (
        <div className={styles.studioPromptRow}>
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            {visibleDesignPrompts.map((prompt) => (
              <Alert
                key={prompt.id}
                type="info"
                showIcon
                message={prompt.title}
                description={prompt.description}
                action={
                  <Button size="small" onClick={() => dismissDesignPrompt(prompt.id)}>
                    Don’t show again
                  </Button>
                }
              />
            ))}
          </Space>
        </div>
      ) : null}

      <div className={styles.studioViewTabs}>
        <Tabs
          type="editable-card"
          size="small"
          hideAdd
          activeKey={activeTabKey}
          items={studioTabItems}
          onChange={(key) => setActiveTabKey(key)}
          onEdit={(targetKey, action) => {
            if (action !== 'remove') return;
            if (typeof targetKey !== 'string') return;
            if (targetKey === WORKSPACE_TAB_KEY) return;
            closeViewTab(targetKey);
          }}
        />
      </div>

      <div
        className={styles.studioColumns}
        style={{
          gridTemplateColumns: `minmax(0, 1fr) 5px ${studioRightWidth}px`,
          columnGap: 0,
        }}
      >
        <div className={styles.studioCenter}>
          <div
            className={styles.studioCanvas}
            style={{
              cursor:
                toolMode === 'CREATE_ELEMENT'
                  ? 'crosshair'
                  : toolMode === 'CREATE_RELATIONSHIP' || toolMode === 'CREATE_FREE_CONNECTOR'
                    ? 'alias'
                    : toolMode === 'PAN'
                      ? 'grab'
                      : 'default',
              backgroundSize: `${gridSize}px ${gridSize}px`,
            }}
            ref={containerRef}
            onPointerDownCapture={(e) => {
              if (toolModeRef.current !== 'CREATE_RELATIONSHIP' || !pendingRelationshipTypeRef.current) return;
              if (!relationshipDraftRef.current.dragging) return;
              if (connectionPointerActiveRef.current) return;
              connectionPointerIdRef.current = e.pointerId;
              connectionPointerActiveRef.current = true;
              try {
                containerRef.current?.setPointerCapture(e.pointerId);
              } catch {
                // Best-effort only.
              }
            }}
            onMouseDown={(e) => {
              if (toolMode !== 'CREATE_ELEMENT' || !pendingElementType || !placementModeActive) return;
              const pos = toCanvasPosition(e.clientX, e.clientY);
              setElementDragAnchor(pos);
              setElementDragActive(true);
              elementDragMovedRef.current = false;
              setElementDragGhost(null);
            }}
            onPointerDown={(e) => {
              const currentToolMode = toolModeRef.current;
              const currentRelationshipType = pendingRelationshipTypeRef.current;
              if (currentToolMode !== 'CREATE_RELATIONSHIP' || !currentRelationshipType) return;
              if (!containerRef.current) return;
              const pos = toCanvasPosition(e.clientX, e.clientY);
              if (!relationshipDraftRef.current.dragging) {
                const node = findNodeAtPosition(pos);
                if (node && !node.empty() && !node.data('draftTarget')) {
                  const sourceId = String(node.id());
                  if (sourceId && cyRef.current) {
                    cyRef.current.nodes().removeClass('connectionSource');
                    node.addClass('connectionSource');
                    connectionPointerIdRef.current = e.pointerId;
                    connectionPointerActiveRef.current = true;
                    try {
                      containerRef.current.setPointerCapture(e.pointerId);
                    } catch {
                      // Best-effort only.
                    }
                    connectionDragLockRef.current = true;
                    setConnectionDragLocked(true);
                    lockNodesForConnection();
                    const cy = cyRef.current;
                    const validTargets = relationshipEligibilityRef.current.get(sourceId) || getValidTargetsForSource(sourceId, currentRelationshipType);
                    cy.nodes().forEach((n) => {
                      const id = String(n.id());
                      if (id === sourceId) return;
                      n.removeClass('validTarget');
                      n.removeClass('invalidTarget');
                      n.removeClass('validTargetCandidate');
                      if (validTargets.has(id)) n.addClass('validTargetCandidate');
                    });

                    if (!cy.getElementById(DRAFT_EDGE_ID).empty()) {
                      cy.getElementById(DRAFT_EDGE_ID).remove();
                    }
                    removeDraftTarget();
                    cy.add({
                      data: {
                        id: DRAFT_EDGE_ID,
                        source: sourceId,
                        target: sourceId,
                        draft: true,
                        relationshipStyle: relationshipStyleForType(currentRelationshipType),
                        relationshipType: currentRelationshipType,
                      },
                    });
                    updateDraftEdgeTarget(pos, null, true, sourceId);
                    setRelationshipSourceId(sourceId);
                    setRelationshipTargetId(null);
                    updateRelationshipDraft({
                      sourceId,
                      targetId: null,
                      valid: null,
                      message: 'Drag to a target element to validate.',
                      dragging: true,
                    });
                  }
                }
              }

              if (relationshipDraftRef.current.dragging && cyRef.current) {
                if (!connectionPointerActiveRef.current) {
                  connectionPointerIdRef.current = e.pointerId;
                  connectionPointerActiveRef.current = true;
                  try {
                    containerRef.current.setPointerCapture(e.pointerId);
                  } catch {
                    // Best-effort only.
                  }
                }
                if (cyRef.current.getElementById(DRAFT_EDGE_ID).empty()) return;
                updateDraftEdgeTarget(pos, null, false, relationshipDraftRef.current.sourceId);
              }
            }}
            onPointerMove={(e) => {
              if (!connectionPointerActiveRef.current) return;
              if (!relationshipDraftRef.current.dragging && !freeConnectorDragRef.current.dragging) return;
              if (!cyRef.current) return;
              const relationshipType = pendingRelationshipTypeRef.current;
              if (relationshipDraftRef.current.dragging && !relationshipType) return;
              if (relationshipDraftRef.current.dragging && cyRef.current.getElementById(DRAFT_EDGE_ID).empty()) return;
              const pos = toCanvasPosition(e.clientX, e.clientY);
              if (relationshipDraftRef.current.dragging) {
                const hoverNode = findNodeAtPosition(pos);
                cyRef.current.nodes().removeClass('validTarget').removeClass('invalidTarget');
                if (hoverNode && !hoverNode.empty()) {
                  const targetId = String(hoverNode.id());
                  const validation = validateRelationshipEndpoints(relationshipDraftRef.current.sourceId, targetId, relationshipType);
                  if (validation.valid) {
                    hoverNode.addClass('validTarget');
                    updateDraftEdgeTarget(pos, hoverNode);
                  } else {
                    hoverNode.addClass('invalidTarget');
                    updateDraftEdgeTarget(pos, null, false, relationshipDraftRef.current.sourceId);
                  }
                } else {
                  updateDraftEdgeTarget(pos, null, false, relationshipDraftRef.current.sourceId);
                }
              } else if (freeConnectorDragRef.current.dragging) {
                const hoverNode = findNodeAtPosition(pos);
                updateDraftEdgeTarget(pos, hoverNode, true, freeConnectorDragRef.current.sourceId);
              }
            }}
            onMouseMove={(e) => {
              if (!relationshipDraftRef.current.dragging && !freeConnectorDragRef.current.dragging) return;
              if (!cyRef.current) return;
              const relationshipType = pendingRelationshipTypeRef.current;
              if (relationshipDraftRef.current.dragging && !relationshipType) return;
              if (relationshipDraftRef.current.dragging && cyRef.current.getElementById(DRAFT_EDGE_ID).empty()) return;
              const pos = toCanvasPosition(e.clientX, e.clientY);
              if (relationshipDraftRef.current.dragging) {
                const hoverNode = findNodeAtPosition(pos);
                cyRef.current.nodes().removeClass('validTarget').removeClass('invalidTarget');
                if (hoverNode && !hoverNode.empty()) {
                  const targetId = String(hoverNode.id());
                  const validation = validateRelationshipEndpoints(relationshipDraftRef.current.sourceId, targetId, relationshipType);
                  if (validation.valid) {
                    hoverNode.addClass('validTarget');
                    updateDraftEdgeTarget(pos, hoverNode);
                  } else {
                    hoverNode.addClass('invalidTarget');
                    updateDraftEdgeTarget(pos, null, false, relationshipDraftRef.current.sourceId);
                  }
                } else {
                  updateDraftEdgeTarget(pos, null, false, relationshipDraftRef.current.sourceId);
                }
              } else if (freeConnectorDragRef.current.dragging) {
                const hoverNode = findNodeAtPosition(pos);
                updateDraftEdgeTarget(pos, hoverNode, true, freeConnectorDragRef.current.sourceId);
              }
            }}
            onPointerUp={(e) => {
              if (connectionPointerActiveRef.current && containerRef.current && connectionPointerIdRef.current !== null) {
                try {
                  containerRef.current.releasePointerCapture(connectionPointerIdRef.current);
                } catch {
                  // Best-effort only.
                }
              }
              connectionPointerActiveRef.current = false;
              connectionPointerIdRef.current = null;

              const currentToolMode = toolModeRef.current;
              const currentRelationshipType = pendingRelationshipTypeRef.current;
              if (currentToolMode !== 'CREATE_RELATIONSHIP' || !currentRelationshipType) return;
              if (!relationshipDraftRef.current.dragging || !relationshipDraftRef.current.sourceId) {
                releaseConnectionDragLock();
                return;
              }

              const pos = toCanvasPosition(e.clientX, e.clientY);
              const node = findNodeAtPosition(pos);
              if (!node || node.empty()) {
                updateRelationshipDraft({ sourceId: null, targetId: null, valid: null, message: null, dragging: false });
                setRelationshipSourceId(null);
                setRelationshipTargetId(null);
                clearRelationshipDraftArtifacts();
                releaseConnectionDragLock();
                setPendingRelationshipType(null);
                pendingRelationshipTypeRef.current = null;
                setToolMode('SELECT');
                toolModeRef.current = 'SELECT';
                return;
              }

              const targetId = String(node.id());
              if (!targetId || targetId === relationshipDraftRef.current.sourceId) {
                updateRelationshipDraft({ sourceId: null, targetId: null, valid: null, message: null, dragging: false });
                setRelationshipSourceId(null);
                setRelationshipTargetId(null);
                clearRelationshipDraftArtifacts();
                releaseConnectionDragLock();
                setPendingRelationshipType(null);
                pendingRelationshipTypeRef.current = null;
                setToolMode('SELECT');
                toolModeRef.current = 'SELECT';
                return;
              }

              const validation = validateRelationshipEndpoints(relationshipDraftRef.current.sourceId, targetId, currentRelationshipType);
              if (!validation.valid) {
                updateRelationshipDraft({ sourceId: null, targetId: null, valid: false, message: null, dragging: false });
                setRelationshipSourceId(null);
                setRelationshipTargetId(null);
                clearRelationshipDraftArtifacts();
                releaseConnectionDragLock();
                setPendingRelationshipType(null);
                pendingRelationshipTypeRef.current = null;
                setToolMode('SELECT');
                toolModeRef.current = 'SELECT';
                return;
              }

              const creation = createRelationshipFromCanvas({
                fromId: relationshipDraftRef.current.sourceId,
                toId: targetId,
                type: currentRelationshipType,
              });
              if (!creation.ok) {
                // Silent failure to avoid disrupting the drag flow.
              }
              updateRelationshipDraft({ sourceId: null, targetId: null, valid: null, message: null, dragging: false });
              clearRelationshipDraftArtifacts();
              setRelationshipSourceId(null);
              setRelationshipTargetId(null);
              setPendingRelationshipType(null);
              pendingRelationshipTypeRef.current = null;
              setToolMode('SELECT');
              toolModeRef.current = 'SELECT';
              releaseConnectionDragLock();
            }}
            onPointerCancel={() => {
              if (connectionPointerActiveRef.current && containerRef.current && connectionPointerIdRef.current !== null) {
                try {
                  containerRef.current.releasePointerCapture(connectionPointerIdRef.current);
                } catch {
                  // Best-effort only.
                }
              }
              connectionPointerActiveRef.current = false;
              connectionPointerIdRef.current = null;
              if (!relationshipDraftRef.current.dragging) {
                releaseConnectionDragLock();
                return;
              }
              updateRelationshipDraft({ sourceId: null, targetId: null, valid: null, message: null, dragging: false });
              setRelationshipSourceId(null);
              setRelationshipTargetId(null);
              clearRelationshipDraftArtifacts();
              releaseConnectionDragLock();
              setPendingRelationshipType(null);
              pendingRelationshipTypeRef.current = null;
              setToolMode('SELECT');
              toolModeRef.current = 'SELECT';
            }}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (viewReadOnly) return;
              if (!canDiagramMode) return;
              if (designWorkspace.status !== 'DRAFT') {
                message.warning('Workspace is read-only. Reopen draft to add elements.');
                return;
              }
              const droppedExistingElementId = e.dataTransfer?.getData('application/x-ea-element-id');
              const droppedPlainId = e.dataTransfer?.getData('text/plain');
              const droppedType = e.dataTransfer?.getData('application/x-ea-element-type');
              const droppedVisualKind = e.dataTransfer?.getData('application/x-ea-visual-kind');
              const droppedRelationshipType = e.dataTransfer?.getData('application/x-ea-relationship-type');

              const resolvedExplorerId = (() => {
                if (droppedExistingElementId) return droppedExistingElementId;
                if (droppedPlainId && eaRepository?.objects.has(droppedPlainId)) return droppedPlainId;
                return '';
              })();

              if (resolvedExplorerId) {
                const existing = eaRepository?.objects.get(resolvedExplorerId);
                if (!existing) {
                  message.warning('Selected element no longer exists in the repository.');
                  return;
                }
                if (!validateStudioElementType(existing.type as ObjectType)) return;
                const resolvedShape = resolveEaShapeForObjectType(existing.type as ObjectType);
                if (!resolvedShape) {
                  message.error(`EA Shape Registry SVG mapping is missing for element type "${existing.type}".`);
                  return;
                }
                const pos = toCanvasPosition(e.clientX, e.clientY);
                stageExistingElement(resolvedExplorerId, pos);
                if (cyRef.current) {
                  const node = cyRef.current.getElementById(resolvedExplorerId);
                  if (node && !node.empty()) {
                    const label = nameForObject(existing as any);
                    const visualData = buildEaVisualData({ type: existing.type as ObjectType, attributes: existing.attributes ?? undefined });
                    node.data('label', label);
                    node.data('elementType', existing.type);
                    node.data('eaShape', visualData.eaShape);
                    node.data('eaIcon', visualData.eaIcon);
                    node.data('eaColor', visualData.eaColor);
                    node.data('eaBorder', visualData.eaBorder);
                    node.data('eaVisualKind', visualData.eaVisualKind);
                  }
                }
                setToolMode('SELECT');
                resetToolDrafts();
                return;
              }


              if (droppedType) {
                const visualLabel = droppedVisualKind
                  ? resolveElementVisualLabel(droppedType as ObjectType, droppedVisualKind)
                  : droppedType;
                const visual = resolveEaVisualForElement({
                  type: droppedType as ObjectType,
                  visualKindOverride: droppedVisualKind || undefined,
                });
                if (!visual) {
                  message.error(`Toolbox item "${visualLabel}" is missing an EA Shape Registry SVG mapping (ArchiMate/drawio).`);
                  return;
                }
                const mappedShape = resolveEaShapeForObjectType(droppedType as ObjectType);
                if (!mappedShape) {
                  message.error(`Toolbox item "${visualLabel}" is missing an EA Shape Registry SVG mapping (ArchiMate/drawio).`);
                  return;
                }
                if (!validateStudioElementType(droppedType as ObjectType)) return;
                const pos = toCanvasPosition(e.clientX, e.clientY);
                setPendingElementType(droppedType as ObjectType);
                setPendingElementVisualKind(droppedVisualKind || null);
                setPlacement({ x: pos.x, y: pos.y });
                form.setFieldsValue({ name: `New ${visualLabel}`, description: '' });
                setCreateModalOpen(true);
                setToolMode('SELECT');
                setPlacementModeActive(false);
                return;
              }

              if (droppedRelationshipType) {
                if (!RELATIONSHIP_TYPE_DEFINITIONS[droppedRelationshipType as RelationshipType]) {
                  message.error(
                    `Toolbox item "${droppedRelationshipType}" is not yet wired to the canvas (missing relationship mapping).`,
                  );
                  return;
                }
                setToolMode('CREATE_RELATIONSHIP');
                setPendingRelationshipType(droppedRelationshipType as RelationshipType);
                toolModeRef.current = 'CREATE_RELATIONSHIP';
                pendingRelationshipTypeRef.current = droppedRelationshipType as RelationshipType;
                setPendingElementType(null);
                setPendingElementVisualKind(null);
                setRelationshipSourceId(null);
                setRelationshipTargetId(null);
                setPlacementModeActive(false);
              }

            }}
          />
          {nodeContextMenu ? (
            <div
              role="menu"
              aria-label="Node context menu"
              style={{
                position: 'fixed',
                top: nodeContextMenu.y,
                left: nodeContextMenu.x,
                background: token.colorBgElevated,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 8,
                boxShadow: token.boxShadowSecondary,
                padding: 6,
                zIndex: 2000,
                minWidth: 160,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <Button
                type="text"
                size="small"
                block
                disabled={!canContextMenuDecompose}
                onClick={() => {
                  setNodeContextMenu(null);
                  if (!nodeContextMenu?.nodeId) return;
                  startChildCreation(nodeContextMenu.nodeId);
                }}
              >
                Decompose
              </Button>
            </div>
          ) : null}
        </div>

        <div
          className={styles.rightResizer}
          role="separator"
          aria-label="Resize Studio right panel"
          aria-disabled={elementDragActive || relationshipDraft.dragging}
          onMouseDown={(event) => {
            if (elementDragActive || relationshipDraft.dragging) return;
            beginStudioRightResize(event);
          }}
          onDoubleClick={() => setStudioRightWidth(360)}
        />
        <div className={styles.studioRight} ref={studioRightRef} style={{ width: studioRightWidth }}>
          {rightPanelMode === RightPanelMode.VIEW_SWITCH ? (
            <RightPanelController
              title="View switcher"
              key={`view-switch-${panelResetToken.viewSwitch}`}
              onClose={closeRightPanel}
            >
              {viewSwitchPanel}
            </RightPanelController>
          ) : rightPanelMode === RightPanelMode.SELECTION ? (
            <RightPanelController
              title="Selection"
              key={`selection-${panelResetToken.selection}`}
              onClose={closeRightPanel}
            >
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {toolboxPanel}
                {!toolboxExpanded ? (
                  <>
                    {selectedFreeShape ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        <Alert
                          type="info"
                          showIcon
                          message="Free diagram shape"
                          description="Visual-only shape. EA validation and governance do not apply."
                        />
                        <Form layout="vertical">
                          <Form.Item label="Label">
                            <Input
                              value={selectedFreeShape.label}
                              onChange={(e) => updateFreeShape(selectedFreeShape.id, { label: e.target.value })}
                            />
                          </Form.Item>
                          <Form.Item label="Width">
                            <InputNumber
                              min={40}
                              max={800}
                              value={selectedFreeShape.width}
                              onChange={(value) => {
                                const next = Number(value);
                                if (!Number.isFinite(next)) return;
                                updateFreeShape(selectedFreeShape.id, { width: Math.max(40, Math.round(next)) });
                              }}
                            />
                          </Form.Item>
                          <Form.Item label="Height">
                            <InputNumber
                              min={40}
                              max={800}
                              value={selectedFreeShape.height}
                              onChange={(value) => {
                                const next = Number(value);
                                if (!Number.isFinite(next)) return;
                                updateFreeShape(selectedFreeShape.id, { height: Math.max(40, Math.round(next)) });
                              }}
                            />
                          </Form.Item>
                        </Form>
                      </div>
                    ) : null}
                    {selectedFreeConnectorId ? (
                      <Alert
                        type="info"
                        showIcon
                        message="Free connector"
                        description="Visual-only connector. EA validation and governance do not apply."
                      />
                    ) : null}
                    <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
                      <Typography.Text strong>Properties</Typography.Text>
                      <Button size="small" onClick={() => setRightPanelMode(RightPanelMode.STUDIO)}>
                        Open Inspector
                      </Button>
                    </Space>

                    {selectedNodeIds.length > 1 ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        <Alert
                          type="info"
                          showIcon
                          message={`Selected elements: ${selectedNodeIds.length}`}
                          description="Use bulk edit to update shared fields for staged elements."
                        />
                        <Space wrap>
                          <Button type="default" onClick={() => setBulkEditOpen(true)}>
                            Bulk edit selected
                          </Button>
                          <Button type="default" onClick={() => distributeSelectedNodes('x')}>
                            Distribute horizontally
                          </Button>
                          <Button type="default" onClick={() => distributeSelectedNodes('y')}>
                            Distribute vertically
                          </Button>
                          <Button type="default" onClick={cleanAlignToGrid}>
                            Clean align (snap)
                          </Button>
                          <Button type="default" onClick={resetLayout}>
                            Reset layout
                          </Button>
                        </Space>
                      </div>
                    ) : null}

                {!propertiesExpanded ? (
                  <div className={styles.studioCompactProperties}>
                    <div className={styles.studioCompactPropertiesRow}>
                      <div className={styles.studioCompactTypeIcon}>{renderTypeIcon(compactSelectedElement?.type)}</div>
                      <div style={{ display: 'grid', gap: 2 }}>
                        <Typography.Text strong>
                          {compactSelectedElement?.name || 'No selection'}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {compactSelectedElement?.type || 'Select an element'}
                        </Typography.Text>
                      </div>
                      <Tag color={compactWarningCount > 0 ? 'gold' : 'default'} style={{ marginLeft: 'auto' }}>
                        Warnings: {compactWarningCount}
                      </Tag>
                    </div>
                    <Space size="small" wrap>
                      <Button
                        size="small"
                        type="primary"
                        onClick={handleOpenProperties}
                      >
                        Open Properties
                      </Button>
                      {selectedNodeId && isHierarchicalView ? (
                        <Button
                          size="small"
                          onClick={() => selectedNodeId && startChildCreation(selectedNodeId)}
                          disabled={!canAddChild}
                        >
                          Add child
                        </Button>
                      ) : null}
                    </Space>
                  </div>
                ) : (
                  <>
                    {selectedStagedElements.length > 1 ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        <Alert
                          type="info"
                          showIcon
                          message={`Bulk edit (${selectedStagedElements.length} staged elements)`}
                          description="Edit shared fields only. Changes apply to all selected staged elements."
                        />
                        <Form
                          form={bulkEditForm}
                          layout="vertical"
                          onFinish={(values) => {
                            const description = (values.description ?? '').trim();
                            if (!description) {
                              message.info('Enter a description to apply.');
                              return;
                            }
                            const selectedSet = new Set(selectedStagedElements.map((el) => el.id));
                            setStagedElements((prev) =>
                              prev.map((el) => (selectedSet.has(el.id) ? { ...el, description } : el)),
                            );
                            message.success('Bulk description applied.');
                          }}
                        >
                          <Form.Item label="Description (set for all)" name="description">
                            <Input.TextArea rows={3} placeholder="Enter shared description" />
                          </Form.Item>
                          <Button type="primary" onClick={() => bulkEditForm.submit()}>
                            Apply to selected
                          </Button>
                        </Form>
                      </div>
                    ) : stagedSelectedElement ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        <Alert
                          type="info"
                          showIcon
                          message={`Staged element • ${stagedSelectedElement.type}`}
                          description="Edits apply to the workspace only."
                        />
                        {isHierarchicalView ? (
                          <Button
                            type="default"
                            onClick={() => selectedNodeId && startChildCreation(selectedNodeId)}
                            disabled={!canAddChild}
                          >
                            Add child
                          </Button>
                        ) : null}
                        {stagedSelectedElementExistsInRepo ? (
                          isMarkedForRemoval(stagedSelectedElement.attributes) ? (
                            <Alert
                              type="warning"
                              showIcon
                              message="Marked for removal in Explorer"
                              description="This element was marked for deletion from the repository in Explorer and will be removed on commit. Canvas actions cannot undo repository deletions."
                            />
                          ) : (
                            <Alert
                              type="info"
                              showIcon
                              message="Explorer is the source of truth"
                              description="To delete this element everywhere, delete it in Explorer. Removing it here only affects this workspace view."
                            />
                          )
                        ) : null}
                        <Button
                          danger
                          onClick={() => {
                            Modal.confirm({
                              title: 'Remove from workspace view?',
                              content: 'This removes the element from this workspace view only. Repository remains unchanged.',
                              okText: 'Delete',
                              okButtonProps: { danger: true },
                              cancelText: 'Cancel',
                              onOk: () => deleteStagedElement(stagedSelectedElement.id),
                            });
                          }}
                        >
                          Remove from workspace
                        </Button>
                        {!isMarkedForRemoval(stagedSelectedElement.attributes) ? (
                          <Form
                            layout="vertical"
                            initialValues={{
                              name: stagedSelectedElement.name,
                              description: stagedSelectedElement.description,
                              ...(stagedSelectedElement.attributes ?? {}),
                            }}
                            onValuesChange={(changed) => {
                              setValidationGateOpen(true);
                              setStagedElements((prev) =>
                                prev.map((el) => {
                                  if (el.id !== stagedSelectedElement.id) return el;
                                  const next = {
                                    ...el,
                                    name: typeof changed.name === 'string' ? changed.name : el.name,
                                    description:
                                      typeof changed.description === 'string' ? changed.description : el.description,
                                    attributes: {
                                      ...(el.attributes ?? {}),
                                      ...changed,
                                    },
                                  };
                                  return next;
                                }),
                              );

                              if (cyRef.current) {
                                const node = cyRef.current.getElementById(stagedSelectedElement.id);
                                if (node && !node.empty() && typeof changed.name === 'string') {
                                  node.data('label', changed.name);
                                }
                              }
                            }}
                            validateTrigger={['onChange', 'onBlur']}
                          >
                            <Form.Item
                              label="Name"
                              name="name"
                              rules={[{ required: true, message: 'Name is required' }]}
                            >
                              <Input autoFocus />
                            </Form.Item>
                            <Form.Item label="Description" name="description">
                              <Input.TextArea rows={3} />
                            </Form.Item>
                            {requiredElementAttributes(stagedSelectedElement.type).map((attr) => (
                              <Form.Item
                                key={attr}
                                label={attr}
                                name={attr}
                                rules={[{ required: true, message: `${attr} is required` }]}
                              >
                                <Input placeholder={`Enter ${attr}`} />
                              </Form.Item>
                            ))}
                          </Form>
                        ) : null}
                      </div>
                    ) : stagedSelectedRelationship ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        <Alert
                          type="info"
                          showIcon
                          message={`Staged relationship • ${stagedSelectedRelationship.type.replace(/_/g, ' ')}`}
                          description="Relationships are staged only."
                        />
                        {stagedSelectedRelationshipExistsInRepo ? (
                          isMarkedForRemoval(stagedSelectedRelationship.attributes) ? (
                            <Alert
                              type="warning"
                              showIcon
                              message="Marked for removal"
                              description="This relationship will be removed from the repository on commit."
                              action={
                                <Button
                                  size="small"
                                  onClick={() => {
                                    setStagedRelationships((prev) =>
                                      prev.map((rel) =>
                                        rel.id === stagedSelectedRelationship.id
                                          ? {
                                              ...rel,
                                              status: 'STAGED',
                                              attributes: { ...(rel.attributes ?? {}), _deleted: false },
                                            }
                                          : rel,
                                      ),
                                    );
                                  }}
                                >
                                  Undo removal
                                </Button>
                              }
                            />
                          ) : (
                            <Button
                              danger
                              onClick={() => {
                                setStagedRelationships((prev) =>
                                  prev.map((rel) =>
                                    rel.id === stagedSelectedRelationship.id
                                      ? {
                                          ...rel,
                                          status: 'DISCARDED',
                                          attributes: { ...(rel.attributes ?? {}), _deleted: true },
                                        }
                                      : rel,
                                  ),
                                );
                              }}
                            >
                              Mark for removal
                            </Button>
                          )
                        ) : null}
                        <Button
                          danger
                          onClick={() => {
                            Modal.confirm({
                              title: 'Delete staged relationship?',
                              content: 'This removes the relationship from the workspace only. Repository remains unchanged.',
                              okText: 'Delete',
                              okButtonProps: { danger: true },
                              cancelText: 'Cancel',
                              onOk: () => deleteStagedRelationship(stagedSelectedRelationship.id),
                            });
                          }}
                        >
                          Delete staged relationship
                        </Button>
                        <Descriptions size="small" column={1} bordered>
                          <Descriptions.Item label="From">
                            {resolveElementLabel(stagedSelectedRelationship.fromId)?.label ?? stagedSelectedRelationship.fromId}
                          </Descriptions.Item>
                          <Descriptions.Item label="To">
                            {resolveElementLabel(stagedSelectedRelationship.toId)?.label ?? stagedSelectedRelationship.toId}
                          </Descriptions.Item>
                          <Descriptions.Item label="Status">
                            {stagedSelectedRelationship.status}
                          </Descriptions.Item>
                        </Descriptions>
                        {!isMarkedForRemoval(stagedSelectedRelationship.attributes) ? (
                          (RELATIONSHIP_TYPE_DEFINITIONS[stagedSelectedRelationship.type]?.attributes ?? []).length > 0 ? (
                            <Form
                              form={relationshipAttributesForm}
                              layout="vertical"
                              onValuesChange={(changed) => {
                                setValidationGateOpen(true);
                                setStagedRelationships((prev) =>
                                  prev.map((rel) => {
                                    if (rel.id !== stagedSelectedRelationship.id) return rel;
                                    return {
                                      ...rel,
                                      attributes: {
                                        ...(rel.attributes ?? {}),
                                        ...changed,
                                      },
                                    };
                                  }),
                                );
                              }}
                              validateTrigger={['onChange', 'onBlur']}
                            >
                              {(RELATIONSHIP_TYPE_DEFINITIONS[stagedSelectedRelationship.type]?.attributes ?? []).map(
                                (attr) => (
                                  <Form.Item
                                    key={attr}
                                    label={attr}
                                    name={attr}
                                    rules={[{ required: true, message: `${attr} is required` }]}
                                  >
                                    <Input placeholder={`Enter ${attr}`} />
                                  </Form.Item>
                                ),
                              )}
                            </Form>
                          ) : (
                            <Typography.Text type="secondary">No mandatory relationship attributes.</Typography.Text>
                          )
                        ) : null}
                      </div>
                    ) : selectedExistingElement ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        <Alert
                          type="info"
                          showIcon
                          message={`Existing element • ${selectedExistingElement.type}`}
                          description="Stage this element to edit within the workspace. Repository stays unchanged."
                        />
                        {isHierarchicalView ? (
                          <Button
                            type="default"
                            onClick={() => selectedExistingElement?.id && startChildCreation(selectedExistingElement.id)}
                            disabled={!canAddChild}
                          >
                            Add child
                          </Button>
                        ) : null}
                        <Descriptions size="small" column={1} bordered>
                          <Descriptions.Item label="Name">
                            {((selectedExistingElement.attributes as any)?.name as string) || selectedExistingElement.id}
                          </Descriptions.Item>
                          <Descriptions.Item label="ID">{selectedExistingElement.id}</Descriptions.Item>
                        </Descriptions>
                        <Button type="primary" onClick={() => stageExistingElement(selectedExistingElement.id)}>
                          Stage for editing
                        </Button>
                      </div>
                    ) : selectedExistingRelationship ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        <Alert
                          type="info"
                          showIcon
                          message={`Existing relationship • ${selectedExistingRelationship.type.replace(/_/g, ' ')}`}
                          description="Stage this relationship to edit within the workspace. Repository stays unchanged."
                        />
                        <Descriptions size="small" column={1} bordered>
                          <Descriptions.Item label="From">
                            {resolveElementLabel(selectedExistingRelationship.fromId)?.label ?? selectedExistingRelationship.fromId}
                          </Descriptions.Item>
                          <Descriptions.Item label="To">
                            {resolveElementLabel(selectedExistingRelationship.toId)?.label ?? selectedExistingRelationship.toId}
                          </Descriptions.Item>
                        </Descriptions>
                        <Button type="primary" onClick={() => stageExistingRelationship(selectedExistingRelationship.id)}>
                          Stage for editing
                        </Button>
                      </div>
                    ) : (
                      propertiesPanel
                    )}
                  </>
                )}
                  </>
                ) : null}
              </Space>
            </RightPanelController>
          ) : (
            <RightPanelController
              title="Inspector"
              key={`inspector-${panelResetToken.studio}`}
              onClose={closeRightPanel}
            >
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {toolboxPanel}
                {!toolboxExpanded ? (
                  <>
                    <div style={{ display: 'grid', gap: 8 }}>
                      <Typography.Text strong>View status</Typography.Text>
                      {activeViewName ? (
                        <Descriptions size="small" column={1} bordered>
                          <Descriptions.Item label="View">{activeViewName}</Descriptions.Item>
                          <Descriptions.Item label="Status">{viewSaveLabel ?? 'Saved'}</Descriptions.Item>
                          <Descriptions.Item label="Last saved">
                            {lastAutoSaveAt ? new Date(lastAutoSaveAt).toLocaleTimeString() : '—'}
                          </Descriptions.Item>
                        </Descriptions>
                      ) : (
                        <Empty description="No view selected" />
                      )}
                    </div>

                    {activeView ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        <Typography.Text strong>View actions</Typography.Text>
                        <Space wrap>
                          <Button size="small" onClick={handleRenameActiveView} disabled={presentationReadOnly}>
                            Rename
                          </Button>
                          <Button size="small" onClick={handleDuplicateActiveView} disabled={presentationReadOnly}>
                            Duplicate
                          </Button>
                          <Button size="small" onClick={handleExportActiveViewPng}>
                            Export PNG
                          </Button>
                          <Button size="small" onClick={handleExportActiveViewJson}>
                            Export JSON
                          </Button>
                          <Button size="small" danger onClick={handleDeleteActiveView} disabled={presentationReadOnly}>
                            Delete
                          </Button>
                        </Space>
                        <Descriptions size="small" column={1} bordered>
                          <Descriptions.Item label="Viewpoint">
                            {ViewpointRegistry.get(activeView.viewpointId)?.name ?? activeView.viewpointId}
                          </Descriptions.Item>
                          <Descriptions.Item label="Status">{activeView.status}</Descriptions.Item>
                          <Descriptions.Item label="Created by">
                            {activeView.createdBy || 'Unknown'}
                          </Descriptions.Item>
                          <Descriptions.Item label="Created at">
                            {activeView.createdAt ? new Date(activeView.createdAt).toLocaleString() : '—'}
                          </Descriptions.Item>
                          <Descriptions.Item label="Description">
                            {activeView.description || 'No description'}
                          </Descriptions.Item>
                        </Descriptions>
                      </div>
                    ) : null}

                    {activeView ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        <Typography.Text strong>View Summary</Typography.Text>
                        <Form form={viewSummaryForm} layout="vertical">
                          <Form.Item label="Purpose" name="purpose">
                            <Input.TextArea rows={2} placeholder="Why this view exists" disabled={presentationReadOnly} />
                          </Form.Item>
                          <Form.Item label="Scope" name="scope">
                            <Input.TextArea rows={2} placeholder="What this view covers" disabled={presentationReadOnly} />
                          </Form.Item>
                          <Form.Item label="Key insights" name="insights">
                            <Input.TextArea rows={3} placeholder="Executive takeaways" disabled={presentationReadOnly} />
                          </Form.Item>
                          <Button type="primary" size="small" onClick={() => void saveViewSummary()} disabled={presentationReadOnly}>
                            Save summary
                          </Button>
                        </Form>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          Stored in view metadata (not rendered on canvas).
                        </Typography.Text>
                      </div>
                    ) : null}

                    <div style={{ display: 'grid', gap: 8 }}>
                      <Typography.Text strong>Inspector</Typography.Text>
                      <Button
                        size="small"
                        type="primary"
                        onClick={handleOpenProperties}
                      >
                        Open Properties
                      </Button>
                    </div>

                    <div style={{ display: 'grid', gap: 8 }}>
                      <Typography.Text strong>Validation</Typography.Text>
                      <Collapse
                        ghost
                        expandIconPosition="end"
                        items={[
                          {
                            key: 'validation',
                            label: (
                              <Tooltip title="Validation">
                                <Tag color="red" style={{ marginInlineStart: 0 }}>
                                  ❌ {validationCount}
                                </Tag>
                              </Tooltip>
                            ),
                            children: !validationGateOpen ? (
                              <Empty description="Validation appears after you model or save." />
                            ) : validationSummary && (validationSummary.errorCount > 0 || validationSummary.warningCount > 0 || validationSummary.infoCount > 0) ? (
                              <div className={styles.studioValidationList}>
                                {validationSummary.errorHighlights.map((m) => (
                                  <Alert key={`err:${m}`} type="error" showIcon message={m} />
                                ))}
                                {validationSummary.warningHighlights.map((m) => (
                                  <Alert key={`warn:${m}`} type="warning" showIcon message={m} />
                                ))}
                                {validationSummary.infoHighlights.map((m) => (
                                  <Alert key={`info:${m}`} type="info" showIcon message={m} />
                                ))}
                              </div>
                            ) : (
                              <Empty description="No validation messages yet" />
                            ),
                          },
                        ]}
                      />
                    </div>

                    <div style={{ display: 'grid', gap: 8 }}>
                      <Typography.Text strong>Legend</Typography.Text>
                      <Collapse
                        ghost
                        defaultActiveKey={['legend']}
                        expandIconPosition="end"
                        items={[
                          {
                            key: 'legend',
                            label: 'Viewpoint legend',
                            children: activeViewpoint ? (
                              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                <Typography.Text type="secondary">Elements</Typography.Text>
                                <ul style={{ margin: 0, paddingLeft: 18 }}>
                                  {activeViewpoint.allowedElementTypes.map((type) => (
                                    <li key={`el-${type}`}>
                                      <strong>{type}</strong>: {OBJECT_TYPE_DEFINITIONS[type]?.description ?? 'Element'}
                                    </li>
                                  ))}
                                </ul>

                                <Typography.Text type="secondary">Relationships</Typography.Text>
                                <ul style={{ margin: 0, paddingLeft: 18 }}>
                                  {activeViewpoint.allowedRelationshipTypes.map((type) => (
                                    <li key={`rel-${type}`}>
                                      <strong>{type.replace(/_/g, ' ')}</strong>:{' '}
                                      {RELATIONSHIP_TYPE_DEFINITIONS[type]?.description ?? 'Relationship'}
                                    </li>
                                  ))}
                                </ul>

                                <Typography.Text type="secondary">Layout rules</Typography.Text>
                                <Descriptions size="small" column={1} bordered>
                                  <Descriptions.Item label="Diagram Type">
                                    {activeViewpoint.name}
                                  </Descriptions.Item>
                                  <Descriptions.Item label="Layout engine">
                                    {activeViewpoint.defaultLayout}
                                  </Descriptions.Item>
                                  <Descriptions.Item label="Grammar">
                                    {activeViewpoint.description}
                                  </Descriptions.Item>
                                </Descriptions>
                              </Space>
                            ) : (
                              <Empty description="No viewpoint selected" />
                            ),
                          },
                        ]}
                      />
                    </div>
                  </>
                ) : null}
              </Space>
            </RightPanelController>
          )}
        </div>
        </div>

      <Modal
        open={repoEndpointOpen}
        title={repoEndpointMode === 'source' ? 'Select repository source' : 'Select repository target'}
        okText="Use selection"
        cancelText="Cancel"
        onCancel={() => setRepoEndpointOpen(false)}
        onOk={async () => {
          try {
            const values = await repoEndpointForm.validateFields();
            const selectedId = String(values.repositoryElementId || '').trim();
            if (!selectedId) return;
            if (!pendingRelationshipType) {
              message.warning('Select a relationship type first.');
              return;
            }

            if (repoEndpointMode === 'source') {
              setRelationshipSourceId(selectedId);
              setRelationshipTargetId(null);
              setRelationshipDraft({
                sourceId: selectedId,
                targetId: null,
                valid: null,
                message: 'Repository source selected. Choose a target on the canvas.',
                dragging: false,
              });
              setRepoEndpointOpen(false);
              return;
            }

            if (!relationshipSourceId) {
              message.warning('Pick a source on the canvas first.');
              return;
            }

            const validation = validateRelationshipEndpoints(relationshipSourceId, selectedId, pendingRelationshipType);
            if (!validation.valid) {
              message.error(validation.message || 'Invalid relationship endpoints.');
              return;
            }

            setRelationshipTargetId(selectedId);
            setRelationshipDraft({
              sourceId: relationshipSourceId,
              targetId: selectedId,
              valid: true,
              message: 'Target selected. Confirm or cancel to continue.',
              dragging: false,
            });
            setRepoEndpointOpen(false);
          } catch {
            // validation handled by Form
          }
        }}
      >
        <Form form={repoEndpointForm} layout="vertical">
          <Form.Item
            label="Repository element"
            name="repositoryElementId"
            rules={[{ required: true, message: 'Select a repository element' }]}
          >
            <Select
              showSearch
              placeholder="Select repository element"
              options={repositoryElementOptions}
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={commitOpen}
        title="Commit Workspace"
        okText="Commit (irreversible)"
        cancelText="Cancel"
        okButtonProps={{ danger: true }}
        cancelButtonProps={{ autoFocus: true }}
        keyboard={false}
        maskClosable={false}
        onCancel={() => setCommitOpen(false)}
        onOk={() => commitWorkspace()}
      >
        <Alert
          type="warning"
          showIcon
          message="You are about to commit architecture changes to the repository."
          description="Confirm to proceed or cancel to review changes."
          style={{ marginBottom: 12 }}
        />
        <Alert
          type="warning"
          showIcon
          message="Commit is irreversible"
          description="Workspace will be locked as COMMITTED and cannot be reopened for edits."
          style={{ marginBottom: 12 }}
        />
        {stagedValidationErrors.length > 0 || (governanceMode !== 'Advisory' && (validationSummary?.warningCount ?? 0) > 0) ? (
          <Alert
            type="error"
            showIcon
            message="Validation errors block commit"
            description={
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {stagedValidationErrors.slice(0, 6).map((err) => (
                  <li key={err}>{err}</li>
                ))}
                {governanceMode !== 'Advisory'
                  ? (validationSummary?.warningHighlights ?? []).map((warn) => (
                      <li key={warn}>{warn}</li>
                    ))
                  : null}
              </ul>
            }
            style={{ marginBottom: 12 }}
          />
        ) : (
          <Alert
            type="success"
            showIcon
            message="Validation passed"
            description="No blocking validation errors detected."
            style={{ marginBottom: 12 }}
          />
        )}
        <Typography.Text strong>Summary</Typography.Text>
        <ul style={{ marginTop: 6, paddingLeft: 18 }}>
          <li>Elements staged: {stagedElements.length}</li>
          <li>Relationships staged: {stagedRelationships.length}</li>
        </ul>
        <Typography.Text strong>Counts by element type</Typography.Text>
        <ul style={{ marginTop: 6, paddingLeft: 18 }}>
          {stagedElements.length ? (
            Array.from(
              stagedElements.reduce((acc, el) => {
                acc.set(el.type, (acc.get(el.type) ?? 0) + 1);
                return acc;
              }, new Map<ObjectType, number>()),
            ).map(([type, count]) => (
              <li key={type}>
                {type}: {count}
              </li>
            ))
          ) : (
            <li>None</li>
          )}
        </ul>
        <Typography.Text strong>Elements to be created</Typography.Text>
        <ul style={{ marginTop: 6, paddingLeft: 18 }}>
          {stagedElements.length ? (
            stagedElements.slice(0, 6).map((el) => (
              <li key={el.id}>
                {el.name} ({el.type})
              </li>
            ))
          ) : (
            <li>None</li>
          )}
        </ul>
        {stagedElements.length > 6 ? (
          <Typography.Text type="secondary">+{stagedElements.length - 6} more</Typography.Text>
        ) : null}
        <Typography.Text strong style={{ display: 'block', marginTop: 12 }}>
          Relationships to be created
        </Typography.Text>
        <ul style={{ marginTop: 6, paddingLeft: 18 }}>
          {stagedRelationships.length ? (
            stagedRelationships.slice(0, 6).map((rel) => (
              <li key={rel.id}>
                {rel.type.replace(/_/g, ' ')}: {rel.fromId} → {rel.toId}
              </li>
            ))
          ) : (
            <li>None</li>
          )}
        </ul>
        {stagedRelationships.length > 6 ? (
          <Typography.Text type="secondary">+{stagedRelationships.length - 6} more</Typography.Text>
        ) : null}
        <Typography.Text strong style={{ display: 'block', marginTop: 12 }}>
          Impact preview
        </Typography.Text>
        <Typography.Text strong style={{ display: 'block', marginTop: 6 }}>
          Views that would include new elements
        </Typography.Text>
        <ul style={{ marginTop: 6, paddingLeft: 18 }}>
          {commitImpactPreview.impactedViews.length ? (
            commitImpactPreview.impactedViews.slice(0, 6).map((view) => (
              <li key={view.id}>
                {view.name || view.id} ({view.viewpointId})
              </li>
            ))
          ) : (
            <li>None detected</li>
          )}
        </ul>
        {commitImpactPreview.impactedViews.length > 6 ? (
          <Typography.Text type="secondary">
            +{commitImpactPreview.impactedViews.length - 6} more
          </Typography.Text>
        ) : null}
        <Typography.Text strong style={{ display: 'block', marginTop: 12 }}>
          Impact analysis (high-level)
        </Typography.Text>
        <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>
          +{stagedElements.length} elements, +{stagedRelationships.length} relationships staged.
          {commitImpactPreview.relationshipTypes.length
            ? ` Relationship types: ${commitImpactPreview.relationshipTypes.join(', ')}.`
            : ''}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>
          Informational only. Repository remains unchanged until commit completes.
        </Typography.Paragraph>
      </Modal>

      <Modal
        open={discardOpen}
        title="Discard Workspace"
        okText="Confirm Discard"
        cancelText="Cancel"
        okButtonProps={{ danger: true, autoFocus: false }}
        cancelButtonProps={{ autoFocus: true }}
        keyboard={false}
        maskClosable={false}
        onCancel={() => setDiscardOpen(false)}
        onOk={discardWorkspaceNow}
      >
        <Alert
          type="warning"
          showIcon
          message="Discarding this workspace will permanently delete all uncommitted design changes."
          description="All staged changes will be removed and the repository will remain untouched. This cannot be undone."
          style={{ marginBottom: 12 }}
        />
        <Typography.Text strong>Workspace</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>
          {workspaceDisplayName}
        </Typography.Paragraph>
        <Typography.Text strong>Staged changes</Typography.Text>
        <ul style={{ marginTop: 6, paddingLeft: 18 }}>
          <li>Elements staged: {stagedElements.length}</li>
          <li>Relationships staged: {stagedRelationships.length}</li>
        </ul>
      </Modal>

      <Modal
        open={quickCreateOpen}
        title="Quick create element"
        okText="Stage element"
        cancelText="Cancel"
        onCancel={() => {
          setQuickCreateOpen(false);
          setPendingChildCreation(null);
        }}
        onOk={() => void handleQuickCreate(false)}
      >
        <Alert
          type="info"
          showIcon
          message="Quick create (staged)"
          description="Creates a staged element only. Repository and views stay unchanged."
          style={{ marginBottom: 12 }}
        />
        <Form
          form={quickCreateForm}
          layout="vertical"
          initialValues={{
            type: quickCreateType ?? undefined,
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setQuickCreateOpen(false);
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleQuickCreate(true);
            }
          }}
        >
          <Form.Item label="Element type" name="type" rules={[{ required: true, message: 'Select a type' }]}>
            <Select
              placeholder="Select element type"
              options={quickCreateTypeOptions}
            />
          </Form.Item>
          <Form.Item label="Name" name="name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder="Enter name" allowClear />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea placeholder="Optional description" rows={3} allowClear />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={bulkEditOpen}
        title={`Bulk edit (${selectedNodeIds.length} elements)`}
        okText="Apply"
        cancelText="Cancel"
        onCancel={() => setBulkEditOpen(false)}
        onOk={async () => {
          try {
            const values = await bulkEditForm.validateFields();
            const prefix = (values.namePrefix ?? '').trim();
            const suffix = (values.nameSuffix ?? '').trim();
            const description = (values.description ?? '').trim();

            if (!prefix && !suffix && !description) {
              message.info('Nothing to apply.');
              return;
            }

            setValidationGateOpen(true);

            setStagedElements((prev) =>
              prev.map((el) => {
                if (!selectedNodeIds.includes(el.id)) return el;
                const nextName = `${prefix}${el.name}${suffix}`;
                return {
                  ...el,
                  name: prefix || suffix ? nextName : el.name,
                  description: description ? description : el.description,
                };
              }),
            );

            if (cyRef.current) {
              selectedNodeIds.forEach((id) => {
                const node = cyRef.current?.getElementById(id);
                if (!node) return;
                const current = node.data('label') as string;
                const nextLabel = `${prefix}${current}${suffix}`;
                node.data('label', prefix || suffix ? nextLabel : current);
              });
            }

            setBulkEditOpen(false);
            bulkEditForm.resetFields();
            message.success('Bulk changes applied to staged elements.');
          } catch {
            // validation handled by Form
          }
        }}
      >
        <Alert
          type="warning"
          showIcon
          message="Bulk edit applies to staged elements only"
          description="Repository and views remain unchanged until a commit workflow is implemented."
          style={{ marginBottom: 12 }}
        />
        <Form form={bulkEditForm} layout="vertical">
          <Form.Item label="Name prefix" name="namePrefix">
            <Input placeholder="Optional prefix" allowClear />
          </Form.Item>
          <Form.Item label="Name suffix" name="nameSuffix">
            <Input placeholder="Optional suffix" allowClear />
          </Form.Item>
          <Form.Item label="Description (set for all)" name="description">
            <Input.TextArea placeholder="Optional description" rows={3} allowClear />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={workspaceModalOpen}
        title="Design Workspace"
        okText="Save Workspace"
        cancelText="Cancel"
        onCancel={() => setWorkspaceModalOpen(false)}
        onOk={async () => {
          try {
            const values = await workspaceForm.validateFields();
            const layout = buildLayoutFromCanvas();
            const next: DesignWorkspace = {
              ...designWorkspace,
              name: values.name.trim(),
              description: values.description?.trim() || '',
              scope: values.scope || undefined,
              status: values.status,
              updatedAt: new Date().toISOString(),
              layout,
              stagedElements,
              stagedRelationships,
            };
            onUpdateWorkspace(next);
            setWorkspaceModalOpen(false);
          } catch {
            // validation handled by Form
          }
        }}
      >
        <Alert
          type="info"
          showIcon
          message="Design Workspace is separate from views and baselines"
          description="Use a workspace to experiment safely before committing changes to the repository."
          style={{ marginBottom: 12 }}
        />
        <Form form={workspaceForm} layout="vertical" initialValues={{
          name: designWorkspace.name,
          description: designWorkspace.description,
          scope: designWorkspace.scope,
          status: designWorkspace.status,
        }}>
          <Form.Item label="Name" name="name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder="Workspace name" allowClear />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea placeholder="Workspace description" rows={3} allowClear />
          </Form.Item>
          <Form.Item label="Scope (optional)" name="scope">
            <Select
              allowClear
              placeholder="Select scope"
              options={[
                { value: 'Enterprise', label: 'Enterprise' },
                { value: 'Capability', label: 'Capability' },
                { value: 'Application', label: 'Application' },
              ]}
            />
          </Form.Item>
          <Form.Item label="Status" name="status" rules={[{ required: true, message: 'Status is required' }]}>
            <Select
              options={[
                { label: 'DRAFT', value: 'DRAFT' },
                { label: 'COMMITTED', value: 'COMMITTED' },
                { label: 'DISCARDED', value: 'DISCARDED' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={freeShapeModalOpen}
        title={(() => {
          const kind = pendingFreeShapeDraft?.kind;
          const def = FREE_SHAPE_DEFINITIONS.find((shape) => shape.kind === kind);
          return def ? `Name ${def.label}` : 'Name shape';
        })()}
        okText="Create"
        cancelText="Cancel"
        onCancel={() => {
          setFreeShapeModalOpen(false);
          setPendingFreeShapeDraft(null);
          freeShapeForm.resetFields();
        }}
        onOk={async () => {
          if (!pendingFreeShapeDraft) return;
          try {
            const values = await freeShapeForm.validateFields();
            const label = String(values.label || '').trim();
            if (!label) {
              message.error('Label is required.');
              return;
            }
            updateFreeShape(pendingFreeShapeDraft.id, { label });
            setFreeShapeModalOpen(false);
            setPendingFreeShapeDraft(null);
            freeShapeForm.resetFields();
          } catch {
            // validation handled by Form
          }
        }}
      >
        <Form form={freeShapeForm} layout="vertical">
          <Form.Item label="Label" name="label" rules={[{ required: true, message: 'Label is required' }]}>
            <Input placeholder="Enter label" autoFocus allowClear />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={createModalOpen}
        title={pendingElementType ? `Name new ${pendingElementLabel ?? pendingElementType}` : 'Name new element'}
        okText="Create"
        cancelText="Cancel"
        onCancel={() => {
          setCreateModalOpen(false);
          setPendingElementType(null);
          setPendingElementVisualKind(null);
          setPlacement(null);
          setPendingElementNameDraft(null);
          setPlacementModeActive(false);
          setToolMode('SELECT');
          form.resetFields();
        }}
        onOk={async () => {
          if (!pendingElementType) return;
          if (!eaRepository) return;
          try {
            const values = await form.validateFields();
            const name = String(values.name || '').trim();
            if (!name) {
              message.error('Name is required.');
              return;
            }
            const description = String(values.description || '').trim();
            const resolvedPlacement = placement ?? (cyRef.current ? getCanvasCenter() : getCanvasCenterPosition());
            if (!resolvedPlacement) {
              setPendingElementNameDraft({ type: pendingElementType, name, description, visualKind: pendingElementVisualKind });
              setCreateModalOpen(false);
              setToolMode('CREATE_ELEMENT');
              setPlacementModeActive(true);
              message.info(`Click the canvas to place "${name}".`);
              return;
            }
            const id = stageElement({
              type: pendingElementType,
              name,
              description,
              placement: resolvedPlacement,
              visualKind: pendingElementVisualKind,
            });
            if (!id) return;
            openPropertiesPanel({ elementId: id, elementType: pendingElementType, dock: 'right', readOnly: false });
            setCreateModalOpen(false);
            setPendingElementType(null);
            setPendingElementVisualKind(null);
            setPlacement(null);
            setPendingElementDraft(null);
            setPendingElementNameDraft(null);
            form.resetFields();
            message.success(`${pendingElementType} created in Explorer and placed on canvas.`);
          } catch {
            // validation errors handled by Form
          }
        }}
      >
        <Alert
          type="info"
          showIcon
          message="Toolbox creates new elements"
          description="This will create the element in Explorer and place it on the canvas."
          style={{ marginBottom: 12 }}
        />
        <Form form={form} layout="vertical">
          <Form.Item label="Name" name="name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder="Enter name" autoFocus allowClear />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea placeholder="Optional description" rows={3} allowClear />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={auditPreviewOpen}
        title="Audit & Impact Preview"
        okText="Confirm and create"
        cancelText="Cancel"
        onCancel={() => {
          setAuditPreviewOpen(false);
          setPendingElementDraft(null);
          setPendingElementVisualKind(null);
        }}
        onOk={() => {
          if (!pendingElementDraft) return;
          const id = stageElement({
            type: pendingElementDraft.type,
            name: pendingElementDraft.name,
            description: pendingElementDraft.description,
            placement: pendingElementDraft.placement,
            visualKind: pendingElementDraft.visualKind,
          });
          if (!id) return;

          setAuditPreviewOpen(false);
          setCreateModalOpen(false);
          setPendingElementType(null);
          setPendingElementVisualKind(null);
          setPlacement(null);
          setPendingElementDraft(null);
          form.resetFields();
          message.success(`${pendingElementDraft.type} created in Explorer and placed on canvas.`);
        }}
      >
        <Typography.Text strong>Elements to be created</Typography.Text>
        <ul style={{ marginTop: 6, paddingLeft: 18 }}>
          <li>
            {pendingElementDraft
              ? `${pendingElementDraft.type}: ${pendingElementDraft.name || '(unnamed)'}`
              : '—'}
          </li>
        </ul>
        <Typography.Text strong>Relationships affected</Typography.Text>
        <ul style={{ marginTop: 6, paddingLeft: 18 }}>
          <li>None (no relationships will be created).</li>
        </ul>
        <Typography.Text strong>Impact summary</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>
          New element will be created in Explorer and displayed on the canvas.
        </Typography.Paragraph>
      </Modal>

    </div>
  );
};

export default StudioShell;
