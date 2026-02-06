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
  view.name = name;
  createView(view);
};

/**
 * Domain scope: seed a minimal, focused set of default views.
 *
 * Notes:
 * - Views are metadata only (no repository elements are created).
 * - Best-effort: will throw if there is no active project.
 */
export function seedDefaultViewsForDomainScope(): void {
  getViewRepository();

  const createdAt = nowIso();

  upsertByName('Domain Capability Traceability', () => ({
    id: makeId(),
    name: 'Domain Capability Traceability',
    description: 'Domain capability-to-process traceability (focused business view).',
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

  upsertByName('Domain Application Landscape', () => ({
    id: makeId(),
    name: 'Domain Application Landscape',
    description: 'High-level domain application inventory view.',
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
}
