import { PageContainer } from '@ant-design/pro-components';
import { Result } from 'antd';
import { history, useModel, useParams } from '@umijs/max';
import { CompressOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Checkbox, Collapse, Descriptions, Empty, Input, List, Modal, Radio, Select, Space, Tag, Tree, Typography, Dropdown } from 'antd';
import type { DataNode } from 'antd/es/tree';
import cytoscape, { type Core } from 'cytoscape';
import React from 'react';

import { ViewStore } from '@/diagram-studio/view-runtime/ViewStore';
import { ViewLayoutStore } from '@/diagram-studio/view-runtime/ViewLayoutStore';
import { ViewpointRegistry } from '@/diagram-studio/viewpoints/ViewpointRegistry';
import { resolveViewScope, type ViewScopeResolutionResult } from '@/diagram-studio/viewpoints/resolveViewScope';
import type { ViewInstance, ViewAnnotation } from '@/diagram-studio/viewpoints/ViewInstance';
import { useEaRepository } from '@/ea/EaRepositoryContext';
import { useIdeSelection } from '@/ide/IdeSelectionContext';
import { useIdeShell } from '@/components/IdeShellLayout';
import { ENABLE_RBAC, hasRepositoryPermission, type RepositoryRole } from '@/repository/accessControl';
import { dispatchIdeCommand } from '@/ide/ideCommands';
import { message } from '@/ea/eaConsole';

const LEGEND_COLORS = ['#4b9bff', '#13c2c2', '#52c41a', '#faad14', '#eb2f96', '#722ed1', '#1890ff', '#fa541c', '#a0a0a0'];

const hashString = (value: string | null | undefined): number => {
  const safe = typeof value === 'string' ? value : '';
  let h = 0;
  for (let i = 0; i < safe.length; i += 1) {
    h = (h * 31 + safe.charCodeAt(i)) >>> 0;
  }
  return h;
};

const normalize = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');


const layoutPositionsForView = (view: ViewInstance): Record<string, { x: number; y: number }> => {
  const fromMetadata = (view.layoutMetadata as any)?.positions;
  if (fromMetadata && typeof fromMetadata === 'object') return fromMetadata as Record<string, { x: number; y: number }>;
  return ViewLayoutStore.get(view.id);
};

const downloadJson = (filename: string, data: unknown) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const downloadDataUrl = (filename: string, dataUrl: string) => {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.click();
};

const isSoftDeleted = (attributes: Record<string, unknown> | null | undefined) => Boolean((attributes as any)?._deleted === true);

const buildCapabilityTree = (args: {
  objectsById: Map<string, { id: string; type: string; attributes: Record<string, unknown> }>;
  relationships: { id?: string; type: string; fromId: string; toId: string }[];
}): DataNode[] => {
  const { objectsById, relationships } = args;
  const allowedTypes = new Set(['Capability', 'CapabilityCategory', 'SubCapability']);
  const allowedRels = new Set(['DECOMPOSES_TO', 'COMPOSED_OF']);

  const nodes = Array.from(objectsById.values()).filter((o) => allowedTypes.has(o.type) && !isSoftDeleted(o.attributes));
  if (nodes.length === 0) return [];

  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const children = new Map<string, Set<string>>();
  const hasParent = new Set<string>();

  relationships.forEach((rel) => {
    if (!allowedRels.has(rel.type)) return;
    const from = nodeById.get(rel.fromId);
    const to = nodeById.get(rel.toId);
    if (!from || !to) return;
    if (!children.has(from.id)) children.set(from.id, new Set());
    children.get(from.id)!.add(to.id);
    hasParent.add(to.id);
  });

  const makeNode = (id: string, seen: Set<string>): DataNode => {
    const obj = nodeById.get(id);
    const label = ((obj?.attributes as any)?.name as string) || id;
    const nextSeen = new Set(seen);
    nextSeen.add(id);
    const childIds = Array.from(children.get(id) ?? []).filter((cid) => !nextSeen.has(cid));
    return {
      key: id,
      title: label,
      children: childIds.map((cid) => makeNode(cid, nextSeen)),
    };
  };

  const roots = nodes.filter((n) => !hasParent.has(n.id)).map((n) => makeNode(n.id, new Set()));
  // Fallback: if every node had a parent (cycle), pick all as roots once.
  return roots.length > 0 ? roots : nodes.map((n) => makeNode(n.id, new Set()));
};

const ViewRuntimePage: React.FC = () => {
  const params = useParams<{ viewId?: string }>();
  const viewId = (params.viewId ?? '').trim();
  const { initialState } = useModel('@@initialState');
  const { eaRepository, metadata } = useEaRepository();
  const [viewsVersion, setViewsVersion] = React.useState(0);
  const { selection, setSelection, setSelectedElement } = useIdeSelection();
  const { openPropertiesPanel } = useIdeShell();
  const [scopeMode, setScopeMode] = React.useState<'entire' | 'enterprises' | 'capabilities' | 'applications'>('entire');
  const [scopeIds, setScopeIds] = React.useState<string[]>([]);
  const [scopeModalOpen, setScopeModalOpen] = React.useState(false);
  const [pendingScopeMode, setPendingScopeMode] = React.useState<'entire' | 'enterprises' | 'capabilities' | 'applications'>(scopeMode);
  const [pendingScopeIds, setPendingScopeIds] = React.useState<string[]>(scopeIds);
  const [visibleElementTypes, setVisibleElementTypes] = React.useState<string[]>([]);
  const [visibleRelationshipTypes, setVisibleRelationshipTypes] = React.useState<string[]>([]);
  const [lifecycleFilter, setLifecycleFilter] = React.useState<string[]>([]);
  const [relationshipStatusFilter, setRelationshipStatusFilter] = React.useState<string[]>([]);
  const [criticalityFilter, setCriticalityFilter] = React.useState<string[]>([]);
  const [annotations, setAnnotations] = React.useState<ViewAnnotation[]>([]);
  const [annotationKind, setAnnotationKind] = React.useState<'note' | 'callout' | 'highlight'>('note');
  const [annotationText, setAnnotationText] = React.useState('');
  const [annotationTargetId, setAnnotationTargetId] = React.useState<string | undefined>(undefined);

  const userRole: RepositoryRole = React.useMemo(() => {
    if (!ENABLE_RBAC) return 'Owner';
    const access = initialState?.currentUser?.access;
    if (access === 'admin') return 'Owner';
    if (access === 'architect' || access === 'user') return 'Architect';
    return 'Viewer';
  }, [initialState?.currentUser?.access]);

  const canModel =
    hasRepositoryPermission(userRole, 'createElement') ||
    hasRepositoryPermission(userRole, 'editElement') ||
    hasRepositoryPermission(userRole, 'createRelationship') ||
    hasRepositoryPermission(userRole, 'editRelationship');

  const canEditView = hasRepositoryPermission(userRole, 'editView');
  const governanceStrict = (metadata as any)?.governanceMode === 'Strict';
  const isReadOnlyUser = false;
  const actionBlocked = false;
  const actor = initialState?.currentUser?.name || initialState?.currentUser?.userid || 'local-architect';

  const view: ViewInstance | undefined = React.useMemo(() => {
    if (!viewId) return undefined;
    return ViewStore.get(viewId);
  }, [viewId, viewsVersion]);


  React.useEffect(() => {
    if (viewId) {
      console.log(`Entered ViewRuntimePage for view ${viewId}`);
    }
  }, [viewId]);

  React.useEffect(() => {
    const arr = (view?.layoutMetadata as any)?.annotations;
    setAnnotations(Array.isArray(arr) ? (arr as ViewAnnotation[]) : []);
  }, [view]);

  React.useEffect(() => {
    if (!view) return;
    if (view.scope?.kind === 'ManualSelection') {
      setScopeMode('capabilities');
      setScopeIds([...view.scope.elementIds]);
      setPendingScopeMode('capabilities');
      setPendingScopeIds([...view.scope.elementIds]);
    } else {
      setScopeMode('entire');
      setScopeIds([]);
      setPendingScopeMode('entire');
      setPendingScopeIds([]);
    }
  }, [view]);

  const persistAnnotations = React.useCallback(
    (next: ViewAnnotation[]) => {
      if (!view) return;
      const updated: ViewInstance = {
        ...view,
        layoutMetadata: { ...(view.layoutMetadata ?? {}), annotations: next },
      };
      ViewStore.save(updated);
      setAnnotations(next);
      setViewsVersion((v) => v + 1);
    },
    [view],
  );

  const handleAddAnnotation = React.useCallback(() => {
    if (!annotationText.trim()) {
      message.warning('Add text to save this annotation.');
      return;
    }
    if (annotationKind !== 'note' && !annotationTargetId) {
      message.warning('Select a target element for callouts or highlights.');
      return;
    }
    if (!view) {
      message.error('Unable to save annotation: missing view.');
      return;
    }

    const next: ViewAnnotation = {
      id: `anno-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: annotationKind,
      text: annotationText.trim(),
      targetElementId: annotationKind === 'note' ? undefined : annotationTargetId,
      createdAt: new Date().toISOString(),
      createdBy: metadata?.owner?.displayName ?? metadata?.owner?.userId ?? view.createdBy,
    };

    persistAnnotations([...annotations, next]);
    setAnnotationText('');
    setAnnotationTargetId(undefined);
  }, [annotationKind, annotationTargetId, annotationText, annotations, metadata?.owner?.displayName, metadata?.owner?.userId, persistAnnotations, view]);

  const handleDeleteAnnotation = React.useCallback(
    (id: string) => {
      persistAnnotations(annotations.filter((a) => a.id !== id));
    },
    [annotations, persistAnnotations],
  );

  React.useEffect(() => {
    const handler = () => setViewsVersion((v) => v + 1);
    window.addEventListener('ea:viewsChanged', handler);
    return () => window.removeEventListener('ea:viewsChanged', handler);
  }, []);

  const enterpriseOptions = React.useMemo(() => {
    if (!eaRepository) return [] as { value: string; label: string }[];
    return Array.from(eaRepository.objects.values())
      .filter((o) => o.type === 'Enterprise' && !(o.attributes as any)?._deleted)
      .map((o) => ({ value: o.id, label: ((o.attributes as any)?.name as string) || o.id }));
  }, [eaRepository]);

  const capabilityOptions = React.useMemo(() => {
    if (!eaRepository) return [] as { value: string; label: string }[];
    return Array.from(eaRepository.objects.values())
      .filter((o) => o.type === 'Capability' && !(o.attributes as any)?._deleted)
      .map((o) => ({ value: o.id, label: ((o.attributes as any)?.name as string) || o.id }));
  }, [eaRepository]);

  const applicationOptions = React.useMemo(() => {
    if (!eaRepository) return [] as { value: string; label: string }[];
    return Array.from(eaRepository.objects.values())
      .filter((o) => o.type === 'Application' && !(o.attributes as any)?._deleted)
      .map((o) => ({ value: o.id, label: ((o.attributes as any)?.name as string) || o.id }));
  }, [eaRepository]);

  const capabilityTree = React.useMemo<DataNode[]>(() => {
    if (!eaRepository) return [];
    return buildCapabilityTree({ objectsById: eaRepository.objects, relationships: eaRepository.relationships });
  }, [eaRepository]);

  const scopeSummary = React.useMemo(() => {
    const summarize = (label: string, opts: { value: string; label: string }[]) => {
      if (scopeIds.length === 0) return `${label}: none selected`;
      const names = scopeIds.map((id) => opts.find((o) => o.value === id)?.label || id);
      const head = names.slice(0, 3).join(', ');
      const remainder = names.length > 3 ? ` … +${names.length - 3} more` : '';
      return `${label}: ${head}${remainder}`;
    };

    if (scopeMode === 'entire') return 'Scope: Entire repository';
    if (scopeMode === 'enterprises') return summarize('Scope: Enterprises', enterpriseOptions);
    if (scopeMode === 'capabilities') return summarize('Scope: Capabilities', capabilityOptions);
    return summarize('Scope: Applications', applicationOptions);
  }, [applicationOptions, capabilityOptions, enterpriseOptions, scopeIds, scopeMode]);

  const handleOpenScopeModal = React.useCallback(
    (nextMode: 'entire' | 'enterprises' | 'capabilities' | 'applications') => {
      setPendingScopeMode(nextMode);
      setPendingScopeIds(nextMode === 'entire' ? [] : scopeIds);
      setScopeModalOpen(true);
    },
    [scopeIds],
  );

  const handleApplyScope = React.useCallback(() => {
    if (!view) return;
    const nextScope =
      pendingScopeMode === 'entire'
        ? { kind: 'EntireRepository' as const }
        : { kind: 'ManualSelection' as const, elementIds: pendingScopeIds };

    const updated: ViewInstance = {
      ...view,
      scope: nextScope,
      layoutMetadata: { ...(view.layoutMetadata ?? {}) },
    };

    ViewStore.save(updated);
    setViewsVersion((v) => v + 1);
    setScopeMode(pendingScopeMode);
    setScopeIds(pendingScopeMode === 'entire' ? [] : pendingScopeIds);
    setScopeModalOpen(false);
  }, [pendingScopeIds, pendingScopeMode, view]);

  const handleCancelScope = React.useCallback(() => {
    setPendingScopeMode(scopeMode);
    setPendingScopeIds(scopeIds);
    setScopeModalOpen(false);
  }, [scopeIds, scopeMode]);

  const effectiveView: ViewInstance | undefined = React.useMemo(() => {
    if (!view) return undefined;
    if (scopeMode === 'entire') return view;
    const elementIds = scopeIds;
    return { ...view, scope: { kind: 'ManualSelection', elementIds } };
  }, [scopeIds, scopeMode, view]);

  const viewpoint = React.useMemo(() => {
    if (!view) return undefined;
    return ViewpointRegistry.get(view.viewpointId);
  }, [view]);

  const { resolution, resolutionError } = React.useMemo(() => {
    if (!effectiveView || !viewpoint) return { resolution: null, resolutionError: null } as const;
    if (!eaRepository) return { resolution: null, resolutionError: null } as const;
    try {
      const resolved = resolveViewScope({ view: effectiveView, repository: eaRepository });
      console.log('Resolved view graph', {
        elements: resolved.elements.length,
        relationships: resolved.relationships.length,
      });
      return {
        resolution: resolved,
        resolutionError: null,
      } as const;
    } catch (e: any) {
      return {
        resolution: null,
        resolutionError: e?.message ?? 'Failed to resolve view scope.',
      } as const;
    }
  }, [eaRepository, effectiveView, viewpoint]);

  const elementTypeList = React.useMemo(() => {
    if (!resolution) return [] as string[];
    return Array.from(new Set(resolution.elements.map((e) => String(e.type ?? '')).filter(Boolean)));
  }, [resolution]);

  const relationshipTypeList = React.useMemo(() => {
    if (!resolution) return [] as string[];
    return Array.from(new Set(resolution.relationships.map((r) => String(r.type ?? '')).filter(Boolean)));
  }, [resolution]);

  const presentElementTypeList = React.useMemo(() => {
    if (!filteredElements || filteredElements.length === 0) return [] as string[];
    return Array.from(new Set(filteredElements.map((e) => String(e.type ?? '')).filter(Boolean)));
  }, [filteredElements]);

  const presentRelationshipTypeList = React.useMemo(() => {
    if (!filteredRelationships || filteredRelationships.length === 0) return [] as string[];
    return Array.from(new Set(filteredRelationships.map((r) => String(r.type ?? '')).filter(Boolean)));
  }, [filteredRelationships]);

  React.useEffect(() => {
    if (elementTypeList.length === 0) {
      setVisibleElementTypes([]);
      return;
    }
    setVisibleElementTypes((prev) => {
      if (prev.length === 0) return elementTypeList;
      const next = prev.filter((p) => elementTypeList.includes(p));
      const missing = elementTypeList.filter((t) => !next.includes(t));
      return [...next, ...missing];
    });
  }, [elementTypeList]);

  React.useEffect(() => {
    if (relationshipTypeList.length === 0) {
      setVisibleRelationshipTypes([]);
      return;
    }
    setVisibleRelationshipTypes((prev) => {
      if (prev.length === 0) return relationshipTypeList;
      const next = prev.filter((p) => relationshipTypeList.includes(p));
      const missing = relationshipTypeList.filter((t) => !next.includes(t));
      return [...next, ...missing];
    });
  }, [relationshipTypeList]);

  const lifecycleOptions = React.useMemo(() => {
    if (!resolution) return [] as string[];
    const seen = new Set<string>();
    for (const el of resolution.elements) {
      const lifecycle = normalize((el.attributes as any)?.lifecycleStatus);
      if (lifecycle) seen.add(lifecycle);
    }
    return Array.from(seen);
  }, [resolution]);

  const criticalityOptions = React.useMemo(() => {
    if (!resolution) return [] as string[];
    const seen = new Set<string>();
    for (const el of resolution.elements) {
      const criticality = normalize((el.attributes as any)?.criticality);
      if (criticality) seen.add(criticality);
    }
    return Array.from(seen);
  }, [resolution]);

  const relationshipStatusOptions = React.useMemo(() => {
    if (!resolution) return [] as string[];
    const seen = new Set<string>();
    for (const rel of resolution.relationships) {
      const status = normalize((rel.attributes as any)?.status);
      if (status) seen.add(status);
    }
    return Array.from(seen);
  }, [resolution]);

  const elementNameById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const el of resolution?.elements ?? []) {
      const name = ((el.attributes as any)?.name as string) || el.id;
      map.set(el.id, name);
    }
    return map;
  }, [resolution]);

  const targetElementOptions = React.useMemo(() => {
    return (resolution?.elements ?? []).map((el) => ({
      value: el.id,
      label: elementNameById.get(el.id) ?? el.id,
    }));
  }, [elementNameById, resolution]);

  React.useEffect(() => {
    setLifecycleFilter((prev) => prev.filter((v) => lifecycleOptions.includes(v)));
  }, [lifecycleOptions]);

  React.useEffect(() => {
    setRelationshipStatusFilter((prev) => prev.filter((v) => relationshipStatusOptions.includes(v)));
  }, [relationshipStatusOptions]);

  React.useEffect(() => {
    setCriticalityFilter((prev) => prev.filter((v) => criticalityOptions.includes(v)));
  }, [criticalityOptions]);

  const elementTypeColors = React.useMemo(() => {
    const map = new Map<string, string>();
    elementTypeList.forEach((type, idx) => {
      const paletteIdx = idx < LEGEND_COLORS.length ? idx : hashString(type) % LEGEND_COLORS.length;
      map.set(type, LEGEND_COLORS[paletteIdx]);
    });
    return map;
  }, [elementTypeList]);

  const relationshipTypeColors = React.useMemo(() => {
    const map = new Map<string, string>();
    relationshipTypeList.forEach((type, idx) => {
      const paletteIdx = idx < LEGEND_COLORS.length ? idx : hashString(type) % LEGEND_COLORS.length;
      map.set(type, LEGEND_COLORS[paletteIdx]);
    });
    return map;
  }, [relationshipTypeList]);

  const activeElementTypeSet = React.useMemo(() => new Set((visibleElementTypes.length ? visibleElementTypes : elementTypeList).map((v) => v)), [elementTypeList, visibleElementTypes]);

  const activeRelationshipTypeSet = React.useMemo(
    () => new Set((visibleRelationshipTypes.length ? visibleRelationshipTypes : relationshipTypeList).map((v) => v)),
    [relationshipTypeList, visibleRelationshipTypes],
  );

  const toggleElementTypeVisibility = React.useCallback(
    (type: string, checked: boolean) => {
      setVisibleElementTypes((prev) => {
        const base = prev.length ? prev : elementTypeList;
        if (checked) return Array.from(new Set([...base, type]));
        return base.filter((t) => t !== type);
      });
    },
    [elementTypeList],
  );

  const activeLifecycleSet = React.useMemo(() => (lifecycleFilter.length ? new Set(lifecycleFilter) : null), [lifecycleFilter]);

  const activeCriticalitySet = React.useMemo(
    () => (criticalityFilter.length ? new Set(criticalityFilter) : null),
    [criticalityFilter],
  );

  const activeFilterTags = React.useMemo(() => {
    const tags: { key: string; label: string }[] = [];

    if (lifecycleFilter.length) {
      lifecycleFilter.forEach((v) => tags.push({ key: `lifecycle:${v}`, label: `Lifecycle: ${v}` }));
    }
    if (criticalityFilter.length) {
      criticalityFilter.forEach((v) => tags.push({ key: `criticality:${v}`, label: `Criticality: ${v}` }));
    }
    if (relationshipStatusFilter.length) {
      relationshipStatusFilter.forEach((v) => tags.push({ key: `rel-status:${v}`, label: `Status: ${v}` }));
    }
    if (visibleElementTypes.length) {
      visibleElementTypes.forEach((v) => tags.push({ key: `el:${v}`, label: `Element: ${v}` }));
    }
    if (visibleRelationshipTypes.length) {
      visibleRelationshipTypes.forEach((v) => tags.push({ key: `rel:${v}`, label: `Relationship: ${v}` }));
    }

    return tags;
  }, [criticalityFilter, lifecycleFilter, relationshipStatusFilter, visibleElementTypes, visibleRelationshipTypes]);

  const activeRelationshipStatusSet = React.useMemo(
    () => (relationshipStatusFilter.length ? new Set(relationshipStatusFilter) : null),
    [relationshipStatusFilter],
  );

  const filteredElements = React.useMemo(() => {
    if (!resolution) return [] as ViewScopeResolutionResult['elements'];
    return resolution.elements.filter((el) => {
      if (!activeElementTypeSet.has(el.type)) return false;
      const lifecycle = normalize((el.attributes as any)?.lifecycleStatus);
      if (activeLifecycleSet && !activeLifecycleSet.has(lifecycle)) return false;
      const criticality = normalize((el.attributes as any)?.criticality);
      if (activeCriticalitySet && !activeCriticalitySet.has(criticality)) return false;
      return true;
    });
  }, [activeCriticalitySet, activeElementTypeSet, activeLifecycleSet, resolution]);

  const allowedElementIds = React.useMemo(() => new Set(filteredElements.map((e) => e.id)), [filteredElements]);

  const filteredRelationships = React.useMemo(() => {
    if (!resolution) return [] as ViewScopeResolutionResult['relationships'];
    return resolution.relationships.filter((rel) => {
      if (!activeRelationshipTypeSet.has(rel.type)) return false;
      if (!allowedElementIds.has(rel.fromId) || !allowedElementIds.has(rel.toId)) return false;
      const status = normalize((rel.attributes as any)?.status);
      if (activeRelationshipStatusSet && !activeRelationshipStatusSet.has(status)) return false;
      return true;
    });
  }, [activeRelationshipStatusSet, activeRelationshipTypeSet, allowedElementIds, resolution]);

  const elementTypeCounts = React.useMemo(() => {
    const resolvedCounts = new Map<string, number>();
    const visibleCounts = new Map<string, number>();
    for (const el of resolution?.elements ?? []) {
      resolvedCounts.set(el.type, (resolvedCounts.get(el.type) ?? 0) + 1);
    }
    for (const el of filteredElements) {
      visibleCounts.set(el.type, (visibleCounts.get(el.type) ?? 0) + 1);
    }
    const out: Record<string, { resolved: number; visible: number }> = {};
    for (const t of elementTypeList) {
      out[t] = { resolved: resolvedCounts.get(t) ?? 0, visible: visibleCounts.get(t) ?? 0 };
    }
    return out;
  }, [elementTypeList, filteredElements, resolution]);

  const relationshipTypeCounts = React.useMemo(() => {
    const resolvedCounts = new Map<string, number>();
    const visibleCounts = new Map<string, number>();
    for (const rel of resolution?.relationships ?? []) {
      resolvedCounts.set(rel.type, (resolvedCounts.get(rel.type) ?? 0) + 1);
    }
    for (const rel of filteredRelationships) {
      visibleCounts.set(rel.type, (visibleCounts.get(rel.type) ?? 0) + 1);
    }
    const out: Record<string, { resolved: number; visible: number }> = {};
    for (const t of relationshipTypeList) {
      out[t] = { resolved: resolvedCounts.get(t) ?? 0, visible: visibleCounts.get(t) ?? 0 };
    }
    return out;
  }, [filteredRelationships, relationshipTypeList, resolution]);

  const cyContainerRef = React.useRef<HTMLDivElement | null>(null);
  const cyRef = React.useRef<Core | null>(null);

  const buildSeedLayout = React.useCallback(() => {
    const positions = view ? layoutPositionsForView(view) : ViewLayoutStore.get(viewId);
    const nodes = filteredElements.map((el, index) => {
      const saved = positions[el.id];
      const fallbackX = 80 + (index % 4) * 180;
      const fallbackY = 80 + Math.floor(index / 4) * 140;
      return {
        id: el.id,
        label: ((el.attributes as any)?.name as string) || el.id,
        elementType: el.type,
        x: saved?.x ?? fallbackX,
        y: saved?.y ?? fallbackY,
      };
    });
    const edges = filteredRelationships.map((rel) => ({
      id: rel.id ?? `${rel.fromId}__${rel.toId}__${rel.type}`,
      source: rel.fromId,
      target: rel.toId,
      relationshipType: rel.type,
    }));
    return { nodes, edges };
  }, [filteredElements, filteredRelationships, viewId]);

  const activeRepositoryId = React.useMemo(() => {
    try {
      return localStorage.getItem('ea.repository.activeId') ?? undefined;
    } catch {
      return undefined;
    }
  }, []);

  // View = projection (read-only, no repository mutation).
  // Studio = mutable workspace (temporary draft copy).
  const handleEditInStudio = React.useCallback(() => {
    if (!view || isReadOnlyUser) return;
    try {
      window.dispatchEvent(
        new CustomEvent('ea:studio.view.open', {
          detail: {
            viewId: view.id,
            readOnly: actionBlocked,
          },
        }),
      );
    } catch {
      // Best-effort only.
    }
  }, [actionBlocked, isReadOnlyUser, view]);

  const handleRenameView = React.useCallback(() => {
    if (!view) return;
    if (actionBlocked) {
      message.warning('Governance is strict and your role is read-only. Rename is disabled.');
      return;
    }
    let nextName = view.name;
    Modal.confirm({
      title: 'Rename view',
      okText: 'Rename',
      cancelText: 'Cancel',
      content: (
        <Input
          defaultValue={view.name}
          onChange={(e) => {
            nextName = e.target.value;
          }}
          placeholder="View name"
        />
      ),
      onOk: () => {
        const name = (nextName ?? '').trim();
        if (!name) {
          message.error('Name is required.');
          return Promise.reject();
        }
        ViewStore.update(view.id, (current) => ({
          ...current,
          name,
        }));
        message.success('View renamed.');
      },
    });
  }, [actionBlocked, view]);

  const handleDuplicateView = React.useCallback(() => {
    if (!view) return;
    if (actionBlocked) {
      message.warning('Governance is strict and your role is read-only. Duplicate is disabled.');
      return;
    }
    const now = new Date().toISOString();
    const newId = `view_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const copy: ViewInstance = {
      ...view,
      id: newId,
      name: `${view.name} Copy`,
      createdAt: now,
      createdBy: actor,
      status: 'DRAFT',
    };
    const saved = ViewStore.save(copy);
    message.success('View duplicated.');
    history.replace(`/views/${saved.id}`);
  }, [actionBlocked, actor, view]);

  const handleDeleteView = React.useCallback(() => {
    if (!view) return;
    const isOwner = userRole === 'Owner';
    const isCreator = view.createdBy === actor;
    if (!isOwner && !isCreator) {
      message.warning('Only the view creator or repository owner can delete this view.');
      return;
    }
    Modal.confirm({
      title: 'Delete view?',
      content: 'Deleting a view removes only the view definition. Repository content remains unchanged.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: () => {
        const removed = ViewStore.remove(view.id);
        if (!removed) {
          message.error('Delete failed. View not found.');
          return;
        }
        dispatchIdeCommand({ type: 'workspace.closeMatchingTabs', prefix: `studio:view:${view.id}` });
        message.success('View deleted.');
        history.replace('/workspace');
      },
    });
  }, [actor, userRole, view]);

  const handleExportJson = React.useCallback(() => {
    if (!view) return;
    const positions = layoutPositionsForView(view);
    downloadJson(`${view.name || view.id}.json`, {
      view,
      layoutPositions: positions,
    });
  }, [view]);

  const handleExportPng = React.useCallback(() => {
    if (!cyRef.current || !view) return;
    try {
      const dataUrl = cyRef.current.png({ bg: '#ffffff', full: true });
      downloadDataUrl(`${view.name || view.id}.png`, dataUrl);
    } catch {
      message.error('Failed to export PNG.');
    }
  }, [view]);

  const focusNodeById = React.useCallback(
    (nodeId: string, opts?: { openProperties?: boolean }) => {
      const cy = cyRef.current;
      if (!cy) return;
      const node = cy.getElementById(nodeId);
      if (!node || node.empty()) return;

      cy.elements().removeClass('highlighted faded');
      cy.elements().not(node.neighborhood().add(node)).addClass('faded');
      node.neighborhood().add(node).addClass('highlighted');

      const elementType = node.data('elementType') as string | undefined;
      setSelection({ kind: 'repositoryElement', keys: [nodeId] });
      if (elementType) setSelectedElement({ id: nodeId, type: elementType, source: 'Diagram' });
      if (opts?.openProperties && elementType) {
        openPropertiesPanel({ elementId: nodeId, elementType });
      }
    },
    [openPropertiesPanel, setSelectedElement, setSelection],
  );

  React.useEffect(() => {
    const nodeId = selection?.selectedElementId;
    if (!nodeId) return;
    focusNodeById(nodeId, { openProperties: false });
  }, [focusNodeById, selection?.selectedElementId]);

  const handleFit = React.useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.fit(undefined, 24);
  }, []);

  const handleZoom = React.useCallback((direction: 'in' | 'out') => {
    const cy = cyRef.current;
    if (!cy) return;
    const factor = direction === 'in' ? 1.2 : 1 / 1.2;
    const current = cy.zoom();
    cy.zoom({ level: current * factor, renderedPosition: cy.renderedCenter() });
  }, []);

  const selectedElement = React.useMemo(() => {
    if (!selection?.selectedElementId) return null;
    return eaRepository?.objects.get(selection.selectedElementId) ?? null;
  }, [eaRepository, selection?.selectedElementId]);

  const selectedElementAttributes = React.useMemo(() => {
    if (!selectedElement) return {} as Record<string, unknown>;
    return (selectedElement.attributes as Record<string, unknown>) ?? {};
  }, [selectedElement]);

  React.useEffect(() => {
    const container = cyContainerRef.current;
    if (!container || filteredElements.length === 0) {
      cyRef.current?.destroy();
      cyRef.current = null;
      return undefined;
    }

    const rect = container.getBoundingClientRect();
    console.log('Cytoscape container dimensions', {
      width: rect.width,
      height: rect.height,
      display: window.getComputedStyle(container).display,
    });

    const nodes = filteredElements.map((el) => ({
      data: {
        id: el.id,
        label: (el.attributes as any)?.name || el.id,
        elementType: el.type,
        color: elementTypeColors.get(el.type) ?? '#4b9bff',
        lifecycleStatus: normalize((el.attributes as any)?.lifecycleStatus),
      },
    }));

    // Debug: when only one node resolves, pin it visibly and bypass layouts.
    if (nodes.length === 1) {
      (nodes[0] as any).position = { x: 100, y: 100 };
    }

    const edges = filteredRelationships.map((rel) => ({
      data: {
        id: rel.id ?? `${rel.fromId}__${rel.toId}__${rel.type}`,
        source: rel.fromId,
        target: rel.toId,
        relationshipType: rel.type,
        color: relationshipTypeColors.get(rel.type) ?? '#b1b7c1',
        status: normalize((rel.attributes as any)?.status),
      },
    }));

    const layout = (() => {
      const preferred = (view.layoutMetadata as any)?.layout as string | undefined;

      const mapLayout = (value: string | undefined) => {
        if (value === 'hierarchical') return { name: 'breadthfirst' as const, directed: true };
        if (value === 'radial') return { name: 'concentric' as const };
        if (value === 'grid') return { name: 'grid' as const };
        return null;
      };

      const byView = mapLayout(preferred);
      if (byView) return byView;

      if (viewpoint?.defaultLayout === 'dagre') {
        return { name: 'breadthfirst' as const, directed: true };
      }
      if (viewpoint?.defaultLayout === 'grid') {
        return { name: 'grid' as const };
      }
      return { name: 'grid' as const };
    })();

    const effectiveLayout = nodes.length === 1 ? ({ name: 'preset' } as const) : layout;

    cyRef.current?.destroy();
    cyRef.current = cytoscape({
      container,
      elements: { nodes, edges },
      layout: effectiveLayout,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            color: '#fff',
            'font-size': 10,
            'text-wrap': 'wrap',
            'text-max-width': '120px',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'line-color': 'data(color)',
            'target-arrow-color': 'data(color)',
            'target-arrow-shape': 'vee',
            'curve-style': 'bezier',
            label: 'data(relationshipType)',
            'font-size': 8,
            'text-background-color': '#fff',
            'text-background-opacity': 0.7,
            'text-rotation': 'autorotate',
          },
        },
        {
          selector: '.annotation-highlight',
          style: {
            'border-width': 4,
            'border-color': '#722ed1',
            'background-color': '#f6f0ff',
          },
        },
        {
          selector: '.annotation-callout',
          style: {
            'border-width': 3,
            'border-color': '#fa541c',
            'background-color': '#fff7f0',
            shape: 'round-rectangle',
          },
        },
        {
          selector: '.highlighted',
          style: {
            'background-color': '#faad14',
            'line-color': '#faad14',
            'target-arrow-color': '#faad14',
            'border-color': '#faad14',
            'border-width': 2,
            color: '#102039',
          },
        },
        {
          selector: '.faded',
          style: {
            opacity: 0.2,
          },
        },
      ],
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      autounselectify: true,
      autoungrabify: true,
    });

    // Fit once on initial render so the whole diagram is visible without manual zoom.
    cyRef.current.ready(() => {
      cyRef.current?.fit(undefined, 24);
    });

    // Hard-readonly canvas: no drag-create, draw-connect, or delete.
    cyRef.current.nodes().forEach((n) => {
      n.lock();
      n.ungrabify();
    });
    cyRef.current.edges().forEach((e) => e.ungrabify());
    cyRef.current.autoungrabify(true);
    cyRef.current.autounselectify(true);

    cyRef.current.on('tap', 'node', (evt) => {
      const node = evt.target;
      const id = node.id();
      focusNodeById(id, { openProperties: true });
    });

    return () => {
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [elementTypeColors, filteredElements, filteredRelationships, focusNodeById, relationshipTypeColors, viewpoint]);

  React.useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass('annotation-highlight annotation-callout');
    annotations.forEach((ann) => {
      if (!ann.targetElementId) return;
      const node = cy.getElementById(ann.targetElementId);
      if (!node || node.empty()) return;
      if (ann.kind === 'highlight') node.addClass('annotation-highlight');
      if (ann.kind === 'callout') node.addClass('annotation-callout');
    });
  }, [annotations, filteredElements]);

  if (!viewId || !view) {
    return (
      <Result
        status="404"
        title="View not found"
        subTitle={viewId ? `No saved view with id ${viewId}` : 'Missing view id'}
        extra={
          <Button
            type="primary"
            onClick={() => {
              try {
                window.dispatchEvent(new CustomEvent('ea:studio.view.create'));
              } catch {
                // Best-effort only.
              }
            }}
          >
            Create a view
          </Button>
        }
      />
    );
  }

  if (!viewpoint) {
    return (
      <Result
        status="404"
        title="Viewpoint not found"
        subTitle={`Unknown viewpoint: ${view.viewpointId}`}
        extra={
          <Button
            type="primary"
            onClick={() => {
              try {
                window.dispatchEvent(new CustomEvent('ea:studio.view.create'));
              } catch {
                // Best-effort only.
              }
            }}
          >
            Create a view
          </Button>
        }
      />
    );
  }

  return (
    <PageContainer
      title={view.name}
      subTitle={`Viewpoint: ${viewpoint.name ?? view.viewpointId}`}
      extra={
        <Space>
          {canEditView ? (
            <Button type="primary" onClick={handleEditInStudio}>
              Edit in Studio
            </Button>
          ) : null}
          <Button onClick={handleRenameView} disabled={actionBlocked}>
            Rename
          </Button>
          <Button onClick={handleDuplicateView} disabled={actionBlocked}>
            Duplicate
          </Button>
          <Button danger onClick={handleDeleteView} disabled={actionBlocked}>
            Delete
          </Button>
          <Dropdown
            menu={{
              items: [
                { key: 'png', label: 'Export PNG', onClick: handleExportPng, disabled: actionBlocked },
                { key: 'json', label: 'Export JSON', onClick: handleExportJson, disabled: actionBlocked },
              ],
            }}
          >
            <Button disabled={actionBlocked}>Export</Button>
          </Dropdown>
          {actionBlocked ? <Tag color="red">Read-only (Strict)</Tag> : <Tag color="default">Read-only</Tag>}
        </Space>
      }
      headerContent={
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Alert type="info" showIcon message="VIEW RUNTIME ACTIVE" banner />

          <Space align="center" wrap>
            <Typography.Text strong>Scope</Typography.Text>
            <Radio.Group
              size="small"
              value={scopeMode}
              onChange={(e) => handleOpenScopeModal(e.target.value)}
            >
              <Radio.Button value="entire">Entire repository</Radio.Button>
              <Radio.Button value="enterprises">Enterprises</Radio.Button>
              <Radio.Button value="capabilities">Capabilities</Radio.Button>
              <Radio.Button value="applications">Applications</Radio.Button>
            </Radio.Group>

            <Tag color="blue">{scopeSummary}</Tag>
          </Space>
        </Space>
      }
    >
      <Modal
        open={scopeModalOpen}
        onOk={handleApplyScope}
        onCancel={handleCancelScope}
        title="Choose scope"
        okText="Apply scope"
        cancelText="Cancel"
        destroyOnClose
        width={640}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Radio.Group
            value={pendingScopeMode}
            onChange={(e) => {
              const mode = e.target.value as typeof pendingScopeMode;
              setPendingScopeMode(mode);
              if (mode === 'entire') setPendingScopeIds([]);
            }}
          >
            <Radio.Button value="entire">Entire repository</Radio.Button>
            <Radio.Button value="enterprises">Enterprises</Radio.Button>
            <Radio.Button value="capabilities">Capabilities</Radio.Button>
            <Radio.Button value="applications">Applications</Radio.Button>
          </Radio.Group>

          {pendingScopeMode === 'entire' ? (
            <Alert type="info" showIcon message="Entire repository" description="All elements allowed by the viewpoint will be included." />
          ) : null}

          {pendingScopeMode === 'enterprises' ? (
            <Select
              mode="multiple"
              allowClear
              style={{ width: '100%' }}
              placeholder="Select enterprises"
              value={pendingScopeIds}
              onChange={(vals) => setPendingScopeIds(vals as string[])}
              options={enterpriseOptions}
            />
          ) : null}

          {pendingScopeMode === 'applications' ? (
            <Select
              mode="multiple"
              allowClear
              style={{ width: '100%' }}
              placeholder="Select applications"
              value={pendingScopeIds}
              onChange={(vals) => setPendingScopeIds(vals as string[])}
              options={applicationOptions}
            />
          ) : null}

          {pendingScopeMode === 'capabilities' ? (
            capabilityTree.length === 0 ? (
              <Alert
                type="warning"
                showIcon
                message="No capabilities found"
                description="Add capabilities or relationships to build the hierarchy."
              />
            ) : (
              <Tree
                checkable
                defaultExpandAll
                treeData={capabilityTree}
                checkedKeys={pendingScopeIds}
                onCheck={(keys) => setPendingScopeIds((keys as React.Key[]).map(String))}
              />
            )
          ) : null}

          <Alert
            type="info"
            showIcon
            message="Scope applies to resolved diagram content only"
            description="Scope does not create or delete repository elements; it filters what the view projects."
          />
        </Space>
      </Modal>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Card title="Resolved contents">
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {!eaRepository && (
                  <Alert
                    type="warning"
                    message="Repository not loaded"
                    description="Load or create a repository to resolve elements and relationships."
                    action={
                      <Button type="primary" onClick={() => history.push('/workspace')}>
                        Go to workspace
                      </Button>
                    }
                  />
                )}

                {resolutionError && <Alert type="error" message="Resolution failed" description={resolutionError} showIcon />}

                {resolution && (
                  <Descriptions column={1} bordered size="small">
                    <Descriptions.Item label="Elements (visible / resolved)">
                      {filteredElements.length} / {resolution.elements.length}
                    </Descriptions.Item>
                    <Descriptions.Item label="Relationships (visible / resolved)">
                      {filteredRelationships.length} / {resolution.relationships.length}
                    </Descriptions.Item>
                  </Descriptions>
                )}

                {resolution && (
                  <Space direction="vertical" size="small" style={{ marginTop: 16 }}>
                    <Typography.Text strong>Sample element IDs</Typography.Text>
                    <Typography.Paragraph style={{ marginBottom: 0 }}>
                      {(filteredElements.slice(0, 10).map((e) => e.id).join(', ')) || 'None'}
                    </Typography.Paragraph>
                    <Typography.Text strong>Sample relationship IDs</Typography.Text>
                    <Typography.Paragraph style={{ marginBottom: 0 }}>
                      {(filteredRelationships.slice(0, 10).map((r) => `${r.id ?? `${r.fromId}->${r.toId}`}`)).join(', ') || 'None'}
                    </Typography.Paragraph>
                  </Space>
                )}
              </Space>
            </Card>

            <Card title="Canvas">
              {!resolution && (
                <Typography.Paragraph type="secondary">
                  Load a repository to resolve and render the canvas.
                </Typography.Paragraph>
              )}

              {resolution && resolution.elements.length === 0 && (
                <Empty description="No elements in selected scope for this viewpoint." />
              )}

              {resolution && resolution.elements.length > 0 && filteredElements.length === 0 && (
                <Alert
                  type="info"
                  message="All elements are hidden by current filters."
                  description="Adjust type visibility or attribute filters to show diagram content."
                  showIcon
                />
              )}

              {resolution && filteredElements.length > 0 && (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Space>
                    <Button size="small" icon={<CompressOutlined />} onClick={handleFit}>
                      Fit
                    </Button>
                    <Button size="small" icon={<PlusOutlined />} onClick={() => handleZoom('in')}>
                      Zoom in
                    </Button>
                    <Button size="small" icon={<MinusOutlined />} onClick={() => handleZoom('out')}>
                      Zoom out
                    </Button>
                  </Space>

                  <div
                    ref={cyContainerRef}
                    style={{ height: 520, border: '1px solid #f0f0f0', borderRadius: 4 }}
                    aria-label="View canvas"
                  />
                </Space>
              )}
            </Card>

            <Card title="Annotations (view-only)">
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Typography.Text type="secondary">Annotations stay on this view only; repository data is unchanged.</Typography.Text>

                <Space direction="vertical" style={{ width: '100%' }} size="small">
                  <Radio.Group
                    value={annotationKind}
                    onChange={(e) => {
                      setAnnotationKind(e.target.value);
                      setAnnotationTargetId(undefined);
                    }}
                  >
                    <Radio.Button value="note">Note</Radio.Button>
                    <Radio.Button value="callout">Callout</Radio.Button>
                    <Radio.Button value="highlight">Highlight</Radio.Button>
                  </Radio.Group>

                  <Input.TextArea
                    rows={3}
                    maxLength={400}
                    value={annotationText}
                    onChange={(e) => setAnnotationText(e.target.value)}
                    placeholder="What do you want to call out?"
                  />

                  {annotationKind !== 'note' && (
                    <Select
                      showSearch
                      allowClear
                      style={{ width: '100%' }}
                      placeholder="Attach to element"
                      value={annotationTargetId}
                      onChange={(val) => setAnnotationTargetId(val as string)}
                      options={targetElementOptions}
                    />
                  )}

                  <Space>
                    <Button type="primary" onClick={handleAddAnnotation}>
                      Add annotation
                    </Button>
                    <Button
                      onClick={() => {
                        setAnnotationText('');
                        setAnnotationTargetId(undefined);
                      }}
                    >
                      Reset
                    </Button>
                  </Space>
                </Space>

                <List
                  bordered
                  dataSource={annotations}
                  locale={{ emptyText: 'No annotations yet.' }}
                  renderItem={(ann) => (
                    <List.Item
                      actions={[
                        <Button danger size="small" onClick={() => handleDeleteAnnotation(ann.id)} key="delete">
                          Delete
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space wrap>
                            <Tag color={ann.kind === 'note' ? 'blue' : ann.kind === 'callout' ? 'orange' : 'purple'}>{ann.kind}</Tag>
                            {ann.targetElementId && (
                              <Typography.Text type="secondary">
                                Target: {elementNameById.get(ann.targetElementId) ?? ann.targetElementId}
                              </Typography.Text>
                            )}
                            <Typography.Text type="secondary">
                              Saved {Number.isNaN(new Date(ann.createdAt).getTime()) ? ann.createdAt : new Date(ann.createdAt).toLocaleString()}
                            </Typography.Text>
                          </Space>
                        }
                        description={<Typography.Paragraph style={{ marginBottom: 0 }}>{ann.text}</Typography.Paragraph>}
                      />
                    </List.Item>
                  )}
                />
              </Space>
            </Card>
          </Space>
        </div>

        <div style={{ minWidth: 0 }}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Card title="View metadata">
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="View ID">{view.id}</Descriptions.Item>
                <Descriptions.Item label="Description">{view.description}</Descriptions.Item>
                <Descriptions.Item label="Scope">{view.scope?.kind ?? 'N/A'}</Descriptions.Item>
                <Descriptions.Item label="Layout Metadata">
                  <Typography.Paragraph code style={{ marginBottom: 0 }}>
                    {JSON.stringify(view.layoutMetadata ?? {}, null, 2)}
                  </Typography.Paragraph>
                </Descriptions.Item>
                <Descriptions.Item label="Created By">{view.createdBy}</Descriptions.Item>
                <Descriptions.Item label="Created At">{view.createdAt}</Descriptions.Item>
                <Descriptions.Item label="Status">{view.status}</Descriptions.Item>
              </Descriptions>
            </Card>

            <Collapse defaultActiveKey={[]}>
              <Collapse.Panel header="Viewpoint definition" key="viewpoint">
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="Viewpoint ID">{viewpoint.id}</Descriptions.Item>
                  <Descriptions.Item label="Name">{viewpoint.name}</Descriptions.Item>
                  <Descriptions.Item label="Default Layout">{viewpoint.defaultLayout}</Descriptions.Item>
                  <Descriptions.Item label="Allowed Element Types">
                    <Typography.Text>{viewpoint.allowedElementTypes.join(', ')}</Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Allowed Relationship Types">
                    <Typography.Text>{viewpoint.allowedRelationshipTypes.join(', ')}</Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Description">{viewpoint.description}</Descriptions.Item>
                </Descriptions>
              </Collapse.Panel>
            </Collapse>

            <Card title="Repository reference">
              {metadata ? (
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="Repository Name">{metadata.repositoryName}</Descriptions.Item>
                  <Descriptions.Item label="Owner">{metadata.owner.displayName ?? metadata.owner.userId}</Descriptions.Item>
                  <Descriptions.Item label="Architecture Scope">{metadata.architectureScope}</Descriptions.Item>
                  <Descriptions.Item label="Reference Framework">{metadata.referenceFramework}</Descriptions.Item>
                  <Descriptions.Item label="Time Horizon">{metadata.timeHorizon}</Descriptions.Item>
                  <Descriptions.Item label="Repository Loaded">{eaRepository ? 'Yes' : 'No (metadata only)'}</Descriptions.Item>
                </Descriptions>
              ) : (
                <Alert
                  type="warning"
                  message="No repository loaded"
                  description="Load or create a repository to render this view against data."
                  action={
                    <Button type="primary" onClick={() => history.push('/workspace')}>
                      Go to workspace
                    </Button>
                  }
                />
              )}
            </Card>

            <Card title="Legend & filters">
              <Collapse defaultActiveKey={['legend']}>
                <Collapse.Panel header="Legend" key="legend">
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <div>
                      <Typography.Text strong>Element types</Typography.Text>
                      {presentElementTypeList.length === 0 ? (
                        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          No element types are currently visible in the diagram.
                        </Typography.Paragraph>
                      ) : (
                        <Space wrap>
                          {presentElementTypeList.map((type) => (
                            <Space key={type} size="small" align="center">
                              <Tag color={elementTypeColors.get(type) ?? 'default'}>{type}</Tag>
                            </Space>
                          ))}
                        </Space>
                      )}
                    </div>

                    <div>
                      <Typography.Text strong>Relationship types</Typography.Text>
                      {presentRelationshipTypeList.length === 0 ? (
                        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          No relationship types are currently visible in the diagram.
                        </Typography.Paragraph>
                      ) : (
                        <Space wrap>
                          {presentRelationshipTypeList.map((type) => (
                            <Space key={type} size="small" align="center">
                              <Tag color={relationshipTypeColors.get(type) ?? 'default'}>{type}</Tag>
                            </Space>
                          ))}
                        </Space>
                      )}
                    </div>
                  </Space>
                </Collapse.Panel>

                <Collapse.Panel header="Filters" key="filters">
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <Space align="center" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                      <Typography.Text type="secondary">Filters hide nodes and edges visually only; data stays unchanged.</Typography.Text>
                      <Button
                        size="small"
                        onClick={() => {
                          setVisibleElementTypes([]);
                          setVisibleRelationshipTypes([]);
                          setLifecycleFilter([]);
                          setRelationshipStatusFilter([]);
                          setCriticalityFilter([]);
                        }}
                        disabled={
                          visibleElementTypes.length === 0 &&
                          visibleRelationshipTypes.length === 0 &&
                          lifecycleFilter.length === 0 &&
                          relationshipStatusFilter.length === 0 &&
                          criticalityFilter.length === 0
                        }
                      >
                        Clear All Filters
                      </Button>
                    </Space>

                    <div>
                      <Typography.Text strong>Active filters</Typography.Text>
                      {activeFilterTags.length === 0 ? (
                        <Typography.Text type="secondary">None (showing all resolved data)</Typography.Text>
                      ) : (
                        <Space wrap>
                          {activeFilterTags.map((t) => (
                            <Tag key={t.key} color="blue">
                              {t.label}
                            </Tag>
                          ))}
                        </Space>
                      )}
                    </div>

                    <div>
                      <Typography.Text strong>Quick element toggles</Typography.Text>
                      <Space wrap>
                        {['Capability', 'Application', 'Technology'].map((type) => {
                          const available = elementTypeList.includes(type);
                          return (
                            <Checkbox
                              key={type}
                              checked={available ? activeElementTypeSet.has(type) : false}
                              disabled={!available}
                              onChange={(e) => toggleElementTypeVisibility(type, e.target.checked)}
                            >
                              <Tag color={elementTypeColors.get(type) ?? 'default'}>{type}</Tag>
                            </Checkbox>
                          );
                        })}
                      </Space>
                    </div>

                    <div>
                      <Typography.Text strong>Element types</Typography.Text>
                      {elementTypeList.length === 0 ? (
                        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          Resolve a repository view to see element types.
                        </Typography.Paragraph>
                      ) : (
                        <Space direction="vertical" style={{ width: '100%' }} size="small">
                          <Space wrap>
                            {elementTypeList.map((type) => (
                              <Checkbox
                                key={type}
                                checked={activeElementTypeSet.has(type)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setVisibleElementTypes((prev) => {
                                    const base = prev.length ? prev : elementTypeList;
                                    if (checked) return Array.from(new Set([...base, type]));
                                    return base.filter((t) => t !== type);
                                  });
                                }}
                              >
                                <Tag color={elementTypeColors.get(type) ?? 'default'}>{type}</Tag>
                                <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                                  {elementTypeCounts[type]?.visible ?? 0}/{elementTypeCounts[type]?.resolved ?? 0}
                                </Typography.Text>
                              </Checkbox>
                            ))}
                          </Space>
                          <Button size="small" onClick={() => setVisibleElementTypes(elementTypeList)} disabled={elementTypeList.length === 0}>
                            Show all
                          </Button>
                        </Space>
                      )}
                    </div>

                    <div>
                      <Typography.Text strong>Relationship types</Typography.Text>
                      {relationshipTypeList.length === 0 ? (
                        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          Resolve a repository view to see relationship types.
                        </Typography.Paragraph>
                      ) : (
                        <Space direction="vertical" style={{ width: '100%' }} size="small">
                          <Space wrap>
                            {relationshipTypeList.map((type) => (
                              <Checkbox
                                key={type}
                                checked={activeRelationshipTypeSet.has(type)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setVisibleRelationshipTypes((prev) => {
                                    const base = prev.length ? prev : relationshipTypeList;
                                    if (checked) return Array.from(new Set([...base, type]));
                                    return base.filter((t) => t !== type);
                                  });
                                }}
                              >
                                <Tag color={relationshipTypeColors.get(type) ?? 'default'}>{type}</Tag>
                                <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                                  {relationshipTypeCounts[type]?.visible ?? 0}/{relationshipTypeCounts[type]?.resolved ?? 0}
                                </Typography.Text>
                              </Checkbox>
                            ))}
                          </Space>
                          <Button
                            size="small"
                            onClick={() => setVisibleRelationshipTypes(relationshipTypeList)}
                            disabled={relationshipTypeList.length === 0}
                          >
                            Show all
                          </Button>
                        </Space>
                      )}
                    </div>

                    <div>
                      <Typography.Text strong>Attribute filters</Typography.Text>
                      <Space direction="vertical" style={{ width: '100%' }} size="small">
                        <Select
                          mode="multiple"
                          allowClear
                          style={{ width: '100%' }}
                          placeholder="Lifecycle status (elements)"
                          options={lifecycleOptions.map((v) => ({ value: v, label: v }))}
                          value={lifecycleFilter}
                          onChange={(vals) => setLifecycleFilter(vals as string[])}
                        />
                        <Select
                          mode="multiple"
                          allowClear
                          style={{ width: '100%' }}
                          placeholder="Criticality (elements)"
                          options={criticalityOptions.map((v) => ({ value: v, label: v }))}
                          value={criticalityFilter}
                          onChange={(vals) => setCriticalityFilter(vals as string[])}
                        />
                        <Select
                          mode="multiple"
                          allowClear
                          style={{ width: '100%' }}
                          placeholder="Status (relationships)"
                          options={relationshipStatusOptions.map((v) => ({ value: v, label: v }))}
                          value={relationshipStatusFilter}
                          onChange={(vals) => setRelationshipStatusFilter(vals as string[])}
                        />
                      </Space>
                    </div>
                  </Space>
                </Collapse.Panel>
              </Collapse>
            </Card>

            <Card title="Read-only properties">
              {selectedElement ? (
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="Name">
                    {(selectedElementAttributes.name as string) || selectedElement.id}
                  </Descriptions.Item>
                  <Descriptions.Item label="ID">{selectedElement.id}</Descriptions.Item>
                  <Descriptions.Item label="Type">{selectedElement.type}</Descriptions.Item>
                  <Descriptions.Item label="Lifecycle">
                    {normalize(selectedElementAttributes.lifecycleStatus) || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Criticality">
                    {normalize(selectedElementAttributes.criticality) || '—'}
                  </Descriptions.Item>
                </Descriptions>
              ) : (
                <Empty description="Select an element on the canvas" />
              )}
            </Card>
          </Space>
        </div>
      </div>

      <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
        View definition, viewpoint contract, and repository context are loaded. Element resolution and canvas rendering will follow in the next step.
      </Typography.Paragraph>
    </PageContainer>
  );
};

export default ViewRuntimePage;
