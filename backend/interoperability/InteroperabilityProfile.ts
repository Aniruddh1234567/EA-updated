/**
 * InteroperabilityProfile (domain model).
 *
 * Purpose:
 * - Honest tool-to-tool exchange: declares what a target tool can accept/export.
 * - Makes limitations and constraints explicit; no auto-detection.
 */

export type InteroperabilityProfileId =
  | 'profile.generic-ea-tool'
  | 'profile.archimate-tool'
  | 'profile.custom-csv-consumer';

export type ExportConstraintSeverity = 'Info' | 'Warning' | 'Error';

export type ExportConstraint = {
  id: string;
  severity: ExportConstraintSeverity;
  description: string;

  /** Optional: which exportTypes this constraint applies to. */
  appliesToExportTypes?: readonly ('Repository' | 'View' | 'Analysis' | 'FullProject')[];
};

export type InteroperabilityProfile = {
  profileId: InteroperabilityProfileId;
  name: string;
  description: string;

  supportedElementTypes: readonly string[];
  supportedRelationshipTypes: readonly string[];

  /** Constraints that must be considered when exporting to this profile. */
  exportConstraints: readonly ExportConstraint[];

  /**
   * Known limitations and loss risks.
   *
   * Rule: never hide limitations; if there is a known loss mode, list it here.
   */
  knownLimitations: readonly string[];
};

const normalizeList = (values: readonly string[]) =>
  Array.from(
    new Set(
      (values ?? [])
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter((v) => v.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));

const normalizeConstraints = (constraints: readonly ExportConstraint[]) =>
  constraints
    .slice()
    .sort(
      (a, b) =>
        a.severity.localeCompare(b.severity) ||
        a.id.localeCompare(b.id) ||
        a.description.localeCompare(b.description),
    );

/**
 * Predefined interoperability profiles.
 *
 * Note: these are intentionally conservative defaults. Projects can define their own profiles.
 */
export const INTEROPERABILITY_PROFILES: readonly InteroperabilityProfile[] = [
  {
    profileId: 'profile.generic-ea-tool',
    name: 'Generic EA Tool',
    description:
      'Broad, tool-agnostic enterprise architecture exchange. Assumes generic type systems and conservative relationship support.',

    supportedElementTypes: normalizeList([
      'Capability',
      'BusinessProcess',
      'Application',
      'Technology',
      'Programme',
    ]),

    supportedRelationshipTypes: normalizeList([
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
      'CONSUMES',
      'DEPLOYED_ON',
      'IMPACTS',
    ]),

    exportConstraints: normalizeConstraints([
      {
        id: 'explicit-ids-required',
        severity: 'Error',
        description: 'All elements and relationships must have explicit stable IDs.',
      },
      {
        id: 'typed-relationships-required',
        severity: 'Error',
        description: 'Relationship endpoints must carry explicit element types (sourceElementType/targetElementType).',
      },
    ]),

    knownLimitations: normalizeList([
      'Views may not be supported or may be imported as metadata only.',
      'Some tools may collapse relationship subtypes (e.g., dependency variants) into a generic association.',
    ]),
  },

  {
    profileId: 'profile.archimate-tool',
    name: 'ArchiMate Tool',
    description:
      'Interoperability profile for ArchiMate 3.x-centric tools. Uses best-fit alignment mappings without enforcing ArchiMate semantics internally.',

    supportedElementTypes: normalizeList([
      // Internal types that have a known ArchiMate alignment mapping.
      'Capability',
      'BusinessProcess',
      'Application',
      'Technology',
      'Programme',
    ]),

    supportedRelationshipTypes: normalizeList([
      'DECOMPOSES_TO',
      'COMPOSED_OF',
      'REALIZED_BY',
      'INTEGRATES_WITH',
      'CONSUMES',
      'DEPLOYED_ON',
      'IMPACTS',
    ]),

    exportConstraints: normalizeConstraints([
      {
        id: 'archimate-alignment-required',
        severity: 'Warning',
        description:
          'Export should include ArchiMate alignment annotations; unmapped types must be explicitly flagged (do not drop).',
      },
      {
        id: 'generic-dependency-limited',
        severity: 'Warning',
        description:
          'Generic dependency/integration (INTEGRATES_WITH / CONSUMES) may need to be exported as a broad ArchiMate Association (loss of specificity).',
      },
    ]),

    knownLimitations: normalizeList([
      'Not every internal relationship has a 1:1 ArchiMate semantic equivalent; alignment may be approximate.',
      'If the target tool enforces ArchiMate viewpoint rules, some elements/relations may be rejected unless modeled more specifically.',
    ]),
  },

  {
    profileId: 'profile.custom-csv-consumer',
    name: 'Custom CSV Consumer',
    description:
      'A downstream consumer that expects strict CSV schemas (deterministic headers/ordering) but may only support a subset of fields.',

    supportedElementTypes: normalizeList([
      'Capability',
      'BusinessProcess',
      'Application',
      'Technology',
      'Programme',
    ]),

    supportedRelationshipTypes: normalizeList([
      'DECOMPOSES_TO',
      'COMPOSED_OF',
      'REALIZED_BY',
      'INTEGRATES_WITH',
      'CONSUMES',
      'DEPLOYED_ON',
      'IMPACTS',
    ]),

    exportConstraints: normalizeConstraints([
      {
        id: 'csv-schema-v1',
        severity: 'Error',
        description: 'CSV must conform to csv-import/1 schemas with case-sensitive headers and deterministic column order.',
      },
      {
        id: 'no-missing-required-cells',
        severity: 'Error',
        description: 'Required cells must be populated; blank required fields are not allowed.',
      },
    ]),

    knownLimitations: normalizeList([
      'Custom consumers often ignore unknown optional columns; ensure loss is tracked via ImportMappingResolver when re-importing.',
      'Some consumers may not preserve ISO-8601 timestamps exactly (timezone/precision issues).',
    ]),
  },
] as const;

export const INTEROPERABILITY_PROFILE_BY_ID: Readonly<Record<InteroperabilityProfileId, InteroperabilityProfile>> =
  INTEROPERABILITY_PROFILES.reduce(
    (acc, p) => {
      acc[p.profileId] = p;
      return acc;
    },
    {} as Record<InteroperabilityProfileId, InteroperabilityProfile>,
  );

export function getInteroperabilityProfile(profileId: InteroperabilityProfileId): InteroperabilityProfile {
  return INTEROPERABILITY_PROFILE_BY_ID[profileId];
}
