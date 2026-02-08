import React from 'react';
import { Alert, Button, Card, Divider, Form, InputNumber, Select, Space, Typography } from 'antd';

import type { BaseArchitectureElement } from '../../../backend/repository/BaseArchitectureElement';
import type { BaseArchitectureRelationship } from '../../../backend/repository/BaseArchitectureRelationship';
import { RELATIONSHIP_ENDPOINT_RULES } from '../../../backend/relationships/RelationshipSemantics';

import {
  getRepositoryApplications,
  getRepositoryCapabilities,
  getRepositoryProcesses,
  getRepositoryProgrammes,
  getRepositoryTechnologies,
} from '@/services/ea/repository';
import { getAllRelationships } from '@/services/ea/relationships';
import { createAnalysisResult } from '@/analysis/analysisResultsStore';
import { useIdeShell } from './index';
import { message } from '@/ea/eaConsole';

type ElementOption = {
  id: string;
  name: string;
  elementType: string;
};

const normalizeId = (v: string) => (v ?? '').trim();
const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const relationshipTypeOptions = Object.keys(RELATIONSHIP_ENDPOINT_RULES).sort(compareStrings);

const directionOptions: Array<{ label: string; value: 'Downstream' | 'Upstream' }> = [
  { label: 'Downstream (source → target)', value: 'Downstream' },
  { label: 'Upstream (target → source)', value: 'Upstream' },
];

const buildAdjacency = (rels: BaseArchitectureRelationship[]) => {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const r of rels) {
    const src = normalizeId(r.sourceElementId);
    const tgt = normalizeId(r.targetElementId);
    if (!src || !tgt) continue;

    const out = outgoing.get(src);
    if (out) out.push(tgt);
    else outgoing.set(src, [tgt]);

    const inc = incoming.get(tgt);
    if (inc) inc.push(src);
    else incoming.set(tgt, [src]);
  }

  return { outgoing, incoming };
};

const DependencyAnalysisWorkspaceTab: React.FC = () => {
  const { openWorkspaceTab } = useIdeShell();
  const [form] = Form.useForm();

  const [elements, setElements] = React.useState<ElementOption[]>([]);
  const elementById = React.useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);

  const [loadingElements, setLoadingElements] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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
        .sort(
          (a, b) =>
            compareStrings(a.elementType, b.elementType) ||
            compareStrings(a.name, b.name) ||
            compareStrings(a.id, b.id),
        );

      setElements(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load repository elements.');
      setElements([]);
    } finally {
      setLoadingElements(false);
    }
  }, []);

  React.useEffect(() => {
    void loadElements();

    form.setFieldsValue({
      direction: 'Downstream',
      maxDepth: 3,
      includedRelationshipTypes: relationshipTypeOptions,
    });
  }, [form, loadElements]);

  const runAnalysis = React.useCallback(async () => {
    setRunning(true);
    setError(null);

    try {
      const values = await form.validateFields();
      const rootElementId = normalizeId(values.rootElementId);
      const direction = values.direction as 'Downstream' | 'Upstream';
      const maxDepth = Number(values.maxDepth);
      const includedRelationshipTypes = (values.includedRelationshipTypes as string[]).slice().sort(compareStrings);

      const root = elementById.get(rootElementId);
      const rootLabel = root?.name ? root.name : rootElementId;

      const relResp = await getAllRelationships();
      if (!relResp?.success) throw new Error(relResp?.errorMessage || 'Failed to load relationships.');

      const filteredRels = (relResp.data ?? []).filter((r) => includedRelationshipTypes.includes(r.relationshipType));
      const { outgoing, incoming } = buildAdjacency(filteredRels);
      const neighbors = direction === 'Downstream' ? outgoing : incoming;

      const visited = new Set<string>();
      visited.add(rootElementId);

      let edgesConsidered = 0;
      const queue: Array<{ id: string; depth: number }> = [{ id: rootElementId, depth: 0 }];

      while (queue.length > 0) {
        const cur = queue.shift();
        if (!cur) break;
        if (cur.depth >= maxDepth) continue;

        const nexts = neighbors.get(cur.id) ?? [];
        edgesConsidered += nexts.length;

        for (const n of nexts) {
          if (visited.has(n)) continue;
          visited.add(n);
          queue.push({ id: n, depth: cur.depth + 1 });
        }
      }

      // Degree within the reachable subgraph.
      const outCounts = new Map<string, number>();
      const inCounts = new Map<string, number>();

      for (const r of filteredRels) {
        const src = normalizeId(r.sourceElementId);
        const tgt = normalizeId(r.targetElementId);
        if (!visited.has(src) || !visited.has(tgt)) continue;
        outCounts.set(src, (outCounts.get(src) ?? 0) + 1);
        inCounts.set(tgt, (inCounts.get(tgt) ?? 0) + 1);
      }

      const toTop = (m: Map<string, number>) =>
        [...m.entries()]
          .sort((a, b) => (b[1] - a[1] ? b[1] - a[1] : compareStrings(a[0], b[0])))
          .slice(0, 10)
          .map(([elementId, count]) => ({ elementId, count }));

      const result = createAnalysisResult({
        kind: 'dependency',
        title: `Dependency: ${rootLabel}`,
        data: {
          rootElementId,
          direction,
          maxDepth,
          reachableCount: Math.max(0, visited.size - 1),
          edgesConsidered,
          topOutgoing: toTop(outCounts),
          topIncoming: toTop(inCounts),
          elementIndex: elements,
        },
      });

      message.success('Dependency analysis completed. Opening result tab…');
      openWorkspaceTab({ type: 'analysisResult', resultId: result.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dependency analysis failed.');
    } finally {
      setRunning(false);
    }
  }, [elementById, elements, form, openWorkspaceTab]);

  return (
    <div style={{ padding: 12 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Dependency Analysis
      </Typography.Title>

      <Alert
        type="info"
        showIcon
        message="Analysis workspace (no visualization coupling)"
        description="Computed from repository elements + relationships. Results open in separate read-only tabs."
      />

      <Divider style={{ margin: '12px 0' }} />

      <Card
        size="small"
        title="Configuration"
        extra={
          <Button onClick={loadElements} loading={loadingElements}>
            Reload elements
          </Button>
        }
      >
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
                  value: e.id,
                  label: `${e.name} (${e.elementType})`,
                }))}
              />
            </Form.Item>

            <Form.Item label="Direction" name="direction" rules={[{ required: true }]} style={{ minWidth: 240 }}>
              <Select options={directionOptions} />
            </Form.Item>

            <Form.Item label="Max depth" name="maxDepth" rules={[{ required: true }]} style={{ width: 140 }}>
              <InputNumber min={1} max={25} />
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

          {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}

          <Button type="primary" onClick={() => void runAnalysis()} loading={running} disabled={loadingElements}>
            Run analysis
          </Button>
        </Form>
      </Card>
    </div>
  );
};

export default DependencyAnalysisWorkspaceTab;
