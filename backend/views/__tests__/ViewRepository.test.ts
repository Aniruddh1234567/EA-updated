import { ViewRepository } from '../ViewRepository';
import type { ViewDefinition } from '../ViewDefinition';

const makeView = (overrides?: Partial<ViewDefinition>): ViewDefinition => {
  const now = new Date('2026-01-11T00:00:00.000Z').toISOString();
  return {
    id: 'view-1',
    name: 'My View',
    description: 'Desc',
    viewType: 'CapabilityMap',
    architectureLayer: 'Business',
    rootElementId: undefined,
    rootElementType: undefined,
    maxDepth: 2,
    // Must conform to CapabilityMap viewType rules (see backend/views/ViewRepository.ts).
    allowedElementTypes: ['Capability', 'BusinessProcess'],
    allowedRelationshipTypes: ['DECOMPOSES_TO', 'COMPOSED_OF', 'REALIZED_BY'],
    layoutType: 'Force',
    orientation: 'LeftToRight',
    scopeType: 'ENTIRE_REPOSITORY',
    scopeIds: [],
    createdBy: 'test',
    createdAt: now,
    lastModifiedAt: now,
    approvalStatus: 'Draft',
    ...(overrides ?? {}),
  };
};

describe('ViewRepository', () => {
  test('rejects view definitions that embed payloads', () => {
    const repo = new ViewRepository('p1');

    const viewWithEmbedded = {
      ...makeView(),
      // Illegal: view definitions must not embed elements.
      elements: [{ id: 'app-1' }],
    } as unknown as ViewDefinition;

    const result = repo.createView(viewWithEmbedded);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('must not embed payloads');
    }
  });

  test('deleteViewById removes view and frees name', () => {
    const repo = new ViewRepository('p1');

    expect(repo.createView(makeView({ id: 'v1', name: 'A' })).ok).toBe(true);
    expect(repo.getViewById('v1')?.name).toBe('A');

    const del = repo.deleteViewById('v1');
    expect(del.ok).toBe(true);
    expect(repo.getViewById('v1')).toBeNull();

    // Same name should now be allowed again.
    const recreated = repo.createView(makeView({ id: 'v2', name: 'A' }));
    expect(recreated.ok).toBe(true);
  });

  test('deleteViewById rejects unknown ids', () => {
    const repo = new ViewRepository('p1');
    const del = repo.deleteViewById('missing');
    expect(del.ok).toBe(false);
  });
});
