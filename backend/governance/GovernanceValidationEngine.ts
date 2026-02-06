import type { ArchitectureRepository } from '../repository/ArchitectureRepository';
import type { BaseArchitectureElement } from '../repository/BaseArchitectureElement';
import type { RelationshipRepository } from '../repository/RelationshipRepository';
import type { BaseArchitectureRelationship } from '../repository/BaseArchitectureRelationship';

import type { GovernanceRule } from './GovernanceRule';
import type { ValidationFinding } from '../validation/ValidationFinding';

const isBlank = (value: unknown): boolean => typeof value !== 'string' || value.trim().length === 0;

const normalizeId = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const parseDateMs = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

const severityRank = (s: ValidationFinding['severity']): number => (s === 'Error' ? 3 : s === 'Warning' ? 2 : 1);

const sortFindingsDeterministically = (findings: ValidationFinding[]): ValidationFinding[] => {
  return findings.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.affectedElementType.localeCompare(b.affectedElementType) ||
      a.affectedElementId.localeCompare(b.affectedElementId) ||
      a.findingId.localeCompare(b.findingId),
  );
};

const listAllElements = (repo: ArchitectureRepository): BaseArchitectureElement[] => {
  const all = [
    ...repo.getElementsByType('capabilities'),
    ...repo.getElementsByType('businessProcesses'),
    ...repo.getElementsByType('applications'),
    ...repo.getElementsByType('technologies'),
    ...repo.getElementsByType('programmes'),
  ];

  all.sort(
    (a, b) =>
      a.elementType.localeCompare(b.elementType) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );

  return all;
};

const listAllRelationships = (relationships: RelationshipRepository): BaseArchitectureRelationship[] => {
  const all = relationships.getAllRelationships();
  all.sort(
    (a, b) =>
      a.relationshipType.localeCompare(b.relationshipType) ||
      a.sourceElementId.localeCompare(b.sourceElementId) ||
      a.targetElementId.localeCompare(b.targetElementId) ||
      a.id.localeCompare(b.id),
  );
  return all;
};

/**
 * GovernanceValidationEngine (passive).
 *
 * One responsibility: evaluate enabled GovernanceRules against the in-memory repositories
 * and emit auditable ValidationFindings.
 *
 * Notes:
 * - Does NOT execute ruleExpression (ruleExpression is declarative intent)
 * - Does NOT mutate repositories
 * - Does NOT block modeling
 * - Deterministic ordering of results
 */
export class GovernanceValidationEngine {
  evaluate(input: {
    rules: readonly GovernanceRule[];
    elements: ArchitectureRepository;
    relationships: RelationshipRepository;
    now?: Date;
  }): ValidationFinding[] {
    const now = input.now ?? new Date();
    const detectedAt = now.toISOString();

    const rules = [...input.rules]
      .filter((r) => Boolean(r && r.enabled))
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId));

    const elements = listAllElements(input.elements);
    const relationships = listAllRelationships(input.relationships);

    const findings: ValidationFinding[] = [];

    const addFinding = (f: Omit<ValidationFinding, 'detectedAt' | 'detectedBy'>) => {
      findings.push({
        ...f,
        detectedAt,
        detectedBy: 'system',
      });
    };

    const byId = new Map(elements.map((e) => [e.id, e] as const));

    for (const rule of rules) {
      switch (rule.ruleName) {
        default:
          break;
      }

      // NOTE: We key off ruleId so rules are stable even if the name changes.
      switch (rule.ruleId) {
        // Application must have an owner
        case 'b9f0b0a8-0c0a-4b4b-9c7c-7c7243a6b032': {
          for (const e of elements) {
            if (e.elementType !== 'Application') continue;
            if (!isBlank(e.ownerRole) && !isBlank(e.ownerName) && !isBlank(e.owningUnit)) continue;

            addFinding({
              findingId: `${rule.ruleId}:${e.id}`,
              ruleId: rule.ruleId,
              affectedElementId: e.id,
              affectedElementType: e.elementType,
              severity: rule.severity,
              message:
                'Application is missing ownership details (ownerRole, ownerName, and/or owningUnit).',
            });
          }
          break;
        }

        // Application must have lifecycle status
        case '7d1e4b5f-1f22-4b20-8e7f-4f07a1f7e28e': {
          for (const e of elements) {
            if (e.elementType !== 'Application') continue;
            if (!isBlank(e.lifecycleStatus)) continue;

            addFinding({
              findingId: `${rule.ruleId}:${e.id}`,
              ruleId: rule.ruleId,
              affectedElementId: e.id,
              affectedElementType: e.elementType,
              severity: rule.severity,
              message: 'Application is missing lifecycleStatus.',
            });
          }
          break;
        }

        // Capability must have strategic importance
        case 'c4c0a50a-6f7e-4f3b-9c58-1d9c6d2c6a1f': {
          for (const e of elements) {
            if (e.elementType !== 'Capability') continue;
            const strategicImportance = (e as unknown as { strategicImportance?: unknown }).strategicImportance;
            const value = typeof strategicImportance === 'string' ? strategicImportance.trim() : '';
            if (value === 'High' || value === 'Medium' || value === 'Low') continue;

            addFinding({
              findingId: `${rule.ruleId}:${e.id}`,
              ruleId: rule.ruleId,
              affectedElementId: e.id,
              affectedElementType: e.elementType,
              severity: rule.severity,
              message: 'Capability is missing strategicImportance (expected High | Medium | Low).',
            });
          }
          break;
        }

        // Retired elements must not have active dependencies
        case '1d5a1b77-46e1-4f8a-bb2d-3cc4e7dce03b': {
          for (const rel of relationships) {
            if (rel.relationshipType !== 'INTEGRATES_WITH') continue;
            if ((rel.status ?? '').trim() !== 'Approved') continue;

            const source = byId.get(normalizeId(rel.sourceElementId)) ?? null;
            const target = byId.get(normalizeId(rel.targetElementId)) ?? null;
            if (!source || !target) continue;

            const sourceRetired = source.lifecycleStatus === 'Retired';
            const targetRetired = target.lifecycleStatus === 'Retired';
            if (!sourceRetired && !targetRetired) continue;

            addFinding({
              findingId: `${rule.ruleId}:${rel.id}`,
              ruleId: rule.ruleId,
              affectedElementId: rel.id,
              affectedElementType: `Relationship:${rel.relationshipType}`,
              severity: rule.severity,
              message: `Approved dependency involves a Retired element: ${source.elementType} "${source.name}" (${source.id}) -> ${target.elementType} "${target.name}" (${target.id}).`,
            });
          }
          break;
        }

        // Deprecated technology must not host active applications
        case '4b8f7a3e-9b6d-4d2b-97e1-3c4a7d9ef52c': {
          for (const rel of relationships) {
            if (rel.relationshipType !== 'DEPLOYED_ON') continue;
            if ((rel.status ?? '').trim() !== 'Approved') continue;

            const source = byId.get(normalizeId(rel.sourceElementId)) ?? null;
            const target = byId.get(normalizeId(rel.targetElementId)) ?? null;
            if (!source || !target) continue;

            const isActiveApp = source.elementType === 'Application' && source.lifecycleStatus === 'Active';
            const isDeprecatedTech = target.elementType === 'Technology' && target.lifecycleStatus === 'Deprecated';
            if (!isActiveApp || !isDeprecatedTech) continue;

            addFinding({
              findingId: `${rule.ruleId}:${rel.id}`,
              ruleId: rule.ruleId,
              affectedElementId: rel.id,
              affectedElementType: `Relationship:${rel.relationshipType}`,
              severity: rule.severity,
              message: `Active application is deployed on Deprecated technology: Application "${source.name}" (${source.id}) -> Technology "${target.name}" (${target.id}).`,
            });
          }
          break;
        }

        // Applications past lifecycleEndDate must be flagged
        case '3f5d0d2a-54af-4a77-b6c5-9c1d3f22b88a': {
          const nowMs = now.getTime();
          for (const e of elements) {
            if (e.elementType !== 'Application') continue;
            const endMs = parseDateMs(e.lifecycleEndDate);
            if (endMs === null) continue;
            if (endMs >= nowMs) continue;

            addFinding({
              findingId: `${rule.ruleId}:${e.id}`,
              ruleId: rule.ruleId,
              affectedElementId: e.id,
              affectedElementType: e.elementType,
              severity: rule.severity,
              message: `Application lifecycleEndDate is in the past (${e.lifecycleEndDate}).`,
            });
          }
          break;
        }

        // Technologies past supportEndDate must be flagged
        case 'a2d6c8c0-50d1-4e7a-8b8d-2b0ac2a7a8dd': {
          const nowMs = now.getTime();
          for (const e of elements) {
            if (e.elementType !== 'Technology') continue;
            const supportEndDate = (e as unknown as { supportEndDate?: unknown }).supportEndDate;
            const endMs = parseDateMs(supportEndDate);
            if (endMs === null) continue;
            if (endMs >= nowMs) continue;

            addFinding({
              findingId: `${rule.ruleId}:${e.id}`,
              ruleId: rule.ruleId,
              affectedElementId: e.id,
              affectedElementType: e.elementType,
              severity: rule.severity,
              message: `Technology supportEndDate is in the past (${String(supportEndDate)}).`,
            });
          }
          break;
        }

        // Mission-critical applications with only soft dependencies must be flagged
        case 'df2c3a6c-0b18-4d6b-9e5c-6a2d7c2a0f3e': {
          const outgoingDependsOn = relationships.filter((r) => r.relationshipType === 'INTEGRATES_WITH');

          const outgoingByAppId = new Map<string, BaseArchitectureRelationship[]>();
          for (const r of outgoingDependsOn) {
            const from = normalizeId(r.sourceElementId);
            if (!from) continue;
            const list = outgoingByAppId.get(from);
            if (list) list.push(r);
            else outgoingByAppId.set(from, [r]);
          }

          for (const e of elements) {
            if (e.elementType !== 'Application') continue;
            const criticality = (e as unknown as { businessCriticality?: unknown }).businessCriticality;
            if (criticality !== 'Mission-Critical') continue;

            const deps = outgoingByAppId.get(e.id) ?? [];
            if (deps.length === 0) continue; // "only soft dependencies" implies there are dependencies.

            const strengths = deps
              .map((rel) => (rel as unknown as { dependencyStrength?: unknown }).dependencyStrength)
              .map((v) => (typeof v === 'string' ? v.trim() : ''))
              .filter((v) => v.length > 0);

            const hasHard = strengths.some((s) => s === 'Hard');
            if (hasHard) continue;

            addFinding({
              findingId: `${rule.ruleId}:${e.id}`,
              ruleId: rule.ruleId,
              affectedElementId: e.id,
              affectedElementType: e.elementType,
              severity: rule.severity,
              message: 'Mission-critical application has dependencies but none are classified as Hard (only Soft/unspecified).',
            });
          }
          break;
        }

        // High technical debt with high criticality must be flagged
        case '0a5f3c1a-1bb5-4e1e-8b7e-6c9a1b2d3e4f': {
          for (const e of elements) {
            if (e.elementType !== 'Application') continue;

            const technicalDebtLevel = (e as unknown as { technicalDebtLevel?: unknown }).technicalDebtLevel;
            const businessCriticality = (e as unknown as { businessCriticality?: unknown }).businessCriticality;

            const highDebt = technicalDebtLevel === 'High';
            const highCriticality = businessCriticality === 'Mission-Critical' || businessCriticality === 'High';

            if (!highDebt || !highCriticality) continue;

            addFinding({
              findingId: `${rule.ruleId}:${e.id}`,
              ruleId: rule.ruleId,
              affectedElementId: e.id,
              affectedElementType: e.elementType,
              severity: rule.severity,
              message: `Application has High technical debt and high criticality (${String(businessCriticality)}).`,
            });
          }
          break;
        }

        default:
          // Unknown ruleId => no evaluation (intent still exists, engine remains non-executing).
          break;
      }
    }

    return sortFindingsDeterministically(findings);
  }
}

export const governanceValidationEngine = new GovernanceValidationEngine();
