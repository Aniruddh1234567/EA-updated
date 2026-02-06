import { ArchitectureHealthEngine } from '../ArchitectureHealthEngine';
import { createArchitectureRepository } from '../../repository/ArchitectureRepository';
import { createRelationshipRepository } from '../../repository/RelationshipRepository';

import type { Application } from '../../repository/Application';
import type { Technology } from '../../repository/Technology';
import type { BaseArchitectureRelationship } from '../../repository/BaseArchitectureRelationship';
import type { ValidationFinding } from '../../validation/ValidationFinding';

const baseElementFields = () => {
  const now = new Date('2026-01-11T00:00:00.000Z').toISOString();
  return {
    name: 'Name',
    description: 'Desc',
    layer: 'Application' as const,
    lifecycleStatus: 'Active' as const,
    lifecycleStartDate: now,
    lifecycleEndDate: undefined,
    ownerRole: 'Owner',
    ownerName: 'Owner',
    owningUnit: 'Unit',
    approvalStatus: 'Approved' as const,
    lastReviewedAt: now,
    reviewCycleMonths: 12,
    createdAt: now,
    createdBy: 'test',
    lastModifiedAt: now,
    lastModifiedBy: 'test',
  };
};

const makeApplication = (id: string, overrides?: Partial<Application>): Application => {
  return {
    id,
    elementType: 'Application',
    applicationCode: `APP-${id}`,
    applicationType: 'Custom',
    businessCriticality: 'Medium',
    availabilityTarget: 99.9,
    deploymentModel: 'Cloud',
    vendorLockInRisk: 'Low',
    technicalDebtLevel: 'Low',
    annualRunCost: 1,
    vendorName: 'Vendor',
    ...baseElementFields(),
    ...(overrides ?? {}),
  };
};

const makeTechnology = (id: string, overrides?: Partial<Technology>): Technology => {
  return {
    id,
    elementType: 'Technology',
    technologyType: 'Platform',
    technologyCategory: 'Middleware',
    vendor: 'Vendor',
    version: '1.0',
    supportEndDate: '2030-01-01T00:00:00.000Z',
    obsolescenceRisk: 'Low',
    standardApproved: true,
    ...baseElementFields(),
    layer: 'Technology',
    ...(overrides ?? {}),
  };
};

const makeDeployedOn = (id: string, appId: string, techId: string): BaseArchitectureRelationship => {
  const now = new Date('2026-01-11T00:00:00.000Z').toISOString();
  return {
    id,
    relationshipType: 'DEPLOYED_ON',
    sourceElementId: appId,
    sourceElementType: 'Application',
    targetElementId: techId,
    targetElementType: 'Technology',
    direction: 'OUTGOING',
    status: 'Approved',
    effectiveFrom: now,
    effectiveTo: undefined,
    rationale: 'test',
    confidenceLevel: 'High',
    lastReviewedAt: now,
    reviewedBy: 'test',
    createdAt: now,
    createdBy: 'test',
  };
};

describe('ArchitectureHealthEngine', () => {
  test('aggregates findings and detects orphans deterministically', () => {
    const repo = createArchitectureRepository();

    const app = makeApplication('app-1');
    const tech = makeTechnology('tech-1');

    expect(repo.addElement('applications', app).ok).toBe(true);
    expect(repo.addElement('technologies', tech).ok).toBe(true);

    const relRepo = createRelationshipRepository(repo);

    const findings: ValidationFinding[] = [
      {
        findingId: 'f1',
        ruleId: 'r1',
        affectedElementId: 'app-1',
        affectedElementType: 'Application',
        severity: 'Error',
        message: 'bad',
        detectedAt: '2026-01-11T00:00:00.000Z',
        detectedBy: 'system',
      },
      {
        findingId: 'f2',
        ruleId: 'r2',
        affectedElementId: 'tech-1',
        affectedElementType: 'Technology',
        severity: 'Warning',
        message: 'warn',
        detectedAt: '2026-01-11T00:00:00.000Z',
        detectedBy: 'system',
      },
    ];

    const engine = new ArchitectureHealthEngine();
    const snap = engine.evaluate({
      scopeKey: 'repo',
      elements: repo,
      relationships: relRepo,
      findings,
      now: new Date('2026-01-11T00:00:00.000Z'),
    });

    expect(snap.metrics.totalElements).toBe(2);
    expect(snap.metrics.elementsWithErrors).toBe(1);
    expect(snap.metrics.elementsWithWarnings).toBe(1);
    // No relationships => both elements are orphans
    expect(snap.metrics.orphanedElementsCount).toBe(2);
  });

  test('trend uses in-memory history only (no persistence)', () => {
    const repo = createArchitectureRepository();
    const app = makeApplication('app-1');
    const tech = makeTechnology('tech-1', { supportEndDate: '2020-01-01T00:00:00.000Z' });

    expect(repo.addElement('applications', app).ok).toBe(true);
    expect(repo.addElement('technologies', tech).ok).toBe(true);

    const relRepo = createRelationshipRepository(repo);
    expect(relRepo.addRelationship(makeDeployedOn('rel-1', 'app-1', 'tech-1')).ok).toBe(true);

    const engine = new ArchitectureHealthEngine();

    const first = engine.evaluate({
      scopeKey: 'repo',
      elements: repo,
      relationships: relRepo,
      findings: [],
      now: new Date('2026-01-11T00:00:00.000Z'),
      stableTrendDelta: 2,
    });

    // Second run introduces an error finding (worse score)
    const second = engine.evaluate({
      scopeKey: 'repo',
      elements: repo,
      relationships: relRepo,
      findings: [
        {
          findingId: 'f1',
          ruleId: 'r1',
          affectedElementId: 'app-1',
          affectedElementType: 'Application',
          severity: 'Error',
          message: 'bad',
          detectedAt: '2026-01-11T00:00:00.000Z',
          detectedBy: 'system',
        },
      ],
      now: new Date('2026-01-11T00:00:01.000Z'),
      stableTrendDelta: 2,
    });

    expect(second.previousOverallHealthScore).toBe(first.metrics.overallHealthScore);
    expect(second.metrics.overallHealthScore).toBeLessThan(first.metrics.overallHealthScore);
    expect(second.metrics.healthTrend).toBe('Degrading');

    // History stays in-memory on the engine instance
    expect(engine.getHistory('repo').length).toBe(2);

    const freshEngine = new ArchitectureHealthEngine();
    expect(freshEngine.getHistory('repo').length).toBe(0);
  });
});
