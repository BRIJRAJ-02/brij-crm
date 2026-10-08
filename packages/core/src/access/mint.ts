// The seal on a scope (spec 0009, AC-138): only the door's minting functions
// make an `EngineScope`, and every engine path to the database checks it
// first, so a handler, a job or a script can't build one for another
// workspace, another actor or the system.
//
// A scope is a frozen object with an own, non enumerable property under a
// module private symbol, holding a frozen seal that names the same
// workspace, actor, access, database and limits. A spread copy loses the
// property (spread copies only enumerable ones), an object built on a real
// scope's prototype has it only through the prototype, and an unfrozen copy
// fails the freeze check, so all three are refused. The type carries the
// same symbol, so an object literal doesn't type check outside this module.
//
// The seal is a guard against mistakes, not against code in the process that
// sets out to forge one: that code could read the symbol off a real scope.
import type { Database } from '@crm/db';
import type { Limits } from '../engine/limits.ts';
import type { Actor } from '../engine/scope.ts';
import type { Access } from './policy.ts';

const SEALED: unique symbol = Symbol('crm.engineScope');

/** What the seal holds: the scope's own fields, compared by identity on every check. */
interface Seal {
  readonly workspaceId: string;
  readonly actor: Actor;
  readonly access: Access;
  readonly db: Database;
  readonly limits: Partial<Limits> | undefined;
}

/**
 * The workspace, actor and access a service acts for, and the database it
 * acts on. Only the door makes one (`enterWorkspace`, `enterAsActor`,
 * `systemScope`, `testScope`); services reach the database only through
 * `inWorkspace` and `runWrite`, which check the seal first.
 */
export interface EngineScope {
  readonly db: Database;
  readonly workspaceId: string;
  readonly actor: Actor;
  readonly access: Access;
  /** Lower limits than the defaults, for tests (and, from #38, the workspace's plan). */
  readonly limits?: Partial<Limits>;
  readonly [SEALED]: Seal;
}

/** What a minted scope is made of. */
export interface ScopeFields {
  readonly db: Database;
  readonly workspaceId: string;
  readonly actor: Actor;
  readonly access: Access;
  readonly limits?: Partial<Limits>;
}

/**
 * Seals a scope. Called only by the door (`door.ts`), the system and testing
 * entries, and the workspace bootstrap; a source scan keeps it that way.
 */
export function mintScope(fields: ScopeFields): EngineScope {
  const actor = Object.freeze({ ...fields.actor });
  const limits = fields.limits === undefined ? undefined : Object.freeze({ ...fields.limits });
  const seal: Seal = Object.freeze({
    workspaceId: fields.workspaceId,
    actor,
    access: fields.access,
    db: fields.db,
    limits,
  });
  const scope = {
    db: fields.db,
    workspaceId: fields.workspaceId,
    actor,
    access: fields.access,
    ...(limits === undefined ? {} : { limits }),
  };
  Object.defineProperty(scope, SEALED, { value: seal, enumerable: false, writable: false, configurable: false });
  return Object.freeze(scope) as EngineScope;
}

/** A scope that wasn't minted here: a programming error, answered as INTERNAL and logged. */
function forged(reason: string): Error {
  return new Error(`Refused a scope the access door did not make (${reason}).`);
}

/**
 * Refuses (throws an unexpected error, so a 500) anything but a scope the
 * door minted: one without the seal as its own property, a seal that doesn't
 * match, or a scope or seal that isn't frozen.
 */
export function checkScope(scope: EngineScope): void {
  const candidate: unknown = scope;
  if (typeof candidate !== 'object' || candidate === null) throw forged('not an object');
  if (!Object.isFrozen(candidate)) throw forged('not frozen');
  const descriptor = Object.getOwnPropertyDescriptor(candidate, SEALED);
  if (descriptor === undefined || descriptor.enumerable === true) throw forged('no seal of its own');
  const seal: unknown = descriptor.value;
  if (typeof seal !== 'object' || seal === null || !Object.isFrozen(seal)) throw forged('a loose seal');
  const sealed = seal as Seal;
  const matches =
    sealed.workspaceId === scope.workspaceId &&
    sealed.actor === scope.actor &&
    sealed.access === scope.access &&
    sealed.db === scope.db &&
    sealed.limits === scope.limits;
  if (!matches) throw forged('a seal that names another scope');
}
