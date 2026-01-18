// GLOBAL RULE: Diagram interactions are navigational only. No diagram interaction may create, modify, or infer architecture truth.
import { Button, message } from 'antd';
import React, { useCallback, useEffect, useRef } from 'react';
import cytoscape, { Core } from 'cytoscape';

import type { ObjectType, RelationshipType } from '../utils/eaMetaModel';
import type { EaRepository } from '../utils/eaRepository';
import type { EaViewDefinition } from '../utils/eaViewDefinitions';
import type { LifecycleCoverage } from '@/repository/repositoryMetadata';
import { isObjectVisibleForLifecycleCoverage } from '@/repository/lifecycleCoveragePolicy';
import { useIdeSelection } from '@/ide/IdeSelectionContext';
import { useIdeShell } from '@/components/IdeShellLayout';
import { ViewLayoutStore } from '@/diagram-studio/view-runtime/ViewLayoutStore';

const GRID_SIZE = 12;

const snapToGrid = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

const loadLayoutPositions = (viewId: string): Record<string, { x: number; y: number }> => {
  return ViewLayoutStore.get(viewId);
};

const persistLayoutPositions = (viewId: string, cy: Core) => {
  if (!viewId || !cy) return;
  const positions: Record<string, { x: number; y: number }> = {};
  cy.nodes().forEach((n) => {
    const pos = n.position();
    positions[n.id()] = { x: snapToGrid(pos.x), y: snapToGrid(pos.y) };
  });
  ViewLayoutStore.set(viewId, positions);
};

const clearLayoutPositions = (viewId: string) => {
  ViewLayoutStore.remove(viewId);
};

export type EaGraphNode = {
  id: string;
  label: string;
  objectType: ObjectType;
  attributes?: Record<string, unknown>;
};

export type EaGraphEdge = {
  fromId: string;
  toId: string;
  relationshipType: RelationshipType;
  attributes?: Record<string, unknown>;
};

type GraphViewProps = {
  depth: 1 | 2 | 3;
  eaRepository: EaRepository;
  lifecycleCoverage?: LifecycleCoverage | null;
  viewDefinition: EaViewDefinition;
  viewMode: 'landscape' | 'impact';
  rootNodeId?: string;
  impactPaths?: string[][];
  defaultLayout?: 'grid' | 'cose' | 'breadthfirst';
  onSelectNode?: (node: EaGraphNode) => void;
  onSelectEdge?: (edge: EaGraphEdge) => void;
};

const filterGraphByDepth = (
  data: { nodes: EaGraphNode[]; edges: EaGraphEdge[] },
  rootId: string,
  depth: number,
) => {
  if (!rootId) {
    return { nodes: [], edges: [] };
  }
  const outgoing = new Map<string, string[]>();
  for (const e of data.edges) {
    const current = outgoing.get(e.fromId);
    if (current) current.push(e.toId);
    else outgoing.set(e.fromId, [e.toId]);
  }

  const included = new Set<string>([rootId]);
  let frontier = new Set<string>([rootId]);

  for (let i = 0; i < depth; i += 1) {
    const next = new Set<string>();
    for (const nodeId of frontier) {
      const neighbors = outgoing.get(nodeId) ?? [];
      for (const neighborId of neighbors) {
        if (!included.has(neighborId)) {
          included.add(neighborId);
          next.add(neighborId);
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  return {
    nodes: data.nodes.filter((n) => included.has(n.id)),
    edges: data.edges.filter((e) => included.has(e.fromId) && included.has(e.toId)),
  };
};

const GraphView = ({
  depth,
  eaRepository,
  lifecycleCoverage,
  viewDefinition,
  viewMode,
  rootNodeId,
  impactPaths,
  defaultLayout,
  onSelectNode,
  onSelectEdge,
}: GraphViewProps) => {
  const { selection, setSelection, setSelectedElement } = useIdeSelection();
  const { openPropertiesPanel } = useIdeShell();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const impactPathsRef = useRef<string[][] | undefined>(impactPaths);
  const incomingByNodeRef = useRef<Map<string, string[]>>(new Map());
  const outgoingByNodeRef = useRef<Map<string, string[]>>(new Map());
  const nodeByIdRef = useRef<Map<string, EaGraphNode>>(new Map());
  const focusedNodeIdRef = useRef<string | null>(null);
  const hoverRafRef = useRef<number | null>(null);
  const pendingHoverIdRef = useRef<string | null>(null);
  const layoutToastShownRef = useRef(false);

  const [edgeTooltip, setEdgeTooltip] = React.useState<
    | { visible: true; x: number; y: number; lines: string[] }
    | { visible: false }
  >({ visible: false });

  const handleResetLayout = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const viewId = viewDefinition?.id;
    if (viewId) clearLayoutPositions(viewId);
    try {
      cy.layout({ name: defaultLayout ?? viewDefinition.defaultLayout ?? 'grid', avoidOverlap: true }).run();
      cy.fit(undefined, 24);
    } catch {
      // Best-effort only.
    }
  }, [defaultLayout, viewDefinition]);

  const handleFitView = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    try {
      cy.fit(undefined, 24);
    } catch {
      // best-effort only
    }
  }, []);

  const preventExternalDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    // Canvas is read-only; block drag/drop to avoid accidental creation flows.
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const preventContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const preventEditingShortcuts = useCallback((event: KeyboardEvent) => {
    const key = event.key?.toLowerCase();
    const isDelete = key === 'delete' || key === 'backspace';
    const isCreateCombo = event.ctrlKey && (key === 'n' || key === 'insert');
    if (isDelete || isCreateCombo || key === 'insert') {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  const focusNodeById = useCallback(
    (nodeId: string, opts?: { openProperties?: boolean }) => {
      const cy = cyRef.current;
      if (!cy) return;
      const node = cy.getElementById(nodeId);
      if (!node || node.empty()) return;

      const hasImpactPaths = (impactPathsRef.current?.length ?? 0) > 0;
      if (!hasImpactPaths) {
        const neighborhood = node.neighborhood().add(node);
        cy.elements().removeClass('highlighted faded');
        cy.elements().not(neighborhood).addClass('faded');
        neighborhood.addClass('highlighted');
      }

      const selected = nodeByIdRef.current.get(nodeId);
      if (selected) {
        setSelection({ kind: 'repositoryElement', keys: [selected.id] });
        setSelectedElement({ id: selected.id, type: selected.objectType, source: 'Diagram' });
        if (opts?.openProperties) {
          openPropertiesPanel({ elementId: selected.id, elementType: selected.objectType, dock: 'right' });
        }
      }

      focusedNodeIdRef.current = nodeId;
    },
    [openPropertiesPanel, setSelectedElement, setSelection],
  );

  const moveFocus = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      const cy = cyRef.current;
      if (!cy) return;
      const nodes = cy.nodes();
      if (nodes.empty()) return;

      const pickOrigin = () => {
        if (focusedNodeIdRef.current) {
          const n = cy.getElementById(focusedNodeIdRef.current);
          if (n && n.nonempty()) return n;
        }
        if (selection?.selectedElementId) {
          const n = cy.getElementById(selection.selectedElementId);
          if (n && n.nonempty()) return n;
        }
        return nodes[0];
      };

      const origin = pickOrigin();
      if (!origin) return;
      const originPos = origin.position();

      let bestId = origin.id();
      let bestPrimary = Number.POSITIVE_INFINITY;
      let bestDistance = Number.POSITIVE_INFINITY;

      nodes.forEach((n) => {
        if (n.id() === origin.id()) return;
        const pos = n.position();
        const dx = pos.x - originPos.x;
        const dy = pos.y - originPos.y;
        let primary = 0;

        switch (direction) {
          case 'left':
            if (dx >= -1e-3) return;
            primary = -dx;
            break;
          case 'right':
            if (dx <= 1e-3) return;
            primary = dx;
            break;
          case 'up':
            if (dy >= -1e-3) return;
            primary = -dy;
            break;
          case 'down':
            if (dy <= 1e-3) return;
            primary = dy;
            break;
          default:
            return;
        }

        const distance = dx * dx + dy * dy;
        const isBetterPrimary = primary < bestPrimary - 1e-6;
        const isTiePrimary = Math.abs(primary - bestPrimary) < 1e-6;
        const isBetterDistance = distance < bestDistance - 1e-6;

        if (isBetterPrimary || (isTiePrimary && isBetterDistance)) {
          bestPrimary = primary;
          bestDistance = distance;
          bestId = n.id();
        }
      });

      focusNodeById(bestId);
    },
    [focusNodeById, selection?.selectedElementId],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const key = event.key;
      if (key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        moveFocus('left');
        return;
      }
      if (key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        moveFocus('right');
        return;
      }
      if (key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        moveFocus('up');
        return;
      }
      if (key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        moveFocus('down');
        return;
      }
      if (key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        const targetId = focusedNodeIdRef.current;
        if (targetId) focusNodeById(targetId, { openProperties: true });
      }
    },
    [focusNodeById, moveFocus],
  );

  const applyImpactPathHighlight = (cy: Core, paths?: string[][]) => {
    cy.elements().removeClass('highlighted faded');

    if (!paths || paths.length === 0) return;

    const nodeIds = new Set<string>();
    const edgePairs = new Set<string>();

    for (const path of paths) {
      for (let i = 0; i < path.length; i += 1) {
        const nodeId = path[i];
        nodeIds.add(nodeId);
        if (i > 0) edgePairs.add(`${path[i - 1]}->${nodeId}`);
      }
    }

    const nodesToHighlight = cy.nodes().filter((n) => nodeIds.has(n.id()));
    const edgesToHighlight = cy
      .edges()
      .filter((e) => edgePairs.has(`${e.data('source')}->${e.data('target')}`));

    const elementsToHighlight = nodesToHighlight.union(edgesToHighlight);
    cy.elements().not(elementsToHighlight).addClass('faded');
    elementsToHighlight.addClass('highlighted');
  };

  useEffect(() => {
    impactPathsRef.current = impactPaths;
    if (cyRef.current) applyImpactPathHighlight(cyRef.current, impactPaths);
  }, [impactPaths]);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let raf1: number | undefined;
    let raf2: number | undefined;

    const allowedObjectTypeSet = new Set(viewDefinition.allowedObjectTypes);
    const allowedRelationshipTypeSet = new Set(viewDefinition.allowedRelationshipTypes);

    const nodes: EaGraphNode[] = Array.from(eaRepository.objects.values())
      .filter((obj) => allowedObjectTypeSet.has(obj.type))
      .filter((obj) => obj.attributes.hiddenFromDiagrams !== true)
      .filter((obj) => obj.attributes._deleted !== true)
      .filter((obj) => isObjectVisibleForLifecycleCoverage(lifecycleCoverage, obj.attributes ?? {}))
      .map((obj) => {
        const name = typeof obj.attributes.name === 'string' && obj.attributes.name.trim() ? obj.attributes.name : obj.id;
        return {
          id: obj.id,
          label: name,
          objectType: obj.type,
          attributes: obj.attributes,
        };
      });

    const nodeIdSet = new Set(nodes.map((n) => n.id));

    const edges: EaGraphEdge[] = eaRepository.relationships
      .filter((r) => allowedRelationshipTypeSet.has(r.type))
      .filter((r) => nodeIdSet.has(r.fromId) && nodeIdSet.has(r.toId))
      .map((r) => ({
        fromId: r.fromId,
        toId: r.toId,
        relationshipType: r.type,
        attributes: r.attributes,
      }));

    const data = { nodes, edges };
    const resolvedRootId = rootNodeId && nodes.some((n) => n.id === rootNodeId) ? rootNodeId : '';

    const filtered =
      viewMode === 'landscape'
        ? data
        : resolvedRootId
          ? filterGraphByDepth(data, resolvedRootId, depth)
          : { nodes: [], edges: [] };
    const nodeById = new Map(filtered.nodes.map((n) => [n.id, n] as const));
    nodeByIdRef.current = nodeById;
    const edgeByEdgeId = new Map<string, EaGraphEdge>();
    const incomingByNode = new Map<string, string[]>();
    const outgoingByNode = new Map<string, string[]>();

    for (const e of filtered.edges) {
      const arr = incomingByNode.get(e.toId);
      if (arr) arr.push(e.fromId);
      else incomingByNode.set(e.toId, [e.fromId]);

      const outArr = outgoingByNode.get(e.fromId);
      if (outArr) outArr.push(e.toId);
      else outgoingByNode.set(e.fromId, [e.toId]);
    }

    incomingByNodeRef.current = incomingByNode;
    outgoingByNodeRef.current = outgoingByNode;

    const elements = [
      ...filtered.nodes.map((n) => ({
        data: { id: n.id, label: n.label, objectType: n.objectType },
      })),
      ...filtered.edges
        .filter((e) => nodeById.has(e.fromId) && nodeById.has(e.toId))
        .map((e, index) => {
          const id = `e-${index}`;
          edgeByEdgeId.set(id, e);
          return {
            data: {
              id,
              source: e.fromId,
              target: e.toId,
              relationshipType: e.relationshipType,
            },
          };
        }),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      layout: { name: defaultLayout ?? viewDefinition.defaultLayout ?? 'grid', avoidOverlap: true },
      // READ-ONLY data; layout moves are allowed for presentation only (no persistence)
      autoungrabify: false,       // Allow dragging nodes to adjust layout locally
      autounselectify: true,      // Disable selection state; taps still trigger highlighting
      boxSelectionEnabled: false, // No box selection
      selectionType: 'single',    // Single selection only
      userPanningEnabled: true,   // Navigation only
      userZoomingEnabled: true,   // Navigation only
      // NOTE: Element creation is NOT supported on canvas.
      // Use Explorer context menu (Right-click on collection > + Create [Type])
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'background-color': '#1677ff',
            color: '#ffffff',
            'font-size': 12,
            width: 56,
            height: 56,
          },
        },
        {
          selector: 'node.faded',
          style: {
            opacity: 0.2,
            'text-opacity': 0.2,
          },
        },
        {
          selector: 'edge.faded',
          style: {
            opacity: 0.1,
          },
        },
        {
          selector: 'node.highlighted',
          style: {
            'border-width': 3,
            'border-color': '#52c41a',
          },
        },
        {
          selector: 'node.selected-from-explorer',
          style: {
            'border-width': 3,
            'border-color': '#13c2c2',
            'box-shadow': '0 0 0 2px rgba(19,194,194,0.35)',
          },
        },
        {
          selector: 'edge.highlighted',
          style: {
            width: 3,
            'line-color': '#52c41a',
            'target-arrow-color': '#52c41a',
          },
        },
        {
          selector: 'node.hover-upstream',
          style: {
            'border-width': 2,
            'border-color': '#91caff',
          },
        },
        {
          selector: 'edge.hover-upstream',
          style: {
            'line-color': '#91caff',
            'target-arrow-color': '#91caff',
            width: 2,
          },
        },
        {
          selector: 'node.hover-downstream',
          style: {
            'border-width': 2,
            'border-color': '#ff7875',
          },
        },
        {
          selector: 'edge.hover-downstream',
          style: {
            'line-color': '#ff7875',
            'target-arrow-color': '#ff7875',
            width: 2,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'line-color': '#91caff',
            'target-arrow-color': '#91caff',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
          },
        },
      ],
    });

    cyRef.current = cy;
    const viewId = viewDefinition?.id;
    const savedPositions = viewId ? loadLayoutPositions(viewId) : {};

    if (savedPositions && Object.keys(savedPositions).length > 0) {
      cy.batch(() => {
        cy.nodes().positions((node) => savedPositions[node.id()] ?? node.position());
      });
    }

    try {
      cy.edges().ungrabify();
    } catch {
      // Best-effort: keep relationships non-draggable.
    }

    const onNodeDragFree = () => {
      cy.nodes().forEach((n) => {
        const pos = n.position();
        n.position({ x: snapToGrid(pos.x), y: snapToGrid(pos.y) });
      });
      if (!layoutToastShownRef.current) {
        message.info('Layout changes affect this view only.', 2.5);
        layoutToastShownRef.current = true;
      }
      if (viewId) persistLayoutPositions(viewId, cy);
    };
    cy.on('dragfree', 'node', onNodeDragFree);

    const preventMutationGesture = (event: cytoscape.EventObject) => {
      event.preventDefault();
      event.stopPropagation();
    };

    // Hard guard against creation/connect gestures (right-click, long-press, drag-to-connect)
    cy.on('cxttapstart', preventMutationGesture);
    cy.on('cxttap', preventMutationGesture);
    cy.on('taphold', preventMutationGesture);

    const resizeAndFit = () => {
      if (disposed) return;
      // Avoid calling into Cytoscape after destroy/unmount.
      if (!cyRef.current) return;
      try {
        cy.resize();
        cy.fit(undefined, 24);
      } catch {
        // Best-effort: Cytoscape can throw if container is gone mid-frame.
      }
    };

    const updateVisibilityForViewport = () => {
      if (disposed) return;
      const extent = cy.extent();
      const margin = 200; // pixel margin to avoid flicker on edges
      const minX = extent.x1 - margin;
      const maxX = extent.x2 + margin;
      const minY = extent.y1 - margin;
      const maxY = extent.y2 + margin;

      const visibleNodes = new Set<string>();

      cy.nodes().forEach((n) => {
        const pos = n.position();
        const within = pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY;
        if (within) {
          visibleNodes.add(n.id());
          if (n.hidden()) n.show();
        } else if (!n.hidden()) {
          n.hide();
        }
      });

      cy.edges().forEach((e) => {
        const s = e.data('source');
        const t = e.data('target');
        const shouldShow = visibleNodes.has(s) && visibleNodes.has(t);
        if (shouldShow && e.hidden()) e.show();
        else if (!shouldShow && !e.hidden()) e.hide();
      });
    };

    // Cytoscape can initialize before the container has a final size.
    // A couple of rAF ticks makes it much more reliable in complex layouts.
    raf1 = requestAnimationFrame(() => {
      resizeAndFit();
      raf2 = requestAnimationFrame(resizeAndFit);
    });

    window.addEventListener('resize', resizeAndFit);
    window.addEventListener('keydown', preventEditingShortcuts, true);

    const runHoverHighlight = (nodeId: string | null) => {
      clearHover();
      if (!nodeId) return;

      const incoming = incomingByNodeRef.current;
      const outgoing = outgoingByNodeRef.current;
      if (!incoming || !outgoing) return;

      const directUpstream = new Set<string>(incoming.get(nodeId) ?? []);
      const directDownstream = new Set<string>(outgoing.get(nodeId) ?? []);

      if (directUpstream.size > 0) {
        const upstreamNodes = cy.nodes().filter((n) => directUpstream.has(n.id()));
        const upstreamEdges = cy
          .edges()
          .filter((e) => directUpstream.has(e.data('source')) && e.data('target') === nodeId);
        upstreamNodes.addClass('hover-upstream');
        upstreamEdges.addClass('hover-upstream');
      }

      if (directDownstream.size > 0) {
        const downstreamNodes = cy.nodes().filter((n) => directDownstream.has(n.id()));
        const downstreamEdges = cy
          .edges()
          .filter((e) => e.data('source') === nodeId && directDownstream.has(e.data('target')));
        downstreamNodes.addClass('hover-downstream');
        downstreamEdges.addClass('hover-downstream');
      }
    };

    const clearHover = () => {
      if (hoverRafRef.current !== null) {
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
      pendingHoverIdRef.current = null;
      cy.elements().removeClass('hover-upstream hover-downstream');
      setEdgeTooltip({ visible: false });
    };

    const scheduleHover = (nodeId: string | null) => {
      pendingHoverIdRef.current = nodeId;
      if (hoverRafRef.current !== null) return;
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null;
        runHoverHighlight(pendingHoverIdRef.current);
      });
    };

    window.addEventListener('blur', clearHover, true);
    cy.on('viewport', updateVisibilityForViewport);
    updateVisibilityForViewport();

    const onNodeHover = (event: cytoscape.EventObject) => {
      const node = event.target as cytoscape.NodeSingular;
      const startId = node.id();
      if (!startId) return;
      scheduleHover(startId);
    };

    const onNodeTap = (event: cytoscape.EventObject) => {
      const node = event.target as cytoscape.NodeSingular;
      focusNodeById(node.id(), { openProperties: true });
      const selected = nodeById.get(node.id());
      if (selected) onSelectNode?.(selected);
    };

    const onEdgeTap = (event: cytoscape.EventObject) => {
      const edge = event.target as cytoscape.EdgeSingular;
      const hasImpactPaths = (impactPathsRef.current?.length ?? 0) > 0;
      if (!hasImpactPaths) {
        cy.elements().removeClass('highlighted faded');
        edge.addClass('highlighted');
      }

      const selected = edgeByEdgeId.get(edge.id());
      if (selected) onSelectEdge?.(selected);
    };

    const onEdgeHover = (event: cytoscape.EventObject) => {
      const edge = event.target as cytoscape.EdgeSingular;
      const relType = edge.data('relationshipType') as string;
      const sourceId = edge.data('source') as string;
      const targetId = edge.data('target') as string;
      const sourceName = nodeByIdRef.current.get(sourceId)?.label ?? sourceId;
      const targetName = nodeByIdRef.current.get(targetId)?.label ?? targetId;
      const pos = event.renderedPosition || { x: 0, y: 0 };
      setEdgeTooltip({
        visible: true,
        x: pos.x,
        y: pos.y,
        lines: [`Relationship: ${relType}`, `Source: ${sourceName}`, `Target: ${targetName}`],
      });
    };

    const enforceSingleSelection = (event: cytoscape.EventObject) => {
      const target = event.target as cytoscape.SingularElementArgument;
      const others = cy.$(':selected').not(target);
      if (others.nonempty()) others.unselect();
    };

    cy.on('tap', 'node', onNodeTap);
    cy.on('tap', 'edge', onEdgeTap);
    cy.on('mouseover', 'edge', onEdgeHover);
    cy.on('mouseout', 'edge', clearHover);
    cy.on('mouseover', 'node', onNodeHover);
    cy.on('mouseout', 'node', clearHover);
    cy.on('mouseout', clearHover);
    cy.on('select', 'node', enforceSingleSelection);
    cy.on('select', 'edge', enforceSingleSelection);

    const containerEl = containerRef.current;
    const onMouseLeaveContainer = () => scheduleHover(null);
    containerEl?.addEventListener('mouseleave', onMouseLeaveContainer);
    containerEl?.addEventListener('contextmenu', preventContextMenu);

    // If parent already has computed paths, apply them immediately.
    applyImpactPathHighlight(cy, impactPathsRef.current);

    return () => {
      disposed = true;
      if (raf1 !== undefined) cancelAnimationFrame(raf1);
      if (raf2 !== undefined) cancelAnimationFrame(raf2);
      window.removeEventListener('resize', resizeAndFit);
      cy.off('tap', 'node', onNodeTap);
      cy.off('tap', 'edge', onEdgeTap);
      cy.off('mouseover', 'edge', onEdgeHover);
      cy.off('mouseout', 'edge', clearHover);
      cy.off('mouseover', 'node', onNodeHover);
      cy.off('mouseout', 'node', clearHover);
      cy.off('mouseout', clearHover);
      cy.off('viewport', updateVisibilityForViewport);
      cy.off('select', 'node', enforceSingleSelection);
      cy.off('select', 'edge', enforceSingleSelection);
      cy.off('dragfree', 'node', onNodeDragFree);
      cy.off('cxttapstart', preventMutationGesture);
      cy.off('cxttap', preventMutationGesture);
      cy.off('taphold', preventMutationGesture);
      cyRef.current?.destroy();
      cyRef.current = null;
      containerEl?.removeEventListener('mouseleave', onMouseLeaveContainer);
      window.removeEventListener('keydown', preventEditingShortcuts, true);
      window.removeEventListener('blur', clearHover, true);
      containerEl?.removeEventListener('contextmenu', preventContextMenu);
    };
  }, [
    defaultLayout,
    depth,
    eaRepository,
    lifecycleCoverage,
    onSelectEdge,
    onSelectNode,
    preventExternalDrop,
    preventContextMenu,
    preventEditingShortcuts,
    rootNodeId,
    setSelectedElement,
    openPropertiesPanel,
    setSelection,
    viewDefinition,
    viewMode,
  ]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const activeId = selection?.selectedElementId;
    cy.nodes('.selected-from-explorer').removeClass('selected-from-explorer');

    if (!activeId) return;

    const node = cy.getElementById(activeId);
    if (node && node.nonempty()) {
      node.addClass('selected-from-explorer');
    }
  }, [selection?.selectedElementId]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 20, display: 'flex', gap: 8 }}>
        <Button size="small" onClick={handleResetLayout}>
          Reset Layout
        </Button>
        <Button size="small" onClick={handleFitView}>
          Fit
        </Button>
      </div>
      <div
        id="graph-container"
        ref={containerRef}
        style={{ width: '100%', height: '100%', backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.08) 0, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 12px), repeating-linear-gradient(90deg, rgba(0,0,0,0.08) 0, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 12px)' }}
        onDragEnter={preventExternalDrop}
        onDragOver={preventExternalDrop}
        onDrop={preventExternalDrop}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      />
      {edgeTooltip.visible ? (
        <div
          style={{
            position: 'absolute',
            left: edgeTooltip.x + 12,
            top: edgeTooltip.y + 12,
            background: '#fff',
            color: '#000',
            border: '1px solid #d9d9d9',
            borderRadius: 6,
            padding: '8px 10px',
            boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
            fontSize: 12,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}
        >
          {edgeTooltip.lines.map((line, idx) => (
            <div key={idx}>{line}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default GraphView;
