import { validateArchitectureRepository } from '../analysis/RepositoryValidation';
import { validateRelationshipRepository } from '../analysis/RelationshipValidation';
import { createRelationshipRepository, type RelationshipRepository } from '../repository/RelationshipRepository';
import type { ArchitectureRepository } from '../repository/ArchitectureRepository';
import type { BaseArchitectureRelationship } from '../repository/BaseArchitectureRelationship';
import type { BaseArchitectureElement } from '../repository/BaseArchitectureElement';

export type ValidationTrigger = 'Save' | 'RelationshipCreation';

export type ValidationGateResult =
  | { ok: true; trigger: ValidationTrigger; observedAt: string; warnings?: string[]; message?: string }
  | { ok: false; trigger: ValidationTrigger; observedAt: string; message: string; violations: string[] };

const hasErrors = <T extends { severity: string }>(findings: readonly T[]): boolean =>
  findings.some((f) => f.severity === 'Error');

const formatCount = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

type Layer = 'Business' | 'Application' | 'Technology' | 'Implementation & Migration' | 'Governance' | 'Unknown';

const elementLayer = (element: BaseArchitectureElement | null): Layer => {
  if (!element) return 'Unknown';
  if (typeof (element as any).layer === 'string') {
    const layer = String((element as any).layer).trim();
    if (
      layer === 'Business' ||
      layer === 'Application' ||
      layer === 'Technology' ||
      layer === 'Implementation & Migration' ||
      layer === 'Governance'
    )
      return layer;
  }

  // Fallback by elementType.
  switch (element.elementType) {
    case 'Programme':
    case 'Project':
      return 'Implementation & Migration';
    case 'Principle':
    case 'Requirement':
    case 'Standard':
      return 'Governance';
    case 'Enterprise':
    case 'Department':
    case 'Capability':
    case 'SubCapability':
    case 'CapabilityCategory':
    case 'BusinessService':
    case 'BusinessProcess':
    case 'ValueStream':
      return 'Business';
    case 'Application':
    case 'ApplicationService':
      return 'Application';
    case 'Technology':
      return 'Technology';
    default:
      return 'Unknown';
  }
};

const byId = (relationships: RelationshipRepository): Map<string, BaseArchitectureRelationship[]> => {
  const map = new Map<string, BaseArchitectureRelationship[]>();
  for (const rel of relationships.getAllRelationships()) {
    const list = map.get(rel.sourceElementId) ?? [];
    list.push(rel);
    map.set(rel.sourceElementId, list);

    const incoming = map.get(rel.targetElementId) ?? [];
    incoming.push(rel);
    map.set(rel.targetElementId, incoming);
  }
  return map;
};

const collectRequiredRelationshipViolations = (
  elements: ArchitectureRepository,
  relationships: RelationshipRepository,
): string[] => {
  const relsByElement = byId(relationships);
  const violations: string[] = [];

  // Capability must be supported by ≥1 ApplicationService (or Application, where ApplicationService links are proxied).
  for (const cap of elements.getElementsByType('capabilities')) {
    const rels = relsByElement.get(cap.id) ?? [];
    const supported = rels.some(
      (r) =>
        r.relationshipType === 'SUPPORTED_BY' &&
        r.sourceElementId === cap.id &&
        (r.targetElementType === 'ApplicationService' || r.targetElementType === 'Application'),
    );

    if (!supported) {
      violations.push(`Capability "${cap.name}" (${cap.id}) must be supported by at least one ApplicationService.`);
    }
  }

  // ApplicationService must belong to exactly 1 Application (PROVIDED_BY ApplicationService -> Application).
  for (const svc of elements.getElementsByType('applicationServices')) {
    const rels = relsByElement.get(svc.id) ?? [];
    const providesOutgoing = rels.filter(
      (r) => r.relationshipType === 'PROVIDED_BY' && r.sourceElementId === svc.id && r.sourceElementType === 'ApplicationService',
    );

    if (providesOutgoing.length !== 1) {
      violations.push(
        `ApplicationService "${svc.name}" (${svc.id}) must belong to exactly one Application (found ${providesOutgoing.length}).`,
      );
    }
  }

  // Application must be deployed on ≥1 Technology (DEPLOYED_ON Application -> Technology).
  for (const app of elements.getElementsByType('applications')) {
    const rels = relsByElement.get(app.id) ?? [];
    const hosted = rels.some(
      (r) => r.relationshipType === 'DEPLOYED_ON' && r.sourceElementId === app.id && r.targetElementType === 'Technology',
    );

    if (!hosted) {
      violations.push(`Application "${app.name}" (${app.id}) must be deployed on at least one Technology.`);
    }
  }

  // Project must implement ≥1 Application (IMPLEMENTS Project -> Application).
  for (const project of elements.getElementsByType('projects')) {
    const rels = relsByElement.get(project.id) ?? [];
    const implementsAny = rels.some(
      (r) => r.relationshipType === 'IMPLEMENTS' && r.sourceElementId === project.id && r.targetElementType === 'Application',
    );

    if (!implementsAny) {
      violations.push(`Project "${project.name}" (${project.id}) must implement at least one Application.`);
    }
  }

  return violations;
};

const collectCrossLayerViolations = (
  elements: ArchitectureRepository,
  relationships: RelationshipRepository,
): string[] => {
  const violations: string[] = [];

  for (const rel of relationships.getAllRelationships()) {
    const source = elements.getElementById(rel.sourceElementId);
    const target = elements.getElementById(rel.targetElementId);

    const sourceLayer = elementLayer(source);
    const targetLayer = elementLayer(target);

    // Block Business -> Technology
    if (sourceLayer === 'Business' && targetLayer === 'Technology') {
      violations.push(
        `Invalid cross-layer relationship: ${source?.elementType ?? 'Unknown'} "${source?.name ?? rel.sourceElementId}" -> ${target?.elementType ?? 'Unknown'} "${target?.name ?? rel.targetElementId}" (Business to Technology not allowed).`,
      );
    }

    // Block Technology -> Business
    if (sourceLayer === 'Technology' && targetLayer === 'Business') {
      violations.push(
        `Invalid cross-layer relationship: ${source?.elementType ?? 'Unknown'} "${source?.name ?? rel.sourceElementId}" -> ${target?.elementType ?? 'Unknown'} "${target?.name ?? rel.targetElementId}" (Technology to Business not allowed).`,
      );
    }

    // Block Project -> Technology
    if ((source?.elementType ?? '') === 'Project' && targetLayer === 'Technology') {
      violations.push(
        `Invalid cross-layer relationship: Project "${source?.name ?? rel.sourceElementId}" cannot target Technology "${target?.name ?? rel.targetElementId}".`,
      );
    }
  }

  return violations;
};

const collectOrphanViolations = (
  elements: ArchitectureRepository,
  relationships: RelationshipRepository,
): string[] => {
  const relsByElement = byId(relationships);
  const violations: string[] = [];

  // Capability with no owner Enterprise (OWNS Enterprise -> Capability).
  for (const cap of elements.getElementsByType('capabilities')) {
    const rels = relsByElement.get(cap.id) ?? [];
    const owned = rels.some(
      (r) =>
        r.relationshipType === 'OWNS' && r.targetElementId === cap.id && r.sourceElementType === 'Enterprise',
    );
    if (!owned) {
      violations.push(`Capability "${cap.name}" (${cap.id}) is orphaned: no owning Enterprise.`);
    }
  }

  // Application with no BusinessService or ApplicationService linkage.
  for (const app of elements.getElementsByType('applications')) {
    const rels = relsByElement.get(app.id) ?? [];
    const linkedToBusinessService = rels.some(
      (r) =>
        (r.sourceElementId === app.id || r.targetElementId === app.id) &&
        (r.sourceElementType === 'BusinessService' || r.targetElementType === 'BusinessService'),
    );

    const linkedToApplicationService = rels.some(
      (r) =>
        (r.sourceElementId === app.id || r.targetElementId === app.id) &&
        (r.sourceElementType === 'ApplicationService' || r.targetElementType === 'ApplicationService'),
    );

    if (!linkedToBusinessService && !linkedToApplicationService) {
      violations.push(
        `Application "${app.name}" (${app.id}) is orphaned: no BusinessService or ApplicationService linkage.`,
      );
    }
  }

  // Technology with no Applications (DEPLOYED_ON Application -> Technology).
  for (const tech of elements.getElementsByType('technologies')) {
    const rels = relsByElement.get(tech.id) ?? [];
    const hasApp = rels.some(
      (r) => r.relationshipType === 'DEPLOYED_ON' && r.targetElementId === tech.id && r.sourceElementType === 'Application',
    );

    if (!hasApp) {
      violations.push(`Technology "${tech.name}" (${tech.id}) is orphaned: no deployed Application.`);
    }
  }

  return violations;
};

export class StrictValidationEngine {
  /**
   * Repository-level validation that runs on save. No diagrams, no impact analysis – only repository state.
   */
  validateOnSave(input: {
    elements: ArchitectureRepository;
    relationships?: RelationshipRepository | null;
    now?: Date;
    mode?: 'Strict' | 'Advisory';
  }): ValidationGateResult {
    const now = input.now ?? new Date();
    const mode = input.mode ?? 'Strict';
    const repoReport = validateArchitectureRepository(input.elements, now);
    const relationshipRepo = input.relationships ?? createRelationshipRepository(input.elements);
    const relationshipReport = validateRelationshipRepository(input.elements, relationshipRepo, now);

    const requiredRelationshipViolations = collectRequiredRelationshipViolations(input.elements, relationshipRepo);
    const orphanViolations = collectOrphanViolations(input.elements, relationshipRepo);
    const crossLayerViolations = collectCrossLayerViolations(input.elements, relationshipRepo);

    const violations: string[] = [];
    for (const f of repoReport.findings) {
      if (f.severity !== 'Error') continue;
      violations.push(`[Repository:${f.checkId}] ${f.message}`);
    }

    for (const f of relationshipReport.findings) {
      if (f.severity !== 'Error') continue;
      violations.push(`[Relationship:${f.checkId}] ${f.message}`);
    }

    violations.push(...requiredRelationshipViolations.map((m) => `[RequiredRelationship] ${m}`));
    violations.push(...orphanViolations.map((m) => `[Orphan] ${m}`));
    violations.push(...crossLayerViolations.map((m) => `[CrossLayer] ${m}`));

    if (violations.length > 0) {
      if (mode === 'Advisory') {
        return {
          ok: true,
          trigger: 'Save',
          observedAt: repoReport.observedAt,
          warnings: violations,
          message: `Saved with ${violations.length} advisory validation warning(s).`,
        };
      }
      return {
        ok: false,
        trigger: 'Save',
        observedAt: repoReport.observedAt,
        message: `Validation failed on save (${formatCount(violations.length, 'error')}).`,
        violations,
      };
    }

    return { ok: true, trigger: 'Save', observedAt: repoReport.observedAt };
  }

  /**
   * Relationship creation gate: stage the candidate and run repository-level validation without touching diagrams or impact analysis.
   */
  validateRelationshipCreation(input: {
    elements: ArchitectureRepository;
    relationships: RelationshipRepository;
    candidate: BaseArchitectureRelationship;
    now?: Date;
    mode?: 'Strict' | 'Advisory';
  }): ValidationGateResult {
    const mode = input.mode ?? 'Strict';
    const warnings: string[] = [];

    const source = input.elements.getElementById(input.candidate.sourceElementId);
    const target = input.elements.getElementById(input.candidate.targetElementId);

    const sourceLayer = elementLayer(source);
    const targetLayer = elementLayer(target);

    // Explicit cross-layer guardrails on creation.
    if (sourceLayer === 'Business' && targetLayer === 'Technology') {
      const observedAt = (input.now ?? new Date()).toISOString();
      const message = 'Relationship blocked: Business layer elements cannot target Technology layer elements directly.';
      if (mode === 'Advisory') warnings.push(message);
      else return { ok: false, trigger: 'RelationshipCreation', observedAt, message, violations: [message] };
    }

    if (sourceLayer === 'Technology' && targetLayer === 'Business') {
      const observedAt = (input.now ?? new Date()).toISOString();
      const message = 'Relationship blocked: Technology layer elements cannot target Business layer elements.';
      if (mode === 'Advisory') warnings.push(message);
      else return { ok: false, trigger: 'RelationshipCreation', observedAt, message, violations: [message] };
    }

    if ((source?.elementType ?? '') === 'Project' && targetLayer === 'Technology') {
      const observedAt = (input.now ?? new Date()).toISOString();
      const message = 'Relationship blocked: Project cannot target Technology elements.';
      if (mode === 'Advisory') warnings.push(message);
      else return { ok: false, trigger: 'RelationshipCreation', observedAt, message, violations: [message] };
    }

    const staged = createRelationshipRepository(input.elements);
    for (const rel of input.relationships.getAllRelationships()) {
      const res = staged.addRelationship(rel);
      if (!res.ok) {
        const observedAt = (input.now ?? new Date()).toISOString();
        return {
          ok: false,
          trigger: 'RelationshipCreation',
          observedAt,
          message: res.error,
          violations: [res.error],
        };
      }
    }

    const candidateRes = staged.addRelationship(input.candidate);
    if (!candidateRes.ok) {
      const observedAt = (input.now ?? new Date()).toISOString();
      return {
        ok: false,
        trigger: 'RelationshipCreation',
        observedAt,
        message: candidateRes.error,
        violations: [candidateRes.error],
      };
    }

    const now = input.now ?? new Date();
    const report = validateRelationshipRepository(input.elements, staged, now);

    const blocking = report.findings.filter((f) => f.severity === 'Error');
    if (hasErrors(blocking)) {
      if (mode === 'Advisory') {
        warnings.push(
          ...blocking.map((f) => `[${f.checkId}] ${f.message}`),
        );
      } else {
      return {
        ok: false,
        trigger: 'RelationshipCreation',
        observedAt: report.observedAt,
        message: `Validation failed on relationship creation (${formatCount(blocking.length, 'error')}).`,
        violations: blocking.map((f) => `[${f.checkId}] ${f.message}`),
      };
      }
    }

    return { ok: true, trigger: 'RelationshipCreation', observedAt: report.observedAt, warnings: warnings.length ? warnings : undefined };
  }
}

export const strictValidationEngine = new StrictValidationEngine();
