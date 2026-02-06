import type { Project } from '../project/project';
import { projectStore } from '../project/ProjectStore';
import { getAdrRepository } from '../adr/AdrRepositoryStore';
import type { ArchitectureDecisionRecord } from '../adr/ArchitectureDecisionRecord';

import type { ArchitectureRepository } from '../repository/ArchitectureRepository';
import type { BaseArchitectureElement } from '../repository/BaseArchitectureElement';
import type { RelationshipRepository } from '../repository/RelationshipRepository';
import type { BaseArchitectureRelationship } from '../repository/BaseArchitectureRelationship';
import { getRepository } from '../repository/RepositoryStore';
import { getRelationshipRepository } from '../repository/RelationshipRepositoryStore';

import type { ExportScope } from './ExportScope';
import type { CsvColumnName, CsvFieldSpec, CsvFieldType, CsvImportSourceEntity, CsvSchemaSpec } from './csv/CsvImportSpecification';
import { CSV_IMPORT_SPECS } from './csv/CsvImportSpecification';

export type ReadinessIssueSeverity = 'Blocking' | 'Warning';

export type ReadinessIssueCategory = 'MandatoryFields' | 'UnsupportedRelationships' | 'GovernanceCompleteness';

export type ReadinessIssue = {
  severity: ReadinessIssueSeverity;
  category: ReadinessIssueCategory;

  /** Stable code for filtering/grouping. */
  code: string;

  /** Human-readable summary. */
  message: string;

  /** Optional linkage to a specific entity. */
  entityKind?: 'Element' | 'Relationship' | 'ADR' | 'Scope';
  entityType?: string;
  entityId?: string;
  field?: string;
};

export type InteroperabilityReadinessResult = {
  evaluatedAt: string;

  /** 0..100; deterministic from issue counts and severities. */
  readinessScore: number;

  blockingIssues: ReadinessIssue[];
  advisoryWarnings: ReadinessIssue[];

  summary: {
    evaluatedElementsCount: number;
    evaluatedRelationshipsCount: number;
    evaluatedAdrsCount: number;

    blockingCount: number;
    warningCount: number;
  };
};

export type InteroperabilityReadinessCheckInput = {
  /** Optional export scope to evaluate. If omitted, evaluates the full repository. */
  scope?: ExportScope;

  /** Whether to include ADR governance checks (default true). */
  includeGovernanceChecks?: boolean;

  /** Reference timestamp; defaults to now. */
  nowIso?: string;
};

export type InteroperabilityReadinessCheckOptions = {
  /** If omitted, uses ProjectStore. */
  project?: Project;

  /** If omitted, uses singleton stores. */
  repository?: ArchitectureRepository;
  relationshipRepository?: RelationshipRepository;
};

const normalize = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

const safeNowIso = () => new Date().toISOString();

const coerceList = (values: readonly string[] | undefined): string[] => {
  const src = Array.isArray(values) ? values : [];
  const out: string[] = [];
  for (const v of src) {
    const t = normalize(v);
    if (t) out.push(t);
  }
  return Array.from(new Set(out)).sort((a, b) => a.localeCompare(b));
};

const isBlankCell = (value: unknown): boolean => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
};

const toEntity = (elementType: string): Exclude<CsvImportSourceEntity, 'Relationships'> | null => {
  switch ((elementType ?? '').trim()) {
    case 'Capability':
      return 'Capabilities';
    case 'BusinessProcess':
      return 'BusinessProcesses';
    case 'Application':
      return 'Applications';
    case 'Technology':
      return 'Technologies';
    case 'Programme':
      return 'Programmes';
    default:
      return null;
  }
};

const impliedElementTypeForEntity = (entity: Exclude<CsvImportSourceEntity, 'Relationships'>): string => {
  switch (entity) {
    case 'Capabilities':
      return 'Capability';
    case 'BusinessProcesses':
      return 'BusinessProcess';
    case 'Applications':
      return 'Application';
    case 'Technologies':
      return 'Technology';
    case 'Programmes':
      return 'Programme';
  }
};

const fieldTypeOk = (field: CsvFieldSpec, value: unknown): boolean => {
  const t: CsvFieldType = field.type;

  // Optional types: blank is OK.
  if (t === 'optional-string' || t === 'optional-iso8601' || t === 'optional-number') {
    if (isBlankCell(value)) return true;
  }

  if (t === 'nullable-uuid') {
    // Allow null sentinel and blank.
    if (value === null) return true;
    if (isBlankCell(value)) return true;
  }

  if (t === 'string' || t === 'optional-string') {
    return typeof value === 'string' && value.trim().length > 0;
  }

  if (t === 'enum') {
    const s = normalize(value);
    if (!s) return false;
    const allowed = (field.enumValues ?? []) as readonly string[];
    return allowed.length === 0 ? true : allowed.includes(s);
  }

  if (t === 'uuid' || t === 'nullable-uuid') {
    const s = normalize(value);
    return s.length > 0;
  }

  if (t === 'iso8601' || t === 'optional-iso8601') {
    const s = normalize(value);
    if (!s) return false;
    return !Number.isNaN(Date.parse(s));
  }

  if (t === 'number' || t === 'optional-number') {
    if (typeof value === 'number') return Number.isFinite(value);
    const s = normalize(value);
    if (!s) return false;
    const n = Number(s);
    return Number.isFinite(n);
  }

  if (t === 'boolean') {
    if (typeof value === 'boolean') return true;
    const s = normalize(value).toLowerCase();
    return s === 'true' || s === 'false' || s === '1' || s === '0' || s === 'yes' || s === 'no';
  }

  return true;
};

const requiredRelationshipFieldsByType: Record<string, readonly CsvColumnName[]> = {
  DECOMPOSES_TO: [],
  COMPOSED_OF: [],
  SERVED_BY: ['automationLevel'],
  INTEGRATES_WITH: ['dependencyType', 'dependencyStrength', 'runtimeCritical'],
  DEPENDS_ON: ['dependencyType', 'dependencyStrength', 'runtimeCritical'],
  CONSUMES: ['dependencyType', 'dependencyStrength', 'runtimeCritical'],
  DEPLOYED_ON: ['hostingRole', 'environment', 'resilienceLevel'],
  IMPACTS: ['impactType', 'expectedChangeMagnitude'],
};

const sortIssues = (a: ReadinessIssue, b: ReadinessIssue) =>
  a.severity.localeCompare(b.severity) ||
  a.category.localeCompare(b.category) ||
  a.code.localeCompare(b.code) ||
  (a.entityKind ?? '').localeCompare(b.entityKind ?? '') ||
  (a.entityType ?? '').localeCompare(b.entityType ?? '') ||
  (a.entityId ?? '').localeCompare(b.entityId ?? '') ||
  (a.field ?? '').localeCompare(b.field ?? '') ||
  a.message.localeCompare(b.message);

const computeScore = (blockingCount: number, warningCount: number): number => {
  // Stable, simple, explainable scoring:
  // - Blocking issues are heavily penalized.
  // - Warnings are lightly penalized.
  const raw = 100 - blockingCount * 15 - warningCount * 3;
  return Math.max(0, Math.min(100, Math.trunc(raw)));
};

const resolveProject = (options?: InteroperabilityReadinessCheckOptions): Project | null =>
  options?.project ?? projectStore.getProject();

const resolveRepositories = (options?: InteroperabilityReadinessCheckOptions) => ({
  repository: options?.repository ?? getRepository(),
  relationshipRepository: options?.relationshipRepository ?? getRelationshipRepository(),
});

const listAdrsSafe = (): ArchitectureDecisionRecord[] => {
  try {
    return getAdrRepository().listAll();
  } catch {
    return [];
  }
};

export function runInteroperabilityReadinessCheck(
  input: InteroperabilityReadinessCheckInput,
  options: InteroperabilityReadinessCheckOptions = {},
): InteroperabilityReadinessResult {
  const evaluatedAt = safeNowIso();
  const nowIso = normalize(input.nowIso) || evaluatedAt;

  const includeGovernanceChecks = input.includeGovernanceChecks !== false;

  const project = resolveProject(options);
  const { repository, relationshipRepository } = resolveRepositories(options);

  const issues: ReadinessIssue[] = [];

  if (!project) {
    issues.push({
      severity: 'Blocking',
      category: 'GovernanceCompleteness',
      code: 'NO_PROJECT',
      message: 'No active project. Create/select a project before exchange.',
      entityKind: 'Scope',
    });
  }

  const scope = input.scope ?? null;
  const includedElementTypes = scope ? coerceList(scope.includedElementTypes) : [];
  const includedRelationshipTypes = scope ? coerceList(scope.includedRelationshipTypes) : [];

  // Collect elements in scope.
  const allElements: BaseArchitectureElement[] = [
    ...repository.getElementsByType('capabilities'),
    ...repository.getElementsByType('businessProcesses'),
    ...repository.getElementsByType('applications'),
    ...repository.getElementsByType('technologies'),
    ...repository.getElementsByType('programmes'),
  ];

  const elements: BaseArchitectureElement[] = [];
  for (const e of allElements) {
    if (includedElementTypes.length > 0 && !includedElementTypes.includes(e.elementType)) continue;
    elements.push(e);
  }

  // Element mandatory fields (schema-based).
  const addMandatoryFieldIssues = (entity: string, element: BaseArchitectureElement, schema: CsvSchemaSpec) => {
    for (const col of schema.columns) {
      if (!col.requiredCell) continue;

      const value = (element as any)[col.name];
      if (isBlankCell(value)) {
        issues.push({
          severity: 'Blocking',
          category: 'MandatoryFields',
          code: 'MISSING_REQUIRED_FIELD',
          message: `${entity}: element ${element.elementType} "${element.name}" (${element.id}) is missing required field "${col.name}".`,
          entityKind: 'Element',
          entityType: element.elementType,
          entityId: element.id,
          field: col.name,
        });
        continue;
      }

      if (!fieldTypeOk(col, value)) {
        issues.push({
          severity: 'Blocking',
          category: 'MandatoryFields',
          code: 'INVALID_FIELD_TYPE',
          message: `${entity}: element ${element.elementType} "${element.name}" (${element.id}) has invalid value for "${col.name}" (expected ${col.type}).`,
          entityKind: 'Element',
          entityType: element.elementType,
          entityId: element.id,
          field: col.name,
        });
      }
    }

    // Governance advisory: stale reviews.
    const reviewCycleMonths = Number((element as any).reviewCycleMonths);
    const lastReviewedAt = normalize((element as any).lastReviewedAt);
    if (Number.isFinite(reviewCycleMonths) && reviewCycleMonths > 0 && lastReviewedAt) {
      const lastMs = Date.parse(lastReviewedAt);
      const nowMs = Date.parse(nowIso);
      if (!Number.isNaN(lastMs) && !Number.isNaN(nowMs)) {
        const daysSince = (nowMs - lastMs) / (1000 * 60 * 60 * 24);
        const approxDueDays = reviewCycleMonths * 30;
        if (daysSince > approxDueDays) {
          issues.push({
            severity: 'Warning',
            category: 'GovernanceCompleteness',
            code: 'REVIEW_OVERDUE',
            message: `${entity}: element ${element.elementType} "${element.name}" (${element.id}) review appears overdue (lastReviewedAt=${lastReviewedAt}, reviewCycleMonths=${reviewCycleMonths}).`,
            entityKind: 'Element',
            entityType: element.elementType,
            entityId: element.id,
            field: 'lastReviewedAt',
          });
        }
      }
    }

    const approvalStatus = normalize((element as any).approvalStatus);
    if (approvalStatus === 'Draft') {
      issues.push({
        severity: 'Warning',
        category: 'GovernanceCompleteness',
        code: 'APPROVAL_DRAFT',
        message: `${entity}: element ${element.elementType} "${element.name}" (${element.id}) is still Draft.`,
        entityKind: 'Element',
        entityType: element.elementType,
        entityId: element.id,
        field: 'approvalStatus',
      });
    }
  };

  for (const e of elements) {
    const entity = toEntity(e.elementType);
    if (!entity) continue;

    // If an explicit scope excludes this type, skip.
    if (scope && includedElementTypes.length > 0) {
      const implied = impliedElementTypeForEntity(entity);
      if (!includedElementTypes.includes(implied)) continue;
    }

    const schema = CSV_IMPORT_SPECS[entity];
    addMandatoryFieldIssues(entity, e, schema);
  }

  // Relationships.
  const relationshipsAll = relationshipRepository.getAllRelationships();
  const relationships = relationshipsAll.filter((r) =>
    includedRelationshipTypes.length > 0 ? includedRelationshipTypes.includes(r.relationshipType) : true,
  );

  const relationshipSchema = CSV_IMPORT_SPECS.Relationships;
  const relationshipTypeField = relationshipSchema.columns.find((c) => c.name === 'relationshipType') ?? null;
  const allowedRelationshipTypes = ((relationshipTypeField?.enumValues ?? []) as readonly string[]).slice();

  const elementById = new Map<string, BaseArchitectureElement>();
  for (const e of allElements) elementById.set(e.id, e);

  // If scope is provided, validate endpoints are in-scope.
  let inScopeElementIds: Set<string> | null = null;
  if (scope) {
    inScopeElementIds = new Set<string>();
    for (const e of elements) inScopeElementIds.add(e.id);
  }

  for (const r of relationships) {
    // Unsupported relationship types.
    const rt = normalize(r.relationshipType);
    if (allowedRelationshipTypes.length > 0 && !allowedRelationshipTypes.includes(rt)) {
      issues.push({
        severity: 'Blocking',
        category: 'UnsupportedRelationships',
        code: 'UNSUPPORTED_RELATIONSHIP_TYPE',
        message: `Relationships: relationshipType "${rt}" (${r.id}) is not supported for interoperability export/import.`,
        entityKind: 'Relationship',
        entityType: rt,
        entityId: r.id,
        field: 'relationshipType',
      });
      continue;
    }

    // Missing mandatory relationship fields (schema-based).
    for (const col of relationshipSchema.columns) {
      if (!col.requiredCell) continue;
      const value = (r as any)[col.name];
      if (isBlankCell(value)) {
        issues.push({
          severity: 'Blocking',
          category: 'MandatoryFields',
          code: 'MISSING_REQUIRED_FIELD',
          message: `Relationships: relationship ${rt} (${r.id}) is missing required field "${col.name}".`,
          entityKind: 'Relationship',
          entityType: rt,
          entityId: r.id,
          field: col.name,
        });
        continue;
      }

      if (!fieldTypeOk(col, value)) {
        issues.push({
          severity: 'Blocking',
          category: 'MandatoryFields',
          code: 'INVALID_FIELD_TYPE',
          message: `Relationships: relationship ${rt} (${r.id}) has invalid value for "${col.name}" (expected ${col.type}).`,
          entityKind: 'Relationship',
          entityType: rt,
          entityId: r.id,
          field: col.name,
        });
      }
    }

    // Typed relationship fields.
    const requiredTyped = requiredRelationshipFieldsByType[rt] ?? null;
    if (!requiredTyped) {
      issues.push({
        severity: 'Blocking',
        category: 'UnsupportedRelationships',
        code: 'UNSUPPORTED_RELATIONSHIP_TYPE',
        message: `Relationships: relationshipType "${rt}" (${r.id}) is not supported for strict CSV exchange.`,
        entityKind: 'Relationship',
        entityType: rt,
        entityId: r.id,
      });
    } else {
      for (const col of requiredTyped) {
        const v = (r as any)[col];
        if (isBlankCell(v)) {
          issues.push({
            severity: 'Blocking',
            category: 'UnsupportedRelationships',
            code: 'RELATIONSHIP_MISSING_TYPED_FIELD',
            message: `Relationships: relationship ${rt} (${r.id}) requires "${col}" for strict CSV exchange.`,
            entityKind: 'Relationship',
            entityType: rt,
            entityId: r.id,
            field: col,
          });
        }
      }
    }

    // Endpoint existence + type integrity.
    const src = elementById.get(r.sourceElementId) ?? null;
    const tgt = elementById.get(r.targetElementId) ?? null;

    if (!src || !tgt) {
      issues.push({
        severity: 'Blocking',
        category: 'UnsupportedRelationships',
        code: 'MISSING_RELATIONSHIP_ENDPOINT',
        message: `Relationships: relationship ${rt} (${r.id}) references missing endpoint(s): ${r.sourceElementId} -> ${r.targetElementId}.`,
        entityKind: 'Relationship',
        entityType: rt,
        entityId: r.id,
      });
    } else {
      if (normalize(r.sourceElementType) && normalize(r.sourceElementType) !== src.elementType) {
        issues.push({
          severity: 'Blocking',
          category: 'UnsupportedRelationships',
          code: 'ENDPOINT_TYPE_MISMATCH',
          message: `Relationships: relationship ${rt} (${r.id}) sourceElementType "${r.sourceElementType}" does not match repository elementType "${src.elementType}" for ${src.id}.`,
          entityKind: 'Relationship',
          entityType: rt,
          entityId: r.id,
          field: 'sourceElementType',
        });
      }
      if (normalize(r.targetElementType) && normalize(r.targetElementType) !== tgt.elementType) {
        issues.push({
          severity: 'Blocking',
          category: 'UnsupportedRelationships',
          code: 'ENDPOINT_TYPE_MISMATCH',
          message: `Relationships: relationship ${rt} (${r.id}) targetElementType "${r.targetElementType}" does not match repository elementType "${tgt.elementType}" for ${tgt.id}.`,
          entityKind: 'Relationship',
          entityType: rt,
          entityId: r.id,
          field: 'targetElementType',
        });
      }
    }

    // Scope endpoints (exportability).
    if (inScopeElementIds) {
      if (!inScopeElementIds.has(r.sourceElementId) || !inScopeElementIds.has(r.targetElementId)) {
        issues.push({
          severity: 'Blocking',
          category: 'UnsupportedRelationships',
          code: 'RELATIONSHIP_OUTSIDE_SCOPE',
          message: `Relationships: relationship ${rt} (${r.id}) endpoints are outside the selected scope (${r.sourceElementId} -> ${r.targetElementId}).`,
          entityKind: 'Relationship',
          entityType: rt,
          entityId: r.id,
        });
      }
    }

    // Governance advisory.
    if (normalize((r as any).status) === 'Draft') {
      issues.push({
        severity: 'Warning',
        category: 'GovernanceCompleteness',
        code: 'RELATIONSHIP_DRAFT',
        message: `Relationships: relationship ${rt} (${r.id}) is Draft.`,
        entityKind: 'Relationship',
        entityType: rt,
        entityId: r.id,
        field: 'status',
      });
    }
  }

  // Governance artifacts (ADRs).
  const adrs = includeGovernanceChecks ? listAdrsSafe() : [];
  if (includeGovernanceChecks && scope?.includeGovernanceArtifacts) {
    // The export layer does not currently export governance artifacts, but readiness can still highlight gaps.
    for (const adr of adrs) {
      const missing: string[] = [];
      if (!normalize(adr.title)) missing.push('title');
      if (!normalize(adr.context)) missing.push('context');
      if (!normalize(adr.decision)) missing.push('decision');
      if (!normalize(adr.consequences)) missing.push('consequences');
      if (!normalize(adr.decisionDate)) missing.push('decisionDate');

      if (missing.length > 0) {
        issues.push({
          severity: 'Warning',
          category: 'GovernanceCompleteness',
          code: 'ADR_INCOMPLETE',
          message: `ADR: ${adr.adrId} is incomplete (missing: ${missing.sort().join(', ')}).`,
          entityKind: 'ADR',
          entityType: 'ADR',
          entityId: adr.adrId,
        });
      }
    }
  }

  issues.sort(sortIssues);

  const blockingIssues = issues.filter((i) => i.severity === 'Blocking');
  const advisoryWarnings = issues.filter((i) => i.severity === 'Warning');

  const readinessScore = computeScore(blockingIssues.length, advisoryWarnings.length);

  return {
    evaluatedAt,
    readinessScore,
    blockingIssues,
    advisoryWarnings,
    summary: {
      evaluatedElementsCount: elements.length,
      evaluatedRelationshipsCount: relationships.length,
      evaluatedAdrsCount: adrs.length,
      blockingCount: blockingIssues.length,
      warningCount: advisoryWarnings.length,
    },
  };
}
