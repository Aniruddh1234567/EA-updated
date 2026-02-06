import { projectStore } from '../project/ProjectStore';
import type { Project } from '../project/project';
import { ViewRepository } from './ViewRepository';
import type { ViewDefinition } from './ViewDefinition';

let viewRepository: ViewRepository | null = null;
let viewsRevision = 0;

export function getViewRepositoryRevision(): number {
  return viewsRevision;
}

const notifyViewsChanged = () => {
  viewsRevision += 1;
  // Browser-only: safe no-op in mock/server contexts.
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('ea:viewsChanged'));
    }
  } catch {
    // Best-effort only.
  }
};

/**
 * Singleton in-memory ViewRepository for the running process.
 *
 * Project scoping:
 * - Enforces unique view names per project by binding the repository to the current project id.
 * - Resets on server restart / refresh.
 * - No persistence.
 */
export function getViewRepository(): ViewRepository {
  let project = projectStore.getProject();
  let projectId = project?.id ?? '';

  // Auto-provision an in-memory project when absent to avoid blocking UX in demo/dev modes.
  if (!projectId) {
    const now = new Date().toISOString();
    const fallbackProject: Project = {
      id: 'default-project',
      name: 'Default Project',
      shortCode: 'EA',
      description: 'Auto-created in-memory project for view operations.',
      organizationName: 'Default Org',
      businessUnitsInScope: [],
      geographyInScope: 'Global',
      architectureLayersInScope: {
        business: true,
        application: true,
        technology: true,
        implementationMigration: true,
        governance: true,
      },
      config: { governanceEnforcementMode: 'Advisory' },
      baselineType: 'Current State',
      baselineStartDate: now,
      baselineEndDate: undefined,
      chiefArchitect: 'Auto',
      owningDepartment: 'EA',
      contactEmail: 'ea@example.com',
      createdAt: now,
      createdBy: 'system',
      status: 'Active',
    };

    try {
      project = projectStore.createProject(fallbackProject);
      projectId = project.id;
    } catch (err) {
      // If creation failed because one already exists, re-read it; otherwise rethrow.
      projectId = projectStore.getProject()?.id ?? '';
      if (!projectId) {
        throw err;
      }
    }
  }

  if (!viewRepository || viewRepository.projectId !== projectId) {
    viewRepository = new ViewRepository(projectId);
    notifyViewsChanged();
  }

  return viewRepository;
}

export function createView(view: ViewDefinition) {
  const result = getViewRepository().createView(view);
  if (result.ok) notifyViewsChanged();
  return result;
}

export function deleteView(viewId: string) {
  const result = getViewRepository().deleteViewById(viewId);
  if (result.ok) notifyViewsChanged();
  return result;
}

export function updateViewRoot(args: { viewId: string; rootElementId: string; rootElementType: string; lastModifiedAt?: string }) {
  const result = getViewRepository().updateViewRoot(args);
  if (result.ok) notifyViewsChanged();
  return result;
}
