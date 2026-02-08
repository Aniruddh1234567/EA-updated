import React from 'react';
import { Alert, Button, Card, Collapse, Empty, Form, InputNumber, Select, Space, Tag, Typography } from 'antd';
import { CompressOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons';
import cytoscape, { type Core } from 'cytoscape';
import { analyzeImpactLocally } from '@/analysis/localImpactAnalysis';
import type { ImpactAnalysisRequest } from '../../../backend/analysis/ImpactAnalysisRequest';
import type { ImpactRankedElement } from '../../../backend/analysis/ImpactRanking';
import type { ImpactSummary } from '../../../backend/analysis/ImpactSummary';
import { RELATIONSHIP_TYPE_DEFINITIONS, type ObjectType, type RelationshipType } from '@/pages/dependency-view/utils/eaMetaModel';
import { useEaRepository } from '@/ea/EaRepositoryContext';
import { useIdeSelection } from '@/ide/IdeSelectionContext';
import { useIdeShell } from './index';
import { getTimeHorizonWindow } from '@/repository/timeHorizonPolicy';
import { message } from '@/ea/eaConsole';

type ResultState = { summary: ImpactSummary; ranked: ImpactRankedElement[] } | null;
type TreeNode = { id: string; name: string; type: ObjectType | 'Unknown'; children: TreeNode[]; revisit?: boolean };
type Direction = 'Upstream' | 'Downstream';

type GraphData = {
  rootId: string;
  maxDepth: number;
  nodes: Array<{
    id: string;
    name: string;
    type: ObjectType | 'Unknown';
    direction: Direction | 'Root';
    depth: number;
    color: string;
  }>;
  edges: Array<{
    id: string;
    from: string;
    to: string;
    type: RelationshipType;
    direction: Direction;
    color: string;
  }>;
};

const ImpactAnalysisTab: React.FC = () => {
  const { eaRepository, metadata } = useEaRepository();
  const { selection } = useIdeSelection();
  const { openPropertiesPanel } = useIdeShell();
  const [form] = Form.useForm();

  const [upstream, setUpstream] = React.useState<ResultState>(null);
  const [downstream, setDownstream] = React.useState<ResultState>(null);
  const [running, setRunning] = React.useState(false);
  const [downstreamTree, setDownstreamTree] = React.useState<TreeNode | null>(null);
  const [upstreamTree, setUpstreamTree] = React.useState<TreeNode | null>(null);
  const [graphData, setGraphData] = React.useState<GraphData | null>(null);

  const cyContainerRef = React.useRef<HTMLDivElement | null>(null);
  const cyRef = React.useRef<Core | null>(null);

  const elements = React.useMemo(() => {
    if (!eaRepository) return [] as Array<{ id: string; name: string; type: string }>;
    return Array.from(eaRepository.objects.values())
      .filter((o) => (o.attributes as any)?._deleted !== true)
      .map((o) => {
        const n = typeof o.attributes?.name === 'string' && o.attributes.name.trim() ? String(o.attributes.name) : o.id;
        return { id: o.id, name: n, type: o.type };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [eaRepository]);

  const defaultRoot = React.useMemo(() => {
    if (selection.selectedSource === 'ImpactAnalysis' && selection.selectedElementId) return selection.selectedElementId;
    if (selection.selectedElementId) return selection.selectedElementId;
    return elements[0]?.id ?? '';
  }, [elements, selection.selectedElementId, selection.selectedSource]);

  React.useEffect(() => {
    const depthCap = getTimeHorizonWindow(metadata?.timeHorizon).maxAnalysisDepth;
    form.setFieldsValue({ root: defaultRoot || undefined, maxDepth: depthCap });
  }, [defaultRoot, form, metadata?.timeHorizon]);

  const relationshipTypes = React.useMemo(() => Object.keys(RELATIONSHIP_TYPE_DEFINITIONS), []);

  const run = React.useCallback(
    (direction: 'Upstream' | 'Downstream', rootId: string, maxDepth: number) => {
      if (!eaRepository) return null;
      const request: ImpactAnalysisRequest = {
        requestId: `local-${direction}-${rootId}-${maxDepth}`,
        projectId: '',
        requestedBy: 'analysis-tab',
        requestedAt: new Date().toISOString(),
        repositoryName: metadata?.repositoryName,
        rootElementId: rootId,
        rootElementType: eaRepository.objects.get(rootId)?.type ?? 'Unknown',
        direction,
        maxDepth,
        includedElementTypes: [],
        includedRelationshipTypes: relationshipTypes,
        analysisIntent: 'Change',
      };

      return analyzeImpactLocally({ repository: eaRepository, request });
    },
    [eaRepository, metadata?.repositoryName, relationshipTypes],
  );

  const buildTree = React.useCallback(
    (direction: Direction, rootId: string, maxDepth: number, res: ResultState): TreeNode | null => {
      if (!eaRepository) return null;
      if (!res) return null;

      const reachableIds = new Set<string>([rootId, ...(res.ranked ?? []).map((r) => r.elementId)]);
      if (reachableIds.size === 0) return null;

      const outgoing = new Map<string, string[]>();
      const incoming = new Map<string, string[]>();

      const relationshipAllowedByMetamodel = (
        relType: RelationshipType,
        fromType: ObjectType | undefined,
        toType: ObjectType | undefined,
      ) => {
        if (!fromType || !toType) return false;
        const def = RELATIONSHIP_TYPE_DEFINITIONS[relType];
        if (!def) return false;
        if (Array.isArray(def.allowedEndpointPairs) && def.allowedEndpointPairs.length > 0) {
          return def.allowedEndpointPairs.some((p) => p.from === fromType && p.to === toType);
        }
        return def.fromTypes.includes(fromType) && def.toTypes.includes(toType);
      };

      for (const r of eaRepository.relationships ?? []) {
        const relType = String((r as any)?.type ?? '').trim() as RelationshipType;
        if (!relType) continue;
        if (!relationshipTypes.includes(relType)) continue;

        const fromId = String((r as any)?.fromId ?? '').trim();
        const toId = String((r as any)?.toId ?? '').trim();
        if (!fromId || !toId) continue;

        if (!reachableIds.has(fromId) && !reachableIds.has(toId)) continue;

        const fromObj = eaRepository.objects.get(fromId);
        const toObj = eaRepository.objects.get(toId);
        if (!relationshipAllowedByMetamodel(relType, fromObj?.type, toObj?.type)) continue;

        if (reachableIds.has(fromId)) {
          if (!outgoing.has(fromId)) outgoing.set(fromId, []);
          outgoing.get(fromId)!.push(toId);
        }

        if (reachableIds.has(toId)) {
          if (!incoming.has(toId)) incoming.set(toId, []);
          incoming.get(toId)!.push(fromId);
        }
      }

      const visited = new Set<string>();

      const makeNode = (nodeId: string, depth: number, revisit = false): TreeNode => {
        const obj = eaRepository.objects.get(nodeId);
        const name =
          typeof obj?.attributes?.name === 'string' && obj.attributes.name.trim() ? String(obj.attributes.name) : nodeId;
        const type = (obj?.type as ObjectType | undefined) ?? 'Unknown';

        if (revisit || depth >= maxDepth) {
          return { id: nodeId, name, type, children: [], revisit };
        }

        const neighborIds = direction === 'Upstream'
          ? incoming.get(nodeId) ?? []
          : outgoing.get(nodeId) ?? [];

        const children: TreeNode[] = [];
        for (const nId of neighborIds) {
          if (!nId) continue;
          if (!reachableIds.has(nId)) continue;
          if (visited.has(nId)) {
            children.push(makeNode(nId, depth + 1, true));
            continue;
          }
          visited.add(nId);
          children.push(makeNode(nId, depth + 1));
        }

        return { id: nodeId, name, type, children };
      };

      const trimmedRoot = String(rootId ?? '').trim();
      if (!trimmedRoot) return null;
      visited.add(trimmedRoot);
      return makeNode(trimmedRoot, 0);
    },
    [eaRepository, relationshipTypes],
  );

  const computeDepthsAndEdges = React.useCallback(
    (
      direction: Direction,
      rootId: string,
      maxDepth: number,
      reachableIds: Set<string>,
    ): { depths: Map<string, number>; edges: Array<{ from: string; to: string; rel: RelationshipType }> } => {
      const depths = new Map<string, number>();
      const edges: Array<{ from: string; to: string; rel: RelationshipType }> = [];
      if (!eaRepository) return { depths, edges };

      depths.set(rootId, 0);
      const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];

      const relationshipAllowedByMetamodel = (
        relType: RelationshipType,
        fromType: ObjectType | undefined,
        toType: ObjectType | undefined,
      ) => {
        const def = RELATIONSHIP_TYPE_DEFINITIONS[relType];
        if (!def) return false;
        if (Array.isArray(def.allowedEndpointPairs) && def.allowedEndpointPairs.length > 0) {
          return def.allowedEndpointPairs.some((p) => p.from === fromType && p.to === toType);
        }
        return (!!fromType && !!toType && def.fromTypes.includes(fromType) && def.toTypes.includes(toType));
      };

      while (queue.length > 0) {
        const { id, depth } = queue.shift()!;
        if (depth >= maxDepth) continue;

        for (const rel of eaRepository.relationships ?? []) {
          const relType = String((rel as any)?.type ?? '').trim() as RelationshipType;
          if (!relType) continue;
          if (!relationshipTypes.includes(relType)) continue;

          const fromId = String((rel as any)?.fromId ?? '').trim();
          const toId = String((rel as any)?.toId ?? '').trim();
          if (!fromId || !toId) continue;

          const fromObj = eaRepository.objects.get(fromId);
          const toObj = eaRepository.objects.get(toId);
          if (!relationshipAllowedByMetamodel(relType, fromObj?.type, toObj?.type)) continue;

          let neighbor: string | null = null;
          if (direction === 'Downstream' && fromId === id) neighbor = toId;
          if (direction === 'Upstream' && toId === id) neighbor = fromId;
          if (!neighbor) continue;
          if (!reachableIds.has(neighbor)) continue;

          edges.push({ from: fromId, to: toId, rel: relType });

          if (!depths.has(neighbor)) {
            depths.set(neighbor, depth + 1);
            queue.push({ id: neighbor, depth: depth + 1 });
          }
        }
      }

      return { depths, edges };
    },
    [eaRepository, relationshipTypes],
  );

  const execute = React.useCallback(async () => {
    if (!eaRepository) {
      message.warning('Load a repository first.');
      return;
    }
    try {
      setRunning(true);
      const values = await form.validateFields();
      const root = String(values.root ?? '').trim();
      const maxDepth = Number(values.maxDepth) || 6;
      if (!root) {
        message.warning('Select a root element.');
        return;
      }

      const downstreamResult = run('Downstream', root, maxDepth);
      const upstreamResult = run('Upstream', root, maxDepth);

      const downstreamState = downstreamResult
        ? { summary: downstreamResult.impactSummary, ranked: downstreamResult.rankedImpacts }
        : null;
      const upstreamState = upstreamResult ? { summary: upstreamResult.impactSummary, ranked: upstreamResult.rankedImpacts } : null;

      setDownstream(downstreamState);
      setUpstream(upstreamState);

      setDownstreamTree(buildTree('Downstream', root, maxDepth, downstreamState));
      setUpstreamTree(buildTree('Upstream', root, maxDepth, upstreamState));

      // Build graph data for visualization (read-only).
      const reachable = new Set<string>([root]);
      (downstreamState?.ranked ?? []).forEach((r) => reachable.add(r.elementId));
      (upstreamState?.ranked ?? []).forEach((r) => reachable.add(r.elementId));

      const downstreamGraph = computeDepthsAndEdges('Downstream', root, maxDepth, reachable);
      const upstreamGraph = computeDepthsAndEdges('Upstream', root, maxDepth, reachable);

      const nodeMap = new Map<string, GraphData['nodes'][number]>();

      const addNode = (id: string, direction: GraphData['nodes'][number]['direction'], depth: number) => {
        const obj = eaRepository?.objects.get(id);
        const name = typeof obj?.attributes?.name === 'string' && obj.attributes.name.trim() ? String(obj.attributes.name) : id;
        const type = (obj?.type as ObjectType | undefined) ?? 'Unknown';
        const existing = nodeMap.get(id);
        const color = direction === 'Root' ? '#fa8c16' : direction === 'Downstream' ? '#4b9bff' : '#722ed1';
        if (!existing || depth < existing.depth) {
          nodeMap.set(id, { id, name, type, direction, depth, color });
        } else if (existing && direction === 'Root') {
          nodeMap.set(id, { ...existing, direction });
        }
      };

      addNode(root, 'Root', 0);
      downstreamGraph.depths.forEach((d, id) => addNode(id, 'Downstream', d));
      upstreamGraph.depths.forEach((d, id) => addNode(id, 'Upstream', d));

      const edgeColor = (direction: Direction) => (direction === 'Downstream' ? '#4b9bff' : '#722ed1');

      const edges: GraphData['edges'] = [];
      for (const e of downstreamGraph.edges) {
        if (!nodeMap.has(e.from) || !nodeMap.has(e.to)) continue;
        edges.push({ id: `down-${e.from}-${e.to}-${e.rel}`, from: e.from, to: e.to, type: e.rel, direction: 'Downstream', color: edgeColor('Downstream') });
      }
      for (const e of upstreamGraph.edges) {
        if (!nodeMap.has(e.from) || !nodeMap.has(e.to)) continue;
        edges.push({ id: `up-${e.from}-${e.to}-${e.rel}`, from: e.from, to: e.to, type: e.rel, direction: 'Upstream', color: edgeColor('Upstream') });
      }

      setGraphData({
        rootId: root,
        maxDepth,
        nodes: Array.from(nodeMap.values()),
        edges,
      });

      if (!downstreamResult && !upstreamResult) {
        message.info('No relationships available for impact analysis.');
      }
    } finally {
      setRunning(false);
    }
  }, [eaRepository, form, run]);

  const lastAutoRootRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const root = form.getFieldValue('root') as string | undefined;
    const maxDepth = form.getFieldValue('maxDepth') as number | undefined;
    if (!eaRepository || !root || !maxDepth) return;
    if (lastAutoRootRef.current === root) return;
    lastAutoRootRef.current = root;
    void execute();
  }, [defaultRoot, eaRepository, execute, form]);

  const handleFit = React.useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.fit(undefined, 32);
  }, []);

  const handleZoom = React.useCallback((direction: 'in' | 'out') => {
    const cy = cyRef.current;
    if (!cy) return;
    const factor = direction === 'in' ? 1.2 : 1 / 1.2;
    const current = cy.zoom();
    cy.zoom({ level: current * factor, renderedPosition: cy.renderedCenter() });
  }, []);

  React.useEffect(() => {
    const container = cyContainerRef.current;
    if (!container || !graphData || graphData.nodes.length === 0) {
      cyRef.current?.destroy();
      cyRef.current = null;
      return undefined;
    }

    const nodes = graphData.nodes.map((n) => ({
      data: {
        id: n.id,
        label: `${n.name} (${n.type})`,
        elementType: n.type,
        color: n.color,
        depth: n.depth,
        direction: n.direction,
      },
    }));

    const edges = graphData.edges.map((e) => ({
      data: {
        id: e.id,
        source: e.from,
        target: e.to,
        relationshipType: e.type,
        color: e.color,
        direction: e.direction,
      },
    }));

    cyRef.current?.destroy();
    cyRef.current = cytoscape({
      container,
      elements: { nodes, edges },
      layout: { name: 'breadthfirst', directed: true, padding: 10 },
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            color: '#fff',
            'font-size': 10,
            'text-wrap': 'wrap',
            'text-max-width': '160px',
            'border-width': 2,
            'border-color': '#162447',
            width: (ele: any) => (ele.data('depth') === 0 ? 36 : 28),
            height: (ele: any) => (ele.data('depth') === 0 ? 36 : 28),
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
          selector: '[depth > 0]',
          style: {
            'border-color': '#52c41a',
          },
        },
      ],
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      autounselectify: true,
      autoungrabify: true,
    });

    cyRef.current.ready(() => {
      cyRef.current?.fit(undefined, 32);
    });

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
      const type = node.data('elementType');
      openPropertiesPanel({ elementId: id, elementType: type, dock: 'right', readOnly: true });
    });

    return () => {
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [graphData, openPropertiesPanel]);

  const renderList = (res: ResultState, title: string) => {
    if (!res) return <Empty description={`No ${title.toLowerCase()} yet`} />;
    if (res.ranked.length === 0) {
      return <Empty description={`No ${title.toLowerCase()} found`} />;
    }

    return null;
  };

  const renderTree = (node: TreeNode | null) => {
    if (!node || node.children.length === 0) return <Empty description="No impacts found for this element." />;

    const renderNode = (n: TreeNode): React.ReactNode => {
      return (
        <li key={n.id} style={{ margin: '4px 0' }}>
          <div>
            <Typography.Text
              strong
              style={{ cursor: 'pointer' }}
              onClick={() => openPropertiesPanel({ elementId: n.id, elementType: n.type, dock: 'right', readOnly: true })}
            >
              {n.name}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
              {n.type}
              {n.revisit ? ' (already visited)' : ''}
            </Typography.Text>
          </div>
          {n.children.length > 0 ? (
            <ul style={{ marginLeft: 16, paddingLeft: 12, listStyle: 'none' }}>
              {n.children.map((c) => renderNode(c))}
            </ul>
          ) : null}
        </li>
      );
    };

    return <ul style={{ paddingLeft: 0, listStyle: 'none' }}>{renderNode(node)}</ul>;
  };

  if (!eaRepository) {
    return (
      <div style={{ padding: 12 }}>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          Impact Analysis
        </Typography.Title>
        <Alert
          type="warning"
          showIcon
          message="Load a repository"
          description="Impact analysis runs entirely on repository data. Load a repository and select a root element."
        />
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Impact Analysis (read-only)
      </Typography.Title>
      <Alert
        type="info"
        showIcon
        message="What breaks if this changes?"
        description="Runs upstream and downstream impact using repository relationships only. No diagrams, no edits."
        style={{ marginBottom: 12 }}
      />

      <Card size="small" title="Scope" style={{ marginBottom: 12 }}>
        <Form form={form} layout="vertical">
          <Space align="end" wrap size={16}>
            <Form.Item
              label="Root element"
              name="root"
              rules={[{ required: true, message: 'Select a root element' }]}
              style={{ minWidth: 360 }}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Select element"
                options={elements.map((e) => ({ value: e.id, label: `${e.name} · ${e.type} · ${e.id}` }))}
              />
            </Form.Item>
            <Form.Item label="Max depth" name="maxDepth" rules={[{ required: true }]} style={{ width: 140 }}>
              <InputNumber min={1} max={25} />
            </Form.Item>
            <Form.Item label=" " colon={false}>
              <Button type="primary" onClick={() => void execute()} loading={running}>
                Analyze
              </Button>
            </Form.Item>
          </Space>
        </Form>
      </Card>

      <Collapse defaultActiveKey={['downstream']} bordered={false} expandIconPosition="end" style={{ background: 'transparent' }}>
        <Collapse.Panel
          key="downstream"
          header={
            <div>
              <Typography.Title level={5} style={{ margin: 0 }}>
                Downstream Impact
              </Typography.Title>
              <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
                Elements supported by or dependent on the source (outgoing).
              </Typography.Paragraph>
            </div>
          }
        >
          {renderTree(downstreamTree)}
        </Collapse.Panel>

        <Collapse.Panel
          key="upstream"
          header={
            <div>
              <Typography.Title level={5} style={{ margin: 0 }}>
                Upstream Impact
              </Typography.Title>
              <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
                Elements that depend on or influence the source (incoming).
              </Typography.Paragraph>
            </div>
          }
        >
          {renderTree(upstreamTree)}
        </Collapse.Panel>
      </Collapse>

      <Card
        title="Impact graph"
        style={{ marginTop: 16 }}
        extra={
          <Space>
            <Button size="small" icon={<CompressOutlined />} onClick={handleFit} disabled={!graphData}>
              Fit
            </Button>
            <Button size="small" icon={<PlusOutlined />} onClick={() => handleZoom('in')} disabled={!graphData}>
              Zoom in
            </Button>
            <Button size="small" icon={<MinusOutlined />} onClick={() => handleZoom('out')} disabled={!graphData}>
              Zoom out
            </Button>
          </Space>
        }
      >
        {!graphData && <Alert type="info" message="Run analysis to render the impact graph." showIcon />}
        {graphData && graphData.nodes.length === 0 && (
          <Alert type="warning" message="No impacted elements found" description="Adjust depth or relationships and run again." showIcon />
        )}
        {graphData && graphData.nodes.length > 0 && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Paragraph style={{ marginBottom: 8 }}>
              Root <Typography.Text code>{graphData.rootId}</Typography.Text> · Max depth {graphData.maxDepth}
            </Typography.Paragraph>
            <Space wrap>
              <Alert type="info" showIcon message="Legend" description={
                <Space wrap>
                  <Tag color="#fa8c16">Root</Tag>
                  <Tag color="#4b9bff">Downstream</Tag>
                  <Tag color="#722ed1">Upstream</Tag>
                  <Tag color="#52c41a">Impacted (depth &gt; 0)</Tag>
                </Space>
              } />
            </Space>
            <div ref={cyContainerRef} style={{ height: 520, border: '1px solid #f0f0f0', borderRadius: 4 }} aria-label="Impact graph" />
          </Space>
        )}
      </Card>
    </div>
  );
};

export default ImpactAnalysisTab;

/*
 * Legacy coupled implementation (runner + result rendering) is intentionally disabled.
 * Analysis results now open in separate read-only tabs.


  const [loadingExplanation, setLoadingExplanation] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [state, setState] = React.useState<ImpactTabState>({});

  const loadElements = React.useCallback(async () => {
    setLoadingElements(true);
    setError(null);
    try {
      const [caps, procs, apps, tech, progs] = await Promise.all([
        getRepositoryCapabilities(),
        getRepositoryProcesses(),
        getRepositoryApplications(),
        getRepositoryTechnologies(),
        getRepositoryProgrammes(),
      ]);

      const all: BaseArchitectureElement[] = [];
      if (caps?.success) all.push(...(caps.data ?? []));
      if (procs?.success) all.push(...(procs.data ?? []));
      if (apps?.success) all.push(...(apps.data ?? []));
      if (tech?.success) all.push(...(tech.data ?? []));
      if (progs?.success) all.push(...(progs.data ?? []));

      const next = all
        .map((e) => ({ id: normalizeId(e.id), name: e.name || e.id, elementType: e.elementType }))
        .filter((e) => e.id.length > 0)
        .sort((a, b) =>
          compareStrings(a.elementType, b.elementType) || compareStrings(a.name, b.name) || compareStrings(a.id, b.id),
        );

      setElements(next);
    } catch (e: any) {
      setError(e?.message || 'Failed to load repository elements.');
    } finally {
      setLoadingElements(false);
    }
  }, []);

  React.useEffect(() => {
    // Read-only data load is allowed; analysis is never auto-run.
    void loadElements();

    // Visible defaults (not hidden assumptions).
    form.setFieldsValue({
      direction: 'Downstream',
      maxDepth: 6,
      includedRelationshipTypes: relationshipTypeOptions,
      analysisIntent: 'Change',
      requestedBy: 'analyst',
      includePaths: false,
    });
  }, [form, loadElements]);

  const runAnalysis = React.useCallback(async () => {
    setRunning(true);
    setError(null);
    const { openWorkspaceTab } = useIdeShell();
    const { project } = useEaProject();

    // Explicit run should clear any previous cross-diagram highlighting.
    dispatchImpactSelection({ kind: 'clear' });

    try {
      const values = await form.validateFields();

      const rootElementId = normalizeId(values.rootElementId);
      const direction = values.direction as ImpactAnalysisDirection;
      const maxDepth = Number(values.maxDepth);
      const includedRelationshipTypes = (values.includedRelationshipTypes as string[]).slice().sort(compareStrings);
      const analysisIntent = values.analysisIntent as ImpactAnalysisIntent;
      const requestedBy = String(values.requestedBy ?? '').trim();
      const includePaths = Boolean(values.includePaths);

      const root = elementById.get(rootElementId);
      const rootElementType = root?.elementType ?? 'Unknown';

      const requestedAt = new Date().toISOString();
      const basis = `${rootElementId}|${rootElementType}|${direction}|${maxDepth}|${includedRelationshipTypes.join(',')}|${analysisIntent}`;

      const request: ImpactAnalysisRequest = {
        requestId: stableRequestId(basis),
        projectId: '',
        requestedBy,
        requestedAt,

        rootElementId,
        rootElementType,
        direction,
        maxDepth,

        includedElementTypes: [],
        includedRelationshipTypes,

        analysisIntent,
      };

      const resp = await postImpactAnalyze(request, { includePaths });
      if (!resp?.success) {
        throw new Error(resp?.errorMessage || 'Impact analysis failed.');
      }

      const data = resp.data;

      setState({
        request,
        summary: data.impactSummary,
        rankedImpacts: data.rankedImpacts,
        impactPathsCount: data.impactPaths?.length,
        audit: data.audit
          ? {
              auditId: data.audit.auditId,
              requestId: data.audit.requestId,
              ranBy: data.audit.ranBy,
              ranAt: data.audit.ranAt,
              direction: data.audit.parameters.direction,
              maxDepth: data.audit.parameters.maxDepth,
              includedRelationshipTypes: data.audit.parameters.includedRelationshipTypes,
            }
          : undefined,
        selectedElementId: undefined,
        explanationText: undefined,
        representativePathLength: undefined,
        selectionPolicy: undefined,
      });
    } catch (e: any) {
      setError(e?.message || 'Impact analysis failed.');
    } finally {
      setRunning(false);
    }
  }, [elementById, form]);

  const explainSelected = React.useCallback(
    async (elementId: string) => {
      const request = state.request;
      if (!request) return;

      setLoadingExplanation(true);
      setError(null);

      try {
        const resp = await getImpactExplanation({
          rootId: request.rootElementId,
          elementId,
          direction: request.direction,
          maxDepth: request.maxDepth,
          relationshipTypes: request.includedRelationshipTypes,
        });

        if (!resp?.success) {
          const msg = resp?.errorMessage || 'Explanation not found.';
          throw new Error(msg);
        }

        const result = resp.data;
        if (!result.ok) throw new Error(result.error);

        dispatchImpactSelection({
          kind: 'path',
          rootElementId: result.rootElementId,
          impactedElementId: result.impactedElementId,
          orderedElementIds: (result.representativePath.orderedElementIds ?? []).slice(),
          orderedRelationshipIds: (result.representativePath.orderedRelationshipIds ?? []).slice(),
        });

        setState((prev) => ({
          ...prev,
          selectedElementId: elementId,
          explanationText: result.explanationText,
          representativePathLength: result.representativePath.pathLength,
          selectionPolicy: result.selectionPolicy,
        }));
      } catch (e: any) {
        setError(e?.message || 'Failed to retrieve explanation.');
      } finally {
        setLoadingExplanation(false);
      }
    },
    [state.request],
  );

  const columns: ColumnsType<ImpactRankedElement> = [
    {
      title: 'Score',
      width: 90,
      render: (_: unknown, row) => row.score?.computedScore ?? 0,
      sorter: false,
    },
    {
      title: 'Severity',
      width: 110,
      render: (_: unknown, row) => row.score?.severityLabel ?? 'Low',
    },
    {
      title: 'Element',
      render: (_: unknown, row) => {
        const e = elementById.get(row.elementId);
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{e?.name ?? row.elementId}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {e?.elementType ?? 'Unknown'} · {row.elementId}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: 'Paths',
      width: 90,
      render: (_: unknown, row) => row.evidence.totalPathsAffectingElement,
    },
    {
      title: 'Hard',
      width: 80,
      render: (_: unknown, row) => row.evidence.hardPathCount,
    },
    {
      title: 'Soft-only',
      width: 100,
      render: (_: unknown, row) => row.evidence.softOnlyPathCount,
    },
    {
      title: 'Max depth',
      width: 110,
      render: (_: unknown, row) => row.evidence.maxDepthObserved,
    },
  ];

  const summary = state.summary;
  const ranked = state.rankedImpacts ?? [];
  const selectedId = state.selectedElementId;

  return (
    <div style={{ padding: 12 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
          const rootLabel = root?.name ? root.name : rootElementId;
          const result = createAnalysisResult({
            kind: 'impact',
            title: `Impact: ${rootLabel}`,
            data: {
              request,
              summary: data.impactSummary,
              rankedImpacts: data.rankedImpacts,
              impactPathsCount: data.impactPaths?.length,
              audit: data.audit
                ? {
                    auditId: data.audit.auditId,
                    requestId: data.audit.requestId,
                    ranBy: data.audit.ranBy,
                    ranAt: data.audit.ranAt,
                    direction: data.audit.parameters.direction,
                    maxDepth: data.audit.parameters.maxDepth,
                    includedRelationshipTypes: data.audit.parameters.includedRelationshipTypes,
                  }
                : undefined,
              elementIndex: elements,
            },
          });

          message.success('Impact analysis completed. Opening result tab…');
          openWorkspaceTab({ type: 'analysisResult', resultId: result.id });
          description="Element criticality is currently assumed Unknown for all elements (no criticality field exists in the repository model yet)."
          style={{ marginBottom: 12 }}
        />
        <Form form={form} layout="vertical">
          <Space align="start" size={16} wrap>
            <Form.Item
              label="Root element"
              name="rootElementId"
              rules={[{ required: true, message: 'Select a root element' }]}
              style={{ minWidth: 420 }}
            >
              <Select
                showSearch
                placeholder={loadingElements ? 'Loading…' : 'Select root'}
                optionFilterProp="label"
                options={elements.map((e) => ({
            message="Repository-only, explicit analysis"
                  label: `${e.name} (${e.elementType})`,
                }))}
                Analysis only runs when you click <strong>Run analysis</strong>. It reads repository data only and opens results in a separate read-only tab.
            </Form.Item>

            <Form.Item label="Direction" name="direction" rules={[{ required: true }]} style={{ minWidth: 240 }}>
              <Select options={directionOptions} />
            </Form.Item>

            <Form.Item label="Max depth" name="maxDepth" rules={[{ required: true }]} style={{ width: 140 }}>
              <InputNumber min={1} max={25} />
            </Form.Item>

            <Form.Item label="Intent" name="analysisIntent" rules={[{ required: true }]} style={{ minWidth: 200 }}>
              <Select options={intentOptions} />
            </Form.Item>

            <Form.Item label="Requested by" name="requestedBy" rules={[{ required: true }]} style={{ minWidth: 200 }}>
              <Input />
            </Form.Item>
          </Space>

          <Form.Item
            label="Allowed relationship types"
            name="includedRelationshipTypes"
            rules={[{ required: true, message: 'Select at least one relationship type' }]}
          >
            <Select
              mode="multiple"
              placeholder="Select relationship types"
              options={relationshipTypeOptions.map((t) => ({ value: t, label: t }))}
            />
          </Form.Item>

          <Form.Item
            label="Include raw paths (optional)"
            name="includePaths"
            valuePropName="checked"
            tooltip="Gated. When enabled, the API returns raw ImpactPaths which can be large."
          >
            <Switch />
          </Form.Item>

          <Space>
            <Button type="primary" onClick={() => void runAnalysis()} loading={running}>
              Run analysis
            </Button>
            <Typography.Text type="secondary">No auto-run; results update only on explicit run.</Typography.Text>
          </Space>
        </Form>
      </Card>

      {error ? (
        <div style={{ marginTop: 12 }}>
          <Alert type="error" showIcon message={error} />
        </div>
      ) : null}

      <Divider style={{ margin: '12px 0' }} />

      <Card size="small" title="1) Impact Summary">
        {summary ? (
          <Descriptions size="small" column={2}>
            <Descriptions.Item label="Root">{elementById.get(summary.rootElementId)?.name ?? summary.rootElementId}</Descriptions.Item>
            <Descriptions.Item label="Total impacted elements">{summary.totalImpactedElements}</Descriptions.Item>
            <Descriptions.Item label="Severity (H/M/L)">
              {summary.severityBreakdown.High}/{summary.severityBreakdown.Medium}/{summary.severityBreakdown.Low}
            </Descriptions.Item>
            <Descriptions.Item label="Max dependency depth observed">{summary.maxDependencyDepthObserved}</Descriptions.Item>
            <Descriptions.Item label="Analysis timestamp" span={2}>
              {summary.analysisTimestamp}
            </Descriptions.Item>

            {state.audit ? (
              <>
                <Descriptions.Item label="Audit id" span={2}>
                  {state.audit.auditId}
                </Descriptions.Item>
                <Descriptions.Item label="Ran by">{state.audit.ranBy}</Descriptions.Item>
                <Descriptions.Item label="Ran at">{state.audit.ranAt}</Descriptions.Item>
                <Descriptions.Item label="Direction">{state.audit.direction}</Descriptions.Item>
                <Descriptions.Item label="Max depth">{state.audit.maxDepth}</Descriptions.Item>
                <Descriptions.Item label="Relationship types" span={2}>
                  {(state.audit.includedRelationshipTypes ?? []).join(', ') || '(none)'}
                </Descriptions.Item>
              </>
            ) : null}
          </Descriptions>
        ) : (
          <Typography.Text type="secondary">Run an analysis to see the summary.</Typography.Text>
        )}
      </Card>

      {state.audit ? (
        <div style={{ marginTop: 12 }}>
          <ArchitectureReviewPanel
            subjectKind="ImpactAnalysis"
            subjectId={state.audit.auditId}
            defaultReviewer={state.audit.ranBy}
          />
        </div>
      ) : null}

      <Divider style={{ margin: '12px 0' }} />

      <Card size="small" title="2) Ranked Impact List" extra={state.impactPathsCount != null ? <Typography.Text type="secondary">Paths returned: {state.impactPathsCount}</Typography.Text> : null}>
        <Table
          rowKey={(r) => r.elementId}
          size="small"
          columns={columns}
          dataSource={ranked}
          pagination={{ pageSize: 8 }}
          onRow={(record) => ({
            onClick: () => void explainSelected(record.elementId),
          })}
          rowClassName={(record) => (record.elementId === selectedId ? 'ant-table-row-selected' : '')}
        />
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Click an element to fetch a single representative explanation (no path dumping).
        </Typography.Paragraph>
      </Card>

      <Divider style={{ margin: '12px 0' }} />

      <Card size="small" title="3) Selected Impact Explanation" extra={loadingExplanation ? 'Loading…' : null}>
        {selectedId && state.explanationText ? (
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Typography.Text strong>
              {elementById.get(selectedId)?.name ?? selectedId}
            </Typography.Text>
            <Typography.Text type="secondary">
              Policy: {state.selectionPolicy} · Path length: {state.representativePathLength}
            </Typography.Text>
            <Typography.Paragraph style={{ marginBottom: 0 }}>{state.explanationText}</Typography.Paragraph>
          </Space>
        ) : (
          <Typography.Text type="secondary">Select an impacted element to see “why it is impacted”.</Typography.Text>
        )}
      </Card>
    </div>
  );
};

*/
