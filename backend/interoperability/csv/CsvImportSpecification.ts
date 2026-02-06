/*
 * Strict CSV Import Specifications (v1).
 *
 * Goal:
 * - Predictable, enterprise-safe imports: strict headers, explicit IDs, row-level errors.
 *
 * Non-goals:
 * - No execution/persistence.
 * - No inference of relationships.
 * - No auto-fixing or auto-generation of IDs.
 */

export type CsvImportSourceEntity =
  | 'Capabilities'
  | 'BusinessProcesses'
  | 'Applications'
  | 'Technologies'
  | 'Programmes'
  | 'Relationships';

export type CsvSpecVersion = 'csv-import/1';

export type CsvColumnName = string;

export type CsvFieldType =
  | 'string'
  | 'boolean'
  | 'number'
  | 'iso8601'
  | 'uuid'
  | 'enum'
  | 'nullable-uuid'
  | 'optional-string'
  | 'optional-iso8601'
  | 'optional-number';

export type CsvFieldSpec = {
  name: CsvColumnName;
  type: CsvFieldType;

  /**
   * If true, column must exist in the CSV header.
   * Note: this is independent of per-row requiredness (e.g. optional columns allowed).
   */
  requiredHeader: boolean;

  /** If true, the cell must be non-empty for every row (unless type encodes optionality). */
  requiredCell?: boolean;

  /** Allowed values when type is enum. */
  enumValues?: readonly string[];
};

export type CsvSchemaSpec = {
  specVersion: CsvSpecVersion;
  entity: CsvImportSourceEntity;

  /** Ordered list of all known columns for this entity (deterministic contract). */
  columns: readonly CsvFieldSpec[];

  /** Convenience: derived from columns[].requiredHeader */
  requiredHeaders: readonly CsvColumnName[];

  /** Convenience: columns not required but recognized. */
  optionalHeaders: readonly CsvColumnName[];

  /**
   * High-level behavioral constraints the importer MUST uphold.
   * (Defined here as part of the spec; enforcement occurs in importer implementation.)
   */
  rules: {
    /** IDs must be provided in the CSV; never auto-generated. */
    explicitIdsRequired: true;

    /** Invalid rows are rejected and surfaced with line-level errors. */
    invalidRowsRejected: true;

    /** Atomic behavior: no partial commits (all-or-nothing). */
    noPartialCommits: true;

    /** No inference and no auto-fixes. */
    noInference: true;
    noAutoFix: true;

    /** Mandatory headers are enforced exactly (case-sensitive). */
    mandatoryHeadersEnforced: true;
  };
};

export type CsvImportErrorCode =
  | 'MISSING_HEADER'
  | 'UNKNOWN_HEADER'
  | 'DUPLICATE_HEADER'
  | 'ROW_COLUMN_MISMATCH'
  | 'EMPTY_REQUIRED_CELL'
  | 'INVALID_TYPE'
  | 'INVALID_ENUM'
  | 'DUPLICATE_ID'
  | 'UNKNOWN_ELEMENT_REFERENCE'
  | 'ENDPOINT_TYPE_MISMATCH'
  | 'INVALID_RELATIONSHIP_ENDPOINTS'
  | 'UNSUPPORTED_RELATIONSHIP_TYPE'
  | 'RELATIONSHIP_MISSING_TYPED_FIELDS'
  | 'VALIDATION_FAILED';

export type CsvRowError = {
  /** 1-based line number in the source file (including header line). */
  line: number;
  code: CsvImportErrorCode;
  message: string;

  /** Optional column name to pinpoint the issue. */
  column?: CsvColumnName;

  /** Optional raw cell value for audit/debug. */
  value?: string;
};

// Shared enums from internal domain (redeclared as string unions for spec purposes).
const ARCHITECTURE_LAYER = ['Business', 'Application', 'Technology', 'Implementation & Migration', 'Governance'] as const;
const LIFECYCLE_STATUS = ['Planned', 'Active', 'Deprecated', 'Retired'] as const;
const APPROVAL_STATUS = ['Draft', 'Approved', 'Rejected'] as const;

const APPLICATION_TYPE = ['COTS', 'Custom', 'SaaS', 'Legacy'] as const;
const BUSINESS_CRITICALITY = ['Mission-Critical', 'High', 'Medium', 'Low'] as const;
const DEPLOYMENT_MODEL = ['On-Prem', 'Cloud', 'Hybrid'] as const;
const RISK_LEVEL = ['High', 'Medium', 'Low'] as const;

const TECHNOLOGY_TYPE = ['Infrastructure', 'Platform', 'Service'] as const;
const TECHNOLOGY_CATEGORY = ['Compute', 'Storage', 'Network', 'Middleware'] as const;

const CAPABILITY_LEVEL = ['L1', 'L2', 'L3'] as const;
const STRATEGIC_IMPORTANCE = ['High', 'Medium', 'Low'] as const;
const PROCESS_FREQUENCY = ['Ad-hoc', 'Daily', 'Weekly', 'Monthly'] as const;
const PROCESS_CRITICALITY = ['High', 'Medium', 'Low'] as const;

const PROGRAMME_TYPE = ['Transformation', 'Compliance', 'Modernization'] as const;
const FUNDING_STATUS = ['Approved', 'Proposed', 'Rejected'] as const;

// Relationship enums (BaseArchitectureRelationship + specialized fields)
const RELATIONSHIP_DIRECTION = ['OUTGOING'] as const;
const RELATIONSHIP_STATUS = ['Draft', 'Approved', 'Deprecated'] as const;
const CONFIDENCE_LEVEL = ['High', 'Medium', 'Low'] as const;

const RELATIONSHIP_TYPE = [
  'DECOMPOSES_TO',
  'COMPOSED_OF',
  'REALIZED_BY',
  'REALIZES',
  'TRIGGERS',
  'SERVED_BY',
  'EXPOSES',
  'PROVIDED_BY',
  'USED_BY',
  'USES',
  'INTEGRATES_WITH',
  'DEPENDS_ON',
  'CONSUMES',
  'DEPLOYED_ON',
  'IMPACTS',
] as const;

const DEPENDENCY_TYPE = ['Data', 'API', 'Batch', 'Event'] as const;
const DEPENDENCY_STRENGTH = ['Hard', 'Soft'] as const;

const HOSTING_ROLE = ['Primary', 'Secondary', 'DR'] as const;
const HOSTING_ENVIRONMENT = ['Prod', 'Non-Prod'] as const;
const RESILIENCE_LEVEL = ['High', 'Medium', 'Low'] as const;

const AUTOMATION_LEVEL = ['Manual', 'Assisted', 'Automated'] as const;

const IMPACT_TYPE = ['Create', 'Modify', 'Retire'] as const;
const EXPECTED_CHANGE_MAGNITUDE = ['High', 'Medium', 'Low'] as const;

// Base element columns (shared)
const BASE_ELEMENT_COLUMNS: readonly CsvFieldSpec[] = [
  { name: 'id', type: 'uuid', requiredHeader: true, requiredCell: true },
  { name: 'name', type: 'string', requiredHeader: true, requiredCell: true },
  { name: 'description', type: 'string', requiredHeader: true, requiredCell: true },

  { name: 'elementType', type: 'enum', requiredHeader: true, requiredCell: true },
  { name: 'layer', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: ARCHITECTURE_LAYER },

  { name: 'lifecycleStatus', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: LIFECYCLE_STATUS },
  { name: 'lifecycleStartDate', type: 'iso8601', requiredHeader: true, requiredCell: true },
  { name: 'lifecycleEndDate', type: 'optional-iso8601', requiredHeader: false },

  { name: 'ownerRole', type: 'string', requiredHeader: true, requiredCell: true },
  { name: 'ownerName', type: 'string', requiredHeader: true, requiredCell: true },
  { name: 'owningUnit', type: 'string', requiredHeader: true, requiredCell: true },

  { name: 'approvalStatus', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: APPROVAL_STATUS },
  { name: 'lastReviewedAt', type: 'iso8601', requiredHeader: true, requiredCell: true },
  { name: 'reviewCycleMonths', type: 'number', requiredHeader: true, requiredCell: true },

  { name: 'createdAt', type: 'iso8601', requiredHeader: true, requiredCell: true },
  { name: 'createdBy', type: 'string', requiredHeader: true, requiredCell: true },
  { name: 'lastModifiedAt', type: 'iso8601', requiredHeader: true, requiredCell: true },
  { name: 'lastModifiedBy', type: 'string', requiredHeader: true, requiredCell: true },
];

const makeSchema = (entity: CsvImportSourceEntity, columns: readonly CsvFieldSpec[]): CsvSchemaSpec => {
  const requiredHeaders = columns.filter((c) => c.requiredHeader).map((c) => c.name);
  const optionalHeaders = columns.filter((c) => !c.requiredHeader).map((c) => c.name);

  return {
    specVersion: 'csv-import/1',
    entity,
    columns,
    requiredHeaders,
    optionalHeaders,
    rules: {
      explicitIdsRequired: true,
      invalidRowsRejected: true,
      noPartialCommits: true,
      noInference: true,
      noAutoFix: true,
      mandatoryHeadersEnforced: true,
    },
  };
};

/**
 * Capabilities CSV schema.
 *
 * Strictness:
 * - `elementType` MUST be "Capability" for every row.
 */
export const CAPABILITIES_CSV_SCHEMA: CsvSchemaSpec = makeSchema('Capabilities', [
  ...BASE_ELEMENT_COLUMNS.map((c) =>
    c.name === 'elementType' ? { ...c, enumValues: ['Capability'], type: 'enum' as const } : c,
  ),

  { name: 'capabilityLevel', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: CAPABILITY_LEVEL },
  { name: 'parentCapabilityId', type: 'nullable-uuid', requiredHeader: true },
  { name: 'businessOutcome', type: 'string', requiredHeader: true, requiredCell: true },
  { name: 'valueStream', type: 'optional-string', requiredHeader: false },

  { name: 'inScope', type: 'boolean', requiredHeader: true, requiredCell: true },
  { name: 'impactedByChange', type: 'boolean', requiredHeader: true, requiredCell: true },

  {
    name: 'strategicImportance',
    type: 'enum',
    requiredHeader: true,
    requiredCell: true,
    enumValues: STRATEGIC_IMPORTANCE,
  },
  { name: 'maturityLevel', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: ['1', '2', '3', '4', '5'] },
]);

/**
 * BusinessProcesses CSV schema.
 *
 * Strictness:
 * - `elementType` MUST be "BusinessProcess" for every row.
 */
export const BUSINESS_PROCESSES_CSV_SCHEMA: CsvSchemaSpec = makeSchema('BusinessProcesses', [
  ...BASE_ELEMENT_COLUMNS.map((c) =>
    c.name === 'elementType' ? { ...c, enumValues: ['BusinessProcess'], type: 'enum' as const } : c,
  ),

  { name: 'processOwner', type: 'string', requiredHeader: true, requiredCell: true },
  { name: 'triggeringEvent', type: 'string', requiredHeader: true, requiredCell: true },
  { name: 'expectedOutcome', type: 'string', requiredHeader: true, requiredCell: true },

  { name: 'frequency', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: PROCESS_FREQUENCY },
  { name: 'criticality', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: PROCESS_CRITICALITY },

  { name: 'regulatoryRelevant', type: 'boolean', requiredHeader: true, requiredCell: true },
  { name: 'complianceNotes', type: 'string', requiredHeader: true, requiredCell: true },

  { name: 'parentCapabilityId', type: 'uuid', requiredHeader: true, requiredCell: true },
]);

/**
 * Applications CSV schema.
 *
 * Strictness:
 * - `elementType` MUST be "Application" for every row.
 */
export const APPLICATIONS_CSV_SCHEMA: CsvSchemaSpec = makeSchema('Applications', [
  ...BASE_ELEMENT_COLUMNS.map((c) =>
    c.name === 'elementType' ? { ...c, enumValues: ['Application'], type: 'enum' as const } : c,
  ),

  { name: 'applicationCode', type: 'string', requiredHeader: true, requiredCell: true },
  { name: 'applicationType', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: APPLICATION_TYPE },

  {
    name: 'businessCriticality',
    type: 'enum',
    requiredHeader: true,
    requiredCell: true,
    enumValues: BUSINESS_CRITICALITY,
  },
  { name: 'availabilityTarget', type: 'number', requiredHeader: true, requiredCell: true },
  { name: 'deploymentModel', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: DEPLOYMENT_MODEL },

  { name: 'vendorLockInRisk', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: RISK_LEVEL },
  { name: 'technicalDebtLevel', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: RISK_LEVEL },

  { name: 'annualRunCost', type: 'number', requiredHeader: true, requiredCell: true },
  { name: 'vendorName', type: 'string', requiredHeader: true, requiredCell: true },
]);

/**
 * Technologies CSV schema.
 *
 * Strictness:
 * - `elementType` MUST be "Technology" for every row.
 */
export const TECHNOLOGIES_CSV_SCHEMA: CsvSchemaSpec = makeSchema('Technologies', [
  ...BASE_ELEMENT_COLUMNS.map((c) =>
    c.name === 'elementType' ? { ...c, enumValues: ['Technology'], type: 'enum' as const } : c,
  ),

  { name: 'technologyType', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: TECHNOLOGY_TYPE },
  {
    name: 'technologyCategory',
    type: 'enum',
    requiredHeader: true,
    requiredCell: true,
    enumValues: TECHNOLOGY_CATEGORY,
  },

  { name: 'vendor', type: 'string', requiredHeader: true, requiredCell: true },
  { name: 'version', type: 'string', requiredHeader: true, requiredCell: true },
  { name: 'supportEndDate', type: 'iso8601', requiredHeader: true, requiredCell: true },

  { name: 'obsolescenceRisk', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: RISK_LEVEL },
  { name: 'standardApproved', type: 'boolean', requiredHeader: true, requiredCell: true },
]);

/**
 * Programmes CSV schema.
 *
 * Strictness:
 * - `elementType` MUST be "Programme" for every row.
 */
export const PROGRAMMES_CSV_SCHEMA: CsvSchemaSpec = makeSchema('Programmes', [
  ...BASE_ELEMENT_COLUMNS.map((c) =>
    c.name === 'elementType' ? { ...c, enumValues: ['Programme'], type: 'enum' as const } : c,
  ),

  { name: 'programmeType', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: PROGRAMME_TYPE },
  { name: 'strategicObjective', type: 'string', requiredHeader: true, requiredCell: true },

  { name: 'startDate', type: 'iso8601', requiredHeader: true, requiredCell: true },
  { name: 'endDate', type: 'iso8601', requiredHeader: true, requiredCell: true },

  { name: 'budgetEstimate', type: 'number', requiredHeader: true, requiredCell: true },
  { name: 'fundingStatus', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: FUNDING_STATUS },

  { name: 'expectedBusinessImpact', type: 'string', requiredHeader: true, requiredCell: true },
  { name: 'riskLevel', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: RISK_LEVEL },
]);

/**
 * Relationships CSV schema.
 *
 * Contract:
 * - Single, deterministic schema covering all supported relationship types.
 * - Type-specific columns MUST exist in the header, but cells may be blank unless required by `relationshipType`.
 *
 * Strictness:
 * - `id` is explicit (no auto-generation).
 * - `relationshipType` MUST be one of the supported internal types.
 * - No inference (no implicit reverse edges, no endpoint guessing).
 */
export const RELATIONSHIPS_CSV_SCHEMA: CsvSchemaSpec = makeSchema('Relationships', [
  { name: 'id', type: 'uuid', requiredHeader: true, requiredCell: true },
  { name: 'relationshipType', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: RELATIONSHIP_TYPE },

  { name: 'sourceElementId', type: 'uuid', requiredHeader: true, requiredCell: true },
  { name: 'sourceElementType', type: 'string', requiredHeader: true, requiredCell: true },
  { name: 'targetElementId', type: 'uuid', requiredHeader: true, requiredCell: true },
  { name: 'targetElementType', type: 'string', requiredHeader: true, requiredCell: true },

  { name: 'direction', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: RELATIONSHIP_DIRECTION },

  { name: 'status', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: RELATIONSHIP_STATUS },
  { name: 'effectiveFrom', type: 'iso8601', requiredHeader: true, requiredCell: true },
  { name: 'effectiveTo', type: 'optional-iso8601', requiredHeader: false },

  { name: 'rationale', type: 'string', requiredHeader: true, requiredCell: true },
  { name: 'confidenceLevel', type: 'enum', requiredHeader: true, requiredCell: true, enumValues: CONFIDENCE_LEVEL },
  { name: 'lastReviewedAt', type: 'iso8601', requiredHeader: true, requiredCell: true },
  { name: 'reviewedBy', type: 'string', requiredHeader: true, requiredCell: true },

  { name: 'createdAt', type: 'iso8601', requiredHeader: true, requiredCell: true },
  { name: 'createdBy', type: 'string', requiredHeader: true, requiredCell: true },

  // Relationship-type specific columns (header required for deterministic schema)
  { name: 'dependencyType', type: 'enum', requiredHeader: true, enumValues: DEPENDENCY_TYPE },
  { name: 'dependencyStrength', type: 'enum', requiredHeader: true, enumValues: DEPENDENCY_STRENGTH },
  { name: 'runtimeCritical', type: 'boolean', requiredHeader: true },

  { name: 'hostingRole', type: 'enum', requiredHeader: true, enumValues: HOSTING_ROLE },
  { name: 'environment', type: 'enum', requiredHeader: true, enumValues: HOSTING_ENVIRONMENT },
  { name: 'resilienceLevel', type: 'enum', requiredHeader: true, enumValues: RESILIENCE_LEVEL },

  { name: 'automationLevel', type: 'enum', requiredHeader: true, enumValues: AUTOMATION_LEVEL },
  { name: 'automationCoveragePercent', type: 'optional-number', requiredHeader: false },

  { name: 'impactType', type: 'enum', requiredHeader: true, enumValues: IMPACT_TYPE },
  { name: 'expectedChangeMagnitude', type: 'enum', requiredHeader: true, enumValues: EXPECTED_CHANGE_MAGNITUDE },
]);

export const CSV_IMPORT_SPECS: Readonly<Record<CsvImportSourceEntity, CsvSchemaSpec>> = {
  Capabilities: CAPABILITIES_CSV_SCHEMA,
  BusinessProcesses: BUSINESS_PROCESSES_CSV_SCHEMA,
  Applications: APPLICATIONS_CSV_SCHEMA,
  Technologies: TECHNOLOGIES_CSV_SCHEMA,
  Programmes: PROGRAMMES_CSV_SCHEMA,
  Relationships: RELATIONSHIPS_CSV_SCHEMA,
} as const;
