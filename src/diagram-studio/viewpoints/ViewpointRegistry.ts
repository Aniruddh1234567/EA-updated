import {
  OBJECT_TYPES,
  RELATIONSHIP_TYPES,
  type ObjectType,
  type RelationshipType,
} from '@/pages/dependency-view/utils/eaMetaModel';

export type LayoutEngineId = 'dagre' | 'elkjs' | 'grid' | 'layered';

export type ViewpointDefinition = {
  readonly id: string;
  readonly name: string;
  readonly allowedElementTypes: readonly ObjectType[];
  readonly allowedRelationshipTypes: readonly RelationshipType[];
  readonly defaultLayout: LayoutEngineId;
  readonly description: string;
};

export type ViewpointId =
  | 'business-capability-map'
  | 'application-landscape'
  | 'technology-landscape'
  | 'capability-map'
  | 'capability-to-application-alignment'
  | 'application-dependency'
  | 'service-traceability'
  | 'delivery-traceability'
  | 'enterprise-ownership';

const normalizeId = (value: string): string => value.trim().toLowerCase();

const freezeViewpoint = (viewpoint: ViewpointDefinition): ViewpointDefinition => {
  validateViewpoint(viewpoint);
  return Object.freeze({
    ...viewpoint,
    allowedElementTypes: Object.freeze([...viewpoint.allowedElementTypes]),
    allowedRelationshipTypes: Object.freeze([...viewpoint.allowedRelationshipTypes]),
  });
};

const validateViewpoint = (viewpoint: ViewpointDefinition): void => {
  viewpoint.allowedElementTypes.forEach((type) => {
    if (!OBJECT_TYPES.includes(type)) {
      throw new Error(`Unknown element type in viewpoint ${viewpoint.id}: ${type}`);
    }
  });

  viewpoint.allowedRelationshipTypes.forEach((type) => {
    if (!RELATIONSHIP_TYPES.includes(type)) {
      throw new Error(`Unknown relationship type in viewpoint ${viewpoint.id}: ${type}`);
    }
  });
};

const BUILT_IN_VIEWPOINTS: readonly ViewpointDefinition[] = Object.freeze(
  [
    {
      id: 'business-capability-map',
      name: 'Business Capability Map',
      allowedElementTypes: ['Capability', 'SubCapability'],
      allowedRelationshipTypes: ['COMPOSED_OF', 'DECOMPOSES_TO'],
      defaultLayout: 'dagre',
      description: 'Hierarchical capability map focused on capability and sub-capability decomposition.',
    },
    {
      id: 'application-landscape',
      name: 'Application Landscape',
      allowedElementTypes: ['Application', 'ApplicationService'],
      allowedRelationshipTypes: ['DEPENDS_ON', 'EXPOSES', 'PROVIDED_BY'],
      defaultLayout: 'grid',
      description: 'Grid layout for application and application-service relationships (dependencies and provision).',
    },
    {
      id: 'technology-landscape',
      name: 'Technology Landscape',
      allowedElementTypes: ['Technology'],
      allowedRelationshipTypes: ['CONNECTS_TO'],
      defaultLayout: 'layered',
      description: 'Layered technology-centric view of connectivity relationships.',
    },
    {
      id: 'capability-map',
      name: 'Capability Map',
      allowedElementTypes: ['CapabilityCategory', 'Capability', 'SubCapability'],
      allowedRelationshipTypes: ['DECOMPOSES_TO', 'COMPOSED_OF'],
      defaultLayout: 'dagre',
      description: 'Hierarchical view of business capabilities and categories.',
    },
    {
      id: 'capability-to-application-alignment',
      name: 'Capability to Application Alignment',
      allowedElementTypes: ['Capability', 'SubCapability', 'Application'],
      allowedRelationshipTypes: ['SUPPORTED_BY'],
      defaultLayout: 'dagre',
      description: 'Cross-layer alignment from capabilities to the applications that support them.',
    },
    {
      id: 'application-dependency',
      name: 'Application Dependency',
      allowedElementTypes: ['Application', 'Technology'],
      allowedRelationshipTypes: ['INTEGRATES_WITH', 'DEPLOYED_ON'],
      defaultLayout: 'elkjs',
      description: 'Operational view of application-to-application dependencies and deployment.',
    },
    {
      id: 'service-traceability',
      name: 'Service Traceability',
      allowedElementTypes: ['Application', 'ApplicationService', 'BusinessService'],
      allowedRelationshipTypes: ['EXPOSES', 'PROVIDED_BY', 'SUPPORTS', 'CONSUMES', 'DEPENDS_ON', 'USED_BY'],
      defaultLayout: 'elkjs',
      description: 'Traceability across business services, application services, and their dependencies.',
    },
    {
      id: 'delivery-traceability',
      name: 'Delivery Traceability',
      allowedElementTypes: ['Programme', 'Project', 'Capability', 'SubCapability', 'Application'],
      allowedRelationshipTypes: ['DELIVERS', 'IMPACTS', 'IMPLEMENTS'],
      defaultLayout: 'dagre',
      description: 'Change delivery lineage from programme to project to delivered capabilities and applications.',
    },
    {
      id: 'enterprise-ownership',
      name: 'Enterprise Ownership',
      allowedElementTypes: ['Enterprise', 'Department', 'Capability', 'Application', 'Programme'],
      allowedRelationshipTypes: ['OWNS', 'HAS'],
      defaultLayout: 'dagre',
      description: 'Enterprise accountability graph (ownership and department structure).',
    },
  ].map((vp) => freezeViewpoint(vp)),
);

const VIEWPOINT_BY_ID = new Map<string, ViewpointDefinition>(
  BUILT_IN_VIEWPOINTS.map((vp) => [normalizeId(vp.id), vp]),
);

export class ViewpointRegistry {
  private constructor() {}

  static list(): readonly ViewpointDefinition[] {
    return BUILT_IN_VIEWPOINTS;
  }

  static get(viewpointId: string): ViewpointDefinition | undefined {
    if (!viewpointId) return undefined;
    return VIEWPOINT_BY_ID.get(normalizeId(viewpointId));
  }

  static require(viewpointId: string): ViewpointDefinition {
    const viewpoint = this.get(viewpointId);
    if (!viewpoint) {
      throw new Error(`Unknown viewpoint: ${viewpointId}`);
    }
    return viewpoint;
  }
}
