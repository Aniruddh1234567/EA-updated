import React from 'react';
import { useModel } from '@umijs/max';

import { ProCard } from '@ant-design/pro-components';
import { Alert, Button, Divider, Empty, Form, Input, Modal, Select, Space, Spin, Statistic, Table, Tag, Typography, message } from 'antd';

import type { AssuranceFinding, ArchitectureAssuranceReport } from '../../../backend/assurance/ArchitectureAssurance';
import type { AssuranceSeverity } from '../../../backend/assurance/AssurancePolicy';
import { architectureHealthEngine } from '../../../backend/analysis/ArchitectureHealthEngine';
import { createArchitectureRepository } from '../../../backend/repository/ArchitectureRepository';
import { createRelationshipRepository } from '../../../backend/repository/RelationshipRepository';
import type { BaseArchitectureElement } from '../../../backend/repository/BaseArchitectureElement';
import type { BaseArchitectureRelationship } from '../../../backend/repository/BaseArchitectureRelationship';
import type { ValidationFinding } from '../../../backend/validation/ValidationFinding';
import { createBaseline, listBaselines } from '../../../backend/baselines/BaselineStore';
import { createPlateau, listPlateaus } from '../../../backend/roadmap/PlateauStore';
import { createRoadmap } from '../../../backend/roadmap/RoadmapStore';

import { useIdeShell } from '@/components/IdeShellLayout';
import { useEaRepository } from '@/ea/EaRepositoryContext';
import { useEaProject } from '@/ea/EaProjectContext';
import { hasRepositoryPermission, type RepositoryRole } from '@/repository/accessControl';
import { buildGovernanceDebt } from '@/ea/governanceValidation';
import { clearGovernanceLog, readGovernanceLog, type GovernanceLogEntry } from '@/ea/governanceLog';
import { getRepositoryAssurance } from '@/services/ea/assurance';
import {
  getRepositoryApplications,
  getRepositoryCapabilities,
  getRepositoryProcesses,
  getRepositoryProgrammes,
  getRepositoryTechnologies,
} from '@/services/ea/repository';
import { getAllRelationships } from '@/services/ea/relationships';

type SeverityCounts = Record<AssuranceSeverity, number>;

type DataLoadFailure = {
  source: string;
  message: string;
};

const severityRank = (s: AssuranceSeverity): number => (s === 'Error' ? 3 : s === 'Warning' ? 2 : 1);

const severityColor = (s: AssuranceSeverity): 'error' | 'warning' | 'default' => {
  if (s === 'Error') return 'error';
  if (s === 'Warning') return 'warning';
  return 'default';
};

const toValidationFinding = (f: AssuranceFinding): ValidationFinding => {
  return {
    findingId: f.id,
    ruleId: f.checkId,
    affectedElementId: f.subjectId,
    affectedElementType: f.subjectType,
    severity: f.severity,
    message: f.message,
    detectedAt: f.observedAt,
    detectedBy: 'system',
  };
};

const buildElementIndex = (lists: BaseArchitectureElement[]) => {
  const byId = new Map<string, BaseArchitectureElement>();
  for (const e of lists) byId.set(e.id, e);
  return byId;
};

const safeNameForElement = (e: BaseArchitectureElement | undefined | null, fallbackId: string) => {
  const name = typeof e?.name === 'string' ? e.name.trim() : '';
  return name || fallbackId;
};

const emptySeverityCounts = (): SeverityCounts => ({ Info: 0, Warning: 0, Error: 0 });

const severityLabel = (s: AssuranceSeverity) => (s === 'Error' ? 'Error' : s === 'Warning' ? 'Warning' : 'Info');

const maxSeverity = (counts: SeverityCounts): AssuranceSeverity | 'None' => {
  if (counts.Error > 0) return 'Error';
  if (counts.Warning > 0) return 'Warning';
  if (counts.Info > 0) return 'Info';
  return 'None';
};

const statusTag = (s: AssuranceSeverity | 'None') => {
  if (s === 'Error') return <Tag color="red">Non-compliant (Error)</Tag>;
  if (s === 'Warning') return <Tag color="orange">At risk (Warning)</Tag>;
  if (s === 'Info') return <Tag>Info</Tag>;
  return <Tag color="green">Compliant</Tag>;
};

const GovernanceDashboardPage: React.FC = () => {
  const { openWorkspaceTab } = useIdeShell();
  const { initialState } = useModel('@@initialState');
  const { project } = useEaProject();
  const { eaRepository, metadata, updateRepositoryMetadata } = useEaRepository();

  const userRole: RepositoryRole = React.useMemo(() => {
    const access = initialState?.currentUser?.access;
    if (access === 'admin') return 'Owner';
    if (access === 'architect' || access === 'user') return 'Architect';
    return 'Viewer';
  }, [initialState?.currentUser?.access]);

  const canChangeGovernance = hasRepositoryPermission(userRole, 'changeGovernanceMode');

  const handleToggleGovernanceMode = React.useCallback(() => {
    if (!metadata) return;
    if (!canChangeGovernance) {
      message.warning('You do not have permission to change governance mode.');
      return;
    }
    const nextMode = metadata.governanceMode === 'Strict' ? 'Advisory' : 'Strict';
    Modal.confirm({
      title: `Switch to ${nextMode} mode?`,
      okText: 'Confirm',
      cancelText: 'Cancel',
      content:
        nextMode === 'Strict'
          ? 'Strict mode enables editing but blocks saves/exports on governance violations.'
          : 'Advisory mode is read-only. Editing, create, rename, and delete are disabled.',
      onOk: () => {
        const res = updateRepositoryMetadata({ governanceMode: nextMode });
        if (!res.ok) {
          message.error(res.error);
          return Promise.reject();
        }
        message.success(`Governance mode updated to ${nextMode}.`);
        return Promise.resolve();
      },
    });
  }, [canChangeGovernance, metadata, updateRepositoryMetadata]);

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [loadFailures, setLoadFailures] = React.useState<DataLoadFailure[]>([]);

  const [assurance, setAssurance] = React.useState<ArchitectureAssuranceReport | null>(null);
  const [elements, setElements] = React.useState<BaseArchitectureElement[]>([]);
  const [relationships, setRelationships] = React.useState<BaseArchitectureRelationship[]>([]);
  const [baselineModalOpen, setBaselineModalOpen] = React.useState(false);
  const [baselineSubmitting, setBaselineSubmitting] = React.useState(false);
  const [baselineForm] = Form.useForm<{ name: string; description?: string }>();
  const [plateauModalOpen, setPlateauModalOpen] = React.useState(false);
  const [plateauSubmitting, setPlateauSubmitting] = React.useState(false);
  const [plateauForm] = Form.useForm<{ name: string; occursAt: string; baselineId?: string }>();
  const [roadmapModalOpen, setRoadmapModalOpen] = React.useState(false);
  const [roadmapSubmitting, setRoadmapSubmitting] = React.useState(false);
  const [roadmapForm] = Form.useForm<{ name: string; plateauIds: string[] }>();

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setLoadFailures([]);

    try {
      const [assuranceRes, caps, procs, apps, tech, progs, rels] = await Promise.all([
        getRepositoryAssurance(),
        getRepositoryCapabilities(),
        getRepositoryProcesses(),
        getRepositoryApplications(),
        getRepositoryTechnologies(),
        getRepositoryProgrammes(),
        getAllRelationships(),
      ]);

      if (!assuranceRes?.success || !assuranceRes.data) {
        throw new Error(assuranceRes?.errorMessage || 'Failed to load assurance report');
      }

      const failures: DataLoadFailure[] = [];

      const listOrFail = <T,>(
        res: { success?: boolean; data?: T[]; errorMessage?: string } | undefined,
        source: string,
      ): T[] => {
        if (res?.success && Array.isArray(res.data)) return res.data;
        failures.push({ source, message: res?.errorMessage || 'Request failed' });
        return [];
      };

      const allElements: BaseArchitectureElement[] = [
        ...listOrFail<BaseArchitectureElement>(caps, 'Repository:Capabilities'),
        ...listOrFail<BaseArchitectureElement>(procs, 'Repository:Processes'),
        ...listOrFail<BaseArchitectureElement>(apps, 'Repository:Applications'),
        ...listOrFail<BaseArchitectureElement>(tech, 'Repository:Technologies'),
        ...listOrFail<BaseArchitectureElement>(progs, 'Repository:Programmes'),
      ];

      const allRelationships: BaseArchitectureRelationship[] =
        rels?.success && Array.isArray(rels.data)
          ? rels.data
          : (failures.push({ source: 'Repository:Relationships', message: rels?.errorMessage || 'Request failed' }), []);

      setAssurance(assuranceRes.data);
      setElements(allElements);
      setRelationships(allRelationships);
      setLoadFailures(failures);
      if (failures.length > 0) setError('Some repository data sources failed to load. Findings may be incomplete.');
    } catch (e) {
      setAssurance(null);
      setElements([]);
      setRelationships([]);
      setLoadFailures([]);
      setError(e instanceof Error ? e.message : 'Failed to load governance dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const scopeKey = React.useMemo(() => {
    const id = project?.id ? String(project.id).trim() : '';
    return id ? `project:${id}` : 'project:unknown';
  }, [project?.id]);

  const submitBaseline = React.useCallback(async () => {
    try {
      const values = await baselineForm.validateFields();
      setBaselineSubmitting(true);
      createBaseline({ name: values.name, description: values.description, createdBy: project?.chiefArchitect });
      message.success('Baseline created. It is read-only and independent of diagrams.');
      setBaselineModalOpen(false);
      baselineForm.resetFields();
    } catch (err) {
      if ((err as any)?.errorFields) return; // validation errors
      message.error('Unable to create baseline.');
    } finally {
      setBaselineSubmitting(false);
    }
  }, [baselineForm, project?.chiefArchitect]);

  const submitPlateau = React.useCallback(async () => {
    try {
      const values = await plateauForm.validateFields();
      setPlateauSubmitting(true);

      const trimmedName = String(values.name || '').trim();
      const trimmedOccursAt = String(values.occursAt || '').trim();
      const trimmedBaselineId = typeof values.baselineId === 'string' ? values.baselineId.trim() : '';

      const stateRef = trimmedBaselineId
        ? { kind: 'baseline', baselineId: trimmedBaselineId }
        : { kind: 'external', label: trimmedOccursAt || 'Planned state' };

      createPlateau({
        name: trimmedName,
        occursAt: trimmedOccursAt,
        stateRef,
        createdBy: project?.chiefArchitect,
      });

      message.success('Plateau created. It references a frozen state; repository data is not copied.');
      setPlateauModalOpen(false);
      plateauForm.resetFields();
    } catch (err) {
      if ((err as any)?.errorFields) return;
      message.error('Unable to create plateau.');
    } finally {
      setPlateauSubmitting(false);
    }
  }, [plateauForm, project?.chiefArchitect]);

  const submitRoadmap = React.useCallback(async () => {
    try {
      const values = await roadmapForm.validateFields();
      setRoadmapSubmitting(true);

      const trimmedName = String(values.name || '').trim();
      const plateauIds = Array.isArray(values.plateauIds)
        ? values.plateauIds.map((p) => String(p || '').trim()).filter(Boolean)
        : [];

      if (plateauIds.length === 0) {
        message.error('Select at least one plateau. Roadmaps cannot be empty.');
        return;
      }

      createRoadmap({
        name: trimmedName,
        plateauIds,
        createdBy: project?.chiefArchitect,
      });

      message.success('Roadmap created. It is a read-only projection over plateaus.');
      setRoadmapModalOpen(false);
      roadmapForm.resetFields();
    } catch (err) {
      if ((err as any)?.errorFields) return;
      const msg = err instanceof Error ? err.message : 'Unable to create roadmap.';
      message.error(msg);
    } finally {
      setRoadmapSubmitting(false);
    }
  }, [project?.chiefArchitect, roadmapForm]);

  const workspaceDebt = React.useMemo(() => {
    if (!eaRepository) return null;
    try {
      return buildGovernanceDebt(eaRepository, new Date(), { lifecycleCoverage: metadata?.lifecycleCoverage ?? null });
    } catch {
      return null;
    }
  }, [eaRepository, metadata?.lifecycleCoverage]);

  const isDraftModeling = React.useMemo(() => {
    if (!eaRepository) return false;
    const elements = Array.from(eaRepository.objects.values());
    const relationships = eaRepository.relationships;
    if (elements.length === 0 && relationships.length === 0) return false;
    const allDraftElements = elements.every((el) => (el.attributes as any)?.modelingState === 'DRAFT');
    const allDraftRelationships = relationships.every((rel) => (rel.attributes as any)?.modelingState === 'DRAFT');
    return allDraftElements && allDraftRelationships;
  }, [eaRepository]);

  const availableBaselines = React.useMemo(() => listBaselines(), [baselineModalOpen, plateauModalOpen]);
  const availablePlateaus = React.useMemo(() => listPlateaus(), [plateauModalOpen, roadmapModalOpen]);

  const workspaceDebtRows = React.useMemo(() => {
    if (!workspaceDebt) return [] as Array<{ key: string; severity: string; source: string; message: string; subject: string }>;

    const rows: Array<{ key: string; severity: string; source: string; message: string; subject: string }> = [];

    for (const f of workspaceDebt.repoReport.findings) {
      rows.push({
        key: `repo:${f.id}`,
        severity: f.severity,
        source: `Mandatory (${f.collection})`,
        message: f.message,
        subject: f.elementId,
      });
    }

    for (const f of workspaceDebt.relationshipReport.findings) {
      rows.push({
        key: `rel:${f.id}`,
        severity: f.severity,
        source: `Relationship (${f.checkId})`,
        message: f.message,
        subject: f.subjectId,
      });
    }

    for (const [i, s] of workspaceDebt.invalidRelationshipInserts.entries()) {
      rows.push({
        key: `insert:${i}`,
        severity: s.severity,
        source: 'Relationship (Insert)',
        message: s.message,
        subject: '-',
      });
    }

    for (const issue of workspaceDebt.lifecycleTagMissingIds) {
      rows.push({
        key: `lifecycle:${issue.subjectId ?? issue.scope ?? issue.message}`,
        severity: issue.severity,
        source: 'Lifecycle (Tagging)',
        message: issue.message,
        subject: issue.subjectId ?? issue.scope ?? '-',
      });
    }

    const rank = (sev: string) =>
      sev === 'BLOCKER' ? 4 : sev === 'ERROR' ? 3 : sev === 'WARNING' ? 2 : 1;
    return rows.sort((a, b) => rank(b.severity) - rank(a.severity) || a.source.localeCompare(b.source));
  }, [workspaceDebt]);

  const modelingGapRows = React.useMemo(
    () => workspaceDebtRows.filter((r) => r.severity === 'INFO'),
    [workspaceDebtRows],
  );

  const governanceRiskRows = React.useMemo(
    () => workspaceDebtRows.filter((r) => r.severity !== 'INFO'),
    [workspaceDebtRows],
  );

  const [logVersion, setLogVersion] = React.useState(0);
  const governanceLog = React.useMemo(() => {
    // Re-evaluated when logVersion changes.
    return readGovernanceLog();
  }, [logVersion]);

  const governanceLogRows = React.useMemo(() => {
    const rows = governanceLog.map((e: GovernanceLogEntry) => {
      const time = new Date(e.occurredAt).toLocaleString();
      const action =
        e.type === 'save.blocked'
          ? 'Save blocked'
          : e.type === 'save.warned'
            ? 'Save warned'
            : e.type === 'export.blocked'
              ? 'Export blocked'
              : e.type === 'export.warned'
                ? 'Export warned'
                : e.type;

      return {
        key: e.id,
        occurredAt: time,
        action,
        mode: e.governanceMode,
        repo: e.repositoryName ?? '—',
        scope: e.architectureScope ?? '—',
        total: e.summary.total,
        highlights: (e.highlights ?? []).join('\n'),
      };
    });
    return rows;
  }, [governanceLog]);

  const exportLogJson = React.useCallback(() => {
    try {
      const text = JSON.stringify(governanceLog, null, 2);
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `governance-violations-log.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }, [governanceLog]);

  const derived = React.useMemo(() => {
    const elementById = buildElementIndex(elements);

    const findings = assurance?.findings ?? [];
    const elementFindings = findings.filter((f) => f.subjectKind === 'Element');

    const hasRelationshipData = relationships.length > 0 || loadFailures.some((f) => f.source === 'Repository:Relationships') === false;
    const degreeByElementId = new Map<string, number>();
    for (const e of elements) degreeByElementId.set(e.id, 0);
    if (hasRelationshipData) {
      for (const r of relationships) {
        const src = (r.sourceElementId ?? '').trim();
        const tgt = (r.targetElementId ?? '').trim();
        if (src) degreeByElementId.set(src, (degreeByElementId.get(src) ?? 0) + 1);
        if (tgt) degreeByElementId.set(tgt, (degreeByElementId.get(tgt) ?? 0) + 1);
      }
    }

    const orphanElementIds = hasRelationshipData
      ? Array.from(degreeByElementId.entries())
          .filter(([id, deg]) => deg === 0 && elementById.has(id))
          .map(([id]) => id)
      : [];

    const bySeverity = emptySeverityCounts();
    const byDomain = new Map<string, number>();
    const byCheckId = new Map<string, number>();

    for (const f of findings) {
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
      byDomain.set(f.domain, (byDomain.get(f.domain) ?? 0) + 1);
      byCheckId.set(f.checkId, (byCheckId.get(f.checkId) ?? 0) + 1);
    }

    const checksTop = Array.from(byCheckId.entries())
      .map(([checkId, count]) => ({ checkId, count }))
      .sort((a, b) => b.count - a.count || a.checkId.localeCompare(b.checkId))
      .slice(0, 10);

    const domains = Array.from(byDomain.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));

    // Hotspots by elementId
    const hotspotsById = new Map<
      string,
      {
        elementId: string;
        elementType: string;
        total: number;
        severities: SeverityCounts;
        maxSeverity: AssuranceSeverity;
        checkIds: Set<string>;
      }
    >();

    for (const f of elementFindings) {
      const key = f.subjectId;
      const existing = hotspotsById.get(key);
      if (!existing) {
        hotspotsById.set(key, {
          elementId: key,
          elementType: f.subjectType,
          total: 1,
          severities: { Info: f.severity === 'Info' ? 1 : 0, Warning: f.severity === 'Warning' ? 1 : 0, Error: f.severity === 'Error' ? 1 : 0 },
          maxSeverity: f.severity,
          checkIds: new Set([f.checkId]),
        });
        continue;
      }

      existing.total += 1;
      existing.severities[f.severity] = (existing.severities[f.severity] ?? 0) + 1;
      if (severityRank(f.severity) > severityRank(existing.maxSeverity)) existing.maxSeverity = f.severity;
      existing.checkIds.add(f.checkId);
    }

    // Add orphan finding counts into hotspots (explicit governance rule).
    for (const orphanId of orphanElementIds) {
      const existing = hotspotsById.get(orphanId);
      if (!existing) {
        hotspotsById.set(orphanId, {
          elementId: orphanId,
          elementType: elementById.get(orphanId)?.elementType ?? 'Unknown',
          total: 1,
          severities: { Info: 0, Warning: 1, Error: 0 },
          maxSeverity: 'Warning',
          checkIds: new Set(['ORPHAN_ELEMENT']),
        });
        continue;
      }

      existing.total += 1;
      existing.severities.Warning += 1;
      if (severityRank('Warning') > severityRank(existing.maxSeverity)) existing.maxSeverity = 'Warning';
      existing.checkIds.add('ORPHAN_ELEMENT');
    }

    const hotspots = Array.from(hotspotsById.values())
      .map((h) => {
        const e = elementById.get(h.elementId);
        return {
          ...h,
          name: safeNameForElement(e, h.elementId),
          layer: e?.layer ?? '—',
        };
      })
      .sort(
        (a, b) =>
          severityRank(b.maxSeverity) - severityRank(a.maxSeverity) ||
          b.total - a.total ||
          b.severities.Error - a.severities.Error ||
          b.severities.Warning - a.severities.Warning ||
          a.name.localeCompare(b.name) ||
          a.elementId.localeCompare(b.elementId),
      )
      .slice(0, 15);

    // Health metrics (deterministic; computed from fetched repo state + element-scoped findings)
    const repo = createArchitectureRepository();
    for (const e of elements) {
      const collection =
        e.elementType === 'Capability'
          ? 'capabilities'
          : e.elementType === 'BusinessProcess'
            ? 'businessProcesses'
            : e.elementType === 'Application'
              ? 'applications'
              : e.elementType === 'Technology'
                ? 'technologies'
                : 'programmes';
      repo.addElement(collection as any, e as any);
    }

    const relRepo = createRelationshipRepository(repo);
    for (const r of relationships) {
      relRepo.addRelationship(r);
    }

    const health = architectureHealthEngine.evaluate({
      scopeKey,
      elements: repo,
      relationships: relRepo,
      findings: elementFindings.map(toValidationFinding),
    });

    const elementCompliance = elements
      .map((e) => {
        const counts: SeverityCounts = emptySeverityCounts();
        for (const f of elementFindings) {
          if (f.subjectId !== e.id) continue;
          counts[f.severity] = (counts[f.severity] ?? 0) + 1;
        }

        if (orphanElementIds.includes(e.id)) counts.Warning += 1;

        const max = maxSeverity(counts);
        return {
          elementId: e.id,
          name: safeNameForElement(e, e.id),
          elementType: e.elementType,
          layer: e.layer ?? '—',
          status: max,
          counts,
        };
      })
      .sort(
        (a, b) =>
          severityRank((b.status === 'None' ? 'Info' : b.status) as AssuranceSeverity) -
            severityRank((a.status === 'None' ? 'Info' : a.status) as AssuranceSeverity) ||
          (b.counts.Error + b.counts.Warning + b.counts.Info) - (a.counts.Error + a.counts.Warning + a.counts.Info) ||
          a.name.localeCompare(b.name),
      );

    const ruleRows: Array<{ ruleId: string; severity: AssuranceSeverity; description: string; count: number }> = [];
    ruleRows.push({
      ruleId: 'ORPHAN_ELEMENT',
      severity: 'Warning',
      description: hasRelationshipData
        ? 'Element has no relationships (degree = 0).'
        : 'Cannot compute (relationships failed to load).',
      count: hasRelationshipData ? orphanElementIds.length : 0,
    });

    // Surface key assurance checks related to missing relationships/invalid linkage.
    const keyChecks = [
      'RELATIONSHIP_DANGLING_REFERENCE',
      'PROCESS_MISSING_CAPABILITY_PARENT',
      'PROCESS_MULTIPLE_CAPABILITY_PARENTS',
    ];
    for (const checkId of keyChecks) {
      const count = findings.filter((f) => f.checkId === checkId).length;
      const severity =
        findings.find((f) => f.checkId === checkId)?.severity ?? (checkId === 'RELATIONSHIP_DANGLING_REFERENCE' ? 'Error' : 'Error');
      ruleRows.push({
        ruleId: checkId,
        severity,
        description:
          checkId === 'RELATIONSHIP_DANGLING_REFERENCE'
            ? 'Relationship references a missing element (dangling endpoint).'
            : checkId === 'PROCESS_MISSING_CAPABILITY_PARENT'
              ? 'BusinessProcess missing/invalid parent Capability reference.'
              : 'BusinessProcess decomposed under multiple Capabilities.',
        count,
      });
    }

    const findingsWithOrphans: Array<AssuranceFinding> = [...findings];
    for (const orphanId of orphanElementIds) {
      const e = elementById.get(orphanId);
      findingsWithOrphans.unshift({
        id: `UiGovernance:ORPHAN_ELEMENT:${orphanId}`,
        domain: 'IntegrityAudit',
        checkId: 'ORPHAN_ELEMENT',
        severity: 'Warning',
        message: `Element has no relationships (orphan).`,
        observedAt: assurance?.observedAt ?? new Date().toISOString(),
        subjectKind: 'Element',
        subjectId: orphanId,
        subjectType: e?.elementType ?? 'Unknown',
      });
    }

    return {
      elementById,
      elementCount: elements.length,
      relationshipCount: relationships.length,
      orphanElementIds,
      ruleRows,
      elementCompliance,
      findingsWithOrphans,
      bySeverity,
      domains,
      checksTop,
      hotspots,
      health,
    };
  }, [assurance, elements, relationships, scopeKey, loadFailures]);

  const observedAt = assurance?.observedAt ? new Date(assurance.observedAt).toLocaleString() : '—';

  return (
    <div style={{ height: '100%', padding: 16 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space align="baseline" style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space direction="vertical" size={0}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              Governance & Assurance
            </Typography.Title>
            <Typography.Text type="secondary">Observed: {observedAt}</Typography.Text>
          </Space>
          <Space>
            <Button onClick={() => setRoadmapModalOpen(true)}>Create Roadmap</Button>
            <Button onClick={() => setPlateauModalOpen(true)}>Create Plateau</Button>
            <Button onClick={() => setBaselineModalOpen(true)}>Create Baseline</Button>
            <Button onClick={refresh} disabled={loading}>
              Refresh
            </Button>
          </Space>
        </Space>

        <ProCard title="Workspace Governance Debt" headerBordered>
          {!eaRepository ? (
            <Empty
              description={
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>No workspace repository loaded</Typography.Text>
                  <Typography.Text type="secondary">Create or import a repository to see governance debt.</Typography.Text>
                </Space>
              }
            />
          ) : !workspaceDebt ? (
            <Alert type="warning" showIcon message="Unable to compute workspace governance debt." />
          ) : (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space size={24} wrap>
                <Statistic title="Mode" value={metadata?.governanceMode ?? '—'} />
                <Button onClick={handleToggleGovernanceMode} disabled={!metadata || !canChangeGovernance}>
                  {metadata?.governanceMode === 'Strict' ? 'Switch to Advisory (read-only)' : 'Switch to Strict (enable editing)'}
                </Button>
                {isDraftModeling ? (
                  <Tag color="gold">Draft modeling: counts hidden</Tag>
                ) : (
                  <>
                    <Statistic title="Mandatory" value={workspaceDebt.summary.mandatoryFindingCount} />
                    <Statistic title="Rel Errors" value={workspaceDebt.summary.relationshipErrorCount} />
                    <Statistic title="Rel Warnings" value={workspaceDebt.summary.relationshipWarningCount} />
                    <Statistic title="Invalid Inserts" value={workspaceDebt.summary.invalidRelationshipInsertCount} />
                    <Statistic title="Total" value={workspaceDebt.summary.total} />
                  </>
                )}
              </Space>

              <Divider style={{ margin: '8px 0' }} />

              {workspaceDebt.summary.total === 0 ? (
                <Alert type="success" showIcon message="Compliant (no outstanding governance debt)." />
              ) : (
                <Alert
                  type="warning"
                  showIcon
                  message="Issues are logged but not blocking in Advisory mode."
                  description="See details below. Strict mode blocks saving/export on mandatory fields and relationship errors."
                />
              )}

              <Typography.Text strong>Modeling gaps</Typography.Text>
              <Table
                size="small"
                rowKey="key"
                dataSource={modelingGapRows}
                pagination={{ pageSize: 6 }}
                locale={{ emptyText: 'No modeling gaps detected.' }}
                columns={[
                  {
                    title: 'Severity',
                    dataIndex: 'severity',
                    width: 110,
                    render: (sev: string) => <Tag color="default">{sev}</Tag>,
                  },
                  { title: 'Source', dataIndex: 'source', width: 220 },
                  { title: 'Message', dataIndex: 'message' },
                  { title: 'Subject', dataIndex: 'subject', width: 200 },
                ]}
              />

              <Typography.Text strong>Governance risks</Typography.Text>
              <Table
                size="small"
                rowKey="key"
                dataSource={governanceRiskRows}
                pagination={{ pageSize: 6 }}
                locale={{ emptyText: 'No governance risks detected.' }}
                columns={[
                  {
                    title: 'Severity',
                    dataIndex: 'severity',
                    width: 110,
                    render: (sev: string) => {
                      const color = sev === 'BLOCKER' || sev === 'ERROR' ? 'red' : sev === 'WARNING' ? 'orange' : 'default';
                      return <Tag color={color}>{sev}</Tag>;
                    },
                  },
                  { title: 'Source', dataIndex: 'source', width: 220 },
                  { title: 'Message', dataIndex: 'message' },
                  { title: 'Subject', dataIndex: 'subject', width: 200 },
                ]}
              />
            </Space>
          )}
        </ProCard>

        <Modal
          title="Create Baseline"
          open={baselineModalOpen}
          onCancel={() => {
            setBaselineModalOpen(false);
            baselineForm.resetFields();
          }}
          onOk={submitBaseline}
          okText="Create"
          confirmLoading={baselineSubmitting}
          destroyOnClose
        >
          <Typography.Paragraph type="secondary">
            Capture a point-in-time, read-only snapshot of the repository (elements, relationships, properties, lifecycle
            states). Baselines do not affect diagrams and do not change repository data.
          </Typography.Paragraph>
          <Form layout="vertical" form={baselineForm} preserve={false}>
            <Form.Item
              label="Baseline Name"
              name="name"
              rules={[{ required: true, message: 'Name is required' }]}
            >
              <Input placeholder="e.g., Q1 2026 Current State" autoFocus allowClear />
            </Form.Item>
            <Form.Item label="Description" name="description">
              <Input.TextArea placeholder="Optional description" rows={3} allowClear />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title="Create Plateau"
          open={plateauModalOpen}
          onCancel={() => {
            setPlateauModalOpen(false);
            plateauForm.resetFields();
          }}
          onOk={submitPlateau}
          okText="Create"
          confirmLoading={plateauSubmitting}
          destroyOnClose
        >
          <Typography.Paragraph type="secondary">
            Define a planned architecture state at a point in time. Plateaus reference frozen snapshots (e.g., a Baseline)
            and do not copy repository data.
          </Typography.Paragraph>
          <Form layout="vertical" form={plateauForm} preserve={false}>
            <Form.Item label="Plateau Name" name="name" rules={[{ required: true, message: 'Name is required' }]}>
              <Input placeholder="e.g., FY25 Target Plateau" autoFocus allowClear />
            </Form.Item>
            <Form.Item
              label="Timeframe"
              name="occursAt"
              rules={[{ required: true, message: 'Timeframe is required' }]}
            >
              <Input placeholder="e.g., Q1 2025" allowClear />
            </Form.Item>
            <Form.Item label="Reference Baseline (optional)" name="baselineId">
              <Input.Group compact>
                <select
                  style={{ width: '100%', minHeight: 32 }}
                  value={plateauForm.getFieldValue('baselineId') ?? ''}
                  onChange={(e) => plateauForm.setFieldsValue({ baselineId: e.target.value })}
                >
                  <option value="">No baseline selected</option>
                  {availableBaselines.map((b) => (
                    <option key={b.id} value={b.id}>{`${b.name || b.id} (${b.id})`}</option>
                  ))}
                </select>
              </Input.Group>
              <Typography.Text type="secondary">Baseline reference is recommended to anchor the plateau.</Typography.Text>
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title="Create Roadmap"
          open={roadmapModalOpen}
          onCancel={() => {
            setRoadmapModalOpen(false);
            roadmapForm.resetFields();
          }}
          onOk={submitRoadmap}
          okText="Create"
          confirmLoading={roadmapSubmitting}
          destroyOnClose
        >
          <Typography.Paragraph type="secondary">
            Build an ordered sequence of plateaus to visualize architectural evolution. Roadmaps are read-only projections
            and cannot be empty.
          </Typography.Paragraph>
          <Form layout="vertical" form={roadmapForm} preserve={false}>
            <Form.Item label="Roadmap Name" name="name" rules={[{ required: true, message: 'Name is required' }]}>
              <Input placeholder="e.g., 2026-2028 Transformation Roadmap" autoFocus allowClear />
            </Form.Item>
            <Form.Item
              label="Plateaus (ordered)"
              name="plateauIds"
              rules={[{ required: true, message: 'Select at least one plateau' }]}
            >
              <Select
                mode="multiple"
                placeholder="Select plateaus in desired order"
                optionFilterProp="label"
                allowClear
                options={availablePlateaus.map((p) => ({
                  label: `${p.name} — ${p.occursAt}`,
                  value: p.id,
                }))}
              />
            </Form.Item>
            <Typography.Text type="secondary">
              Selection order defines the roadmap sequence. Roadmaps are read-only and do not own architecture elements.
            </Typography.Text>
          </Form>
        </Modal>

        <ProCard
          title="Governance Violations Log"
          headerBordered
          extra={
            <Space>
              <Button
                onClick={() => {
                  clearGovernanceLog();
                  setLogVersion((v) => v + 1);
                }}
                disabled={governanceLog.length === 0}
              >
                Clear
              </Button>
              <Button onClick={exportLogJson} disabled={governanceLog.length === 0}>
                Export JSON
              </Button>
              <Button onClick={() => setLogVersion((v) => v + 1)}>Reload</Button>
            </Space>
          }
        >
          {governanceLog.length === 0 ? (
            <Empty
              description={
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>No logged governance violations</Typography.Text>
                  <Typography.Text type="secondary">
                    Violations are recorded when saves/exports are blocked (Strict) or proceed with warnings (Advisory).
                  </Typography.Text>
                </Space>
              }
            />
          ) : (
            <Table
              size="small"
              rowKey="key"
              dataSource={governanceLogRows}
              pagination={{ pageSize: 10 }}
              columns={[
                { title: 'When', dataIndex: 'occurredAt', width: 180 },
                { title: 'Action', dataIndex: 'action', width: 130 },
                { title: 'Mode', dataIndex: 'mode', width: 100 },
                { title: 'Repository', dataIndex: 'repo', width: 200 },
                { title: 'Scope', dataIndex: 'scope', width: 120 },
                { title: 'Total', dataIndex: 'total', width: 80 },
                {
                  title: 'Highlights',
                  dataIndex: 'highlights',
                  render: (text: string) => (
                    <Typography.Text style={{ whiteSpace: 'pre-wrap' }} type="secondary">
                      {text || '—'}
                    </Typography.Text>
                  ),
                },
              ]}
            />
          )}
        </ProCard>

        {error ? (
          <ProCard>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Alert type="error" showIcon message={error} />
              {loadFailures.length > 0 ? (
                <Alert
                  type="error"
                  showIcon
                  message="Data load failures (not masked)"
                  description={
                    <Space direction="vertical" size={4}>
                      {loadFailures.map((f) => (
                        <Typography.Text key={`${f.source}:${f.message}`}>
                          <Typography.Text strong>{f.source}:</Typography.Text> {f.message}
                        </Typography.Text>
                      ))}
                    </Space>
                  }
                />
              ) : null}
            </Space>
          </ProCard>
        ) : null}

        {loading ? (
          <ProCard>
            <Spin />
          </ProCard>
        ) : null}

        {!loading && assurance && derived.elementCount === 0 ? (
          <ProCard>
            <Empty
              description={
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>Repository has no elements</Typography.Text>
                  <Typography.Text type="secondary">Add elements from the Catalogues panel, then refresh.</Typography.Text>
                </Space>
              }
            />
          </ProCard>
        ) : null}

        {!loading && assurance && derived.elementCount > 0 ? (
          <>
            <ProCard split="horizontal" bordered>
              <ProCard title="Health Summary" headerBordered>
                <Space size={24} wrap>
                  <Statistic title="Overall Health Score" value={derived.health.metrics.overallHealthScore} suffix="/ 100" />
                  <Statistic title="Trend" value={derived.health.metrics.healthTrend} />
                  <Statistic title="Elements" value={derived.health.metrics.totalElements} />
                  <Statistic title="Relationships" value={derived.relationshipCount} />
                  <Statistic title="Errors" value={derived.health.metrics.elementsWithErrors} />
                  <Statistic title="Warnings" value={derived.health.metrics.elementsWithWarnings} />
                  <Statistic title="Orphans" value={derived.health.metrics.orphanedElementsCount} />
                  <Statistic title="Lifecycle Risk" value={derived.health.metrics.lifecycleRiskCount} />
                  <Statistic title="Tech Obsolescence" value={derived.health.metrics.technologyObsolescenceCount} />
                </Space>

                <div style={{ marginTop: 12 }}>
                  <Space size={12} wrap>
                    <Typography.Text strong>Enforcement:</Typography.Text>
                    {assurance.enforcement.compliant ? (
                      <Tag color="green">Compliant</Tag>
                    ) : (
                      <Tag color="red">Blocking Findings</Tag>
                    )}
                    <Typography.Text type="secondary">
                      Blocking count: {assurance.enforcement.blockingCount} (fails on {assurance.enforcement.blockingSeverities.join(', ')})
                    </Typography.Text>
                  </Space>
                </div>
              </ProCard>

              <ProCard title="Validation Rules" headerBordered>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                  Governance is read-only. It reports issues explicitly and does not auto-fix.
                </Typography.Paragraph>
                <Table
                  size="small"
                  pagination={false}
                  rowKey="ruleId"
                  columns={[
                    { title: 'Rule', dataIndex: 'ruleId', width: 260 },
                    {
                      title: 'Severity',
                      dataIndex: 'severity',
                      width: 120,
                      render: (s: AssuranceSeverity) => <Tag color={severityColor(s)}>{severityLabel(s)}</Tag>,
                    },
                    { title: 'Count', dataIndex: 'count', width: 110 },
                    { title: 'Description', dataIndex: 'description' },
                  ]}
                  dataSource={derived.ruleRows}
                />
              </ProCard>

              <ProCard title="Findings Breakdown" headerBordered>
                <Space size={24} wrap>
                  <Statistic title="Total" value={assurance.summary.total} />
                  <Statistic title="Errors" value={derived.bySeverity.Error} />
                  <Statistic title="Warnings" value={derived.bySeverity.Warning} />
                  <Statistic title="Info" value={derived.bySeverity.Info} />
                </Space>

                <div style={{ marginTop: 16 }}>
                  <Table
                    size="small"
                    pagination={false}
                    rowKey="domain"
                    columns={[
                      { title: 'Domain', dataIndex: 'domain' },
                      { title: 'Findings', dataIndex: 'count', width: 120 },
                    ]}
                    dataSource={derived.domains}
                  />
                </div>

                <div style={{ marginTop: 16 }}>
                  <Typography.Text strong>Top Checks</Typography.Text>
                  <Table
                    size="small"
                    pagination={false}
                    rowKey="checkId"
                    columns={[
                      { title: 'Check ID', dataIndex: 'checkId' },
                      { title: 'Findings', dataIndex: 'count', width: 120 },
                    ]}
                    dataSource={derived.checksTop}
                  />
                </div>
              </ProCard>

              <ProCard title="Top Risk Hotspots" headerBordered>
                <Table
                  size="small"
                  pagination={false}
                  rowKey="elementId"
                  columns={[
                    {
                      title: 'Element',
                      dataIndex: 'name',
                      render: (_: unknown, row: any) => (
                        <Button
                          type="link"
                          style={{ padding: 0, height: 'auto' }}
                          onClick={() => {
                            openWorkspaceTab({
                              type: 'object',
                              objectId: row.elementId,
                              objectType: row.elementType,
                              name: row.name,
                            });
                          }}
                        >
                          {row.name}
                        </Button>
                      ),
                    },
                    { title: 'Type', dataIndex: 'elementType', width: 140 },
                    { title: 'Layer', dataIndex: 'layer', width: 120 },
                    {
                      title: 'Max',
                      dataIndex: 'maxSeverity',
                      width: 110,
                      render: (s: AssuranceSeverity) => <Tag color={severityColor(s)}>{s}</Tag>,
                    },
                    { title: 'Total', dataIndex: 'total', width: 90 },
                    {
                      title: 'Errors',
                      dataIndex: ['severities', 'Error'],
                      width: 90,
                    },
                    {
                      title: 'Warnings',
                      dataIndex: ['severities', 'Warning'],
                      width: 100,
                    },
                    {
                      title: 'Checks',
                      width: 90,
                      render: (_: unknown, row: any) => row.checkIds?.size ?? 0,
                    },
                  ]}
                  dataSource={derived.hotspots as any[]}
                />
              </ProCard>

              <ProCard title="Compliance Status (Per Element)" headerBordered>
                <Table
                  size="small"
                  rowKey="elementId"
                  pagination={{ pageSize: 20 }}
                  columns={[
                    {
                      title: 'Status',
                      dataIndex: 'status',
                      width: 170,
                      filters: [
                        { text: 'Error', value: 'Error' },
                        { text: 'Warning', value: 'Warning' },
                        { text: 'Info', value: 'Info' },
                        { text: 'Compliant', value: 'None' },
                      ],
                      onFilter: (value, row: any) => row.status === value,
                      render: (s: AssuranceSeverity | 'None') => statusTag(s),
                    },
                    {
                      title: 'Element',
                      dataIndex: 'name',
                      render: (_: unknown, row: any) => (
                        <Button
                          type="link"
                          style={{ padding: 0, height: 'auto' }}
                          onClick={() => {
                            openWorkspaceTab({
                              type: 'object',
                              objectId: row.elementId,
                              objectType: row.elementType,
                              name: row.name,
                            });
                          }}
                        >
                          {row.name}
                        </Button>
                      ),
                    },
                    { title: 'Type', dataIndex: 'elementType', width: 150 },
                    { title: 'Layer', dataIndex: 'layer', width: 120 },
                    { title: 'Errors', dataIndex: ['counts', 'Error'], width: 90 },
                    { title: 'Warnings', dataIndex: ['counts', 'Warning'], width: 110 },
                    { title: 'Info', dataIndex: ['counts', 'Info'], width: 80 },
                  ]}
                  dataSource={derived.elementCompliance as any[]}
                />
              </ProCard>

              <ProCard title="Findings (Read-only)" headerBordered>
                {derived.findingsWithOrphans.length === 0 ? (
                  <Empty description="No findings." />
                ) : (
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={{ pageSize: 20 }}
                    columns={[
                      {
                        title: 'Severity',
                        dataIndex: 'severity',
                        width: 110,
                        filters: [
                          { text: 'Error', value: 'Error' },
                          { text: 'Warning', value: 'Warning' },
                          { text: 'Info', value: 'Info' },
                        ],
                        onFilter: (value, row: any) => row.severity === value,
                        render: (s: AssuranceSeverity) => <Tag color={severityColor(s)}>{severityLabel(s)}</Tag>,
                      },
                      {
                        title: 'Domain',
                        dataIndex: 'domain',
                        width: 170,
                      },
                      { title: 'Check', dataIndex: 'checkId', width: 260 },
                      { title: 'Subject', dataIndex: 'subjectKind', width: 120 },
                      { title: 'Type', dataIndex: 'subjectType', width: 160 },
                      {
                        title: 'ID',
                        dataIndex: 'subjectId',
                        width: 220,
                        render: (id: string, row: any) => {
                          if (row.subjectKind === 'Element') {
                            const el = derived.elementById.get(id);
                            const name = safeNameForElement(el, id);
                            return (
                              <Button
                                type="link"
                                style={{ padding: 0, height: 'auto' }}
                                onClick={() => {
                                  openWorkspaceTab({
                                    type: 'object',
                                    objectId: id,
                                    objectType: row.subjectType,
                                    name,
                                  });
                                }}
                              >
                                {id}
                              </Button>
                            );
                          }

                          return <Typography.Text>{id}</Typography.Text>;
                        },
                      },
                      { title: 'Message', dataIndex: 'message' },
                      { title: 'Observed At', dataIndex: 'observedAt', width: 190 },
                    ]}
                    dataSource={derived.findingsWithOrphans as any[]}
                  />
                )}
              </ProCard>
            </ProCard>
          </>
        ) : null}
      </Space>
    </div>
  );
};

export default GovernanceDashboardPage;
