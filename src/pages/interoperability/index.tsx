import React from 'react';

import { useSearchParams } from '@umijs/max';

import { ProCard } from '@ant-design/pro-components';
import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tabs,
  Typography,
  Upload,
  message,
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import * as XLSX from 'xlsx';

import { CSV_IMPORT_SPECS, type CsvSchemaSpec } from '../../../backend/interoperability/csv/CsvImportSpecification';

import ProjectGate from '@/ea/ProjectGate';
import { useEaRepository } from '@/ea/EaRepositoryContext';

import type {
  CsvImportSourceEntity,
  CsvRowError,
} from '../../../backend/interoperability';
import type { ExportScope } from '../../../backend/interoperability/ExportScope';

import { executeCsvImport, exportCsv, validateCsvImport } from '@/services/ea/interoperability';

type SourceType = 'CSV' | 'ArchiMate' | 'ToolSpecific';

const SOURCE_TYPES: { value: SourceType; label: string; disabled?: boolean }[] = [
  { value: 'CSV', label: 'CSV (Strict)' },
  { value: 'ArchiMate', label: 'ArchiMate (Coming soon)', disabled: true },
  { value: 'ToolSpecific', label: 'Tool-Specific (Coming soon)', disabled: true },
];

const CSV_ENTITIES: { value: CsvImportSourceEntity; label: string }[] = [
  { value: 'Capabilities', label: 'Capabilities' },
  { value: 'BusinessProcesses', label: 'Business Processes' },
  { value: 'Applications', label: 'Applications' },
  { value: 'Technologies', label: 'Technologies' },
  { value: 'Programmes', label: 'Programmes' },
  { value: 'Relationships', label: 'Relationships' },
];

const ELEMENT_TYPES = ['Capability', 'BusinessProcess', 'Application', 'Technology', 'Programme'] as const;
const RELATIONSHIP_TYPES = [
  'DECOMPOSES_TO',
  'COMPOSED_OF',
  'REALIZED_BY',
  'REALIZES',
  'TRIGGERS',
  'SERVED_BY',
  'EXPOSES',
  'PROVIDED_BY',
  'USED_BY',
  'USES',
  'INTEGRATES_WITH',
  'CONSUMES',
  'DEPLOYED_ON',
  'IMPACTS',
] as const;

const downloadTextFile = (fileName: string, text: string) => {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const isNonNullable = <T,>(v: T | null | undefined): v is T => v !== null && v !== undefined;

const CsvRowErrorsTable: React.FC<{ errors: CsvRowError[] }> = ({ errors }) => {
  return (
    <Table<CsvRowError>
      size="small"
      rowKey={(r) => `${r.line}:${r.code}:${r.column ?? ''}:${r.message}`}
      dataSource={errors}
      pagination={{ pageSize: 10 }}
      columns={[
        { title: 'Line', dataIndex: 'line', width: 90 },
        { title: 'Code', dataIndex: 'code', width: 220 },
        { title: 'Column', dataIndex: 'column', width: 220 },
        { title: 'Message', dataIndex: 'message' },
      ]}
    />
  );
};

const ImportWizard: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [step, setStep] = React.useState(0);

  const [sourceType, setSourceType] = React.useState<SourceType>('CSV');
  const [csvEntity, setCsvEntity] = React.useState<CsvImportSourceEntity | null>(null);

  const [fileList, setFileList] = React.useState<UploadFile[]>([]);
  const [fileText, setFileText] = React.useState<string>('');
  const [rowsForImport, setRowsForImport] = React.useState<Array<Record<string, unknown>>>([]);
  const [detectedHeaders, setDetectedHeaders] = React.useState<string[]>([]);
  const [previewRows, setPreviewRows] = React.useState<Array<Record<string, unknown>>>([]);
  const [columnMapping, setColumnMapping] = React.useState<Record<string, string | null>>({});

  const [validationErrors, setValidationErrors] = React.useState<CsvRowError[] | null>(null);
  const [validationOkSummary, setValidationOkSummary] = React.useState<
    | {
        importedElementsCount: number;
        importedRelationshipsCount: number;
      }
    | null
  >(null);

  const [validating, setValidating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [acknowledged, setAcknowledged] = React.useState(false);

  const schema: CsvSchemaSpec | null = React.useMemo(() => {
    if (!csvEntity) return null;
    return CSV_IMPORT_SPECS[csvEntity];
  }, [csvEntity]);

  React.useEffect(() => {
    const requested = (searchParams.get('csvEntity') ?? searchParams.get('import') ?? '').trim();
    if (!requested) return;

    const match = CSV_ENTITIES.find((e) => e.value.toLowerCase() === requested.toLowerCase());
    if (!match) return;

    setSourceType('CSV');
    setCsvEntity((prev) => (prev === match.value ? prev : match.value));
  }, [searchParams]);

  React.useEffect(() => {
    // Reset mapping when entity changes.
    setColumnMapping({});
  }, [csvEntity]);

  const reset = React.useCallback(() => {
    setStep(0);
    setSourceType('CSV');
    setCsvEntity(null);
    setFileList([]);
    setFileText('');
    setValidationErrors(null);
    setValidationOkSummary(null);
    setAcknowledged(false);
  }, []);

  const canProceedUpload = sourceType === 'CSV' && Boolean(csvEntity) && fileText.trim().length > 0;
  const missingRequiredMappings = React.useMemo(() => {
    const required = schema?.requiredHeaders ?? [];
    return required.filter((col) => !columnMapping[col]);
  }, [columnMapping, schema]);

  const runValidation = React.useCallback(async () => {
    if (sourceType !== 'CSV' || !csvEntity) return;

    const spec = schema;
    const required = spec?.requiredHeaders ?? [];
    const missingMappings = required.filter((col) => !columnMapping[col]);
    if (missingMappings.length > 0) {
      message.error(`Map required columns first: ${missingMappings.join(', ')}`);
      return;
    }

    const buildMappedCsv = () => {
      if (!spec) return fileText;
      const headers = spec.columns.map((c) => c.name);
      const rows = rowsForImport.length > 0 ? rowsForImport : previewRows;
      const normalized = rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const h of headers) {
          const sourceCol = columnMapping[h];
          out[h] = sourceCol ? (row as any)[sourceCol] ?? '' : '';
        }
        return out;
      });
      const sheet = XLSX.utils.json_to_sheet(normalized, { header: headers });
      return XLSX.utils.sheet_to_csv(sheet, { FS: ',', RS: '\n' });
    };

    try {
      setValidating(true);
      const csvToValidate = buildMappedCsv();
      const resp = await validateCsvImport({
        entity: csvEntity,
        csvText: csvToValidate,
        sourceDescription: fileList[0]?.name,
      });

      const result = resp.data;
      if (!result.ok) {
        setValidationErrors(result.errors);
        setValidationOkSummary(null);
        setAcknowledged(false);
        return;
      }

      setValidationErrors([]);
      setValidationOkSummary({
        importedElementsCount: result.importedElementsCount,
        importedRelationshipsCount: result.importedRelationshipsCount,
      });
      setAcknowledged(false);
    } finally {
      setValidating(false);
    }
  }, [columnMapping, csvEntity, fileList, fileText, previewRows, rowsForImport, schema, sourceType]);

  const confirmImport = React.useCallback(async () => {
    if (sourceType !== 'CSV' || !csvEntity) return;

    const spec = schema;
    const required = spec?.requiredHeaders ?? [];
    const missingMappings = required.filter((col) => !columnMapping[col]);
    if (missingMappings.length > 0) {
      message.error(`Map required columns first: ${missingMappings.join(', ')}`);
      return;
    }

    const buildMappedCsv = () => {
      if (!spec) return fileText;
      const headers = spec.columns.map((c) => c.name);
      const rows = rowsForImport.length > 0 ? rowsForImport : previewRows;
      const normalized = rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const h of headers) {
          const sourceCol = columnMapping[h];
          out[h] = sourceCol ? (row as any)[sourceCol] ?? '' : '';
        }
        return out;
      });
      const sheet = XLSX.utils.json_to_sheet(normalized, { header: headers });
      return XLSX.utils.sheet_to_csv(sheet, { FS: ',', RS: '\n' });
    };

    try {
      setImporting(true);
      const csvToImport = buildMappedCsv();
      const resp = await executeCsvImport({
        entity: csvEntity,
        csvText: csvToImport,
        sourceDescription: fileList[0]?.name,
      });

      const result = resp.data;
      if (!result.ok) {
        setValidationErrors(result.errors);
        setValidationOkSummary(null);
        setStep(2);
        setAcknowledged(false);
        message.error('Import failed. Fix errors and try again.');
        return;
      }

      try {
        window.dispatchEvent(new Event('ea:repositoryChanged'));
        window.dispatchEvent(new Event('ea:relationshipsChanged'));
      } catch {
        // Best-effort only.
      }

      message.success(
        `Imported ${result.importedElementsCount} elements and ${result.importedRelationshipsCount} relationships.`,
      );
      reset();
    } finally {
      setImporting(false);
    }
  }, [columnMapping, csvEntity, fileList, fileText, previewRows, reset, rowsForImport, schema, sourceType]);

  const steps = [
    {
      title: 'Source',
      content: (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Controlled import"
            description="Imports are never executed on upload. You must validate and explicitly confirm."
          />

          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Typography.Text strong>Source type</Typography.Text>
            <Select
              value={sourceType}
              options={SOURCE_TYPES}
              onChange={(v) => setSourceType(v)}
              style={{ maxWidth: 420 }}
            />
          </Space>

          {sourceType !== 'CSV' ? (
            <Alert
              type="warning"
              showIcon
              message="Not implemented"
              description="Only strict CSV imports are implemented right now."
            />
          ) : (
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Typography.Text strong>CSV entity schema</Typography.Text>
              <Select
                placeholder="Select entity type (no guessing)"
                value={csvEntity ?? undefined}
                options={CSV_ENTITIES}
                onChange={(v) => setCsvEntity(v)}
                style={{ maxWidth: 420 }}
              />
              <Typography.Text type="secondary">
                IDs must be explicit. Mandatory headers are enforced. Invalid rows are rejected.
              </Typography.Text>
            </Space>
          )}
        </Space>
      ),
    },
    {
      title: 'Upload',
      content: (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="No auto-import"
            description="Uploading a file does not modify the repository. You will validate first, then confirm."
          />

          <Upload.Dragger
            multiple={false}
            accept=".csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,.xls"
            fileList={fileList}
            beforeUpload={() => false}
            onChange={async (info) => {
              const nextList = info.fileList.slice(-1);
              setFileList(nextList);

              const f = nextList[0]?.originFileObj;
              if (!f) {
                setFileText('');
                return;
              }

              const lower = (f.name || '').toLowerCase();
              const isExcel = lower.endsWith('.xlsx') || lower.endsWith('.xls');

              const textPromise = isExcel
                ? (() => {
                    const reader = new FileReader();
                    return new Promise<string>((resolve, reject) => {
                      reader.onerror = (err) => reject(err);
                      reader.onload = () => {
                        try {
                          const data = reader.result as ArrayBuffer;
                          const workbook = XLSX.read(data, { type: 'array' });
                          const sheetName = workbook.SheetNames[0];
                          if (!sheetName) {
                            reject(new Error('Excel file has no sheets.'));
                            return;
                          }
                          const sheet = workbook.Sheets[sheetName];
                          resolve(XLSX.utils.sheet_to_csv(sheet, { FS: ',', RS: '\n' }));
                        } catch (e) {
                          reject(e instanceof Error ? e : new Error('Failed to parse Excel file.'));
                        }
                      };
                      reader.readAsArrayBuffer(f as File);
                    });
                  })()
                : f.text();

              try {
                const csvText = await textPromise;
                setFileText(csvText);

                // Build preview + headers for mapping.
                const workbook = XLSX.read(csvText, { type: 'string' });
                const sheetName = workbook.SheetNames[0];
                if (!sheetName) throw new Error('Parsed file has no sheets.');
                const sheet = workbook.Sheets[sheetName];

                const matrix = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' });
                const headerRow = (matrix[0] ?? []).map((v) => String(v).trim());
                const rows = (matrix.slice(1) ?? []).map((r) => {
                  const obj: Record<string, unknown> = {};
                  headerRow.forEach((h, idx) => {
                    obj[h] = r[idx];
                  });
                  return obj;
                });

                setDetectedHeaders(headerRow);
                setRowsForImport(rows);
                setPreviewRows(rows.slice(0, 20));

                if (schema) {
                  const autoMap: Record<string, string | null> = {};
                  for (const col of schema.columns.map((c) => c.name)) {
                    const hit = headerRow.find((h) => h.toLowerCase() === col.toLowerCase());
                    autoMap[col] = hit ?? null;
                  }
                  setColumnMapping((prev) => ({ ...autoMap, ...prev }));
                }
              } catch (err) {
                message.error(err instanceof Error ? err.message : 'Failed to read file.');
                setFileText('');
                setDetectedHeaders([]);
                setRowsForImport([]);
                setPreviewRows([]);
                return;
              }

              // Reset any previous validation.
              setValidationErrors(null);
              setValidationOkSummary(null);
              setAcknowledged(false);
            }}
          >
            <p style={{ margin: 0, fontWeight: 600 }}>Drop CSV/XLSX here, or click to select</p>
            <p style={{ margin: 0, color: 'rgba(0,0,0,0.45)' }}>Strict headers. Explicit IDs. No auto-fix.</p>
          </Upload.Dragger>

          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Typography.Text strong>Preview</Typography.Text>
            {previewRows.length > 0 ? (
              <Table
                size="small"
                pagination={{ pageSize: 5 }}
                scroll={{ x: true }}
                dataSource={previewRows.map((r, idx) => ({ key: idx, ...r }))}
                columns={detectedHeaders.map((h) => ({ title: h || '(blank)', dataIndex: h || `col${h}`, key: h || `col${h}` }))}
              />
            ) : (
              <Input.TextArea
                value={fileText ? fileText.slice(0, 2000) : ''}
                placeholder="File preview will appear here"
                autoSize={{ minRows: 4, maxRows: 10 }}
                readOnly
              />
            )}
            <Typography.Text type="secondary">
              {previewRows.length > 0 ? 'Showing first 20 rows.' : 'Preview is truncated to 2000 characters.'}
            </Typography.Text>
          </Space>

          {schema ? (
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Typography.Text strong>Map columns → attributes</Typography.Text>
              <Table
                size="small"
                pagination={false}
                dataSource={schema.columns.map((c) => ({ ...c, key: c.name }))}
                columns={[
                  { title: 'Attribute', dataIndex: 'name', key: 'name' },
                  { title: 'Required', dataIndex: 'requiredHeader', key: 'required', render: (v) => (v ? 'Yes' : 'No') },
                  {
                    title: 'Source column',
                    key: 'source',
                    render: (_: any, record: { name: string; requiredHeader: boolean }) => (
                      <Select
                        showSearch
                        allowClear
                        placeholder="Select column"
                        value={columnMapping[record.name] ?? undefined}
                        options={detectedHeaders.map((h) => ({ value: h, label: h || '(blank)' }))}
                        onChange={(v) => setColumnMapping((prev) => ({ ...prev, [record.name]: v ?? null }))}
                        style={{ minWidth: 220 }}
                      />
                    ),
                  },
                ]}
              />
            </Space>
          ) : null}
        </Space>
      ),
    },
    {
      title: 'Review',
      content: (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Validation results"
            description="Fix all errors before confirming. No partial commits are allowed."
          />

          {validationErrors === null ? (
            <Alert
              type="warning"
              showIcon
              message="Not validated yet"
              description="Click Validate to run strict schema checks."
            />
          ) : validationErrors.length > 0 ? (
            <>
              <Alert
                type="error"
                showIcon
                message={`Validation failed (${validationErrors.length} errors)`}
                description="Nothing has been imported. Correct the CSV and validate again."
              />
              <Button
                size="small"
                onClick={() => {
                  if (!validationErrors || validationErrors.length === 0) return;
                  const rows = validationErrors.map((e) => ({
                    line: e.line,
                    code: e.code,
                    column: e.column ?? '',
                    message: e.message,
                    value: e.value ?? '',
                  }));
                  const sheet = XLSX.utils.json_to_sheet(rows, { header: ['line', 'code', 'column', 'message', 'value'] });
                  const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ',', RS: '\n' });
                  downloadTextFile('import-errors.csv', csv);
                }}
              >
                Download error report (CSV)
              </Button>
              <CsvRowErrorsTable errors={validationErrors} />
            </>
          ) : (
            <Alert
              type="success"
              showIcon
              message="Validation passed"
              description={
                validationOkSummary
                  ? `Would import ${validationOkSummary.importedElementsCount} elements and ${validationOkSummary.importedRelationshipsCount} relationships.`
                  : 'Ready to confirm.'
              }
            />
          )}
        </Space>
      ),
    },
    {
      title: 'Confirm',
      content: (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="Explicit confirmation required"
            description="This step will modify the in-memory repository. This action cannot be undone (without re-import)."
          />

          <ProCard bordered>
            <Space direction="vertical" size={6}>
              <Typography.Text strong>Import summary</Typography.Text>
              <Typography.Text type="secondary">Source: {sourceType}</Typography.Text>
              <Typography.Text type="secondary">Entity: {csvEntity ?? '—'}</Typography.Text>
              <Typography.Text type="secondary">File: {fileList[0]?.name ?? '—'}</Typography.Text>
            </Space>
          </ProCard>

          <Checkbox checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)}>
            I understand this will change the repository.
          </Checkbox>

          <Button
            type="primary"
            danger
            onClick={() => {
              Modal.confirm({
                title: 'Confirm import',
                content:
                  'This will apply the validated CSV data to the current in-memory repository. This action is not reversible without another import.',
                okText: 'Import',
                okButtonProps: { danger: true },
                cancelText: 'Cancel',
                onOk: async () => {
                  await confirmImport();
                },
              });
            }}
            disabled={
              !acknowledged || validationErrors === null || (validationErrors?.length ?? 0) > 0
            }
            loading={importing}
          >
            Confirm and Import
          </Button>
        </Space>
      ),
    },
  ] as const;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Steps current={step} items={steps.map((s) => ({ title: s.title }))} />

      <div>{steps[step]?.content}</div>

      <Divider style={{ margin: '12px 0' }} />

      <Flex justify="space-between" gap={8} wrap>
        <Space>
          <Button onClick={reset}>Reset</Button>
        </Space>

        <Space>
          <Button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Back
          </Button>

          {step === 0 ? (
            <Button
              type="primary"
              onClick={() => setStep(1)}
              disabled={sourceType !== 'CSV' || !csvEntity}
            >
              Next
            </Button>
          ) : null}

          {step === 1 ? (
            <Button
              type="primary"
              onClick={() => setStep(2)}
              disabled={!canProceedUpload || (schema ? missingRequiredMappings.length > 0 : false)}
            >
              Next
            </Button>
          ) : null}

          {step === 2 ? (
            <Space>
              <Button
                onClick={runValidation}
                disabled={sourceType !== 'CSV' || !csvEntity || fileText.trim().length === 0}
                loading={validating}
              >
                Validate
              </Button>
              <Button
                type="primary"
                onClick={() => setStep(3)}
                disabled={validationErrors === null || (validationErrors?.length ?? 0) > 0}
              >
                Next
              </Button>
            </Space>
          ) : null}

          {step === 3 ? (
            <Button
              type="primary"
              onClick={() => message.info('Click “Confirm and Import” to apply changes.')}
            >
              Done
            </Button>
          ) : null}
        </Space>
      </Flex>
    </Space>
  );
};

const ExportWizard: React.FC = () => {
  const { metadata } = useEaRepository();
  const [step, setStep] = React.useState(0);

  const [exportType, setExportType] = React.useState<ExportScope['exportType'] | null>(null);
  const [includedElementTypes, setIncludedElementTypes] = React.useState<string[]>([]);
  const [includedRelationshipTypes, setIncludedRelationshipTypes] = React.useState<string[]>([]);
  const [includeViews, setIncludeViews] = React.useState(false);
  const [includeGovernanceArtifacts, setIncludeGovernanceArtifacts] = React.useState(false);

  const [format, setFormat] = React.useState<'CSV' | 'ComingSoon'>('CSV');

  type ExportFile = { fileName: string; csvText: string };
  type ExportFiles = Partial<Record<CsvImportSourceEntity, ExportFile>>;

  const [exportResult, setExportResult] = React.useState<
    | {
        files: ExportFiles;
        warnings: string[];
        exportedElementsCount: number;
        exportedRelationshipsCount: number;
      }
    | null
  >(null);

  const safeSlug = React.useCallback(
    (value: string) =>
      (value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'export',
    [],
  );

  const [exportErrors, setExportErrors] = React.useState<string[] | null>(null);
  const [exporting, setExporting] = React.useState(false);

  const reset = React.useCallback(() => {
    setStep(0);
    setExportType(null);
    setIncludedElementTypes([]);
    setIncludedRelationshipTypes([]);
    setIncludeViews(false);
    setIncludeGovernanceArtifacts(false);
    setFormat('CSV');
    setExportResult(null);
    setExportErrors(null);
  }, []);

  const scope: ExportScope | null = React.useMemo(() => {
    if (!exportType) return null;
    return {
      exportType,
      includedElementTypes,
      includedRelationshipTypes,
      includeViews,
      includeGovernanceArtifacts,
    };
  }, [exportType, includeGovernanceArtifacts, includeViews, includedElementTypes, includedRelationshipTypes]);

  const buildExportMeta = React.useCallback(
    () => ({
      kind: 'ea-export-metadata' as const,
      exportedAt: new Date().toISOString(),
      repositoryName: metadata?.repositoryName ?? null,
      scope,
      format,
    }),
    [format, metadata?.repositoryName, scope],
  );

  const validateScope = React.useCallback((): string[] => {
    const errors: string[] = [];
    if (!exportType) errors.push('Select exportType.');
    // No defaults assumed: user must explicitly pick at least one element type to export repository contents meaningfully.
    if (includedElementTypes.length === 0) errors.push('Select at least one element type.');
    return errors;
  }, [exportType, includedElementTypes.length]);

  const generateExport = React.useCallback(async () => {
    if (!scope) return;

    const errors = validateScope();
    if (errors.length > 0) {
      message.error(errors[0]);
      return;
    }

    if (format !== 'CSV') {
      message.error('Only CSV export is implemented right now.');
      return;
    }

    try {
      setExporting(true);
      const resp = await exportCsv(scope);
      const result = resp.data;

      if (!result.ok) {
        setExportResult(null);
        setExportErrors(result.errors);
        message.error('Export failed. Review errors.');
        return;
      }

      setExportErrors(null);
      setExportResult({
        files: result.files,
        warnings: result.warnings,
        exportedElementsCount: result.exportedElementsCount,
        exportedRelationshipsCount: result.exportedRelationshipsCount,
      });
    } finally {
      setExporting(false);
    }
  }, [format, scope, validateScope]);

  const steps = [
    {
      title: 'Scope',
      content: (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Controlled export"
            description="Exports require an explicit scope. No defaults are assumed."
          />

          <Form layout="vertical" style={{ maxWidth: 720 }}>
            <Form.Item label="Export type" required>
              <Select
                placeholder="Select export type"
                value={exportType ?? undefined}
                onChange={(v) => setExportType(v)}
                options={[
                  { value: 'Repository', label: 'Repository' },
                  { value: 'View', label: 'View (not CSV-ready)', disabled: true },
                  { value: 'Analysis', label: 'Analysis (not CSV-ready)', disabled: true },
                  { value: 'FullProject', label: 'Full Repository' },
                ]}
              />
            </Form.Item>

            <Form.Item label="Included element types" required>
              <Select
                mode="multiple"
                placeholder="Select element types"
                value={includedElementTypes}
                onChange={(v) => setIncludedElementTypes(v)}
                options={ELEMENT_TYPES.map((t) => ({ value: t, label: t }))}
              />
            </Form.Item>

            <Form.Item label="Included relationship types">
              <Select
                mode="multiple"
                placeholder="Select relationship types"
                value={includedRelationshipTypes}
                onChange={(v) => setIncludedRelationshipTypes(v)}
                options={RELATIONSHIP_TYPES.map((t) => ({ value: t, label: t }))}
              />
            </Form.Item>

            <Form.Item>
              <Space>
                <Switch checked={includeViews} onChange={setIncludeViews} />
                <Typography.Text>Include view definitions</Typography.Text>
              </Space>
            </Form.Item>

            <Form.Item>
              <Space>
                <Switch checked={includeGovernanceArtifacts} onChange={setIncludeGovernanceArtifacts} />
                <Typography.Text>Include governance artifacts (rules, ADRs)</Typography.Text>
              </Space>
            </Form.Item>
          </Form>
        </Space>
      ),
    },
    {
      title: 'Format',
      content: (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="No hidden conversions"
            description="Format selection is explicit. Only CSV (strict, round-trippable) is implemented right now."
          />

          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Typography.Text strong>Export format</Typography.Text>
            <Select
              value={format}
              onChange={(v) => setFormat(v)}
              style={{ maxWidth: 420 }}
              options={[
                { value: 'CSV', label: 'CSV (Import-compatible)' },
                { value: 'ComingSoon', label: 'Other formats (Coming soon)', disabled: true },
              ]}
            />
          </Space>
        </Space>
      ),
    },
    {
      title: 'Review',
      content: (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Review contents"
            description="Generate the export to preview files and verify scope."
          />

          <Button type="primary" onClick={generateExport} disabled={!scope} loading={exporting}>
            Generate Export
          </Button>

          {exportErrors && exportErrors.length > 0 ? (
            <Alert
              type="error"
              showIcon
              message={`Export failed (${exportErrors.length} errors)`}
              description={
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {exportErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              }
            />
          ) : null}

          {exportResult ? (
            <>
              {exportResult.warnings.length > 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  message="Warnings"
                  description={
                    <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                      {exportResult.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  }
                />
              ) : null}

              <ProCard bordered>
                <Space direction="vertical" size={6}>
                  <Typography.Text strong>Summary</Typography.Text>
                  <Typography.Text type="secondary">
                    Elements: {exportResult.exportedElementsCount} | Relationships: {exportResult.exportedRelationshipsCount}
                  </Typography.Text>

                  <Divider style={{ margin: '8px 0' }} />

                  <Typography.Text strong>Files</Typography.Text>
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    {(Object.entries(exportResult.files) as Array<
                      [CsvImportSourceEntity, ExportFiles[CsvImportSourceEntity]]
                    >)
                      .filter(
                        (entry): entry is [CsvImportSourceEntity, ExportFile] => isNonNullable(entry[1]),
                      )
                      .map(([entity, file]) => {
                        const lineCount = file.csvText.trim().length
                          ? file.csvText.trim().split('\n').length - 1
                          : 0;
                        return (
                          <ProCard key={entity} size="small" bordered>
                            <Space direction="vertical" size={4} style={{ width: '100%' }}>
                              <Typography.Text strong>
                                {file.fileName} <Typography.Text type="secondary">({lineCount} rows)</Typography.Text>
                              </Typography.Text>
                              <Input.TextArea
                                value={file.csvText.slice(0, 2000)}
                                autoSize={{ minRows: 3, maxRows: 8 }}
                                readOnly
                              />
                              <Typography.Text type="secondary">Preview is truncated to 2000 characters.</Typography.Text>
                            </Space>
                          </ProCard>
                        );
                      })}
                  </Space>
                </Space>
              </ProCard>
            </>
          ) : null}
        </Space>
      ),
    },
    {
      title: 'Download',
      content: (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="Explicit download"
            description="Downloads are explicit per file. Nothing is exported automatically."
          />

          {!exportResult ? (
            <Alert
              type="info"
              showIcon
              message="No export generated"
              description="Go back and generate the export first."
            />
          ) : (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {(Object.entries(exportResult.files) as Array<
                [CsvImportSourceEntity, ExportFiles[CsvImportSourceEntity]]
              >)
                .filter((entry): entry is [CsvImportSourceEntity, ExportFile] => isNonNullable(entry[1]))
                .map(([entity, file]) => {
                  return (
                    <Flex key={entity} align="center" justify="space-between" gap={12} wrap>
                      <Typography.Text>{file.fileName}</Typography.Text>
                      <Button
                        onClick={() => {
                          const repo = metadata?.repositoryName ? safeSlug(metadata.repositoryName) : '';
                          const prefix = repo ? `${repo}-` : '';
                          downloadTextFile(`${prefix}${file.fileName}`, file.csvText);
                        }}
                      >
                        Download
                      </Button>
                    </Flex>
                  );
                })}

              <Divider style={{ margin: '8px 0' }} />

              <Flex align="center" justify="space-between" gap={12} wrap>
                <Typography.Text>export-metadata.json</Typography.Text>
                <Button
                  onClick={() => {
                    const repo = metadata?.repositoryName ? safeSlug(metadata.repositoryName) : '';
                    const prefix = repo ? `${repo}-` : '';
                    downloadTextFile(`${prefix}export-metadata.json`, JSON.stringify(buildExportMeta(), null, 2));
                  }}
                >
                  Download
                </Button>
              </Flex>

              <Divider style={{ margin: '8px 0' }} />
              <Typography.Text type="secondary">
                Tip: re-import these CSVs using the Import Wizard to validate round-trip safety.
              </Typography.Text>
            </Space>
          )}
        </Space>
      ),
    },
  ] as const;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Steps current={step} items={steps.map((s) => ({ title: s.title }))} />
      <div>{steps[step]?.content}</div>

      <Divider style={{ margin: '12px 0' }} />

      <Flex justify="space-between" gap={8} wrap>
        <Button onClick={reset}>Reset</Button>

        <Space>
          <Button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Back
          </Button>
          <Button
            type="primary"
            onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
            disabled={step === 0 ? validateScope().length > 0 : false}
          >
            Next
          </Button>
        </Space>
      </Flex>
    </Space>
  );
};

const InteroperabilityPage: React.FC = () => {
  return (
    <div style={{ height: '100%', padding: 16 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space direction="vertical" size={0}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Import / Export
          </Typography.Title>
          <Typography.Text type="secondary">
            Controlled, deterministic, loss-aware data exchange.
          </Typography.Text>
        </Space>

        <ProjectGate
          shell={
            <Tabs
              items={[
                {
                  key: 'import',
                  label: 'Import Wizard',
                  children: <ImportWizard />,
                },
                {
                  key: 'export',
                  label: 'Export Wizard',
                  children: <ExportWizard />,
                },
              ]}
            />
          }
        >
          <Alert
            type="warning"
            showIcon
            message="No repository created"
            description={
              <Space direction="vertical" size={8}>
                <Typography.Text>
                  Create a repository first to enable import/export.
                </Typography.Text>
                <Button type="primary" href="/project/create">
                  Create Repository
                </Button>
              </Space>
            }
          />
        </ProjectGate>
      </Space>
    </div>
  );
};

export default InteroperabilityPage;
