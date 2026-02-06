/**
 * ExportScope (domain model).
 *
 * Purpose:
 * - Forces explicit export intent (no defaults are assumed).
 * - Drives deterministic, controlled exports across Repository / Views / Analysis / FullProject.
 */

export type ExportType = 'Repository' | 'View' | 'Analysis' | 'FullProject';

export type ExportScope = {
  exportType: ExportType;

  /** Explicit element types to include (e.g. ["Application", "Capability"]). */
  includedElementTypes: readonly string[];

  /** Explicit relationship types to include (e.g. ["DEPENDS_ON", "DEPLOYED_ON"]). */
  includedRelationshipTypes: readonly string[];

  /** Whether to include view definitions. */
  includeViews: boolean;

  /** Whether to include governance artifacts (rules, ADRs). */
  includeGovernanceArtifacts: boolean;
};
