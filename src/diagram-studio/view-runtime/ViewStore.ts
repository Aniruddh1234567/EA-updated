import type { ViewInstance, ViewStatus } from '../viewpoints/ViewInstance';
import { readRepositorySnapshot, updateRepositorySnapshot } from '@/repository/repositorySnapshotStore';

const LEGACY_STORAGE_KEY = 'ea:diagram-views';

const dispatchViewsChanged = () => {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('ea:viewsChanged'));
    }
  } catch {
    // Best-effort only.
  }
};

const readLegacyViews = (): ViewInstance[] => {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ViewInstance[];
  } catch {
    return [];
  }
};

const clearLegacyViews = () => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
};

const readFromStorage = (): ViewInstance[] => {
  const snapshot = readRepositorySnapshot();
  const views = snapshot?.views;
  if (Array.isArray(views)) return views as ViewInstance[];

  const legacy = readLegacyViews();
  if (legacy.length > 0 && snapshot) {
    updateRepositorySnapshot((current) => {
      if (!current) return current;
      return { ...current, views: legacy, updatedAt: new Date().toISOString() };
    });
    clearLegacyViews();
  }

  return legacy;
};

const writeToStorage = (views: ViewInstance[]) => {
  updateRepositorySnapshot((current) => {
    if (!current) return current;
    return { ...current, views, updatedAt: new Date().toISOString() };
  });
};

const upsert = (view: ViewInstance): ViewInstance => {
  const existing = readFromStorage();
  const nextStatus: ViewStatus = 'SAVED';
  const normalized: ViewInstance = {
    ...view,
    status: nextStatus,
  };

  const byId = new Map(existing.map((v) => [v.id, v] as const));
  byId.set(view.id, normalized);
  const merged = Array.from(byId.values());

  writeToStorage(merged);
  dispatchViewsChanged();
  return normalized;
};

const removeById = (viewId: string): boolean => {
  const existing = readFromStorage();
  const next = existing.filter((v) => v.id !== viewId);
  if (next.length === existing.length) return false;
  writeToStorage(next);
  dispatchViewsChanged();
  return true;
};

export const ViewStore = {
  /** Persist a view and mark it as SAVED. */
  save(view: ViewInstance): ViewInstance {
    return upsert(view);
  },

  /** Replace the full view collection. */
  replaceAll(views: ViewInstance[]): void {
    const normalized = Array.isArray(views)
      ? views.map((view) => ({
        ...view,
        status: 'SAVED' as ViewStatus,
      }))
      : [];
    writeToStorage(normalized);
    dispatchViewsChanged();
  },

  update(viewId: string, updater: (current: ViewInstance) => ViewInstance): ViewInstance | undefined {
    const existing = readFromStorage();
    const current = existing.find((v) => v.id === viewId);
    if (!current) return undefined;
    const next = updater(current);
    return upsert(next);
  },

  remove(viewId: string): boolean {
    const existing = readFromStorage();
    const next = existing.filter((v) => v.id !== viewId);
    if (next.length === existing.length) return false;
    writeToStorage(next);
    dispatchViewsChanged();
    return true;
  },

  /** Update a view in-place and mark it as SAVED. */
  update(viewId: string, updater: (current: ViewInstance) => ViewInstance): ViewInstance | undefined {
    const current = readFromStorage().find((v) => v.id === viewId);
    if (!current) return undefined;
    return upsert(updater(current));
  },

  /** Remove a view by id. */
  remove(viewId: string): boolean {
    return removeById(viewId);
  },

  list(): ViewInstance[] {
    return readFromStorage();
  },

  get(viewId: string): ViewInstance | undefined {
    return readFromStorage().find((v) => v.id === viewId);
  },
};
