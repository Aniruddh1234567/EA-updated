/**
 * Repository Persistence & Rehydration Tests
 *
 * Validates the foundational contract:
 * 1. Everything created in Studio is immediately persisted to the repository.
 * 2. On repo reopen, all elements, relationships, and positions are restored.
 * 3. Canvas is a pure projection — repository is the single source of truth.
 */

import { EaRepository } from '@/pages/dependency-view/utils/eaRepository';
import {
  readRepositorySnapshot,
  writeRepositorySnapshot,
  REPOSITORY_SNAPSHOT_STORAGE_KEY,
  type RepositorySnapshot,
} from '@/repository/repositorySnapshotStore';
import { ViewLayoutStore } from '@/diagram-studio/view-runtime/ViewLayoutStore';
import { ViewStore } from '@/diagram-studio/view-runtime/ViewStore';
import { DesignWorkspaceStore } from '@/ea/DesignWorkspaceStore';
import type { ViewInstance } from '@/diagram-studio/viewpoints/ViewInstance';
import type { DesignWorkspace } from '@/ea/DesignWorkspaceStore';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_METADATA = {
  repositoryName: 'test-repo',
  organizationName: 'Test Org',
  architectureScope: 'Enterprise' as const,
  referenceFramework: 'Custom' as const,
  governanceMode: 'Advisory' as const,
  lifecycleCoverage: 'As-Is' as const,
  timeHorizon: 'Current' as const,
  owner: { userId: 'test-user', displayName: 'Test User' },
  createdAt: new Date().toISOString(),
  frameworkConfig: {
    custom: {
      enabledObjectTypes: [
        'Enterprise',
        'Application',
        'Technology',
        'Capability',
        'BusinessService',
        'BusinessProcess',
        'Department',
        'Database',
      ],
      enabledRelationshipTypes: [
        'OWNS',
        'DEPLOYED_ON',
        'USES',
        'DEPENDS_ON',
        'SERVED_BY',
        'INTEGRATES_WITH',
        'COMPOSED_OF',
        'DECOMPOSES_TO',
        'REALIZES',
      ],
    },
  },
};

const buildSnapshot = (repo: EaRepository, extra?: Partial<RepositorySnapshot>): RepositorySnapshot => ({
  version: 1,
  metadata: TEST_METADATA,
  objects: Array.from(repo.objects.values()),
  relationships: repo.relationships,
  updatedAt: new Date().toISOString(),
  views: [],
  studioState: { viewLayouts: {}, designWorkspaces: [] },
  ...extra,
});

const makeTestView = (id: string, name: string): ViewInstance => ({
  id,
  name,
  description: '',
  viewpointId: 'application-landscape',
  scope: { kind: 'EntireRepository' },
  layoutMetadata: {},
  createdAt: new Date().toISOString(),
  createdBy: 'test-user',
  status: 'SAVED',
});

const makeTestWorkspace = (repositoryName: string, overrides?: Partial<DesignWorkspace>): DesignWorkspace => ({
  id: `ws-${Date.now()}`,
  repositoryName,
  name: 'Test Workspace',
  description: '',
  status: 'DRAFT',
  createdBy: 'test-user',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  mode: 'ITERATIVE',
  stagedElements: [],
  stagedRelationships: [],
  layout: { nodes: [], edges: [] },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

// ===========================================================================
// PERSISTENCE TESTS
// ===========================================================================

describe('Repository Persistence', () => {
  test('create element → close → reopen → element exists', () => {
    // 1. Create repository with an element
    const repo = new EaRepository();
    repo.addObject({ id: 'ent-1', type: 'Enterprise', attributes: { name: 'Acme Corp' } });
    repo.addObject({ id: 'app-1', type: 'Application', attributes: { name: 'CRM System' } });

    // 2. Persist to localStorage
    const snapshot = buildSnapshot(repo);
    writeRepositorySnapshot(snapshot);

    // 3. Simulate close (clear in-memory state)
    // (in real app, EaRepositoryContext.clearRepository)

    // 4. Reopen — read from localStorage
    const restored = readRepositorySnapshot();
    expect(restored).not.toBeNull();
    expect(restored!.objects).toHaveLength(2);
    expect(restored!.objects.find((o) => o.id === 'ent-1')).toBeTruthy();
    expect(restored!.objects.find((o) => o.id === 'app-1')).toBeTruthy();

    // 5. Reconstruct EaRepository
    const restoredRepo = new EaRepository({
      objects: restored!.objects,
      relationships: restored!.relationships,
    });
    expect(restoredRepo.objects.size).toBe(2);
    expect(restoredRepo.objects.get('app-1')?.type).toBe('Application');
    expect((restoredRepo.objects.get('app-1')?.attributes as any)?.name).toBe('CRM System');
  });

  test('move element → reopen → same position', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'app-1', type: 'Application', attributes: { name: 'App' } });

    // Persist repo with layout positions in workspace
    const workspace = makeTestWorkspace('test-repo', {
      layout: {
        nodes: [{ id: 'app-1', label: 'App', elementType: 'Application' as any, x: 300, y: 450 }],
        edges: [],
      },
    });
    const snapshot = buildSnapshot(repo, {
      studioState: { viewLayouts: {}, designWorkspaces: [workspace] },
    });
    writeRepositorySnapshot(snapshot);

    // Reopen
    const restored = readRepositorySnapshot();
    const restoredWorkspaces = restored!.studioState?.designWorkspaces ?? [];
    expect(restoredWorkspaces).toHaveLength(1);
    const restoredLayout = restoredWorkspaces[0].layout;
    expect(restoredLayout?.nodes).toHaveLength(1);
    expect(restoredLayout!.nodes[0].x).toBe(300);
    expect(restoredLayout!.nodes[0].y).toBe(450);
  });

  test('create relationship → reopen → edge exists', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'ent-1', type: 'Enterprise', attributes: { name: 'Ent' } });
    repo.addObject({ id: 'app-1', type: 'Application', attributes: { name: 'App' } });
    repo.addRelationship({ fromId: 'ent-1', toId: 'app-1', type: 'OWNS' });

    const snapshot = buildSnapshot(repo);
    writeRepositorySnapshot(snapshot);

    const restored = readRepositorySnapshot();
    expect(restored!.relationships).toHaveLength(1);
    expect(restored!.relationships[0].fromId).toBe('ent-1');
    expect(restored!.relationships[0].toId).toBe('app-1');
    expect(restored!.relationships[0].type).toBe('OWNS');

    const restoredRepo = new EaRepository({
      objects: restored!.objects,
      relationships: restored!.relationships,
    });
    expect(restoredRepo.relationships).toHaveLength(1);
    expect(restoredRepo.relationships[0].type).toBe('OWNS');
  });

  test('element attributes survive persistence round-trip', () => {
    const repo = new EaRepository();
    repo.addObject({
      id: 'app-1',
      type: 'Application',
      attributes: {
        name: 'ERP System',
        description: 'Enterprise Resource Planning',
        lifecycleState: 'Active',
        createdAt: '2024-01-01T00:00:00.000Z',
        createdBy: 'architect',
      },
    });

    writeRepositorySnapshot(buildSnapshot(repo));
    const restored = readRepositorySnapshot();
    const obj = restored!.objects.find((o) => o.id === 'app-1');
    expect(obj).toBeTruthy();
    expect((obj!.attributes as any).name).toBe('ERP System');
    expect((obj!.attributes as any).description).toBe('Enterprise Resource Planning');
    expect((obj!.attributes as any).lifecycleState).toBe('Active');
    expect((obj!.attributes as any).createdBy).toBe('architect');
  });
});

// ===========================================================================
// VIEW LAYOUT TESTS
// ===========================================================================

describe('View Layout Persistence', () => {
  test('ViewLayoutStore persists and retrieves positions', () => {
    // Require a snapshot to exist first
    const repo = new EaRepository();
    repo.addObject({ id: 'app-1', type: 'Application', attributes: { name: 'App' } });
    writeRepositorySnapshot(buildSnapshot(repo));

    ViewLayoutStore.set('view-1', {
      'app-1': { x: 100, y: 200 },
    });

    const positions = ViewLayoutStore.get('view-1');
    expect(positions['app-1']).toEqual({ x: 100, y: 200 });
  });

  test('ViewLayoutStore.updatePosition merges into existing layout', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'app-1', type: 'Application', attributes: { name: 'App 1' } });
    repo.addObject({ id: 'app-2', type: 'Application', attributes: { name: 'App 2' } });
    writeRepositorySnapshot(buildSnapshot(repo));

    ViewLayoutStore.set('view-1', {
      'app-1': { x: 100, y: 200 },
    });

    ViewLayoutStore.updatePosition('view-1', 'app-2', { x: 300, y: 400 });

    const positions = ViewLayoutStore.get('view-1');
    expect(positions['app-1']).toEqual({ x: 100, y: 200 });
    expect(positions['app-2']).toEqual({ x: 300, y: 400 });
  });

  test('ViewLayoutStore.updatePositions batch-updates positions', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'app-1', type: 'Application', attributes: {} });
    repo.addObject({ id: 'app-2', type: 'Application', attributes: {} });
    writeRepositorySnapshot(buildSnapshot(repo));

    ViewLayoutStore.set('view-1', { 'app-1': { x: 10, y: 20 } });

    ViewLayoutStore.updatePositions('view-1', {
      'app-1': { x: 50, y: 60 },
      'app-2': { x: 70, y: 80 },
    });

    const positions = ViewLayoutStore.get('view-1');
    expect(positions['app-1']).toEqual({ x: 50, y: 60 });
    expect(positions['app-2']).toEqual({ x: 70, y: 80 });
  });

  test('ViewLayoutStore.removeElement removes single element from layout', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'app-1', type: 'Application', attributes: {} });
    repo.addObject({ id: 'app-2', type: 'Application', attributes: {} });
    writeRepositorySnapshot(buildSnapshot(repo));

    ViewLayoutStore.set('view-1', {
      'app-1': { x: 100, y: 200 },
      'app-2': { x: 300, y: 400 },
    });

    ViewLayoutStore.removeElement('view-1', 'app-1');

    const positions = ViewLayoutStore.get('view-1');
    expect(positions['app-1']).toBeUndefined();
    expect(positions['app-2']).toEqual({ x: 300, y: 400 });
  });

  test('same element in same view renders identically', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'app-1', type: 'Application', attributes: { name: 'CRM' } });
    writeRepositorySnapshot(buildSnapshot(repo));

    ViewLayoutStore.set('view-1', { 'app-1': { x: 150, y: 250 } });

    // Read positions twice — must be identical (deterministic)
    const pos1 = ViewLayoutStore.get('view-1');
    const pos2 = ViewLayoutStore.get('view-1');
    expect(pos1).toEqual(pos2);
    expect(pos1['app-1']).toEqual({ x: 150, y: 250 });
  });

  test('removing element from view does NOT delete it from repository', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'app-1', type: 'Application', attributes: { name: 'App' } });
    repo.addObject({ id: 'app-2', type: 'Application', attributes: { name: 'App 2' } });
    const snapshot = buildSnapshot(repo);
    writeRepositorySnapshot(snapshot);

    ViewLayoutStore.set('view-1', {
      'app-1': { x: 100, y: 200 },
      'app-2': { x: 300, y: 400 },
    });

    // Remove from view layout only
    ViewLayoutStore.removeElement('view-1', 'app-1');

    // Element must still exist in repository
    const restored = readRepositorySnapshot();
    expect(restored!.objects.find((o) => o.id === 'app-1')).toBeTruthy();
    expect(restored!.objects).toHaveLength(2);
  });
});

// ===========================================================================
// NEGATIVE TESTS
// ===========================================================================

describe('Negative Tests — Repository Integrity', () => {
  test('EaRepository rejects duplicate object IDs', () => {
    const repo = new EaRepository();
    expect(repo.addObject({ id: 'ent-1', type: 'Enterprise', attributes: {} }).ok).toBe(true);
    expect(repo.addObject({ id: 'ent-1', type: 'Enterprise', attributes: {} }).ok).toBe(false);
  });

  test('EaRepository rejects invalid object types', () => {
    const repo = new EaRepository();
    expect(repo.addObject({ id: 'x', type: 'InvalidType', attributes: {} }).ok).toBe(false);
  });

  test('EaRepository rejects relationships with dangling references', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'ent-1', type: 'Enterprise', attributes: {} });
    // Missing target
    const result = repo.addRelationship({
      fromId: 'ent-1',
      toId: 'missing-id',
      type: 'OWNS',
    });
    expect(result.ok).toBe(false);
  });

  test('no element should exist only in workspace without repository entry', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'ent-1', type: 'Enterprise', attributes: { name: 'Ent' } });

    // Workspace references an element NOT in the repository
    const workspace = makeTestWorkspace('test-repo', {
      layout: {
        nodes: [
          { id: 'ent-1', label: 'Ent', elementType: 'Enterprise' as any, x: 100, y: 100 },
          { id: 'ghost', label: 'Ghost', elementType: 'Application' as any, x: 200, y: 200 },
        ],
        edges: [],
      },
    });
    const snapshot = buildSnapshot(repo, {
      studioState: { viewLayouts: {}, designWorkspaces: [workspace] },
    });
    writeRepositorySnapshot(snapshot);

    // On rehydration, the canvas rebuild should filter out 'ghost'
    // because it doesn't exist in the repository.
    const restored = readRepositorySnapshot();
    const restoredRepo = new EaRepository({
      objects: restored!.objects,
      relationships: restored!.relationships,
    });

    // 'ghost' is NOT in the repository
    expect(restoredRepo.objects.has('ghost')).toBe(false);
    // 'ent-1' IS in the repository
    expect(restoredRepo.objects.has('ent-1')).toBe(true);

    // The workspace layout may contain 'ghost', but the canvas rebuild
    // must filter it out. We simulate what the rehydration useEffect does:
    const wsLayout = restored!.studioState?.designWorkspaces?.[0]?.layout;
    const visibleNodes = (wsLayout?.nodes ?? []).filter((n) => restoredRepo.objects.has(n.id));
    expect(visibleNodes).toHaveLength(1);
    expect(visibleNodes[0].id).toBe('ent-1');
  });
});

// ===========================================================================
// WORKSPACE PERSISTENCE TESTS
// ===========================================================================

describe('Design Workspace Persistence', () => {
  test('workspace with layout is persisted in snapshot', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'app-1', type: 'Application', attributes: { name: 'App' } });

    const workspace = makeTestWorkspace('test-repo', {
      layout: {
        nodes: [{ id: 'app-1', label: 'App', elementType: 'Application' as any, x: 50, y: 75 }],
        edges: [],
      },
      stagedElements: [
        {
          id: 'app-1',
          kind: 'element',
          type: 'Application' as any,
          name: 'App',
          createdAt: new Date().toISOString(),
          modelingState: 'COMMITTED' as any,
          status: 'STAGED' as any,
        },
      ],
    });

    const snapshot = buildSnapshot(repo, {
      studioState: { viewLayouts: {}, designWorkspaces: [workspace] },
    });
    writeRepositorySnapshot(snapshot);

    const restored = readRepositorySnapshot();
    const ws = restored!.studioState?.designWorkspaces?.[0];
    expect(ws).toBeTruthy();
    expect(ws!.layout?.nodes).toHaveLength(1);
    expect(ws!.layout!.nodes[0].x).toBe(50);
    expect(ws!.layout!.nodes[0].y).toBe(75);
    expect(ws!.stagedElements).toHaveLength(1);
    expect(ws!.stagedElements[0].name).toBe('App');
  });

  test('DesignWorkspaceStore round-trip preserves layout positions', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'app-1', type: 'Application', attributes: { name: 'App' } });
    writeRepositorySnapshot(buildSnapshot(repo));

    const workspace = makeTestWorkspace('test-repo', {
      id: 'ws-test',
      layout: {
        nodes: [{ id: 'app-1', label: 'App', elementType: 'Application' as any, x: 123, y: 456 }],
        edges: [],
      },
    });

    DesignWorkspaceStore.save('test-repo', workspace);

    const list = DesignWorkspaceStore.list('test-repo');
    expect(list).toHaveLength(1);
    expect(list[0].layout?.nodes?.[0].x).toBe(123);
    expect(list[0].layout?.nodes?.[0].y).toBe(456);
  });
});

// ===========================================================================
// RELOAD / STRESS TESTS
// ===========================================================================

describe('Reload Stress Test', () => {
  test('create 20 elements + 30 relationships → close → reopen → all preserved', () => {
    const repo = new EaRepository();

    // Create 20 elements
    repo.addObject({ id: 'ent-1', type: 'Enterprise', attributes: { name: 'Acme' } });
    const elementTypes: Array<{ type: string; layer: string }> = [
      { type: 'Application', layer: 'Application' },
      { type: 'Technology', layer: 'Technology' },
      { type: 'Capability', layer: 'Business' },
      { type: 'BusinessService', layer: 'Business' },
      { type: 'Database', layer: 'Technology' },
    ];

    for (let i = 2; i <= 20; i++) {
      const et = elementTypes[(i - 2) % elementTypes.length];
      repo.addObject({ id: `el-${i}`, type: et.type, attributes: { name: `Element ${i}` } });
    }

    expect(repo.objects.size).toBe(20);

    // Create relationships (connecting elements where meta-model allows)
    let relCount = 0;
    // Enterprise OWNS Applications
    for (let i = 2; i <= 20; i++) {
      const obj = repo.objects.get(`el-${i}`);
      if (obj?.type === 'Application') {
        const res = repo.addRelationship({ fromId: 'ent-1', toId: `el-${i}`, type: 'OWNS' });
        if (res.ok) relCount++;
      }
    }
    // Applications DEPLOYED_ON Technology
    for (let i = 2; i <= 20; i++) {
      const obj = repo.objects.get(`el-${i}`);
      if (obj?.type === 'Application') {
        for (let j = 2; j <= 20; j++) {
          if (relCount >= 30) break;
          const target = repo.objects.get(`el-${j}`);
          if (target?.type === 'Technology') {
            const res = repo.addRelationship({ fromId: `el-${i}`, toId: `el-${j}`, type: 'DEPLOYED_ON' });
            if (res.ok) relCount++;
          }
        }
      }
      if (relCount >= 30) break;
    }
    // Applications USES Databases
    for (let i = 2; i <= 20; i++) {
      const obj = repo.objects.get(`el-${i}`);
      if (obj?.type === 'Application') {
        for (let j = 2; j <= 20; j++) {
          if (relCount >= 30) break;
          const target = repo.objects.get(`el-${j}`);
          if (target?.type === 'Database') {
            const res = repo.addRelationship({ fromId: `el-${i}`, toId: `el-${j}`, type: 'USES' });
            if (res.ok) relCount++;
          }
        }
      }
      if (relCount >= 30) break;
    }

    // Build workspace layout with positions
    const workspaceNodes = Array.from(repo.objects.values()).map((obj, idx) => ({
      id: obj.id,
      label: (obj.attributes as any)?.name ?? obj.id,
      elementType: obj.type as any,
      x: 100 + (idx % 5) * 200,
      y: 100 + Math.floor(idx / 5) * 150,
    }));
    const workspaceEdges = repo.relationships.map((rel) => ({
      id: rel.id,
      source: rel.fromId,
      target: rel.toId,
      relationshipType: rel.type as any,
    }));

    const workspace = makeTestWorkspace('test-repo', {
      layout: { nodes: workspaceNodes, edges: workspaceEdges },
    });

    const snapshot = buildSnapshot(repo, {
      studioState: { viewLayouts: {}, designWorkspaces: [workspace] },
    });

    // Persist
    writeRepositorySnapshot(snapshot);

    // Simulate app close + reopen
    const restored = readRepositorySnapshot();
    expect(restored).not.toBeNull();

    // Verify ALL elements survived
    expect(restored!.objects).toHaveLength(20);
    for (let i = 1; i <= 20; i++) {
      const id = i === 1 ? 'ent-1' : `el-${i}`;
      expect(restored!.objects.find((o) => o.id === id)).toBeTruthy();
    }

    // Verify ALL relationships survived
    expect(restored!.relationships.length).toBeGreaterThanOrEqual(relCount);

    // Verify ALL positions survived
    const restoredWs = restored!.studioState?.designWorkspaces?.[0];
    expect(restoredWs?.layout?.nodes).toHaveLength(20);

    // Verify positions are exactly what we set
    for (const node of restoredWs!.layout!.nodes) {
      const original = workspaceNodes.find((n) => n.id === node.id);
      expect(original).toBeTruthy();
      expect(node.x).toBe(original!.x);
      expect(node.y).toBe(original!.y);
    }

    // Reconstruct repository — must be identical
    const restoredRepo = new EaRepository({
      objects: restored!.objects,
      relationships: restored!.relationships,
    });
    expect(restoredRepo.objects.size).toBe(20);
    expect(restoredRepo.relationships.length).toBe(repo.relationships.length);
  });
});

// ===========================================================================
// VIEW STORE TESTS
// ===========================================================================

describe('View Persistence', () => {
  test('views are persisted inside the repository snapshot', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'ent-1', type: 'Enterprise', attributes: { name: 'E' } });
    const view = makeTestView('v-1', 'Application Landscape');
    const snapshot = buildSnapshot(repo, { views: [view] });
    writeRepositorySnapshot(snapshot);

    const restored = readRepositorySnapshot();
    expect(restored!.views).toHaveLength(1);
    expect(restored!.views![0].name).toBe('Application Landscape');
    expect(restored!.views![0].id).toBe('v-1');
  });

  test('view layout positions persist independently of view', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'app-1', type: 'Application', attributes: {} });
    writeRepositorySnapshot(buildSnapshot(repo));

    ViewLayoutStore.set('v-1', { 'app-1': { x: 500, y: 600 } });

    // Verify persisted in snapshot studioState
    const snap = readRepositorySnapshot();
    expect(snap!.studioState?.viewLayouts?.['v-1']?.['app-1']).toEqual({ x: 500, y: 600 });
  });
});

// ===========================================================================
// DETERMINISM TESTS
// ===========================================================================

describe('Deterministic Rehydration', () => {
  test('same repo + same workspace layout = same element positions', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'app-1', type: 'Application', attributes: { name: 'App1' } });
    repo.addObject({ id: 'app-2', type: 'Application', attributes: { name: 'App2' } });

    const layout = {
      nodes: [
        { id: 'app-1', label: 'App1', elementType: 'Application' as any, x: 100, y: 200 },
        { id: 'app-2', label: 'App2', elementType: 'Application' as any, x: 300, y: 400 },
      ],
      edges: [],
    };

    const workspace = makeTestWorkspace('test-repo', { layout });
    writeRepositorySnapshot(buildSnapshot(repo, {
      studioState: { viewLayouts: {}, designWorkspaces: [workspace] },
    }));

    // Read twice — must produce identical results
    const snap1 = readRepositorySnapshot();
    const snap2 = readRepositorySnapshot();

    const ws1 = snap1!.studioState!.designWorkspaces![0];
    const ws2 = snap2!.studioState!.designWorkspaces![0];

    expect(ws1.layout!.nodes).toEqual(ws2.layout!.nodes);
    expect(ws1.layout!.edges).toEqual(ws2.layout!.edges);

    // Simulate canvas build — filter by repo
    const restoredRepo = new EaRepository({
      objects: snap1!.objects,
      relationships: snap1!.relationships,
    });
    const nodes1 = ws1.layout!.nodes.filter((n) => restoredRepo.objects.has(n.id));
    const nodes2 = ws2.layout!.nodes.filter((n) => restoredRepo.objects.has(n.id));
    expect(nodes1).toEqual(nodes2);
  });
});
