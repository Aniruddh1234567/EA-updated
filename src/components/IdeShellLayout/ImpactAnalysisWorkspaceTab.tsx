import React from 'react';
import { Alert, Button, Card, Divider, Form, Input, InputNumber, Select, Space, Switch, Typography } from 'antd';

import type { BaseArchitectureElement } from '../../../backend/repository/BaseArchitectureElement';
import type {
  ImpactAnalysisDirection,
  ImpactAnalysisIntent,
  ImpactAnalysisRequest,
} from '../../../backend/analysis/ImpactAnalysisRequest';
import { RELATIONSHIP_ENDPOINT_RULES } from '../../../backend/relationships/RelationshipSemantics';

import {
  getRepositoryApplications,
  getRepositoryCapabilities,
  getRepositoryProcesses,
  getRepositoryProgrammes,
  getRepositoryTechnologies,
} from '@/services/ea/repository';
import { postImpactAnalyze } from '@/services/ea/impact';
import { useIdeShell } from './index';
import { message } from '@/ea/eaConsole';
import { useEaProject } from '@/ea/EaProjectContext';
import { createAnalysisResult } from '@/analysis/analysisResultsStore';
import { useEaRepository } from '@/ea/EaRepositoryContext';
import { getTimeHorizonWindow } from '@/repository/timeHorizonPolicy';

type ElementOption = {
  id: string;
  name: string;
  elementType: string;
};

const normalizeId = (v: string) => (v ?? '').trim();
const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const fnv1aHex = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const stableRequestId = (basis: string) => `req_${fnv1aHex(basis)}`;

const relationshipTypeOptions = Object.keys(RELATIONSHIP_ENDPOINT_RULES).sort(compareStrings);

const directionOptions: Array<{ label: string; value: ImpactAnalysisDirection }> = [
  { label: 'Downstream (source → target)', value: 'Downstream' },
  { label: 'Upstream (target → source)', value: 'Upstream' },
  { label: 'Bidirectional (both)', value: 'Bidirectional' },
];

const intentOptions: Array<{ label: string; value: ImpactAnalysisIntent }> = [
  { label: 'Change', value: 'Change' },
  { label: 'Risk', value: 'Risk' },
  { label: 'Failure', value: 'Failure' },
  { label: 'Decommission', value: 'Decommission' },
];

const ImpactAnalysisWorkspaceTab: React.FC = () => {
  const { openWorkspaceTab } = useIdeShell();
  const { project } = useEaProject();
  const { metadata } = useEaRepository();

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

    const window = getTimeHorizonWindow(metadata?.timeHorizon);

    form.setFieldsValue({
      direction: 'Downstream',
      maxDepth: window.maxAnalysisDepth,
      includedRelationshipTypes: relationshipTypeOptions,
      analysisIntent: 'Change',
      requestedBy: 'analyst',
      includePaths: false,
    });
  }, [form, loadElements, metadata?.timeHorizon]);

  const runAnalysis = React.useCallback(async () => {
    setRunning(true);
    setError(null);

    try {
      const values = await form.validateFields();

      const rootElementId = normalizeId(values.rootElementId);
      const direction = values.direction as ImpactAnalysisDirection;
      const requestedMaxDepth = Number(values.maxDepth);
      const cap = getTimeHorizonWindow(metadata?.timeHorizon).maxAnalysisDepth;
      const maxDepth = Math.min(requestedMaxDepth, cap);
      if (requestedMaxDepth !== maxDepth) {
        message.info(`Time Horizon '${metadata?.timeHorizon ?? '1–3 years'}' caps impact depth at ${cap}. Running with maxDepth=${maxDepth}.`);
      }
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
        projectId: project?.id ? String(project.id) : '',
        requestedBy,
        requestedAt,

        repositoryName: metadata?.repositoryName,

        rootElementId,
        rootElementType,
        direction,
        maxDepth,

        includedElementTypes: [],
        includedRelationshipTypes,

        analysisIntent,
      };

      const resp = await postImpactAnalyze(request, { includePaths });
      if (!resp?.success) throw new Error(resp?.errorMessage || 'Impact analysis failed.');

      const rootLabel = root?.name ? root.name : rootElementId;
      const result = createAnalysisResult({
        kind: 'impact',
        title: `Impact: ${rootLabel}`,
        data: {
          request,
          summary: resp.data.impactSummary,
          rankedImpacts: resp.data.rankedImpacts,
          impactPathsCount: resp.data.impactPaths?.length,
          audit: resp.data.audit
            ? {
                auditId: resp.data.audit.auditId,
                requestId: resp.data.audit.requestId,
                ranBy: resp.data.audit.ranBy,
                ranAt: resp.data.audit.ranAt,
                direction: resp.data.audit.parameters.direction,
                maxDepth: resp.data.audit.parameters.maxDepth,
                includedRelationshipTypes: resp.data.audit.parameters.includedRelationshipTypes,
              }
            : undefined,
          elementIndex: elements,
        },
      });

      message.success('Impact analysis completed. Opening result tab…');
      openWorkspaceTab({ type: 'analysisResult', resultId: result.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impact analysis failed.');
    } finally {
      setRunning(false);
    }
  }, [elementById, elements, form, openWorkspaceTab, project?.id]);

  return (
    <div style={{ padding: 12 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Impact Analysis
      </Typography.Title>

      <Alert
        type="info"
        showIcon
        message="Analysis workspace (no visualization coupling)"
        description="Reads repository data only. Runs only on explicit request. Results open in separate read-only tabs."
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
            tooltip="When enabled, the API returns raw ImpactPaths which can be large."
          >
            <Switch />
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

export default ImpactAnalysisWorkspaceTab;
