import { EaRepository } from '@/pages/dependency-view/utils/eaRepository';
import { validateStrictGovernance } from '../strictGovernance';

describe('validateStrictGovernance', () => {
  test('Strict blocks unnamed live objects', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'app-1', type: 'Application', attributes: { name: '' } });

    const res = validateStrictGovernance(repo, { governanceMode: 'Strict', lifecycleCoverage: 'As-Is' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const text = res.violation.highlights.join('\n');
      expect(text).toContain('Application');
      expect(text).toContain('app-1');
      expect(text).toContain('has no name');
    }
  });

  test('Strict blocks missing owner', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'app-1', type: 'Application', attributes: { name: 'Payments App' } });

    const res = validateStrictGovernance(repo, { governanceMode: 'Strict', lifecycleCoverage: 'As-Is' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const text = res.violation.highlights.join('\n');
      expect(text).toContain('Application');
      expect(text).toContain('Payments App');
      expect(text).toContain('has no owner');
    }
  });

  test('Strict blocks Capability with technical terms', () => {
    const repo = new EaRepository();

    repo.addObject({ id: 'ent-1', type: 'Enterprise', attributes: { name: 'Enterprise', ownerId: 'ent-1' } });
    repo.addObject({ id: 'cap-1', type: 'Capability', attributes: { name: 'API Enablement', ownerId: 'ent-1' } });

    // Ownership requirements (governanceValidation rule #1)
    repo.addRelationship({ fromId: 'ent-1', toId: 'cap-1', type: 'OWNS', attributes: {} });

    const res = validateStrictGovernance(repo, { governanceMode: 'Strict', lifecycleCoverage: 'As-Is' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const text = res.violation.highlights.join('\n');
      expect(text).toContain('Capability');
      expect(text).toContain('API Enablement');
      expect(text).toContain('technical term');
    }
  });

  test('Strict blocks ApplicationService without exactly one Application provider', () => {
    const repo = new EaRepository();

    repo.addObject({ id: 'ent-1', type: 'Enterprise', attributes: { name: 'Enterprise', ownerId: 'ent-1' } });
    repo.addObject({ id: 'app-1', type: 'Application', attributes: { name: 'App One', ownerId: 'ent-1' } });
    repo.addObject({ id: 'as-1', type: 'ApplicationService', attributes: { name: 'Service One', ownerId: 'ent-1' } });

    // Ownership requirements (governanceValidation rule #1)
    repo.addRelationship({ fromId: 'ent-1', toId: 'app-1', type: 'OWNS', attributes: {} });

    // Intentionally omit PROVIDED_BY to trigger the required relationship check.

    const res = validateStrictGovernance(repo, { governanceMode: 'Strict', lifecycleCoverage: 'As-Is' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const text = res.violation.highlights.join('\n');
      expect(text).toContain('Application Service');
      expect(text).toContain('Service One');
      expect(text).toContain('must belong to exactly one Application');
    }
  });

  test('Advisory does not block', () => {
    const repo = new EaRepository();
    repo.addObject({ id: 'app-1', type: 'Application', attributes: { name: '' } });

    const res = validateStrictGovernance(repo, { governanceMode: 'Advisory', lifecycleCoverage: 'As-Is' });
    expect(res.ok).toBe(true);
  });
});
