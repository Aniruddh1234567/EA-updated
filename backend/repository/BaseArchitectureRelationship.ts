export type RelationshipDirection = 'OUTGOING';

export type RelationshipStatus = 'Draft' | 'Approved' | 'Deprecated';

export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

/**
 * Universal base model for all Enterprise Architecture relationships.
 *
 * Governance rules (v1):
 * - Relationships are explicit, typed, directional, auditable, and traceable.
 * - Direction is always OUTGOING (source 8 target). No bidirectional semantics are assumed.
 * - All date/time fields are ISO-8601 strings.
 * - `id` is expected to be a UUID and is immutable.
 */
export type BaseArchitectureRelationship = {
  // Identity
  readonly id: string;
  /** Relationship classification (e.g. REALIZES, DEPENDS_ON, DEPLOYED_ON) */
  relationshipType: string;

  // Endpoints
  sourceElementId: string;
  sourceElementType: string;
  targetElementId: string;
  targetElementType: string;

  // Directionality
  direction: RelationshipDirection;

  // Lifecycle
  status: RelationshipStatus;
  /** ISO-8601 date (or timestamp) */
  effectiveFrom: string;
  /** ISO-8601 date (or timestamp) */
  effectiveTo?: string;

  // Governance
  /** Why this relationship exists (decision rationale, evidence, constraints) */
  rationale: string;
  confidenceLevel: ConfidenceLevel;
  /** ISO-8601 timestamp */
  lastReviewedAt: string;
  reviewedBy: string;

  // Administrative
  /** ISO-8601 timestamp */
  createdAt: string;
  createdBy: string;
};
