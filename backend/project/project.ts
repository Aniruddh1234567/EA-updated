export type BaselineType = 'Current State' | 'Target State' | 'Transition';

export type ProjectStatus = 'Draft' | 'Active' | 'Archived';

export type GovernanceEnforcementMode = 'Advisory' | 'Guided' | 'Enforced';

export type ProjectConfig = {
  /** Governance enforcement mode (config-only for now; do not block actions yet). */
  governanceEnforcementMode: GovernanceEnforcementMode;
};

export type ArchitectureLayersInScope = {
  business: boolean;
  application: boolean;
  technology: boolean;
  implementationMigration: boolean;
  governance: boolean;
};

/**
 * Enterprise Architecture Project (pure domain definition).
 */
export type Project = {
  // Identity & governance
  readonly id: string;
  /** Official project name */
  name: string;
  /** Short identifier, e.g. TATA-EA */
  shortCode: string;
  /** Purpose and intent */
  description: string;

  // Scope definition
  /** Organization name, e.g. Tata Group */
  organizationName: string;
  businessUnitsInScope: string[];
  /** Geography scope, e.g. Global, India, APAC */
  geographyInScope: string;
  architectureLayersInScope: ArchitectureLayersInScope;

  // Configuration
  config: ProjectConfig;

  // Temporal context
  baselineType: BaselineType;
  /** ISO-8601 date (or timestamp) */
  baselineStartDate: string;
  /** ISO-8601 date (or timestamp) */
  baselineEndDate?: string;

  // Ownership & accountability
  chiefArchitect: string;
  owningDepartment: string;
  contactEmail: string;

  // Administrative
  /** ISO-8601 timestamp */
  createdAt: string;
  createdBy: string;
  status: ProjectStatus;
};
