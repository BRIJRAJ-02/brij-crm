// The access door (spec 0005, the start of #9; spec 0009): the only place a
// principal becomes the engine's scope. `enterWorkspace` lets a signed in
// member in, `enterAsActor` re-enters a member for work they started (the
// worker's jobs), `systemScope` is the system's, and `enterWithKey` is #34's.
// Each reads the member's role in the one tenant round trip, works out their
// access through the pure policy, and seals both into the scope (`mint.ts`).
//
// The directory only finds the workspace's id; access comes from the tenant
// `members` row, read inside withWorkspace() under row level security. An
// unknown address, a workspace the user isn't in, a removed member, a deleted
// workspace and a role the code doesn't know are all refused the same way, so
// nothing leaks whether a workspace exists.
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Database, type IdentityStore } from '@crm/db';
import { isUuid } from '../engine/ids.ts';
import { refuse, type RefusalError } from '../engine/refusals.ts';
import { SYSTEM_ACTOR, type Actor } from '../engine/scope.ts';
import { mintScope, type EngineScope } from './mint.ts';
import { isRole, NO_RULES, roleAccess, SYSTEM_ACCESS, type AccessRules } from './policy.ts';

const { members, workspaces } = schema;

/** Where the door reports a member row it refused for a role the code doesn't know (the member id only). */
export interface DoorLog {
  warn(message: string, fields: { readonly memberId: string }): void;
}

/** What the door needs: the tenant database, and the directory to find a workspace by its address. */
export interface DoorDeps {
  readonly db: Database;
  readonly identity: Pick<IdentityStore, 'findWorkspace'>;
  /** Where an unknown role is reported. Nothing is reported without one. */
  readonly log?: DoorLog;
}

/** Who is knocking (`auth.user.id`, from the session) and which workspace address they asked for. */
export interface DoorInput {
  readonly userId: string;
  readonly slug: string;
}

function notFound(): RefusalError {
  return refuse('NOT_FOUND', "That workspace doesn't exist, or you're not a member of it.");
}

/** A member row as the door reads it: its id, its user, and its role as stored (checked against the catalog). */
interface MemberRow {
  readonly id: string;
  readonly userId: string | null;
  readonly role: string;
}

/** The workspace's active member matching `which`, in a live workspace, with its role: one tenant round trip. */
async function activeMember(
  db: Database,
  workspaceId: string,
  which: { readonly userId: string } | { readonly memberId: string },
): Promise<MemberRow | undefined> {
  const [member] = await db.withWorkspace(workspaceId, (tx) =>
    tx
      .select({ id: members.id, userId: members.userId, role: members.role })
      .from(members)
      .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
      .where(
        and(
          'userId' in which ? eq(members.userId, which.userId) : eq(members.id, which.memberId),
          eq(members.status, 'active'),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1),
  );
  return member;
}

/**
 * The scope for an active member, or NOT_FOUND for a role the code doesn't
 * know (fail closed, reported with the member id only). `rules` are the
 * workspace's rules: none until #24 stores them; only tests pass any.
 */
function memberScope(
  deps: Pick<DoorDeps, 'db' | 'log'>,
  workspaceId: string,
  member: MemberRow,
  rules: AccessRules,
): EngineScope {
  if (!isRole(member.role)) {
    deps.log?.warn('Refused a member whose role the code does not know', { memberId: member.id });
    throw notFound();
  }
  const access = roleAccess(
    {
      kind: 'member',
      memberId: member.id,
      ...(member.userId === null ? {} : { userId: member.userId }),
      role: member.role,
      teamIds: [],
    },
    rules,
  );
  return mintScope({ db: deps.db, workspaceId, actor: { type: 'member', id: member.id }, access });
}

/**
 * Turns a signed in user and a workspace slug into the engine's scope, or
 * refuses with NOT_FOUND. The actor is the user's active member row in that
 * workspace, and the access is their role's (AC-134: an unknown role is
 * refused like a non member).
 */
export async function enterWorkspace(deps: DoorDeps, input: DoorInput): Promise<EngineScope> {
  if (!isUuid(input.userId)) throw notFound();
  const workspace = await deps.identity.findWorkspace(input.slug);
  if (workspace === undefined) throw notFound();
  const member = await activeMember(deps.db, workspace.id, { userId: input.userId });
  if (member === undefined) throw notFound();
  return memberScope(deps, workspace.id, member, NO_RULES);
}

/** What `enterAsActor` needs: the tenant database, and where to report an unknown role. */
export interface ActorDoorDeps {
  readonly db: Database;
  readonly log?: DoorLog;
}

/**
 * The scope for work a member started (spec 0009, AC-147; spec 0008's jobs),
 * entered again when the work runs: the member's current role, so a member
 * demoted since runs with the new one, and NOT_FOUND for one removed since (a
 * job then ends `ACTOR_REMOVED`), for a deleted workspace, and for any actor
 * that isn't a member. System work uses `systemScope` instead. Exported only
 * from `@crm/core/system`.
 */
export async function enterAsActor(
  deps: ActorDoorDeps,
  input: { readonly workspaceId: string; readonly actor: Actor },
): Promise<EngineScope> {
  const { workspaceId, actor } = input;
  if (!isUuid(workspaceId) || actor.type !== 'member' || actor.id === null || !isUuid(actor.id)) throw notFound();
  const member = await activeMember(deps.db, workspaceId, { memberId: actor.id });
  if (member === undefined) throw notFound();
  return memberScope(deps, workspaceId, member, NO_RULES);
}

/**
 * The scope for an API key (#34), which stores keys and builds their access
 * with `keyAccess`. No key exists yet, so every key is refused NOT_FOUND.
 */
export function enterWithKey(
  _deps: { readonly db: Database },
  _input: { readonly workspaceId: string; readonly keyId: string },
): Promise<EngineScope> {
  return Promise.reject(notFound());
}

/**
 * The system's scope in a workspace: the system actor, every permission and
 * the open policy. Only for system work (the purge, recomputes, the daily
 * cleanup, the relay, the workspace bootstrap). Exported only from
 * `@crm/core/system`.
 */
export function systemScope(db: Database, workspaceId: string): EngineScope {
  return mintScope({ db, workspaceId, actor: SYSTEM_ACTOR, access: SYSTEM_ACCESS });
}
