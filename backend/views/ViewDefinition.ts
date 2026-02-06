export type ViewType =
  | 'ApplicationDependency'
  | 'CapabilityMap'
  | 'ApplicationLandscape'
  | 'TechnologyLandscape'
  | 'ImpactView';

export type ArchitectureLayer =
  | 'Business'
  | 'Application'
  | 'Technology'
  | 'Implementation & Migration'
  | 'Governance'
  | 'CrossLayer';

export type LayoutType = 'Force' | 'Layered' | 'Hierarchical' | 'Grid';

export type Orientation = 'LeftToRight' | 'TopDown';

export type ViewScopeType =
  | 'ENTIRE_REPOSITORY'
  | 'SELECTED_ENTERPRISES'
  | 'SELECTED_CAPABILITIES'
  | 'SELECTED_APPLICATIONS';

export type ViewApprovalStatus = 'Draft' | 'Approved';

/**
 * Declarative definition of a saved architectural view.
 *
 * Principles:
 * - Diagrams are not sources of truth.
 * - A view is a controlled projection over Repository + Relationships.
 * - No node positions, no element payloads, no rendering logic.
 * - All date/time fields are ISO-8601 strings.
 * - `id` is expected to be a UUID and is immutable.
 */
export type ViewDefinition = {
  // Identity
  readonly id: string;
  /** Architect-defined, meaningful name */
  name: string;
  /** Intent of the view (why it exists, what question it answers) */
  description: string;

  // Classification
  viewType: ViewType;
  architectureLayer: ArchitectureLayer;

  // Scope (optional)
  rootElementId?: string;
  rootElementType?: string;
  /** Maximum relationship hops from the root (when a root is defined) */
  maxDepth?: number;
  /** Diagram scope model for filtering projected content */
  scopeType: ViewScopeType;
  /** Relevant when scopeType is a SELECTED_* variant */
  scopeIds: readonly string[];

  // Content rules
  allowedElementTypes: readonly string[];
  allowedRelationshipTypes: readonly string[];

  // Layout (hints only)
  layoutType: LayoutType;
  orientation: Orientation;

  // Governance
  createdBy: string;
  /** ISO-8601 timestamp */
  createdAt: string;
  /** ISO-8601 timestamp */
  lastModifiedAt: string;
  approvalStatus: ViewApprovalStatus;
};
