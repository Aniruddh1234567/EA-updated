import type { Project } from '../../project/project';
import { projectStore } from '../../project/ProjectStore';
import {
  createArchitectureRepository,
  type ArchitectureRepository,
  type RepositoryCollectionType,
} from '../../repository/ArchitectureRepository';
import type { BaseArchitectureElement } from '../../repository/BaseArchitectureElement';
import type { Application } from '../../repository/Application';
import type { BusinessProcess } from '../../repository/BusinessProcess';
import type { Capability } from '../../repository/Capability';
import type { Programme } from '../../repository/Programme';
import type { Technology } from '../../repository/Technology';
import {
  createRelationshipRepository,
  type RelationshipRepository,
} from '../../repository/RelationshipRepository';
import type { BaseArchitectureRelationship } from '../../repository/BaseArchitectureRelationship';
import { getRelationshipEndpointRule } from '../../relationships/RelationshipSemantics';
import { getRepository, setRepository } from '../../repository/RepositoryStore';
import {
  getRelationshipRepository,
  setRelationshipRepository,
} from '../../repository/RelationshipRepositoryStore';
import { getGovernanceEnforcementMode } from '../../governance/GovernanceEnforcementConfig';

import type {
  CanonicalExchangeModel,
  CanonicalEnvelope,
  CanonicalRelationship,
  CanonicalRepositoryElement,
} from '../CanonicalExchangeModel';
import {
  APPLICATIONS_CSV_SCHEMA,
  BUSINESS_PROCESSES_CSV_SCHEMA,
  CAPABILITIES_CSV_SCHEMA,
  CSV_IMPORT_SPECS,
  PROGRAMMES_CSV_SCHEMA,
  RELATIONSHIPS_CSV_SCHEMA,
  TECHNOLOGIES_CSV_SCHEMA,
  type CsvColumnName,
  type CsvFieldSpec,
  type CsvImportSourceEntity,
  type CsvRowError,
  type CsvSchemaSpec,
} from './CsvImportSpecification';

export type CsvImportEngineInput = {
  /** Which schema to apply to this CSV file. */
  entity: CsvImportSourceEntity;
  /** Raw CSV text (including header line). */
  csvText: string;
  /** Optional label for audit/debug (not persisted). */
  sourceDescription?: string;
};

export type CsvImportEngineOptions = {
  /** Project metadata source (if omitted, uses ProjectStore). */
  project?: Project;
  /** If false, validates and returns CanonicalExchangeModel but does not apply swap. */
  applyToRepository?: boolean;
};

export type CsvImportEngineSuccess = {
  ok: true;
  canonicalModel: CanonicalExchangeModel;
  importedElementsCount: number;
  importedRelationshipsCount: number;
  errors: [];
};

export type CsvImportEngineFailure = {
  ok: false;
  errors: CsvRowError[];
};

export type CsvImportEngineResult = CsvImportEngineSuccess | CsvImportEngineFailure;

type ParsedCsv = {
  headerLine: number;
  headers: string[];
  /** Each row includes the 1-based file line number where the row starts. */
  rows: Array<{ line: number; values: string[] }>;
};

const normalizeBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** RFC4180-ish CSV parser with quote support and deterministic behavior. */
export function parseCsvStrict(csvText: string): ParsedCsv {
  const text = normalizeBom(csvText ?? '');
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const rows: Array<{ line: number; values: string[] }> = [];

  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  const pushField = () => {
    current.push(field);
    field = '';
  };

  const pushRow = () => {
    // Ignore a trailing completely-empty row.
    if (current.length === 1 && current[0] === '' && rows.length > 0) {
      current = [];
      return;
    }
    rows.push({ line: rowStartLine, values: current });
    current = [];
  };

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];

    if (ch === '"') {
      if (inQuotes) {
        const next = normalized[i + 1];
        if (next === '"') {
          // Escaped quote.
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        inQuotes = true;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      pushField();
      continue;
    }

    if (ch === '\n' && !inQuotes) {
      pushField();
      pushRow();
      line += 1;
      rowStartLine = line;
      continue;
    }

    field += ch;
  }

  // Final row
  pushField();
  pushRow();

  const header = rows.shift();
  const headers = (header?.values ?? []).map((h) => h.trim());

  return {
    headerLine: header?.line ?? 1,
    headers,
    rows,
  };
}

const isBlank = (v: unknown) => typeof v !== 'string' || v.trim().length === 0;

const uuidRegex =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

const isUuid = (v: string) => uuidRegex.test(v);

// Strict-enough ISO 8601 check (date or timestamp with Z).
const iso8601Regex =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z)?$/;

const isIso8601 = (v: string) => iso8601Regex.test(v);

const parseBooleanStrict = (v: string): boolean | null => {
  const s = (v ?? '').trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return null;
};

const parseNumberStrict = (v: string): number | null => {
  const s = (v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const getCell = (row: Record<string, string>, col: string) => (row[col] ?? '').trim();

const schemaFor = (entity: CsvImportSourceEntity): CsvSchemaSpec => CSV_IMPORT_SPECS[entity];

const validateHeaders = (parsed: ParsedCsv, schema: CsvSchemaSpec): CsvRowError[] => {
  const errors: CsvRowError[] = [];

  const headerLine = parsed.headerLine;

  const seen = new Set<string>();
  for (const h of parsed.headers) {
    if (seen.has(h)) {
      errors.push({
        line: headerLine,
        code: 'DUPLICATE_HEADER',
        message: `Duplicate header: "${h}".`,
        column: h,
      });
    }
    seen.add(h);
  }

  for (const required of schema.requiredHeaders) {
    if (!seen.has(required)) {
      errors.push({
        line: headerLine,
        code: 'MISSING_HEADER',
        message: `Missing required header: "${required}".`,
        column: required,
      });
    }
  }

  // Reject unknown headers (strict import).
  const known = new Set(schema.columns.map((c) => c.name));
  for (const h of parsed.headers) {
    if (!known.has(h)) {
      errors.push({
        line: headerLine,
        code: 'UNKNOWN_HEADER',
        message: `Unknown header: "${h}".`,
        column: h,
      });
    }
  }

  return errors;
};

const coerceCell = (
  spec: CsvFieldSpec,
  rawValue: string,
): { ok: true; value: unknown } | { ok: false; error: string; code: 'INVALID_TYPE' | 'INVALID_ENUM' } => {
  const value = (rawValue ?? '').trim();

  const allowEmpty =
    spec.type.startsWith('optional-') || spec.type === 'nullable-uuid' || spec.requiredCell === false;

  if (!value) {
    if (spec.requiredCell && !allowEmpty) {
      return { ok: false, code: 'INVALID_TYPE', error: 'Value is required.' };
    }

    if (spec.type === 'nullable-uuid') return { ok: true, value: null };
    if (spec.type.startsWith('optional-')) return { ok: true, value: undefined };

    // For non-required fields, treat blank as missing.
    // Rationale: keeps typed optional columns (enum/boolean/number/uuid/iso8601) out of domain objects.
    if (spec.type !== 'string') return { ok: true, value: undefined };

    // Empty string is valid for string fields only when not required.
    return { ok: true, value: '' };
  }

  switch (spec.type) {
    case 'string':
    case 'optional-string':
      return { ok: true, value };

    case 'uuid':
      return isUuid(value)
        ? { ok: true, value }
        : { ok: false, code: 'INVALID_TYPE', error: 'Expected UUID.' };

    case 'nullable-uuid': {
      if (value.toLowerCase() === 'null') return { ok: true, value: null };
      return isUuid(value)
        ? { ok: true, value }
        : { ok: false, code: 'INVALID_TYPE', error: 'Expected UUID or null.' };
    }

    case 'iso8601':
    case 'optional-iso8601':
      return isIso8601(value)
        ? { ok: true, value }
        : { ok: false, code: 'INVALID_TYPE', error: 'Expected ISO-8601 date/timestamp.' };

    case 'number':
    case 'optional-number': {
      const n = parseNumberStrict(value);
      return typeof n === 'number'
        ? { ok: true, value: n }
        : { ok: false, code: 'INVALID_TYPE', error: 'Expected number.' };
    }

    case 'boolean': {
      const b = parseBooleanStrict(value);
      return typeof b === 'boolean'
        ? { ok: true, value: b }
        : { ok: false, code: 'INVALID_TYPE', error: 'Expected boolean (true/false).' };
    }

    case 'enum': {
      const allowed = spec.enumValues ?? [];
      if (allowed.includes(value)) return { ok: true, value };
      return {
        ok: false,
        code: 'INVALID_ENUM',
        error: `Expected one of: ${allowed.map((v) => `"${v}"`).join(', ')}.`,
      };
    }

    default:
      return { ok: false, code: 'INVALID_TYPE', error: `Unsupported CSV field type: ${String(spec.type)}.` };
  }
};

const rowsToObjects = (
  parsed: ParsedCsv,
  schema: CsvSchemaSpec,
): { rows: Array<{ line: number; obj: Record<string, string> }>; errors: CsvRowError[] } => {
  const errors: CsvRowError[] = [];

  const headers = parsed.headers;

  for (const row of parsed.rows) {
    if (row.values.length !== headers.length) {
      errors.push({
        line: row.line,
        code: 'ROW_COLUMN_MISMATCH',
        message: `Row has ${row.values.length} columns but header has ${headers.length}.`,
      });
    }
  }

  const out: Array<{ line: number; obj: Record<string, string> }> = [];

  for (const row of parsed.rows) {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i];
      obj[key] = (row.values[i] ?? '').trim();
    }
    out.push({ line: row.line, obj });
  }

  return { rows: out, errors };
};

const validateAndCoerceRows = (
  parsed: ParsedCsv,
  schema: CsvSchemaSpec,
): { values: Array<{ line: number; record: Record<string, unknown> }>; errors: CsvRowError[] } => {
  const errors: CsvRowError[] = [];

  const { rows, errors: rowShapeErrors } = rowsToObjects(parsed, schema);
  errors.push(...rowShapeErrors);

  // Build map of column specs by name.
  const specByName = new Map<string, CsvFieldSpec>();
  for (const c of schema.columns) specByName.set(c.name, c);

  const values: Array<{ line: number; record: Record<string, unknown> }> = [];

  for (const { line, obj } of rows) {
    const record: Record<string, unknown> = {};

    for (const colSpec of schema.columns) {
      const raw = obj[colSpec.name] ?? '';

      // Required cell check: treat blanks as errors.
      if (colSpec.requiredCell && isBlank(raw)) {
        errors.push({
          line,
          code: 'EMPTY_REQUIRED_CELL',
          message: `Missing required value for "${colSpec.name}".`,
          column: colSpec.name,
        });
        continue;
      }

      const coerced = coerceCell(colSpec, raw);
      if (!coerced.ok) {
        errors.push({
          line,
          code: coerced.code,
          message: `${colSpec.name}: ${coerced.error}`,
          column: colSpec.name,
          value: raw,
        });
        continue;
      }

      record[colSpec.name] = coerced.value;
    }

    values.push({ line, record });
  }

  return { values, errors };
};

const validateDuplicateIds = (
  values: Array<{ line: number; record: Record<string, unknown> }>,
): CsvRowError[] => {
  const errors: CsvRowError[] = [];
  const byId = new Map<string, number>();

  for (const { line, record } of values) {
    const id = String(record.id ?? '').trim();
    if (!id) continue;

    const existing = byId.get(id);
    if (existing) {
      errors.push({
        line,
        code: 'DUPLICATE_ID',
        message: `Duplicate id "${id}" (also seen at line ${existing}).`,
        column: 'id',
        value: id,
      });
    } else {
      byId.set(id, line);
    }
  }

  return errors;
};

const requiredRelationshipFieldsByType: Record<
  string,
  readonly CsvColumnName[]
> = {
  DECOMPOSES_TO: [],
  COMPOSED_OF: [],
  SERVED_BY: ['automationLevel'],
  INTEGRATES_WITH: ['dependencyType', 'dependencyStrength', 'runtimeCritical'],
  DEPENDS_ON: ['dependencyType', 'dependencyStrength', 'runtimeCritical'],
  CONSUMES: ['dependencyType', 'dependencyStrength', 'runtimeCritical'],
  DEPLOYED_ON: ['hostingRole', 'environment', 'resilienceLevel'],
  IMPACTS: ['impactType', 'expectedChangeMagnitude'],
};

const validateRelationshipTypedFields = (
  values: Array<{ line: number; record: Record<string, unknown> }>,
): CsvRowError[] => {
  const errors: CsvRowError[] = [];

  for (const { line, record } of values) {
    const relationshipType = String(record.relationshipType ?? '').trim();
    const required = requiredRelationshipFieldsByType[relationshipType] ?? null;
    if (!required) {
      errors.push({
        line,
        code: 'UNSUPPORTED_RELATIONSHIP_TYPE',
        message: `Unsupported relationshipType "${relationshipType}".`,
        column: 'relationshipType',
        value: relationshipType,
      });
      continue;
    }

    for (const col of required) {
      const v = record[col];
      const blank = v === undefined || v === null || String(v).trim().length === 0;
      if (blank) {
        errors.push({
          line,
          code: 'RELATIONSHIP_MISSING_TYPED_FIELDS',
          message: `relationshipType "${relationshipType}" requires "${col}".`,
          column: col,
        });
      }
    }
  }

  return errors;
};

const makeElementTypeToCollection = (elementType: string): RepositoryCollectionType | null => {
  switch ((elementType ?? '').trim()) {
    case 'Capability':
      return 'capabilities';
    case 'BusinessProcess':
      return 'businessProcesses';
    case 'Application':
      return 'applications';
    case 'Technology':
      return 'technologies';
    case 'Programme':
      return 'programmes';
    default:
      return null;
  }
};

const toEnvelope = <T>(value: T): CanonicalEnvelope<T> => ({ value });

const sortElements = (a: BaseArchitectureElement, b: BaseArchitectureElement) =>
  a.elementType.localeCompare(b.elementType) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

const sortRelationships = (a: BaseArchitectureRelationship, b: BaseArchitectureRelationship) =>
  a.relationshipType.localeCompare(b.relationshipType) ||
  a.sourceElementId.localeCompare(b.sourceElementId) ||
  a.targetElementId.localeCompare(b.targetElementId) ||
  a.id.localeCompare(b.id);

const cloneCurrentRepositories = (): { repo: ArchitectureRepository; relRepo: RelationshipRepository } => {
  const current = getRepository();
  const currentRel = getRelationshipRepository();

  const repo = createArchitectureRepository();

  const types: readonly RepositoryCollectionType[] = [
    'capabilities',
    'businessProcesses',
    'applications',
    'technologies',
    'programmes',
  ];

  for (const t of types) {
    for (const e of current.getElementsByType(t)) {
      const res = repo.addElement(t, e);
      if (!res.ok) {
        throw new Error(`Failed to clone repository: ${res.error}`);
      }
    }
  }

  const relRepo = createRelationshipRepository(repo);
  for (const r of currentRel.getAllRelationships()) {
    const res = relRepo.addRelationship(r);
    if (!res.ok) {
      throw new Error(`Failed to clone relationship repository: ${res.error}`);
    }
  }

  return { repo, relRepo };
};

const validateElementReferentialIntegrity = (
  entity: CsvImportSourceEntity,
  values: Array<{ line: number; record: Record<string, unknown> }>,
  repo: ArchitectureRepository,
): CsvRowError[] => {
  const errors: CsvRowError[] = [];

  if (entity === 'Capabilities') {
    for (const { line, record } of values) {
      const parent = record.parentCapabilityId as string | null | undefined;
      if (parent && !repo.getElementById(parent)) {
        errors.push({
          line,
          code: 'UNKNOWN_ELEMENT_REFERENCE',
          message: `parentCapabilityId references unknown element "${parent}".`,
          column: 'parentCapabilityId',
          value: String(parent),
        });
      }
    }
  }

  if (entity === 'BusinessProcesses') {
    for (const { line, record } of values) {
      const parentCapabilityId = String(record.parentCapabilityId ?? '').trim();
      if (parentCapabilityId && !repo.getElementById(parentCapabilityId)) {
        errors.push({
          line,
          code: 'UNKNOWN_ELEMENT_REFERENCE',
          message: `parentCapabilityId references unknown element "${parentCapabilityId}".`,
          column: 'parentCapabilityId',
          value: parentCapabilityId,
        });
      }
    }
  }

  return errors;
};

const validateRelationshipReferentialIntegrity = (
  values: Array<{ line: number; record: Record<string, unknown> }>,
  repo: ArchitectureRepository,
): CsvRowError[] => {
  const errors: CsvRowError[] = [];

  for (const { line, record } of values) {
    const relationshipType = String(record.relationshipType ?? '').trim();
    const sourceId = String(record.sourceElementId ?? '').trim();
    const targetId = String(record.targetElementId ?? '').trim();
    const sourceType = String(record.sourceElementType ?? '').trim();
    const targetType = String(record.targetElementType ?? '').trim();

    const source = repo.getElementById(sourceId);
    const target = repo.getElementById(targetId);

    if (!source) {
      errors.push({
        line,
        code: 'UNKNOWN_ELEMENT_REFERENCE',
        message: `Unknown sourceElementId "${sourceId}".`,
        column: 'sourceElementId',
        value: sourceId,
      });
      continue;
    }

    if (!target) {
      errors.push({
        line,
        code: 'UNKNOWN_ELEMENT_REFERENCE',
        message: `Unknown targetElementId "${targetId}".`,
        column: 'targetElementId',
        value: targetId,
      });
      continue;
    }

    if (source.elementType !== sourceType) {
      errors.push({
        line,
        code: 'ENDPOINT_TYPE_MISMATCH',
        message: `sourceElementType mismatch for "${sourceId}" (expected "${source.elementType}", got "${sourceType}").`,
        column: 'sourceElementType',
        value: sourceType,
      });
    }

    if (target.elementType !== targetType) {
      errors.push({
        line,
        code: 'ENDPOINT_TYPE_MISMATCH',
        message: `targetElementType mismatch for "${targetId}" (expected "${target.elementType}", got "${targetType}").`,
        column: 'targetElementType',
        value: targetType,
      });
    }

    const rule = getRelationshipEndpointRule(relationshipType);
    if (!rule || !rule.from.includes(sourceType) || !rule.to.includes(targetType)) {
      errors.push({
        line,
        code: 'INVALID_RELATIONSHIP_ENDPOINTS',
        message: `Invalid endpoints for relationshipType "${relationshipType}" ("${sourceType}" -> "${targetType}").`,
        column: 'relationshipType',
        value: relationshipType,
      });
    }
  }

  return errors;
};

const buildRepositoryElement = (
  entity: CsvImportSourceEntity,
  record: Record<string, unknown>,
): CanonicalRepositoryElement => {
  // Records already coerced; cast per-entity to satisfy the canonical union type.
  switch (entity) {
    case 'Capabilities': {
      const e = record as unknown as Capability;
      // Domain expects maturityLevel as 1..5 number; CSV validated as "1".."5".
      (e as any).maturityLevel = Number(String(record.maturityLevel ?? ''));
      return e;
    }
    case 'BusinessProcesses':
      return record as unknown as BusinessProcess;
    case 'Applications':
      return record as unknown as Application;
    case 'Technologies':
      return record as unknown as Technology;
    case 'Programmes':
      return record as unknown as Programme;
    default:
      return record as unknown as CanonicalRepositoryElement;
  }
};

const buildRelationship = (record: Record<string, unknown>): BaseArchitectureRelationship => {
  // Drop undefined optional fields deterministically.
  const out: Record<string, unknown> = {};
  const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    const v = record[k];
    if (v === undefined) continue;
    out[k] = v;
  }
  return out as unknown as BaseArchitectureRelationship;
};

const normalizeErrors = (errors: CsvRowError[]): CsvRowError[] =>
  errors
    .slice()
    .sort(
      (a, b) =>
        a.line - b.line ||
        String(a.column ?? '').localeCompare(String(b.column ?? '')) ||
        a.code.localeCompare(b.code) ||
        a.message.localeCompare(b.message),
    );

const resolveProject = (options?: CsvImportEngineOptions): Project | null =>
  options?.project ?? projectStore.getProject();

/**
 * Transactional CSV import engine.
 *
 * - Parses and validates each CSV strictly against the entity schema.
 * - Stages the import into cloned repositories (including referential checks).
 * - Applies via repository swaps only if validation fully passes.
 */
export function importCsvTransactional(
  inputs: readonly CsvImportEngineInput[],
  options: CsvImportEngineOptions = {},
): CsvImportEngineResult {
  const applyToRepository = options.applyToRepository ?? true;

  const project = resolveProject(options);
  if (!project) {
    return {
      ok: false,
      errors: [
        {
          line: 0,
          code: 'INVALID_TYPE',
          message: 'No project available. Provide options.project or create one in ProjectStore before import.',
        },
      ],
    };
  }

  // Deterministic processing order: elements first, relationships last.
  const order: CsvImportSourceEntity[] = [
    'Capabilities',
    'BusinessProcesses',
    'Applications',
    'Technologies',
    'Programmes',
    'Relationships',
  ];

  const sortedInputs = inputs
    .slice()
    .sort((a, b) => order.indexOf(a.entity) - order.indexOf(b.entity) || (a.sourceDescription ?? '').localeCompare(b.sourceDescription ?? ''));

  // Stage repositories (clone current state to support atomic swap).
  const staged = cloneCurrentRepositories();

  const importedElements: CanonicalRepositoryElement[] = [];
  const importedRelationships: CanonicalRelationship[] = [];

  const allErrors: CsvRowError[] = [];

  for (const input of sortedInputs) {
    const schema = schemaFor(input.entity);
    const parsed = parseCsvStrict(input.csvText);

    const errorsAtStartOfInput = allErrors.length;

    allErrors.push(...validateHeaders(parsed, schema));

    const coerced = validateAndCoerceRows(parsed, schema);
    allErrors.push(...coerced.errors);
    allErrors.push(...validateDuplicateIds(coerced.values));

    if (input.entity === 'Relationships') {
      allErrors.push(...validateRelationshipTypedFields(coerced.values));
    }

    // If there are errors for this CSV, skip deeper staging validations to avoid noisy cascades.
    // (Still deterministic and detailed enough; line-level errors already captured.)
    const hasBlockingForThisInput = allErrors.length > errorsAtStartOfInput;
    if (hasBlockingForThisInput) continue;

    if (input.entity === 'Relationships') {
      // Validate referential integrity against staged elements.
      allErrors.push(...validateRelationshipReferentialIntegrity(coerced.values, staged.repo));
      if (allErrors.length > 0) continue;

      for (const { line, record } of coerced.values) {
        const rel = buildRelationship(record);
        const res = staged.relRepo.addRelationship(rel);
        if (!res.ok) {
          allErrors.push({
            line,
            code: 'INVALID_TYPE',
            message: res.error,
          });
        } else {
          importedRelationships.push(rel as unknown as CanonicalRelationship);
        }
      }

      continue;
    }

    // Elements.
    for (const { line, record } of coerced.values) {
      const element = buildRepositoryElement(input.entity, record);
      const elementType = String(element.elementType ?? '').trim();
      const collectionType = makeElementTypeToCollection(elementType);

      if (!collectionType) {
        allErrors.push({
          line,
          code: 'INVALID_TYPE',
          message: `Unsupported elementType "${elementType}".`,
          column: 'elementType',
          value: elementType,
        });
        continue;
      }

      const res = staged.repo.addElement(collectionType, element);
      if (!res.ok) {
        allErrors.push({
          line,
          code: 'DUPLICATE_ID',
          message: res.error,
          column: 'id',
          value: String(element.id ?? ''),
        });
      } else {
        importedElements.push(element);
      }
    }

    // Cross-field referential integrity within elements (e.g., parentCapabilityId).
    allErrors.push(...validateElementReferentialIntegrity(input.entity, coerced.values, staged.repo));
  }

  const errors = normalizeErrors(allErrors);
  if (errors.length > 0) return { ok: false, errors };

  // Build canonical model (deterministic ordering).
  const canonicalModel: CanonicalExchangeModel = {
    projectMetadata: toEnvelope({ ...project, canonicalModelVersion: 'cem/1' }),
    repositoryElements: importedElements.slice().sort(sortElements).map(toEnvelope),
    relationships: (importedRelationships as unknown as BaseArchitectureRelationship[])
      .slice()
      .sort(sortRelationships)
      .map(toEnvelope),
    views: [],
    governanceArtifacts: { rules: [], adrs: [] },
  };

  if (applyToRepository) {
    // Transactional swap: staged contains current+imported.
    const governanceMode = getGovernanceEnforcementMode();
    const mode = governanceMode === 'Advisory' ? 'Advisory' : 'Strict';

    const validation = setRepository(staged.repo, { relationships: staged.relRepo, mode });
    if (!validation.ok) {
      return {
        ok: false,
        errors: [
          {
            line: 1,
            code: 'VALIDATION_FAILED',
            message: validation.message,
          },
        ],
      };
    }

    // In advisory mode we still surface warnings to the caller.
    if (validation.warnings?.length) {
      // eslint-disable-next-line no-console
      console.warn('[governance] advisory repository warnings:', validation.warnings);
    }

    setRelationshipRepository(staged.relRepo);
  }

  return {
    ok: true,
    canonicalModel,
    importedElementsCount: importedElements.length,
    importedRelationshipsCount: importedRelationships.length,
    errors: [],
  };
}

// Re-export commonly used schemas for convenience.
export const CsvImportSchemas = {
  capabilities: CAPABILITIES_CSV_SCHEMA,
  businessProcesses: BUSINESS_PROCESSES_CSV_SCHEMA,
  applications: APPLICATIONS_CSV_SCHEMA,
  technologies: TECHNOLOGIES_CSV_SCHEMA,
  programmes: PROGRAMMES_CSV_SCHEMA,
  relationships: RELATIONSHIPS_CSV_SCHEMA,
} as const;
