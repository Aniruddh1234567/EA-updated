import React from 'react';
import { Alert, Button, Card, Divider, Form, Select, Space, Typography } from 'antd';

import type { BaseArchitectureElement } from '../../../backend/repository/BaseArchitectureElement';
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

const CoverageAnalysisWorkspaceTab: React.FC = () => {
  const { openWorkspaceTab } = useIdeShell();
  const [form] = Form.useForm();

  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    form.setFieldsValue({
      includedRelationshipTypes: relationshipTypeOptions,
    });
  }, [form]);

  const runAnalysis = React.useCallback(async () => {
    setRunning(true);
    setError(null);

    try {
      const values = await form.validateFields();
      const includedRelationshipTypes = (values.includedRelationshipTypes as string[]).slice().sort(compareStrings);

      const [caps, procs, apps, tech, progs, relsResp] = await Promise.all([
        getRepositoryCapabilities(),
        getRepositoryProcesses(),
        getRepositoryApplications(),
        getRepositoryTechnologies(),
        getRepositoryProgrammes(),
        getAllRelationships(),
      ]);

      const all: BaseArchitectureElement[] = [];
      if (caps?.success) all.push(...(caps.data ?? []));
      if (procs?.success) all.push(...(procs.data ?? []));
      if (apps?.success) all.push(...(apps.data ?? []));
      if (tech?.success) all.push(...(tech.data ?? []));
      if (progs?.success) all.push(...(progs.data ?? []));

      if (!relsResp?.success) throw new Error(relsResp?.errorMessage || 'Failed to load relationships.');

      const relationships = (relsResp.data ?? []).filter((r) => includedRelationshipTypes.includes(r.relationshipType));

      const elementCountsByType = new Map<string, number>();
      const elementIds = new Set<string>();

      const elementIndex: ElementOption[] = all
        .map((e) => ({ id: normalizeId(e.id), name: e.name || e.id, elementType: e.elementType }))
        .filter((e) => e.id.length > 0);

      for (const e of elementIndex) {
        elementIds.add(e.id);
        elementCountsByType.set(e.elementType, (elementCountsByType.get(e.elementType) ?? 0) + 1);
      }

      const relationshipCountsByType = new Map<string, number>();
      const degree = new Map<string, number>();
      for (const id of elementIds) degree.set(id, 0);

      for (const r of relationships) {
        relationshipCountsByType.set(
          r.relationshipType,
          (relationshipCountsByType.get(r.relationshipType) ?? 0) + 1,
        );

        const src = normalizeId(r.sourceElementId);
        const tgt = normalizeId(r.targetElementId);
        if (src) degree.set(src, (degree.get(src) ?? 0) + 1);
        if (tgt) degree.set(tgt, (degree.get(tgt) ?? 0) + 1);
      }

      let orphanedElementCount = 0;
      for (const id of elementIds) {
        if ((degree.get(id) ?? 0) === 0) orphanedElementCount += 1;
      }

      const result = createAnalysisResult({
        kind: 'coverage',
        title: 'Gap Analysis: Repository Coverage',
        data: {
          totalElementCount: elementIndex.length,
          totalRelationshipCount: relationships.length,
          orphanedElementCount,
          elementCountsByType: [...elementCountsByType.entries()]
            .map(([elementType, count]) => ({ elementType, count }))
            .sort((a, b) => (b.count - a.count ? b.count - a.count : compareStrings(a.elementType, b.elementType))),
          relationshipCountsByType: [...relationshipCountsByType.entries()]
            .map(([relationshipType, count]) => ({ relationshipType, count }))
            .sort((a, b) => (b.count - a.count ? b.count - a.count : compareStrings(a.relationshipType, b.relationshipType))),
        },
      });

      message.success('Gap analysis completed. Opening result tab…');
      openWorkspaceTab({ type: 'analysisResult', resultId: result.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Coverage analysis failed.');
    } finally {
      setRunning(false);
    }
  }, [form, openWorkspaceTab]);

  return (
    <div style={{ padding: 12 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Gap Analysis
      </Typography.Title>

      <Alert
        type="info"
        showIcon
        message="Analysis workspace (no visualization coupling)"
        description="Summarizes repository gaps via coverage and connectivity metrics. Results open in separate read-only tabs."
      />

      <Divider style={{ margin: '12px 0' }} />

      <Card size="small" title="Configuration">
        <Form form={form} layout="vertical">
          <Form.Item
            label="Included relationship types"
            name="includedRelationshipTypes"
            rules={[{ required: true, message: 'Select at least one relationship type' }]}
          >
            <Select mode="multiple" options={relationshipTypeOptions.map((t) => ({ value: t, label: t }))} />
          </Form.Item>

          {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}

          <Space>
            <Button type="primary" onClick={() => void runAnalysis()} loading={running}>
              Run analysis
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
};

export default CoverageAnalysisWorkspaceTab;
