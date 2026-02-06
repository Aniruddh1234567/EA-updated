export const OBJECT_TYPES = [
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
  'Programme',
  'Project',
  'Principle',
  'Requirement',
  'Standard',
] as const;

export type ObjectType = (typeof OBJECT_TYPES)[number];

export const RELATIONSHIP_TYPES = [
  'DECOMPOSES_TO',
  // Explicit capability composition (alias/companion to DECOMPOSES_TO)
  'COMPOSED_OF',
  // Business-process execution (legacy)
  'REALIZES',
  // Business process sequencing
  'TRIGGERS',
  // Business process served by application
  'SERVED_BY',
  // Application ↔ Application technical dependencies (prefer INTEGRATES_WITH)
  'INTEGRATES_WITH',
  'DEPLOYED_ON',
  // Enterprise / organization
  'OWNS',
  'HAS',

  // Business service traceability
  'REALIZED_BY',

  // Application service traceability
  'EXPOSES',
  'PROVIDED_BY',
  'USED_BY',
  'SUPPORTS',

  // Application-service-to-application-service dependencies
  'CONSUMES',

  // Legacy (hidden in UI): prefer CONSUMES for ApplicationService→ApplicationService
  'DEPENDS_ON',

  // Technical integration (application to technology)
  'CONNECTS_TO',
  'USES',

  // Cross-layer (core)
  'SUPPORTED_BY',
  'IMPACTS',
  'IMPLEMENTS',

  // Implementation & Migration (programme/project traceability)
  'DELIVERS',
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export type EaLayer = 'Business' | 'Application' | 'Technology' | 'Implementation & Migration' | 'Governance';

export type EaObjectTypeDefinition = {
  type: ObjectType;
  layer: EaLayer;
  description: string;
  attributes: readonly string[];
  allowedOutgoingRelationships: readonly RelationshipType[];
  allowedIncomingRelationships: readonly RelationshipType[];
};

export type EaRelationshipTypeDefinition = {
  type: RelationshipType;
  layer: EaLayer;
  description: string;
  fromTypes: readonly ObjectType[];
  toTypes: readonly ObjectType[];
  /** Optional strict endpoint rules (pair-specific). When present, endpoints must match one of these pairs. */
  allowedEndpointPairs?: readonly { from: ObjectType; to: ObjectType }[];
  attributes: readonly string[];
};

export const EA_LAYERS: readonly EaLayer[] = [
  'Business',
  'Application',
  'Technology',
  'Implementation & Migration',
  'Governance',
] as const;

export const OBJECT_TYPE_DEFINITIONS: Record<ObjectType, EaObjectTypeDefinition> = {
  Enterprise: {
    type: 'Enterprise',
    layer: 'Business',
    description:
      'A legal entity / enterprise / business unit. Multiple Enterprise instances are allowed. Supports hierarchical ownership (group → subsidiary → unit).',
    attributes: ['name', 'description', 'parentEnterpriseId'],
    allowedOutgoingRelationships: ['OWNS', 'HAS'],
    allowedIncomingRelationships: ['OWNS'],
  },
  Programme: {
    type: 'Programme',
    layer: 'Implementation & Migration',
    description: 'A strategic initiative grouping related change outcomes and delivery work.',
    attributes: ['name'],
    allowedOutgoingRelationships: ['DELIVERS', 'IMPACTS'],
    allowedIncomingRelationships: [],
  },
  Project: {
    type: 'Project',
    layer: 'Implementation & Migration',
    description: 'A time-bound delivery effort (v1: catalogued but not fully modeled).',
    attributes: ['name'],
    allowedOutgoingRelationships: ['IMPLEMENTS'],
    allowedIncomingRelationships: [],
  },
  Principle: {
    type: 'Principle',
    layer: 'Governance',
    description: 'A guiding principle that shapes architecture decisions.',
    attributes: ['name'],
    allowedOutgoingRelationships: [],
    allowedIncomingRelationships: [],
  },
  Requirement: {
    type: 'Requirement',
    layer: 'Governance',
    description: 'A requirement that constrains or informs architecture and change work.',
    attributes: ['name'],
    allowedOutgoingRelationships: [],
    allowedIncomingRelationships: [],
  },
  Standard: {
    type: 'Standard',
    layer: 'Governance',
    description: 'A governance standard that constrains architecture decisions and delivery.',
    attributes: ['name'],
    allowedOutgoingRelationships: [],
    allowedIncomingRelationships: [],
  },
  CapabilityCategory: {
    type: 'CapabilityCategory',
    layer: 'Business',
    description: 'A top-level grouping of business capabilities.',
    attributes: ['name', 'category'],
    allowedOutgoingRelationships: ['DECOMPOSES_TO', 'COMPOSED_OF'],
    allowedIncomingRelationships: ['DECOMPOSES_TO', 'COMPOSED_OF', 'DELIVERS'],
  },
  Capability: {
    type: 'Capability',
    layer: 'Business',
    description: 'A business capability (what the business does).',
    attributes: ['name', 'category'],
    allowedOutgoingRelationships: ['DECOMPOSES_TO', 'COMPOSED_OF', 'REALIZED_BY'],
    allowedIncomingRelationships: ['DECOMPOSES_TO', 'COMPOSED_OF'],
  },
  SubCapability: {
    type: 'SubCapability',
    layer: 'Business',
    description: 'A decomposed business capability (more granular capability).',
    attributes: ['name', 'category'],
    allowedOutgoingRelationships: [],
    allowedIncomingRelationships: ['DECOMPOSES_TO', 'COMPOSED_OF', 'DELIVERS'],
  },
  ValueStream: {
    type: 'ValueStream',
    layer: 'Business',
    description: 'A value stream (TOGAF-aligned): end-to-end value delivery stream across capabilities and stages.',
    attributes: ['name'],
    allowedOutgoingRelationships: [],
    allowedIncomingRelationships: [],
  },
  BusinessProcess: {
    type: 'BusinessProcess',
    layer: 'Business',
    description: 'A business process (how work is performed across steps/activities).',
    attributes: ['name'],
    allowedOutgoingRelationships: ['REALIZES', 'TRIGGERS', 'SERVED_BY'],
    allowedIncomingRelationships: ['REALIZED_BY', 'TRIGGERS', 'USED_BY'],
  },
  BusinessService: {
    type: 'BusinessService',
    layer: 'Business',
    description: 'A business service that exposes value delivery, realized by capabilities and supported by application services.',
    attributes: ['name'],
    allowedOutgoingRelationships: ['SUPPORTED_BY'],
    allowedIncomingRelationships: ['SUPPORTS'],
  },
  Department: {
    type: 'Department',
    layer: 'Business',
    description: 'An organizational unit (cannot exist without an owning Enterprise).',
    attributes: ['name'],
    allowedOutgoingRelationships: [],
    allowedIncomingRelationships: ['HAS'],
  },
  Application: {
    type: 'Application',
    layer: 'Application',
    description: 'A software application or service.',
    attributes: ['name', 'criticality', 'lifecycle'],
    allowedOutgoingRelationships: ['USES', 'EXPOSES', 'DEPLOYED_ON'],
    allowedIncomingRelationships: ['SERVED_BY', 'USES', 'PROVIDED_BY', 'USED_BY', 'DELIVERS', 'SUPPORTED_BY', 'OWNS', 'IMPLEMENTS'],
  },
  ApplicationService: {
    type: 'ApplicationService',
    layer: 'Application',
    description: 'An application-exposed service (fine-grained traceability layer). Belongs to exactly one Application.',
    attributes: ['name'],
    allowedOutgoingRelationships: ['PROVIDED_BY', 'USED_BY'],
    allowedIncomingRelationships: ['EXPOSES'],
  },
  Interface: {
    type: 'Interface',
    layer: 'Application',
    description: 'An application interface (contract/endpoint).',
    attributes: ['name'],
    allowedOutgoingRelationships: [],
    allowedIncomingRelationships: [],
  },
  Technology: {
    type: 'Technology',
    layer: 'Technology',
    description: 'A technology platform/component that applications run on or use.',
    attributes: ['name', 'environment', 'type'],
    allowedOutgoingRelationships: ['CONNECTS_TO'],
    allowedIncomingRelationships: ['CONNECTS_TO', 'DEPLOYED_ON'],
  },
  Node: {
    type: 'Node',
    layer: 'Technology',
    description: 'A compute node (physical or virtual) that hosts runtimes and infrastructure.',
    attributes: ['name', 'environment', 'type'],
    allowedOutgoingRelationships: ['CONNECTS_TO'],
    allowedIncomingRelationships: ['CONNECTS_TO', 'DEPLOYED_ON'],
  },
  Server: {
    type: 'Server',
    layer: 'Technology',
    description: 'A physical or virtual server hosting applications and infrastructure services.',
    attributes: ['name', 'environment', 'type'],
    allowedOutgoingRelationships: ['CONNECTS_TO'],
    allowedIncomingRelationships: ['CONNECTS_TO', 'DEPLOYED_ON'],
  },
  Compute: {
    type: 'Compute',
    layer: 'Technology',
    description: 'Compute host (VM, container host, or server cluster).',
    attributes: ['name', 'environment', 'type'],
    allowedOutgoingRelationships: ['CONNECTS_TO'],
    allowedIncomingRelationships: ['CONNECTS_TO', 'DEPLOYED_ON'],
  },
  VM: {
    type: 'VM',
    layer: 'Technology',
    description: 'A virtual machine runtime instance (guest OS on a hypervisor).',
    attributes: ['name', 'environment', 'type'],
    allowedOutgoingRelationships: ['CONNECTS_TO'],
    allowedIncomingRelationships: ['CONNECTS_TO', 'DEPLOYED_ON'],
  },
  Container: {
    type: 'Container',
    layer: 'Technology',
    description: 'A container runtime instance (application workload container).',
    attributes: ['name', 'environment', 'type'],
    allowedOutgoingRelationships: ['CONNECTS_TO'],
    allowedIncomingRelationships: ['CONNECTS_TO', 'DEPLOYED_ON'],
  },
  Runtime: {
    type: 'Runtime',
    layer: 'Technology',
    description: 'A runtime environment (container runtime, VM image, or managed runtime).',
    attributes: ['name', 'environment', 'type'],
    allowedOutgoingRelationships: ['CONNECTS_TO'],
    allowedIncomingRelationships: ['CONNECTS_TO', 'DEPENDS_ON', 'DEPLOYED_ON'],
  },
  Database: {
    type: 'Database',
    layer: 'Technology',
    description: 'A data store (database, warehouse, or persistence service).',
    attributes: ['name', 'environment', 'type'],
    allowedOutgoingRelationships: ['CONNECTS_TO'],
    allowedIncomingRelationships: ['CONNECTS_TO', 'DEPLOYED_ON'],
  },
  Storage: {
    type: 'Storage',
    layer: 'Technology',
    description: 'Storage system (object, block, file, or archival storage).',
    attributes: ['name', 'environment', 'type'],
    allowedOutgoingRelationships: ['CONNECTS_TO'],
    allowedIncomingRelationships: ['CONNECTS_TO', 'DEPLOYED_ON'],
  },
  Network: {
    type: 'Network',
    layer: 'Technology',
    description: 'Network segment, fabric, or connectivity domain (VPC, LAN, WAN).',
    attributes: ['name', 'environment', 'type'],
    allowedOutgoingRelationships: ['CONNECTS_TO'],
    allowedIncomingRelationships: ['CONNECTS_TO', 'DEPLOYED_ON'],
  },
  LoadBalancer: {
    type: 'LoadBalancer',
    layer: 'Technology',
    description: 'Load balancer distributing traffic across services or nodes.',
    attributes: ['name', 'environment', 'type'],
    allowedOutgoingRelationships: ['CONNECTS_TO'],
    allowedIncomingRelationships: ['CONNECTS_TO', 'DEPLOYED_ON'],
  },
  API: {
    type: 'API',
    layer: 'Technology',
    description: 'API / Gateway exposed to consumers or internal integrations.',
    attributes: ['name', 'environment', 'type'],
    allowedOutgoingRelationships: ['CONNECTS_TO'],
    allowedIncomingRelationships: ['CONNECTS_TO', 'DEPLOYED_ON'],
  },
  MessageBroker: {
    type: 'MessageBroker',
    layer: 'Technology',
    description: 'A message broker or event bus for asynchronous integration.',
    attributes: ['name', 'environment', 'type'],
    allowedOutgoingRelationships: ['CONNECTS_TO'],
    allowedIncomingRelationships: ['CONNECTS_TO', 'DEPLOYED_ON'],
  },
  IntegrationPlatform: {
    type: 'IntegrationPlatform',
    layer: 'Technology',
    description: 'Integration platform (ESB, iPaaS, workflow, or middleware hub).',
    attributes: ['name', 'environment', 'type'],
    allowedOutgoingRelationships: ['CONNECTS_TO'],
    allowedIncomingRelationships: ['CONNECTS_TO', 'DEPLOYED_ON'],
  },
  CloudService: {
    type: 'CloudService',
    layer: 'Technology',
    description: 'A managed cloud service (storage, compute, integration, or platform service).',
    attributes: ['name', 'environment', 'type'],
    allowedOutgoingRelationships: ['CONNECTS_TO'],
    allowedIncomingRelationships: ['CONNECTS_TO', 'DEPLOYED_ON'],
  },
} as const;

export const RELATIONSHIP_TYPE_DEFINITIONS: Record<RelationshipType, EaRelationshipTypeDefinition> = {
  DECOMPOSES_TO: {
    type: 'DECOMPOSES_TO',
    layer: 'Business',
    description: 'Decomposition relationship used to break a parent element into child elements.',
    fromTypes: ['CapabilityCategory', 'Capability', 'SubCapability'],
    toTypes: ['CapabilityCategory', 'Capability', 'SubCapability'],
    attributes: [],
  },
  COMPOSED_OF: {
    type: 'COMPOSED_OF',
    layer: 'Business',
    description: 'Capability is composed of a sub-capability (explicit hierarchy relationship).',
    fromTypes: ['CapabilityCategory', 'Capability', 'SubCapability'],
    toTypes: ['CapabilityCategory', 'Capability', 'SubCapability'],
    // Keep this strict: only allow Capability hierarchy edges.
    allowedEndpointPairs: [
      { from: 'CapabilityCategory', to: 'Capability' },
      { from: 'Capability', to: 'SubCapability' },
      { from: 'Capability', to: 'Capability' },
    ],
    attributes: [],
  },
  REALIZES: {
    type: 'REALIZES',
    layer: 'Business',
    description: 'Indicates a business process realizes (implements/enables) a capability.',
    fromTypes: ['BusinessProcess'],
    toTypes: ['Capability'],
    attributes: [],
  },
  TRIGGERS: {
    type: 'TRIGGERS',
    layer: 'Business',
    description: 'Indicates a business process triggers another business process.',
    fromTypes: ['BusinessProcess'],
    toTypes: ['BusinessProcess'],
    attributes: [],
  },
  SERVED_BY: {
    type: 'SERVED_BY',
    layer: 'Application',
    description: 'Indicates a business process is served by an application.',
    fromTypes: ['BusinessProcess'],
    toTypes: ['Application'],
    attributes: ['automationLevel', 'automationCoveragePercent'],
  },
  INTEGRATES_WITH: {
    type: 'INTEGRATES_WITH',
    layer: 'Application',
    description: 'Application integrates with another Application (preferred over generic DEPENDS_ON).',
    fromTypes: ['Application'],
    toTypes: ['Application'],
    attributes: ['dependencyStrength', 'dependencyType'],
  },
  DEPENDS_ON: {
    type: 'DEPENDS_ON',
    layer: 'Application',
    description:
      'Legacy dependency relationship (hidden). Prefer CONSUMES for ApplicationService → ApplicationService dependencies.',
    fromTypes: ['ApplicationService', 'Application'],
    toTypes: ['ApplicationService', 'Runtime'],
    attributes: ['dependencyStrength', 'dependencyType'],
  },
  CONNECTS_TO: {
    type: 'CONNECTS_TO',
    layer: 'Technology',
    description: 'Technology connects to Technology (infrastructure connectivity).',
    fromTypes: ['Technology', 'Node', 'Server', 'Compute', 'VM', 'Container', 'Runtime', 'Database', 'Storage', 'Network', 'LoadBalancer', 'API', 'MessageBroker', 'IntegrationPlatform', 'CloudService'],
    toTypes: ['Technology', 'Node', 'Server', 'Compute', 'VM', 'Container', 'Runtime', 'Database', 'Storage', 'Network', 'LoadBalancer', 'API', 'MessageBroker', 'IntegrationPlatform', 'CloudService'],
    attributes: [],
  },
  USES: {
    type: 'USES',
    layer: 'Application',
    description: 'Application uses another Application.',
    fromTypes: ['Application'],
    toTypes: ['Application'],
    attributes: ['dependencyStrength', 'dependencyType'],
  },
  EXPOSES: {
    type: 'EXPOSES',
    layer: 'Application',
    description: 'Application exposes an Application Service.',
    fromTypes: ['Application'],
    toTypes: ['ApplicationService'],
    attributes: [],
  },
  PROVIDED_BY: {
    type: 'PROVIDED_BY',
    layer: 'Application',
    description: 'Application Service is provided by an Application.',
    fromTypes: ['ApplicationService'],
    toTypes: ['Application'],
    attributes: [],
  },
  USED_BY: {
    type: 'USED_BY',
    layer: 'Application',
    description: 'Application Service is used by an Application or Business Process.',
    fromTypes: ['ApplicationService'],
    toTypes: ['Application', 'BusinessProcess'],
    attributes: [],
  },
  DEPLOYED_ON: {
    type: 'DEPLOYED_ON',
    layer: 'Technology',
    description: 'Application is deployed on technology.',
    fromTypes: ['Application'],
    toTypes: ['Technology', 'Node', 'Server', 'Compute', 'VM', 'Container', 'Runtime', 'Database', 'Storage', 'Network', 'LoadBalancer', 'API', 'MessageBroker', 'IntegrationPlatform', 'CloudService'],
    attributes: [],
  },
  DELIVERS: {
    type: 'DELIVERS',
    layer: 'Implementation & Migration',
    description: 'Delivery relationship from a programme to a delivered business/application outcome.',
    fromTypes: ['Programme'],
    toTypes: ['CapabilityCategory', 'Capability', 'SubCapability', 'Application'],
    attributes: [],
  },
  OWNS: {
    type: 'OWNS',
    layer: 'Business',
    description:
      'Ownership relationship. Enterprises can own enterprises (hierarchy) and own key EA elements for accountability.',
    fromTypes: ['Enterprise'],
    toTypes: ['Enterprise', 'Capability', 'Application', 'Programme'],
    attributes: [],
  },
  HAS: {
    type: 'HAS',
    layer: 'Business',
    description: 'Enterprise has a Department (Departments cannot exist without an Enterprise).',
    fromTypes: ['Enterprise'],
    toTypes: ['Department'],
    attributes: [],
  },
  REALIZED_BY: {
    type: 'REALIZED_BY',
    layer: 'Business',
    description: 'Capability is realized by a Business Process.',
    fromTypes: ['Capability'],
    toTypes: ['BusinessProcess'],
    attributes: [],
  },
  SUPPORTS: {
    type: 'SUPPORTS',
    layer: 'Application',
    description: 'Application Service supports a Business Service (traceability layer).',
    fromTypes: ['ApplicationService'],
    toTypes: ['BusinessService'],
    attributes: [],
  },
  CONSUMES: {
    type: 'CONSUMES',
    layer: 'Application',
    description: 'Application Service consumes another Application Service (service-to-service dependency).',
    fromTypes: ['ApplicationService'],
    toTypes: ['ApplicationService'],
    attributes: ['dependencyStrength', 'dependencyType'],
  },
  SUPPORTED_BY: {
    type: 'SUPPORTED_BY',
    layer: 'Business',
    description:
      'Cross-layer support alignment (pair-specific): Capability/SubCapability → Application, and BusinessService → ApplicationService.',
    fromTypes: ['Capability', 'SubCapability', 'BusinessService'],
    toTypes: ['Application', 'ApplicationService'],
    allowedEndpointPairs: [
      { from: 'Capability', to: 'Application' },
      { from: 'SubCapability', to: 'Application' },
      { from: 'BusinessService', to: 'ApplicationService' },
    ],
    attributes: [],
  },
  IMPACTS: {
    type: 'IMPACTS',
    layer: 'Implementation & Migration',
    description: 'Programme impacts a Capability (roadmap / change traceability).',
    fromTypes: ['Programme'],
    toTypes: ['Capability', 'SubCapability'],
    attributes: [],
  },
  IMPLEMENTS: {
    type: 'IMPLEMENTS',
    layer: 'Implementation & Migration',
    description: 'Project implements an Application.',
    fromTypes: ['Project'],
    toTypes: ['Application'],
    attributes: [],
  },
} as const;

export function isValidObjectType(type: unknown): type is ObjectType {
  return typeof type === 'string' && (OBJECT_TYPES as readonly string[]).includes(type);
}

export function isValidRelationshipType(type: unknown): type is RelationshipType {
  return typeof type === 'string' && (RELATIONSHIP_TYPES as readonly string[]).includes(type);
}
