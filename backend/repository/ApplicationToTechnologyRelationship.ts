import type { BaseArchitectureRelationship } from './BaseArchitectureRelationship';

export type HostingRole = 'Primary' | 'Secondary' | 'DR';

export type HostingEnvironment = 'Prod' | 'Non-Prod';

export type ResilienceLevel = 'High' | 'Medium' | 'Low';

/**
 * Application → Technology deployment relationship.
 *
 * Semantics:
 * - Typed, directional, auditable relationship for application-to-infrastructure traceability.
 * - Multiple technologies per application are allowed.
 * - No network topology is modeled.
 * - No deployment scripts or execution semantics are implied.
 */
export type ApplicationToTechnologyRelationship = BaseArchitectureRelationship & {
  relationshipType: 'DEPLOYED_ON';

  sourceElementType: 'Application';
  targetElementType: 'Technology';

  direction: 'OUTGOING';

  hostingRole: HostingRole;
  environment: HostingEnvironment;
  resilienceLevel: ResilienceLevel;
};
