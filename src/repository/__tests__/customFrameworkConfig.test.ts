import {
  getCustomMetaModelConfig,
  isCustomFrameworkModelingEnabled,
  isObjectTypeEnabledForFramework,
  normalizeCustomMetaModelConfig,
} from '../customFrameworkConfig';

describe('Custom framework config', () => {
  test('normalizes enabledObjectTypes (dedupe + sort + filter invalid)', () => {
    const cfg = normalizeCustomMetaModelConfig({ enabledObjectTypes: ['Application', 'BadType', 'Capability', 'Application'] });
    expect(cfg.enabledObjectTypes).toEqual(['Application', 'Capability']);
  });

  test('normalizes enabledRelationshipTypes (dedupe + sort + filter invalid)', () => {
    const cfg = normalizeCustomMetaModelConfig({
      enabledRelationshipTypes: ['REALIZES', 'BadRel', 'OWNS', 'REALIZES', 'TRIGGERS', 'SERVED_BY', 'EXPOSES', 'USES'],
    });
    expect(cfg.enabledRelationshipTypes).toEqual(['EXPOSES', 'OWNS', 'REALIZES', 'SERVED_BY', 'TRIGGERS', 'USES']);
  });

  test('getCustomMetaModelConfig defaults to Custom core seed', () => {
    expect(getCustomMetaModelConfig(undefined).enabledObjectTypes).toEqual([
      'Application',
      'Capability',
      'Enterprise',
      'Technology',
      'ValueStream',
    ]);
    expect(getCustomMetaModelConfig(undefined).enabledRelationshipTypes).toEqual([
      'DEPENDS_ON',
      'DEPLOYED_ON',
      'EXPOSES',
      'INTEGRATES_WITH',
      'OWNS',
      'PROVIDED_BY',
      'REALIZED_BY',
      'REALIZES',
      'SERVED_BY',
      'SUPPORTS',
      'TRIGGERS',
      'USED_BY',
      'USES',
    ]);
    expect(getCustomMetaModelConfig(null).enabledObjectTypes).toEqual([
      'Application',
      'Capability',
      'Enterprise',
      'Technology',
      'ValueStream',
    ]);
  });

  test('missing Custom config falls back to seed, explicit empty stays empty', () => {
    expect(getCustomMetaModelConfig({ custom: {} as any }).enabledObjectTypes.length).toBeGreaterThan(0);
    expect(getCustomMetaModelConfig({ custom: { enabledObjectTypes: [], enabledRelationshipTypes: [] } }).enabledObjectTypes).toEqual([]);
  });

  test('Custom modeling disabled until at least one type enabled', () => {
    expect(isCustomFrameworkModelingEnabled('Custom', { custom: { enabledObjectTypes: [] } })).toBe(false);
    expect(isCustomFrameworkModelingEnabled('Custom', { custom: { enabledObjectTypes: ['Application'] } })).toBe(true);
  });

  test('object type enablement is enforced only for Custom', () => {
    expect(isObjectTypeEnabledForFramework('Custom', { custom: { enabledObjectTypes: ['Application'] } }, 'Application')).toBe(true);
    expect(isObjectTypeEnabledForFramework('Custom', { custom: { enabledObjectTypes: ['Application'] } }, 'Capability')).toBe(false);

    // Non-Custom frameworks should behave as "no restriction".
    expect(isObjectTypeEnabledForFramework('ArchiMate', null, 'Capability')).toBe(true);
    expect(isCustomFrameworkModelingEnabled('ArchiMate', null)).toBe(true);
  });
});
