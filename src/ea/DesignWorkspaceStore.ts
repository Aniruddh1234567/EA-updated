import type { ObjectType, RelationshipType } from '@/pages/dependency-view/utils/eaMetaModel';
import { readRepositorySnapshot, updateRepositorySnapshot } from '@/repository/repositorySnapshotStore';

export type DesignWorkspaceStatus = 'DRAFT' | 'COMMITTED' | 'DISCARDED';

export type ModelingState = 'DRAFT' | 'COMMITTED' | 'REVIEW_READY' | 'APPROVED';

export type DesignWorkspaceMode = 'STANDARD' | 'ITERATIVE';

export type DesignWorkspaceScope = 'Enterprise' | 'Capability' | 'Application';

export type DesignWorkspaceLayoutNode = {
  id: string;
  label: string;
  elementType: ObjectType;
  x: number;
  y: number;
  viewInstance?: boolean;
};

export type DesignWorkspaceLayoutEdge = {
  id: string;
  source: string;
  target: string;
  relationshipType: RelationshipType;
};

export type DesignWorkspaceLayout = {
  nodes: DesignWorkspaceLayoutNode[];
  edges: DesignWorkspaceLayoutEdge[];
};

export type DesignWorkspaceStagedElement = {
  id: string;
  kind: 'element';
  type: ObjectType;
  name: string;
  description?: string;
  attributes?: Record<string, unknown>;
  createdAt: string;
  createdBy?: string;
  modelingState: ModelingState;
  status: 'STAGED' | 'COMMITTED' | 'DISCARDED';
};

export type DesignWorkspaceStagedRelationship = {
  id: string;
  kind: 'relationship';
  type: RelationshipType;
  fromId: string;
  toId: string;
  attributes?: Record<string, unknown>;
  createdAt: string;
  createdBy?: string;
  modelingState: ModelingState;
  status: 'STAGED' | 'COMMITTED' | 'DISCARDED';
};

export type DesignWorkspace = {
  id: string;
  repositoryName: string;
  name: string;
  description?: string;
  scope?: DesignWorkspaceScope;
  mode?: DesignWorkspaceMode;
  status: DesignWorkspaceStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  repositoryUpdatedAt?: string;
  layout?: DesignWorkspaceLayout;
  stagedElements: DesignWorkspaceStagedElement[];
  stagedRelationships: DesignWorkspaceStagedRelationship[];
};

const storageKeyForRepo = (repositoryName: string) => `ea.designWorkspaces.${repositoryName}`;

const safeRepositoryName = (repositoryName: string) => (repositoryName || 'default').trim() || 'default';

const readLegacyWorkspaces = (repositoryName: string): DesignWorkspace[] => {
  const key = storageKeyForRepo(safeRepositoryName(repositoryName));
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DesignWorkspace[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
};

const clearLegacyWorkspaces = (repositoryName: string) => {
  const key = storageKeyForRepo(safeRepositoryName(repositoryName));
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
};

const normalizeWorkspaces = (items: DesignWorkspace[]): DesignWorkspace[] =>
  items
    .filter((w) => w && typeof w.id === 'string')
    .map((w) => {
      const stagedElements = Array.isArray(w.stagedElements)
        ? w.stagedElements.map((el) => ({
          ...el,
          attributes: (el as any)?.attributes ?? {},
          modelingState: (el as any)?.modelingState ?? 'DRAFT',
        }))
        : [];
      const stagedRelationships = Array.isArray(w.stagedRelationships)
        ? w.stagedRelationships.map((rel) => ({
          ...rel,
          attributes: (rel as any)?.attributes ?? {},
          modelingState: (rel as any)?.modelingState ?? 'DRAFT',
        }))
        : [];
      const layoutNodes = Array.isArray(w.layout?.nodes) ? w.layout?.nodes ?? [] : [];
      const layoutEdges = Array.isArray(w.layout?.edges) ? w.layout?.edges ?? [] : [];
      return {
        ...w,
        status: (w.status as DesignWorkspaceStatus) ?? 'DRAFT',
        createdBy: (w.createdBy ?? 'unknown') as string,
        mode: (w as any)?.mode ?? 'ITERATIVE',
        stagedElements,
        stagedRelationships,
        layout: { nodes: layoutNodes, edges: layoutEdges },
      } as DesignWorkspace;
    });

const readWorkspaces = (repositoryName: string): DesignWorkspace[] => {
  const snapshot = readRepositorySnapshot();
  const items = snapshot?.studioState?.designWorkspaces ?? [];
  const normalizedRepo = safeRepositoryName(repositoryName);
  const filtered = normalizeWorkspaces(items).filter((w) => safeRepositoryName(w.repositoryName) === normalizedRepo);
  if (filtered.length > 0) return filtered;

  const legacy = normalizeWorkspaces(readLegacyWorkspaces(repositoryName)).filter((w) => safeRepositoryName(w.repositoryName) === normalizedRepo);
  if (legacy.length > 0 && snapshot) {
    updateRepositorySnapshot((current) => {
      if (!current) return current;
      const studioState = current.studioState ?? {};
      const existing = normalizeWorkspaces(studioState.designWorkspaces ?? []);
      const merged = existing.filter((w) => safeRepositoryName(w.repositoryName) !== normalizedRepo).concat(legacy);
      return { ...current, studioState: { ...studioState, designWorkspaces: merged }, updatedAt: new Date().toISOString() };
    });
    clearLegacyWorkspaces(repositoryName);
  }

  return legacy;
};

const writeWorkspaces = (repositoryName: string, items: DesignWorkspace[]) => {
  const normalizedRepo = safeRepositoryName(repositoryName);
  const normalized = normalizeWorkspaces(items).map((w) => ({
    ...w,
    repositoryName: normalizedRepo,
  }));

  updateRepositorySnapshot((current) => {
    if (!current) return current;
    const studioState = current.studioState ?? {};
    const existing = normalizeWorkspaces(studioState.designWorkspaces ?? []);
    const merged = existing.filter((w) => safeRepositoryName(w.repositoryName) !== normalizedRepo).concat(normalized);
    return { ...current, studioState: { ...studioState, designWorkspaces: merged }, updatedAt: new Date().toISOString() };
  });
};

export const DesignWorkspaceStore = {
  list(repositoryName: string): DesignWorkspace[] {
    return readWorkspaces(repositoryName).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },

  replaceAll(repositoryName: string, items: DesignWorkspace[]): void {
    writeWorkspaces(repositoryName, Array.isArray(items) ? items : []);
  },

  get(repositoryName: string, id: string): DesignWorkspace | undefined {
    return readWorkspaces(repositoryName).find((w) => w.id === id);
  },

  save(repositoryName: string, workspace: DesignWorkspace): DesignWorkspace {
    const existing = readWorkspaces(repositoryName);
    const next = new Map(existing.map((w) => [w.id, w] as const));
    next.set(workspace.id, { ...workspace, repositoryName: safeRepositoryName(repositoryName) });
    const merged = Array.from(next.values());
    writeWorkspaces(repositoryName, merged);
    return workspace;
  },

  remove(repositoryName: string, workspaceId: string): void {
    const existing = readWorkspaces(repositoryName);
    const filtered = existing.filter((w) => w.id !== workspaceId);
    writeWorkspaces(repositoryName, filtered);
  },
};
