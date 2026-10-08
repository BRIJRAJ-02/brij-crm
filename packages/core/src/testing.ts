// `@crm/core/testing`: scopes for tests and scripts (spec 0009, AC-138). The
// same seal the door uses, with the role, rules and limits a test chooses.
// Lint allows this import only in tests and scripts.
import { KEY_SCOPES, type Role } from '@crm/contracts';
import type { Database } from '@crm/db';
import { mintScope, type EngineScope } from './access/mint.ts';
import { keyAccess, NO_RULES, roleAccess, SYSTEM_ACCESS, type Access, type AccessRules } from './access/policy.ts';
import type { Limits } from './engine/limits.ts';
import type { Actor } from './engine/scope.ts';

/** What a test scope is made of. */
export interface TestScopeInput {
  readonly db: Database;
  readonly workspaceId: string;
  /** Who acts: a member (with `role`, an owner by default), an API key (with `scopes`), or the system. */
  readonly actor: Actor;
  readonly role?: Role;
  /** Rules injected as #24 will store them (none by default). */
  readonly rules?: AccessRules;
  /** An API key's scopes: every key scope, with write on every object, by default. */
  readonly scopes?: readonly string[];
  readonly limits?: Partial<Limits>;
}

function accessOf(input: TestScopeInput): Access {
  const { actor } = input;
  if (actor.type === 'system') return SYSTEM_ACCESS;
  if (actor.id === null) throw new Error('Only the system acts with no id.');
  if (actor.type === 'api_key') return keyAccess(actor.id, input.scopes ?? KEY_SCOPES);
  if (actor.type === 'member') {
    return roleAccess(
      { kind: 'member', memberId: actor.id, role: input.role ?? 'owner', teamIds: [] },
      input.rules ?? NO_RULES,
    );
  }
  throw new Error('An automation has no access of its own yet.');
}

/**
 * A test scope like `scope`, with another actor, database, role or limits: a
 * spread copy is refused by every engine service, so tests change a scope
 * through this. The role carries over from a member scope unless given.
 */
export function rescope(scope: EngineScope, changes: Partial<Omit<TestScopeInput, 'workspaceId'>>): EngineScope {
  const { principal } = scope.access;
  const role = changes.role ?? (principal.kind === 'member' ? principal.role : undefined);
  const limits = changes.limits ?? scope.limits;
  return testScope({
    db: changes.db ?? scope.db,
    workspaceId: scope.workspaceId,
    actor: changes.actor ?? scope.actor,
    ...(role === undefined ? {} : { role }),
    ...(changes.rules === undefined ? {} : { rules: changes.rules }),
    ...(changes.scopes === undefined ? {} : { scopes: changes.scopes }),
    ...(limits === undefined ? {} : { limits }),
  });
}

/**
 * A sealed scope for a test or a script: a member with their role (an owner
 * unless `role` says otherwise) and any injected `rules`, an API key with its
 * scopes, or the system with every permission. An automation actor has no
 * access of its own yet, so it is refused.
 */
export function testScope(input: TestScopeInput): EngineScope {
  return mintScope({
    db: input.db,
    workspaceId: input.workspaceId,
    actor: input.actor,
    access: accessOf(input),
    ...(input.limits === undefined ? {} : { limits: input.limits }),
  });
}
