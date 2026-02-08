import type { ArchitectureScope } from '@/repository/repositoryMetadata';
import {
  OBJECT_TYPE_DEFINITIONS,
  type ObjectType,
  isValidObjectType,
} from '@/pages/dependency-view/utils/eaMetaModel';

export type WritableLayer = 'Business' | 'Application' | 'Technology';

export function isObjectTypeWritableForScope(
  _architectureScope: ArchitectureScope | null | undefined,
  _objectType: ObjectType,
): boolean {
  // Full access — no scope restrictions.
  return true;
}

export function isAnyObjectTypeWritableForScope(
  architectureScope: ArchitectureScope | null | undefined,
  objectType: string | null | undefined,
): boolean {
  if (!objectType) return false;
  if (!isValidObjectType(objectType)) return false;
  return isObjectTypeWritableForScope(architectureScope, objectType);
}

export function getReadOnlyReason(
  _architectureScope: ArchitectureScope | null | undefined,
  _objectType: string | null | undefined,
): string | null {
  // Full access — no scope restrictions.
  return null;
}
