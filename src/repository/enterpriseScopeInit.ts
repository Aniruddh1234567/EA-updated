import { createView, getViewRepository } from '../../backend/views/ViewRepositoryStore';
import type { ViewDefinition } from '../../backend/views/ViewDefinition';

const makeId = (): string => {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch {
    // ignore
  }
  return `view-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const nowIso = () => new Date().toISOString();

const upsertByName = (name: string, viewFactory: () => ViewDefinition) => {
  const repo = getViewRepository();
  const existing = repo
    .listAllViews()
    .find((v) => (v.name ?? '').trim().toLowerCase() === name.trim().toLowerCase());
  if (existing) return;

  const view = viewFactory();
  // Ensure the name matches exactly what we checked.
  view.name = name;
  createView(view);
};

/**
 * Enterprise scope: seed a sensible set of default view definitions.
 *
 * Notes:
 * - Views are metadata only (no repository elements are created).
 * - Best-effort: will throw if there is no active project.
 */
export function seedDefaultViewsForEnterpriseScope(): void {
  // This call will throw if there is no active project. Let the caller decide.
  getViewRepository();

  const createdAt = nowIso();

  upsertByName('Capability Map', () => ({
    id: makeId(),
    name: 'Capability Map',
    description: 'Business capability map with traceability to business processes.',
    viewType: 'CapabilityMap',
    architectureLayer: 'Business',
    allowedElementTypes: ['Capability', 'BusinessProcess'],
    allowedRelationshipTypes: ['DECOMPOSES_TO', 'COMPOSED_OF', 'REALIZED_BY'],
    layoutType: 'Hierarchical',
    orientation: 'LeftToRight',
    scopeType: 'ENTIRE_REPOSITORY',
    scopeIds: [],
    createdBy: 'system',
    createdAt,
    lastModifiedAt: createdAt,
    approvalStatus: 'Draft',
  }));

  upsertByName('Application Dependency', () => ({
    id: makeId(),
    name: 'Application Dependency',
    description: 'Application-to-application integration view (INTEGRATES_WITH).',
    viewType: 'ApplicationDependency',
    architectureLayer: 'Application',
    allowedElementTypes: ['Application'],
    allowedRelationshipTypes: ['INTEGRATES_WITH'],
    layoutType: 'Force',
    orientation: 'LeftToRight',
    scopeType: 'ENTIRE_REPOSITORY',
    scopeIds: [],
    createdBy: 'system',
    createdAt,
    lastModifiedAt: createdAt,
    approvalStatus: 'Draft',
  }));

  upsertByName('Application Landscape', () => ({
    id: makeId(),
    name: 'Application Landscape',
    description: 'High-level application inventory and grouping view.',
    viewType: 'ApplicationLandscape',
    architectureLayer: 'Application',
    allowedElementTypes: ['Application'],
    allowedRelationshipTypes: [],
    layoutType: 'Grid',
    orientation: 'LeftToRight',
    scopeType: 'ENTIRE_REPOSITORY',
    scopeIds: [],
    createdBy: 'system',
    createdAt,
    lastModifiedAt: createdAt,
    approvalStatus: 'Draft',
  }));

  upsertByName('Technology Landscape', () => ({
    id: makeId(),
    name: 'Technology Landscape',
    description: 'Technology/platform inventory view.',
    viewType: 'TechnologyLandscape',
    architectureLayer: 'Technology',
    allowedElementTypes: ['Technology'],
    allowedRelationshipTypes: [],
    layoutType: 'Grid',
    orientation: 'LeftToRight',
    scopeType: 'ENTIRE_REPOSITORY',
    scopeIds: [],
    createdBy: 'system',
    createdAt,
    lastModifiedAt: createdAt,
    approvalStatus: 'Draft',
  }));
}
