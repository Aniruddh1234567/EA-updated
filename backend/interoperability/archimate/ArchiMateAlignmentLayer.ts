export type ArchiMate3Version = '3.0' | '3.1' | '3.2' | '3.3';

export type ArchiMateLayer =
  | 'Strategy'
  | 'Business'
  | 'Application'
  | 'Technology'
  | 'ImplementationAndMigration'
  | 'Motivation'
  | 'Physical'
  | 'Other';

export type AlignmentStatus = 'Supported' | 'Unsupported' | 'Ambiguous';

export type ArchiMateElementConceptId =
  | 'Capability'
  | 'BusinessProcess'
  | 'ApplicationComponent'
  | 'Node'
  | 'WorkPackage';

export type ArchiMateRelationshipConceptId =
  | 'Composition'
  | 'Aggregation'
  | 'Assignment'
  | 'Realization'
  | 'Serving'
  | 'Influence'
  | 'Association';

export type ArchiMateElementConcept = {
  id: ArchiMateElementConceptId;
  name: string;
  layer: ArchiMateLayer;
};

export type ArchiMateRelationshipConcept = {
  id: ArchiMateRelationshipConceptId;
  name: string;
};

export type ElementAlignment = {
  version: ArchiMate3Version;
  internalElementType: string;

  status: AlignmentStatus;

  /** Present only when status === Supported. */
  concept?: ArchiMateElementConcept;

  /** Present when status !== Supported (or to add rationale). */
  reason?: string;

  /** Optional notes (e.g., where semantics do not perfectly match). */
  notes?: string;
};

export type RelationshipDirectionAlignment =
  | 'SameDirection'
  | 'InvertedDirection'
  | 'NotApplicable';

export type RelationshipAlignment = {
  version: ArchiMate3Version;
  internalRelationshipType: string;

  status: AlignmentStatus;

  /** Present only when status === Supported. */
  concept?: ArchiMateRelationshipConcept;

  /** Whether the internal relationship direction matches the usual ArchiMate reading. */
  direction?: RelationshipDirectionAlignment;

  /** Present when status !== Supported (or to add rationale). */
  reason?: string;

  /** Optional notes (e.g., generic internal relationship needs refinement to be fully ArchiMate-specific). */
  notes?: string;
};

export type ArchiMateAlignmentLayer = {
  version: ArchiMate3Version;

  mapElementType: (internalElementType: string) => ElementAlignment;
  mapRelationshipType: (internalRelationshipType: string) => RelationshipAlignment;

  /**
   * Convenience helper for bulk alignment reports.
   * Determinism: sorts by internal type name.
   */
  alignTypes: (input: {
    elementTypes?: readonly string[];
    relationshipTypes?: readonly string[];
  }) => {
    elements: ElementAlignment[];
    relationships: RelationshipAlignment[];
    summary: {
      supportedElements: number;
      unsupportedElements: number;
      supportedRelationships: number;
      unsupportedRelationships: number;
    };
  };
};

export const ARCHIMATE_3_LATEST: ArchiMate3Version = '3.3';

// NOTE: This is an alignment table, not enforcement. Concepts are best-fit mappings.
const ELEMENT_CONCEPTS_3X: Readonly<Record<string, ArchiMateElementConcept>> = {
  Capability: { id: 'Capability', name: 'Capability', layer: 'Strategy' },
  BusinessProcess: { id: 'BusinessProcess', name: 'Business Process', layer: 'Business' },
  Application: { id: 'ApplicationComponent', name: 'Application Component', layer: 'Application' },
  Technology: { id: 'Node', name: 'Node', layer: 'Technology' },
  Programme: { id: 'WorkPackage', name: 'Work Package', layer: 'ImplementationAndMigration' },
} as const;

const RELATIONSHIP_CONCEPTS_3X: Readonly<Record<string, RelationshipAlignment>> = {
  // Internal: Capability -> BusinessProcess (decomposition/traceability)
  DECOMPOSES_TO: {
    version: ARCHIMATE_3_LATEST,
    internalRelationshipType: 'DECOMPOSES_TO',
    status: 'Supported',
    concept: { id: 'Composition', name: 'Composition' },
    direction: 'SameDirection',
    notes:
      'Best-fit: expresses structural decomposition. If you intend “process realizes capability”, consider Realization (direction may invert).',
  },

  // Internal: CapabilityCategory/Capability/SubCapability -> (same family)
  COMPOSED_OF: {
    version: ARCHIMATE_3_LATEST,
    internalRelationshipType: 'COMPOSED_OF',
    status: 'Supported',
    concept: { id: 'Composition', name: 'Composition' },
    direction: 'SameDirection',
    notes:
      'Preferred internal semantic for capability hierarchy/composition. Exported as Composition (best-fit) in ArchiMate alignment.',
  },

  // Internal: Capability -> BusinessProcess
  REALIZED_BY: {
    version: ARCHIMATE_3_LATEST,
    internalRelationshipType: 'REALIZED_BY',
    status: 'Supported',
    concept: { id: 'Serving', name: 'Serving' },
    direction: 'SameDirection',
    notes:
      'Best-fit: a Capability is realized by a Business Process. Keep Application realization as REALIZES for process-to-application traceability.',
  },

  // Internal: Application -> Application
  INTEGRATES_WITH: {
    version: ARCHIMATE_3_LATEST,
    internalRelationshipType: 'INTEGRATES_WITH',
    status: 'Supported',
    concept: { id: 'Association', name: 'Association' },
    direction: 'NotApplicable',
    notes:
      'Preferred internal semantic for application-to-application integration. Exported as a broad ArchiMate Association (loss of specificity).',
  },

  // Internal: ApplicationService -> ApplicationService
  CONSUMES: {
    version: ARCHIMATE_3_LATEST,
    internalRelationshipType: 'CONSUMES',
    status: 'Supported',
    concept: { id: 'Association', name: 'Association' },
    direction: 'SameDirection',
    notes:
      'Preferred internal semantic for service-to-service consumption. Exported as a broad ArchiMate Association (loss of specificity).',
  },

  // Legacy internal: Application -> Application
  DEPENDS_ON: {
    version: ARCHIMATE_3_LATEST,
    internalRelationshipType: 'DEPENDS_ON',
    status: 'Supported',
    concept: { id: 'Association', name: 'Association' },
    direction: 'NotApplicable',
    notes:
      'Generic dependency is broader than ArchiMate-specific relations (e.g., Flow/Serving/Access). Association is used as a lossless alignment placeholder.',
  },

  // Internal: Application -> Technology
  DEPLOYED_ON: {
    version: ARCHIMATE_3_LATEST,
    internalRelationshipType: 'DEPLOYED_ON',
    status: 'Supported',
    concept: { id: 'Assignment', name: 'Assignment' },
    direction: 'SameDirection',
    notes: 'Best-fit for deployment/hosting traceability (application deployed on node).',
  },

  // Internal: Programme -> (Capability|Application|Technology)
  IMPACTS: {
    version: ARCHIMATE_3_LATEST,
    internalRelationshipType: 'IMPACTS',
    status: 'Supported',
    concept: { id: 'Influence', name: 'Influence' },
    direction: 'SameDirection',
    notes: 'Best-fit: represents influence/impact from a work package to target elements.',
  },
} as const;

const normalize = (s: string) => (s ?? '').trim();

const makeUnsupportedElement = (
  version: ArchiMate3Version,
  internalElementType: string,
  reason: string,
): ElementAlignment => ({
  version,
  internalElementType,
  status: 'Unsupported',
  reason,
});

const makeUnsupportedRelationship = (
  version: ArchiMate3Version,
  internalRelationshipType: string,
  reason: string,
): RelationshipAlignment => ({
  version,
  internalRelationshipType,
  status: 'Unsupported',
  reason,
});

/**
 * Create an ArchiMate alignment layer (version-aware).
 *
 * Alignment rules:
 * - Returns Supported mappings for known internal types.
 * - Returns Unsupported for unknown types; never drops or mutates the internal model.
 */
export function createArchiMateAlignmentLayer(
  version: ArchiMate3Version = ARCHIMATE_3_LATEST,
): ArchiMateAlignmentLayer {
  const mapElementType = (internalElementType: string): ElementAlignment => {
    const key = normalize(internalElementType);
    const concept = ELEMENT_CONCEPTS_3X[key];
    if (concept) {
      return {
        version,
        internalElementType: key,
        status: 'Supported',
        concept,
      };
    }

    return makeUnsupportedElement(version, key, 'No ArchiMate 3.x concept mapping is defined for this internal elementType.');
  };

  const mapRelationshipType = (internalRelationshipType: string): RelationshipAlignment => {
    const key = normalize(internalRelationshipType);
    const known = RELATIONSHIP_CONCEPTS_3X[key];
    if (known) {
      // Override version field while keeping mapping details.
      return { ...known, version };
    }

    return makeUnsupportedRelationship(
      version,
      key,
      'No ArchiMate 3.x relationship mapping is defined for this internal relationshipType.',
    );
  };

  const alignTypes: ArchiMateAlignmentLayer['alignTypes'] = (input) => {
    const elements = (input.elementTypes ?? [])
      .map((t) => mapElementType(t))
      .sort((a, b) => a.internalElementType.localeCompare(b.internalElementType));

    const relationships = (input.relationshipTypes ?? [])
      .map((t) => mapRelationshipType(t))
      .sort((a, b) => a.internalRelationshipType.localeCompare(b.internalRelationshipType));

    const supportedElements = elements.filter((e) => e.status === 'Supported').length;
    const unsupportedElements = elements.filter((e) => e.status !== 'Supported').length;

    const supportedRelationships = relationships.filter((r) => r.status === 'Supported').length;
    const unsupportedRelationships = relationships.filter((r) => r.status !== 'Supported').length;

    return {
      elements,
      relationships,
      summary: {
        supportedElements,
        unsupportedElements,
        supportedRelationships,
        unsupportedRelationships,
      },
    };
  };

  return {
    version,
    mapElementType,
    mapRelationshipType,
    alignTypes,
  };
}

/**
 * Convenience default instance.
 *
 * Keep in mind this is alignment-only; it should not be used to enforce semantics.
 */
export const ARCHIMATE_ALIGNMENT_3X: ArchiMateAlignmentLayer = createArchiMateAlignmentLayer(ARCHIMATE_3_LATEST);
