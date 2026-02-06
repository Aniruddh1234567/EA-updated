export type RelationshipEndpointRule = {
  from: readonly string[];
  to: readonly string[];
  /** Optional strict endpoint rules (pair-specific). When present, endpoints must match one of these pairs. */
  pairs?: readonly { from: string; to: string }[];
};

/**
 * Canonical relationship endpoint semantics.
 *
 * This is shared by:
 * - Relationship storage validation (safe writes)
 * - View definition validation (safe projections)
 * - View template instantiation (deterministic defaults)
 */
export const RELATIONSHIP_ENDPOINT_RULES: Readonly<Record<string, RelationshipEndpointRule>> = {
  // Capability decomposition (business structure)
  DECOMPOSES_TO: { from: ['Capability'], to: ['Capability'] },
  COMPOSED_OF: {
    from: ['CapabilityCategory', 'Capability', 'SubCapability'],
    to: ['CapabilityCategory', 'Capability', 'SubCapability'],
    pairs: [
      { from: 'CapabilityCategory', to: 'Capability' },
      { from: 'Capability', to: 'SubCapability' },
      { from: 'Capability', to: 'Capability' },
    ],
  },

  // Business-process realization
  REALIZES: { from: ['BusinessProcess'], to: ['Capability'] },
  // Business-process sequencing
  TRIGGERS: { from: ['BusinessProcess'], to: ['BusinessProcess'] },

  // Enterprise / organization
  OWNS: { from: ['Enterprise'], to: ['Enterprise', 'Capability', 'Application', 'Programme'] },
  HAS: { from: ['Enterprise'], to: ['Department'] },

  // Capability realization by business process
  REALIZED_BY: { from: ['Capability'], to: ['BusinessProcess'] },

  // Application services
  EXPOSES: { from: ['Application'], to: ['ApplicationService'] },
  PROVIDED_BY: { from: ['ApplicationService'], to: ['Application'] },
  USED_BY: { from: ['ApplicationService'], to: ['Application', 'BusinessProcess'] },
  SUPPORTS: { from: ['ApplicationService'], to: ['BusinessService'] },

  // Application service dependencies
  CONSUMES: { from: ['ApplicationService'], to: ['ApplicationService'] },

  // Cross-layer
  SUPPORTED_BY: {
    from: ['Capability', 'SubCapability', 'BusinessService'],
    to: ['Application', 'ApplicationService'],
    pairs: [
      { from: 'Capability', to: 'Application' },
      { from: 'SubCapability', to: 'Application' },
      { from: 'BusinessService', to: 'ApplicationService' },
    ],
  },

  // Business process served by application
  SERVED_BY: { from: ['BusinessProcess'], to: ['Application'] },

  // Application dependency / impact analysis
  INTEGRATES_WITH: { from: ['Application'], to: ['Application'] },
  DEPENDS_ON: { from: ['ApplicationService'], to: ['ApplicationService'] },
  USES: { from: ['Application'], to: ['Application'] },

  // Application-to-infrastructure deployment
  DEPLOYED_ON: {
    from: ['Application'],
    to: [
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
    ],
  },

  // Technology-to-technology connectivity
  CONNECTS_TO: {
    from: [
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
    ],
    to: [
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
    ],
  },

  // Implementation & Migration linkage
  IMPACTS: { from: ['Programme'], to: ['Capability'] },
  IMPLEMENTS: { from: ['Project'], to: ['Application'] },

  // Implementation & Migration (legacy)
  DELIVERS: { from: ['Programme'], to: ['Capability', 'Application', 'Technology'] },
} as const;

export function getRelationshipEndpointRule(type: string): RelationshipEndpointRule | null {
  const key = (type ?? '').trim();
  return RELATIONSHIP_ENDPOINT_RULES[key] ?? null;
}

export function isKnownRelationshipType(type: string): boolean {
  return Boolean(getRelationshipEndpointRule(type));
}
