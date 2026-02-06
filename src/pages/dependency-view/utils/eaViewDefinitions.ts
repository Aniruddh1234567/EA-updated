import type { ObjectType, RelationshipType } from './eaMetaModel';

export type EaViewId =
  | 'capability-map'
  | 'application-landscape'
  | 'application-dependency-impact'
  | 'technology-hosting';

export type EaViewDefinition = {
  id: EaViewId;
  title: string;
  allowedObjectTypes: readonly ObjectType[];
  allowedRelationshipTypes: readonly RelationshipType[];
  defaultLayout: 'grid' | 'cose' | 'breadthfirst';
};

export const EA_VIEWS: readonly EaViewDefinition[] = [
  {
    id: 'capability-map',
    title: 'Capability Map View',
    allowedObjectTypes: ['CapabilityCategory', 'Capability', 'SubCapability'],
    allowedRelationshipTypes: ['DECOMPOSES_TO', 'COMPOSED_OF'],
    defaultLayout: 'breadthfirst',
  },
  {
    id: 'application-landscape',
    title: 'Application Landscape View',
    allowedObjectTypes: ['Application'],
    allowedRelationshipTypes: ['INTEGRATES_WITH'],
    defaultLayout: 'cose',
  },
  {
    id: 'application-dependency-impact',
    title: 'Application Dependency / Impact View',
    allowedObjectTypes: ['Application'],
    allowedRelationshipTypes: ['INTEGRATES_WITH'],
    defaultLayout: 'grid',
  },
  {
    id: 'technology-hosting',
    title: 'Technology Deployment View',
    allowedObjectTypes: ['Application', 'Technology'],
    allowedRelationshipTypes: ['DEPLOYED_ON'],
    defaultLayout: 'cose',
  },
] as const;

export const EA_VIEW_BY_ID: Record<EaViewId, EaViewDefinition> = EA_VIEWS.reduce(
  (acc, v) => {
    acc[v.id] = v;
    return acc;
  },
  {} as Record<EaViewId, EaViewDefinition>,
);
