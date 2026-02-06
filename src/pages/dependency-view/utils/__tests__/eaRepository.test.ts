import { EaRepository } from '../eaRepository';

describe('EaRepository metamodel enforcement', () => {
  test('rejects relationships with invalid endpoint types', () => {
    const repo = new EaRepository();

    // Strategy + Application objects
    expect(repo.addObject({ id: 'prog-1', type: 'Programme', attributes: { name: 'Prog' } }).ok).toBe(true);
    expect(repo.addObject({ id: 'ent-1', type: 'Enterprise', attributes: { name: 'Enterprise' } }).ok).toBe(true);
    expect(repo.addObject({ id: 'app-1', type: 'Application', attributes: { name: 'App' } }).ok).toBe(true);
    expect(repo.addObject({ id: 'tech-1', type: 'Technology', attributes: { name: 'Tech' } }).ok).toBe(true);

    // OWNS is Enterprise -> Application; this should fail (Programme -> Application)
    const invalid = repo.addRelationship({ fromId: 'prog-1', toId: 'app-1', type: 'OWNS' });
    expect(invalid.ok).toBe(false);

    // OWNS should pass for Enterprise -> Application
    const ownsOk = repo.addRelationship({ fromId: 'ent-1', toId: 'app-1', type: 'OWNS' });
    expect(ownsOk.ok).toBe(true);

    // DEPLOYED_ON is Application -> Technology; this should pass
    const ok = repo.addRelationship({ fromId: 'app-1', toId: 'tech-1', type: 'DEPLOYED_ON' });
    expect(ok.ok).toBe(true);
  });
});
