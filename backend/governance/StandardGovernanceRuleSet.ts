import type { GovernanceRule } from './GovernanceRule';

/**
 * Standard Governance Rule Set (read-only).
 *
 * Baseline enterprise governance intent, expressed declaratively.
 * - No execution
 * - No persistence
 * - No UI
 * - No deletion / modification (frozen exports)
 */

const BASELINE_CREATED_AT = '2026-01-11T00:00:00.000Z';

const freezeRule = (rule: GovernanceRule): Readonly<GovernanceRule> => {
  const frozen: GovernanceRule = {
    ...rule,
    applicableElementTypes: Object.freeze([...rule.applicableElementTypes]),
    applicableRelationshipTypes: rule.applicableRelationshipTypes
      ? Object.freeze([...(rule.applicableRelationshipTypes ?? [])])
      : undefined,
  };

  return Object.freeze(frozen);
};

export const STANDARD_GOVERNANCE_RULE_SET_VERSION = 1 as const;

export const STANDARD_GOVERNANCE_RULE_SET = Object.freeze([
  // --- Completeness ---
  freezeRule({
    ruleId: 'b9f0b0a8-0c0a-4b4b-9c7c-7c7243a6b032',
    ruleName: 'Application must have an owner',
    ruleCategory: 'Completeness',
    applicableElementTypes: ['Application'],
    ruleExpression:
      "FOR Element WHERE elementType='Application' REQUIRE ownerRole, ownerName, owningUnit are non-empty strings",
    severity: 'Warning',
    rationale: 'Ownership establishes accountability for investment, risk decisions, and change approvals.',
    ownerRole: 'EA Governance Board',
    enabled: true,
    createdAt: BASELINE_CREATED_AT,
    lastModifiedAt: BASELINE_CREATED_AT,
  }),

  freezeRule({
    ruleId: '7d1e4b5f-1f22-4b20-8e7f-4f07a1f7e28e',
    ruleName: 'Application must have lifecycle status',
    ruleCategory: 'Completeness',
    applicableElementTypes: ['Application'],
    ruleExpression:
      "FOR Element WHERE elementType='Application' REQUIRE lifecycleStatus is one of {Planned, Active, Deprecated, Retired}",
    severity: 'Warning',
    rationale: 'Lifecycle status is required for roadmap planning and reliable impact analysis.',
    ownerRole: 'EA Governance Board',
    enabled: true,
    createdAt: BASELINE_CREATED_AT,
    lastModifiedAt: BASELINE_CREATED_AT,
  }),

  freezeRule({
    ruleId: 'c4c0a50a-6f7e-4f3b-9c58-1d9c6d2c6a1f',
    ruleName: 'Capability must have strategic importance',
    ruleCategory: 'Completeness',
    applicableElementTypes: ['Capability'],
    ruleExpression:
      "FOR Element WHERE elementType='Capability' REQUIRE strategicImportance is one of {High, Medium, Low}",
    severity: 'Warning',
    rationale: 'Strategic importance supports prioritization, investment decisions, and value-stream alignment.',
    ownerRole: 'EA Governance Board',
    enabled: true,
    createdAt: BASELINE_CREATED_AT,
    lastModifiedAt: BASELINE_CREATED_AT,
  }),

  // --- Consistency ---
  freezeRule({
    ruleId: '1d5a1b77-46e1-4f8a-bb2d-3cc4e7dce03b',
    ruleName: 'Retired elements must not have active dependencies',
    ruleCategory: 'Consistency',
    applicableElementTypes: ['Application'],
    applicableRelationshipTypes: ['INTEGRATES_WITH'],
    ruleExpression:
      "FOR Relationship WHERE relationshipType IN {'INTEGRATES_WITH'} AND status='Approved' REQUIRE source.lifecycleStatus != 'Retired' AND target.lifecycleStatus != 'Retired'",
    severity: 'Error',
    rationale: 'Active dependencies on retired items break trust in dependency graphs and invalidate impact conclusions.',
    ownerRole: 'EA Governance Board',
    enabled: true,
    createdAt: BASELINE_CREATED_AT,
    lastModifiedAt: BASELINE_CREATED_AT,
  }),

  freezeRule({
    ruleId: '4b8f7a3e-9b6d-4d2b-97e1-3c4a7d9ef52c',
    ruleName: 'Deprecated technology must not host active applications',
    ruleCategory: 'Consistency',
    applicableElementTypes: ['Application', 'Technology'],
    applicableRelationshipTypes: ['DEPLOYED_ON'],
    ruleExpression:
      "FOR Relationship WHERE relationshipType='DEPLOYED_ON' AND status='Approved' REQUIRE NOT (target.lifecycleStatus='Deprecated' AND source.lifecycleStatus='Active')",
    severity: 'Error',
    rationale: 'Hosting active applications on deprecated technology increases operational risk and undermines platform standards.',
    ownerRole: 'EA Governance Board',
    enabled: true,
    createdAt: BASELINE_CREATED_AT,
    lastModifiedAt: BASELINE_CREATED_AT,
  }),

  // --- Lifecycle ---
  freezeRule({
    ruleId: '3f5d0d2a-54af-4a77-b6c5-9c1d3f22b88a',
    ruleName: 'Applications past lifecycleEndDate must be flagged',
    ruleCategory: 'Lifecycle',
    applicableElementTypes: ['Application'],
    ruleExpression:
      "FOR Element WHERE elementType='Application' IF lifecycleEndDate is set AND lifecycleEndDate < today THEN flag",
    severity: 'Warning',
    rationale: 'Past-end-date applications require decision: retire, extend, or migrate to reduce unmanaged risk.',
    ownerRole: 'EA Governance Board',
    enabled: true,
    createdAt: BASELINE_CREATED_AT,
    lastModifiedAt: BASELINE_CREATED_AT,
  }),

  freezeRule({
    ruleId: 'a2d6c8c0-50d1-4e7a-8b8d-2b0ac2a7a8dd',
    ruleName: 'Technologies past supportEndDate must be flagged',
    ruleCategory: 'Lifecycle',
    applicableElementTypes: ['Technology'],
    ruleExpression:
      "FOR Element WHERE elementType='Technology' IF supportEndDate is set AND supportEndDate < today THEN flag",
    severity: 'Warning',
    rationale: 'Out-of-support technology increases operational and security risk and should trigger remediation planning.',
    ownerRole: 'EA Governance Board',
    enabled: true,
    createdAt: BASELINE_CREATED_AT,
    lastModifiedAt: BASELINE_CREATED_AT,
  }),

  // --- Risk ---
  freezeRule({
    ruleId: 'df2c3a6c-0b18-4d6b-9e5c-6a2d7c2a0f3e',
    ruleName: 'Mission-critical applications with only soft dependencies must be flagged',
    ruleCategory: 'Risk',
    applicableElementTypes: ['Application'],
    applicableRelationshipTypes: ['INTEGRATES_WITH'],
    ruleExpression:
      "FOR Element WHERE elementType='Application' AND businessCriticality='Mission-Critical' REQUIRE EXISTS outgoing relationshipType IN {'INTEGRATES_WITH'} WITH dependencyStrength='Hard'",
    severity: 'Warning',
    rationale: 'Mission-critical systems typically require at least one hard dependency classification to reflect operational coupling and impact.',
    ownerRole: 'EA Governance Board',
    enabled: true,
    createdAt: BASELINE_CREATED_AT,
    lastModifiedAt: BASELINE_CREATED_AT,
  }),

  freezeRule({
    ruleId: '0a5f3c1a-1bb5-4e1e-8b7e-6c9a1b2d3e4f',
    ruleName: 'High technical debt with high criticality must be flagged',
    ruleCategory: 'Risk',
    applicableElementTypes: ['Application'],
    ruleExpression:
      "FOR Element WHERE elementType='Application' IF technicalDebtLevel='High' AND businessCriticality IN {'Mission-Critical','High'} THEN flag",
    severity: 'Warning',
    rationale: 'High technical debt in critical applications elevates incident risk and constrains change capacity.',
    ownerRole: 'EA Governance Board',
    enabled: true,
    createdAt: BASELINE_CREATED_AT,
    lastModifiedAt: BASELINE_CREATED_AT,
  }),
] as const);

export type StandardGovernanceRuleSet = typeof STANDARD_GOVERNANCE_RULE_SET;
