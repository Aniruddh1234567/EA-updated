type StudioEntryPayload = {
  id?: string;
  name?: string;
  description?: string;
  layout?: unknown;
  repositoryId?: string | null;
};

let activeStudioRepositoryId: string | null = null;

export const setStudioActiveRepositoryId = (repositoryId: string | null) => {
  activeStudioRepositoryId = repositoryId ?? null;
};

export const getStudioActiveRepositoryId = () => activeStudioRepositoryId;

const readGovernanceMode = (): string | null => {
  try {
    const raw = localStorage.getItem('ea.repository.snapshot.v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { metadata?: { governanceMode?: string } };
    const mode = parsed?.metadata?.governanceMode;
    return typeof mode === 'string' && mode.trim() ? mode.trim() : null;
  } catch {
    return null;
  }
};

const generateWorkspaceId = (): string => {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fallback below.
  }
  return `studio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export const openStudioEntry = (payload: StudioEntryPayload): string => {
  const workspaceId = generateWorkspaceId();
  const governanceMode = readGovernanceMode();
  const workspace = {
    id: workspaceId,
    name: payload?.name ?? payload?.id ?? `Studio ${workspaceId}`,
    description: payload?.description ?? '',
    layout: payload?.layout ?? null,
    mode: 'DRAFT' as const,
    governanceMode: governanceMode ?? undefined,
    repositoryId: payload?.repositoryId ?? undefined,
  };

  try {
    sessionStorage.setItem(`studio:${workspaceId}`, JSON.stringify(workspace));
  } catch {
    // Best-effort only.
  }

  console.info('Entered Studio workspace', workspaceId);
  try {
    window.dispatchEvent(
      new CustomEvent('ea:studio.open', {
        detail: {
          id: workspaceId,
          name: workspace.name,
          description: workspace.description,
          layout: workspace.layout ?? null,
          repositoryId: workspace.repositoryId ?? undefined,
          governanceMode: workspace.governanceMode ?? undefined,
        },
      }),
    );
  } catch {
    // Best-effort only.
  }
  return workspaceId;
};
