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
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type Database, type IdentityStore, type WorkspaceTx } from '@crm/db';
import { isUuid } from '../engine/ids.ts';
import { refuse, type RefusalError } from '../engine/refusals.ts';
import { SYSTEM_ACTOR, type Actor } from '../engine/scope.ts';
import { FORM_SLUG, INVITE_INVALID_MESSAGE } from '@crm/contracts';
import { mintScope, rescope, type EngineScope } from './mint.ts';
import {
  bookingAccess,
  formAccess,
  isRole,
  NO_RULES,
  roleAccess,
  SYSTEM_ACCESS,
  type Access,
  type AccessRules,
} from './policy.ts';

/**
 * Where the door reads a workspace's object, field and record rules, inside
 * its one tenant transaction (spec 0009, milestone 2): given the member it is
 * letting in. #24 stores rules and reads them here; until then production
 * passes `NO_RULE_SOURCE` (the api's `APP_RULES`, to its requests and its
 * worker alike), so every member gets `NO_RULES`, and only tests (and the
 * api's local test server) inject rules.
 */
export type RuleSource = (
  tx: WorkspaceTx,
  member: { readonly memberId: string; readonly role: string },
) => Promise<AccessRules>;

/** No rules at all, with no query: production's source until #24. */
export const NO_RULE_SOURCE: RuleSource = () => Promise.resolve(NO_RULES);

const { members, objects, workspaces } = schema;

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
  /**
   * Where the workspace's rules come from, always named: `NO_RULE_SOURCE`
   * until #24 stores rules. There is no default, so no door opens without
   * them by leaving them out.
   */
  readonly rules: RuleSource;
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
  const found = await activeMember(deps.db, workspace.id, { userId: input.userId }, deps.rules);
  if (found === undefined) throw notFound();
  return memberScope(deps, workspace.id, found.member, found.rules);
}

/** A deleted workspace an owner may still restore, and the scope to restore it with. */
export interface DeletedEntry {
  readonly scope: EngineScope;
  readonly name: string;
  readonly slug: string;
  /** When the purge may take it, ISO 8601. */
  readonly purgeAfter: string;
}

/**
 * The way into a deleted workspace (spec 0031, AC-823), for its active
 * owners only and only within its window: the scope `restoreWorkspace` acts
 * with, and what the restore page shows. Anyone else, a live workspace, and
 * one past its window are all NOT_FOUND, the same as an unknown address, so
 * nothing says a deleted workspace exists to anyone who couldn't restore it.
 */
export async function enterDeletedWorkspace(deps: DoorDeps, input: DoorInput): Promise<DeletedEntry> {
  if (!isUuid(input.userId)) throw notFound();
  const workspace = await deps.identity.findWorkspace(input.slug);
  if (workspace === undefined) throw notFound();
  const found = await deps.db.withWorkspace(workspace.id, async (tx) => {
    const [row] = await tx
      .select({
        id: members.id,
        userId: members.userId,
        role: members.role,
        name: workspaces.name,
        slug: workspaces.slug,
        purgeAfter: workspaces.purgeAfter,
      })
      .from(members)
      .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
      .where(
        and(
          eq(members.userId, input.userId),
          eq(members.status, 'active'),
          eq(members.role, 'owner'),
          sql`${workspaces.deletedAt} is not null and ${workspaces.purgeAfter} > now()`,
        ),
      )
      .limit(1);
    return row;
  });
  if (found === undefined || found.purgeAfter === null) throw notFound();
  const scope = memberScope(deps, workspace.id, found, NO_RULES);
  return { scope, name: found.name, slug: found.slug, purgeAfter: new Date(found.purgeAfter).toISOString() };
}

/**
 * What `enterAsActor` needs: the tenant database, where to report an unknown
 * role, and where rules come from, always named and the same source the
 * member's requests use, so a job never runs with less than its member's
 * rules (spec 0009, AC-147).
 */
export interface ActorDoorDeps {
  readonly db: Database;
  readonly log?: DoorLog;
  readonly rules: RuleSource;
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
  const found = await activeMember(deps.db, workspaceId, { memberId: actor.id }, deps.rules);
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

/** The nil uuid: a workspace no row has, for the reads that find a form's or a booking page's workspace by a key. */
const NO_WORKSPACE = '00000000-0000-0000-0000-000000000000';

/** What a public key that names no form answers: the same for a malformed key and an unknown one. */
function noForm(): RefusalError {
  return refuse('NOT_FOUND', 'That form does not exist.');
}

/** A form address's shape (spec 0023, AC-552): anything else names no form and never reaches the database. */
const PUBLIC_KEY = FORM_SLUG;

/** Whether a workspace is live (not deleted, spec 0031, AC-823): a public way in to a deleted one is not found. */
async function isLive(db: Database, workspaceId: string): Promise<boolean> {
  return db.withWorkspace(workspaceId, async (tx) => {
    const [workspace] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)));
    return workspace !== undefined;
  });
}

/**
 * The scope a public form endpoint acts in (spec 0023): the workspace and
 * form a public key names, found through `crm_form_by_key` (ids only), the
 * form as the actor, and no data access at all. NOT_FOUND for a malformed
 * or unknown key, and for a deleted workspace. Whether the form is live is
 * the caller's next read.
 */
export async function enterPublicForm(
  deps: { readonly db: Database },
  publicKey: string,
): Promise<{ readonly scope: EngineScope; readonly formId: string }> {
  if (!PUBLIC_KEY.test(publicKey)) throw noForm();
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<{ workspace_id: string; form_id: string }>(
      sql`select workspace_id::text, form_id::text from crm_form_by_key(${publicKey})`,
    ),
  );
  const [row] = found.rows;
  if (row === undefined || !(await isLive(deps.db, row.workspace_id))) throw noForm();
  const scope = mintScope({
    db: deps.db,
    workspaceId: row.workspace_id,
    actor: { type: 'form', id: row.form_id },
    access: formAccess(row.form_id),
  });
  return { scope, formId: row.form_id };
}

/**
 * System work acting as a form (spec 0023, processing a submission): the
 * same workspace and database as the system's `scope`, the form as the
 * actor, and the access its published mapping gives (`formAccess`). Refuses
 * (a programming error) from any scope but the system's.
 */
export function enterAsForm(scope: EngineScope, formId: string, access: Access): EngineScope {
  if (scope.actor.type !== 'system' || access.principal.kind !== 'form' || access.principal.formId !== formId) {
    throw new Error('Only system work acts as a form, with that form’s own access.');
  }
  return rescope(scope, { type: 'form', id: formId }, access);
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

/** The SHA-256 of an invitation token, as the database stores it (64 lowercase hex digits). */
export function inviteTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** An invitation token's shape (spec 0031): 32 random bytes, base64url. Anything else names nothing. */
const INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** What every invalid invitation answers (AC-805), whatever the reason. */
export function inviteInvalid(): RefusalError {
  return refuse('INVITE_INVALID', INVITE_INVALID_MESSAGE);
}

/**
 * The system's scope in the workspace an invitation token names, and the
 * invitation's id (spec 0031, AC-805, AC-806): found by the token's SHA-256
 * through `crm_invitation_by_token` (ids only), before any member scope can
 * exist. A malformed or unknown token is `INVITE_INVALID`; whether the
 * invitation still works, and for whom, is the caller's next read, inside
 * the workspace. Exported to the invitation services only.
 */
export async function enterInvitation(
  deps: { readonly db: Database },
  token: string,
): Promise<{ readonly scope: EngineScope } & EnteredInvitation> {
  if (!INVITE_TOKEN.test(token)) throw inviteInvalid();
  const hash = inviteTokenHash(token);
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<{ workspace_id: string; invitation_id: string }>(
      sql`select workspace_id::text as workspace_id, invitation_id::text as invitation_id from crm_invitation_by_token(${hash})`,
    ),
  );
  const [row] = found.rows;
  if (row === undefined) throw inviteInvalid();
  return { scope: systemScope(deps.db, row.workspace_id), invitationId: row.invitation_id, tokenHash: hash };
}

/** The invitation a token named: its id, and the token's hash, read again with it so a replaced link opens nothing. */
export interface EnteredInvitation {
  readonly invitationId: string;
  readonly tokenHash: string;
}

/**
 * Whether an open, unexpired email invitation names `email` in any
 * workspace (spec 0031, owner decision 3, AC-807): sign up lets such an
 * address make an account though it isn't on the allowlist. A yes or no
 * through `crm_invitation_open_for`, never which workspace.
 */
export async function isInvitedEmail(deps: { readonly db: Database }, email: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  if (address === '' || address.length > 254) return false;
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<{ invited: boolean }>(sql`select crm_invitation_open_for(${address}) as invited`),
  );
  return found.rows[0]?.invited === true;
}

/**
 * The workspaces whose people at `domain` may ask to join (spec 0031,
 * AC-819), each with a system scope there: `/join` reads and asks through
 * them before the person is a member. Ids only, through
 * `crm_workspaces_by_domain`; the caller checks each is live and reads the
 * person's standing inside it.
 */
export async function enterDomainWorkspaces(
  deps: { readonly db: Database },
  domain: string,
): Promise<readonly { readonly workspaceId: string; readonly scope: EngineScope }[]> {
  const wanted = domain.trim().toLowerCase();
  if (wanted === '' || wanted.length > 253) return [];
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<{ workspace_id: string }>(
      sql`select workspace_id::text as workspace_id from crm_workspaces_by_domain(${wanted})`,
    ),
  );
  return found.rows.map((row) => ({ workspaceId: row.workspace_id, scope: systemScope(deps.db, row.workspace_id) }));
}

/**
 * One workspace's system scope when it lets people at `domain` ask to join
 * (spec 0031, AC-819), through `crm_workspace_has_domain`, or undefined: the
 * request path's exact check, never cut off by the list's cap.
 */
export async function enterDomainWorkspace(
  deps: { readonly db: Database },
  workspaceId: string,
  domain: string,
): Promise<EngineScope | undefined> {
  const wanted = domain.trim().toLowerCase();
  if (wanted === '' || wanted.length > 253) return undefined;
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<{ on: boolean }>(sql`select crm_workspace_has_domain(${workspaceId}::uuid, ${wanted}) as on`),
  );
  return found.rows[0]?.on === true ? systemScope(deps.db, workspaceId) : undefined;
}

/** The ids crm_booking_page_by_key reads past row level security: a page's workspace and id, nothing else. */
interface PageKeyRow extends Record<string, unknown> {
  readonly workspace_id: string;
  readonly page_id: string;
}

/** The page a visitor's booking acts as, and the People and Companies objects it may write. */
export interface BookingEntry {
  readonly scope: EngineScope;
  readonly pageId: string;
  readonly people: string;
  readonly companies: string;
}

/**
 * The scope a visitor's booking acts with (spec 0025): the page found by its
 * public key (`crm_booking_page_by_key`, ids only), as the `booking` actor,
 * with write on People and Companies and nothing else (`bookingAccess`). An
 * unknown key, a deleted workspace, or a workspace without both standard
 * objects is NOT_FOUND. Whether the page takes bookings is the services'
 * question. Exported only from `@crm/core/public`.
 */
export async function enterBookingPage(deps: { readonly db: Database }, publicKey: string): Promise<BookingEntry> {
  const missing = () => refuse('NOT_FOUND', 'This page is no longer available.');
  if (!/^[A-Za-z0-9_-]{16}$/.test(publicKey)) throw missing();
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<PageKeyRow>(
      sql`select workspace_id::text as workspace_id, page_id::text as page_id from crm_booking_page_by_key(${publicKey})`,
    ),
  );
  const [row] = found.rows;
  if (row === undefined) throw missing();
  const standard = await deps.db.withWorkspace(row.workspace_id, async (tx) => {
    const [workspace] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, row.workspace_id), isNull(workspaces.deletedAt)));
    if (workspace === undefined) return [];
    return tx
      .select({ id: objects.id, key: objects.standardKey })
      .from(objects)
      .where(and(inArray(objects.standardKey, ['people', 'companies']), isNull(objects.archivedAt)));
  });
  const people = standard.find((object) => object.key === 'people')?.id;
  const companies = standard.find((object) => object.key === 'companies')?.id;
  if (people === undefined || companies === undefined) throw missing();
  const scope = mintScope({
    db: deps.db,
    workspaceId: row.workspace_id,
    actor: { type: 'booking', id: row.page_id },
    access: bookingAccess(row.page_id, [people, companies]),
  });
  return { scope, pageId: row.page_id, people, companies };
}

/** The ids crm_booking_by_token reads past row level security. */
interface TokenRow extends Record<string, unknown> {
  readonly workspace_id: string;
  readonly page_id: string;
  readonly booking_id: string;
}

/**
 * The guest page's entry (spec 0025, AC-674): the booking a manage token
 * names, found by the token's SHA-256 (`crm_booking_by_token`, ids only), as
 * its page's `booking` actor. The token is the only key; an unknown one, and
 * one in a deleted workspace, is NOT_FOUND. Exported only from `@crm/core/public`.
 */
export async function enterBookingByToken(
  deps: { readonly db: Database },
  token: string,
): Promise<BookingEntry & { readonly bookingId: string }> {
  const missing = () => refuse('NOT_FOUND', 'This link doesn’t open a booking.');
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw missing();
  const hash = createHash('sha256').update(token).digest('hex');
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<TokenRow>(
      sql`select workspace_id::text as workspace_id, page_id::text as page_id, booking_id::text as booking_id from crm_booking_by_token(${hash})`,
    ),
  );
  const [row] = found.rows;
  if (row === undefined || !(await isLive(deps.db, row.workspace_id))) throw missing();
  const scope = mintScope({
    db: deps.db,
    workspaceId: row.workspace_id,
    actor: { type: 'booking', id: row.page_id },
    // Reads its own booking only: no record access is needed.
    access: bookingAccess(row.page_id, []),
  });
  return { scope, pageId: row.page_id, people: '', companies: '', bookingId: row.booking_id };
}
