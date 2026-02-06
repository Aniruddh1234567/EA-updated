import type { EaLayer, EaRelationshipTypeDefinition, ObjectType } from '@/pages/dependency-view/utils/eaMetaModel';
import { RELATIONSHIP_TYPE_DEFINITIONS } from '@/pages/dependency-view/utils/eaMetaModel';

type EaVisualShape = 'round-rectangle' | 'rectangle' | 'ellipse' | 'diamond' | 'hexagon';

type EaShapeVisualStyle = {
  width: number;
  height: number;
  labelOffsetY?: number;
};

export type EaShapeRegistryEntry = {
  kind: string;
  type: ObjectType;
  layer: EaLayer;
  label: string;
  svgPath: string;
  style: EaShapeVisualStyle;
  canvas: {
    shape: EaVisualShape;
    renderer: 'svg';
  };
};

const ARCHIMATE_BASE_PATH = '/archimate-symbols';
const DRAWIO_BASE_PATH = '/drawio-libs/libs/arista';
const svgPath = (fileName: string) => `${ARCHIMATE_BASE_PATH}/${encodeURIComponent(fileName)}`;
const drawioPath = (fileName: string) => `${DRAWIO_BASE_PATH}/${encodeURIComponent(fileName)}`;

const DEFAULT_STYLE: EaShapeVisualStyle = {
  width: 180,
  height: 90,
  labelOffsetY: 0,
};

const RAW_EA_SHAPE_REGISTRY: Omit<EaShapeRegistryEntry, 'style'>[] = [
  // Business layer (ArchiMate)
  {
    kind: 'business-actor',
    type: 'Enterprise',
    layer: 'Business',
    label: 'Business Actor',
    svgPath: svgPath('Business Actor.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'business-role',
    type: 'Department',
    layer: 'Business',
    label: 'Business Role',
    svgPath: svgPath('Business Role.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'business-collaboration',
    type: 'Department',
    layer: 'Business',
    label: 'Business Collaboration',
    svgPath: svgPath('Business Collaboration.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'business-interface',
    type: 'Department',
    layer: 'Business',
    label: 'Business Interface',
    svgPath: svgPath('Business Interface.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'business-process',
    type: 'BusinessProcess',
    layer: 'Business',
    label: 'Business Process',
    svgPath: svgPath('Business Process.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'business-event',
    type: 'BusinessProcess',
    layer: 'Business',
    label: 'Business Event',
    svgPath: svgPath('Business Event.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'business-function',
    type: 'BusinessProcess',
    layer: 'Business',
    label: 'Business Function',
    svgPath: svgPath('Business Function.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'business-interaction',
    type: 'BusinessProcess',
    layer: 'Business',
    label: 'Business Interaction',
    svgPath: svgPath('Business Interaction.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'business-service',
    type: 'BusinessService',
    layer: 'Business',
    label: 'Business Service',
    svgPath: svgPath('Business Service.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'business-object',
    type: 'BusinessService',
    layer: 'Business',
    label: 'Business Object',
    svgPath: svgPath('Business Object.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'contract',
    type: 'BusinessService',
    layer: 'Business',
    label: 'Contract',
    svgPath: svgPath('Contract.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'product',
    type: 'BusinessService',
    layer: 'Business',
    label: 'Product',
    svgPath: svgPath('Product.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'representation',
    type: 'BusinessService',
    layer: 'Business',
    label: 'Representation',
    svgPath: svgPath('Representation.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'meaning',
    type: 'BusinessService',
    layer: 'Business',
    label: 'Meaning',
    svgPath: svgPath('Meaning.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'value',
    type: 'BusinessService',
    layer: 'Business',
    label: 'Value',
    svgPath: svgPath('Value.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'capability',
    type: 'Capability',
    layer: 'Business',
    label: 'Capability',
    svgPath: svgPath('Capability.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'capability-category',
    type: 'CapabilityCategory',
    layer: 'Business',
    label: 'Capability Category',
    svgPath: svgPath('Capability.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'sub-capability',
    type: 'SubCapability',
    layer: 'Business',
    label: 'Sub-Capability',
    svgPath: svgPath('Capability.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'course-of-action',
    type: 'Capability',
    layer: 'Business',
    label: 'Course of Action',
    svgPath: svgPath('Course of Action.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'resource',
    type: 'Capability',
    layer: 'Business',
    label: 'Resource',
    svgPath: svgPath('Resource.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'value-stream',
    type: 'ValueStream',
    layer: 'Business',
    label: 'Value Stream',
    svgPath: svgPath('Value Stream.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'outcome',
    type: 'ValueStream',
    layer: 'Business',
    label: 'Outcome',
    svgPath: svgPath('Outcome.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'location',
    type: 'Enterprise',
    layer: 'Business',
    label: 'Location',
    svgPath: svgPath('Location.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },

  // Application layer (ArchiMate)
  {
    kind: 'application-component',
    type: 'Application',
    layer: 'Application',
    label: 'Application Component',
    svgPath: svgPath('Application Component.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'application-collaboration',
    type: 'Application',
    layer: 'Application',
    label: 'Application Collaboration',
    svgPath: svgPath('Application Collaboration.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'application-event',
    type: 'Application',
    layer: 'Application',
    label: 'Application Event',
    svgPath: svgPath('Application Event.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'application-function',
    type: 'Application',
    layer: 'Application',
    label: 'Application Function',
    svgPath: svgPath('Application Function.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'application-interaction',
    type: 'Application',
    layer: 'Application',
    label: 'Application Interaction',
    svgPath: svgPath('Application Interaction.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'application-interface',
    type: 'Interface',
    layer: 'Application',
    label: 'Application Interface',
    svgPath: svgPath('Application Interface.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'application-process',
    type: 'Application',
    layer: 'Application',
    label: 'Application Process',
    svgPath: svgPath('Application Process.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'application-service',
    type: 'ApplicationService',
    layer: 'Application',
    label: 'Application Service',
    svgPath: svgPath('Application Service.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'data-object',
    type: 'Application',
    layer: 'Application',
    label: 'Data Object',
    svgPath: svgPath('Data Object.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },

  // Technology layer (drawio-libs)
  {
    kind: 'technology-platform',
    type: 'Technology',
    layer: 'Technology',
    label: 'Technology Platform',
    svgPath: drawioPath('DCS-7508E-BND.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'node',
    type: 'Node',
    layer: 'Technology',
    label: 'Node',
    svgPath: drawioPath('DCS-7504E-BND.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'node-core',
    type: 'Node',
    layer: 'Technology',
    label: 'Core Node',
    svgPath: drawioPath('DCS-7280SE-72.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'node-edge',
    type: 'Node',
    layer: 'Technology',
    label: 'Edge Node',
    svgPath: drawioPath('DCS-7280SE-68.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'server',
    type: 'Server',
    layer: 'Technology',
    label: 'Server',
    svgPath: drawioPath('DCS-7500E-SUP.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'server-rack',
    type: 'Server',
    layer: 'Technology',
    label: 'Server (Rack)',
    svgPath: drawioPath('DCS-7050TX-96.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'compute',
    type: 'Compute',
    layer: 'Technology',
    label: 'Compute',
    svgPath: drawioPath('DCS-7500E-72S-LC.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'compute-high',
    type: 'Compute',
    layer: 'Technology',
    label: 'Compute (High Density)',
    svgPath: drawioPath('DCS-7050TX-128.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'vm',
    type: 'VM',
    layer: 'Technology',
    label: 'VM',
    svgPath: drawioPath('DCS-7500E-6C2-LC.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'container',
    type: 'Container',
    layer: 'Technology',
    label: 'Container',
    svgPath: drawioPath('DCS-7500E-48S-LC.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'container-platform',
    type: 'Container',
    layer: 'Technology',
    label: 'Container Platform',
    svgPath: drawioPath('DCS-7050SX-128.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'runtime',
    type: 'Runtime',
    layer: 'Technology',
    label: 'Runtime',
    svgPath: drawioPath('DCS-7500E-36Q-LC.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'runtime-cluster',
    type: 'Runtime',
    layer: 'Technology',
    label: 'Runtime Cluster',
    svgPath: drawioPath('DCS-7050QX-32.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'database',
    type: 'Database',
    layer: 'Technology',
    label: 'Database',
    svgPath: drawioPath('DCS-7500E-12CQ-LC.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'database-replica',
    type: 'Database',
    layer: 'Technology',
    label: 'Database (Replica)',
    svgPath: drawioPath('DCS-7050QX-32S.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'storage',
    type: 'Storage',
    layer: 'Technology',
    label: 'Storage',
    svgPath: drawioPath('DCS-7500E-12CM-LC.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'storage-san',
    type: 'Storage',
    layer: 'Technology',
    label: 'Storage (SAN)',
    svgPath: drawioPath('DCS-7050T-64.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'storage-nas',
    type: 'Storage',
    layer: 'Technology',
    label: 'Storage (NAS)',
    svgPath: drawioPath('DCS-7050T-52.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'network',
    type: 'Network',
    layer: 'Technology',
    label: 'Network',
    svgPath: drawioPath('DCS-7316.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'network-switch',
    type: 'Network',
    layer: 'Technology',
    label: 'Network Switch',
    svgPath: drawioPath('DCS-7124SX.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'network-router',
    type: 'Network',
    layer: 'Technology',
    label: 'Network Router',
    svgPath: drawioPath('DCS-7050Q-16.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'firewall',
    type: 'Network',
    layer: 'Technology',
    label: 'Firewall',
    svgPath: drawioPath('DCS-7308.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'load-balancer',
    type: 'LoadBalancer',
    layer: 'Technology',
    label: 'Load Balancer',
    svgPath: drawioPath('DCS-7304.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'load-balancer-ha',
    type: 'LoadBalancer',
    layer: 'Technology',
    label: 'Load Balancer (HA)',
    svgPath: drawioPath('DCS-7050SX-96.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'api-gateway',
    type: 'API',
    layer: 'Technology',
    label: 'API Gateway',
    svgPath: drawioPath('DCS-7300X-64T-LC.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'api-edge',
    type: 'API',
    layer: 'Technology',
    label: 'API Edge',
    svgPath: drawioPath('DCS-7050TX-72.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'message-broker',
    type: 'MessageBroker',
    layer: 'Technology',
    label: 'Message Broker',
    svgPath: drawioPath('DCS-7300X-64S-LC.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'event-bus',
    type: 'MessageBroker',
    layer: 'Technology',
    label: 'Event Bus',
    svgPath: drawioPath('DCS-7050S-64.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'integration-platform',
    type: 'IntegrationPlatform',
    layer: 'Technology',
    label: 'Integration Platform',
    svgPath: drawioPath('DCS-7300X-32Q-LC.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'integration-hub',
    type: 'IntegrationPlatform',
    layer: 'Technology',
    label: 'Integration Hub',
    svgPath: drawioPath('DCS-7050S-52.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'cloud-service',
    type: 'CloudService',
    layer: 'Technology',
    label: 'Cloud Service',
    svgPath: drawioPath('DCS-7300-SUP.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'cloud-iaas',
    type: 'CloudService',
    layer: 'Technology',
    label: 'Cloud IaaS',
    svgPath: drawioPath('DCS-7050TX-64.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'cloud-paas',
    type: 'CloudService',
    layer: 'Technology',
    label: 'Cloud PaaS',
    svgPath: drawioPath('DCS-7050TX-48.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'cloud-saas',
    type: 'CloudService',
    layer: 'Technology',
    label: 'Cloud SaaS',
    svgPath: drawioPath('DCS-7048T-A.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },

  // Governance / Motivation (mapped)
  {
    kind: 'principle',
    type: 'Principle',
    layer: 'Governance',
    label: 'Principle',
    svgPath: svgPath('Principle.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'stakeholder',
    type: 'Principle',
    layer: 'Governance',
    label: 'Stakeholder',
    svgPath: svgPath('Stakeholder.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'driver',
    type: 'Principle',
    layer: 'Governance',
    label: 'Driver',
    svgPath: svgPath('Driver.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'goal',
    type: 'Requirement',
    layer: 'Governance',
    label: 'Goal',
    svgPath: svgPath('Goal.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'assessment',
    type: 'Requirement',
    layer: 'Governance',
    label: 'Assessment',
    svgPath: svgPath('Assessment.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'requirement',
    type: 'Requirement',
    layer: 'Governance',
    label: 'Requirement',
    svgPath: svgPath('Requirement.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'constraint',
    type: 'Standard',
    layer: 'Governance',
    label: 'Constraint',
    svgPath: svgPath('Constraint.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },

  // Implementation & Migration (mapped)
  {
    kind: 'work-package',
    type: 'Programme',
    layer: 'Implementation & Migration',
    label: 'Work Package',
    svgPath: svgPath('Work Package.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'deliverable',
    type: 'Project',
    layer: 'Implementation & Migration',
    label: 'Deliverable',
    svgPath: svgPath('Deliverable.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'implementation-event',
    type: 'Project',
    layer: 'Implementation & Migration',
    label: 'Implementation Event',
    svgPath: svgPath('Implementation Event.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'plateau',
    type: 'Programme',
    layer: 'Implementation & Migration',
    label: 'Plateau',
    svgPath: svgPath('Plateau.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
  {
    kind: 'gap',
    type: 'Programme',
    layer: 'Implementation & Migration',
    label: 'Gap',
    svgPath: svgPath('Gap.svg'),
    canvas: { shape: 'rectangle', renderer: 'svg' },
  },
];

export const EA_SHAPE_REGISTRY: EaShapeRegistryEntry[] = RAW_EA_SHAPE_REGISTRY.map((entry) => ({
  ...entry,
  style: DEFAULT_STYLE,
}));

export const EA_SHAPE_REGISTRY_BY_KIND = new Map(EA_SHAPE_REGISTRY.map((entry) => [entry.kind, entry] as const));

export const EA_SHAPE_REGISTRY_BY_TYPE = (() => {
  const map = new Map<ObjectType, EaShapeRegistryEntry[]>();
  for (const entry of EA_SHAPE_REGISTRY) {
    const existing = map.get(entry.type) ?? [];
    existing.push(entry);
    map.set(entry.type, existing);
  }
  return map;
})();

export const EA_CONNECTOR_REGISTRY: readonly EaRelationshipTypeDefinition[] = Object.values(RELATIONSHIP_TYPE_DEFINITIONS);

export const hasRegisteredEaShape = (type: ObjectType) =>
  Boolean(EA_SHAPE_REGISTRY_BY_TYPE.get(type)?.length);
