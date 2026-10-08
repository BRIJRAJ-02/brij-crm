// The permission check every service with a `{ permission }` entry in the
// access table makes first (spec 0009, AC-135): a missing workspace
// permission on something the actor can see is 403 FORBIDDEN with the
// catalog's sentence, before anything is read or written.
import { PERMISSIONS, type Permission } from '@crm/contracts';
import { refuse } from '../engine/refusals.ts';
import { checkScope, type EngineScope } from './mint.ts';
import { can } from './policy.ts';

/** Refuses FORBIDDEN, with the permission's catalog sentence, unless the scope's access holds `permission`. */
export function requirePermission(scope: EngineScope, permission: Permission): void {
  checkScope(scope);
  if (!can(scope.access, permission)) throw refuse('FORBIDDEN', PERMISSIONS[permission].message);
}
