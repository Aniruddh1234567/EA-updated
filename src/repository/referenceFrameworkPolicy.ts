import type { ObjectType } from '@/pages/dependency-view/utils/eaMetaModel';
import type { ReferenceFramework } from './repositoryMetadata';

export type FrameworkRelationshipPolicy = {
  /** Empty list means "no additional restriction". */
  allowedRelationshipTypes: readonly string[];
};

export type FrameworkObjectPolicy = {
  /** Empty list means "no additional restriction". */
  allowedObjectTypes: readonly ObjectType[];
};

export type FrameworkLifecyclePolicy = {
  /** Empty list means "no additional restriction". */
  allowedLifecycleStates: readonly string[];
};

export type FrameworkPhasePolicy = {
  /** Empty list means "no additional restriction". */
  allowedAdmPhases: readonly string[];
};

const ARCHIMATE_RELATIONSHIPS: readonly string[] = [
  // Structural / decomposition
  'DECOMPOSES_TO',
  'COMPOSED_OF',

  // Business process realization and flow
  'REALIZES',
  'REALIZED_BY',
  'TRIGGERS',
  'SERVED_BY',

  // Application-to-application dependency/integration (maps best-fit to ArchiMate Association)
  'INTEGRATES_WITH',
  'USES',

  // Application-service-to-application-service dependency (maps best-fit to ArchiMate Association)
  'CONSUMES',

  // Application service exposure
  'EXPOSES',
  'PROVIDED_BY',
  'USED_BY',

  // Application deployment traceability
  'DEPLOYED_ON',

  // Cross-layer enablement
  'SUPPORTED_BY',
  'SUPPORTS',

  // Implementation & migration (best-fit to ArchiMate Influence)
  'IMPACTS',
] as const;

// TOGAF core enablement (v1): capabilities, value streams, applications, technologies.
// Keep Enterprise allowed to avoid fighting existing "Business Unit" scope invariants.
const TOGAF_OBJECT_TYPES: readonly ObjectType[] = [
  'Enterprise',
  'CapabilityCategory',
  'Capability',
  'SubCapability',
  'ValueStream',
  'BusinessService',
  'BusinessProcess',
  'Department',
  'Application',
  'ApplicationService',
  'Interface',
  'Technology',
  'Node',
  'Server',
  'Compute',
  'VM',
  'Container',
  'Runtime',
  'Database',
  'Storage',
  'Network',
  'LoadBalancer',
  'API',
  'MessageBroker',
  'IntegrationPlatform',
  'CloudService',
] as const;

const TOGAF_ADM_PHASES: readonly string[] = [
  'Preliminary',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
] as const;

const DEFAULT_RELATIONSHIP_POLICY: FrameworkRelationshipPolicy = {
  allowedRelationshipTypes: [],
};

const DEFAULT_OBJECT_POLICY: FrameworkObjectPolicy = {
  allowedObjectTypes: [],
};

const DEFAULT_LIFECYCLE_POLICY: FrameworkLifecyclePolicy = {
  allowedLifecycleStates: [],
};

const DEFAULT_PHASE_POLICY: FrameworkPhasePolicy = {
  allowedAdmPhases: [],
};

export function getFrameworkRelationshipPolicy(
  referenceFramework: ReferenceFramework | null | undefined,
): FrameworkRelationshipPolicy {
  if (referenceFramework === 'ArchiMate') {
    return { allowedRelationshipTypes: ARCHIMATE_RELATIONSHIPS };
  }
  return DEFAULT_RELATIONSHIP_POLICY;
}

export function getFrameworkObjectPolicy(referenceFramework: ReferenceFramework | null | undefined): FrameworkObjectPolicy {
  if (referenceFramework === 'TOGAF') {
    return { allowedObjectTypes: TOGAF_OBJECT_TYPES };
  }
  return DEFAULT_OBJECT_POLICY;
}

export function getFrameworkLifecyclePolicy(
  referenceFramework: ReferenceFramework | null | undefined,
): FrameworkLifecyclePolicy {
  if (referenceFramework === 'TOGAF') {
    return { allowedLifecycleStates: ['Baseline', 'Target'] as const };
  }
  return DEFAULT_LIFECYCLE_POLICY;
}

export function getFrameworkPhasePolicy(referenceFramework: ReferenceFramework | null | undefined): FrameworkPhasePolicy {
  if (referenceFramework === 'TOGAF') {
    return { allowedAdmPhases: TOGAF_ADM_PHASES };
  }
  return DEFAULT_PHASE_POLICY;
}

export function isRelationshipTypeAllowedForReferenceFramework(
  referenceFramework: ReferenceFramework | null | undefined,
  relationshipType: string,
): boolean {
  const t = (relationshipType ?? '').trim();
  if (!t) return false;

  const policy = getFrameworkRelationshipPolicy(referenceFramework);
  if (policy.allowedRelationshipTypes.length === 0) return true;
  return policy.allowedRelationshipTypes.includes(t);
}

export function isObjectTypeAllowedForReferenceFramework(
  referenceFramework: ReferenceFramework | null | undefined,
  objectType: ObjectType,
): boolean {
  const policy = getFrameworkObjectPolicy(referenceFramework);
  if (policy.allowedObjectTypes.length === 0) return true;
  return policy.allowedObjectTypes.includes(objectType);
}

export function isLifecycleStateAllowedForReferenceFramework(
  referenceFramework: ReferenceFramework | null | undefined,
  lifecycleState: string,
): boolean {
  const s = (lifecycleState ?? '').trim();
  if (!s) return false;
  const policy = getFrameworkLifecyclePolicy(referenceFramework);
  if (policy.allowedLifecycleStates.length === 0) return true;
  return policy.allowedLifecycleStates.includes(s);
}

export function isAdmPhaseAllowedForReferenceFramework(
  referenceFramework: ReferenceFramework | null | undefined,
  admPhase: string,
): boolean {
  const s = (admPhase ?? '').trim();
  if (!s) return false;
  const policy = getFrameworkPhasePolicy(referenceFramework);
  if (policy.allowedAdmPhases.length === 0) return true;
  return policy.allowedAdmPhases.includes(s);
}
