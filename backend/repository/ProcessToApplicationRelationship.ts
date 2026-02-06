import type { BaseArchitectureRelationship } from './BaseArchitectureRelationship';

export type AutomationLevel = 'Manual' | 'Assisted' | 'Automated';

/**
 * BusinessProcess → Application served-by relationship.
 *
 * Semantics:
 * - Typed, directional linkage from a business process to the application that serves it.
 * - Does not imply ownership, dependency, or automation execution semantics.
 * - No reverse edges are implied or auto-created.
 */
export type ProcessToApplicationRelationship = BaseArchitectureRelationship & {
  relationshipType: 'SERVED_BY';

  sourceElementType: 'BusinessProcess';
  targetElementType: 'Application';

  direction: 'OUTGOING';

  /** How automated the process is by the target application. */
  automationLevel: AutomationLevel;

  /** Optional estimate (0-100) of process steps covered by the application. */
  automationCoveragePercent?: number;
};
