import crypto from 'crypto';

import { createArchitectureRepository } from '../repository/ArchitectureRepository';
import { createRelationshipRepository } from '../repository/RelationshipRepository';
import type { BaseArchitectureRelationship } from '../repository/BaseArchitectureRelationship';

import type { Capability } from '../repository/Capability';
import type { BusinessProcess } from '../repository/BusinessProcess';
import type { Application } from '../repository/Application';
import type { Technology } from '../repository/Technology';
import type { Programme } from '../repository/Programme';

import type { RepositoryCollectionType } from '../repository/ArchitectureRepository';

import { SeededRandom } from './SeededRandom';
import type { SyntheticDataset } from './SyntheticDataset';

const nowIso = () => new Date().toISOString();

const uuid = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const basis = `${Date.now()}|${Math.random()}|${process.pid}`;
  return crypto.createHash('sha1').update(basis).digest('hex');
};

const pick = <T>(arr: readonly T[], index: number): T => arr[Math.max(0, Math.min(arr.length - 1, index))];

type ElementKind = 'Programme' | 'Capability' | 'BusinessProcess' | 'Application' | 'Technology';

type GeneratorOptions = {
  seed: number;

  programmes: number;
  capabilities: number;
  capabilityHierarchyDepth: number;
  capabilityBranching: number;

  businessProcesses: number;
  applications: number;
  technologies: number;

  // Dependency-heavy application graph
  dependencyFanout: number;
  appChainDepth: number;

  // Mix in strategy/traceability edges
  programmeImpactsPerProgramme: number;
};

const defaults: GeneratorOptions = {
  seed: 1337,

  programmes: 5,
  capabilities: 200,
  capabilityHierarchyDepth: 4,
  capabilityBranching: 3,

  businessProcesses: 600,
  applications: 800,
  technologies: 80,

  dependencyFanout: 8,
  appChainDepth: 50,

  programmeImpactsPerProgramme: 60,
};

const baseElement = (
  id: string,
  name: string,
  layer: 'Business' | 'Application' | 'Technology' | 'Implementation & Migration' | 'Governance',
) => {
  const ts = nowIso();
  return {
    id,
    name,
    description: `${name} (synthetic)`,
    elementType: 'Unknown',
    layer,
    lifecycleStatus: 'Active' as const,
    lifecycleStartDate: ts,
    ownerRole: 'Owner',
    ownerName: 'Synthetic',
    owningUnit: 'Synthetic',
    approvalStatus: 'Approved' as const,
    lastReviewedAt: ts,
    reviewCycleMonths: 12,
    createdAt: ts,
    createdBy: 'loadtest',
    lastModifiedAt: ts,
    lastModifiedBy: 'loadtest',
  };
};

const add = <T>(repo: any, collection: RepositoryCollectionType, element: T) => {
  const result = repo.addElement(collection as any, element as any);
  if (!result.ok) throw new Error(result.error);
};

const relationshipBase = (args: {
  id: string;
  relationshipType: string;
  sourceElementId: string;
  sourceElementType: string;
  targetElementId: string;
  targetElementType: string;
}): BaseArchitectureRelationship => {
  const ts = nowIso();
  return {
    id: args.id,
    relationshipType: args.relationshipType,
    sourceElementId: args.sourceElementId,
    sourceElementType: args.sourceElementType,
    targetElementId: args.targetElementId,
    targetElementType: args.targetElementType,
    direction: 'OUTGOING',
    status: 'Approved',
    effectiveFrom: ts,
    rationale: 'synthetic',
    confidenceLevel: 'High',
    lastReviewedAt: ts,
    reviewedBy: 'loadtest',
    createdAt: ts,
    createdBy: 'loadtest',
  };
};

export const generateSyntheticDataset = (overrides?: Partial<GeneratorOptions>): SyntheticDataset => {
  const opts: GeneratorOptions = { ...defaults, ...(overrides ?? {}) };
  const rng = new SeededRandom(opts.seed);

  const repo = createArchitectureRepository();

  const programmeIds: string[] = [];
  const capabilityIds: string[] = [];
  const processIds: string[] = [];
  const appIds: string[] = [];
  const techIds: string[] = [];

  const byType: Record<string, number> = {};
  const inc = (k: ElementKind) => {
    byType[k] = (byType[k] ?? 0) + 1;
  };

  // Programmes
  for (let i = 0; i < opts.programmes; i += 1) {
    const id = `prog-${i + 1}-${uuid()}`;
    const p: Programme = {
      ...baseElement(id, `Programme ${i + 1}`, 'Implementation & Migration'),
      elementType: 'Programme',
      programmeType: pick(['Transformation', 'Compliance', 'Modernization'] as const, rng.nextInt(3)),
      strategicObjective: 'Synthetic objective',
      startDate: nowIso(),
      endDate: nowIso(),
      budgetEstimate: 1_000_000 + rng.nextInt(5_000_000),
      fundingStatus: pick(['Approved', 'Proposed', 'Rejected'] as const, rng.nextInt(3)),
      expectedBusinessImpact: 'Synthetic impact',
      riskLevel: pick(['High', 'Medium', 'Low'] as const, rng.nextInt(3)),
    };
    add(repo, 'programmes', p);
    programmeIds.push(id);
    inc('Programme');
  }

  // Capabilities with a parent hierarchy (deep-ish, but no self-relationships required)
  // We produce a deterministic parent assignment respecting the requested depth/branching.
  const requestedCaps = Math.max(0, Math.trunc(opts.capabilities));
  const maxCaps = opts.businessProcesses > 0 ? Math.max(1, requestedCaps) : requestedCaps;
  const capLevels = Math.max(1, Math.trunc(opts.capabilityHierarchyDepth));

  const capsByDepth: string[][] = Array.from({ length: capLevels }, () => []);
  if (maxCaps > 0) {
    // Root capability
    const rootId = `cap-1-${uuid()}`;
    const root: Capability = {
      ...baseElement(rootId, `Capability 1`, 'Business'),
      elementType: 'Capability',
      capabilityLevel: 'L1',
      parentCapabilityId: null,
      businessOutcome: 'Synthetic outcome',
      valueStream: 'Synthetic',
      inScope: true,
      impactedByChange: true,
      strategicImportance: pick(['High', 'Medium', 'Low'] as const, rng.nextInt(3)),
      maturityLevel: pick([1, 2, 3, 4, 5] as const, rng.nextInt(5)),
    };
    add(repo, 'capabilities', root);
    capabilityIds.push(rootId);
    capsByDepth[0].push(rootId);
    inc('Capability');

    for (let i = 2; i <= maxCaps; i += 1) {
      const depth = Math.min(capLevels - 1, Math.floor(Math.log(i) / Math.log(Math.max(2, opts.capabilityBranching))));
      const parentPool = capsByDepth[Math.max(0, depth - 1)] ?? capsByDepth[0];
      const parentId = parentPool.length ? rng.pick(parentPool) : rootId;

      const id = `cap-${i}-${uuid()}`;
      const cap: Capability = {
        ...baseElement(id, `Capability ${i}`, 'Business'),
        elementType: 'Capability',
        capabilityLevel: depth === 0 ? 'L1' : depth === 1 ? 'L2' : 'L3',
        parentCapabilityId: parentId,
        businessOutcome: 'Synthetic outcome',
        valueStream: 'Synthetic',
        inScope: true,
        impactedByChange: rng.nextFloat() < 0.7,
        strategicImportance: pick(['High', 'Medium', 'Low'] as const, rng.nextInt(3)),
        maturityLevel: pick([1, 2, 3, 4, 5] as const, rng.nextInt(5)),
      };
      add(repo, 'capabilities', cap);
      capabilityIds.push(id);
      capsByDepth[depth].push(id);
      inc('Capability');
    }
  }

  // Technologies
  for (let i = 0; i < opts.technologies; i += 1) {
    const id = `tech-${i + 1}-${uuid()}`;
    const t: Technology = {
      ...baseElement(id, `Technology ${i + 1}`, 'Technology'),
      elementType: 'Technology',
      technologyType: pick(['Infrastructure', 'Platform', 'Service'] as const, rng.nextInt(3)),
      technologyCategory: pick(['Compute', 'Storage', 'Network', 'Middleware'] as const, rng.nextInt(4)),
      vendor: 'Synthetic',
      version: `v${1 + rng.nextInt(10)}.${rng.nextInt(10)}`,
      supportEndDate: nowIso(),
      obsolescenceRisk: pick(['High', 'Medium', 'Low'] as const, rng.nextInt(3)),
      standardApproved: rng.nextFloat() < 0.8,
    };
    add(repo, 'technologies', t);
    techIds.push(id);
    inc('Technology');
  }

  // Applications
  for (let i = 0; i < opts.applications; i += 1) {
    const id = `app-${i + 1}-${uuid()}`;
    const a: Application = {
      ...baseElement(id, `Application ${i + 1}`, 'Application'),
      elementType: 'Application',
      applicationCode: `APP-${String(i + 1).padStart(6, '0')}`,
      applicationType: pick(['COTS', 'Custom', 'SaaS', 'Legacy'] as const, rng.nextInt(4)),
      businessCriticality: pick(['Mission-Critical', 'High', 'Medium', 'Low'] as const, rng.nextInt(4)),
      availabilityTarget: 99 + rng.nextFloat(),
      deploymentModel: pick(['On-Prem', 'Cloud', 'Hybrid'] as const, rng.nextInt(3)),
      vendorLockInRisk: pick(['High', 'Medium', 'Low'] as const, rng.nextInt(3)),
      technicalDebtLevel: pick(['High', 'Medium', 'Low'] as const, rng.nextInt(3)),
      annualRunCost: 50_000 + rng.nextInt(500_000),
      vendorName: 'Synthetic',
    };
    add(repo, 'applications', a);
    appIds.push(id);
    inc('Application');
  }

  // Business processes (each assigned a parent capability id)
  for (let i = 0; i < opts.businessProcesses; i += 1) {
    const id = `proc-${i + 1}-${uuid()}`;
    const parentCapabilityId = rng.pick(capabilityIds);

    const bp: BusinessProcess = {
      ...baseElement(id, `Business Process ${i + 1}`, 'Business'),
      elementType: 'BusinessProcess',
      processOwner: 'Synthetic',
      triggeringEvent: 'Synthetic trigger',
      expectedOutcome: 'Synthetic outcome',
      frequency: pick(['Ad-hoc', 'Daily', 'Weekly', 'Monthly'] as const, rng.nextInt(4)),
      criticality: pick(['High', 'Medium', 'Low'] as const, rng.nextInt(3)),
      regulatoryRelevant: rng.nextFloat() < 0.2,
      complianceNotes: 'Synthetic',
      parentCapabilityId,
    };

    add(repo, 'businessProcesses', bp);
    processIds.push(id);
    inc('BusinessProcess');
  }

  const relRepo = createRelationshipRepository(repo);
  const relationshipsByType: Record<string, number> = {};
  const incRel = (t: string) => {
    relationshipsByType[t] = (relationshipsByType[t] ?? 0) + 1;
  };

  const addRel = (r: BaseArchitectureRelationship) => {
    const result = relRepo.addRelationship(r);
    if (!result.ok) throw new Error(result.error);
    incRel(r.relationshipType);
  };

  // DECOMPOSES_TO: Capability -> BusinessProcess (derive from process.parentCapabilityId)
  for (const procId of processIds) {
    const proc = repo.getElementById(procId) as BusinessProcess | null;
    if (!proc) continue;
    addRel(
      relationshipBase({
        id: `rel-dec-${uuid()}`,
        relationshipType: 'DECOMPOSES_TO',
        sourceElementId: proc.parentCapabilityId,
        sourceElementType: 'Capability',
        targetElementId: proc.id,
        targetElementType: 'BusinessProcess',
      }),
    );
  }

  // SERVED_BY: BusinessProcess -> Application
  for (const procId of processIds) {
    if (!appIds.length) break;
    const targetAppId = rng.pick(appIds);
    addRel(
      relationshipBase({
        id: `rel-real-${uuid()}`,
        relationshipType: 'SERVED_BY',
        sourceElementId: procId,
        sourceElementType: 'BusinessProcess',
        targetElementId: targetAppId,
        targetElementType: 'Application',
      }),
    );
  }

  // DEPLOYED_ON: Application -> Technology
  for (const appId of appIds) {
    if (!techIds.length) break;
    const techId = rng.pick(techIds);
    addRel(
      relationshipBase({
        id: `rel-host-${uuid()}`,
        relationshipType: 'DEPLOYED_ON',
        sourceElementId: appId,
        sourceElementType: 'Application',
        targetElementId: techId,
        targetElementType: 'Technology',
      }),
    );
  }

  // IMPACTS: Programme -> Capability/Application/Technology
  const impactTargets = [...capabilityIds, ...appIds, ...techIds];
  for (const progId of programmeIds) {
    const per = Math.max(0, Math.trunc(opts.programmeImpactsPerProgramme));
    const used = new Set<string>();
    for (let k = 0; k < per && impactTargets.length; k += 1) {
      const targetId = rng.pick(impactTargets);
      if (used.has(targetId)) continue;
      used.add(targetId);

      const target = repo.getElementById(targetId);
      if (!target) continue;

      addRel(
        relationshipBase({
          id: `rel-imp-${uuid()}`,
          relationshipType: 'IMPACTS',
          sourceElementId: progId,
          sourceElementType: 'Programme',
          targetElementId: targetId,
          targetElementType: target.elementType,
        }),
      );
    }
  }

  // INTEGRATES_WITH: Application -> Application
  // 1) Deep chain
  const chainDepth = Math.min(appIds.length - 1, Math.max(0, Math.trunc(opts.appChainDepth)));
  for (let i = 0; i < chainDepth; i += 1) {
    const from = appIds[i];
    const to = appIds[i + 1];
    addRel(
      relationshipBase({
        id: `rel-dep-chain-${i}-${uuid()}`,
        relationshipType: 'INTEGRATES_WITH',
        sourceElementId: from,
        sourceElementType: 'Application',
        targetElementId: to,
        targetElementType: 'Application',
      }),
    );
  }

  // 2) Dependency-heavy fanout
  const fanout = Math.max(0, Math.trunc(opts.dependencyFanout));
  for (let i = 0; i < appIds.length; i += 1) {
    const from = appIds[i];
    const used = new Set<string>();

    for (let k = 0; k < fanout; k += 1) {
      if (appIds.length <= 1) break;
      const to = rng.pick(appIds);
      if (to === from) continue;
      if (used.has(to)) continue;
      used.add(to);

      addRel(
        relationshipBase({
          id: `rel-dep-${i}-${k}-${uuid()}`,
          relationshipType: 'INTEGRATES_WITH',
          sourceElementId: from,
          sourceElementType: 'Application',
          targetElementId: to,
          targetElementType: 'Application',
        }),
      );
    }
  }

  const elements = programmeIds.length + capabilityIds.length + processIds.length + appIds.length + techIds.length;
  const relationships = relRepo.getAllRelationships().length;

  return {
    repo,
    relRepo,
    ids: {
      programmes: programmeIds,
      capabilities: capabilityIds,
      businessProcesses: processIds,
      applications: appIds,
      technologies: techIds,
    },
    stats: {
      elements,
      relationships,
      byType,
      relationshipsByType,
    },
  };
};
