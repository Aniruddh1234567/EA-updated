export type ArchitectureScope = 'Enterprise' | 'Business Unit' | 'Domain' | 'Programme';
export type ReferenceFramework = 'Custom';
export type GovernanceMode = 'Strict' | 'Advisory';
export type LifecycleCoverage = 'As-Is' | 'To-Be' | 'Both';
export type TimeHorizon = 'Current' | '1–3 years' | 'Strategic';

export type RepositoryOwner = {
  /** Stable user identity (prefer user ID over display name). */
  userId: string;
  /** Optional friendly name for display purposes. */
  displayName?: string;
};

export type FrameworkConfig = {
  custom?: {
    enabledObjectTypes?: unknown;
    enabledRelationshipTypes?: unknown;
  };
};

export type EaRepositoryMetadata = {
  /** Immutable repository identifier (EA workspace identity). */
  repositoryName: string;
  organizationName: string;
  industry?: string;
  architectureScope: ArchitectureScope;
  referenceFramework: ReferenceFramework;
  /** Optional: enable multiple frameworks at once (union of allowed types). */
  enabledFrameworks?: ReferenceFramework[];
  governanceMode: GovernanceMode;
  lifecycleCoverage: LifecycleCoverage;
  timeHorizon: TimeHorizon;

  /** Repository-scoped access control: the user who owns this repository. */
  owner: RepositoryOwner;

  /** Framework-specific configuration (e.g. Custom meta-model enablement). */
  frameworkConfig?: FrameworkConfig;

  createdAt: string;
};

export const ARCHITECTURE_SCOPES: ArchitectureScope[] = [
  'Enterprise',
  'Business Unit',
  'Domain',
  'Programme',
];

export const REFERENCE_FRAMEWORKS: ReferenceFramework[] = ['Custom'];

export const GOVERNANCE_MODES: GovernanceMode[] = ['Strict', 'Advisory'];

export const LIFECYCLE_COVERAGE_OPTIONS: LifecycleCoverage[] = ['As-Is', 'To-Be', 'Both'];

export const TIME_HORIZONS: TimeHorizon[] = ['Current', '1–3 years', 'Strategic'];

export const validateRepositoryMetadata = (
  value: unknown,
): { ok: true; metadata: EaRepositoryMetadata } | { ok: false; error: string } => {
  const v = value as any;

  const repositoryName = typeof v?.repositoryName === 'string' ? v.repositoryName.trim() : '';
  if (!repositoryName) return { ok: false, error: 'Repository Name is required.' };

  const organizationName = typeof v?.organizationName === 'string' ? v.organizationName.trim() : '';
  if (!organizationName) return { ok: false, error: 'Organization Name is required.' };

  const industry = typeof v?.industry === 'string' ? v.industry.trim() : '';

  const architectureScope = v?.architectureScope as ArchitectureScope;
  if (!ARCHITECTURE_SCOPES.includes(architectureScope)) {
    return { ok: false, error: 'Architecture Scope is required.' };
  }

  const referenceFramework = v?.referenceFramework as ReferenceFramework;
  if (!REFERENCE_FRAMEWORKS.includes(referenceFramework)) {
    return { ok: false, error: 'Reference Framework is required.' };
  }

  const enabledFrameworksRaw = Array.isArray(v?.enabledFrameworks) ? (v.enabledFrameworks as unknown[]) : [];
  const enabledFrameworks = enabledFrameworksRaw
    .map((f) => String(f) as ReferenceFramework)
    .filter((f) => REFERENCE_FRAMEWORKS.includes(f));

  const governanceMode = v?.governanceMode as GovernanceMode;
  if (!GOVERNANCE_MODES.includes(governanceMode)) {
    return { ok: false, error: 'Governance Mode is required.' };
  }

  const lifecycleCoverage = v?.lifecycleCoverage as LifecycleCoverage;
  if (!LIFECYCLE_COVERAGE_OPTIONS.includes(lifecycleCoverage)) {
    return { ok: false, error: 'Lifecycle Coverage is required.' };
  }

  const timeHorizon = v?.timeHorizon as TimeHorizon;
  if (!TIME_HORIZONS.includes(timeHorizon)) {
    return { ok: false, error: 'Time Horizon is required.' };
  }

  const ownerUserId = typeof v?.owner?.userId === 'string' ? v.owner.userId.trim() : '';
  const ownerDisplayName = typeof v?.owner?.displayName === 'string' ? v.owner.displayName.trim() : '';
  if (!ownerUserId) {
    return { ok: false, error: 'Owner assignment is required.' };
  }

  const createdAt = typeof v?.createdAt === 'string' && v.createdAt.trim() ? v.createdAt : new Date().toISOString();

  const frameworkConfig = (v?.frameworkConfig && typeof v.frameworkConfig === 'object') ? (v.frameworkConfig as FrameworkConfig) : undefined;

  return {
    ok: true,
    metadata: {
      repositoryName,
      organizationName,
      industry: industry || undefined,
      architectureScope,
      referenceFramework,
      enabledFrameworks: enabledFrameworks.length > 0 ? enabledFrameworks : undefined,
      governanceMode,
      lifecycleCoverage,
      timeHorizon,
      owner: { userId: ownerUserId, displayName: ownerDisplayName || undefined },
      frameworkConfig,
      createdAt,
    },
  };
};
