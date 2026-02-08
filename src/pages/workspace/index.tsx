import React from 'react';

import { Card, Empty, Space, Typography, Button, Upload, Alert, Table } from 'antd';

import { useEaProject } from '@/ea/EaProjectContext';
import { addElement } from '../../../backend/repository/RepositoryStore';
import { addRelationship } from '../../../backend/repository/RelationshipRepositoryStore';
import { getRepository } from '../../../backend/repository/RepositoryStore';
import type { Capability } from '../../../backend/repository/Capability';
import type { Application } from '../../../backend/repository/Application';
import type { ApplicationDependencyRelationship } from '../../../backend/repository/ApplicationDependencyRelationship';
import { message } from '@/ea/eaConsole';

const WorkspacePage: React.FC = () => {
  const { project } = useEaProject();

  const createId = React.useCallback(() => {
    try {
      return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `seed-${Date.now()}-${Math.random()}`;
    } catch {
      return `seed-${Date.now()}-${Math.random()}`;
    }
  }, []);

  const nowIso = React.useCallback(() => new Date().toISOString(), []);

  const seedSampleData = React.useCallback(() => {
    const repo = getRepository();
    if (repo.getElementsByType('capabilities').length || repo.getElementsByType('applications').length) {
      message.info('Repository already has data; skipping seed.');
      return;
    }

    const timestamp = nowIso();

    const mkBase = (name: string, elementType: string, layer: 'Business' | 'Application') => ({
      id: createId(),
      name,
      description: `${name} (sample data)`,
      elementType,
      layer,
      lifecycleStatus: 'Active' as const,
      lifecycleStartDate: timestamp,
      ownerRole: 'Sample Owner',
      ownerName: 'Architecture Team',
      owningUnit: 'EA',
      approvalStatus: 'Approved' as const,
      lastReviewedAt: timestamp,
      reviewCycleMonths: 12,
      createdAt: timestamp,
      createdBy: 'sample-seed',
      lastModifiedAt: timestamp,
      lastModifiedBy: 'sample-seed',
    });

    const capL1: Capability = {
      ...mkBase('Capability L1 (Sample)', 'Capability', 'Business'),
      capabilityLevel: 'L1',
      parentCapabilityId: null,
      businessOutcome: 'Deliver core services (sample)',
      valueStream: 'Sample Stream',
      inScope: true,
      impactedByChange: false,
      strategicImportance: 'High',
      maturityLevel: 3,
    };

    const capL2: Capability = {
      ...mkBase('Capability L2 (Sample)', 'Capability', 'Business'),
      capabilityLevel: 'L2',
      parentCapabilityId: capL1.id,
      businessOutcome: 'Sub-capability outcome (sample)',
      valueStream: 'Sample Stream',
      inScope: true,
      impactedByChange: true,
      strategicImportance: 'Medium',
      maturityLevel: 2,
    };

    const appA: Application = {
      ...mkBase('App Alpha (Sample)', 'Application', 'Application'),
      applicationCode: 'APP-SAMPLE-ALPHA',
      applicationType: 'SaaS',
      businessCriticality: 'High',
      availabilityTarget: 99.9,
      deploymentModel: 'Cloud',
      vendorLockInRisk: 'Medium',
      technicalDebtLevel: 'Low',
      annualRunCost: 120000,
      vendorName: 'SampleVendor',
    };

    const appB: Application = {
      ...mkBase('App Beta (Sample)', 'Application', 'Application'),
      applicationCode: 'APP-SAMPLE-BETA',
      applicationType: 'COTS',
      businessCriticality: 'Medium',
      availabilityTarget: 99.0,
      deploymentModel: 'Hybrid',
      vendorLockInRisk: 'Low',
      technicalDebtLevel: 'Medium',
      annualRunCost: 80000,
      vendorName: 'SampleVendor',
    };

    const rel: ApplicationDependencyRelationship = {
      id: createId(),
      relationshipType: 'INTEGRATES_WITH',
      sourceElementId: appA.id,
      sourceElementType: 'Application',
      targetElementId: appB.id,
      targetElementType: 'Application',
      direction: 'OUTGOING',
      status: 'Approved',
      effectiveFrom: timestamp,
      rationale: 'Sample dependency for demo purposes',
      confidenceLevel: 'High',
      lastReviewedAt: timestamp,
      reviewedBy: 'sample-seed',
      createdAt: timestamp,
      createdBy: 'sample-seed',
      dependencyType: 'API',
      dependencyStrength: 'Hard',
      runtimeCritical: true,
    };

    const inserts = [
      addElement('capabilities', capL1),
      addElement('capabilities', capL2),
      addElement('applications', appA),
      addElement('applications', appB),
    ];

    const failed = inserts.find((r) => !r.ok);
    if (failed && !failed.ok) {
      message.error(failed.error || 'Failed to seed sample data.');
      return;
    }

    const relResult = addRelationship(rel);
    if (!relResult.ok) {
      message.error(relResult.error || 'Failed to create sample relationship.');
      return;
    }

    message.success('Sample data seeded: capabilities, applications, and a dependency.');
  }, [createId, nowIso]);

  type ImportPreviewRow = {
    key: number;
    type: 'Capability' | 'Application';
    name: string;
    description: string;
    capabilityLevel?: string;
    parentCapabilityId?: string;
    applicationCode?: string;
    raw: Record<string, string>;
    error?: string;
  };

  const [previewRows, setPreviewRows] = React.useState<ImportPreviewRow[]>([]);

  const parseCsv = React.useCallback((text: string) => {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      message.error('No data rows found.');
      setPreviewRows([]);
      return;
    }
    const headers = lines[0].split(',').map((h) => h.trim());
    const rows: ImportPreviewRow[] = [];
    for (let i = 1; i < lines.length; i += 1) {
      const cells = lines[i]!.split(',');
      const record: Record<string, string> = {};
      headers.forEach((h, idx) => {
        record[h.toLowerCase()] = (cells[idx] ?? '').trim();
      });

      const type = (record.type || record.elementtype || '').trim();
      const name = record.name || '';
      const description = record.description || '';
      const capabilityLevel = record.capabilitylevel || record.level || '';
      const parentCapabilityId = record.parentcapabilityid || record.parent || '';
      const applicationCode = record.applicationcode || record.code || '';

      let error: string | undefined;
      if (!type || (type !== 'Capability' && type !== 'Application')) {
        error = 'type must be Capability or Application';
      } else if (!name) {
        error = 'name is required';
      } else if (type === 'Capability' && !capabilityLevel) {
        error = 'capabilityLevel is required for Capability';
      } else if (type === 'Application' && !applicationCode) {
        error = 'applicationCode is required for Application';
      }

      rows.push({
        key: i,
        type: type as any,
        name,
        description,
        capabilityLevel: capabilityLevel || undefined,
        parentCapabilityId: parentCapabilityId || undefined,
        applicationCode: applicationCode || undefined,
        raw: record,
        error,
      });
    }
    setPreviewRows(rows);
  }, []);

  const handleUpload = React.useCallback(async (file: File) => {
    const text = await file.text();
    parseCsv(text);
    return false; // prevent actual upload
  }, [parseCsv]);

  const importRows = React.useCallback(() => {
    if (!previewRows.length) return;
    const timestamp = nowIso();
    const successes: string[] = [];
    const failures: string[] = [];

    previewRows.forEach((row) => {
      if (row.error) {
        failures.push(`Row ${row.key}: ${row.error}`);
        return;
      }

      if (row.type === 'Capability') {
        const cap: Capability = {
          id: createId(),
          name: row.name,
          description: row.description || row.name,
          elementType: 'Capability',
          layer: 'Business',
          lifecycleStatus: 'Active',
          lifecycleStartDate: timestamp,
          ownerRole: 'Not Set',
          ownerName: 'Not Set',
          owningUnit: 'Not Set',
          approvalStatus: 'Draft',
          lastReviewedAt: timestamp,
          reviewCycleMonths: 12,
          createdAt: timestamp,
          createdBy: 'bulk-import',
          lastModifiedAt: timestamp,
          lastModifiedBy: 'bulk-import',
          capabilityLevel: (row.capabilityLevel as any) || 'L1',
          parentCapabilityId: row.parentCapabilityId || null,
          businessOutcome: 'Imported via CSV',
          valueStream: '',
          inScope: true,
          impactedByChange: false,
          strategicImportance: 'Medium',
          maturityLevel: 2,
        };
        const res = addElement('capabilities', cap);
        if (!res.ok) failures.push(`Row ${row.key}: ${res.error ?? 'insert failed'}`);
        else successes.push(`Capability ${cap.name}`);
        return;
      }

      if (row.type === 'Application') {
        const app: Application = {
          id: createId(),
          name: row.name,
          description: row.description || row.name,
          elementType: 'Application',
          layer: 'Application',
          lifecycleStatus: 'Active',
          lifecycleStartDate: timestamp,
          ownerRole: 'Not Set',
          ownerName: 'Not Set',
          owningUnit: 'Not Set',
          approvalStatus: 'Draft',
          lastReviewedAt: timestamp,
          reviewCycleMonths: 12,
          createdAt: timestamp,
          createdBy: 'bulk-import',
          lastModifiedAt: timestamp,
          lastModifiedBy: 'bulk-import',
          applicationCode: row.applicationCode || createId(),
          applicationType: 'Custom',
          businessCriticality: 'Medium',
          availabilityTarget: 99,
          deploymentModel: 'Hybrid',
          vendorLockInRisk: 'Medium',
          technicalDebtLevel: 'Medium',
          annualRunCost: 0,
          vendorName: 'Unknown',
        };
        const res = addElement('applications', app);
        if (!res.ok) failures.push(`Row ${row.key}: ${res.error ?? 'insert failed'}`);
        else successes.push(`Application ${app.name}`);
        return;
      }
    });

    if (successes.length) {
      message.success(`Imported ${successes.length} rows.`);
    }
    if (failures.length) {
      message.error(failures.slice(0, 5).join(' | ') + (failures.length > 5 ? ' …' : ''));
    }
  }, [createId, nowIso, previewRows]);

  const hasErrors = React.useMemo(() => previewRows.some((r) => r.error), [previewRows]);

  const columns = [
    { title: 'Type', dataIndex: 'type', key: 'type' },
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Description', dataIndex: 'description', key: 'description' },
    { title: 'Level', dataIndex: 'capabilityLevel', key: 'capabilityLevel' },
    { title: 'Parent Capability', dataIndex: 'parentCapabilityId', key: 'parentCapabilityId' },
    { title: 'App Code', dataIndex: 'applicationCode', key: 'applicationCode' },
    { title: 'Error', dataIndex: 'error', key: 'error', render: (v: string) => v || '' },
  ];

  return (
    <div style={{ height: '100%', padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Workspace
        </Typography.Title>

        {project ? (
          <Card>
            <Space direction="vertical" size={4}>
              <Typography.Text strong>{project.name}</Typography.Text>
              {project.description ? (
                <Typography.Text type="secondary">{project.description}</Typography.Text>
              ) : (
                <Typography.Text type="secondary">No description</Typography.Text>
              )}
              <Typography.Text type="secondary">
                Created: {new Date(project.createdAt).toLocaleString()}
              </Typography.Text>
            </Space>
          </Card>
        ) : null}

        <Card>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Empty
              description={
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>Repository is empty</Typography.Text>
                  <Typography.Text type="secondary">
                    Add elements from the Catalogues panel, or seed a small sample dataset.
                  </Typography.Text>
                </Space>
              }
            />
            <Space>
              <Button type="primary" onClick={seedSampleData}>
                Seed sample data
              </Button>
              <Typography.Text type="secondary">Adds demo capabilities, apps, and a dependency (optional).</Typography.Text>
            </Space>
          </Space>
        </Card>

        <Card title="Bulk import (CSV)">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              Import capabilities and applications from CSV (save Excel as CSV). Columns: type, name, description,
              capabilityLevel, parentCapabilityId, applicationCode. Rows are validated against the metamodel; invalid rows are rejected and shown below.
            </Typography.Paragraph>
            <Upload.Dragger accept=".csv" multiple={false} beforeUpload={handleUpload} showUploadList={false}>
              <p className="ant-upload-drag-icon">📄</p>
              <p className="ant-upload-text">Drag and drop or click to upload a CSV</p>
            </Upload.Dragger>
            {previewRows.length > 0 && (
              <>
                {hasErrors ? (
                  <Alert type="error" message="Some rows are invalid. Fix errors before import." showIcon />
                ) : (
                  <Alert type="info" message="Ready to import" showIcon />
                )}
                <Table
                  size="small"
                  pagination={{ pageSize: 5 }}
                  dataSource={previewRows}
                  columns={columns}
                  scroll={{ x: true }}
                />
                <Space>
                  <Button type="primary" disabled={!previewRows.length || hasErrors} onClick={importRows}>
                    Import rows
                  </Button>
                  <Button onClick={() => setPreviewRows([])}>Clear</Button>
                </Space>
              </>
            )}
          </Space>
        </Card>
      </Space>
    </div>
  );
};

export default WorkspacePage;
