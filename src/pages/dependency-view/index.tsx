import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from '@umijs/max';
import { Alert, Tag } from 'antd';
import GraphView from './components/GraphView';
import ApplicationSidePanel, {
  type ApplicationMetadata,
  type DatasetInfo,
  type DependencyMetadata,
  type ImpactSummary,
  type RankedImpactItem,
} from './components/ApplicationSidePanel';
import { computeImpactPaths } from './utils/computeImpactPaths';
import { computeImpactSeverity } from '@/utils/impactSeverity';
import { parseAndValidateApplicationsCsv } from './utils/parseApplicationsCsv';
import { parseAndValidateDependenciesCsv } from './utils/parseDependenciesCsv';
import { buildImpactSummaryCsv } from './utils/buildImpactSummaryCsv';
import { buildRankedImpactsCsv } from './utils/buildRankedImpactsCsv';
import { useEaRepository } from '@/ea/EaRepositoryContext';
import { applyEaImportBatch } from './utils/eaImportUtils';
import { parseAndValidateCapabilitiesCsv } from './utils/parseCapabilitiesCsv';
import { parseAndValidateTechnologyCsv } from './utils/parseTechnologyCsv';
import { parseAndValidateApplicationTechnologyCsv } from './utils/parseApplicationTechnologyCsv';
import { parseAndValidateApplicationStructureCsv } from './utils/parseApplicationStructureCsv';
import { parseAndValidateProgrammesCsv } from './utils/parseProgrammesCsv';
import { parseAndValidateProgrammeMappingsCsv } from './utils/parseProgrammeMappingsCsv';
import { EA_VIEW_BY_ID, type EaViewId } from './utils/eaViewDefinitions';
import { getTimeHorizonWindow } from '@/repository/timeHorizonPolicy';

type DependencyEdge = {
  from: string;
  to: string;
  dependencyStrength: 'hard' | 'soft';
  dependencyType?: string;
};

const isApplicationDependencyRelationship = (type: unknown): type is 'INTEGRATES_WITH' => type === 'INTEGRATES_WITH';

const DependencyView: React.FC = () => {
  const location = useLocation();

  const DIAGRAMS_ENABLED = false;
  const [catalogDefined, setCatalogDefined] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ea.catalogDefined') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onDefined = () => {
      try {
        setCatalogDefined(localStorage.getItem('ea.catalogDefined') === 'true');
      } catch {
        setCatalogDefined(false);
      }
    };
    window.addEventListener('ea:catalogDefined', onDefined as EventListener);
    return () => window.removeEventListener('ea:catalogDefined', onDefined as EventListener);
  }, []);

  const selectedViewId = useMemo<EaViewId>(() => {
    const path = location.pathname;
    if (path.startsWith('/diagrams/capability-map')) return 'capability-map';
    if (path.startsWith('/diagrams/application-technology')) return 'technology-hosting';
    if (path.startsWith('/diagrams/application-dependency')) return 'application-dependency-impact';
    if (path.startsWith('/diagrams/technology-landscape')) return 'technology-hosting';
    if (path.startsWith('/diagrams/application-landscape')) return 'application-landscape';
    return 'application-dependency-impact';
  }, [location.pathname]);

  const { eaRepository, metadata, setEaRepository, trySetEaRepository } = useEaRepository();
  if (!eaRepository) return null;

  const timeHorizon = metadata?.timeHorizon;
  const horizonWindow = useMemo(() => getTimeHorizonWindow(timeHorizon), [timeHorizon]);

  const architectureScope = metadata?.architectureScope ?? null;
  const canImportCapabilities = architectureScope !== 'Programme';
  const canImportProgrammes = architectureScope !== 'Domain';

  const dependencies = useMemo<DependencyEdge[]>(() => {
    const toStrength = (value: unknown): DependencyEdge['dependencyStrength'] =>
      value === 'hard' || value === 'soft' ? value : 'soft';

    const toType = (value: unknown): DependencyEdge['dependencyType'] =>
      typeof value === 'string' && value.trim() ? (value as DependencyEdge['dependencyType']) : undefined;

    const edges: DependencyEdge[] = [];
    for (const rel of eaRepository.relationships) {
      if (!isApplicationDependencyRelationship(rel.type)) continue;
      edges.push({
        from: rel.fromId,
        to: rel.toId,
        dependencyStrength: toStrength(rel.attributes?.dependencyStrength),
        dependencyType: toType(rel.attributes?.dependencyType),
      });
    }
    return edges;
  }, [eaRepository]);


  const applications = useMemo(() => {
    const toLifecycle = (value: unknown): ApplicationMetadata['lifecycle'] => {
      if (value === 'planned' || value === 'active' || value === 'deprecated') return value;
      return 'active';
    };

    const toCriticality = (value: unknown): ApplicationMetadata['criticality'] => {
      if (value === 'high' || value === 'medium' || value === 'low') return value;
      return 'low';
    };

    const results: ApplicationMetadata[] = [];
    for (const obj of eaRepository.objects.values()) {
      if (obj.type !== 'Application') continue;

      const name = typeof obj.attributes.name === 'string' && obj.attributes.name.trim() ? obj.attributes.name : obj.id;

      results.push({
        id: obj.id,
        name,
        criticality: toCriticality(obj.attributes.criticality),
        lifecycle: toLifecycle(obj.attributes.lifecycle),
      });
    }

    results.sort((a, b) => a.id.localeCompare(b.id));
    return results;
  }, [eaRepository]);

  const [eaImportErrors, setEaImportErrors] = useState<string[]>([]);
  const [eaImportStatus, setEaImportStatus] = useState<string>('');

  const capabilitiesCsvInputRef = useRef<HTMLInputElement | null>(null);
  const applicationsEaCsvInputRef = useRef<HTMLInputElement | null>(null);
  const appDependenciesEaCsvInputRef = useRef<HTMLInputElement | null>(null);
  const technologyCsvInputRef = useRef<HTMLInputElement | null>(null);
  const applicationTechnologyCsvInputRef = useRef<HTMLInputElement | null>(null);
  const applicationStructureCsvInputRef = useRef<HTMLInputElement | null>(null);
  const programmesCsvInputRef = useRef<HTMLInputElement | null>(null);
  const programmeMappingsCsvInputRef = useRef<HTMLInputElement | null>(null);

  const [graphViewMode, setGraphViewMode] = useState<'landscape' | 'impact'>('landscape');

  const [datasetInfo, setDatasetInfo] = useState<DatasetInfo>(() => ({
    source: 'Repository',
    applicationCount: Array.from(eaRepository.objects.values()).filter((o) => o.type === 'Application').length,
    dependencyCount: eaRepository.relationships.filter((r) => isApplicationDependencyRelationship(r.type)).length,
    loadedAt: Date.now(),
  }));

  const [applicationsCsvErrors, setApplicationsCsvErrors] = useState<string[]>([]);
  const applicationsCsvInputRef = useRef<HTMLInputElement | null>(null);

  const [dependenciesCsvErrors, setDependenciesCsvErrors] = useState<string[]>([]);
  const dependenciesCsvInputRef = useRef<HTMLInputElement | null>(null);

  const [depth, setDepth] = useState<1 | 2 | 3>(1);
  const [selectedApplication, setSelectedApplication] = useState<ApplicationMetadata | undefined>(undefined);
  const [selectedDependency, setSelectedDependency] = useState<DependencyMetadata | undefined>(undefined);
  const [impactSummary, setImpactSummary] = useState<ImpactSummary | undefined>(undefined);
  const [impactPaths, setImpactPaths] = useState<string[][]>([]);
  const [rankedImpacts, setRankedImpacts] = useState<RankedImpactItem[]>([]);

  const applicationById = useMemo(
    () => new Map(applications.map((a) => [a.id, a] as const)),
    [applications],
  );

  const viewDefinition = useMemo(() => EA_VIEW_BY_ID[selectedViewId], [selectedViewId]);

  const applicationIdSet = useMemo(
    () => new Set<string>(applications.map((a) => a.id)),
    [applications],
  );

  const onLoadApplicationsCsvClick = () => {
    applicationsCsvInputRef.current?.click();
  };

  const onLoadDependenciesCsvClick = () => {
    dependenciesCsvInputRef.current?.click();
  };

  useEffect(() => {
    setGraphViewMode('landscape');
    setDepth(1);
    setSelectedApplication(undefined);
    setSelectedDependency(undefined);
    setImpactSummary(undefined);
    setImpactPaths([]);
    setRankedImpacts([]);
  }, [selectedViewId]);

  const onImportCapabilitiesCsvClick = () => {
    if (!canImportCapabilities) return;
    capabilitiesCsvInputRef.current?.click();
  };

  const onImportApplicationsEaCsvClick = () => {
    applicationsEaCsvInputRef.current?.click();
  };

  const onImportApplicationDependenciesEaCsvClick = () => {
    appDependenciesEaCsvInputRef.current?.click();
  };

  const onImportTechnologyCsvClick = () => {
    technologyCsvInputRef.current?.click();
  };

  const onImportApplicationTechnologyCsvClick = () => {
    applicationTechnologyCsvInputRef.current?.click();
  };

  const onImportApplicationStructureCsvClick = () => {
    applicationStructureCsvInputRef.current?.click();
  };

  const onImportProgrammesCsvClick = () => {
    if (!canImportProgrammes) return;
    programmesCsvInputRef.current?.click();
  };

  const onImportProgrammeMappingsCsvClick = () => {
    if (!canImportProgrammes) return;
    programmeMappingsCsvInputRef.current?.click();
  };

  const setEaImportFailure = (label: string, errors: string[]) => {
    setEaImportStatus(`${label}: validation failed`);
    setEaImportErrors(errors);
  };

  const setEaImportSuccess = (label: string, message?: string) => {
    setEaImportStatus(message ? `${label}: ${message}` : `${label}: imported`);
    setEaImportErrors([]);
  };

  const onCapabilitiesCsvSelected: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const result = parseAndValidateCapabilitiesCsv(text, { repository: eaRepository });
      if (!result.ok) {
        setEaImportFailure('Import Capabilities CSV', result.errors);
        return;
      }

      const objects = result.capabilities.map((c) => ({
        id: c.id,
        type: c.type,
        attributes: { name: c.name, category: c.category, ...c.attributes },
      }));

      const relationships = result.capabilities
        .filter((c) => Boolean(c.parentId))
        .map((c) => ({
          fromId: c.parentId!,
          toId: c.id,
          type: 'DECOMPOSES_TO' as const,
          attributes: {},
        }));

      const applyResult = applyEaImportBatch(eaRepository, { objects, relationships });
      if (!applyResult.ok) {
        setEaImportFailure('Import Capabilities CSV', applyResult.errors);
        return;
      }

      const applied = trySetEaRepository(applyResult.nextRepository);
      if (!applied.ok) {
        setEaImportFailure('Import Capabilities CSV', [applied.error]);
        return;
      }
      setEaImportSuccess('Import Capabilities CSV', `imported ${objects.length} objects`);
    } catch (err) {
      setEaImportFailure('Import Capabilities CSV', [
        `Failed to read or parse CSV: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
  };

  const onApplicationsEaCsvSelected: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const result = parseAndValidateApplicationsCsv(text);
      if (!result.ok) {
        setEaImportFailure('Import Applications CSV', result.errors);
        return;
      }

      const nextApplicationIdSet = new Set(result.applications.map((a) => a.id));

      const draft = eaRepository.clone();

      for (const [id, obj] of draft.objects) {
        if (obj.type === 'Application') draft.objects.delete(id);
      }

      const errors: string[] = [];
      for (const row of result.applications) {
        const res = draft.addObject({
          id: row.id,
          type: 'Application',
          attributes: { name: row.name, criticality: row.criticality, lifecycle: row.lifecycle },
        });
        if (!res.ok) errors.push(res.error);
      }

      // Drop relationships that would become dangling after replacing Applications.
      draft.relationships = draft.relationships.filter(
        (r) => draft.objects.has(r.fromId) && draft.objects.has(r.toId),
      );

      if (errors.length > 0) {
        setEaImportFailure('Import Applications CSV', errors);
        return;
      }

      const applied = trySetEaRepository(draft);
      if (!applied.ok) {
        setEaImportFailure('Import Applications CSV', [applied.error]);
        return;
      }
      setGraphViewMode('landscape');
      const dependencyCount = draft.relationships.filter((r) => isApplicationDependencyRelationship(r.type)).length;
      setDatasetInfo({
        source: 'CSV',
        applicationCount: nextApplicationIdSet.size,
        dependencyCount,
        loadedAt: Date.now(),
      });
      setEaImportSuccess('Import Applications CSV', `imported ${nextApplicationIdSet.size} applications`);
    } catch (err) {
      setEaImportFailure('Import Applications CSV', [
        `Failed to read or parse CSV: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
  };

  const onApplicationDependenciesEaCsvSelected: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    // Validate references against the EA repository's Application objects.
    const existingApplicationIds = new Set<string>();
    for (const obj of eaRepository.objects.values()) {
      if (obj.type === 'Application') existingApplicationIds.add(obj.id);
    }

    if (existingApplicationIds.size === 0) {
      setEaImportFailure('Import Application Dependencies CSV', [
        'Cannot import application dependencies: no Application objects exist in the EA repository.',
      ]);
      return;
    }

    try {
      const text = await file.text();
      const result = parseAndValidateDependenciesCsv(text, { existingApplicationIds });
      if (!result.ok) {
        setEaImportFailure('Import Application Dependencies CSV', result.errors);
        return;
      }

      const relationships = result.dependencies.map((d) => ({
        fromId: d.from,
        toId: d.to,
        type: 'INTEGRATES_WITH' as const,
        attributes: { dependencyStrength: d.dependencyStrength, dependencyType: d.dependencyType },
      }));

      const applyResult = applyEaImportBatch(eaRepository, { relationships });
      if (!applyResult.ok) {
        setEaImportFailure('Import Application Dependencies CSV', applyResult.errors);
        return;
      }

      const applied = trySetEaRepository(applyResult.nextRepository);
      if (!applied.ok) {
        setEaImportFailure('Import Application Dependencies CSV', [applied.error]);
        return;
      }

      setGraphViewMode('landscape');
      setDatasetInfo({
        source: 'CSV',
        applicationCount: Array.from(applyResult.nextRepository.objects.values()).filter((o) => o.type === 'Application').length,
        dependencyCount: applyResult.nextRepository.relationships.filter((r) => isApplicationDependencyRelationship(r.type)).length,
        loadedAt: Date.now(),
      });

      setEaImportSuccess(
        'Import Application Dependencies CSV',
        `imported ${relationships.length} relationships`,
      );
    } catch (err) {
      setEaImportFailure('Import Application Dependencies CSV', [
        `Failed to read or parse CSV: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
  };

  const onTechnologyCsvSelected: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const result = parseAndValidateTechnologyCsv(text);
      if (!result.ok) {
        setEaImportFailure('Import Technology CSV', result.errors);
        return;
      }

      const objects = result.technologies.map((t) => ({
        id: t.id,
        type: 'Technology' as const,
        attributes: { name: t.name, ...t.attributes },
      }));

      const applyResult = applyEaImportBatch(eaRepository, { objects });
      if (!applyResult.ok) {
        setEaImportFailure('Import Technology CSV', applyResult.errors);
        return;
      }

      const applied = trySetEaRepository(applyResult.nextRepository);
      if (!applied.ok) {
        setEaImportFailure('Import Technology CSV', [applied.error]);
        return;
      }
      setEaImportSuccess('Import Technology CSV', `imported ${objects.length} objects`);
    } catch (err) {
      setEaImportFailure('Import Technology CSV', [
        `Failed to read or parse CSV: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
  };

  const onApplicationTechnologyCsvSelected: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const result = parseAndValidateApplicationTechnologyCsv(text);
      if (!result.ok) {
        setEaImportFailure('Import Application–Technology CSV', result.errors);
        return;
      }

      const relationships = result.mappings.map((m) => ({
        fromId: m.applicationId,
        toId: m.technologyId,
        type: 'DEPLOYED_ON' as const,
        attributes: { ...m.attributes },
      }));

      const applyResult = applyEaImportBatch(eaRepository, { relationships });
      if (!applyResult.ok) {
        setEaImportFailure('Import Application–Technology CSV', applyResult.errors);
        return;
      }

      const applied = trySetEaRepository(applyResult.nextRepository);
      if (!applied.ok) {
        setEaImportFailure('Import Application–Technology CSV', [applied.error]);
        return;
      }
      setEaImportSuccess('Import Application–Technology CSV', `imported ${relationships.length} relationships`);
    } catch (err) {
      setEaImportFailure('Import Application–Technology CSV', [
        `Failed to read or parse CSV: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
  };

  const onApplicationStructureCsvSelected: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const toSlug = (value: string) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    const toDepartmentId = (departmentName: string) => {
      const slug = toSlug(departmentName);
      return slug ? `dept_${slug}` : '';
    };

    try {
      const text = await file.text();
      const result = parseAndValidateApplicationStructureCsv(text, { sourceLabel: file.name });
      if (!result.ok) {
        setEaImportFailure('Import Application Structure CSV', result.errors);
        return;
      }

      const importedAt = new Date().toISOString();

      const objects: { id: string; type: 'Department' | 'Application'; attributes: Record<string, unknown> }[] = [];
      const relationships: {
        fromId: string;
        toId: string;
        type: 'OWNS';
        attributes: Record<string, unknown>;
      }[] = [];

      const seenNewObjects = new Set<string>();
      for (let i = 0; i < result.rows.length; i += 1) {
        const row = result.rows[i];
        const displayRow = i + 2;

        const departmentId = toDepartmentId(row.department);
        if (!departmentId) {
          setEaImportFailure('Import Application Structure CSV', [
            `Row ${displayRow}: department value "${row.department}" cannot be converted into a stable id.`,
          ]);
          return;
        }

        if (!eaRepository.objects.has(departmentId) && !seenNewObjects.has(departmentId)) {
          objects.push({
            id: departmentId,
            type: 'Department',
            attributes: { name: row.department, sourceFile: file.name, sourceRow: displayRow, importedAt },
          });
          seenNewObjects.add(departmentId);
        }

        if (!eaRepository.objects.has(row.applicationId) && !seenNewObjects.has(row.applicationId)) {
          objects.push({
            id: row.applicationId,
            type: 'Application',
            attributes: {
              name: row.applicationName && row.applicationName.trim() ? row.applicationName.trim() : row.applicationId,
              sourceFile: file.name,
              sourceRow: displayRow,
              importedAt,
            },
          });
          seenNewObjects.add(row.applicationId);
        }

        relationships.push({
          fromId: departmentId,
          toId: row.applicationId,
          type: 'OWNS',
          attributes: { sourceFile: file.name, sourceRow: displayRow, importedAt, ...row.attributes },
        });
      }

      const applyResult = applyEaImportBatch(eaRepository, { objects, relationships });
      if (!applyResult.ok) {
        setEaImportFailure('Import Application Structure CSV', applyResult.errors);
        return;
      }

      const applied = trySetEaRepository(applyResult.nextRepository);
      if (!applied.ok) {
        setEaImportFailure('Import Application Structure CSV', [applied.error]);
        return;
      }
      setEaImportSuccess(
        'Import Application Structure CSV',
        `imported ${objects.length} objects, ${relationships.length} relationships`,
      );
    } catch (err) {
      setEaImportFailure('Import Application Structure CSV', [
        `Failed to read or parse CSV: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
  };

  const onProgrammesCsvSelected: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const result = parseAndValidateProgrammesCsv(text);
      if (!result.ok) {
        setEaImportFailure('Import Programmes CSV', result.errors);
        return;
      }

      const objects = result.programmes.map((p) => ({
        id: p.id,
        type: 'Programme' as const,
        attributes: { name: p.name, ...p.attributes },
      }));

      const applyResult = applyEaImportBatch(eaRepository, { objects });
      if (!applyResult.ok) {
        setEaImportFailure('Import Programmes CSV', applyResult.errors);
        return;
      }

      const applied = trySetEaRepository(applyResult.nextRepository);
      if (!applied.ok) {
        setEaImportFailure('Import Programmes CSV', [applied.error]);
        return;
      }
      setEaImportSuccess('Import Programmes CSV', `imported ${objects.length} objects`);
    } catch (err) {
      setEaImportFailure('Import Programmes CSV', [
        `Failed to read or parse CSV: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
  };

  const onProgrammeMappingsCsvSelected: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const result = parseAndValidateProgrammeMappingsCsv(text);
      if (!result.ok) {
        setEaImportFailure('Import Programme Mappings CSV', result.errors);
        return;
      }

      const errors: string[] = [];
      const relationships = result.mappings.map((m, idx) => {
        const displayRow = idx + 2;

        const programmeObj = eaRepository.objects.get(m.programmeId);
        if (!programmeObj) {
          errors.push(`Row ${displayRow}: programmeId references unknown object id "${m.programmeId}".`);
        } else if (programmeObj.type !== 'Programme') {
          errors.push(
            `Row ${displayRow}: programmeId must reference a Programme (got "${programmeObj.type}").`,
          );
        }

        const targetObj = eaRepository.objects.get(m.mappedId);
        if (!targetObj) {
          errors.push(`Row ${displayRow}: mappedId references unknown object id "${m.mappedId}".`);
        } else if (targetObj.type !== m.mappedType) {
          errors.push(
            `Row ${displayRow}: mappedId type mismatch (expected "${m.mappedType}", got "${targetObj.type}").`,
          );
        }

        return {
          fromId: m.programmeId,
          toId: m.mappedId,
          type: 'DELIVERS' as const,
          attributes: { ...m.attributes },
        };
      });

      if (errors.length > 0) {
        setEaImportFailure('Import Programme Mappings CSV', errors);
        return;
      }

      const applyResult = applyEaImportBatch(eaRepository, { relationships });
      if (!applyResult.ok) {
        setEaImportFailure('Import Programme Mappings CSV', applyResult.errors);
        return;
      }

      const applied = trySetEaRepository(applyResult.nextRepository);
      if (!applied.ok) {
        setEaImportFailure('Import Programme Mappings CSV', [applied.error]);
        return;
      }
      setEaImportSuccess('Import Programme Mappings CSV', `imported ${relationships.length} relationships`);
    } catch (err) {
      setEaImportFailure('Import Programme Mappings CSV', [
        `Failed to read or parse CSV: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
  };

  const onApplicationsCsvSelected: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    // Allow selecting the same file twice.
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const result = parseAndValidateApplicationsCsv(text);
      if (!result.ok) {
        setApplicationsCsvErrors(result.errors);
        return;
      }

      // Success: replace Application objects in the EA repository.
      const nextApplicationIdSet = new Set(result.applications.map((a) => a.id));

      const draft = eaRepository.clone();
      for (const [id, obj] of draft.objects) {
        if (obj.type === 'Application') draft.objects.delete(id);
      }

      const errors: string[] = [];
      for (const row of result.applications) {
        const res = draft.addObject({
          id: row.id,
          type: 'Application',
          attributes: { name: row.name, criticality: row.criticality, lifecycle: row.lifecycle },
        });
        if (!res.ok) errors.push(res.error);
      }

      draft.relationships = draft.relationships.filter(
        (r) => draft.objects.has(r.fromId) && draft.objects.has(r.toId),
      );

      if (errors.length > 0) {
        setApplicationsCsvErrors(errors);
        return;
      }

      const applied = trySetEaRepository(draft);
      if (!applied.ok) {
        setApplicationsCsvErrors([applied.error]);
        return;
      }
      setGraphViewMode('landscape');
      const dependencyCount = draft.relationships.filter((r) => isApplicationDependencyRelationship(r.type)).length;
      setDatasetInfo({
        source: 'CSV',
        applicationCount: nextApplicationIdSet.size,
        dependencyCount,
        loadedAt: Date.now(),
      });
      setApplicationsCsvErrors([]);
      // Dependencies CSV errors are unrelated; keep as-is.
    } catch (err) {
      setApplicationsCsvErrors([
        `Failed to read or parse CSV: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
  };

  const onDependenciesCsvSelected: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (applications.length === 0) {
      setDependenciesCsvErrors(['Cannot load dependencies: no applications dataset is loaded.']);
      return;
    }

    try {
      const text = await file.text();
      const result = parseAndValidateDependenciesCsv(text, { existingApplicationIds: applicationIdSet });
      if (!result.ok) {
        setDependenciesCsvErrors(result.errors);
        return;
      }

      const draft = eaRepository.clone();
      // Replace application dependency relationships with the new set.
      draft.relationships = draft.relationships.filter((r) => !isApplicationDependencyRelationship(r.type));
      const errors: string[] = [];
      for (const d of result.dependencies) {
        const res = draft.addRelationship({
          fromId: d.from,
          toId: d.to,
          type: 'INTEGRATES_WITH',
          attributes: { dependencyStrength: d.dependencyStrength, dependencyType: d.dependencyType },
        });
        if (!res.ok) errors.push(res.error);
      }

      if (errors.length > 0) {
        setDependenciesCsvErrors(errors);
        return;
      }

      const applied = trySetEaRepository(draft);
      if (!applied.ok) {
        setDependenciesCsvErrors([applied.error]);
        return;
      }
      setGraphViewMode('landscape');
      setDatasetInfo({
        source: 'CSV',
        applicationCount: applications.length,
        dependencyCount: draft.relationships.filter((r) => isApplicationDependencyRelationship(r.type)).length,
        loadedAt: Date.now(),
      });
      setDependenciesCsvErrors([]);
    } catch (err) {
      setDependenciesCsvErrors([
        `Failed to read or parse CSV: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
  };

  const canExportImpactSummary = Boolean(selectedApplication && impactSummary);
  const canExportRankedImpacts = Boolean(selectedApplication && rankedImpacts.length > 0);

  const onExportImpactSummaryCsvClick = () => {
    if (!selectedApplication || !impactSummary) return;

    const csv = buildImpactSummaryCsv({ datasetInfo, impactSummary });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    const safeId = selectedApplication.id.replaceAll(/[^a-zA-Z0-9-_]+/g, '_');
    a.download = `impact-summary-${safeId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  };

  const onExportRankedImpactsCsvClick = () => {
    if (!selectedApplication) return;
    if (rankedImpacts.length === 0) return;

    const csv = buildRankedImpactsCsv(rankedImpacts);

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    const safeId = selectedApplication.id.replaceAll(/[^a-zA-Z0-9-_]+/g, '_');
    a.download = `ranked-impacts-${safeId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  };

  return (
    !DIAGRAMS_ENABLED || !catalogDefined ? (
      <div style={{ padding: 16 }}>
        <Alert
          type="warning"
          showIcon
          message="Define catalog data before creating views."
        />
      </div>
    ) : (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 16px 0', display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ margin: 0 }}>{viewDefinition.title}</h1>

        <Tag>
          Time Horizon: {timeHorizon ?? '1–3 years'} (analysis depth cap {horizonWindow.maxAnalysisDepth})
        </Tag>

        {selectedViewId === 'application-dependency-impact' && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              Depth
              <select
                value={depth}
                disabled={graphViewMode === 'landscape'}
                onChange={(e) => {
                  const next = Number.parseInt(e.target.value, 10);
                  if (next === 1 || next === 2 || next === 3) setDepth(next);
                }}
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>

            <div style={{ opacity: 0.7, fontSize: 12 }}>
              View: {graphViewMode === 'landscape' ? 'Landscape' : 'Impact'}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" onClick={onLoadApplicationsCsvClick}>
                Load Applications CSV
              </button>
              <input
                ref={applicationsCsvInputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={onApplicationsCsvSelected}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" onClick={onLoadDependenciesCsvClick} disabled={applications.length === 0}>
                Load Dependencies CSV
              </button>
              <input
                ref={dependenciesCsvInputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={onDependenciesCsvSelected}
                disabled={applications.length === 0}
              />
            </div>
          </>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={onExportImpactSummaryCsvClick} disabled={!canExportImpactSummary}>
            Export Impact Summary CSV
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={onExportRankedImpactsCsvClick} disabled={!canExportRankedImpacts}>
            Export Ranked Impacts CSV
          </button>
        </div>
      </div>

      <div style={{ padding: '12px 16px 0' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>EA Repository Imports</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={onImportCapabilitiesCsvClick} disabled={!canImportCapabilities}>
            Import Capabilities CSV
          </button>
          <input
            ref={capabilitiesCsvInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={onCapabilitiesCsvSelected}
          />

          <button type="button" onClick={onImportApplicationsEaCsvClick}>
            Import Applications CSV
          </button>
          <input
            ref={applicationsEaCsvInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={onApplicationsEaCsvSelected}
          />

          <button type="button" onClick={onImportApplicationDependenciesEaCsvClick}>
            Import Application Dependencies CSV
          </button>
          <input
            ref={appDependenciesEaCsvInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={onApplicationDependenciesEaCsvSelected}
          />

          <button type="button" onClick={onImportTechnologyCsvClick}>
            Import Technology CSV
          </button>
          <input
            ref={technologyCsvInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={onTechnologyCsvSelected}
          />

          <button type="button" onClick={onImportApplicationTechnologyCsvClick}>
            Import Application–Technology CSV
          </button>
          <input
            ref={applicationTechnologyCsvInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={onApplicationTechnologyCsvSelected}
          />

          <button type="button" onClick={onImportApplicationStructureCsvClick}>
            Import Application Structure CSV
          </button>
          <input
            ref={applicationStructureCsvInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={onApplicationStructureCsvSelected}
          />

          <button type="button" onClick={onImportProgrammesCsvClick} disabled={!canImportProgrammes}>
            Import Programmes CSV
          </button>
          <input
            ref={programmesCsvInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={onProgrammesCsvSelected}
          />

          <button type="button" onClick={onImportProgrammeMappingsCsvClick} disabled={!canImportProgrammes}>
            Import Programme Mappings CSV
          </button>
          <input
            ref={programmeMappingsCsvInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={onProgrammeMappingsCsvSelected}
          />
        </div>

        {eaImportStatus ? (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>{eaImportStatus}</div>
        ) : null}
      </div>

      {eaImportErrors.length > 0 ? (
        <div style={{ padding: '8px 16px 0' }}>
          <div
            style={{
              border: '1px solid rgba(255,77,79,0.4)',
              background: 'rgba(255,77,79,0.06)',
              padding: 12,
              borderRadius: 6,
              maxWidth: 920,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>EA Repository import failed</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {eaImportErrors.map((msg, idx) => (
                <div key={`${idx}-${msg}`}>{msg}</div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {applicationsCsvErrors.length > 0 ? (
        <div style={{ padding: '8px 16px 0' }}>
          <div
            style={{
              border: '1px solid rgba(255,77,79,0.4)',
              background: 'rgba(255,77,79,0.06)',
              padding: 12,
              borderRadius: 6,
              maxWidth: 920,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Applications CSV validation failed</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {applicationsCsvErrors.map((msg, idx) => (
                <div key={`${idx}-${msg}`}>{msg}</div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {dependenciesCsvErrors.length > 0 ? (
        <div style={{ padding: '8px 16px 0' }}>
          <div
            style={{
              border: '1px solid rgba(255,77,79,0.4)',
              background: 'rgba(255,77,79,0.06)',
              padding: 12,
              borderRadius: 6,
              maxWidth: 920,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Dependencies CSV validation failed</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {dependenciesCsvErrors.map((msg, idx) => (
                <div key={`${idx}-${msg}`}>{msg}</div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ height: '70vh', border: '3px solid red', background: '#fff', flex: 1 }}>
          <GraphView
            depth={depth}
            eaRepository={eaRepository}
            lifecycleCoverage={metadata?.lifecycleCoverage}
            viewDefinition={viewDefinition}
            viewMode={graphViewMode}
            rootNodeId={selectedApplication?.id}
            onSelectNode={(node) => {
              if (node.objectType !== 'Application') return;

              // Only the Application Dependency / Impact view has the impact mode behavior.
              if (selectedViewId === 'application-dependency-impact') setGraphViewMode('impact');
              setSelectedDependency(undefined);

              const application = applicationById.get(node.id);
              if (!application) return;

              setSelectedApplication(application);
              setRankedImpacts([]);

              const nextPaths =
                selectedViewId === 'application-dependency-impact'
                  ? computeImpactPaths({
                      nodes: applications,
                      edges: dependencies,
                      rootId: application.id,
                      maxDepth: depth,
                      direction: 'downstream',
                    })
                  : [];

              setImpactPaths(nextPaths);

              const criticalityById = new Map(
                applications.map((n) => [n.id, n.criticality] as const),
              );
              const nameById = new Map(
                applications.map((n) => [n.id, n.name] as const),
              );
              const strengthByEdge = new Map(
                dependencies.map((e) => [
                  `${e.from}->${e.to}`,
                  e.dependencyStrength,
                ] as const),
              );

              const impactCountsByTarget = new Map<
                string,
                { totalPaths: number; hardPathCount: number; softOnlyPathCount: number }
              >();

              let maxDependencyDepthObserved = 0;

              for (const path of nextPaths) {
                if (!path || path.length < 2) continue;

                maxDependencyDepthObserved = Math.max(maxDependencyDepthObserved, path.length - 1);

                const targetId = path[path.length - 1];
                let counts = impactCountsByTarget.get(targetId);
                if (!counts) {
                  counts = { totalPaths: 0, hardPathCount: 0, softOnlyPathCount: 0 };
                  impactCountsByTarget.set(targetId, counts);
                }

                let hasHard = false;
                for (let i = 1; i < path.length; i += 1) {
                  const from = path[i - 1];
                  const to = path[i];
                  const strength = strengthByEdge.get(`${from}->${to}`) ?? 'soft';
                  if (strength === 'hard') {
                    hasHard = true;
                    break;
                  }
                }

                counts.totalPaths += 1;
                if (hasHard) counts.hardPathCount += 1;
                else counts.softOnlyPathCount += 1;
              }

              const bySeverityLabel: Record<'High' | 'Medium' | 'Low', number> = {
                High: 0,
                Medium: 0,
                Low: 0,
              };

              const nextRankedImpacts: Array<RankedImpactItem & { _index: number }> = [];
              let idx = 0;

              for (const [applicationId, counts] of impactCountsByTarget) {
                if (applicationId === application.id) continue;
                const criticality = criticalityById.get(applicationId);
                if (!criticality) continue;

                const { severityScore, severityLabel } = computeImpactSeverity({
                  ...counts,
                  criticality,
                });

                bySeverityLabel[severityLabel] += 1;

                nextRankedImpacts.push({
                  applicationId,
                  applicationName: nameById.get(applicationId) ?? applicationId,
                  severityScore,
                  severityLabel,
                  _index: idx,
                });
                idx += 1;
              }

              nextRankedImpacts.sort((a, b) => {
                const scoreDiff = b.severityScore - a.severityScore;
                if (scoreDiff !== 0) return scoreDiff;
                return a._index - b._index;
              });

              setRankedImpacts(
                nextRankedImpacts.map(({ _index, ...rest }) => rest),
              );

              setImpactSummary({
                totalImpactedApplications: Array.from(impactCountsByTarget.keys()).filter(
                  (id) => id !== application.id,
                ).length,
                bySeverityLabel,
                maxDependencyDepthObserved,
              });
            }}
            onSelectEdge={(edge) => {
              if (selectedViewId !== 'application-dependency-impact' && selectedViewId !== 'application-landscape') return;

              const sourceApp = applicationById.get(edge.fromId);
              const targetApp = applicationById.get(edge.toId);
              if (!sourceApp || !targetApp) return;

              const toDependencyType = (value: unknown): DependencyMetadata['dependencyType'] => {
                if (value === 'sync' || value === 'async' || value === 'batch' || value === 'data' || value === 'auth') return value;
                return undefined;
              };

              const dependencyType = toDependencyType(edge.attributes?.dependencyType);

              const dependencyStrength =
                edge.attributes?.dependencyStrength === 'hard' || edge.attributes?.dependencyStrength === 'soft'
                  ? (edge.attributes.dependencyStrength as 'hard' | 'soft')
                  : undefined;

              setSelectedApplication(undefined);
              setSelectedDependency({
                sourceApplication: { id: sourceApp.id, name: sourceApp.name },
                targetApplication: { id: targetApp.id, name: targetApp.name },
                dependencyType,
                dependencyStrength,
              });
              setImpactSummary(undefined);
              setRankedImpacts([]);
            }}
          />
        </div>
        <ApplicationSidePanel
          selectedApplication={selectedApplication}
          selectedDependency={selectedDependency}
          impactSummary={impactSummary}
          rankedImpacts={rankedImpacts}
          impactPaths={impactPaths}
          datasetInfo={datasetInfo}
          applicationsForLookup={applications}
          graphViewMode={graphViewMode}
          rootApplication={selectedApplication ? { id: selectedApplication.id, name: selectedApplication.name } : undefined}
          impactDepth={depth}
        />
      </div>
    </div>
    )
  );
};

export default DependencyView;
