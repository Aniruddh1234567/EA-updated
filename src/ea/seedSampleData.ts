import { applyEaImportBatch } from '@/pages/dependency-view/utils/eaImportUtils';
import type { EaObject, EaRelationship, EaRepository } from '@/pages/dependency-view/utils/eaRepository';
import { defaultLifecycleStateForLifecycleCoverage } from '@/repository/lifecycleCoveragePolicy';
import type { EaRepositoryMetadata } from '@/repository/repositoryMetadata';
import { isObjectTypeWritableForScope } from '@/repository/architectureScopePolicy';
import {
  isObjectTypeAllowedForReferenceFramework,
  isRelationshipTypeAllowedForReferenceFramework,
} from '@/repository/referenceFrameworkPolicy';
import { isCustomFrameworkModelingEnabled, isObjectTypeEnabledForFramework } from '@/repository/customFrameworkConfig';

export type SeedPlan = {
  objects: EaObject[];
  relationships: EaRelationship[];
  summary: {
    totalObjects: number;
    totalRelationships: number;
    elementsByType: Record<string, number>;
    relationshipsByType: Record<string, number>;
  };
  warnings: string[];
  skippedObjectTypes: string[];
  skippedRelationshipTypes: string[];
};

export const isRepositoryEffectivelyEmpty = (repo: EaRepository | null): boolean => {
  if (!repo) return true;
  for (const obj of repo.objects.values()) {
    if ((obj.attributes as any)?._deleted === true) continue;
    return false;
  }
  return repo.relationships.length === 0;
};

const nowIso = () => new Date().toISOString();

const ensureUniqueId = (base: string, used: Set<string>): string => {
  if (!used.has(base)) return base;
  let idx = 1;
  while (used.has(`${base}-${idx}`)) idx += 1;
  return `${base}-${idx}`;
};

const sampleCapabilities: Array<{ name: string; sub: string[] }> = [
  { name: 'Customer Insight & Strategy', sub: ['Customer Segmentation', 'Journey Analytics', 'Voice of the Customer'] },
  { name: 'Sales & Channel Enablement', sub: ['Lead Management', 'Digital Sales', 'Partner Engagement'] },
  { name: 'Service & Support Excellence', sub: ['Case Management', 'Knowledge Management', 'Field Service'] },
  { name: 'Product & Offering Management', sub: ['Product Roadmapping', 'Pricing & Packaging', 'Catalog Management'] },
  { name: 'Operations & Fulfilment', sub: ['Order Management', 'Inventory Visibility', 'Logistics Coordination'] },
  { name: 'Risk & Compliance', sub: ['Policy Governance', 'Control Monitoring', 'Audit Readiness'] },
  { name: 'Data & Insight Enablement', sub: ['Data Stewardship', 'Analytics Delivery', 'Data Access Management'] },
  { name: 'Technology Delivery', sub: ['Solution Design', 'Release Management', 'Platform Operations'] },
];

const sampleApplications = [
  'Customer Portal',
  'Sales CRM',
  'Field Service Mobile',
  'Order Management',
  'Product Catalog',
  'Data & Analytics Hub',
  'Integration Gateway',
  'Identity & Access',
  'Support Desk',
  'Marketing Automation',
];

const sampleTechnologies = ['API Gateway', 'Cloud PaaS', 'Container Platform', 'Analytics Warehouse', 'Messaging Bus', 'Service Mesh'];

const lifecycleForFramework = (metadata: EaRepositoryMetadata | null): string => {
  if (metadata?.referenceFramework === 'TOGAF') return 'Baseline';
  return defaultLifecycleStateForLifecycleCoverage(metadata?.lifecycleCoverage);
};

const admPhaseForFramework = (metadata: EaRepositoryMetadata | null): string | undefined => {
  if (metadata?.referenceFramework === 'TOGAF') return 'B';
  return undefined;
};

const canModelType = (
  type: string,
  metadata: EaRepositoryMetadata | null,
  opts: { customModelingEnabled: boolean },
): boolean => {
  if (!isObjectTypeWritableForScope(metadata?.architectureScope, type as any)) return false;
  if (!isObjectTypeAllowedForReferenceFramework(metadata?.referenceFramework, type as any)) return false;
  if (metadata?.referenceFramework === 'Custom') {
    if (!opts.customModelingEnabled) return false;
    if (!isObjectTypeEnabledForFramework('Custom', metadata?.frameworkConfig ?? undefined, type as any)) return false;
  }
  return true;
};

export const buildSeedPlan = (args: { repository: EaRepository; metadata: EaRepositoryMetadata | null }): SeedPlan => {
  const { repository, metadata } = args;
  const usedIds = new Set<string>(Array.from(repository.objects.keys()));
  const lifecycleState = lifecycleForFramework(metadata);
  const admPhase = admPhaseForFramework(metadata);
  const timestamp = nowIso();
  const customModelingEnabled = isCustomFrameworkModelingEnabled(metadata?.referenceFramework, metadata?.frameworkConfig);

  const objects: EaObject[] = [];
  const relationships: EaRelationship[] = [];
  const warnings: string[] = [];
  const skippedObjectTypes = new Set<string>();
  const skippedRelationshipTypes = new Set<string>();

  const pushObject = (type: string, name: string, extra?: Record<string, unknown>): string | null => {
    if (!canModelType(type, metadata, { customModelingEnabled })) {
      skippedObjectTypes.add(type);
      return null;
    }

    const baseId = `${String(type).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${objects.length + 1}`;
    const id = ensureUniqueId(baseId, usedIds);
    usedIds.add(id);

    const attrs: Record<string, unknown> = {
      name,
      description: extra?.description,
      lifecycleState,
      isSampleData: true,
      createdAt: timestamp,
      lastModifiedAt: timestamp,
      createdBy: metadata?.owner?.userId,
      lastModifiedBy: metadata?.owner?.userId,
      ...(admPhase ? { admPhase } : {}),
      ...(extra ?? {}),
    };

    objects.push({ id, type: type as any, attributes: attrs });
    return id;
  };

  const pushRelationship = (rel: { fromId: string; toId: string; type: string; attributes?: Record<string, unknown> }) => {
    if (!isRelationshipTypeAllowedForReferenceFramework(metadata?.referenceFramework, rel.type)) {
      skippedRelationshipTypes.add(rel.type);
      return;
    }
    relationships.push({
      ...rel,
      attributes: {
        isSampleData: true,
        createdAt: timestamp,
        lastModifiedAt: timestamp,
        ...(rel.attributes ?? {}),
      },
    });
  };

  // Enterprise root
  const enterpriseId = pushObject('Enterprise', 'Sample Enterprise', {
    description: 'Seeded sample enterprise to anchor capabilities, applications, and technology.',
  });
  if (!enterpriseId) {
    warnings.push('Enterprise seed not created (blocked by scope or meta-model).');
  }

  // Capabilities + sub-capabilities
  const selectedCapabilities = sampleCapabilities.slice(0, 8);
  const capabilityIds: string[] = [];
  const subCapabilityIds: string[] = [];

  selectedCapabilities.forEach((cap, idx) => {
    const capId = pushObject('Capability', cap.name, { category: 'Sample Capability', order: idx + 1 });
    if (!capId) return;
    capabilityIds.push(capId);

    const subDefs = cap.sub.slice(0, 4);
    subDefs.forEach((sub, subIdx) => {
      const subId = pushObject('SubCapability', `${cap.name} - ${sub}`, {
        category: 'Sample SubCapability',
        parentCapabilityId: capId,
        order: subIdx + 1,
      });
      if (!subId) return;
      subCapabilityIds.push(subId);
      pushRelationship({ fromId: capId, toId: subId, type: 'COMPOSED_OF' });
    });
  });

  // Applications
  const applicationIds: string[] = [];
  sampleApplications.slice(0, 10).forEach((appName) => {
    const appId = pushObject('Application', appName, { criticality: 'Medium' });
    if (!appId) return;
    applicationIds.push(appId);
  });

  // Technologies
  const technologyIds: string[] = [];
  sampleTechnologies.slice(0, 6).forEach((techName) => {
    const techId = pushObject('Technology', techName, { category: 'Platform' });
    if (!techId) return;
    technologyIds.push(techId);
  });

  // Capability → Application support mapping (use modulo for even distribution)
  if (capabilityIds.length > 0 && applicationIds.length > 0) {
    applicationIds.forEach((appId, idx) => {
      const targetCap = capabilityIds[idx % capabilityIds.length];
      pushRelationship({ fromId: targetCap, toId: appId, type: 'SUPPORTED_BY' });
    });
  } else if (applicationIds.length > 0) {
    warnings.push('Skipped capability → application support links because capabilities were not created.');
  }

  // Application → Technology deployment
  if (technologyIds.length > 0 && applicationIds.length > 0) {
    applicationIds.forEach((appId, idx) => {
      const targetTech = technologyIds[idx % technologyIds.length];
      pushRelationship({ fromId: appId, toId: targetTech, type: 'DEPLOYED_ON' });
    });
  } else if (applicationIds.length > 0) {
    warnings.push('Skipped application → technology deployment links because technologies were not created.');
  }

  // Optional enterprise ownership for capabilities/applications (only when enterprise exists and allowed)
  if (enterpriseId) {
    [...capabilityIds, ...applicationIds].forEach((id) => {
      pushRelationship({ fromId: enterpriseId, toId: id, type: 'OWNS' });
    });
  }

  const elementsByType: Record<string, number> = {};
  objects.forEach((o) => {
    elementsByType[o.type] = (elementsByType[o.type] ?? 0) + 1;
  });

  const relationshipsByType: Record<string, number> = {};
  relationships.forEach((r) => {
    relationshipsByType[r.type] = (relationshipsByType[r.type] ?? 0) + 1;
  });

  return {
    objects,
    relationships,
    summary: {
      totalObjects: objects.length,
      totalRelationships: relationships.length,
      elementsByType,
      relationshipsByType,
    },
    warnings,
    skippedObjectTypes: Array.from(skippedObjectTypes),
    skippedRelationshipTypes: Array.from(skippedRelationshipTypes),
  };
};

export const applySeedPlan = (repo: EaRepository, plan: SeedPlan) => {
  return applyEaImportBatch(repo, {
    objects: plan.objects,
    relationships: plan.relationships,
  });
};
