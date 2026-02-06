import type { BaseArchitectureRelationship } from './BaseArchitectureRelationship';

/**
 * Capability → BusinessProcess traceability relationship.
 *
 * Semantics:
 * - Typed, directional, auditable relationship for business architecture decomposition.
 * - No execution semantics are implied.
 * - No linkage to applications.
 */
export type CapabilityToProcessRelationship = BaseArchitectureRelationship & {
  relationshipType: 'REALIZED_BY';

  sourceElementType: 'Capability';
  targetElementType: 'BusinessProcess';

  direction: 'OUTGOING';
};

export type CapabilityToProcessConstraintValidationSuccess = { ok: true };
export type CapabilityToProcessConstraintValidationFailure = { ok: false; errors: string[] };
export type CapabilityToProcessConstraintValidationResult =
  | CapabilityToProcessConstraintValidationSuccess
  | CapabilityToProcessConstraintValidationFailure;

/**
 * Enforces the governance constraint:
 * - A Process must belong to exactly one Capability.
 * - Therefore: a BusinessProcess (targetElementId) must not appear under multiple sourceElementId values.
 */
export function validateCapabilityToProcessConstraints(
  relationships: ReadonlyArray<CapabilityToProcessRelationship>,
): CapabilityToProcessConstraintValidationResult {
  const errors: string[] = [];
  const parentByProcessId = new Map<string, string>();

  for (const rel of relationships) {
    const processId = (rel.targetElementId ?? '').trim();
    const capabilityId = (rel.sourceElementId ?? '').trim();

    if (!capabilityId) {
      errors.push(`CapabilityToProcessRelationship: sourceElementId is required.`);
      continue;
    }

    if (!processId) {
      errors.push(`CapabilityToProcessRelationship: targetElementId is required.`);
      continue;
    }

    const existing = parentByProcessId.get(processId);
    if (existing && existing !== capabilityId) {
      errors.push(
        `BusinessProcess "${processId}" has multiple parent Capabilities ("${existing}" and "${capabilityId}").`,
      );
      continue;
    }

    parentByProcessId.set(processId, capabilityId);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}
