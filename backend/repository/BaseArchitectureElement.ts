export type ArchitectureLayer = 'Business' | 'Application' | 'Technology' | 'Implementation & Migration' | 'Governance';

export type LifecycleStatus = 'Planned' | 'Active' | 'Deprecated' | 'Retired';

export type ApprovalStatus = 'Draft' | 'Approved' | 'Rejected';

/**
 * Universal base model for all Enterprise Architecture elements.
 *
 * Notes:
 * - All date/time fields are ISO-8601 strings.
 * - `id` is expected to be a UUID and is immutable.
 */
export type BaseArchitectureElement = {
  // Identity
  readonly id: string;
  /** Official, business-approved name */
  name: string;
  /** Detailed purpose */
  description: string;

  // Classification
  /** Domain element classification (e.g. Capability, Application, Technology, etc.) */
  elementType: string;
  layer: ArchitectureLayer;

  // Lifecycle
  lifecycleStatus: LifecycleStatus;
  /** ISO-8601 date (or timestamp) */
  lifecycleStartDate: string;
  /** ISO-8601 date (or timestamp) */
  lifecycleEndDate?: string;

  // Ownership
  /** e.g. Business Owner, IT Owner */
  ownerRole: string;
  ownerName: string;
  owningUnit: string;

  // Governance
  approvalStatus: ApprovalStatus;
  /** ISO-8601 timestamp */
  lastReviewedAt: string;
  reviewCycleMonths: number;

  // Administrative
  /** ISO-8601 timestamp */
  createdAt: string;
  createdBy: string;
  /** ISO-8601 timestamp */
  lastModifiedAt: string;
  lastModifiedBy: string;
};
