import React from 'react';

import { message, notification } from '@/ea/eaConsole';

import { EaRepository, type EaObject, type EaRelationship } from '@/pages/dependency-view/utils/eaRepository';
import {
  type EaRepositoryMetadata,
  validateRepositoryMetadata,
} from '@/repository/repositoryMetadata';
import { getReadOnlyReason, isAnyObjectTypeWritableForScope } from '@/repository/architectureScopePolicy';
import {
  getFrameworkLifecyclePolicy,
  getFrameworkObjectPolicy,
  getFrameworkPhasePolicy,
  isAdmPhaseAllowedForReferenceFramework,
  isLifecycleStateAllowedForReferenceFramework,
  isRelationshipTypeAllowedForReferenceFramework,
} from '@/repository/referenceFrameworkPolicy';
import {
  CUSTOM_CORE_EA_SEED,
  getCustomMetaModelConfig,
  isCustomFrameworkModelingEnabled,
  isObjectTypeEnabledForFramework,
} from '@/repository/customFrameworkConfig';
import { RELATIONSHIP_TYPE_DEFINITIONS } from '@/pages/dependency-view/utils/eaMetaModel';
import { getCurrentUserOrThrow } from '@/repository/currentUser';
import { ENABLE_RBAC, validateExclusiveRoleBindings, type RepositoryRoleBinding } from '@/repository/accessControl';
import { ViewStore } from '@/diagram-studio/view-runtime/ViewStore';
import { ViewLayoutStore } from '@/diagram-studio/view-runtime/ViewLayoutStore';
import { DesignWorkspaceStore, type DesignWorkspace } from '@/ea/DesignWorkspaceStore';
import {
  REPOSITORY_SNAPSHOT_STORAGE_KEY,
  type RepositorySnapshot,
  readRepositorySnapshot,
  writeRepositorySnapshot,
} from '@/repository/repositorySnapshotStore';
import type { ViewInstance } from '@/diagram-studio/viewpoints/ViewInstance';

import { buildGovernanceDebt } from './governanceValidation';
import { appendGovernanceLog } from './governanceLog';
import { validateStrictGovernance } from './strictGovernance';

export type EaRepositoryContextValue = {
  eaRepository: EaRepository | null;
  metadata: EaRepositoryMetadata | null;
  loading: boolean;
  initializationState: { status: 'initialized' | 'uninitialized'; reason: string | null };
  setEaRepository: React.Dispatch<React.SetStateAction<EaRepository | null>>;
  trySetEaRepository: (next: EaRepository) => { ok: true } | { ok: false; error: string };
  updateRepositoryMetadata: (patch: Partial<EaRepositoryMetadata>) => { ok: true } | { ok: false; error: string };
  createNewRepository: (input: Omit<EaRepositoryMetadata, 'createdAt' | 'owner'>) => { ok: true } | { ok: false; error: string };
  loadRepositoryFromJsonText: (jsonText: string) => { ok: true } | { ok: false; error: string };
  clearRepository: () => void;

  /** Repository-level history (undo/redo). */
  canUndo: boolean;
  canRedo: boolean;
  undo: () => boolean;
  redo: () => boolean;
};

const EaRepositoryContext = React.createContext<EaRepositoryContextValue | undefined>(undefined);

const STORAGE_KEY = REPOSITORY_SNAPSHOT_STORAGE_KEY;
const PROJECT_DIRTY_KEY = 'ea.project.dirty';
const PROJECT_STATUS_EVENT = 'ea:projectStatusChanged';
const ACTIVE_REPO_ID_KEY = 'ea.repository.activeId';
const ACTIVE_REPO_NAME_KEY = 'ea.repository.activeName';
const HISTORY_LIMIT = 50;

const safeParseJson = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const readLocalStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const stableStringify = (value: unknown): string => {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number' || t === 'boolean') return String(value);
  if (t === 'undefined') return 'undefined';
  if (t !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
};

const hasRepositoryChanges = (prev: EaRepository | null, next: EaRepository | null): boolean => {
  if (!prev || !next) return false;

  if (prev.objects.size !== next.objects.size) return true;
  if (prev.relationships.length !== next.relationships.length) return true;

  for (const [id, obj] of prev.objects) {
    const nextObj = next.objects.get(id);
    if (!nextObj) return true;
    if (obj.type !== nextObj.type) return true;
    const attrsA = stableStringify(obj.attributes ?? {});
    const attrsB = stableStringify(nextObj.attributes ?? {});
    if (attrsA !== attrsB) return true;
  }

  const normalizeRel = (r: { fromId: string; toId: string; type: string; attributes?: Record<string, unknown> }) =>
    stableStringify({ fromId: r.fromId, toId: r.toId, type: r.type, attributes: r.attributes ?? {} });

  const prevRels = prev.relationships.map(normalizeRel).sort();
  const nextRels = next.relationships.map(normalizeRel).sort();
  for (let i = 0; i < prevRels.length; i += 1) {
    if (prevRels[i] !== nextRels[i]) return true;
  }

  return false;
};

const hasReadOnlyObjectChanges = (
  prev: EaRepository | null,
  next: EaRepository | null,
  architectureScope: EaRepositoryMetadata['architectureScope'] | null,
): boolean => {
  if (architectureScope !== 'Business Unit' && architectureScope !== 'Domain' && architectureScope !== 'Programme') {
    return false;
  }
  if (!prev || !next) return false;

  // In scoped modes, block any add/remove/change to objects outside the scope's writable layers.
  const prevById = prev.objects;
  const nextById = next.objects;

  const ids = new Set<string>();
  for (const id of prevById.keys()) ids.add(id);
  for (const id of nextById.keys()) ids.add(id);

  for (const id of ids) {
    const a = prevById.get(id);
    const b = nextById.get(id);

    const typeA = (a?.type ?? null) as string | null;
    const typeB = (b?.type ?? null) as string | null;

    // If either side is a non-writable type, any structural change is not allowed.
    const writableA = isAnyObjectTypeWritableForScope(architectureScope, typeA);
    const writableB = isAnyObjectTypeWritableForScope(architectureScope, typeB);

    if (!writableA || !writableB) {
      if (!a || !b) return true;
      if (a.type !== b.type) return true;
      const attrsA = stableStringify(a.attributes ?? {});
      const attrsB = stableStringify(b.attributes ?? {});
      if (attrsA !== attrsB) return true;
    }
  }

  return false;
};

const countLiveObjectsByType = (repo: EaRepository, type: string): number => {
  let count = 0;
  for (const obj of repo.objects.values()) {
    if (obj.type !== type) continue;
    if ((obj.attributes as any)?._deleted === true) continue;
    count += 1;
  }
  return count;
};

const hasLiveNonEnterpriseObjects = (repo: EaRepository): boolean => {
  for (const obj of repo.objects.values()) {
    if ((obj.attributes as any)?._deleted === true) continue;
    if (obj.type !== 'Enterprise') return true;
  }
  return false;
};

const isRepositoryInitialized = (repo: EaRepository | null): boolean => {
  if (!repo) return false;
  return countLiveObjectsByType(repo, 'Enterprise') > 0;
};

const hasBusinessUnitScopeViolations = (repo: EaRepository, initialized: boolean): string | null => {
  // Business Unit scope is intentionally constrained:
  // - exactly one root Enterprise is required (after initialization)
  // - Enterprise->Enterprise ownership (OWNS) is disabled
  if (!initialized) return null;

  const enterpriseCount = countLiveObjectsByType(repo, 'Enterprise');
  if (enterpriseCount < 1) {
    return 'Business Unit scope requires exactly one Enterprise root.';
  }
  if (enterpriseCount > 1) {
    return 'Business Unit scope requires exactly one Enterprise root.';
  }

  for (const r of repo.relationships) {
    if (r.type !== 'OWNS') continue;
    const from = repo.objects.get(r.fromId);
    const to = repo.objects.get(r.toId);
    if (!from || !to) continue;
    if ((from.attributes as any)?._deleted === true) continue;
    if ((to.attributes as any)?._deleted === true) continue;
    if (from.type === 'Enterprise' && to.type === 'Enterprise') {
      return 'Enterprise-to-Enterprise ownership is disabled in Business Unit scope.';
    }
  }

  return null;
};

const normalizeDomainId = (value: unknown): string | null => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  return raw.toLowerCase();
};

const getObjectDomainId = (obj: EaObject | undefined): string | null => {
  if (!obj) return null;
  return normalizeDomainId((obj.attributes as any)?.domainId);
};

const hasDomainScopeRelationshipViolations = (repo: EaRepository, currentDomainId: string | null): string | null => {
  const current = normalizeDomainId(currentDomainId);
  for (const r of repo.relationships) {
    const from = repo.objects.get(r.fromId);
    const to = repo.objects.get(r.toId);
    if (!from || !to) continue;
    if ((from.attributes as any)?._deleted === true) continue;
    if ((to.attributes as any)?._deleted === true) continue;

    const fromDomain = getObjectDomainId(from) ?? current;
    const toDomain = getObjectDomainId(to) ?? current;
    if (fromDomain && toDomain && fromDomain !== toDomain) {
      return 'Cross-domain relationships are blocked in Domain scope.';
    }
  }
  return null;
};

const hasProgrammeScopeViolations = (repo: EaRepository): string | null => {
  const programmeCount = countLiveObjectsByType(repo, 'Programme');
  if (programmeCount > 0) return null;

  // No Programmes yet: block creation of any other live elements.
  for (const obj of repo.objects.values()) {
    if ((obj.attributes as any)?._deleted === true) continue;
    if (obj.type === 'Programme') continue;
    return 'Programme scope requires at least one Programme before creating other elements.';
  }

  return null;
};

const hasReferenceFrameworkViolations = (
  repo: EaRepository,
  referenceFramework: EaRepositoryMetadata['referenceFramework'] | null,
  frameworkConfig: EaRepositoryMetadata['frameworkConfig'] | null | undefined,
): string | null => {
  if (!referenceFramework) return null;

  // ArchiMate: allow only a conservative, ArchiMate-aligned relationship subset.
  if (referenceFramework === 'ArchiMate') {
    for (const r of repo.relationships) {
      if (!isRelationshipTypeAllowedForReferenceFramework(referenceFramework, r.type)) {
        return `ArchiMate reference framework allows standard ArchiMate relationship set only (blocked: ${r.type}).`;
      }

      // Defensive: ensure endpoints still satisfy the active meta-model.
      const def = RELATIONSHIP_TYPE_DEFINITIONS[r.type];
      const from = repo.objects.get(r.fromId);
      const to = repo.objects.get(r.toId);
      if (!def || !from || !to) {
        return `ArchiMate reference framework blocked invalid relationship ${r.type} (${r.fromId} → ${r.toId}).`;
      }

      if (!def.fromTypes.includes(from.type as any) || !def.toTypes.includes(to.type as any)) {
        return `ArchiMate reference framework blocked invalid endpoints for ${r.type} (${from.type} → ${to.type}).`;
      }
    }
  }

  if (referenceFramework === 'TOGAF') {
    const objectPolicy = getFrameworkObjectPolicy(referenceFramework);
    const lifecyclePolicy = getFrameworkLifecyclePolicy(referenceFramework);
    const phasePolicy = getFrameworkPhasePolicy(referenceFramework);

    // Enforce enabled element set (Capabilities, Value Streams, Applications, Technologies + Enterprise scaffolding).
    if (objectPolicy.allowedObjectTypes.length > 0) {
      for (const obj of repo.objects.values()) {
        if ((obj.attributes as any)?._deleted === true) continue;
        if (!objectPolicy.allowedObjectTypes.includes(obj.type as any)) {
          return `TOGAF reference framework does not enable element type "${obj.type}".`;
        }

        // ADM phase metadata required.
        const phase = typeof (obj.attributes as any)?.admPhase === 'string' ? String((obj.attributes as any).admPhase).trim() : '';
        if (!phase) {
          return `TOGAF repositories require ADM phase metadata (missing on ${obj.type} ${obj.id}).`;
        }
        if (!isAdmPhaseAllowedForReferenceFramework(referenceFramework, phase)) {
          return `Invalid ADM phase "${phase}" on ${obj.type} ${obj.id}.`;
        }
        if (phasePolicy.allowedAdmPhases.length > 0 && !phasePolicy.allowedAdmPhases.includes(phase)) {
          return `Invalid ADM phase "${phase}" on ${obj.type} ${obj.id}.`;
        }

        // ADM lifecycle states (Baseline/Target).
        const lifecycleState = typeof (obj.attributes as any)?.lifecycleState === 'string'
          ? String((obj.attributes as any).lifecycleState).trim()
          : '';
        if (!lifecycleState) {
          return `TOGAF repositories require lifecycleState (missing on ${obj.type} ${obj.id}).`;
        }
        if (!isLifecycleStateAllowedForReferenceFramework(referenceFramework, lifecycleState)) {
          return `Invalid lifecycleState "${lifecycleState}" on ${obj.type} ${obj.id}.`;
        }
        if (lifecyclePolicy.allowedLifecycleStates.length > 0 && !lifecyclePolicy.allowedLifecycleStates.includes(lifecycleState)) {
          return `Invalid lifecycleState "${lifecycleState}" on ${obj.type} ${obj.id}.`;
        }
      }
    }
  }

  if (referenceFramework === 'Custom') {
    // Custom: no assumptions. Until user enables at least one element type, ALL modeling is disabled.
    if (!isCustomFrameworkModelingEnabled(referenceFramework, frameworkConfig ?? undefined)) {
      for (const obj of repo.objects.values()) {
        if ((obj.attributes as any)?._deleted === true) continue;
        return 'Custom reference framework: modeling is disabled until you enable at least one element type in the meta-model editor.';
      }
      if (repo.relationships.length > 0) {
        return 'Custom reference framework: modeling is disabled until you enable at least one element type in the meta-model editor.';
      }
      return null;
    }

    // If enabled types are configured, block anything outside that set.
    const custom = getCustomMetaModelConfig(frameworkConfig ?? undefined);
    for (const obj of repo.objects.values()) {
      if ((obj.attributes as any)?._deleted === true) continue;
      if (!isObjectTypeEnabledForFramework('Custom', frameworkConfig ?? undefined, obj.type as any)) {
        return `Custom reference framework: element type "${obj.type}" is not enabled.`;
      }
    }
    for (const r of repo.relationships) {
      const from = repo.objects.get(r.fromId);
      const to = repo.objects.get(r.toId);
      if (!from || !to) continue;
      if ((from.attributes as any)?._deleted === true) continue;
      if ((to.attributes as any)?._deleted === true) continue;
      if (!custom.enabledObjectTypes.includes(from.type as any) || !custom.enabledObjectTypes.includes(to.type as any)) {
        return 'Custom reference framework: relationships require enabled endpoint types.';
      }
    }
  }

  return null;
};

const freezeMetadata = (metadata: EaRepositoryMetadata): EaRepositoryMetadata => {
  // Shallow-freeze is sufficient: metadata is primitives only.
  return Object.freeze({ ...metadata });
};

type SerializedRepository = RepositorySnapshot;

const rbacStorageKey = (repositoryName: string) => `ea.rbac.bindings.${repositoryName}`;

const ensureOwnerBinding = (metadata: EaRepositoryMetadata): { ok: true; bindings: RepositoryRoleBinding[] } | { ok: false; error: string } => {
  const key = rbacStorageKey(metadata.repositoryName);
  try {
    const raw = localStorage.getItem(key);
    const existing: RepositoryRoleBinding[] = raw ? (JSON.parse(raw) as RepositoryRoleBinding[]) : [];
    const dedup = new Map<string, RepositoryRoleBinding>();
    // Always include owner binding from metadata even if storage is empty/unwritable.
    dedup.set(`${metadata.owner.userId}::Owner`, { userId: metadata.owner.userId, role: 'Owner' });
    dedup.set(`${metadata.owner.userId}::Architect`, { userId: metadata.owner.userId, role: 'Architect' });
    for (const b of existing) {
      if (!b?.userId || !b?.role) continue;
      dedup.set(`${b.userId}::${b.role}`, { userId: b.userId, role: b.role });
    }
    const bindings = Array.from(dedup.values());
    const validation = validateExclusiveRoleBindings(bindings);
    if (!validation.ok) return { ok: false, error: validation.error };
    try {
      localStorage.setItem(key, JSON.stringify(bindings));
    } catch {
      // If persistence fails, continue with in-memory bindings.
    }
    return { ok: true, bindings };
  } catch (e: any) {
    // Still return the owner-only binding to avoid blocking creation/load when storage is unavailable.
    return { ok: true, bindings: [{ userId: metadata.owner.userId, role: 'Owner' }] };
  }
};

const validateCurrentUserBinding = (metadata: EaRepositoryMetadata): { ok: true } | { ok: false; error: string } => {
  let currentUserId: string;
  try {
    currentUserId = getCurrentUserOrThrow().id;
  } catch {
    return { ok: false, error: 'No active user context.' };
  }

  try {
    const raw = localStorage.getItem(rbacStorageKey(metadata.repositoryName));
    const stored: RepositoryRoleBinding[] = raw ? (JSON.parse(raw) as RepositoryRoleBinding[]) : [];
    const dedup = new Map<string, RepositoryRoleBinding>();
    // Always include owner + architect from metadata to avoid failures when storage was empty.
    dedup.set(`${metadata.owner.userId}::Owner`, { userId: metadata.owner.userId, role: 'Owner' });
    dedup.set(`${metadata.owner.userId}::Architect`, { userId: metadata.owner.userId, role: 'Architect' });
    for (const b of stored) {
      if (!b?.userId || !b?.role) continue;
      dedup.set(`${b.userId}::${b.role}`, { userId: b.userId, role: b.role });
    }
    const bindings = Array.from(dedup.values());
    const validation = validateExclusiveRoleBindings(bindings);
    if (!validation.ok) return { ok: false, error: validation.error };

    const roleCount = bindings.filter((b) => b.userId === currentUserId).length;
    if (roleCount < 1) {
      return { ok: false, error: 'RBAC inconsistency: current user must have at least one role for this repository.' };
    }
    const ownerExists = bindings.some((b) => b.role === 'Owner');
    if (!ownerExists) {
      return { ok: false, error: 'RBAC inconsistency: Owner role is missing for this repository.' };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'RBAC consistency check failed.' };
  }
};

const serializeRepository = (repo: EaRepository, metadata: EaRepositoryMetadata): SerializedRepository => {
  const repositoryName = metadata.repositoryName || 'default';
  const existingSnapshot = readRepositorySnapshot();
  const isSameRepository = existingSnapshot?.metadata?.repositoryName === metadata.repositoryName;

  const views = isSameRepository ? ViewStore.list() : [];
  const viewLayouts = isSameRepository ? ViewLayoutStore.listAll() : {};
  const designWorkspaces = isSameRepository ? DesignWorkspaceStore.list(repositoryName) : [];

  return {
    version: 1,
    metadata,
    objects: Array.from(repo.objects.values()).map((o) => ({ id: o.id, type: o.type, attributes: { ...(o.attributes ?? {}) } })),
    relationships: repo.relationships.map((r) => ({
      id: r.id,
      fromId: r.fromId,
      toId: r.toId,
      type: r.type,
      attributes: { ...(r.attributes ?? {}) },
    })),
    views,
    studioState: {
      viewLayouts,
      designWorkspaces,
    },
    updatedAt: new Date().toISOString(),
  };
};

const normalizeStudioState = (value: unknown): RepositorySnapshot['studioState'] => {
  const asAny = value as any;
  const viewLayouts = asAny?.viewLayouts && typeof asAny.viewLayouts === 'object' ? (asAny.viewLayouts as Record<string, Record<string, { x: number; y: number }>>) : {};
  const designWorkspaces = Array.isArray(asAny?.designWorkspaces) ? (asAny.designWorkspaces as DesignWorkspace[]) : [];
  return { viewLayouts, designWorkspaces };
};

const tryDeserializeRepository = (
  value: unknown,
): { ok: true; repo: EaRepository; metadata: EaRepositoryMetadata; snapshot: SerializedRepository } | { ok: false; error: string } => {
  const asAny = value as any;

  const metaRes = validateRepositoryMetadata(asAny?.metadata);
  if (!metaRes.ok) return metaRes;

  const objects = Array.isArray(asAny?.objects) ? (asAny.objects as EaObject[]) : undefined;
  const relationships = Array.isArray(asAny?.relationships) ? (asAny.relationships as EaRelationship[]) : undefined;

  if (!objects || !relationships) {
    return { ok: false, error: 'Invalid repository snapshot: expected { objects, relationships }.' };
  }

  // Reference-framework strictness (ArchiMate): reject snapshots that contain non-supported relationship types.
  if (metaRes.metadata.referenceFramework === 'ArchiMate') {
    for (const r of relationships) {
      const t = String((r as any)?.type ?? '').trim();
      if (!isRelationshipTypeAllowedForReferenceFramework('ArchiMate', t)) {
        return { ok: false, error: `Invalid ArchiMate repository snapshot: unsupported relationship type "${t}".` };
      }
    }
  }

  if (metaRes.metadata.referenceFramework === 'TOGAF') {
    const objectPolicy = getFrameworkObjectPolicy('TOGAF');
    for (const o of objects) {
      const t = String((o as any)?.type ?? '').trim();
      if (objectPolicy.allowedObjectTypes.length > 0 && !objectPolicy.allowedObjectTypes.includes(t as any)) {
        return { ok: false, error: `Invalid TOGAF repository snapshot: unsupported object type "${t}".` };
      }
    }
  }

  if (metaRes.metadata.referenceFramework === 'Custom') {
    const custom = getCustomMetaModelConfig(metaRes.metadata.frameworkConfig ?? undefined);

    if (custom.enabledObjectTypes.length === 0) {
      // Must be a blank canvas.
      const hasLiveObjects = objects.some((o) => (o as any)?.attributes?._deleted !== true);
      if (hasLiveObjects) {
        return {
          ok: false,
          error: 'Invalid Custom repository snapshot: modeling disabled until at least one element type is enabled.',
        };
      }
      if (relationships.length > 0) {
        return {
          ok: false,
          error: 'Invalid Custom repository snapshot: relationships not allowed until meta-model is configured.',
        };
      }
    } else {
      for (const o of objects) {
        if ((o as any)?.attributes?._deleted === true) continue;
        const t = String((o as any)?.type ?? '').trim();
        if (!t) return { ok: false, error: 'Invalid Custom repository snapshot: missing object type.' };
        if (!custom.enabledObjectTypes.includes(t as any)) {
          return { ok: false, error: `Invalid Custom repository snapshot: object type "${t}" is not enabled.` };
        }
      }
    }
  }

  const views = Array.isArray(asAny?.views) ? (asAny.views as ViewInstance[]) : [];
  const studioState = normalizeStudioState(asAny?.studioState);
  const updatedAt = typeof asAny?.updatedAt === 'string' ? asAny.updatedAt : new Date().toISOString();

  try {
    const repo = new EaRepository({ objects, relationships });
    const snapshot: SerializedRepository = {
      version: 1,
      metadata: metaRes.metadata,
      objects,
      relationships,
      views,
      studioState,
      updatedAt,
    };
    return { ok: true, repo, metadata: metaRes.metadata, snapshot };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to load repository snapshot.' };
  }
};

export const EaRepositoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initial = React.useMemo(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { repo: null as EaRepository | null, metadata: null as EaRepositoryMetadata | null, raw: null as string | null };
      const parsed = JSON.parse(raw) as SerializedRepository;
      const res = tryDeserializeRepository(parsed);
      if (!res.ok) return { repo: null as EaRepository | null, metadata: null as EaRepositoryMetadata | null, raw: null as string | null };

      const ownerRes = ensureOwnerBinding(res.metadata);
      if (!ownerRes.ok) return { repo: null as EaRepository | null, metadata: null as EaRepositoryMetadata | null, raw: null as string | null };
      const consistency = validateCurrentUserBinding(res.metadata);
      if (!consistency.ok) return { repo: null as EaRepository | null, metadata: null as EaRepositoryMetadata | null, raw: null as string | null };
      return { repo: res.repo, metadata: res.metadata, raw };
    } catch {
      return { repo: null as EaRepository | null, metadata: null as EaRepositoryMetadata | null, raw: null as string | null };
    }
  }, []);

  const [eaRepository, setEaRepositoryState] = React.useState<EaRepository | null>(() => initial.repo);
  const [metadata, setMetadata] = React.useState<EaRepositoryMetadata | null>(() => initial.metadata);
    const updateRepositoryMetadata = React.useCallback(
      (patch: Partial<EaRepositoryMetadata>) => {
        if (!metadata) return { ok: false, error: 'No repository loaded.' } as const;

        const candidate = { ...metadata, ...(patch as any) } as EaRepositoryMetadata;
        const res = validateRepositoryMetadata(candidate);
        if (!res.ok) return res;

        // If the repo already has content, ensure the new metadata doesn't violate framework/scope constraints.
        if (eaRepository) {
          const frameworkViolation = hasReferenceFrameworkViolations(
            eaRepository,
            res.metadata.referenceFramework ?? null,
            res.metadata.frameworkConfig ?? null,
          );
          if (frameworkViolation) return { ok: false, error: frameworkViolation } as const;

          if (res.metadata.architectureScope === 'Business Unit') {
            const violation = hasBusinessUnitScopeViolations(eaRepository, isRepositoryInitialized(eaRepository));
            if (violation) return { ok: false, error: violation } as const;
          }

          if (res.metadata.architectureScope === 'Domain') {
            const violation = hasDomainScopeRelationshipViolations(eaRepository, res.metadata.repositoryName ?? null);
            if (violation) return { ok: false, error: violation } as const;
          }

          if (res.metadata.architectureScope === 'Programme') {
            const violation = hasProgrammeScopeViolations(eaRepository);
            if (violation) return { ok: false, error: violation } as const;
          }
        }

        setMetadata(freezeMetadata(res.metadata));
        return { ok: true } as const;
      },
      [eaRepository, metadata],
    );
  const [loading] = React.useState(false);

  const [canUndo, setCanUndo] = React.useState(false);
  const [canRedo, setCanRedo] = React.useState(false);

  const undoStackRef = React.useRef<string[]>([]);
  const redoStackRef = React.useRef<string[]>([]);
  const lastSerializedRef = React.useRef<string | null>(initial.raw);
  const suppressHistoryRef = React.useRef(false);
  const lastSaveBlockedKeyRef = React.useRef<string | null>(null);
  const lastAdvisoryWarnKeyRef = React.useRef<string | null>(null);
  const lastAdvisorySaveWarnKeyRef = React.useRef<string | null>(null);
  const lastAdvisoryGovernanceWarnKeyRef = React.useRef<string | null>(null);

  const managedSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastStrictActionBlockedKeyRef = React.useRef<string | null>(null);

  const ensureActiveRepositoryId = React.useCallback((repositoryName: string) => {
    let id = readLocalStorage(ACTIVE_REPO_ID_KEY);
    if (id) return id;
    const uuid = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      localStorage.setItem(ACTIVE_REPO_ID_KEY, uuid);
      localStorage.setItem(ACTIVE_REPO_NAME_KEY, repositoryName || 'Repository');
    } catch {
      // Best-effort only.
    }
    try {
      window.dispatchEvent(new Event(PROJECT_STATUS_EVENT));
    } catch {
      // ignore
    }
    return uuid;
  }, []);

  const buildManagedRepositoryPayload = React.useCallback(() => {
    if (!eaRepository || !metadata) return null;

    const repositorySnapshot = serializeRepository(eaRepository, metadata);
    const views = repositorySnapshot.views ?? [];
    const viewLayouts = repositorySnapshot.studioState?.viewLayouts ?? {};

    const repositoryName = metadata.repositoryName || 'default';
    const designWorkspaces = repositorySnapshot.studioState?.designWorkspaces ?? DesignWorkspaceStore.list(repositoryName);
    const repositoryId = readLocalStorage(ACTIVE_REPO_ID_KEY) || undefined;

    const studioState = {
      ideLayout: {
        activity: readLocalStorage('ide.activity'),
        sidebarOpen: readLocalStorage('ide.sidebar.open'),
        sidebarWidth: readLocalStorage('ide.sidebar.width'),
        bottomOpen: readLocalStorage('ide.bottom.open'),
        bottomHeight: readLocalStorage('ide.bottom.height'),
        panelDock: readLocalStorage('ide.panel.dock'),
        rightPanelWidth: readLocalStorage('ide.panel.right.width'),
      },
      preferences: {
        applicationGrouping: readLocalStorage('ea.applicationGrouping'),
        programmeScopeShowTechnology: readLocalStorage('ea.programmeScope.showTechnology'),
        seedBannerDismissed: readLocalStorage('ea.seed.banner.dismissed'),
        catalogDefined: readLocalStorage('ea.catalogDefined'),
      },
      viewLayouts,
      designWorkspaces,
    };

    return {
      version: 1 as const,
      meta: {
        createdAt: metadata.createdAt,
        updatedAt: new Date().toISOString(),
        repositoryId,
        repositoryName: metadata.repositoryName,
        organizationName: metadata.organizationName,
        referenceFramework: metadata.referenceFramework,
        timeHorizon: metadata.timeHorizon,
      },
      repository: {
        metadata,
        metamodel: metadata.frameworkConfig ?? null,
        snapshot: repositorySnapshot,
      },
      views: {
        items: views,
      },
      studioState,
    };
  }, [eaRepository, metadata]);

  const initializationState = React.useMemo(() => {
    if (!eaRepository) {
      return { status: 'uninitialized' as const, reason: 'No repository loaded.' };
    }

    if (isRepositoryInitialized(eaRepository)) {
      return { status: 'initialized' as const, reason: null };
    }

    return {
      status: 'uninitialized' as const,
      reason: 'No Enterprise root exists. Initialize the repository by creating the Enterprise root.',
    };
  }, [eaRepository]);

  const setEaRepositoryUnsafe: React.Dispatch<React.SetStateAction<EaRepository | null>> = React.useCallback((next) => {
    setEaRepositoryState(next);
  }, []);

  const validateAndExplainRepositoryUpdate = React.useCallback(
    (prev: EaRepository | null, next: EaRepository): { ok: true } | { ok: false; error: string } => {
      const scope = metadata?.architectureScope ?? null;
      const framework = metadata?.referenceFramework ?? null;
      const frameworkConfig = metadata?.frameworkConfig ?? null;
      const governanceMode = metadata?.governanceMode ?? 'Advisory';

      const prevInitialized = isRepositoryInitialized(prev);
      const nextInitialized = isRepositoryInitialized(next);

      if (prevInitialized && !nextInitialized) {
        return { ok: false, error: 'Cannot remove the Enterprise root; repository would become uninitialized.' } as const;
      }

      if (!prevInitialized) {
        const nextEnterpriseCount = countLiveObjectsByType(next, 'Enterprise');
        const nextHasNonEnterpriseObjects = hasLiveNonEnterpriseObjects(next);
        const nextHasLiveRelationships = next.relationships.some((r) => {
          const from = next.objects.get(r.fromId);
          const to = next.objects.get(r.toId);
          if (!from || !to) return false;
          if ((from.attributes as any)?._deleted === true) return false;
          if ((to.attributes as any)?._deleted === true) return false;
          return true;
        });

        if (nextEnterpriseCount === 0) {
          if (nextHasNonEnterpriseObjects) {
            return {
              ok: false,
              error: 'Repository is UNINITIALIZED: create the Enterprise root before adding other elements.',
            } as const;
          }
          if (nextHasLiveRelationships) {
            return {
              ok: false,
              error: 'Repository is UNINITIALIZED: relationships are not allowed until the Enterprise root exists.',
            } as const;
          }
        } else {
          if (nextHasNonEnterpriseObjects) {
            return {
              ok: false,
              error: 'Initialization must create the Enterprise root first; add other elements after initialization.',
            } as const;
          }
        }
      }

      const frameworkViolation = hasReferenceFrameworkViolations(next, framework, frameworkConfig);
      if (frameworkViolation) {
        const isHardViolation =
          // Custom framework gating is always hard-blocking (prevents modeling before configuration).
          frameworkViolation.startsWith('Custom reference framework:') ||
          // ArchiMate relationship type allowlist is part of the ontology.
          frameworkViolation.startsWith('ArchiMate reference framework allows') ||
          // Structural corruption (missing defs/endpoints).
          frameworkViolation.includes('blocked invalid relationship');

        if (isHardViolation || governanceMode === 'Strict') {
          return { ok: false, error: frameworkViolation } as const;
        }

        // Advisory: downgrade to warning and allow the update.
        if (lastAdvisoryWarnKeyRef.current !== frameworkViolation) {
          lastAdvisoryWarnKeyRef.current = frameworkViolation;
          message.warning(`Governance (Advisory): ${frameworkViolation}`);
        }
      }

      if (scope === 'Business Unit') {
        const violation = hasBusinessUnitScopeViolations(next, isRepositoryInitialized(next));
        if (violation) return { ok: false, error: violation } as const;
      }

      if (scope === 'Domain') {
        const violation = hasDomainScopeRelationshipViolations(next, metadata?.repositoryName ?? null);
        if (violation) return { ok: false, error: violation } as const;
      }

      if (scope === 'Programme') {
        const violation = hasProgrammeScopeViolations(next);
        if (violation) return { ok: false, error: violation } as const;
      }

      // Governance mode:
      // - Advisory: read-only; block all repository mutations.
      // - Strict: block the update ("block save") when governance violations exist.
      if (governanceMode === 'Advisory') {
        if (hasRepositoryChanges(prev, next)) {
          return { ok: false, error: 'Read-only (Advisory mode): repository changes are disabled.' } as const;
        }
      } else if (governanceMode === 'Strict') {
        const strict = validateStrictGovernance(next, {
          governanceMode: 'Strict',
          lifecycleCoverage: metadata?.lifecycleCoverage ?? 'As-Is',
        });

        if (!strict.ok) {
          if (lastStrictActionBlockedKeyRef.current !== strict.violation.key) {
            lastStrictActionBlockedKeyRef.current = strict.violation.key;

            const highlightText = strict.violation.highlights.length > 0
              ? ' | ' + strict.violation.highlights.join('; ')
              : '';
            message.error({
              content: `Save blocked by governance (Strict mode): ${strict.violation.message}${highlightText}`,
              domain: 'governance',
            });
          }

          return { ok: false, error: strict.violation.message } as const;
        }
      } else {
        const debt = buildGovernanceDebt(next, new Date(), {
          lifecycleCoverage: metadata?.lifecycleCoverage ?? null,
          governanceMode: 'Advisory',
        });
        const { total } = debt.summary;
        const key = `${debt.summary.mandatoryFindingCount}|${debt.summary.invalidRelationshipInsertCount}|${debt.summary.relationshipErrorCount}|${debt.summary.relationshipWarningCount}|${debt.summary.lifecycleTagMissingCount}`;
        if (total > 0 && lastAdvisoryGovernanceWarnKeyRef.current !== key) {
          lastAdvisoryGovernanceWarnKeyRef.current = key;
          message.warning(`Governance (Advisory): saved with ${total} issue(s).`);
        }
        if (total === 0) {
          lastAdvisoryGovernanceWarnKeyRef.current = null;
        }
      }

      // Read-only enforcement must run after validation so errors are actionable.
      if (hasReadOnlyObjectChanges(prev, next, scope)) {
        if (scope === 'Domain') {
          return {
            ok: false,
            error:
              'Read-only in Domain scope: only Capabilities + Business Services + Applications + Application Services are editable.',
          } as const;
        }
        if (scope === 'Programme') {
          return {
            ok: false,
            error:
              'Read-only in Programme scope: only Programmes, Projects, impacted Capabilities, and impacted Applications are editable.',
          } as const;
        }
        return {
          ok: false,
          error: 'Read-only in Business Unit scope: only Business + Application + Technology layers are editable.',
        } as const;
      }

      return { ok: true } as const;
    },
    [metadata?.architectureScope, metadata?.frameworkConfig, metadata?.governanceMode, metadata?.lifecycleCoverage, metadata?.referenceFramework, metadata?.repositoryName],
  );

  const trySetEaRepository = React.useCallback(
    (next: EaRepository) => {
      const prev = eaRepository;
      const res = validateAndExplainRepositoryUpdate(prev, next);
      if (!res.ok) {
        const lower = res.error.toLowerCase();
        if (lower.includes('read-only')) {
          notification.open({
            key: 'read-only-banner',
            message: 'Read-only',
            description: res.error,
            duration: 0,
          });
        } else if (lower.includes('strict')) {
          notification.open({
            key: 'read-only-banner',
            message: 'Blocked by Strict Governance',
            description: res.error,
            duration: 0,
          });
        } else {
          message.error(res.error);
        }
        return res;
      }
      setEaRepositoryUnsafe(next);
      return { ok: true } as const;
    },
    [eaRepository, setEaRepositoryUnsafe, validateAndExplainRepositoryUpdate],
  );

  const setEaRepository: React.Dispatch<React.SetStateAction<EaRepository | null>> = React.useCallback(
    (next) => {
      setEaRepositoryState((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: EaRepository | null) => EaRepository | null)(prev) : next;

        // Always allow clearing.
        if (resolved === null) return resolved;

        const res = validateAndExplainRepositoryUpdate(prev, resolved);
        if (!res.ok) {
          const lower = res.error.toLowerCase();
          if (lower.includes('read-only')) {
            notification.open({
              key: 'read-only-banner',
              message: 'Read-only',
              description: res.error,
              duration: 0,
            });
          } else if (lower.includes('strict')) {
            notification.open({
              key: 'read-only-banner',
              message: 'Blocked by Strict Governance',
              description: res.error,
              duration: 0,
            });
          } else {
            message.error(res.error);
          }
          return prev;
        }

        return resolved;
      });
    },
    [validateAndExplainRepositoryUpdate],
  );

  React.useEffect(() => {
    // Best-effort: if a repository is loaded and scope is Business Unit, validate once.
    if (!eaRepository || metadata?.architectureScope !== 'Business Unit') return;
    const violation = hasBusinessUnitScopeViolations(eaRepository, isRepositoryInitialized(eaRepository));
    if (violation) message.warning(violation);
  }, [eaRepository, metadata?.architectureScope]);

  const loadRepositoryFromJsonText = React.useCallback((jsonText: string) => {
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      const res = tryDeserializeRepository(parsed);
      if (!res.ok) return res;

      const ownerRes = ensureOwnerBinding(res.metadata);
      if (!ownerRes.ok) return { ok: false, error: ownerRes.error } as const;
      const consistency = validateCurrentUserBinding(res.metadata);
      if (!consistency.ok) return { ok: false, error: consistency.error } as const;

      // New load is a new history root.
      undoStackRef.current = [];
      redoStackRef.current = [];
      setCanUndo(false);
      setCanRedo(false);

      try {
        const serialized = JSON.stringify(res.snapshot);
        lastSerializedRef.current = serialized;
        suppressHistoryRef.current = true;
        writeRepositorySnapshot(res.snapshot);
      } catch {
        lastSerializedRef.current = null;
      }

      setEaRepositoryUnsafe(res.repo);
      setMetadata(freezeMetadata(res.metadata));
      return { ok: true } as const;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Invalid JSON.' } as const;
    }
  }, [setEaRepository]);

  const createNewRepository = React.useCallback((input: Omit<EaRepositoryMetadata, 'createdAt' | 'owner'>) => {
    let currentUser;
    try {
      currentUser = getCurrentUserOrThrow();
    } catch {
      return { ok: false, error: 'No active user context.' } as const;
    }

    const createdAt = new Date().toISOString();
    const metaRes = validateRepositoryMetadata({
      ...input,
      owner: { userId: currentUser.id, displayName: currentUser.displayName },
      createdAt,
    });
    if (!metaRes.ok) return metaRes;

    // New repo is a new history root.
    undoStackRef.current = [];
    redoStackRef.current = [];
    setCanUndo(false);
    setCanRedo(false);

    const repo = new EaRepository();

    // Persist initial RBAC bindings for owner + architect in local storage (UI uses same store).
    try {
      const key = `ea.rbac.bindings.${metaRes.metadata.repositoryName}`;
      const initial = [
        { userId: metaRes.metadata.owner.userId, role: 'Owner' as const },
        { userId: metaRes.metadata.owner.userId, role: 'Architect' as const },
      ];
      localStorage.setItem(key, JSON.stringify(initial));
    } catch {
      // Best-effort only; owner still captured in metadata.
    }

    const meta =
      metaRes.metadata.referenceFramework === 'Custom'
        ? (() => {
            const provided = metaRes.metadata.frameworkConfig?.custom as any | undefined;
            const hasObjects = Array.isArray(provided?.enabledObjectTypes);
            const hasRels = Array.isArray(provided?.enabledRelationshipTypes);

            const custom =
              hasObjects || hasRels
                ? {
                    enabledObjectTypes: Array.isArray(provided?.enabledObjectTypes) ? provided.enabledObjectTypes : [],
                    enabledRelationshipTypes: Array.isArray(provided?.enabledRelationshipTypes) ? provided.enabledRelationshipTypes : [],
                  }
                : {
                    enabledObjectTypes: CUSTOM_CORE_EA_SEED.enabledObjectTypes,
                    enabledRelationshipTypes: CUSTOM_CORE_EA_SEED.enabledRelationshipTypes,
                  };

            return {
              ...metaRes.metadata,
              frameworkConfig: {
                ...(metaRes.metadata.frameworkConfig ?? {}),
                custom,
              },
            };
          })()
        : metaRes.metadata;

    setEaRepositoryUnsafe(repo);
    setMetadata(freezeMetadata(meta));
    const consistency = validateCurrentUserBinding(metaRes.metadata);
    if (!consistency.ok) return consistency;
    return { ok: true } as const;
  }, []);

  const clearRepository = React.useCallback(() => {
    // ---------------------------------------------------------------------------
    // CRITICAL: Flush all pending saves BEFORE clearing state.
    // Without this, closing a repository cancels the disk-save timer and deletes
    // localStorage, causing total data loss on reopen.
    // ---------------------------------------------------------------------------

    // 1. Cancel any pending debounced disk-save timer.
    if (managedSaveTimerRef.current) {
      clearTimeout(managedSaveTimerRef.current);
      managedSaveTimerRef.current = null;
    }

    // 2. Flush the CURRENT repository state to localStorage + disk BEFORE nulling.
    if (eaRepository && metadata) {
      try {
        const finalSnapshot = serializeRepository(eaRepository, metadata);
        writeRepositorySnapshot(finalSnapshot);
      } catch {
        // Best-effort — don't block close.
      }

      // Flush to managed desktop file (fire-and-forget).
      if (typeof window !== 'undefined' && window.eaDesktop?.saveManagedRepository) {
        try {
          const payload = buildManagedRepositoryPayload();
          if (payload) {
            const repositoryId = ensureActiveRepositoryId(metadata.repositoryName || 'Repository');
            void window.eaDesktop.saveManagedRepository({ payload, repositoryId });
          }
        } catch {
          // Best-effort — don't block close.
        }
      }
    }

    // 3. Clear history.
    undoStackRef.current = [];
    redoStackRef.current = [];
    setCanUndo(false);
    setCanRedo(false);

    // 4. Clear in-memory state (triggers re-render but localStorage is preserved).
    setEaRepositoryUnsafe(null);
    setMetadata(null);
  }, [eaRepository, metadata, buildManagedRepositoryPayload, ensureActiveRepositoryId]);

  const applySerialized = React.useCallback((raw: string): boolean => {
    try {
      const parsed = JSON.parse(raw) as SerializedRepository;
      const res = tryDeserializeRepository(parsed);
      if (!res.ok) return false;
      const ownerRes = ensureOwnerBinding(res.metadata);
      if (!ownerRes.ok) return false;
      const consistency = validateCurrentUserBinding(res.metadata);
      if (!consistency.ok) return false;
      writeRepositorySnapshot(res.snapshot);
      suppressHistoryRef.current = true;
      setEaRepositoryUnsafe(res.repo);
      setMetadata(freezeMetadata(res.metadata));
      return true;
    } catch {
      return false;
    }
  }, [setEaRepositoryUnsafe]);

  const undo = React.useCallback((): boolean => {
    const prevRaw = undoStackRef.current.pop();
    if (!prevRaw) {
      setCanUndo(false);
      return false;
    }

    const currentRaw = lastSerializedRef.current;
    if (currentRaw) {
      redoStackRef.current.unshift(currentRaw);
      if (redoStackRef.current.length > HISTORY_LIMIT) redoStackRef.current.pop();
    }

    const ok = applySerialized(prevRaw);
    if (!ok) return false;

    lastSerializedRef.current = prevRaw;
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
    return true;
  }, [applySerialized]);

  const redo = React.useCallback((): boolean => {
    const nextRaw = redoStackRef.current.shift();
    if (!nextRaw) {
      setCanRedo(false);
      return false;
    }

    const currentRaw = lastSerializedRef.current;
    if (currentRaw) {
      undoStackRef.current.push(currentRaw);
      if (undoStackRef.current.length > HISTORY_LIMIT) undoStackRef.current.shift();
    }

    const ok = applySerialized(nextRaw);
    if (!ok) return false;

    lastSerializedRef.current = nextRaw;
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
    return true;
  }, [applySerialized]);

  React.useEffect(() => {
    if (loading) return;

    try {
      // Persist only when repository *and* metadata exist.
      if (!eaRepository || !metadata) {
        if (managedSaveTimerRef.current) {
          clearTimeout(managedSaveTimerRef.current);
          managedSaveTimerRef.current = null;
        }
        // IMPORTANT: Do NOT delete localStorage here.
        // The snapshot must survive close/reopen cycles.
        // It will be overwritten when a new/different repository is loaded.
        // localStorage.removeItem(STORAGE_KEY);  ← removed to prevent data loss
        lastSerializedRef.current = null;
        try {
          localStorage.removeItem(PROJECT_DIRTY_KEY);
          window.dispatchEvent(new Event(PROJECT_STATUS_EVENT));
        } catch {
          // ignore
        }
        return;
      }

      const nextSnapshot = serializeRepository(eaRepository, metadata);
      const nextSerialized = JSON.stringify(nextSnapshot);

      const prevSerialized = lastSerializedRef.current;
      const isDirty = prevSerialized ? prevSerialized !== nextSerialized : true;
      if (isDirty) {
        try {
          localStorage.setItem(PROJECT_DIRTY_KEY, 'true');
          window.dispatchEvent(new Event(PROJECT_STATUS_EVENT));
        } catch {
          // ignore
        }
      }

      // Track history (repo-level undo/redo) for meaningful changes.
      if (!suppressHistoryRef.current) {
        if (prevSerialized && prevSerialized !== nextSerialized) {
          undoStackRef.current.push(prevSerialized);
          if (undoStackRef.current.length > HISTORY_LIMIT) undoStackRef.current.shift();
          redoStackRef.current = [];
          setCanUndo(true);
          setCanRedo(false);
        }
      }

      suppressHistoryRef.current = false;
      lastSerializedRef.current = nextSerialized;

      if (metadata.governanceMode === 'Strict' || metadata.governanceMode === 'Advisory') {
        const debt = buildGovernanceDebt(eaRepository, new Date(), {
          lifecycleCoverage: metadata.lifecycleCoverage,
          governanceMode: metadata.governanceMode,
        });
        const {
          mandatoryFindingCount,
          invalidRelationshipInsertCount,
          relationshipErrorCount,
          lifecycleTagMissingCount,
          total,
        } = debt.summary;
        const key = `${mandatoryFindingCount}|${invalidRelationshipInsertCount}|${relationshipErrorCount}|${debt.summary.relationshipWarningCount}|${lifecycleTagMissingCount}`;

        const highlights = () => {
          const items: string[] = [];
          for (const f of debt.repoReport.findings.slice(0, 3)) items.push(`Mandatory: ${f.message} (${f.elementId})`);
          for (const f of debt.relationshipReport.findings.slice(0, 3)) items.push(`Relationship: ${f.message} (${f.subjectId})`);
          for (const s of debt.invalidRelationshipInserts.slice(0, 3)) items.push(`Relationship insert: ${s.message}`);
          for (const issue of debt.lifecycleTagMissingIds.slice(0, 3)) items.push(`Lifecycle tag missing: ${issue.message}`);
          return items;
        };

        if (metadata.governanceMode === 'Strict') {
          const blocked =
            mandatoryFindingCount > 0 ||
            relationshipErrorCount > 0 ||
            invalidRelationshipInsertCount > 0 ||
            lifecycleTagMissingCount > 0;
          if (blocked) {
            if (lastSaveBlockedKeyRef.current !== key) {
              lastSaveBlockedKeyRef.current = key;

              appendGovernanceLog({
                type: 'save.blocked',
                governanceMode: 'Strict',
                repositoryName: metadata.repositoryName,
                architectureScope: metadata.architectureScope ?? undefined,
                summary: debt.summary,
                highlights: highlights(),
              });

              message.error({
                content: `Save blocked by governance (Strict mode): Mandatory attribute findings: ${mandatoryFindingCount}, Missing lifecycle tags (Both mode): ${lifecycleTagMissingCount}, Invalid relationships: ${invalidRelationshipInsertCount}, Relationship errors: ${relationshipErrorCount}`,
                domain: 'governance',
              });
            }
            return;
          }

          if (lastSaveBlockedKeyRef.current) {
            lastSaveBlockedKeyRef.current = null;
            message.success({ content: 'Governance compliant: saving re-enabled.', domain: 'governance' });
          }
        }

        if (metadata.governanceMode === 'Advisory') {
          // Warn, don’t stop: allow save but surface debt (non-blocking).
          if (total > 0 && lastAdvisorySaveWarnKeyRef.current !== key) {
            lastAdvisorySaveWarnKeyRef.current = key;
            appendGovernanceLog({
              type: 'save.warned',
              governanceMode: 'Advisory',
              repositoryName: metadata.repositoryName,
              architectureScope: metadata.architectureScope ?? undefined,
              summary: debt.summary,
              highlights: highlights(),
            });
          }
          if (total === 0) {
            lastAdvisorySaveWarnKeyRef.current = null;
          }
        }
      }

      writeRepositorySnapshot(nextSnapshot);

      if (typeof window !== 'undefined' && window.eaDesktop?.saveManagedRepository) {
        const payload = buildManagedRepositoryPayload();
        if (payload) {
          const repositoryId = ensureActiveRepositoryId(metadata.repositoryName || 'Repository');
          if (managedSaveTimerRef.current) clearTimeout(managedSaveTimerRef.current);
          managedSaveTimerRef.current = setTimeout(() => {
            void window.eaDesktop?.saveManagedRepository({ payload, repositoryId });
          }, 250);
        }
      }
    } catch {
      // Ignore persistence errors (e.g., storage quota).
    }
  }, [eaRepository, loading, metadata, buildManagedRepositoryPayload, ensureActiveRepositoryId]);

  return (
    <EaRepositoryContext.Provider
      value={{
        eaRepository,
        metadata,
        loading,
        initializationState,
        setEaRepository,
        trySetEaRepository,
        updateRepositoryMetadata,
        createNewRepository,
        loadRepositoryFromJsonText,
        clearRepository,

        canUndo,
        canRedo,
        undo,
        redo,
      }}
    >
      {children}
    </EaRepositoryContext.Provider>
  );
};

export function useEaRepository(): EaRepositoryContextValue {
  const ctx = React.useContext(EaRepositoryContext);
  if (!ctx) throw new Error('useEaRepository must be used within EaRepositoryProvider');
  return ctx;
}
