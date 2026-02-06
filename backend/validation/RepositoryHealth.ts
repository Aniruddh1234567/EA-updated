import { validateArchitectureRepository } from '../analysis/RepositoryValidation';
import { validateRelationshipRepository } from '../analysis/RelationshipValidation';
import { createRelationshipRepository, type RelationshipRepository } from '../repository/RelationshipRepository';
import type { ArchitectureRepository } from '../repository/ArchitectureRepository';
import type { BaseArchitectureRelationship } from '../repository/BaseArchitectureRelationship';
import type { BaseArchitectureElement } from '../repository/BaseArchitectureElement';

export type RepositoryHealthFinding = {
  severity: 'Info' | 'Warning' | 'Error';
  message: string;
  subjectId: string;
  subjectType: string;
};

export type RepositoryHealthSummary = {
  observedAt: string;
  total: number;
  elementsAffected: number;
  bySeverity: Record<'Info' | 'Warning' | 'Error', number>;
  findings: RepositoryHealthFinding[];
};

const byId = (relationships: RelationshipRepository): Map<string, BaseArchitectureRelationship[]> => {
  const map = new Map<string, BaseArchitectureRelationship[]>();
  for (const rel of relationships.getAllRelationships()) {
    const out = map.get(rel.sourceElementId) ?? [];
    out.push(rel);
    map.set(rel.sourceElementId, out);

    const incoming = map.get(rel.targetElementId) ?? [];
    incoming.push(rel);
    map.set(rel.targetElementId, incoming);
  }
  return map;
};

const elementLayer = (
  element: BaseArchitectureElement | null,
): 'Business' | 'Application' | 'Technology' | 'Implementation & Migration' | 'Governance' | 'Unknown' => {
  if (!element) return 'Unknown';
  const layer = typeof (element as any).layer === 'string' ? String((element as any).layer).trim() : '';
  if (
    layer === 'Business' ||
    layer === 'Application' ||
    layer === 'Technology' ||
    layer === 'Implementation & Migration' ||
    layer === 'Governance'
  )
    return layer;
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

const collectRequiredRelationshipFindings = (
  elements: ArchitectureRepository,
  relationships: RelationshipRepository,
  observedAt: string,
): RepositoryHealthFinding[] => {
  const relsByElement = byId(relationships);
  const findings: RepositoryHealthFinding[] = [];

  for (const cap of elements.getElementsByType('capabilities')) {
    const rels = relsByElement.get(cap.id) ?? [];
    const supported = rels.some(
      (r) =>
        r.relationshipType === 'SUPPORTED_BY' &&
        r.sourceElementId === cap.id &&
        (r.targetElementType === 'ApplicationService' || r.targetElementType === 'Application'),
    );
    if (!supported) {
      findings.push({
        severity: 'Error',
        message: `Capability "${cap.name}" (${cap.id}) must be supported by at least one ApplicationService.`,
        subjectId: cap.id,
        subjectType: cap.elementType,
      });
    }
  }

  for (const svc of elements.getElementsByType('applicationServices')) {
    const rels = relsByElement.get(svc.id) ?? [];
    const providesOutgoing = rels.filter(
      (r) => r.relationshipType === 'PROVIDED_BY' && r.sourceElementId === svc.id && r.sourceElementType === 'ApplicationService',
    );
    if (providesOutgoing.length !== 1) {
      findings.push({
        severity: 'Error',
        message: `ApplicationService "${svc.name}" (${svc.id}) must belong to exactly one Application (found ${providesOutgoing.length}).`,
        subjectId: svc.id,
        subjectType: svc.elementType,
      });
    }
  }

  for (const app of elements.getElementsByType('applications')) {
    const rels = relsByElement.get(app.id) ?? [];
    const hosted = rels.some(
      (r) => r.relationshipType === 'DEPLOYED_ON' && r.sourceElementId === app.id && r.targetElementType === 'Technology',
    );
    if (!hosted) {
      findings.push({
        severity: 'Error',
        message: `Application "${app.name}" (${app.id}) must be deployed on at least one Technology.`,
        subjectId: app.id,
        subjectType: app.elementType,
      });
    }
  }

  for (const project of elements.getElementsByType('projects')) {
    const rels = relsByElement.get(project.id) ?? [];
    const implementsAny = rels.some(
      (r) => r.relationshipType === 'IMPLEMENTS' && r.sourceElementId === project.id && r.targetElementType === 'Application',
    );
    if (!implementsAny) {
      findings.push({
        severity: 'Error',
        message: `Project "${project.name}" (${project.id}) must implement at least one Application.`,
        subjectId: project.id,
        subjectType: project.elementType,
      });
    }
  }

  return findings;
};

const collectOrphanFindings = (
  elements: ArchitectureRepository,
  relationships: RelationshipRepository,
  observedAt: string,
): RepositoryHealthFinding[] => {
  const relsByElement = byId(relationships);
  const findings: RepositoryHealthFinding[] = [];

  for (const cap of elements.getElementsByType('capabilities')) {
    const rels = relsByElement.get(cap.id) ?? [];
    const owned = rels.some(
      (r) => r.relationshipType === 'OWNS' && r.targetElementId === cap.id && r.sourceElementType === 'Enterprise',
    );
    if (!owned) {
      findings.push({
        severity: 'Error',
        message: `Capability "${cap.name}" (${cap.id}) is orphaned: no owning Enterprise.`,
        subjectId: cap.id,
        subjectType: cap.elementType,
      });
    }
  }

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
      findings.push({
        severity: 'Error',
        message: `Application "${app.name}" (${app.id}) is orphaned: no BusinessService or ApplicationService linkage.`,
        subjectId: app.id,
        subjectType: app.elementType,
      });
    }
  }

  for (const tech of elements.getElementsByType('technologies')) {
    const rels = relsByElement.get(tech.id) ?? [];
    const hasApp = rels.some(
      (r) => r.relationshipType === 'DEPLOYED_ON' && r.targetElementId === tech.id && r.sourceElementType === 'Application',
    );
    if (!hasApp) {
      findings.push({
        severity: 'Error',
        message: `Technology "${tech.name}" (${tech.id}) is orphaned: no deployed Application.`,
        subjectId: tech.id,
        subjectType: tech.elementType,
      });
    }
  }

  return findings;
};

const collectCrossLayerFindings = (
  elements: ArchitectureRepository,
  relationships: RelationshipRepository,
): RepositoryHealthFinding[] => {
  const findings: RepositoryHealthFinding[] = [];

  for (const rel of relationships.getAllRelationships()) {
    const source = elements.getElementById(rel.sourceElementId);
    const target = elements.getElementById(rel.targetElementId);
    const sourceLayer = elementLayer(source);
    const targetLayer = elementLayer(target);

    if (sourceLayer === 'Business' && targetLayer === 'Technology') {
      findings.push({
        severity: 'Error',
        message: `Invalid cross-layer relationship (Business -> Technology): ${source?.name ?? rel.sourceElementId} -> ${target?.name ?? rel.targetElementId}.`,
        subjectId: rel.id,
        subjectType: `Relationship:${rel.relationshipType}`,
      });
    }

    if (sourceLayer === 'Technology' && targetLayer === 'Business') {
      findings.push({
        severity: 'Error',
        message: `Invalid cross-layer relationship (Technology -> Business): ${source?.name ?? rel.sourceElementId} -> ${target?.name ?? rel.targetElementId}.`,
        subjectId: rel.id,
        subjectType: `Relationship:${rel.relationshipType}`,
      });
    }

    if ((source?.elementType ?? '') === 'Project' && targetLayer === 'Technology') {
      findings.push({
        severity: 'Error',
        message: `Invalid cross-layer relationship (Project -> Technology): ${source?.name ?? rel.sourceElementId} -> ${target?.name ?? rel.targetElementId}.`,
        subjectId: rel.id,
        subjectType: `Relationship:${rel.relationshipType}`,
      });
    }
  }

  return findings;
};

export function summarizeRepositoryHealth(input: {
  elements: ArchitectureRepository;
  relationships?: RelationshipRepository | null;
  now?: Date;
}): RepositoryHealthSummary {
  const now = input.now ?? new Date();
  const observedAt = now.toISOString();
  const relationshipRepo = input.relationships ?? createRelationshipRepository(input.elements);

  const repoReport = validateArchitectureRepository(input.elements, now);
  const relReport = validateRelationshipRepository(input.elements, relationshipRepo, now);

  const findings: RepositoryHealthFinding[] = [];

  for (const f of repoReport.findings) {
    findings.push({
      severity: f.severity,
      message: f.message,
      subjectId: f.elementId,
      subjectType: f.elementType,
    });
  }

  for (const f of relReport.findings) {
    const subjectId = f.subjectKind === 'Relationship' ? f.subjectId : f.subjectId;
    const subjectType = f.subjectKind === 'Relationship' ? `Relationship:${f.relationshipType ?? 'Unknown'}` : f.subjectType;
    findings.push({
      severity: f.severity,
      message: f.message,
      subjectId,
      subjectType,
    });
  }

  findings.push(...collectRequiredRelationshipFindings(input.elements, relationshipRepo, observedAt));
  findings.push(...collectOrphanFindings(input.elements, relationshipRepo, observedAt));
  findings.push(...collectCrossLayerFindings(input.elements, relationshipRepo));

  const bySeverity: Record<'Info' | 'Warning' | 'Error', number> = { Info: 0, Warning: 0, Error: 0 };
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  }

  const elementsAffected = new Set<string>();
  for (const f of findings) elementsAffected.add(f.subjectId);

  return {
    observedAt,
    total: findings.length,
    elementsAffected: elementsAffected.size,
    bySeverity,
    findings: findings.sort(
      (a, b) =>
        (b.severity === 'Error' ? 2 : b.severity === 'Warning' ? 1 : 0) - (a.severity === 'Error' ? 2 : a.severity === 'Warning' ? 1 : 0) ||
        a.subjectType.localeCompare(b.subjectType) ||
        a.subjectId.localeCompare(b.subjectId) ||
        a.message.localeCompare(b.message),
    ),
  };
}
