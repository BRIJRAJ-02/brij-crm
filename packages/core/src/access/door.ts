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
import { schema, type Database, type IdentityStore, type WorkspaceTx } from '@crm/db';
import { isUuid } from '../engine/ids.ts';
import { refuse, type RefusalError } from '../engine/refusals.ts';
import { SYSTEM_ACTOR, type Actor } from '../engine/scope.ts';
import { mintScope, type EngineScope } from './mint.ts';
import { isRole, NO_RULES, roleAccess, SYSTEM_ACCESS, type AccessRules } from './policy.ts';

/**
 * Where the door reads a workspace's object, field and record rules, inside
 * its one tenant transaction (spec 0009, milestone 2): given the member it is
 * letting in. #24 stores rules and reads them here; until then production
 * passes nothing, so every member gets `NO_RULES`, and only tests (and the
 * api's local test server) inject rules.
 */
export type RuleSource = (
  tx: WorkspaceTx,
  member: { readonly memberId: string; readonly role: string },
) => Promise<AccessRules>;

/** No rules at all, with no query: production's source until #24. */
export const NO_RULE_SOURCE: RuleSource = () => Promise.resolve(NO_RULES);

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
  /** Where the workspace's rules come from: none (`NO_RULE_SOURCE`) unless given. */
  readonly rules?: RuleSource;
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

/**
 * The workspace's active member matching `which`, in a live workspace, with
 * its role, and the rules that apply (read by `rules` in the same
 * transaction): one tenant round trip.
 */
async function activeMember(
  db: Database,
  workspaceId: string,
  which: { readonly userId: string } | { readonly memberId: string },
  rules: RuleSource,
): Promise<{ readonly member: MemberRow; readonly rules: AccessRules } | undefined> {
  return db.withWorkspace(workspaceId, async (tx) => {
    const [member] = await tx
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
      .limit(1);
    if (member === undefined) return undefined;
    // An unknown role is refused before any rule is read, and its rules don't matter.
    if (!isRole(member.role)) return { member, rules: NO_RULES };
    return { member, rules: await rules(tx, { memberId: member.id, role: member.role }) };
  });
}

/**
 * The scope for an active member, or NOT_FOUND for a role the code doesn't
 * know (fail closed, reported with the member id only). `rules` are the ones
 * the door's `RuleSource` read: none until #24 stores them; only tests pass any.
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
  const found = await activeMember(deps.db, workspace.id, { userId: input.userId }, deps.rules ?? NO_RULE_SOURCE);
  if (found === undefined) throw notFound();
  return memberScope(deps, workspace.id, found.member, found.rules);
}

/** What `enterAsActor` needs: the tenant database, where to report an unknown role, and where rules come from. */
export interface ActorDoorDeps {
  readonly db: Database;
  readonly log?: DoorLog;
  readonly rules?: RuleSource;
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
  const found = await activeMember(deps.db, workspaceId, { memberId: actor.id }, deps.rules ?? NO_RULE_SOURCE);
  if (found === undefined) throw notFound();
  return memberScope(deps, workspaceId, found.member, found.rules);
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
