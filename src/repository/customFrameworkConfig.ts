import { isValidObjectType, isValidRelationshipType, type ObjectType, type RelationshipType } from '@/pages/dependency-view/utils/eaMetaModel';
import type { FrameworkConfig, ReferenceFramework } from './repositoryMetadata';

export type CustomMetaModelConfig = {
  /**
   * In Custom framework, element types must be explicitly enabled before modeling is allowed.
   * Empty list means "modeling disabled".
   */
  enabledObjectTypes: readonly ObjectType[];
  /**
   * Enabled relationship types for the Custom framework metamodel.
   * Empty list means "no relationship types enabled".
   */
  enabledRelationshipTypes: readonly RelationshipType[];
};

export const CUSTOM_CORE_EA_SEED: CustomMetaModelConfig = {
  enabledObjectTypes: [
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
  ],
  enabledRelationshipTypes: [
    'OWNS',
    'SUPPORTS',
    'DEPENDS_ON',
    'REALIZES',
    'REALIZED_BY',
    'TRIGGERS',
    'SERVED_BY',
    'EXPOSES',
    'PROVIDED_BY',
    'USED_BY',
    'USES',
    'INTEGRATES_WITH',
    'DEPLOYED_ON',
  ],
};

export const normalizeCustomMetaModelConfig = (value: unknown): CustomMetaModelConfig => {
  const v = value as any;
  const raw = Array.isArray(v?.enabledObjectTypes) ? (v.enabledObjectTypes as unknown[]) : [];
  const rawRelationships = Array.isArray(v?.enabledRelationshipTypes) ? (v.enabledRelationshipTypes as unknown[]) : [];

  const out: ObjectType[] = [];
  for (const t of raw) {
    if (!isValidObjectType(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  out.sort((a, b) => a.localeCompare(b));

  const rels: RelationshipType[] = [];
  for (const t of rawRelationships) {
    if (!isValidRelationshipType(t)) continue;
    if (!rels.includes(t)) rels.push(t);
  }
  rels.sort((a, b) => a.localeCompare(b));

  return { enabledObjectTypes: out, enabledRelationshipTypes: rels };
};

export const DEFAULT_CUSTOM_META_MODEL_CONFIG: CustomMetaModelConfig = normalizeCustomMetaModelConfig(CUSTOM_CORE_EA_SEED);

export const getCustomMetaModelConfig = (frameworkConfig: FrameworkConfig | null | undefined): CustomMetaModelConfig => {
  if (!frameworkConfig?.custom) return DEFAULT_CUSTOM_META_MODEL_CONFIG;
  const raw = frameworkConfig.custom as any;
  const hasObjectTypes = Array.isArray(raw?.enabledObjectTypes);
  const hasRelationshipTypes = Array.isArray(raw?.enabledRelationshipTypes);
  if (!hasObjectTypes && !hasRelationshipTypes) {
    return DEFAULT_CUSTOM_META_MODEL_CONFIG;
  }
  return normalizeCustomMetaModelConfig(frameworkConfig.custom);
};

export const isCustomFrameworkModelingEnabled = (
  referenceFramework: ReferenceFramework | null | undefined,
  frameworkConfig: FrameworkConfig | null | undefined,
): boolean => {
  if (referenceFramework !== 'Custom') return true;
  return getCustomMetaModelConfig(frameworkConfig).enabledObjectTypes.length > 0;
};

export const isObjectTypeEnabledForFramework = (
  referenceFramework: ReferenceFramework | null | undefined,
  frameworkConfig: FrameworkConfig | null | undefined,
  objectType: ObjectType,
): boolean => {
  if (referenceFramework !== 'Custom') return true;
  const enabled = getCustomMetaModelConfig(frameworkConfig).enabledObjectTypes;
  return enabled.includes(objectType);
};
