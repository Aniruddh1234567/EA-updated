import { describe, expect, test } from '@jest/globals';

import {
  getFrameworkLifecyclePolicy,
  getFrameworkObjectPolicy,
  getFrameworkPhasePolicy,
  isObjectTypeAllowedForReferenceFramework,
  isRelationshipTypeAllowedForReferenceFramework,
} from '../referenceFrameworkPolicy';

describe('referenceFrameworkPolicy', () => {
  test('ArchiMate allows only the standard internal ArchiMate-aligned relationship set', () => {
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'DECOMPOSES_TO')).toBe(true);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'COMPOSED_OF')).toBe(true);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'REALIZES')).toBe(true);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'REALIZED_BY')).toBe(true);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'TRIGGERS')).toBe(true);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'SERVED_BY')).toBe(true);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'USES')).toBe(true);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'EXPOSES')).toBe(true);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'PROVIDED_BY')).toBe(true);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'USED_BY')).toBe(true);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'INTEGRATES_WITH')).toBe(true);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'DEPENDS_ON')).toBe(false);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'CONSUMES')).toBe(true);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'DEPLOYED_ON')).toBe(true);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'IMPACTS')).toBe(true);

    // Non-standard/internal governance relationships should be blocked.
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'OWNS')).toBe(false);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'HAS')).toBe(false);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'DELIVERS')).toBe(false);
    expect(isRelationshipTypeAllowedForReferenceFramework('ArchiMate', 'SUPPORTED_BY')).toBe(false);
  });

  test('Non-ArchiMate frameworks do not add additional relationship restrictions', () => {
    expect(isRelationshipTypeAllowedForReferenceFramework('TOGAF', 'OWNS')).toBe(true);
    expect(isRelationshipTypeAllowedForReferenceFramework('Custom', 'DELIVERS')).toBe(true);
  });

  test('TOGAF enables Capabilities, Value Streams, Applications, Technologies', () => {
    const policy = getFrameworkObjectPolicy('TOGAF');
    expect(policy.allowedObjectTypes.length).toBeGreaterThan(0);
    expect(isObjectTypeAllowedForReferenceFramework('TOGAF', 'Capability')).toBe(true);
    expect(isObjectTypeAllowedForReferenceFramework('TOGAF', 'ValueStream' as any)).toBe(true);
    expect(isObjectTypeAllowedForReferenceFramework('TOGAF', 'Application')).toBe(true);
    expect(isObjectTypeAllowedForReferenceFramework('TOGAF', 'Technology')).toBe(true);
  });

  test('TOGAF lifecycle and ADM phase policies are defined', () => {
    const lifecycle = getFrameworkLifecyclePolicy('TOGAF');
    expect(lifecycle.allowedLifecycleStates).toEqual(['Baseline', 'Target']);

    const phases = getFrameworkPhasePolicy('TOGAF');
    expect(phases.allowedAdmPhases.length).toBeGreaterThan(0);
    expect(phases.allowedAdmPhases).toContain('A');
  });
});
