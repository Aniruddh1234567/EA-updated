import { readRepositorySnapshot, updateRepositorySnapshot } from '@/repository/repositorySnapshotStore';

export type ViewNodePosition = { x: number; y: number; width?: number; height?: number };
export type ViewLayoutPositions = Record<string, ViewNodePosition>;

const LEGACY_PREFIX = 'ea.view.layout.positions:';

const legacyKeyForView = (viewId: string) => `${LEGACY_PREFIX}${viewId}`;

const readLegacyLayout = (viewId: string): ViewLayoutPositions => {
  if (!viewId || typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(legacyKeyForView(viewId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as ViewLayoutPositions;
  } catch {
    // ignore
  }
  return {};
};

const removeLegacyLayout = (viewId: string) => {
  if (!viewId || typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(legacyKeyForView(viewId));
  } catch {
    // ignore
  }
};

const readLayoutFromSnapshot = (viewId: string): ViewLayoutPositions => {
  if (!viewId) return {};
  const snapshot = readRepositorySnapshot();
  const fromSnapshot = snapshot?.studioState?.viewLayouts?.[viewId];
  if (fromSnapshot && typeof fromSnapshot === 'object') return fromSnapshot as ViewLayoutPositions;

  const legacy = readLegacyLayout(viewId);
  if (Object.keys(legacy).length > 0 && snapshot) {
    updateRepositorySnapshot((current) => {
      if (!current) return current;
      const studioState = current.studioState ?? {};
      const viewLayouts = { ...(studioState.viewLayouts ?? {}), [viewId]: legacy };
      return { ...current, studioState: { ...studioState, viewLayouts }, updatedAt: new Date().toISOString() };
    });
    removeLegacyLayout(viewId);
  }

  return legacy;
};

const writeLayoutToSnapshot = (viewId: string, layout: ViewLayoutPositions): void => {
  if (!viewId) return;
  updateRepositorySnapshot((current) => {
    if (!current) return current;
    const studioState = current.studioState ?? {};
    const viewLayouts = { ...(studioState.viewLayouts ?? {}), [viewId]: layout };
    return { ...current, studioState: { ...studioState, viewLayouts }, updatedAt: new Date().toISOString() };
  });
};

const removeLayoutFromSnapshot = (viewId: string): void => {
  if (!viewId) return;
  updateRepositorySnapshot((current) => {
    if (!current) return current;
    const studioState = current.studioState ?? {};
    const viewLayouts = { ...(studioState.viewLayouts ?? {}) };
    delete viewLayouts[viewId];
    return { ...current, studioState: { ...studioState, viewLayouts }, updatedAt: new Date().toISOString() };
  });
};

const listLayoutsFromSnapshot = (): Record<string, ViewLayoutPositions> => {
  const snapshot = readRepositorySnapshot();
  const layouts = snapshot?.studioState?.viewLayouts ?? {};
  return { ...layouts };
};

export const ViewLayoutStore = {
  get(viewId: string): ViewLayoutPositions {
    return readLayoutFromSnapshot(viewId);
  },

  set(viewId: string, layout: ViewLayoutPositions): void {
    writeLayoutToSnapshot(viewId, layout);
  },

  /** Update a single element position within a view layout (merge). */
  updatePosition(viewId: string, elementId: string, pos: ViewNodePosition): void {
    if (!viewId || !elementId) return;
    const current = readLayoutFromSnapshot(viewId);
    writeLayoutToSnapshot(viewId, { ...current, [elementId]: pos });
  },

  /** Batch-update multiple element positions within a view layout (merge). */
  updatePositions(viewId: string, positions: Record<string, ViewNodePosition>): void {
    if (!viewId) return;
    const current = readLayoutFromSnapshot(viewId);
    writeLayoutToSnapshot(viewId, { ...current, ...positions });
  },

  /** Remove a single element from a view layout. */
  removeElement(viewId: string, elementId: string): void {
    if (!viewId || !elementId) return;
    const current = readLayoutFromSnapshot(viewId);
    const next = { ...current };
    delete next[elementId];
    writeLayoutToSnapshot(viewId, next);
  },

  remove(viewId: string): void {
    removeLayoutFromSnapshot(viewId);
  },

  listAll(): Record<string, ViewLayoutPositions> {
    return listLayoutsFromSnapshot();
  },
};
