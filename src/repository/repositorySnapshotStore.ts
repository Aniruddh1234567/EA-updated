import type { EaRepositoryMetadata } from '@/repository/repositoryMetadata';
import type { EaObject, EaRelationship } from '@/pages/dependency-view/utils/eaRepository';
import type { ViewInstance } from '@/diagram-studio/viewpoints/ViewInstance';
import type { DesignWorkspace } from '@/ea/DesignWorkspaceStore';

export const REPOSITORY_SNAPSHOT_STORAGE_KEY = 'ea.repository.snapshot.v1';

export type RepositoryStudioState = {
  viewLayouts?: Record<string, Record<string, { x: number; y: number; width?: number; height?: number }>>;
  designWorkspaces?: DesignWorkspace[];
};

export type RepositorySnapshot = {
  version: 1;
  metadata: EaRepositoryMetadata;
  objects: EaObject[];
  relationships: EaRelationship[];
  updatedAt: string;
  views?: ViewInstance[];
  studioState?: RepositoryStudioState;
};

const canUseStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const safeParse = <T,>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const readRepositorySnapshot = (): RepositorySnapshot | null => {
  if (!canUseStorage()) return null;
  const parsed = safeParse<RepositorySnapshot>(window.localStorage.getItem(REPOSITORY_SNAPSHOT_STORAGE_KEY));
  return parsed ?? null;
};

export const writeRepositorySnapshot = (snapshot: RepositorySnapshot): void => {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(REPOSITORY_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Best-effort only.
  }
};

export const updateRepositorySnapshot = (
  updater: (current: RepositorySnapshot | null) => RepositorySnapshot | null,
): RepositorySnapshot | null => {
  if (!canUseStorage()) return null;
  const current = readRepositorySnapshot();
  const next = updater(current);
  if (next) writeRepositorySnapshot(next);
  return next;
};
