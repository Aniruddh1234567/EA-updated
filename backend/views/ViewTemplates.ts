import type { ViewApprovalStatus, ViewDefinition, ViewType } from './ViewDefinition';
import { getRelationshipEndpointRule } from '../relationships/RelationshipSemantics';

export type ViewTemplateId =
  | 'template.application-dependency'
  | 'template.capability-map'
  | 'template.application-landscape'
  | 'template.technology-landscape'
  | 'template.capability-to-application'
  | 'template.application-to-technology'
  | 'template.end-to-end-traceability';

export type ViewTemplate = {
  id: ViewTemplateId;
  name: string;
  description: string;

  viewType: ViewType;
  architectureLayer: ViewDefinition['architectureLayer'];

  // Scope defaults (optional)
  rootElementId?: string;
  rootElementType?: string;

  // Content rules
  allowedElementTypes: readonly string[];
  allowedRelationshipTypes: readonly string[];

  // Layout hints
  layoutType: ViewDefinition['layoutType'];
  orientation: ViewDefinition['orientation'];

  // Template-specific configuration
  maxDepthConfig?: { configurable: true; defaultValue?: number };
};

/**
 * Standard enterprise view templates (read-only).
 *
 * Templates are NOT sources of truth; they are governed defaults that can be instantiated into ViewDefinitions.
 */
export const STANDARD_VIEW_TEMPLATES: readonly ViewTemplate[] = [
  {
    id: 'template.application-dependency',
    name: 'Application Dependency View',
    description: 'Directed application dependencies for impact analysis and governance.',
    viewType: 'ApplicationDependency',
    architectureLayer: 'Application',
    allowedElementTypes: ['Application'],
    allowedRelationshipTypes: ['INTEGRATES_WITH'],
    layoutType: 'Hierarchical',
    orientation: 'LeftToRight',
    maxDepthConfig: { configurable: true, defaultValue: 2 },
  },
  {
    id: 'template.capability-map',
    name: 'Capability Map',
    description: 'Business capability decomposition and traceability to processes (optionally to applications).',
    viewType: 'CapabilityMap',
    architectureLayer: 'Business',
    allowedElementTypes: ['Capability', 'BusinessProcess'],
    allowedRelationshipTypes: ['DECOMPOSES_TO', 'COMPOSED_OF', 'REALIZED_BY'],
    layoutType: 'Hierarchical',
    orientation: 'TopDown',
  },
  {
    id: 'template.application-landscape',
    name: 'Application Landscape',
    description: 'Inventory-style application landscape (no relationships by default).',
    viewType: 'ApplicationLandscape',
    architectureLayer: 'Application',
    allowedElementTypes: ['Application'],
    allowedRelationshipTypes: [],
    layoutType: 'Grid',
    orientation: 'LeftToRight',
  },
  {
    id: 'template.technology-landscape',
    name: 'Technology Landscape',
    description: 'Inventory-style technology landscape (no relationships by default).',
    viewType: 'TechnologyLandscape',
    architectureLayer: 'Technology',
    allowedElementTypes: ['Technology'],
    allowedRelationshipTypes: [],
    layoutType: 'Layered',
    orientation: 'TopDown',
  },
  {
    id: 'template.application-to-technology',
    name: 'Application → Technology Traceability',
    description: 'Cross-layer traceability from applications to the technologies they are deployed on.',
    viewType: 'ImpactView',
    architectureLayer: 'CrossLayer',
    allowedElementTypes: ['Application', 'Technology'],
    allowedRelationshipTypes: ['DEPLOYED_ON'],
    layoutType: 'Layered',
    orientation: 'LeftToRight',
    maxDepthConfig: { configurable: true, defaultValue: 2 },
  },
  {
    id: 'template.capability-to-application',
    name: 'Capability → Application Traceability',
    description:
      'Cross-layer traceability from capabilities to applications (via business processes where applicable).',
    viewType: 'ImpactView',
    architectureLayer: 'CrossLayer',
    allowedElementTypes: ['Capability', 'BusinessProcess', 'Application'],
    allowedRelationshipTypes: ['DECOMPOSES_TO', 'COMPOSED_OF', 'REALIZED_BY', 'SERVED_BY'],
    layoutType: 'Hierarchical',
    orientation: 'TopDown',
    maxDepthConfig: { configurable: true, defaultValue: 2 },
  },
  {
    id: 'template.end-to-end-traceability',
    name: 'End-to-End Traceability (Capability → Application → Technology)',
    description:
      'End-to-end traceability across business, application, and technology layers, including programme impacts when available.',
    viewType: 'ImpactView',
    architectureLayer: 'CrossLayer',
    allowedElementTypes: ['Programme', 'Capability', 'BusinessProcess', 'Application', 'Technology'],
    allowedRelationshipTypes: ['IMPACTS', 'DECOMPOSES_TO', 'COMPOSED_OF', 'REALIZED_BY', 'SERVED_BY', 'DEPLOYED_ON'],
    layoutType: 'Layered',
    orientation: 'LeftToRight',
    maxDepthConfig: { configurable: true, defaultValue: 3 },
  },
] as const;

export const STANDARD_VIEW_TEMPLATE_BY_ID: Readonly<Record<ViewTemplateId, ViewTemplate>> =
  STANDARD_VIEW_TEMPLATES.reduce(
    (acc, t) => {
      acc[t.id] = t;
      return acc;
    },
    {} as Record<ViewTemplateId, ViewTemplate>,
  );

export function getStandardViewTemplate(templateId: ViewTemplateId): ViewTemplate {
  return STANDARD_VIEW_TEMPLATE_BY_ID[templateId];
}

const normalizeList = (values: readonly string[]) =>
  Array.from(
    new Set(
      (values ?? [])
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter((v) => v.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));

const union = (a: readonly string[], b: readonly string[]) => normalizeList([...a, ...b]);

/**
 * Instantiate a template into a ViewDefinition.
 *
 * Determinism:
 * - Produces stable, normalized allowedElementTypes/allowedRelationshipTypes.
 * - Ensures relationship endpoint types are included when relationship types are included.
 *
 * Note: This does NOT persist the view (call ViewRepository.createView yourself).
 */
export function instantiateViewFromTemplate(
  templateId: ViewTemplateId,
  input: {
    id: string;
    createdBy: string;
    createdAt: string;
    lastModifiedAt: string;
    approvalStatus: ViewApprovalStatus;

    // Optional overrides
    name?: string;
    description?: string;
    rootElementId?: string;
    rootElementType?: string;
    maxDepth?: number;
  },
): ViewDefinition {
  const template = getStandardViewTemplate(templateId);

  const baseAllowedElementTypes = normalizeList(template.allowedElementTypes);
  const allowedRelationshipTypes = normalizeList(template.allowedRelationshipTypes);

  // Ensure endpoint element types for declared relationship types are included (deterministic union).
  let allowedElementTypes = baseAllowedElementTypes;
  for (const relType of allowedRelationshipTypes) {
    const rule = getRelationshipEndpointRule(relType);
    if (!rule) continue;
    allowedElementTypes = union(allowedElementTypes, [...rule.from, ...rule.to]);
  }

  const maxDepth =
    typeof input.maxDepth === 'number'
      ? input.maxDepth
      : template.maxDepthConfig?.configurable
        ? template.maxDepthConfig.defaultValue
        : undefined;

  return {
    id: input.id,
    name: input.name ?? template.name,
    description: input.description ?? template.description,

    viewType: template.viewType,
    architectureLayer: template.architectureLayer,

    rootElementId: input.rootElementId ?? template.rootElementId,
    rootElementType: input.rootElementType ?? template.rootElementType,
    maxDepth,

    allowedElementTypes,
    allowedRelationshipTypes,

    layoutType: template.layoutType,
    orientation: template.orientation,

    createdBy: input.createdBy,
    createdAt: input.createdAt,
    lastModifiedAt: input.lastModifiedAt,
    approvalStatus: input.approvalStatus,
  };
}
