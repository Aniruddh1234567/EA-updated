import {
  type ObjectType,
  type RelationshipType,
  isValidObjectType,
  isValidRelationshipType,
  RELATIONSHIP_TYPE_DEFINITIONS,
} from './eaMetaModel';

export type EaObject = {
  id: string;
  type: ObjectType;
  attributes: Record<string, unknown>;
};

export type EaRelationship = {
  /** Immutable relationship identity (UUID-ish). Optional for imports; assigned on insert. */
  id?: string;
  fromId: string;
  toId: string;
  type: RelationshipType;
  attributes: Record<string, unknown>;
};

export type EaPersistedRelationship = Omit<EaRelationship, 'id'> & { id: string };

const makeRelationshipId = (): string => {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch {
    // ignore
  }
  return `rel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const nowIso = () => new Date().toISOString();

export type EaRepositoryAddSuccess = { ok: true };
export type EaRepositoryAddFailure = { ok: false; error: string };
export type EaRepositoryAddResult = EaRepositoryAddSuccess | EaRepositoryAddFailure;

export type EaRepositoryValidateSuccess = { ok: true };
export type EaRepositoryValidateFailure = { ok: false; error: string };
export type EaRepositoryValidateResult = EaRepositoryValidateSuccess | EaRepositoryValidateFailure;

export class EaRepository {
  objects: Map<string, EaObject>;

  relationships: EaPersistedRelationship[];

  constructor(opts?: { objects?: Iterable<EaObject>; relationships?: Iterable<EaRelationship> }) {
    this.objects = new Map();
    this.relationships = [];

    if (opts?.objects) {
      for (const obj of opts.objects) {
        // Best-effort load; ignore invalid items.
        const res = this.addObject(obj);
        if (!res.ok) continue;
      }
    }

    if (opts?.relationships) {
      for (const rel of opts.relationships) {
        const res = this.addRelationship(rel);
        if (!res.ok) continue;
      }
    }
  }

  clone(): EaRepository {
    const next = new EaRepository();
    for (const [id, obj] of this.objects) {
      next.objects.set(id, { ...obj, attributes: { ...obj.attributes } });
    }
    next.relationships = this.relationships.map((r) => ({ ...r, attributes: { ...r.attributes } }));
    return next;
  }

  // Contract: addObject inserts exactly one element; it must never auto-create other elements.
  addObject(object: { id: string; type: unknown; attributes?: Record<string, unknown> }): EaRepositoryAddResult {
    const id = (object.id ?? '').trim();
    if (!id) return { ok: false, error: 'Object id is required.' };

    if (!isValidObjectType(object.type)) {
      return { ok: false, error: `Invalid object type "${String(object.type)}".` };
    }

    if (this.objects.has(id)) {
      return { ok: false, error: `Duplicate object id "${id}".` };
    }

    this.objects.set(id, {
      id,
      type: object.type,
      attributes: object.attributes ?? {},
    });

    return { ok: true };
  }

  addRelationship(rel: {
    id?: string;
    fromId: string;
    toId: string;
    type: unknown;
    attributes?: Record<string, unknown>;
  }): EaRepositoryAddResult {
    const fromId = (rel.fromId ?? '').trim();
    const toId = (rel.toId ?? '').trim();

    if (!fromId) return { ok: false, error: 'Relationship fromId is required.' };
    if (!toId) return { ok: false, error: 'Relationship toId is required.' };

    if (!isValidRelationshipType(rel.type)) {
      return { ok: false, error: `Invalid relationship type "${String(rel.type)}".` };
    }

    const fromRef = this.validateReference(fromId);
    if (!fromRef.ok) return { ok: false, error: fromRef.error };

    const toRef = this.validateReference(toId);
    if (!toRef.ok) return { ok: false, error: toRef.error };

    // Metamodel enforcement: endpoints must be allowed for the relationship type.
    const relationshipTypeDef = RELATIONSHIP_TYPE_DEFINITIONS[rel.type];
    if (!relationshipTypeDef) {
      return { ok: false, error: `Invalid relationship type "${String(rel.type)}" (no definition).` };
    }

    const fromObj = this.objects.get(fromId);
    const toObj = this.objects.get(toId);

    // validateReference already checked existence, but keep this defensive.
    if (!fromObj) return { ok: false, error: `Unknown object id "${fromId}".` };
    if (!toObj) return { ok: false, error: `Unknown object id "${toId}".` };

    const fromType: ObjectType = fromObj.type;
    const toType: ObjectType = toObj.type;

    const pairs = (relationshipTypeDef as any)?.allowedEndpointPairs as
      | ReadonlyArray<{ from: ObjectType; to: ObjectType }>
      | undefined;

    if (Array.isArray(pairs) && pairs.length > 0) {
      const ok = pairs.some((p) => p.from === fromType && p.to === toType);
      if (!ok) {
        return {
          ok: false,
          error: `Invalid endpoints for relationship type "${rel.type}" ("${fromType}" -> "${toType}").`,
        };
      }
    } else if (!relationshipTypeDef.fromTypes.includes(fromType) || !relationshipTypeDef.toTypes.includes(toType)) {
      return {
        ok: false,
        error: `Invalid endpoints for relationship type "${rel.type}" ("${fromType}" -> "${toType}").`,
      };
    }

    const relationshipId = (rel.id ?? '').trim() || makeRelationshipId();
    const attrs = { ...(rel.attributes ?? {}) };
    const createdAt = typeof (attrs as any)?.createdAt === 'string' && String((attrs as any).createdAt).trim()
      ? String((attrs as any).createdAt)
      : nowIso();
    const lastModifiedAt = typeof (attrs as any)?.lastModifiedAt === 'string' && String((attrs as any).lastModifiedAt).trim()
      ? String((attrs as any).lastModifiedAt)
      : createdAt;
    (attrs as any).createdAt = createdAt;
    (attrs as any).lastModifiedAt = lastModifiedAt;

    this.relationships.push({
      id: relationshipId,
      fromId,
      toId,
      type: rel.type,
      attributes: attrs,
    });

    return { ok: true };
  }

  /**
   * Advisory-mode helper: inserts a relationship without enforcing endpoint type rules.
   *
   * Still enforces:
   * - non-empty fromId/toId
   * - known relationship type
   * - non-dangling references
   */
  addRelationshipUnchecked(rel: {
    id?: string;
    fromId: string;
    toId: string;
    type: unknown;
    attributes?: Record<string, unknown>;
  }): EaRepositoryAddResult {
    const fromId = (rel.fromId ?? '').trim();
    const toId = (rel.toId ?? '').trim();

    if (!fromId) return { ok: false, error: 'Relationship fromId is required.' };
    if (!toId) return { ok: false, error: 'Relationship toId is required.' };

    if (!isValidRelationshipType(rel.type)) {
      return { ok: false, error: `Invalid relationship type "${String(rel.type)}".` };
    }

    const fromRef = this.validateReference(fromId);
    if (!fromRef.ok) return { ok: false, error: fromRef.error };

    const toRef = this.validateReference(toId);
    if (!toRef.ok) return { ok: false, error: toRef.error };

    const relationshipId = (rel.id ?? '').trim() || makeRelationshipId();
    const attrs = { ...(rel.attributes ?? {}) };
    const createdAt = typeof (attrs as any)?.createdAt === 'string' && String((attrs as any).createdAt).trim()
      ? String((attrs as any).createdAt)
      : nowIso();
    const lastModifiedAt = typeof (attrs as any)?.lastModifiedAt === 'string' && String((attrs as any).lastModifiedAt).trim()
      ? String((attrs as any).lastModifiedAt)
      : createdAt;
    (attrs as any).createdAt = createdAt;
    (attrs as any).lastModifiedAt = lastModifiedAt;

    this.relationships.push({
      id: relationshipId,
      fromId,
      toId,
      type: rel.type,
      attributes: attrs,
    });

    return { ok: true };
  }

  getObjectsByType(type: unknown): EaObject[] {
    if (!isValidObjectType(type)) return [];

    const results: EaObject[] = [];
    for (const obj of this.objects.values()) {
      if (obj.type === type) results.push(obj);
    }
    return results;
  }

  getRelationshipsByType(type: unknown): EaRelationship[] {
    if (!isValidRelationshipType(type)) return [];
    return this.relationships.filter((r) => r.type === type);
  }

  validateReference(id: string): EaRepositoryValidateResult {
    const key = (id ?? '').trim();
    if (!key) return { ok: false, error: 'Reference id is required.' };

    if (!this.objects.has(key)) {
      return { ok: false, error: `Unknown object id "${key}".` };
    }

    return { ok: true };
  }

  updateObjectAttributes(id: string, patch: Record<string, unknown>, mode: 'merge' | 'replace' = 'merge'): EaRepositoryAddResult {
    const key = (id ?? '').trim();
    if (!key) return { ok: false, error: 'Object id is required.' };

    const existing = this.objects.get(key);
    if (!existing) return { ok: false, error: `Unknown object id "${key}".` };

    const nextAttributes = mode === 'replace' ? { ...(patch ?? {}) } : { ...existing.attributes, ...(patch ?? {}) };
    this.objects.set(key, { ...existing, attributes: nextAttributes });
    return { ok: true };
  }
}
