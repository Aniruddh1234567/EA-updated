import { ProCard } from '@ant-design/pro-components';
import { Alert, Button, Checkbox, Collapse, Descriptions, Radio, Space, Tag, Tooltip, Typography } from 'antd';
import cytoscape, { type Core } from 'cytoscape';
import React from 'react';

import type { Orientation, LayoutType, ViewDefinition } from '../../../backend/views/ViewDefinition';
import { getViewRepository } from '../../../backend/views/ViewRepositoryStore';
import { viewResolver, type ResolvedViewData } from '../../../backend/views/ViewResolver';
import { graphRenderingAdapter } from '../../pages/dependency-view/utils/GraphRenderingAdapter';
import { ENTERPRISE_VIEW_GOVERNANCE_POLICY, evaluateViewGovernance } from '../../../backend/views/ViewGovernance';
import ArchitectureReviewPanel from '@/components/ArchitectureReviewPanel';
import { useEaRepository } from '@/ea/EaRepositoryContext';
import { getTimeHorizonWindow } from '@/repository/timeHorizonPolicy';
import { useIdeShell } from './index';
import { message } from '@/ea/eaConsole';
import { ViewpointRegistry } from '@/diagram-studio/viewpoints/ViewpointRegistry';
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

export type ViewDefinitionTabProps = {
  viewId: string;
};

type ImpactSelectionDetail =
  | {
      kind: 'clear';
    }
  | {
      kind: 'path';
      rootElementId: string;
      impactedElementId: string;
      orderedElementIds: string[];
      orderedRelationshipIds: string[];
    };

const normalizeId = (value: string) => (value ?? '').trim();
type LifecycleFilter = 'Both' | 'As-Is' | 'To-Be';

const layoutHintForView = (
  view: ViewDefinition | null,
): { layoutType: LayoutType; orientation: Orientation } => {
  const fallback = { layoutType: 'Grid' as LayoutType, orientation: 'TopDown' as Orientation };
  if (!view) return fallback;
  const viewpointId = (view as any)?.viewpointId as string | undefined;
  if (!viewpointId) return fallback;
  const vp = ViewpointRegistry.get(viewpointId);
  if (!vp) return fallback;

  switch (vp.defaultLayout) {
    case 'dagre':
      return { layoutType: 'Hierarchical', orientation: 'TopDown' };
    case 'layered':
    case 'elkjs':
      return { layoutType: 'Layered', orientation: 'TopDown' };
    case 'grid':
    default:
      return { layoutType: 'Grid', orientation: 'TopDown' };
  }
};

const ViewDefinitionTab: React.FC<ViewDefinitionTabProps> = ({ viewId }) => {
  const { metadata, eaRepository } = useEaRepository();
  const { openWorkspaceTab } = useIdeShell();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const cyRef = React.useRef<Core | null>(null);
  const layoutToastShownRef = React.useRef(false);
  const [refreshToken, setRefreshToken] = React.useState(0);
  const [typeFilters, setTypeFilters] = React.useState<Record<string, boolean>>({
    Capability: true,
    BusinessService: true,
    Application: true,
    Technology: true,
  });
  const [layerFilters, setLayerFilters] = React.useState<Record<string, boolean>>({
    Business: true,
    Application: true,
    Technology: true,
  });
  const [lifecycleFilter, setLifecycleFilter] = React.useState<LifecycleFilter>('Both');
  const [relationshipFilters, setRelationshipFilters] = React.useState<Record<string, boolean>>({
    SUPPORTED_BY: true,
    REALIZED_BY: true,
    REALIZES: true,
    TRIGGERS: true,
    SERVED_BY: true,
    EXPOSES: true,
    PROVIDED_BY: true,
    USED_BY: true,
    USES: true,
    DEPLOYED_ON: true,
    IMPACTS: true,
  });

  const resetFilters = React.useCallback(() => {
    setTypeFilters({
      Capability: true,
      BusinessService: true,
      Application: true,
      Technology: true,
    });
    setLayerFilters({
      Business: true,
      Application: true,
      Technology: true,
    });
    setLifecycleFilter('Both');
    setRelationshipFilters({
      SUPPORTED_BY: true,
      REALIZED_BY: true,
      REALIZES: true,
      TRIGGERS: true,
      SERVED_BY: true,
      EXPOSES: true,
      PROVIDED_BY: true,
      USED_BY: true,
      USES: true,
      DEPLOYED_ON: true,
      IMPACTS: true,
    });
  }, []);

  const impactSelectionRef = React.useRef<ImpactSelectionDetail | null>(null);

  const applyImpactHighlight = React.useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      cy.elements().removeClass('impact-involved impact-faded');

      const detail = impactSelectionRef.current;
      if (!detail || detail.kind !== 'path') return;

      const elementIds = Array.from(new Set((detail.orderedElementIds ?? []).map(normalizeId).filter(Boolean)));
      const relationshipIds = Array.from(
        new Set((detail.orderedRelationshipIds ?? []).map(normalizeId).filter(Boolean)),
      );

      // Only apply fading if this diagram contains at least one involved node/edge.
      const hasAny =
        elementIds.some((id) => cy.$id(id).nonempty()) || relationshipIds.some((id) => cy.$id(id).nonempty());
      if (!hasAny) return;

      cy.elements().addClass('impact-faded');

      for (const id of elementIds) {
        cy.$id(id).removeClass('impact-faded').addClass('impact-involved');
      }
      for (const id of relationshipIds) {
        cy.$id(id).removeClass('impact-faded').addClass('impact-involved');
      }
    });
  }, []);

  const applyFilters = React.useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const elementType = node.data('elementType');
        const layer = node.data('layer');
        const lifecycleState = node.data('lifecycleState');
        const typeVisible = typeFilters[elementType] !== false;
        const layerVisible = layerFilters[layer] !== false;
        const lifecycleVisible = lifecycleFilter === 'Both' || lifecycleState === lifecycleFilter;
        const shouldShow = typeVisible && layerVisible && lifecycleVisible;
        node.style('display', shouldShow ? 'element' : 'none');
      });

      cy.edges().forEach((edge) => {
        const srcVisible = edge.source().style('display') !== 'none';
        const tgtVisible = edge.target().style('display') !== 'none';
        const relType = edge.data('relationshipType');
        const typeVisible = relationshipFilters[relType] !== false;
        const shouldShowEdge = srcVisible && tgtVisible && typeVisible;
        edge.style('display', shouldShowEdge ? 'element' : 'none');
      });
    });
  }, [layerFilters, lifecycleFilter, relationshipFilters, typeFilters]);

  const view: ViewDefinition | null = React.useMemo(() => {
    try {
      return getViewRepository().getViewById(viewId);
    } catch {
      return null;
    }
  }, [viewId, refreshToken]);

  React.useEffect(() => {
    const onChanged = () => setRefreshToken((x) => x + 1);
    window.addEventListener('ea:repositoryChanged', onChanged);
    window.addEventListener('ea:relationshipsChanged', onChanged);
    window.addEventListener('ea:viewsChanged', onChanged);

    const onImpactSelection = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail as ImpactSelectionDetail | undefined;
      if (!detail) return;
      impactSelectionRef.current = detail;
      applyImpactHighlight();
    };
    window.addEventListener('ea:impactSelectionChanged', onImpactSelection);

    return () => {
      window.removeEventListener('ea:repositoryChanged', onChanged);
      window.removeEventListener('ea:relationshipsChanged', onChanged);
      window.removeEventListener('ea:viewsChanged', onChanged);
      window.removeEventListener('ea:impactSelectionChanged', onImpactSelection);
    };
  }, [applyImpactHighlight]);

  const [resolved, setResolved] = React.useState<ResolvedViewData | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setResolved(null);
    if (!view) return () => {
      cancelled = true;
    };

    (async () => {
      try {
        const next = await viewResolver.resolve(view);
        if (!cancelled) setResolved(next);
      } catch {
        if (!cancelled)
          setResolved({
            viewId: view.id,
            elementIds: [],
            elements: [],
            relationships: [],
            stats: {
              eligibleElements: 0,
              eligibleRelationships: 0,
              selectedElements: 0,
              selectedRelationships: 0,
            },
          });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [view]);

  const graph = React.useMemo(() => {
    if (!view || !resolved) return null;
    const layoutHint = layoutHintForView(view);
    return graphRenderingAdapter.toCytoscape({
      elements: resolved.elements,
      relationships: resolved.relationships,
      layoutType: layoutHint.layoutType,
      orientation: layoutHint.orientation,
    });
  }, [view, resolved]);

  const viewpointInfo = React.useMemo(() => {
    if (!view) return null;
    const vpId = (view as any)?.viewpointId as string | undefined;
    if (!vpId) return null;
    const vp = ViewpointRegistry.get(vpId);
    if (!vp) return null;
    return { id: vp.id, name: vp.name, description: vp.description };
  }, [view]);

  const noElementsForViewpoint = Boolean(resolved && resolved.elements.length === 0);

  const governance = React.useMemo(() => {
    if (!view) return null;
    return evaluateViewGovernance(view, { resolvedElements: resolved?.elements ?? [] });
  }, [view, resolved]);

  const preventExternalDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    // Center canvas is read-only; block drag/drop to avoid unintended creation flows.
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const preventKeyboardCreation = React.useCallback((event: KeyboardEvent) => {
    // Block common creation shortcuts while a view has focus (e.g., Delete, Ctrl+N, Insert).
    const key = event.key?.toLowerCase();
    const isCreateCombo = event.ctrlKey && (key === 'n' || key === 'insert');
    const isDelete = key === 'delete' || key === 'backspace';
    if (isCreateCombo || isDelete || key === 'insert') {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  const timeHorizon = metadata?.timeHorizon;
  const horizonWindow = React.useMemo(() => getTimeHorizonWindow(timeHorizon), [timeHorizon]);

  const handleResetLayout = React.useCallback(() => {
    const cy = cyRef.current;
    if (!cy || !viewId) return;
    clearLayoutPositions(viewId);
    try {
      const neutralLayout = { name: 'grid', fit: true, avoidOverlap: true, spacingFactor: 1.4 } as const;
      cy.nodes().lock();
      cy.edges().ungrabify();
      cy.layout(neutralLayout).run();
      cy.fit(undefined, 12);
    } catch {
      // Best-effort only.
    }
  }, [viewId]);

  React.useEffect(() => {
    if (!containerRef.current) return undefined;
    if (!view || !graph) return undefined;

    // Initialize once per tab instance.
    if (!cyRef.current) {
        const neutralLayout = { name: 'grid', fit: true, avoidOverlap: true, spacingFactor: 1.4 } as const;

      cyRef.current = cytoscape({
        container: containerRef.current,
        elements: graph.elements,
        layout: neutralLayout,
        // READ-ONLY: Navigation only; disable all editing/creation gestures.
        autoungrabify: true,        // Disallow drag/move (no layout edits)
        autounselectify: false,     // Allow selection for inspection/highlight
        userPanningEnabled: true,   // Allow panning (navigation)
        userZoomingEnabled: true,   // Allow zooming (navigation)
        boxSelectionEnabled: false, // No box selection/region edits
        selectionType: 'single',    // Single selection only
        selectable: true,
        autolock: true,             // Lock nodes to prevent move/resize/connect
        grabify: false,
        // NOTE: Element creation is NOT supported on canvas. No draw/connect tools are enabled.
        style: [
          {
            selector: 'node',
            style: {
              label: 'data(label)',
              'text-valign': 'center',
              'text-halign': 'center',
              'background-color': '#f5f5f5',
              color: '#000000',
              'border-color': '#d9d9d9',
              'border-width': 1,
              'font-size': 12,
              'font-weight': 500,
              width: 120,
              height: 56,
              shape: 'round-rectangle',
            },
          },
          {
            selector: 'node.impact-faded',
            style: {
              opacity: 0.15,
              'text-opacity': 0.15,
            },
          },
          {
            selector: 'edge.impact-faded',
            style: {
              opacity: 0.1,
            },
          },
          {
            selector: 'node.impact-involved',
            style: {
              'border-width': 3,
              'border-color': '#faad14',
              'background-color': '#fa8c16',
            },
          },
          {
            selector: 'edge.impact-involved',
            style: {
              width: 3,
              'line-color': '#faad14',
              'target-arrow-color': '#faad14',
            },
          },
          {
            selector: 'edge',
            style: {
              width: 2,
              'line-color': '#bfbfbf',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
            },
          },
        ],
      });

      try {
        cyRef.current.layout(neutralLayout).run();
        // Allow presentation-only node repositioning (persisted per view)
        cyRef.current.nodes().unlock();
        cyRef.current.edges().ungrabify();
        const savedPositions = loadLayoutPositions(viewId);
        if (savedPositions && Object.keys(savedPositions).length > 0) {
          cyRef.current.batch(() => {
            cyRef.current?.nodes().positions((node) => savedPositions[node.id()] ?? node.position());
          });
        }
      } catch {
        // Best-effort only.
      }

      const onNodeDragFree = () => {
        cyRef.current?.nodes().forEach((n) => {
          const pos = n.position();
          n.position({ x: snapToGrid(pos.x), y: snapToGrid(pos.y) });
        });
        if (!layoutToastShownRef.current) {
          message.info('Layout changes affect this view only.', 2.5);
          layoutToastShownRef.current = true;
        }
        if (viewId) persistLayoutPositions(viewId, cyRef.current!);
      };
      cyRef.current.on('dragfree', 'node', onNodeDragFree);

      // Single-click on node → open Properties panel (primary work surface)
      cyRef.current.on('tap', 'node', (event) => {
        const nodeId = event.target.id();
        if (!nodeId) return;
        const obj = eaRepository?.objects.get(nodeId);
        if (!obj) return;
        const name = typeof obj.attributes?.name === 'string' && obj.attributes.name.trim()
          ? String(obj.attributes.name)
          : obj.id;
        openWorkspaceTab({ type: 'object', objectId: obj.id, objectType: obj.type, name });
      });

      const containerEl = containerRef.current;
      const onKeyDown = (event: KeyboardEvent) => {
        preventKeyboardCreation(event);
      };
      containerEl?.addEventListener('keydown', onKeyDown);

      // If an impact selection existed before this tab mounted, apply it now.
      applyImpactHighlight();

      return () => {
        try {
          cyRef.current?.off('dragfree', 'node', onNodeDragFree);
          cyRef.current?.off('tap', 'node');
          cyRef.current?.destroy();
        } catch {
          // Best-effort only.
        } finally {
          cyRef.current = null;
        }
        containerEl?.removeEventListener('keydown', onKeyDown);
      };
    }

    // Refresh existing instance (data selection may have changed).
    const cy = cyRef.current;
    cy.batch(() => {
      cy.elements().remove();
      cy.add(graph.elements);
    });
    try {
      const neutralLayout = { name: 'grid', fit: true, avoidOverlap: true, spacingFactor: 1.4 } as const;
      cy.layout(neutralLayout).run();
      cy.nodes().unlock();
      cy.edges().ungrabify();
      const savedPositions = loadLayoutPositions(viewId);
      if (savedPositions && Object.keys(savedPositions).length > 0) {
        cy.batch(() => {
          cy.nodes().positions((node) => savedPositions[node.id()] ?? node.position());
        });
      }
    } catch {
      // Best-effort only.
    }

    // Re-apply any active impact highlighting after graph refresh.
    applyImpactHighlight();
    applyFilters();

    return undefined;
  }, [view, graph, eaRepository, openWorkspaceTab, preventKeyboardCreation, applyFilters]);

  React.useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  if (!view) {
    return (
      <ProCard>
        <Alert
          type="warning"
          message="View not available"
          description="No active project selected, or the view id was not found in the ViewRepository."
          showIcon
        />
      </ProCard>
    );
  }

  return (
    <ProCard>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {view.name}
      </Typography.Title>
      <Alert
        type="info"
        showIcon
        message="Diagrams are secondary"
        description={
          <div>
            <div>Repository is the source of truth; Properties is the primary work surface.</div>
            <div>Auto-generated from repository with auto-layout; no free-form drawing or canvas-only creation.</div>
            <div>Adding elements means selecting existing repository items only; deleting a diagram never deletes elements.</div>
            <div>Relationships are created in Properties only. No lines, auto-connects, or canvas wiring here.</div>
            <div>Validation over visuals: governance rules still apply even if the diagram looks fine.</div>
          </div>
        }
        style={{ marginBottom: 12 }}
      />
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        Read-only diagram lens (pan/zoom). Node move/resize is disabled; open Properties to edit truth.
      </Typography.Paragraph>

      {noElementsForViewpoint ? (
        <Alert
          type="info"
          showIcon
          message="No elements match this viewpoint."
          description="The selected viewpoint filters out all elements in the repository."
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <div style={{ marginBottom: 12 }}>
        <ArchitectureReviewPanel subjectKind="View" subjectId={view.id} defaultReviewer={view.createdBy} />
      </div>

      <Collapse
        bordered
        defaultActiveKey={['filters']}
        items={[
          {
            key: 'filters',
            label: 'Filters (visual-only)',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  Filters adjust what is shown on this diagram only. They do not change repository data, layout
                  definitions, or relationships.
                </Typography.Paragraph>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button size="small" onClick={resetFilters}>
                    Reset Filters
                  </Button>
                </div>
                <Typography.Text strong>Element types</Typography.Text>
                <Space direction="vertical" size={6}>
                  <Checkbox
                    checked={typeFilters.Capability}
                    onChange={(e) => setTypeFilters((prev) => ({ ...prev, Capability: e.target.checked }))}
                  >
                    Capability
                  </Checkbox>
                  <Checkbox
                    checked={typeFilters.BusinessService}
                    onChange={(e) => setTypeFilters((prev) => ({ ...prev, BusinessService: e.target.checked }))}
                  >
                    Business Service
                  </Checkbox>
                  <Checkbox
                    checked={typeFilters.Application}
                    onChange={(e) => setTypeFilters((prev) => ({ ...prev, Application: e.target.checked }))}
                  >
                    Application
                  </Checkbox>
                  <Checkbox
                    checked={typeFilters.Technology}
                    onChange={(e) => setTypeFilters((prev) => ({ ...prev, Technology: e.target.checked }))}
                  >
                    Technology
                  </Checkbox>
                </Space>
                <Typography.Text strong>Architecture layers</Typography.Text>
                <Space direction="vertical" size={6}>
                  <Checkbox
                    checked={layerFilters.Business}
                    onChange={(e) => setLayerFilters((prev) => ({ ...prev, Business: e.target.checked }))}
                  >
                    Business
                  </Checkbox>
                  <Checkbox
                    checked={layerFilters.Application}
                    onChange={(e) => setLayerFilters((prev) => ({ ...prev, Application: e.target.checked }))}
                  >
                    Application
                  </Checkbox>
                  <Checkbox
                    checked={layerFilters.Technology}
                    onChange={(e) => setLayerFilters((prev) => ({ ...prev, Technology: e.target.checked }))}
                  >
                    Technology
                  </Checkbox>
                </Space>
                <Typography.Text strong>Lifecycle state</Typography.Text>
                <Radio.Group
                  value={lifecycleFilter}
                  onChange={(e) => setLifecycleFilter(e.target.value)}
                  optionType="button"
                  buttonStyle="solid"
                  size="small"
                >
                  <Radio.Button value="Both">Show Both</Radio.Button>
                  <Radio.Button value="As-Is">Show As-Is</Radio.Button>
                  <Radio.Button value="To-Be">Show To-Be</Radio.Button>
                </Radio.Group>
                <Typography.Text strong>Relationships</Typography.Text>
                <Space direction="vertical" size={6}>
                  <Checkbox
                    checked={relationshipFilters.SUPPORTED_BY}
                    onChange={(e) => setRelationshipFilters((prev) => ({ ...prev, SUPPORTED_BY: e.target.checked }))}
                  >
                    SUPPORTED_BY
                  </Checkbox>
                  <Checkbox
                    checked={relationshipFilters.REALIZED_BY}
                    onChange={(e) => setRelationshipFilters((prev) => ({ ...prev, REALIZED_BY: e.target.checked }))}
                  >
                    REALIZED_BY
                  </Checkbox>
                  <Checkbox
                    checked={relationshipFilters.REALIZES}
                    onChange={(e) => setRelationshipFilters((prev) => ({ ...prev, REALIZES: e.target.checked }))}
                  >
                    REALIZES
                  </Checkbox>
                  <Checkbox
                    checked={relationshipFilters.TRIGGERS}
                    onChange={(e) => setRelationshipFilters((prev) => ({ ...prev, TRIGGERS: e.target.checked }))}
                  >
                    TRIGGERS
                  </Checkbox>
                  <Checkbox
                    checked={relationshipFilters.SERVED_BY}
                    onChange={(e) => setRelationshipFilters((prev) => ({ ...prev, SERVED_BY: e.target.checked }))}
                  >
                    SERVED_BY
                  </Checkbox>
                  <Checkbox
                    checked={relationshipFilters.EXPOSES}
                    onChange={(e) => setRelationshipFilters((prev) => ({ ...prev, EXPOSES: e.target.checked }))}
                  >
                    EXPOSES
                  </Checkbox>
                  <Checkbox
                    checked={relationshipFilters.PROVIDED_BY}
                    onChange={(e) => setRelationshipFilters((prev) => ({ ...prev, PROVIDED_BY: e.target.checked }))}
                  >
                    PROVIDED_BY
                  </Checkbox>
                  <Checkbox
                    checked={relationshipFilters.USED_BY}
                    onChange={(e) => setRelationshipFilters((prev) => ({ ...prev, USED_BY: e.target.checked }))}
                  >
                    USED_BY
                  </Checkbox>
                  <Checkbox
                    checked={relationshipFilters.USES}
                    onChange={(e) => setRelationshipFilters((prev) => ({ ...prev, USES: e.target.checked }))}
                  >
                    USES
                  </Checkbox>
                  <Checkbox
                    checked={relationshipFilters.DEPLOYED_ON}
                    onChange={(e) => setRelationshipFilters((prev) => ({ ...prev, DEPLOYED_ON: e.target.checked }))}
                  >
                    DEPLOYED_ON
                  </Checkbox>
                  <Checkbox
                    checked={relationshipFilters.IMPACTS}
                    onChange={(e) => setRelationshipFilters((prev) => ({ ...prev, IMPACTS: e.target.checked }))}
                  >
                    IMPACTS
                  </Checkbox>
                </Space>
              </div>
            ),
          },
        ]}
        style={{ marginBottom: 12 }}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 0 }}>
          Diagram
        </Typography.Title>
        <Space size={8}>
          <Tag>
            Time Horizon: {timeHorizon ?? '1–3 years'} (analysis depth cap {horizonWindow.maxAnalysisDepth})
          </Tag>
          <Button size="small" onClick={handleResetLayout}>
            Reset Layout
          </Button>
        </Space>
      </div>

      {governance && governance.findings.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`Governance warnings (${governance.findings.length})`}
          description={
            <div>
              <Typography.Paragraph style={{ marginBottom: 8 }} type="secondary">
                Policy: maxDepth ≤ {ENTERPRISE_VIEW_GOVERNANCE_POLICY.maxDepth}. Warnings do not block usage.
              </Typography.Paragraph>
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {governance.findings.map((f) => (
                  <li key={f.id}>{f.message}</li>
                ))}
              </ul>
            </div>
          }
        />
      ) : null}

      <div style={{ width: '100%', height: 420, border: '1px solid rgba(0,0,0,0.06)', borderRadius: 6 }}>
        <div
          ref={containerRef}
          style={{
            width: '100%',
            height: '100%',
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(0,0,0,0.04) 0, rgba(0,0,0,0.04) 1px, transparent 1px, transparent 12px), repeating-linear-gradient(90deg, rgba(0,0,0,0.04) 0, rgba(0,0,0,0.04) 1px, transparent 1px, transparent 12px)',
          }}
          onDragEnter={preventExternalDrop}
          onDragOver={preventExternalDrop}
          onDrop={preventExternalDrop}
          onContextMenu={(e) => {
            // Read-only diagram: block context menus that imply editing/drawing affordances.
            e.preventDefault();
          }}
        />
      </div>

      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
        Diagrams are disposable lenses. Deleting this diagram does not delete any repository elements or relationships.
      </Typography.Paragraph>

      <Descriptions bordered size="small" column={1}>
        <Descriptions.Item label="View id">{view.id}</Descriptions.Item>
        <Descriptions.Item label="View type">{view.viewType}</Descriptions.Item>
        <Descriptions.Item label="Architecture layer">{view.architectureLayer}</Descriptions.Item>
        <Descriptions.Item label="Root element type">{view.rootElementType ?? '(none)'}</Descriptions.Item>
        <Descriptions.Item label="Root element id">{view.rootElementId ?? '(none)'}</Descriptions.Item>
        <Descriptions.Item label="Max depth">{typeof view.maxDepth === 'number' ? view.maxDepth : '(none)'}</Descriptions.Item>
        <Descriptions.Item label="Allowed element types">
          {(view.allowedElementTypes ?? []).join(', ') || '(none)'}
        </Descriptions.Item>
        <Descriptions.Item label="Allowed relationship types">
          {(view.allowedRelationshipTypes ?? []).join(', ') || '(none)'}
        </Descriptions.Item>
        <Descriptions.Item label="Layout">{`${view.layoutType} / ${view.orientation}`}</Descriptions.Item>
        <Descriptions.Item label="Approval status">{view.approvalStatus}</Descriptions.Item>
        <Descriptions.Item label="Created by">{view.createdBy}</Descriptions.Item>
        <Descriptions.Item label="Created at">{view.createdAt}</Descriptions.Item>
        <Descriptions.Item label="Last modified at">{view.lastModifiedAt}</Descriptions.Item>
      </Descriptions>

      <Typography.Title level={5} style={{ marginTop: 16 }}>
        Raw ViewDefinition
      </Typography.Title>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(view, null, 2)}</pre>
    </ProCard>
  );
};

export default ViewDefinitionTab;
