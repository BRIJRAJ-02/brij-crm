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
import { workspaceAddressProblem } from '../booking/workspace-addresses.ts';
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type Database, type IdentityStore, type WorkspaceTx } from '@crm/db';
import { isUuid } from '../engine/ids.ts';
import { refuse, type RefusalError } from '../engine/refusals.ts';
import { SYSTEM_ACTOR, type Actor } from '../engine/scope.ts';
import {
  DEFAULT_PAGE_THEME,
  FORM_SLUG,
  HANDLE_PATTERN,
  type HandleOffer,
  INVITE_INVALID_MESSAGE,
  isReservedHandle,
  PageTheme,
  PROFILE_LIMITS,
  SIGN_IN_AGAIN_MESSAGE,
  SLUG_PATTERN,
  TWO_FACTOR_REQUIRED_MESSAGE,
  type PublicSocialLink,
} from '@crm/contracts';
import { publicSocialsOf } from '../booking/socials.ts';
import type { EmailLink } from '../emails/preferences.ts';
import { checkScope, mintFormBeside, mintPageBeside, mintScope, rescope, type EngineScope } from './mint.ts';
import { inWorkspace } from './run.ts';
import {
  bookingAccess,
  emailLinkAccess,
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

const { members, objects, workspaces, workspaceSecurity } = schema;

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

/**
 * The session knocking, as far as a workspace's sign in rules ask (spec 0033,
 * milestone 4): when it last proved who it is (its sign in, or a step up
 * since), and whether its person has a second factor, an authenticator app.
 * The door asks the second only in a workspace that requires two
 * factor, so it can cost a read.
 */
export interface DoorSession {
  readonly verifiedAt: Date;
  readonly hasSecondFactor: () => Promise<boolean>;
}

/**
 * Account deletion's way through (spec 0033, AC-903): the person is leaving
 * every workspace they are in, so a workspace's sign in rules don't hold them
 * back from leaving it. Nothing else passes it.
 */
export const LEAVING = Symbol('leaving');

/** Who is knocking (`auth.user.id`, from the session), with which session, and which workspace address they asked for. */
export interface DoorInput {
  readonly userId: string;
  readonly slug: string;
  readonly session: DoorSession | typeof LEAVING;
}

/** A workspace's sign in rules as the door reads them beside the member; all absent without a row. */
interface SignInRules {
  readonly requireTwoFactor: boolean | null;
  readonly sessionLengthDays: number | null;
  readonly sessionsValidAfter: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Holds a session to the workspace's sign in rules (spec 0033, AC-894): one
 * that proved who it is before everyone was signed out, or longer ago than
 * the workspace's session length, signs in again (403 SIGN_IN_AGAIN); a
 * person without a second factor where one is required sets one up (403
 * TWO_FACTOR_REQUIRED). Only a member reaches this: anyone else was already
 * refused NOT_FOUND, so neither answer says a workspace exists.
 */
async function checkSignInRules(rules: SignInRules, session: DoorSession | typeof LEAVING, now: Date): Promise<void> {
  if (session === LEAVING) return;
  const { verifiedAt } = session;
  if (rules.sessionsValidAfter !== null && verifiedAt.getTime() < rules.sessionsValidAfter.getTime()) {
    throw refuse('SIGN_IN_AGAIN', SIGN_IN_AGAIN_MESSAGE);
  }
  if (rules.sessionLengthDays !== null && now.getTime() - verifiedAt.getTime() > rules.sessionLengthDays * DAY_MS) {
    throw refuse('SIGN_IN_AGAIN', SIGN_IN_AGAIN_MESSAGE);
  }
  if (rules.requireTwoFactor === true && !(await session.hasSecondFactor())) {
    throw refuse('TWO_FACTOR_REQUIRED', TWO_FACTOR_REQUIRED_MESSAGE);
  }
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
 * its role, the workspace's sign in rules, and the access rules that apply
 * (read by `rules` in the same transaction): one tenant round trip.
 */
async function activeMember(
  db: Database,
  workspaceId: string,
  which: { readonly userId: string } | { readonly memberId: string },
  rules: RuleSource,
): Promise<{ readonly member: MemberRow; readonly rules: AccessRules; readonly signIn: SignInRules } | undefined> {
  return db.withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx
      .select({
        id: members.id,
        userId: members.userId,
        role: members.role,
        requireTwoFactor: workspaceSecurity.requireTwoFactor,
        sessionLengthDays: workspaceSecurity.sessionLengthDays,
        sessionsValidAfter: workspaceSecurity.sessionsValidAfter,
      })
      .from(members)
      .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
      .leftJoin(workspaceSecurity, eq(workspaceSecurity.workspaceId, members.workspaceId))
      .where(
        and(
          'userId' in which ? eq(members.userId, which.userId) : eq(members.id, which.memberId),
          eq(members.status, 'active'),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1);
    if (row === undefined) return undefined;
    const member: MemberRow = { id: row.id, userId: row.userId, role: row.role };
    const signIn: SignInRules = {
      requireTwoFactor: row.requireTwoFactor,
      sessionLengthDays: row.sessionLengthDays,
      sessionsValidAfter: row.sessionsValidAfter === null ? null : new Date(row.sessionsValidAfter),
    };
    // An unknown role is refused before any rule is read, and its rules don't matter.
    if (!isRole(member.role)) return { member, rules: NO_RULES, signIn };
    return { member, rules: await rules(tx, { memberId: member.id, role: member.role }), signIn };
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
 * refused like a non member). A member whose session falls short of the
 * workspace's sign in rules is refused SIGN_IN_AGAIN or TWO_FACTOR_REQUIRED
 * (spec 0033, AC-894); their other workspaces are unaffected.
 */
export async function enterWorkspace(deps: DoorDeps, input: DoorInput): Promise<EngineScope> {
  if (!isUuid(input.userId)) throw notFound();
  const workspace = await deps.identity.findWorkspace(input.slug);
  if (workspace === undefined) throw notFound();
  const found = await activeMember(deps.db, workspace.id, { userId: input.userId }, deps.rules);
  if (found === undefined) throw notFound();
  const scope = memberScope(deps, workspace.id, found.member, found.rules);
  await checkSignInRules(found.signIn, input.session, new Date());
  return scope;
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
export async function enterDeletedWorkspace(
  deps: DoorDeps,
  input: Pick<DoorInput, 'userId' | 'slug'>,
): Promise<DeletedEntry> {
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
 * Account deletion's way into a workspace it leaves (spec 0033, AC-903): the
 * person's own active member row, in a live workspace or a deleted one still
 * inside its window, so they can leave it and be forgotten there too, even
 * one deleted or restored while the deletion runs. Any role, since leaving
 * needs none; their role's access, with no rules, as `enterDeletedWorkspace`
 * mints, and no sign in rules, as `LEAVING`. One past its window, a removed
 * member, someone who isn't a member and a role the code doesn't know are
 * all NOT_FOUND. Only `deleteMyAccount` calls it: it is not exported from
 * `@crm/core`.
 */
export async function enterWorkspaceToLeave(
  deps: Pick<DoorDeps, 'db' | 'log'>,
  input: { readonly userId: string; readonly workspaceId: string },
): Promise<EngineScope> {
  if (!isUuid(input.userId) || !isUuid(input.workspaceId)) throw notFound();
  const found = await deps.db.withWorkspace(input.workspaceId, async (tx) => {
    const [row] = await tx
      .select({ id: members.id, userId: members.userId, role: members.role })
      .from(members)
      .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
      .where(
        and(
          eq(members.workspaceId, input.workspaceId),
          eq(members.userId, input.userId),
          eq(members.status, 'active'),
          sql`(${workspaces.deletedAt} is null or ${workspaces.purgeAfter} > now())`,
        ),
      )
      .limit(1);
    return row;
  });
  if (found === undefined) throw notFound();
  return memberScope(deps, input.workspaceId, found, NO_RULES);
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

/** What a handle answers past schema auth's fence (`crm_handle_owner`): never an email. */
interface HandleOwnerRow extends Record<string, unknown> {
  readonly user_id: string;
  readonly workspace_id: string;
  readonly handle: string;
  readonly bio: string;
  readonly name: string;
  readonly image: string | null;
  readonly theme: unknown;
  readonly indexable: boolean;
  readonly share_image_version: string | null;
}

/** The person a handle names (current or old): their identity, current handle, and what their profile shows. */
export interface HandleOwner {
  readonly userId: string;
  /** The one workspace this handle, and the link page behind it, belong to (spec 0056, AC-5601). Never sent out. */
  readonly workspaceId: string;
  /** Their current handle: an old one's address moves to it. */
  readonly handle: string;
  readonly bio: string;
  /** Their account's name; empty for an email code account that never gave one. */
  readonly name: string;
  readonly image?: string;
  /**
   * Their social links ready to draw, in their order (booking socials, 25 Oct 2026); empty when none, and read only
   * for their profile (a booking address or a picture never needs them).
   */
  readonly socials: readonly PublicSocialLink[];
  /**
   * The look they picked for their link page (spec 0054). Parsed here, so a row an older build wrote, or one a
   * later build widened, draws as the default rather than as nothing.
   */
  readonly theme: PageTheme;
  /** Whether search engines may show their page (spec 0055, AC-5506): on until they say otherwise. */
  readonly indexable: boolean;
  /**
   * The version of the picture a pasted link to their page shows instead of the drawn card (spec 0055, AC-5511),
   * or absent when they have set none. The bytes are never read with the profile: only the path's version is.
   */
  readonly shareImageVersion?: string;
}

/** The person `handle` names, or undefined: a malformed or reserved handle reads nothing. */
async function handleOwner(
  db: Database,
  handle: string,
  { withSocials = false }: { readonly withSocials?: boolean } = {},
): Promise<HandleOwner | undefined> {
  if (!HANDLE_PATTERN.test(handle) || isReservedHandle(handle)) return undefined;
  return db.withWorkspace(NO_WORKSPACE, async (tx) => {
    const found = await tx.execute<HandleOwnerRow>(
      sql`select user_id::text as user_id, workspace_id::text as workspace_id, handle, bio, name, image, theme, indexable, share_image_version from crm_handle_owner(${handle})`,
    );
    const [row] = found.rows;
    if (row === undefined) return undefined;
    return {
      userId: row.user_id,
      workspaceId: row.workspace_id,
      handle: row.handle,
      bio: row.bio,
      name: row.name,
      ...(row.image === null ? {} : { image: row.image }),
      // The same read as their booking pages' (`publicSocialsOf`), in this one transaction.
      socials: withSocials ? await publicSocialsOf(tx, row.user_id) : [],
      theme: PageTheme.safeParse(row.theme).data ?? DEFAULT_PAGE_THEME,
      indexable: row.indexable,
      ...(typeof row.share_image_version === 'string' ? { shareImageVersion: row.share_image_version } : {}),
    };
  });
}

/**
 * The person a handle names, current or old (`crm_handle_owner`: no email), for their profile's picture (23 Oct
 * 2026). A handle no one holds, malformed or reserved, is NOT_FOUND. Exported only from `@crm/core/public`.
 */
export async function findHandleOwner(deps: { readonly db: Database }, handle: string): Promise<HandleOwner> {
  const owner = await handleOwner(deps.db, handle);
  if (owner === undefined) throw refuse('NOT_FOUND', 'No one has this address.');
  return owner;
}

/**
 * Whether `/<handle>` is free to claim (25 Oct 2026), asked only after a profile read found nothing. `free` means
 * nobody holds the handle and nothing keeps anyone from taking it; everything else is `absent`, one answer for
 * three reasons: a handle somebody holds (whether or not anything of theirs is public), a word kept for Timefix
 * (`RESERVED_HANDLES`), and a word no handle could ever be.
 *
 * Why one word and not three: not to keep a secret, which it could not. `RESERVED_HANDLES` ships in the browser,
 * so anyone can subtract it, and a handle somebody holds answers with their public profile through
 * `enterBookingProfile` either way. It is so that the offer is only ever made for an address that is genuinely
 * free to take, and so no later caller can grow a reason in words out of this answer.
 *
 * Reads through `crm_handle_taken`, one more of crm_handle's definers (a boolean), so this adds no way to
 * the data, and `HANDLE_PATTERN` and `isReservedHandle` are the same checks the claim itself refuses on
 * (`handleProblem`), so `free` never promises an address the claim would reject. Exported only from
 * `@crm/core/public`.
 */
export async function readHandleOffer(deps: { readonly db: Database }, handle: string): Promise<HandleOffer> {
  // A word kept for Timefix can never be claimed, so it is never offered.
  if (!HANDLE_PATTERN.test(handle) || isReservedHandle(handle)) return 'absent';
  // A person holds it, listed or not: `absent`, exactly as a reserved word reads.
  // Held or ever held (`crm_handle_taken`), not whether its person is still a member: a handle is never freed, so one
  // whose person left is no more free than one whose page is live (spec 0056, AC-5603).
  const held = await deps.db.withWorkspace(NO_WORKSPACE, async (tx) => {
    const found = await tx.execute<{ held: boolean } & Record<string, unknown>>(
      sql`select crm_handle_taken(${handle}) as held`,
    );
    return found.rows[0]?.held === true;
  });
  return held ? 'absent' : 'free';
}

/** A page's narrow, read only entry: its `booking` actor with no record access, as the guest page's. */
function readOnlyEntry(db: Database, row: PageKeyRow): BookingEntry {
  const scope = mintScope({
    db,
    workspaceId: row.workspace_id,
    actor: { type: 'booking', id: row.page_id },
    access: bookingAccess(row.page_id, []),
  });
  return { scope, pageId: row.page_id, people: '', companies: '' };
}

/**
 * The page `/<handle>/<slug>` names (22 Oct 2026): the handle's person (by a current or an old handle,
 * `crm_handle_owner`), then their page with that slug in a workspace that exists (`crm_booking_page_by_address`,
 * ids only), as its read only `booking` entry, and the person's current handle. Anything else is NOT_FOUND, the
 * same for every reason. Exported only from `@crm/core/public`.
 */
export async function enterBookingAddress(
  deps: { readonly db: Database },
  handle: string,
  slug: string,
): Promise<BookingEntry & { readonly handle: string }> {
  const missing = () => refuse('NOT_FOUND', 'This page is no longer available.');
  if (!SLUG_PATTERN.test(slug)) throw missing();
  const owner = await handleOwner(deps.db, handle);
  if (owner === undefined) throw missing();
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<PageKeyRow>(
      sql`select workspace_id::text as workspace_id, page_id::text as page_id from crm_booking_page_by_address(${owner.userId}::uuid, ${owner.workspaceId}::uuid, ${slug})`,
    ),
  );
  const [row] = found.rows;
  if (row === undefined) throw missing();
  return { ...readOnlyEntry(deps.db, row), handle: owner.handle };
}

/** Where a profile read starts: after the link at this position and id. */
export interface ProfileCursor {
  readonly position: number;
  readonly id: string;
}

/** The ids crm_booking_owner_pages reads past row level security, and whether visitors see the page now. */
interface OwnedPageRow extends PageKeyRow {
  readonly is_live: boolean;
}

/** One of a person's booking pages that may sit on their link page, as its read only entry. */
export interface OwnedPageEntry extends BookingEntry {
  /** Visitors see it now: live, not paused. */
  readonly isLive: boolean;
}

/** How the owned pages read reaches the database and mints each page's read only entry: a handle's, or the session's. */
interface OwnedPagesWay {
  readonly read: (work: (tx: WorkspaceTx) => Promise<readonly OwnedPageRow[]>) => Promise<readonly OwnedPageRow[]>;
  readonly mint: (workspaceId: string, pageId: string) => EngineScope;
}

/** `crm_booking_owner_pages` for `ownerUserId`, each page as its read only `booking` entry. */
async function ownedPages(
  way: OwnedPagesWay,
  ownerUserId: string,
  workspaceId: string,
  pageIds?: readonly string[],
): Promise<readonly OwnedPageEntry[]> {
  if (!isUuid(ownerUserId) || !isUuid(workspaceId)) return [];
  const wanted = pageIds?.filter((id) => isUuid(id));
  if (wanted !== undefined && wanted.length === 0) return [];
  const rows = await way.read(async (tx) => {
    const found = await tx.execute<OwnedPageRow>(
      sql`select workspace_id::text as workspace_id, page_id::text as page_id, is_live from crm_booking_owner_pages(${ownerUserId}::uuid, ${workspaceId}::uuid, ${wanted === undefined ? null : `{${wanted.join(',')}}`}::uuid[])`,
    );
    return found.rows;
  });
  return rows.map((row) => ({
    scope: way.mint(row.workspace_id, row.page_id),
    pageId: row.page_id,
    people: '',
    companies: '',
    isLive: row.is_live,
  }));
}

/**
 * Which of a person's booking pages may sit on their link page (spec 0051, AC-5104): Public, not deleted, theirs
 * as an active member of a workspace that exists (`crm_booking_owner_pages`, ids only), only those `pageIds` names
 * when given, each as its read only `booking` entry. `ownerUserId` is the id a handle named: never an input. For a
 * visitor's read of `/<handle>`; the person's own editor enters through `enterOwnPages`.
 */
export async function enterOwnedPages(
  deps: { readonly db: Database },
  ownerUserId: string,
  workspaceId: string,
  pageIds?: readonly string[],
): Promise<readonly OwnedPageEntry[]> {
  return ownedPages(
    {
      read: (work) => deps.db.withWorkspace(NO_WORKSPACE, work),
      mint: (workspaceId, pageId) =>
        mintScope({
          db: deps.db,
          workspaceId,
          actor: { type: 'booking', id: pageId },
          access: bookingAccess(pageId, []),
        }),
    },
    ownerUserId,
    workspaceId,
    pageIds,
  );
}

/**
 * The signed in person's own id from a member scope the door made (spec 0051): their link page is their account's,
 * never a workspace's. Anyone else (a key, a form, the system) is FORBIDDEN.
 */
export function ownUserId(scope: EngineScope): string {
  checkScope(scope);
  const { principal } = scope.access;
  if (principal.kind !== 'member' || principal.userId === undefined) {
    throw refuse('FORBIDDEN', 'Only a signed in person has a link page.');
  }
  return principal.userId;
}

/**
 * The signed in person's own booking pages that may sit on their link page, from every workspace they are in, as
 * `enterOwnedPages` answers them, read through their own scope (the definer reads no workspace's rows) and each
 * entered beside it (`mintPageBeside`) as the page's read only `booking` actor. The owner is the scope's own identity.
 */
export async function enterOwnPages(
  scope: EngineScope,
  pageIds?: readonly string[],
): Promise<readonly OwnedPageEntry[]> {
  return ownedPages(
    {
      read: (work) => inWorkspace(scope, work),
      mint: (workspaceId, pageId) => mintPageBeside(scope, workspaceId, pageId),
    },
    ownUserId(scope),
    scope.workspaceId,
    pageIds,
  );
}

/** The ids crm_form_owner_forms reads past row level security, its key, and whether visitors may open it now. */
interface OwnedFormRow extends Record<string, unknown> {
  readonly workspace_id: string;
  readonly form_id: string;
  readonly public_key: string;
  readonly is_live: boolean;
}

/** One of a person's own forms that may sit on their link page, as its read only entry. */
export interface OwnedFormEntry {
  readonly scope: EngineScope;
  readonly formId: string;
  /** Its public address after `/f/`. */
  readonly key: string;
  /** A visitor may open it now: live, not paused, draft or archived. */
  readonly isLive: boolean;
}

/** How the owned forms read reaches the database and mints each form's read only entry. */
interface OwnedFormsWay {
  readonly read: (work: (tx: WorkspaceTx) => Promise<readonly OwnedFormRow[]>) => Promise<readonly OwnedFormRow[]>;
  readonly mint: (workspaceId: string, formId: string) => EngineScope;
}

/** `crm_form_owner_forms` for `ownerUserId`, each form as its read only `form` entry. */
async function ownedForms(
  way: OwnedFormsWay,
  ownerUserId: string,
  workspaceId: string,
  formIds?: readonly string[],
): Promise<readonly OwnedFormEntry[]> {
  if (!isUuid(ownerUserId) || !isUuid(workspaceId)) return [];
  const wanted = formIds?.filter((id) => isUuid(id));
  if (wanted !== undefined && wanted.length === 0) return [];
  const rows = await way.read(async (tx) => {
    const found = await tx.execute<OwnedFormRow>(
      sql`select workspace_id::text as workspace_id, form_id::text as form_id, public_key, is_live from crm_form_owner_forms(${ownerUserId}::uuid, ${workspaceId}::uuid, ${wanted === undefined ? null : `{${wanted.join(',')}}`}::uuid[])`,
    );
    return found.rows;
  });
  return rows.map((row) => ({
    scope: way.mint(row.workspace_id, row.form_id),
    formId: row.form_id,
    key: row.public_key,
    isLive: row.is_live,
  }));
}

/**
 * Which of a person's hosted forms may sit on their link page (spec 0052, AC-5213): their own, made by them as a
 * member still active in a workspace that exists, not archived (`crm_form_owner_forms`, ids and the public key
 * only), only those `formIds` names when given, each as its read only `form` entry. `ownerUserId` is the id a
 * handle named: never an input. For a visitor's read of `/<handle>`; the person's own editor enters through
 * `enterOwnForms`.
 */
export async function enterOwnedForms(
  deps: { readonly db: Database },
  ownerUserId: string,
  workspaceId: string,
  formIds?: readonly string[],
): Promise<readonly OwnedFormEntry[]> {
  return ownedForms(
    {
      read: (work) => deps.db.withWorkspace(NO_WORKSPACE, work),
      mint: (workspaceId, formId) =>
        mintScope({
          db: deps.db,
          workspaceId,
          actor: { type: 'form', id: formId },
          access: formAccess(formId),
        }),
    },
    ownerUserId,
    workspaceId,
    formIds,
  );
}

/**
 * The signed in person's own forms that may sit on their link page, from every workspace they are in, as
 * `enterOwnedForms` answers them, read through their own scope and each entered beside it (`mintFormBeside`) as the
 * form's read only `form` actor. The owner is the scope's own identity.
 */
export async function enterOwnForms(
  scope: EngineScope,
  formIds?: readonly string[],
): Promise<readonly OwnedFormEntry[]> {
  return ownedForms(
    {
      read: (work) => inWorkspace(scope, work),
      mint: (workspaceId, formId) => mintFormBeside(scope, workspaceId, formId),
    },
    ownUserId(scope),
    scope.workspaceId,
    formIds,
  );
}

/** One live block of a link page as `crm_profile_items_public` answers it. */
export interface LinkPageRow extends Record<string, unknown> {
  readonly id: string;
  readonly kind: string;
  readonly position: number;
  readonly data: unknown;
  readonly workspace_id: string | null;
  readonly page_id: string | null;
  readonly form_id: string | null;
}

/**
 * The picture a pasted link to one person's page shows instead of the drawn card (spec 0055, AC-5511), or
 * undefined when they have set none. The bytes, their type and the version the path must carry, through
 * `crm_profile_share_image`: the one read of them anywhere, kept apart from the profile readers so that a page
 * read never drags half a megabyte it will not draw. Exported only from `@crm/core/public`.
 */
export async function enterShareImage(
  deps: { readonly db: Database },
  userId: string,
  workspaceId: string,
): Promise<{ readonly bytes: Uint8Array; readonly type: string; readonly version: string } | undefined> {
  if (!isUuid(userId) || !isUuid(workspaceId)) return undefined;
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<{ bytes: Buffer | null; kind: string | null; version: string | null }>(
      sql`select bytes, kind, version from crm_profile_share_image(${userId}::uuid, ${workspaceId}::uuid)`,
    ),
  );
  const row = found.rows[0];
  if (row === undefined || row.bytes === null || row.kind === null || row.version === null) return undefined;
  return { bytes: Uint8Array.from(row.bytes), type: row.kind, version: row.version };
}

/**
 * A link page's live blocks alone (spec 0051): the same person and the same `crm_profile_items_public` read as
 * `enterLinkPage`, without the booking pages and forms a whole page needs. The icon route reads through here (26
 * October 2026): it wants one link block's address, and a page's bookings and forms are nothing to it.
 * Exported only from `@crm/core/public`.
 */
export async function enterLinkBlocks(
  deps: { readonly db: Database },
  handle: string,
  query: { readonly after?: ProfileCursor; readonly max: number },
): Promise<{ readonly owner: HandleOwner; readonly rows: readonly LinkPageRow[] }> {
  // The person's social links come with them: the row of icons under the bio (booking socials, 25 Oct 2026).
  const owner = await handleOwner(deps.db, handle, { withSocials: true });
  if (owner === undefined) throw refuse('NOT_FOUND', 'No one has this address.');
  const after = query.after !== undefined && isUuid(query.after.id) ? query.after : undefined;
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<LinkPageRow>(
      sql`select id::text as id, kind, position, data, workspace_id::text as workspace_id, page_id::text as page_id, form_id::text as form_id from crm_profile_items_public(${owner.userId}::uuid, ${owner.workspaceId}::uuid, ${after?.position ?? 0}::smallint, ${after?.id ?? null}::uuid, ${query.max}::integer)`,
    ),
  );
  return { owner, rows: found.rows };
}

/**
 * A link page `/<handle>` (spec 0051): the handle's person (current or old handle), up to `max` of their live blocks
 * in order after `after` (`crm_profile_items_public`), and of the booking pages those blocks name, the ones visitors
 * see now (`crm_booking_owner_pages`, live only), each as its read only `booking` entry. A handle no one holds is
 * NOT_FOUND. Exported only from `@crm/core/public`.
 */
export async function enterLinkPage(
  deps: { readonly db: Database },
  handle: string,
  query: { readonly after?: ProfileCursor; readonly max: number; readonly publicOrigins?: readonly string[] },
): Promise<{
  readonly owner: HandleOwner;
  readonly rows: readonly LinkPageRow[];
  readonly pages: readonly OwnedPageEntry[];
  readonly forms: readonly OwnedFormEntry[];
  /**
   * The blocks among `rows` a visitor must not be shown (spec 0056, AC-5607, AC-5612). `rows` stays whole, so the
   * page's cursor and whether there is more are worked out over what was read, never cut short by a skipped block.
   */
  readonly skipped: ReadonlySet<string>;
}> {
  // The person's social links come with them: the row of icons under the bio (booking socials, 25 Oct 2026).
  const owner = await handleOwner(deps.db, handle, { withSocials: true });
  if (owner === undefined) throw refuse('NOT_FOUND', 'No one has this address.');
  const after = query.after !== undefined && isUuid(query.after.id) ? query.after : undefined;
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<LinkPageRow>(
      sql`select id::text as id, kind, position, data, workspace_id::text as workspace_id, page_id::text as page_id, form_id::text as form_id from crm_profile_items_public(${owner.userId}::uuid, ${owner.workspaceId}::uuid, ${after?.position ?? 0}::smallint, ${after?.id ?? null}::uuid, ${query.max}::integer)`,
    ),
  );
  const rows = await withinWorkspace(deps, owner, found.rows, query.publicOrigins ?? []);
  const shown = new Set(rows.map((row) => row.id));
  const skipped = new Set(found.rows.flatMap((row) => (shown.has(row.id) ? [] : [row.id])));
  const pageIds = rows.flatMap((row) => (row.kind === 'page' && row.page_id !== null ? [row.page_id] : []));
  const pages = (await enterOwnedPages(deps, owner.userId, owner.workspaceId, pageIds)).filter((entry) => entry.isLive);
  // A form block's form, the same way and under the same rule: only one a visitor may open now (AC-5214).
  const formIds = rows.flatMap((row) => (row.kind === 'form' && row.form_id !== null ? [row.form_id] : []));
  const forms = (await enterOwnedForms(deps, owner.userId, owner.workspaceId, formIds)).filter((entry) => entry.isLive);
  return { owner, rows: found.rows, pages, forms, skipped };
}

/**
 * The blocks of a link page that stay inside its own workspace (spec 0056, AC-5607, AC-5612): a page or form block
 * whose own workspace is another one is skipped (a stray row can never leak), and so is a link to one of our own
 * pages that has since come to name another workspace's, or none. A link to any other site is untouched.
 */
async function withinWorkspace(
  deps: { readonly db: Database },
  owner: HandleOwner,
  rows: readonly LinkPageRow[],
  origins: readonly string[],
): Promise<readonly LinkPageRow[]> {
  const own = rows.filter(
    (row) => (row.kind !== 'page' && row.kind !== 'form') || row.workspace_id === owner.workspaceId,
  );
  if (origins.length === 0 || !own.some((row) => row.kind === 'link')) return own;
  const kept = await deps.db.withWorkspace(owner.workspaceId, async (tx) => {
    const verdicts = new Map<string, boolean>();
    for (const row of own) {
      const url =
        row.kind === 'link' && typeof row.data === 'object' && row.data !== null && 'url' in row.data
          ? row.data.url
          : undefined;
      if (typeof url !== 'string') continue;
      verdicts.set(row.id, (await workspaceAddressProblem(tx, owner.workspaceId, url, origins)) === undefined);
    }
    return verdicts;
  });
  return own.filter((row) => kept.get(row.id) !== false);
}

/** A visitor as spec 0047 mints it: the day's HMAC, 32 lowercase hex digits. */
const PROFILE_VISITOR = /^[0-9a-f]{32}$/;

/**
 * Counts one view of a link page (spec 0051, AC-5124) for its owner today, by `visitor`, through
 * `crm_count_profile_view`. The owner is the one a handle read found (`enterLinkPage`), never an input; the caller
 * has already left out the owner's own reads and known machines. Exported only from `@crm/core/public`.
 */
export async function countProfileView(
  deps: { readonly db: Database },
  ownerUserId: string,
  workspaceId: string,
  visitor: string,
): Promise<void> {
  if (!isUuid(ownerUserId) || !isUuid(workspaceId) || !PROFILE_VISITOR.test(visitor)) return;
  await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute(sql`select crm_count_profile_view(${ownerUserId}::uuid, ${workspaceId}::uuid, ${visitor})`),
  );
}

/**
 * Counts one press of a link page's block (spec 0051, AC-5125, AC-5126): the handle's person (current or old
 * handle), then `crm_count_item_press`, which writes only for one of their live blocks a visitor can press. A handle
 * no one holds, a made up or archived id, a heading, or the owner's own press (`signedInAs`) writes nothing, and the
 * caller can't tell which. Exported only
 * from `@crm/core/public`.
 */
export async function countItemPress(
  deps: { readonly db: Database },
  handle: string,
  itemId: string,
  visitor: string,
  options: { readonly signedInAs?: string } = {},
): Promise<void> {
  if (!isUuid(itemId) || !PROFILE_VISITOR.test(visitor)) return;
  const owner = await handleOwner(deps.db, handle);
  // The owner's own presses (signed in on this site) aren't a visitor's.
  if (owner === undefined || owner.userId === options.signedInAs) return;
  await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute(
      sql`select crm_count_item_press(${owner.userId}::uuid, ${owner.workspaceId}::uuid, ${itemId}::uuid, ${visitor})`,
    ),
  );
}

/**
 * A link page's contact card (spec 0051, AC-5114): the handle's person (current or old handle) and the stored fields
 * of their live contact card, read through `crm_profile_items_public` like the page itself, so an archived card is
 * never served. A handle no one holds, and a person with no card, are the same NOT_FOUND. Exported only from
 * `@crm/core/public`.
 */
export async function enterContactCard(
  deps: { readonly db: Database },
  handle: string,
): Promise<{ readonly owner: HandleOwner; readonly data: unknown }> {
  const owner = await handleOwner(deps.db, handle);
  const missing = () => refuse('NOT_FOUND', 'There’s no contact card here.');
  if (owner === undefined) throw missing();
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<{ readonly data: unknown } & Record<string, unknown>>(
      sql`select data from crm_profile_items_public(${owner.userId}::uuid, ${owner.workspaceId}::uuid, 0::smallint, null::uuid, ${PROFILE_LIMITS.items}::integer) where kind = 'contact' limit 1`,
    ),
  );
  const [row] = found.rows;
  if (row === undefined) throw missing();
  return { owner, data: row.data };
}

/**
 * Turns an email's preferences link (its token already checked by
 * `readEmailLinkToken`) into its member's narrow scope: an `email_link`
 * principal with no permission and no object (`emailLinkAccess`), so it
 * reads and sets their own email preferences and nothing else. A member no
 * longer active, or a workspace deleted, answers NOT_FOUND, the same as a
 * link that never was.
 */
export async function enterEmailLink(deps: { readonly db: Database }, link: EmailLink): Promise<EngineScope> {
  const found = await activeMember(deps.db, link.workspaceId, { memberId: link.memberId }, NO_RULE_SOURCE);
  if (found === undefined || !isRole(found.member.role)) {
    throw refuse('NOT_FOUND', 'This link doesn’t open email preferences any more.');
  }
  return mintScope({
    db: deps.db,
    workspaceId: link.workspaceId,
    actor: { type: 'member', id: found.member.id },
    access: emailLinkAccess(found.member.id),
  });
}
