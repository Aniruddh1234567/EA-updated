import { EaRepository } from '@/pages/dependency-view/utils/eaRepository';

import { validateArchitectureRepository } from '../../backend/analysis/RepositoryValidation';
import { validateRelationshipRepository } from '../../backend/analysis/RelationshipValidation';
import { ArchitectureRepository } from '../../backend/repository/ArchitectureRepository';
import { createRelationshipRepository } from '../../backend/repository/RelationshipRepository';

import type { LifecycleCoverage } from '@/repository/repositoryMetadata';
import type { ModelingState } from './DesignWorkspaceStore';
import { getLifecycleStateFromAttributes } from '@/repository/lifecycleCoveragePolicy';

export type GovernanceSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKER';

export type GovernanceDebtSummary = {
  mandatoryFindingCount: number;
  relationshipErrorCount: number;
  relationshipWarningCount: number;
  invalidRelationshipInsertCount: number;
  lifecycleTagMissingCount: number;
  total: number;
};

export type GovernanceIssue = {
  message: string;
  severity: GovernanceSeverity;
  subjectId?: string;
  scope?: 'Capability Map' | 'Application Landscape' | 'Technology Stack' | 'Unknown';
};

export type GovernanceDebt = {
  summary: GovernanceDebtSummary;
  repoReport: {
    observedAt: string;
    findings: Array<Omit<ReturnType<typeof validateArchitectureRepository>['findings'][number], 'severity'> & { severity: GovernanceSeverity }>;
    summary: {
      total: number;
      bySeverity: Record<GovernanceSeverity, number>;
      byCheckId: Record<string, number>;
    };
  };
  relationshipReport: {
    observedAt: string;
    findings: Array<Omit<ReturnType<typeof validateRelationshipRepository>['findings'][number], 'severity'> & { severity: GovernanceSeverity }>;
    summary: {
      total: number;
      bySeverity: Record<GovernanceSeverity, number>;
      byCheckId: Record<string, number>;
    };
  };
  invalidRelationshipInserts: GovernanceIssue[];
  lifecycleTagMissingIds: GovernanceIssue[];
};

const getString = (value: unknown): string => (typeof value === 'string' ? value : '');
const getNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const getBool = (value: unknown): boolean => value === true;

const TECHNICAL_TERMS = [
  'api',
  'application',
  'app',
  'database',
  'server',
  'cloud',
  'platform',
  'infrastructure',
  'network',
  'system',
  'software',
  'hardware',
  'integration',
  'interface',
  'runtime',
  'compute',
  'storage',
  'message',
  'broker',
  'queue',
  'pipeline',
  'middleware',
  'technology',
  'tech',
];

const PHYSICAL_TERMS = [
  'server',
  'database',
  'db',
  'host',
  'node',
  'vm',
  'virtual machine',
  'cluster',
  'container',
  'kubernetes',
  'k8s',
  'docker',
  'runtime',
  'compute',
  'storage',
  'network',
  'router',
  'switch',
  'firewall',
  'load balancer',
  'gateway',
  'infra',
  'infrastructure',
];

const findTechnicalTerm = (text: string): string | null => {
  const normalized = String(text ?? '').toLowerCase();
  if (!normalized.trim()) return null;
  for (const term of TECHNICAL_TERMS) {
    const pattern = new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(normalized)) return term;
  }
  return null;
};

const findPhysicalTerm = (text: string): string | null => {
  const normalized = String(text ?? '').toLowerCase();
  if (!normalized.trim()) return null;
  for (const term of PHYSICAL_TERMS) {
    const pattern = new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(normalized)) return term;
  }
  return null;
};

const isItOwned = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return /\b(it|information technology)\b/i.test(normalized);
};

const PROCESS_VERBS = [
  'Place',
  'Process',
  'Approve',
  'Validate',
  'Verify',
  'Assess',
  'Review',
  'Fulfill',
  'Manage',
  'Handle',
  'Create',
  'Update',
  'Resolve',
  'Reconcile',
  'Notify',
  'Onboard',
  'Register',
  'Close',
  'Issue',
  'Capture',
  'Monitor',
  'Deliver',
];

const isVerbBasedProcessName = (name: string): boolean => {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return false;
  const first = trimmed.split(/\s+/)[0];
  return PROCESS_VERBS.some((verb) => verb.toLowerCase() === first.toLowerCase());
};

const normalizeId = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isSoftDeleted = (attrs: Record<string, unknown> | null | undefined) => (attrs as any)?._deleted === true;

const KNOWN_MODELING_STATES = new Set<ModelingState>(['DRAFT', 'COMMITTED', 'REVIEW_READY', 'APPROVED']);

const normalizeModelingState = (attrs: Record<string, unknown> | null | undefined): ModelingState => {
  const raw = (attrs as any)?.modelingState as ModelingState | undefined;
  return raw && KNOWN_MODELING_STATES.has(raw) ? raw : 'COMMITTED';
};

const canEscalateSeverity = (state: ModelingState): boolean => state === 'REVIEW_READY' || state === 'APPROVED';

const toGovernanceSeverity = (
  baseSeverity: 'Info' | 'Warning' | 'Error',
  state: ModelingState,
): GovernanceSeverity => {
  const mapped: GovernanceSeverity = baseSeverity === 'Info' ? 'INFO' : baseSeverity === 'Warning' ? 'WARNING' : 'ERROR';
  if ((mapped === 'ERROR' || mapped === 'BLOCKER') && !canEscalateSeverity(state)) return 'WARNING';
  return mapped;
};

const severityRank = (sev: GovernanceSeverity): number =>
  sev === 'BLOCKER' ? 4 : sev === 'ERROR' ? 3 : sev === 'WARNING' ? 2 : 1;

export const MANDATORY_RELATIONSHIP_CHECK_IDS = [
  'EA_REQUIRED_OWNER',
  'EA_INVALID_OWNER',
  'EA_ENTERPRISE_OWNERSHIP',
  'EA_DEPARTMENT_REQUIRES_ENTERPRISE',
  'EA_BUSINESS_SERVICE_REQUIRES_CAPABILITY',
  'EA_CAPABILITY_REQUIRES_APPLICATION_SERVICE_SUPPORT',
  'EA_APPLICATION_SERVICE_REQUIRES_APPLICATION',
  'PROCESS_MISSING_CAPABILITY_PARENT',
] as const;

export const TRACEABILITY_CHECK_IDS = [
  'EA_BUSINESS_SERVICE_REQUIRES_CAPABILITY',
  'EA_CAPABILITY_REQUIRES_APPLICATION_SERVICE_SUPPORT',
  'EA_APPLICATION_SERVICE_REQUIRES_APPLICATION',
  'PROCESS_MISSING_CAPABILITY_PARENT',
] as const;

const MANDATORY_RELATIONSHIP_CHECK_SET = new Set<string>(MANDATORY_RELATIONSHIP_CHECK_IDS);
const TRACEABILITY_CHECK_SET = new Set<string>(TRACEABILITY_CHECK_IDS);

const applyMandatoryRelationshipSeverity = (
  checkId: string,
  modelingState: ModelingState,
  baseSeverity: 'Info' | 'Warning' | 'Error',
): GovernanceSeverity => {
  if (TRACEABILITY_CHECK_SET.has(checkId)) {
    if (modelingState === 'REVIEW_READY' || modelingState === 'APPROVED') {
      return toGovernanceSeverity(baseSeverity, modelingState);
    }
    return 'INFO';
  }
  if (!MANDATORY_RELATIONSHIP_CHECK_SET.has(checkId)) {
    return toGovernanceSeverity(baseSeverity, modelingState);
  }
  if (modelingState === 'REVIEW_READY' || modelingState === 'APPROVED') {
    return toGovernanceSeverity(baseSeverity, modelingState);
  }
  return 'INFO';
};

const SCOPE_CAPABILITY = new Set<string>([
  'Enterprise',
  'CapabilityCategory',
  'Capability',
  'SubCapability',
  'ValueStream',
  'BusinessService',
  'BusinessProcess',
  'Department',
  'Programme',
  'Project',
]);
const SCOPE_APPLICATION = new Set<string>(['Application', 'ApplicationService']);
const SCOPE_TECHNOLOGY = new Set<string>([
  'Technology',
  'Node',
  'Compute',
  'Runtime',
  'Database',
  'Storage',
  'API',
  'MessageBroker',
  'IntegrationPlatform',
  'CloudService',
]);

const scopeForElementType = (type: string | null | undefined): GovernanceIssue['scope'] => {
  if (!type) return 'Unknown';
  if (SCOPE_TECHNOLOGY.has(type)) return 'Technology Stack';
  if (SCOPE_APPLICATION.has(type)) return 'Application Landscape';
  if (SCOPE_CAPABILITY.has(type)) return 'Capability Map';
  return 'Unknown';
};

const scopeForRelationshipTypes = (sourceType?: string, targetType?: string): GovernanceIssue['scope'] => {
  if (SCOPE_TECHNOLOGY.has(String(sourceType)) || SCOPE_TECHNOLOGY.has(String(targetType))) return 'Technology Stack';
  if (SCOPE_APPLICATION.has(String(sourceType)) || SCOPE_APPLICATION.has(String(targetType))) return 'Application Landscape';
  if (SCOPE_CAPABILITY.has(String(sourceType)) || SCOPE_CAPABILITY.has(String(targetType))) return 'Capability Map';
  return 'Unknown';
};

const increment = (obj: Record<string, number>, key: string) => {
  obj[key] = (obj[key] ?? 0) + 1;
};

const toBackendElementType = (eaType: string): string => {
  if (eaType === 'Capability' || eaType === 'SubCapability' || eaType === 'CapabilityCategory') return 'Capability';
  if (eaType === 'BusinessProcess') return 'BusinessProcess';
  if (eaType === 'BusinessService') return 'BusinessService';
  if (eaType === 'Application') return 'Application';
  if (eaType === 'ApplicationService') return 'ApplicationService';
  if (eaType === 'Technology') return 'Technology';
  if (eaType === 'Programme') return 'Programme';
  if (eaType === 'Project') return 'Project';
  if (eaType === 'Enterprise') return 'Enterprise';
  if (eaType === 'Department') return 'Department';
  return eaType;
};

export function buildGovernanceDebt(
  eaRepository: EaRepository,
  nowDate: Date = new Date(),
  options?: { lifecycleCoverage?: LifecycleCoverage | null; governanceMode?: 'Strict' | 'Advisory' | null },
): GovernanceDebt {
  const repo = new ArchitectureRepository();
  const now = nowDate.toISOString();

  const lifecycleCoverage = options?.lifecycleCoverage ?? null;
  const lifecycleTagMissingIds: GovernanceIssue[] = [];

  for (const obj of eaRepository.objects.values()) {
    const attrs = obj.attributes ?? {};

    if (lifecycleCoverage === 'Both' && attrs._deleted !== true) {
      const state = getLifecycleStateFromAttributes(attrs);
      if (!state) {
        const modelingState = normalizeModelingState(attrs);
        lifecycleTagMissingIds.push({
          message: `Missing required lifecycle tag for ${obj.type} ${obj.id}.`,
          severity: toGovernanceSeverity('Error', modelingState),
          subjectId: obj.id,
          scope: scopeForElementType(obj.type),
        });
      }
    }

    const name = typeof attrs.name === 'string' && attrs.name.trim() ? attrs.name.trim() : obj.id;

    if (obj.type === 'Capability' || obj.type === 'CapabilityCategory' || obj.type === 'SubCapability') {
      repo.addElement('capabilities', {
        id: obj.id,
        name,
        description: getString(attrs.description),
        elementType: 'Capability',
        layer: 'Business',
        lifecycleStatus: (attrs.lifecycleStatus as any) || 'Active',
        lifecycleStartDate: getString(attrs.lifecycleStartDate),
        lifecycleEndDate: getString(attrs.lifecycleEndDate) || undefined,
        ownerRole: getString(attrs.ownerRole),
        ownerName: getString(attrs.ownerName),
        owningUnit: getString(attrs.owningUnit),
        approvalStatus: (attrs.approvalStatus as any) || 'Draft',
        lastReviewedAt: getString(attrs.lastReviewedAt),
        reviewCycleMonths: getNumber(attrs.reviewCycleMonths),
        createdAt: getString(attrs.createdAt) || now,
        createdBy: getString(attrs.createdBy),
        lastModifiedAt: getString(attrs.lastModifiedAt) || now,
        lastModifiedBy: getString(attrs.lastModifiedBy),

        capabilityType: (attrs.capabilityType as any) || 'Core',
        businessValue: (attrs.businessValue as any) || 'Medium',
        maturityLevel: (attrs.maturityLevel as any) || 'Developing',
        parentCapabilityId: getString(attrs.parentCapabilityId),
      } as any);
      continue;
    }

    if (obj.type === 'Application') {
      repo.addElement('applications', {
        id: obj.id,
        name,
        description: getString(attrs.description),
        elementType: 'Application',
        layer: 'Application',
        lifecycleStatus: (attrs.lifecycleStatus as any) || 'Active',
        lifecycleStartDate: getString(attrs.lifecycleStartDate),
        lifecycleEndDate: getString(attrs.lifecycleEndDate) || undefined,
        ownerRole: getString(attrs.ownerRole),
        ownerName: getString(attrs.ownerName),
        owningUnit: getString(attrs.owningUnit),
        approvalStatus: (attrs.approvalStatus as any) || 'Draft',
        lastReviewedAt: getString(attrs.lastReviewedAt),
        reviewCycleMonths: getNumber(attrs.reviewCycleMonths),
        createdAt: getString(attrs.createdAt) || now,
        createdBy: getString(attrs.createdBy),
        lastModifiedAt: getString(attrs.lastModifiedAt) || now,
        lastModifiedBy: getString(attrs.lastModifiedBy),

        applicationType: (attrs.applicationType as any) || 'Custom',
        vendor: getString(attrs.vendor),
        version: getString(attrs.version),
        hostingModel: (attrs.hostingModel as any) || 'OnPrem',
        technologyStack: Array.isArray(attrs.technologyStack) ? attrs.technologyStack : [],
        userCountEstimate: getNumber(attrs.userCountEstimate),
        criticality: (attrs.criticality as any) || 'Medium',
        dataClassification: (attrs.dataClassification as any) || 'Internal',
        integrations: Array.isArray(attrs.integrations) ? attrs.integrations : [],
      } as any);
      continue;
    }

    if (obj.type === 'Technology') {
      repo.addElement('technologies', {
        id: obj.id,
        name,
        description: getString(attrs.description),
        elementType: 'Technology',
        layer: 'Technology',
        lifecycleStatus: (attrs.lifecycleStatus as any) || 'Active',
        lifecycleStartDate: getString(attrs.lifecycleStartDate),
        lifecycleEndDate: getString(attrs.lifecycleEndDate) || undefined,
        ownerRole: getString(attrs.ownerRole),
        ownerName: getString(attrs.ownerName),
        owningUnit: getString(attrs.owningUnit),
        approvalStatus: (attrs.approvalStatus as any) || 'Draft',
        lastReviewedAt: getString(attrs.lastReviewedAt),
        reviewCycleMonths: getNumber(attrs.reviewCycleMonths),
        createdAt: getString(attrs.createdAt) || now,
        createdBy: getString(attrs.createdBy),
        lastModifiedAt: getString(attrs.lastModifiedAt) || now,
        lastModifiedBy: getString(attrs.lastModifiedBy),

        technologyType: (attrs.technologyType as any) || 'Platform',
        vendor: getString(attrs.vendor),
        version: getString(attrs.version),
        category: getString(attrs.category),
        deploymentModel: (attrs.deploymentModel as any) || 'OnPrem',
        supportEndDate: getString(attrs.supportEndDate),
        standardApproved: getBool(attrs.standardApproved),
      } as any);
      continue;
    }

    if (obj.type === 'BusinessProcess') {
      repo.addElement('businessProcesses', {
        id: obj.id,
        name,
        description: getString(attrs.description),
        elementType: 'BusinessProcess',
        layer: 'Business',
        lifecycleStatus: (attrs.lifecycleStatus as any) || 'Active',
        lifecycleStartDate: getString(attrs.lifecycleStartDate),
        lifecycleEndDate: getString(attrs.lifecycleEndDate) || undefined,
        ownerRole: getString(attrs.ownerRole),
        ownerName: getString(attrs.ownerName),
        owningUnit: getString(attrs.owningUnit),
        approvalStatus: (attrs.approvalStatus as any) || 'Draft',
        lastReviewedAt: getString(attrs.lastReviewedAt),
        reviewCycleMonths: getNumber(attrs.reviewCycleMonths),
        createdAt: getString(attrs.createdAt) || now,
        createdBy: getString(attrs.createdBy),
        lastModifiedAt: getString(attrs.lastModifiedAt) || now,
        lastModifiedBy: getString(attrs.lastModifiedBy),

        processOwner: getString(attrs.processOwner),
        triggeringEvent: getString(attrs.triggeringEvent),
        expectedOutcome: getString(attrs.expectedOutcome),
        frequency: (attrs.frequency as any) || 'Ad-hoc',
        criticality: (attrs.criticality as any) || 'Medium',
        regulatoryRelevant: getBool(attrs.regulatoryRelevant),
        complianceNotes: getString(attrs.complianceNotes),
        parentCapabilityId: getString(attrs.parentCapabilityId),
      } as any);
      continue;
    }

    if (obj.type === 'Enterprise') {
      repo.addElement('enterprises', {
        id: obj.id,
        name,
        description: getString(attrs.description),
        elementType: 'Enterprise',
        layer: 'Business',
        lifecycleStatus: (attrs.lifecycleStatus as any) || 'Active',
        lifecycleStartDate: getString(attrs.lifecycleStartDate),
        lifecycleEndDate: getString(attrs.lifecycleEndDate) || undefined,
        ownerRole: getString(attrs.ownerRole),
        ownerName: getString(attrs.ownerName),
        owningUnit: getString(attrs.owningUnit),
        approvalStatus: (attrs.approvalStatus as any) || 'Draft',
        lastReviewedAt: getString(attrs.lastReviewedAt),
        reviewCycleMonths: getNumber(attrs.reviewCycleMonths),
        createdAt: getString(attrs.createdAt) || now,
        createdBy: getString(attrs.createdBy),
        lastModifiedAt: getString(attrs.lastModifiedAt) || now,
        lastModifiedBy: getString(attrs.lastModifiedBy),
        parentEnterpriseId: getString(attrs.parentEnterpriseId) || null,
      } as any);
      continue;
    }

    if (obj.type === 'Department') {
      repo.addElement('departments', {
        id: obj.id,
        name,
        description: getString(attrs.description),
        elementType: 'Department',
        layer: 'Business',
        lifecycleStatus: (attrs.lifecycleStatus as any) || 'Active',
        lifecycleStartDate: getString(attrs.lifecycleStartDate),
        lifecycleEndDate: getString(attrs.lifecycleEndDate) || undefined,
        ownerRole: getString(attrs.ownerRole),
        ownerName: getString(attrs.ownerName),
        owningUnit: getString(attrs.owningUnit),
        approvalStatus: (attrs.approvalStatus as any) || 'Draft',
        lastReviewedAt: getString(attrs.lastReviewedAt),
        reviewCycleMonths: getNumber(attrs.reviewCycleMonths),
        createdAt: getString(attrs.createdAt) || now,
        createdBy: getString(attrs.createdBy),
        lastModifiedAt: getString(attrs.lastModifiedAt) || now,
        lastModifiedBy: getString(attrs.lastModifiedBy),
      } as any);
      continue;
    }

    if (obj.type === 'BusinessService') {
      repo.addElement('businessServices', {
        id: obj.id,
        name,
        description: getString(attrs.description),
        elementType: 'BusinessService',
        layer: 'Business',
        lifecycleStatus: (attrs.lifecycleStatus as any) || 'Active',
        lifecycleStartDate: getString(attrs.lifecycleStartDate),
        lifecycleEndDate: getString(attrs.lifecycleEndDate) || undefined,
        ownerRole: getString(attrs.ownerRole),
        ownerName: getString(attrs.ownerName),
        owningUnit: getString(attrs.owningUnit),
        approvalStatus: (attrs.approvalStatus as any) || 'Draft',
        lastReviewedAt: getString(attrs.lastReviewedAt),
        reviewCycleMonths: getNumber(attrs.reviewCycleMonths),
        createdAt: getString(attrs.createdAt) || now,
        createdBy: getString(attrs.createdBy),
        lastModifiedAt: getString(attrs.lastModifiedAt) || now,
        lastModifiedBy: getString(attrs.lastModifiedBy),
      } as any);
      continue;
    }

    if (obj.type === 'ApplicationService') {
      repo.addElement('applicationServices', {
        id: obj.id,
        name,
        description: getString(attrs.description),
        elementType: 'ApplicationService',
        layer: 'Application',
        lifecycleStatus: (attrs.lifecycleStatus as any) || 'Active',
        lifecycleStartDate: getString(attrs.lifecycleStartDate),
        lifecycleEndDate: getString(attrs.lifecycleEndDate) || undefined,
        ownerRole: getString(attrs.ownerRole),
        ownerName: getString(attrs.ownerName),
        owningUnit: getString(attrs.owningUnit),
        approvalStatus: (attrs.approvalStatus as any) || 'Draft',
        lastReviewedAt: getString(attrs.lastReviewedAt),
        reviewCycleMonths: getNumber(attrs.reviewCycleMonths),
        createdAt: getString(attrs.createdAt) || now,
        createdBy: getString(attrs.createdBy),
        lastModifiedAt: getString(attrs.lastModifiedAt) || now,
        lastModifiedBy: getString(attrs.lastModifiedBy),
      } as any);
      continue;
    }

    if (obj.type === 'Programme') {
      repo.addElement('programmes', {
        id: obj.id,
        name,
        description: getString(attrs.description),
        elementType: 'Programme',
        layer: 'Implementation & Migration',
        lifecycleStatus: (attrs.lifecycleStatus as any) || 'Active',
        lifecycleStartDate: getString(attrs.lifecycleStartDate),
        lifecycleEndDate: getString(attrs.lifecycleEndDate) || undefined,
        ownerRole: getString(attrs.ownerRole),
        ownerName: getString(attrs.ownerName),
        owningUnit: getString(attrs.owningUnit),
        approvalStatus: (attrs.approvalStatus as any) || 'Draft',
        lastReviewedAt: getString(attrs.lastReviewedAt),
        reviewCycleMonths: getNumber(attrs.reviewCycleMonths),
        createdAt: getString(attrs.createdAt) || now,
        createdBy: getString(attrs.createdBy),
        lastModifiedAt: getString(attrs.lastModifiedAt) || now,
        lastModifiedBy: getString(attrs.lastModifiedBy),

        programmeType: (attrs.programmeType as any) || 'Transformation',
        strategicObjective: getString(attrs.strategicObjective),
        startDate: getString(attrs.startDate),
        endDate: getString(attrs.endDate),
        budgetEstimate: getNumber(attrs.budgetEstimate),
        fundingStatus: (attrs.fundingStatus as any) || 'Proposed',
        expectedBusinessImpact: getString(attrs.expectedBusinessImpact),
        riskLevel: (attrs.riskLevel as any) || 'Medium',
      } as any);
      continue;
    }

    if (obj.type === 'Project') {
      repo.addElement('projects', {
        id: obj.id,
        name,
        description: getString(attrs.description),
        elementType: 'Project',
        layer: 'Implementation & Migration',
        lifecycleStatus: (attrs.lifecycleStatus as any) || 'Active',
        lifecycleStartDate: getString(attrs.lifecycleStartDate),
        lifecycleEndDate: getString(attrs.lifecycleEndDate) || undefined,
        ownerRole: getString(attrs.ownerRole),
        ownerName: getString(attrs.ownerName),
        owningUnit: getString(attrs.owningUnit),
        approvalStatus: (attrs.approvalStatus as any) || 'Draft',
        lastReviewedAt: getString(attrs.lastReviewedAt),
        reviewCycleMonths: getNumber(attrs.reviewCycleMonths),
        createdAt: getString(attrs.createdAt) || now,
        createdBy: getString(attrs.createdBy),
        lastModifiedAt: getString(attrs.lastModifiedAt) || now,
        lastModifiedBy: getString(attrs.lastModifiedBy),
      } as any);
    }
  }

  // Enterprise-grade governance rules (Strict mode consumes these via summary.total).
  const extraRepoFindings: Array<ReturnType<typeof validateArchitectureRepository>['findings'][number]> = [];

  const addRepoFinding = (args: {
    checkId: string;
    severity: 'Info' | 'Warning' | 'Error';
    message: string;
    elementId: string;
    elementType: string;
    collection: string;
  }) => {
    const severity: 'Info' | 'Warning' | 'Error' =
      options?.governanceMode === 'Advisory' && args.severity === 'Error' ? 'Warning' : args.severity;
    extraRepoFindings.push({
      id: `${args.checkId}:${args.elementId}`,
      checkId: args.checkId,
      severity,
      message: args.message,
      elementId: args.elementId,
      elementType: args.elementType,
      collection: args.collection,
      observedAt: now,
    });
  };

  const getObj = (id: string) => eaRepository.objects.get(id);

  const getElementModelingState = (id: string): ModelingState => {
    const obj = getObj(id);
    return normalizeModelingState(obj?.attributes);
  };

  const getRelationshipModelingState = (sourceId: string, targetId: string, relationshipType?: string): ModelingState => {
    const rel = eaRelationships.find(
      (r) => r.fromId === sourceId && r.toId === targetId && (!relationshipType || r.type === relationshipType),
    );
    if (rel) return normalizeModelingState(rel.attributes);
    const sourceState = getElementModelingState(sourceId);
    const targetState = getElementModelingState(targetId);
    return canEscalateSeverity(sourceState) || canEscalateSeverity(targetState) ? 'REVIEW_READY' : 'COMMITTED';
  };

  const aggregateRepoFindings = (findings: Array<ReturnType<typeof validateArchitectureRepository>['findings'][number]>) => {
    const grouped = new Map<string, {
      checkId: string;
      scope: GovernanceIssue['scope'];
      severity: GovernanceSeverity;
      count: number;
      examples: string[];
      collection: string;
    }>();
    for (const f of findings) {
      const scope = scopeForElementType(f.elementType);
      const key = `${String(f.checkId)}|${scope ?? 'Unknown'}`;
      const modelingState = getElementModelingState(f.elementId);
      const severity = applyMandatoryRelationshipSeverity(String(f.checkId), modelingState, f.severity);
      const entry = grouped.get(key);
      if (!entry) {
        grouped.set(key, {
          checkId: String(f.checkId),
          scope,
          severity,
          count: 1,
          examples: [`${f.elementId}`],
          collection: f.collection,
        });
        continue;
      }
      entry.count += 1;
      if (severityRank(severity) > severityRank(entry.severity)) entry.severity = severity;
      if (entry.examples.length < 3) entry.examples.push(String(f.elementId));
    }
    return Array.from(grouped.values()).map((g) => ({
      id: `${g.checkId}:${g.scope ?? 'Unknown'}`,
      checkId: g.checkId as any,
      severity: g.severity,
      message: `${g.scope ?? 'Unknown'}: ${g.count} finding(s) for ${g.checkId}. Examples: ${g.examples.join(', ')}.`,
      elementId: g.scope ?? 'Unknown',
      elementType: g.scope ?? 'Unknown',
      collection: g.collection as any,
      observedAt: now,
    }));
  };

  const aggregateRelationshipFindings = (
    findings: Array<ReturnType<typeof validateRelationshipRepository>['findings'][number]>,
  ) => {
    const grouped = new Map<string, {
      checkId: string;
      scope: GovernanceIssue['scope'];
      severity: GovernanceSeverity;
      count: number;
      examples: string[];
    }>();
    for (const f of findings) {
      const scope =
        f.subjectKind === 'Element'
          ? scopeForElementType(f.subjectType)
          : scopeForRelationshipTypes(f.sourceElementType, f.targetElementType);
      const key = `${String(f.checkId)}|${scope ?? 'Unknown'}`;
      const modelingState =
        f.subjectKind === 'Element'
          ? getElementModelingState(f.subjectId)
          : getRelationshipModelingState(
              String(f.sourceElementId ?? ''),
              String(f.targetElementId ?? ''),
              String(f.relationshipType ?? ''),
            );
      const severity = applyMandatoryRelationshipSeverity(String(f.checkId), modelingState, f.severity);
      const entry = grouped.get(key);
      const sample = f.subjectKind === 'Element' ? f.subjectId : `${f.sourceElementId ?? '?'}→${f.targetElementId ?? '?'}`;
      if (!entry) {
        grouped.set(key, {
          checkId: String(f.checkId),
          scope,
          severity,
          count: 1,
          examples: [String(sample)],
        });
        continue;
      }
      entry.count += 1;
      if (severityRank(severity) > severityRank(entry.severity)) entry.severity = severity;
      if (entry.examples.length < 3) entry.examples.push(String(sample));
    }
    return Array.from(grouped.values()).map((g) => ({
      id: `${g.checkId}:${g.scope ?? 'Unknown'}`,
      checkId: g.checkId as any,
      severity: g.severity,
      message: `${g.scope ?? 'Unknown'}: ${g.count} finding(s) for ${g.checkId}. Examples: ${g.examples.join(', ')}.`,
      observedAt: now,
      subjectKind: 'Scope' as const,
      subjectId: g.scope ?? 'Unknown',
      subjectType: g.scope ?? 'Unknown',
    }));
  };

  const aggregateIssuesByScope = (issues: GovernanceIssue[], label: string): GovernanceIssue[] => {
    const grouped = new Map<string, { scope: GovernanceIssue['scope']; severity: GovernanceSeverity; count: number; examples: string[] }>();
    for (const issue of issues) {
      const scope = issue.scope ?? 'Unknown';
      const key = scope ?? 'Unknown';
      const entry = grouped.get(key);
      if (!entry) {
        grouped.set(key, {
          scope,
          severity: issue.severity,
          count: 1,
          examples: [issue.subjectId || issue.message],
        });
        continue;
      }
      entry.count += 1;
      if (severityRank(issue.severity) > severityRank(entry.severity)) entry.severity = issue.severity;
      if (entry.examples.length < 3) entry.examples.push(issue.subjectId || issue.message);
    }
    return Array.from(grouped.values()).map((g) => ({
      message: `${g.scope ?? 'Unknown'}: ${g.count} ${label} issue(s). Examples: ${g.examples.join(', ')}.`,
      severity: g.severity,
      subjectId: g.scope ?? 'Unknown',
      scope: g.scope ?? 'Unknown',
    }));
  };

  const displayName = (obj: { id: string; attributes?: Record<string, unknown> } | null | undefined): string => {
    if (!obj) return '';
    const raw = (obj.attributes as any)?.name;
    const name = typeof raw === 'string' ? raw.trim() : '';
    return name || obj.id;
  };

  const activeObjects = Array.from(eaRepository.objects.values()).filter((o) => !isSoftDeleted(o.attributes));

  const eaRelationships = eaRepository.relationships;

  const activeRelEndpoints = (rel: { fromId: string; toId: string }) => {
    const from = getObj(rel.fromId);
    const to = getObj(rel.toId);
    if (!from || !to) return null;
    if (isSoftDeleted(from.attributes) || isSoftDeleted(to.attributes)) return null;
    return { from, to };
  };

  // 1) Ownership: every Capability, Application, Programme must be owned by exactly one Enterprise.
  // 0) Required fields (repository-level).
  for (const obj of activeObjects) {
    const name = typeof (obj.attributes as any)?.name === 'string' ? String((obj.attributes as any).name).trim() : '';
    if (!name) {
      addRepoFinding({
        checkId: 'EA_REQUIRED_NAME',
        severity: 'Error',
        message: `${obj.type} ‘${obj.id}’ has no name.`,
        elementId: obj.id,
        elementType: obj.type,
        collection: 'elements',
      });
    }

    const ownerId = typeof (obj.attributes as any)?.ownerId === 'string'
      ? String((obj.attributes as any).ownerId).trim()
      : '';
    if (!ownerId) {
      addRepoFinding({
        checkId: 'EA_REQUIRED_OWNER',
        severity: 'Error',
        message: `${obj.type} ‘${displayName(obj)}’ has no owner (Enterprise/Department).`,
        elementId: obj.id,
        elementType: obj.type,
        collection: 'elements',
      });
      continue;
    }

    // Allow self-ownership for owner types to support bootstrapping.
    if ((obj.type === 'Enterprise' || obj.type === 'Department') && ownerId === obj.id) {
      continue;
    }

    const owner = getObj(ownerId);
    if (!owner || isSoftDeleted(owner.attributes) || (owner.type !== 'Enterprise' && owner.type !== 'Department')) {
      addRepoFinding({
        checkId: 'EA_INVALID_OWNER',
        severity: 'Error',
        message: `${obj.type} ‘${displayName(obj)}’ has an invalid owner (must reference an existing Enterprise/Department).`,
        elementId: obj.id,
        elementType: obj.type,
        collection: 'elements',
      });
    }
  }

  // 1) Ownership: every Capability, Application, Programme must be owned by exactly one Enterprise.
  const ownedTypes = new Set<string>(['Capability', 'SubCapability', 'Application', 'Programme']);
  for (const obj of activeObjects) {
    if (!ownedTypes.has(obj.type)) continue;

    const owning = eaRelationships.filter((r) => {
      if (r.type !== 'OWNS') return false;
      if (normalizeId(r.toId) !== obj.id) return false;
      const endpoints = activeRelEndpoints(r);
      return endpoints?.from.type === 'Enterprise';
    });

    if (owning.length !== 1) {
      const expected = 'exactly one owning Enterprise';
      const got = owning.length;
      addRepoFinding({
        checkId: 'EA_ENTERPRISE_OWNERSHIP',
        severity: 'Error',
        message: `${obj.type} ‘${displayName(obj)}’ must have ${expected} via OWNS (found ${got}).`,
        elementId: obj.id,
        elementType: obj.type,
        collection: obj.type === 'Application' ? 'applications' : obj.type === 'Programme' ? 'programmes' : 'capabilities',
      });
    }
  }

  // 2) Departments cannot exist without an Enterprise.
  for (const dept of activeObjects.filter((o) => o.type === 'Department')) {
    const owningEnterpriseLinks = eaRelationships.filter((r) => {
      if (r.type !== 'HAS') return false;
      if (normalizeId(r.toId) !== dept.id) return false;
      const endpoints = activeRelEndpoints(r);
      return endpoints?.from.type === 'Enterprise';
    });

    if (owningEnterpriseLinks.length !== 1) {
      addRepoFinding({
        checkId: 'EA_DEPARTMENT_REQUIRES_ENTERPRISE',
        severity: 'Error',
        message: `Department ‘${displayName(dept)}’ must belong to exactly one Enterprise via HAS (found ${owningEnterpriseLinks.length}).`,
        elementId: dept.id,
        elementType: dept.type,
        collection: 'departments',
      });
    }
  }

  // 3) Business Capability rules: no technical terms, not owned by IT, stable lifecycle.
  for (const cap of activeObjects.filter((o) => o.type === 'Capability')) {
    const attrs = cap.attributes ?? {};
    const name = getString(attrs.name) || cap.id;
    const description = getString(attrs.description);
    const offending = findTechnicalTerm(`${name} ${description}`);
    if (offending) {
      addRepoFinding({
        checkId: 'EA_CAPABILITY_NO_TECH_TERMS',
        severity: 'Error',
        message: `Capability ‘${displayName(cap)}’ contains technical term “${offending}”.`,
        elementId: cap.id,
        elementType: cap.type,
        collection: 'capabilities',
      });
    }

    if (isItOwned((attrs as any)?.ownerRole) || isItOwned((attrs as any)?.owningUnit)) {
      addRepoFinding({
        checkId: 'EA_CAPABILITY_NO_IT_OWNERSHIP',
        severity: 'Error',
        message: `Capability ‘${displayName(cap)}’ must not be owned by IT.`,
        elementId: cap.id,
        elementType: cap.type,
        collection: 'capabilities',
      });
    }

    const lifecycleStatus = getString((attrs as any)?.lifecycleStatus);
    if (lifecycleStatus === 'Deprecated' || lifecycleStatus === 'Retired') {
      addRepoFinding({
        checkId: 'EA_CAPABILITY_STABLE_OVER_TIME',
        severity: 'Error',
        message: `Capability ‘${displayName(cap)}’ must be stable over time (not Deprecated/Retired).`,
        elementId: cap.id,
        elementType: cap.type,
        collection: 'capabilities',
      });
    }
  }

  // 3b) Business Process names must be verb-based.
  for (const proc of activeObjects.filter((o) => o.type === 'BusinessProcess')) {
    const attrs = proc.attributes ?? {};
    const name = getString(attrs.name) || proc.id;
    if (!isVerbBasedProcessName(name)) {
      addRepoFinding({
        checkId: 'EA_PROCESS_VERB_NAME',
        severity: 'Error',
        message: `BusinessProcess ‘${displayName(proc)}’ must start with a verb (e.g., “Place Order”).`,
        elementId: proc.id,
        elementType: proc.type,
        collection: 'businessProcesses',
      });
    }
  }

  // 3c) Application rules: logical (no physical terms) and must serve business processes.
  for (const app of activeObjects.filter((o) => o.type === 'Application')) {
    const attrs = app.attributes ?? {};
    const name = getString(attrs.name) || app.id;
    const description = getString(attrs.description);
    const offending = findPhysicalTerm(`${name} ${description}`);
    if (offending) {
      addRepoFinding({
        checkId: 'EA_APPLICATION_NO_PHYSICAL_TERMS',
        severity: 'Error',
        message: `Application ‘${displayName(app)}’ must be logical (no physical infrastructure term “${offending}”).`,
        elementId: app.id,
        elementType: app.type,
        collection: 'applications',
      });
    }

    const serves = eaRelationships.filter((r) => {
      if (r.type !== 'SERVED_BY') return false;
      if (normalizeId(r.toId) !== app.id) return false;
      const endpoints = activeRelEndpoints(r);
      return endpoints?.from.type === 'BusinessProcess';
    });

    if (serves.length < 1) {
      addRepoFinding({
        checkId: 'EA_APPLICATION_REQUIRES_BUSINESS_PROCESS',
        severity: 'Error',
        message: `Application ‘${displayName(app)}’ must be served to at least one BusinessProcess via SERVED_BY.`,
        elementId: app.id,
        elementType: app.type,
        collection: 'applications',
      });
    }
  }

  // 4) Application Service belongs to exactly one Application and must be used.
  for (const svc of activeObjects.filter((o) => o.type === 'ApplicationService')) {
    const providers = eaRelationships.filter((r) => {
      if (r.type !== 'PROVIDED_BY') return false;
      if (normalizeId(r.fromId) !== svc.id) return false;
      const endpoints = activeRelEndpoints(r);
      return endpoints?.to.type === 'Application';
    });

    if (providers.length !== 1) {
      addRepoFinding({
        checkId: 'EA_APPLICATION_SERVICE_REQUIRES_APPLICATION',
        severity: 'Error',
        message: `Application Service ‘${displayName(svc)}’ must belong to exactly one Application via PROVIDED_BY (found ${providers.length}).`,
        elementId: svc.id,
        elementType: svc.type,
        collection: 'applicationServices',
      });
    }

    const usages = eaRelationships.filter((r) => {
      if (r.type !== 'USED_BY') return false;
      if (normalizeId(r.fromId) !== svc.id) return false;
      const endpoints = activeRelEndpoints(r);
      return endpoints?.to.type === 'Application' || endpoints?.to.type === 'BusinessProcess';
    });

    if (usages.length < 1) {
      addRepoFinding({
        checkId: 'EA_APPLICATION_SERVICE_REQUIRES_USAGE',
        severity: 'Error',
        message: `Application Service ‘${displayName(svc)}’ must be used by at least one Application or BusinessProcess via USED_BY.`,
        elementId: svc.id,
        elementType: svc.type,
        collection: 'applicationServices',
      });
    }
  }

  // 5) Cross-layer rule: direct Technology ↔ Business links are forbidden.
  // Metamodel endpoint enforcement should prevent most invalid links, but governance must block any that slip in.
  for (const rel of eaRelationships) {
    const endpoints = activeRelEndpoints(rel);
    if (!endpoints) continue;

    const fromLayer = toBackendElementType(endpoints.from.type);
    const toLayer = toBackendElementType(endpoints.to.type);

    const isBusiness = (t: string) =>
      t === 'Enterprise' || t === 'Department' || t === 'Capability' || t === 'BusinessService' || t === 'BusinessProcess';
    const isTechnology = (t: string) => t === 'Technology';

    if ((isTechnology(fromLayer) && isBusiness(toLayer)) || (isBusiness(fromLayer) && isTechnology(toLayer))) {
      addRepoFinding({
        checkId: 'EA_FORBIDDEN_TECHNOLOGY_BUSINESS_LINK',
        severity: 'Error',
        message: `Forbidden cross-layer relationship: Technology must not link directly to Business (got ${endpoints.from.type} ‘${displayName(endpoints.from)}’ → ${endpoints.to.type} ‘${displayName(endpoints.to)}’ via ${rel.type}).`,
        elementId: `${normalizeId(rel.fromId)}->${normalizeId(rel.toId)}`,
        elementType: 'Relationship',
        collection: 'relationships',
      });
    }
  }

  const relationships = createRelationshipRepository(repo);
  const supportedElementIds = new Set<string>();
  for (const element of ([] as any[])
    .concat(repo.getElementsByType('enterprises'))
    .concat(repo.getElementsByType('capabilities'))
    .concat(repo.getElementsByType('businessServices'))
    .concat(repo.getElementsByType('businessProcesses'))
    .concat(repo.getElementsByType('departments'))
    .concat(repo.getElementsByType('applications'))
    .concat(repo.getElementsByType('applicationServices'))
    .concat(repo.getElementsByType('technologies'))
    .concat(repo.getElementsByType('programmes'))
    .concat(repo.getElementsByType('projects'))) {
    if (element?.id) supportedElementIds.add(String(element.id));
  }

  const invalidRelationshipInserts: GovernanceIssue[] = [];
  for (const [i, rel] of eaRelationships.entries()) {
    const sourceId = String(rel.fromId ?? '').trim();
    const targetId = String(rel.toId ?? '').trim();
    if (!sourceId || !targetId) continue;
    if (!supportedElementIds.has(sourceId) || !supportedElementIds.has(targetId)) continue;

    const sourceType = toBackendElementType(eaRepository.objects.get(sourceId)?.type ?? '');
    const targetType = toBackendElementType(eaRepository.objects.get(targetId)?.type ?? '');

    const relationshipAny: any = {
      id: `rel_${i}`,
      relationshipType: String(rel.type ?? '').trim(),
      sourceElementId: sourceId,
      sourceElementType: String(sourceType ?? '').trim(),
      targetElementId: targetId,
      targetElementType: String(targetType ?? '').trim(),
      direction: 'OUTGOING',
      status: 'Draft',
      effectiveFrom: now,
      effectiveTo: undefined,
      rationale: '',
      confidenceLevel: 'Medium',
      lastReviewedAt: now,
      reviewedBy: 'ui',
      createdAt: now,
      createdBy: 'ui',
    };

    if (
      relationshipAny.relationshipType === 'INTEGRATES_WITH' ||
      relationshipAny.relationshipType === 'CONSUMES' ||
      relationshipAny.relationshipType === 'DEPENDS_ON'
    ) {
      relationshipAny.dependencyStrength = (rel as any)?.attributes?.dependencyStrength;
      relationshipAny.dependencyType = (rel as any)?.attributes?.dependencyType;
      relationshipAny.runtimeCritical = (rel as any)?.attributes?.runtimeCritical;
    }

    const addRes = relationships.addRelationship(relationshipAny);
    if (!addRes.ok) {
      const modelingState = getRelationshipModelingState(sourceId, targetId, relationshipAny.relationshipType);
      const scope = scopeForRelationshipTypes(String(sourceType ?? ''), String(targetType ?? ''));
      invalidRelationshipInserts.push({
        message: `${relationshipAny.relationshipType || '(unknown)'} ${sourceId} -> ${targetId}: ${addRes.error}`,
        severity: toGovernanceSeverity('Error', modelingState),
        subjectId: `${sourceId} -> ${targetId}`,
        scope,
      });
    }
  }

  const baseRepoReport = validateArchitectureRepository(repo, nowDate);
  const repoFindings = aggregateRepoFindings([...baseRepoReport.findings, ...extraRepoFindings]);
  const repoBySeverity: Record<GovernanceSeverity, number> = { INFO: 0, WARNING: 0, ERROR: 0, BLOCKER: 0 };
  const repoByCheckId: Record<string, number> = {};
  for (const f of repoFindings) {
    increment(repoBySeverity, f.severity);
    increment(repoByCheckId, String(f.checkId));
  }

  const repoReport = {
    observedAt: baseRepoReport.observedAt,
    findings: repoFindings,
    summary: {
      total: repoFindings.length,
      bySeverity: repoBySeverity,
      byCheckId: repoByCheckId,
    },
  };

  const baseRelationshipReport = validateRelationshipRepository(repo, relationships, nowDate);
  const relationshipFindings = aggregateRelationshipFindings(baseRelationshipReport.findings);
  const relationshipBySeverity: Record<GovernanceSeverity, number> = { INFO: 0, WARNING: 0, ERROR: 0, BLOCKER: 0 };
  const relationshipByCheckId: Record<string, number> = {};
  for (const f of relationshipFindings) {
    increment(relationshipBySeverity, f.severity);
    increment(relationshipByCheckId, String(f.checkId));
  }

  const relationshipReport = {
    observedAt: baseRelationshipReport.observedAt,
    findings: relationshipFindings,
    summary: {
      total: relationshipFindings.length,
      bySeverity: relationshipBySeverity,
      byCheckId: relationshipByCheckId,
    },
  };

  const mandatoryFindingCount = repoReport.summary.total ?? 0;
  const relationshipErrorCount = (relationshipReport.summary.bySeverity.ERROR ?? 0) + (relationshipReport.summary.bySeverity.BLOCKER ?? 0);
  const relationshipWarningCount = (relationshipReport.summary.bySeverity.WARNING ?? 0) + (relationshipReport.summary.bySeverity.INFO ?? 0);
  const invalidRelationshipInsertCount = invalidRelationshipInserts.filter(
    (issue) => issue.severity === 'ERROR' || issue.severity === 'BLOCKER',
  ).length;
  const lifecycleTagMissingCount = lifecycleTagMissingIds.filter(
    (issue) => issue.severity === 'ERROR' || issue.severity === 'BLOCKER',
  ).length;

  return {
    summary: {
      mandatoryFindingCount,
      relationshipErrorCount,
      relationshipWarningCount,
      invalidRelationshipInsertCount,
      lifecycleTagMissingCount,
      total:
        mandatoryFindingCount +
        relationshipErrorCount +
        relationshipWarningCount +
        invalidRelationshipInsertCount +
        lifecycleTagMissingCount,
    },
    repoReport,
    relationshipReport,
    invalidRelationshipInserts: aggregateIssuesByScope(invalidRelationshipInserts, 'Relationship insert'),
    lifecycleTagMissingIds: aggregateIssuesByScope(lifecycleTagMissingIds, 'Lifecycle tag'),
  };
}
