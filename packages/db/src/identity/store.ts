// The identity store (spec 0005, sign in and access): the only code that
// reads or writes the `auth` schema. It answers the few questions the API asks
// before any workspace is set (which workspace has this address, which
// workspaces is this user in, who is this user), and builds Better Auth's
// database adapter, so the auth library never gets a pool of its own.
//
// It connects as the identity login (`IDENTITY_DATABASE_URL`, a member of
// `crm_identity`), the only role that reads and writes schema `auth`. The app
// login only inserts the two directory rows inside the workspace transaction.
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { isIP } from 'node:net';
import type { SecurityEventKind } from '@crm/contracts';
import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { DatabaseOptions } from '../client.ts';
import { timePool } from '../timing.ts';
import {
  account,
  knownDevice,
  passkey,
  rateLimit,
  twoFactor,
  securityEvent,
  session,
  user,
  userPrefs,
  verification,
  workspaceDirectory,
  workspaceMembership,
} from '../schema/auth.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How a session last proved who it is: a second factor, or an email code or Google alone. */
export type VerifiedWith = 'email' | 'second_factor';

/** When and how a session last proved who it is. */
export interface SessionVerification {
  /** ISO 8601 UTC. */
  readonly at: string;
  readonly with: VerifiedWith;
}

/** The email code kinds Better Auth names its codes by (`<type>-otp-<email>`), for deleting an address's codes. */
const OTP_TYPES = ['sign-in', 'email-verification', 'forget-password', 'change-email'] as const;

/** Wrong tries a step up email code allows before it is used up. */
export const STEP_UP_CODE_TRIES = 5;

/** Better Auth's models, keyed by its model names, as its Drizzle adapter looks them up. */
const AUTH_MODELS = { user, session, account, verification, rateLimit, twoFactor, passkey } as const;

/** A workspace as the directory knows it: enough to find it and to list it, never to enter it. */
export interface DirectoryWorkspace {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

/** One passkey as Account › Security lists it (spec 0033, AC-887): never its key or credential id. */
export interface IdentityPasskey {
  readonly id: string;
  /** The person's label; undefined until they name it. */
  readonly name: string | undefined;
  /** ISO 8601 UTC. */
  readonly createdAt: string;
  /** ISO 8601 UTC; undefined until it is first used. */
  readonly lastUsedAt: string | undefined;
}

/** A passkey's credential, as a step up's challenge names it. */
export interface PasskeyCredential {
  readonly credentialId: string;
  readonly transports: readonly string[];
}

/** A passkey as a step up checks it: whose it is, its public key (base64) and signature counter. */
export interface StoredPasskey {
  readonly id: string;
  readonly userId: string;
  readonly credentialId: string;
  readonly publicKey: string;
  readonly counter: number;
  readonly transports: readonly string[];
}

/** A person who can sign in. `name` is empty until they give one. */
export interface IdentityUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

/** What `betterAuth({ database })` takes: Better Auth's Drizzle adapter over the `auth` schema. */
export type AuthDatabase = ReturnType<typeof drizzleAdapter>;

/** A fixed window limit: at most `max` uses per `window` seconds. */
export interface RateLimitRule {
  readonly window: number;
  readonly max: number;
}

/** Whether a use was within its limit, and if not, the seconds until the window frees up. */
export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number | undefined;
}

/** One live session as Account › Security lists it (spec 0033): never its token. */
export interface SessionListing {
  readonly id: string;
  readonly deviceLabel: string | null;
  readonly country: string | null;
  readonly city: string | null;
  /** Last used, ISO 8601 UTC with microseconds (the keyset cursor's moment). */
  readonly updatedAt: string;
  /** Signed in, ISO 8601 UTC. */
  readonly createdAt: string;
}

/** Where a page of sessions starts after: the last row's `updatedAt` and id. */
export interface SessionKey {
  readonly updatedAt: string;
  readonly id: string;
}

/** One security event to keep (spec 0033, AC-898). `detail` never holds a code, secret or token. */
export interface SecurityEventInput {
  readonly userId: string;
  readonly kind: SecurityEventKind;
  readonly sessionId?: string;
  /** An IP the edge guard trusted, or nothing. */
  readonly ip?: string;
  readonly country?: string;
  readonly deviceLabel?: string;
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

/** One kept security event as the person's Recent activity lists it: never the IP. */
export interface StoredSecurityEvent {
  readonly id: string;
  /** ISO 8601 UTC. */
  readonly at: string;
  readonly kind: SecurityEventKind;
  readonly country: string | null;
  readonly deviceLabel: string | null;
  readonly detail: Readonly<Record<string, unknown>>;
}

/** A live session's own facts, for its sign in alert: what it is on and roughly where. */
export interface SessionFacts {
  readonly userAgent: string | null;
  readonly country: string | null;
  readonly city: string | null;
  readonly deviceLabel: string | null;
  readonly createdAt: Date;
  /** When the account itself was made: a sign in moments after it is the account's first (sign up). */
  readonly userCreatedAt: Date;
  /** Whether the account kept a sign in before this session's. */
  readonly signedInBefore: boolean;
  /** Whether the account has any known device yet (none before devices were kept, 0080). */
  readonly hasKnownDevice: boolean;
}

/** Global identity: the directory, users, and Better Auth's storage. Reads no tenant data. */
export interface IdentityStore {
  /** The workspace at this address, or undefined. Lookup only: it grants nothing. */
  findWorkspace(slug: string): Promise<DirectoryWorkspace | undefined>;
  /** The workspaces this user was added to, oldest first (by when the directory row was made); deleted ones left out. */
  workspacesOf(userId: string): Promise<readonly DirectoryWorkspace[]>;
  /** The workspace this user last opened (spec 0031, AC-802), or undefined. Where to go, never access. */
  lastWorkspaceOf(userId: string): Promise<string | undefined>;
  /**
   * Remembers the workspace this user last opened (spec 0031, AC-802). The
   * caller has passed the access door for it. Writes only when the value
   * changes, so opening page after page in one workspace costs one read.
   */
  setLastWorkspace(userId: string, workspaceId: string): Promise<void>;
  /**
   * Drops the directory's note that this user is in this workspace, once the
   * tenant transaction that removed their member row has committed (spec
   * 0031, AC-812, AC-814), so their switcher stops listing it. Access never
   * read it: the door already refuses them. With `memberId`, only the row
   * naming that member goes, so a membership made again since (a new
   * invitation accepted in between) stays.
   */
  dropMembership(userId: string, workspaceId: string, memberId?: string): Promise<void>;
  /**
   * The directory's copy of a workspace's name, after a rename committed in
   * the tenant row (spec 0031, AC-822). Display only: it grants nothing.
   */
  renameWorkspace(workspaceId: string, name: string): Promise<void>;
  /**
   * Marks a workspace deleted in the directory, or clears the mark on
   * restore, after the tenant change committed (spec 0031, AC-823), so "my
   * workspaces" leaves it out. The door reads the tenant row, not this.
   */
  setWorkspaceDeleted(workspaceId: string, deleted: boolean): Promise<void>;
  /** The user with this id, or undefined. */
  getUser(id: string): Promise<IdentityUser | undefined>;
  /**
   * The user's live (unexpired) sessions, most recently used first, after
   * `after` when given, at most `limit` (spec 0033, AC-890). Ids and labels
   * only: a token never leaves this store.
   */
  listSessions(
    userId: string,
    options: { readonly after?: SessionKey; readonly limit: number },
  ): Promise<readonly SessionListing[]>;
  /**
   * Deletes the session with this id only when it is the user's (AC-891):
   * what it was on, or undefined when nothing of theirs had that id.
   */
  revokeSession(
    userId: string,
    sessionId: string,
  ): Promise<{ readonly deviceLabel: string | null; readonly country: string | null } | undefined>;
  /** Deletes every session of the user but `keepSessionId`; answers how many went (AC-892). */
  revokeOtherSessions(userId: string, keepSessionId: string): Promise<number>;
  /**
   * When this session of the user last proved who it is (sign in, or a step
   * up), ISO 8601 UTC; undefined for a session that isn't theirs or has none.
   */
  sessionVerifiedAt(userId: string, sessionId: string): Promise<string | undefined>;
  /**
   * How this session last proved who it is (spec 0033, AC-885, AC-896): when,
   * and whether with a second factor or by email alone; undefined for a
   * session that isn't the user's or is gone.
   */
  sessionVerification(userId: string, sessionId: string): Promise<SessionVerification | undefined>;
  /** Marks this session of the user as having just proved who it is (a step up). True when it was theirs. */
  markSessionVerified(userId: string, sessionId: string, verifiedWith: VerifiedWith): Promise<boolean>;
  /**
   * Forgets every remembered device of the user (AC-884): Better Auth keeps
   * each as a `trust-device-*` verification row whose value is the user id.
   */
  forgetTrustedDevices(userId: string): Promise<void>;
  /**
   * Deletes the user and everything of theirs in `auth` (spec 0033, AC-905):
   * the user row (its sessions, Google link, two factor, preferences,
   * directory rows and security history go with it, by their foreign keys),
   * then the rows no key reaches: remembered devices, held back sign ins,
   * step up codes and passkey challenges (ours, and the plugin's, which name the user), sign in codes for the address, and the address's rate
   * limit rows. One transaction. True when there was a user to delete.
   */
  deleteUser(userId: string): Promise<boolean>;
  /** Drops the sign in event of a session that was held back for its second step (it never came to be). */
  forgetSignInEvent(userId: string, sessionId: string): Promise<void>;
  /**
   * The user's two factor state (AC-881): on or off, and whether an app was
   * set up and checked; the encrypted secret and codes never leave here.
   */
  twoFactorState(userId: string): Promise<{ readonly enabled: boolean; readonly appVerified: boolean }>;
  /** The user's passkeys, oldest first (AC-887): name, made and last used. Never a key. */
  listPasskeys(userId: string): Promise<readonly IdentityPasskey[]>;
  /** Whether the user has at least one passkey. */
  hasPasskey(userId: string): Promise<boolean>;
  /**
   * Which of these users have a second factor, an authenticator app (two
   * factor on) or a passkey (spec 0033, AC-888, AC-895): a workspace's
   * Members column and its count of members without one. Ids only.
   */
  secondFactorUsers(userIds: readonly string[]): Promise<ReadonlySet<string>>;
  /** Renames one of the user's passkeys. False when it isn't theirs or is gone. */
  renamePasskey(userId: string, passkeyId: string, name: string): Promise<boolean>;
  /** Removes one of the user's passkeys. False when it isn't theirs or is gone. */
  removePasskey(userId: string, passkeyId: string): Promise<boolean>;
  /** The user's passkey credentials, for a step up's challenge: credential ids and transports only. */
  passkeyCredentials(userId: string): Promise<readonly PasskeyCredential[]>;
  /** One passkey by its credential id, with its public key and counter, to check a step up's answer. */
  passkeyByCredential(credentialId: string): Promise<StoredPasskey | undefined>;
  /** Saves a passkey's new signature counter after a step up, and notes it was just used. */
  passkeyUsed(passkeyId: string, counter: number): Promise<void>;
  /** Keeps a passkey step up's challenge for one session, replacing any earlier one. */
  putPasskeyChallenge(sessionId: string, challenge: string, expiresAt: Date): Promise<void>;
  /** Takes (and uses up) this session's live passkey challenge, or undefined. */
  takePasskeyChallenge(sessionId: string): Promise<string | undefined>;
  /** Names the user's unnamed passkeys after the device this session is on ("Chrome on macOS"), when it knows one. */
  nameUnnamedPasskeys(userId: string, sessionId: string): Promise<void>;
  /** Notes that a passkey of the user just signed in or stepped up (AC-887). */
  touchPasskey(userId: string, credentialId: string): Promise<void>;
  /**
   * Keeps a step up email code for one session (AC-896), hashed, for
   * `STEP_UP_CODE_MINUTES`, replacing any earlier one.
   */
  putStepUpCode(sessionId: string, codeHash: string, expiresAt: Date): Promise<void>;
  /**
   * Checks a step up email code: `ok` once (the code is used up), `wrong`
   * (a try is counted; the fifth wrong try ends the code), or `missing`.
   */
  checkStepUpCode(sessionId: string, codeHash: string): Promise<'ok' | 'wrong' | 'missing'>;
  /** Keeps one security event (AC-898). */
  recordSecurityEvent(event: SecurityEventInput): Promise<void>;
  /**
   * The person's security events at or after `since`, newest first, after
   * the (at, id) of `before` when given, at most `limit` (AC-898).
   */
  listSecurityEvents(
    userId: string,
    options: {
      readonly since: Date;
      readonly before?: { readonly at: string; readonly id: string };
      readonly limit: number;
    },
  ): Promise<readonly StoredSecurityEvent[]>;
  /** A live session of this user's facts, or undefined once it is gone (a sign in held back for its second step). */
  sessionFacts(userId: string, sessionId: string): Promise<SessionFacts | undefined>;
  /** When this user last signed in from `deviceKey` (AC-897), or undefined for a device new to them. */
  deviceLastSeen(userId: string, deviceKey: string): Promise<Date | undefined>;
  /** Notes that this user signed in from `deviceKey` now (AC-897). */
  noteDevice(userId: string, deviceKey: string): Promise<void>;
  /**
   * Deletes security events and known devices last seen before `before`, at
   * most `limit` of each (AC-898's year). Answers how many went.
   */
  sweepAuthHistory(before: Date, limit: number): Promise<number>;
  /** Saves the name only when the user has none yet (an email code sign up starts empty). True when it saved. */
  setUserNameIfEmpty(id: string, name: string): Promise<boolean>;
  /**
   * Counts one use of `key` against `rule` in Better Auth's `auth.rate_limit`
   * table, in one atomic statement, so the limit holds across instances. For
   * limits Better Auth can't key itself (per email: it keys by IP and path).
   * A key here must not look like Better Auth's `<ip>|<path>`; prefix it.
   * Its rows hold when their window closes, so Better Auth's pruning (rows
   * older than the longest window it knows of) never drops a window still
   * open, however long.
   */
  consumeRateLimit(key: string, rule: RateLimitRule, cost?: number): Promise<RateLimitDecision>;
  /**
   * Refuses (throws) unless this store is connected as an identity login: a
   * member of `crm_identity`, outside `crm_app`, unable to bypass row level
   * security, own the database, create roles or databases, and in no role
   * (directly or through another) that can, nor in `pg_read_all_data` or
   * `pg_write_all_data`. The api calls it before serving.
   */
  assertIdentityRole(): Promise<void>;
  /**
   * Better Auth's database: its Drizzle adapter (provider `pg`, transactions
   * on) over the `auth` schema, on this store's pool. Pass it to
   * `betterAuth({ database })` with `advanced.database.generateId: 'uuid'`.
   */
  authDatabase(): AuthDatabase;
  /** Closes the pool. */
  close(): Promise<void>;
}

/**
 * Opens the identity store on its own small pool, as the identity login role
 * (`IDENTITY_DATABASE_URL`, never the app's `DATABASE_URL`). The `auth` schema
 * has no row level security, so this pool needs no workspace setting, and the
 * identity login has no grant on any tenant table.
 */
export function createIdentityStore(options: DatabaseOptions): IdentityStore {
  const pool = new pg.Pool({
    connectionString: options.url,
    application_name: options.applicationName,
    max: options.maxConnections ?? 5,
  });
  pool.on('error', (error) => (options.onPoolError ?? console.error)(error));
  // The session check every request makes waits here too (spec 0011, AC-202).
  if (options.timing !== undefined) timePool(pool, options.timing);
  const db = drizzle({ client: pool, schema: AUTH_MODELS });

  const directoryColumns = {
    id: workspaceDirectory.workspaceId,
    slug: workspaceDirectory.slug,
    name: workspaceDirectory.name,
  };

  return {
    async findWorkspace(slug) {
      const [row] = await db
        .select(directoryColumns)
        .from(workspaceDirectory)
        .where(eq(workspaceDirectory.slug, slug))
        .limit(1);
      return row;
    },

    async workspacesOf(userId) {
      if (!UUID.test(userId)) return [];
      return db
        .select(directoryColumns)
        .from(workspaceMembership)
        .innerJoin(workspaceDirectory, eq(workspaceDirectory.workspaceId, workspaceMembership.workspaceId))
        .where(and(eq(workspaceMembership.userId, userId), isNull(workspaceDirectory.deletedAt)))
        .orderBy(asc(workspaceDirectory.createdAt), asc(workspaceDirectory.workspaceId));
    },

    async lastWorkspaceOf(userId) {
      if (!UUID.test(userId)) return undefined;
      const [row] = await db
        .select({ workspaceId: userPrefs.lastWorkspaceId })
        .from(userPrefs)
        .where(eq(userPrefs.userId, userId))
        .limit(1);
      return row?.workspaceId ?? undefined;
    },

    async setLastWorkspace(userId, workspaceId) {
      if (!UUID.test(userId) || !UUID.test(workspaceId)) throw new TypeError('Expected uuids.');
      await db
        .insert(userPrefs)
        .values({ userId, lastWorkspaceId: workspaceId })
        .onConflictDoUpdate({
          target: userPrefs.userId,
          set: { lastWorkspaceId: workspaceId, updatedAt: sql`now()` },
          setWhere: sql`${userPrefs.lastWorkspaceId} is distinct from ${workspaceId}::uuid`,
        });
    },

    async dropMembership(userId, workspaceId, memberId) {
      if (!UUID.test(userId) || !UUID.test(workspaceId)) return;
      if (memberId !== undefined && !UUID.test(memberId)) return;
      await db
        .delete(workspaceMembership)
        .where(
          and(
            eq(workspaceMembership.userId, userId),
            eq(workspaceMembership.workspaceId, workspaceId),
            ...(memberId === undefined ? [] : [eq(workspaceMembership.memberId, memberId)]),
          ),
        );
    },

    async renameWorkspace(workspaceId, name) {
      if (!UUID.test(workspaceId)) return;
      await db.update(workspaceDirectory).set({ name }).where(eq(workspaceDirectory.workspaceId, workspaceId));
    },

    async setWorkspaceDeleted(workspaceId, deleted) {
      if (!UUID.test(workspaceId)) return;
      await db
        .update(workspaceDirectory)
        .set({ deletedAt: deleted ? sql`now()` : null })
        .where(eq(workspaceDirectory.workspaceId, workspaceId));
    },

    async getUser(id) {
      if (!UUID.test(id)) return undefined;
      const [row] = await db
        .select({ id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified })
        .from(user)
        .where(eq(user.id, id))
        .limit(1);
      return row;
    },

    async listSessions(userId, { after, limit }) {
      if (!UUID.test(userId)) return [];
      if (after !== undefined && !UUID.test(after.id)) return [];
      const moment = sql<string>`to_char(${session.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
      const rows = await db
        .select({
          id: session.id,
          deviceLabel: session.deviceLabel,
          country: session.country,
          city: session.city,
          updatedAt: moment,
          createdAt: sql<string>`to_char(${session.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(session)
        .where(
          and(
            eq(session.userId, userId),
            sql`${session.expiresAt} > now()`,
            after === undefined
              ? undefined
              : sql`(${session.updatedAt}, ${session.id}) < (${after.updatedAt}::timestamptz, ${after.id}::uuid)`,
          ),
        )
        .orderBy(desc(session.updatedAt), desc(session.id))
        .limit(Math.max(1, Math.min(limit, 200)));
      return rows;
    },

    async revokeSession(userId, sessionId) {
      if (!UUID.test(userId) || !UUID.test(sessionId)) return undefined;
      const [gone] = await db
        .delete(session)
        .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
        .returning({ deviceLabel: session.deviceLabel, country: session.country });
      return gone;
    },

    async revokeOtherSessions(userId, keepSessionId) {
      if (!UUID.test(userId) || !UUID.test(keepSessionId)) return 0;
      const gone = await db
        .delete(session)
        .where(and(eq(session.userId, userId), ne(session.id, keepSessionId)))
        .returning({ id: session.id });
      return gone.length;
    },

    async sessionVerifiedAt(userId, sessionId) {
      if (!UUID.test(userId) || !UUID.test(sessionId)) return undefined;
      const [row] = await db
        .select({ verifiedAt: session.verifiedAt })
        .from(session)
        .where(and(eq(session.id, sessionId), eq(session.userId, userId), sql`${session.expiresAt} > now()`))
        .limit(1);
      return row?.verifiedAt ? row.verifiedAt.toISOString() : undefined;
    },

    async sessionVerification(userId, sessionId) {
      if (!UUID.test(userId) || !UUID.test(sessionId)) return undefined;
      const [row] = await db
        .select({ at: session.verifiedAt, with: session.verifiedWith })
        .from(session)
        .where(and(eq(session.id, sessionId), eq(session.userId, userId), sql`${session.expiresAt} > now()`))
        .limit(1);
      if (row?.at === undefined || row.at === null) return undefined;
      return { at: row.at.toISOString(), with: row.with ?? 'email' };
    },

    async markSessionVerified(userId, sessionId, verifiedWith) {
      if (!UUID.test(userId) || !UUID.test(sessionId)) return false;
      const marked = await db
        .update(session)
        .set({ verifiedAt: sql`now()`, verifiedWith })
        .where(and(eq(session.id, sessionId), eq(session.userId, userId), sql`${session.expiresAt} > now()`))
        .returning({ id: session.id });
      return marked.length > 0;
    },

    async forgetTrustedDevices(userId) {
      if (!UUID.test(userId)) return;
      await db
        .delete(verification)
        .where(and(eq(verification.value, userId), sql`${verification.identifier} like 'trust-device-%'`));
    },

    async deleteUser(userId) {
      if (!UUID.test(userId)) return false;
      return db.transaction(async (tx) => {
        const [found] = await tx.select({ email: user.email }).from(user).where(eq(user.id, userId)).for('update');
        if (found === undefined) return false;
        const email = found.email;
        await tx.delete(verification).where(
          sql`${verification.value} = ${userId}
              or ${verification.identifier} in (select 'step-up-' || ${session.id}::text from ${session} where ${session.userId} = ${userId})
              or ${verification.identifier} in (select 'step-up-passkey-' || ${session.id}::text from ${session} where ${session.userId} = ${userId})
              or strpos(${verification.value}, '"userData":{"id":"' || ${userId} || '"') > 0
              or ${verification.identifier} in (${sql.join(
                OTP_TYPES.map((type) => sql`${`${type}-otp-${email}`}`),
                sql`, `,
              )})`,
        );
        // Exact prefixes, never LIKE: an address may hold `_`, which LIKE reads as any character.
        await tx.delete(rateLimit).where(
          sql`starts_with(${rateLimit.key}, 'email:' || ${email} || '|')
              or starts_with(${rateLimit.key}, 'step-up:' || ${userId} || '|')
              or starts_with(${rateLimit.key}, 'step-up-send:' || ${userId} || '|')
              or starts_with(${rateLimit.key}, 'step-up-passkey:' || ${userId} || '|')`,
        );
        await tx.delete(user).where(eq(user.id, userId));
        return true;
      });
    },

    async forgetSignInEvent(userId, sessionId) {
      if (!UUID.test(userId) || !UUID.test(sessionId)) return;
      await db
        .delete(securityEvent)
        .where(
          and(
            eq(securityEvent.userId, userId),
            eq(securityEvent.sessionId, sessionId),
            eq(securityEvent.kind, 'sign_in'),
          ),
        );
    },

    async twoFactorState(userId) {
      if (!UUID.test(userId)) return { enabled: false, appVerified: false };
      const [row] = await db
        .select({ enabled: user.twoFactorEnabled, verified: twoFactor.verified })
        .from(user)
        .leftJoin(twoFactor, eq(twoFactor.userId, user.id))
        .where(eq(user.id, userId))
        .limit(1);
      return { enabled: row?.enabled ?? false, appVerified: row?.verified ?? false };
    },

    async listPasskeys(userId) {
      if (!UUID.test(userId)) return [];
      const rows = await db
        .select({
          id: passkey.id,
          name: passkey.name,
          createdAt: passkey.createdAt,
          lastUsedAt: passkey.lastUsedAt,
        })
        .from(passkey)
        .where(eq(passkey.userId, userId))
        .orderBy(asc(passkey.createdAt), asc(passkey.id));
      return rows.map((row) => ({
        id: row.id,
        name: row.name ?? undefined,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString(),
      }));
    },

    async hasPasskey(userId) {
      if (!UUID.test(userId)) return false;
      const [row] = await db.select({ id: passkey.id }).from(passkey).where(eq(passkey.userId, userId)).limit(1);
      return row !== undefined;
    },

    async secondFactorUsers(userIds) {
      const ids = [...new Set(userIds.filter((id) => UUID.test(id)))];
      if (ids.length === 0) return new Set<string>();
      const [withApp, withPasskey] = await Promise.all([
        db
          .select({ id: user.id })
          .from(user)
          .where(and(inArray(user.id, ids), eq(user.twoFactorEnabled, true))),
        db.selectDistinct({ id: passkey.userId }).from(passkey).where(inArray(passkey.userId, ids)),
      ]);
      return new Set([...withApp, ...withPasskey].map((row) => row.id));
    },

    async renamePasskey(userId, passkeyId, name) {
      if (!UUID.test(userId) || !UUID.test(passkeyId)) return false;
      const renamed = await db
        .update(passkey)
        .set({ name })
        .where(and(eq(passkey.id, passkeyId), eq(passkey.userId, userId)))
        .returning({ id: passkey.id });
      return renamed.length > 0;
    },

    async removePasskey(userId, passkeyId) {
      if (!UUID.test(userId) || !UUID.test(passkeyId)) return false;
      const removed = await db
        .delete(passkey)
        .where(and(eq(passkey.id, passkeyId), eq(passkey.userId, userId)))
        .returning({ id: passkey.id });
      return removed.length > 0;
    },

    async passkeyCredentials(userId) {
      if (!UUID.test(userId)) return [];
      const rows = await db
        .select({ credentialId: passkey.credentialID, transports: passkey.transports })
        .from(passkey)
        .where(eq(passkey.userId, userId))
        .orderBy(asc(passkey.createdAt));
      return rows.map((row) => ({
        credentialId: row.credentialId,
        transports: (row.transports ?? '').split(',').filter((each) => each !== ''),
      }));
    },

    async passkeyByCredential(credentialId) {
      const [row] = await db
        .select({
          id: passkey.id,
          userId: passkey.userId,
          credentialId: passkey.credentialID,
          publicKey: passkey.publicKey,
          counter: passkey.counter,
          transports: passkey.transports,
        })
        .from(passkey)
        .where(eq(passkey.credentialID, credentialId))
        .limit(1);
      if (row === undefined) return undefined;
      return { ...row, transports: (row.transports ?? '').split(',').filter((each) => each !== '') };
    },

    async passkeyUsed(passkeyId, counter) {
      if (!UUID.test(passkeyId)) return;
      // Never back: a sign in saving the counter at the same moment can't be undone by a slower write.
      await db
        .update(passkey)
        .set({ counter: sql`greatest(${passkey.counter}, ${counter})`, lastUsedAt: sql`now()` })
        .where(eq(passkey.id, passkeyId));
    },

    async putPasskeyChallenge(sessionId, challenge, expiresAt) {
      if (!UUID.test(sessionId)) return;
      const identifier = `step-up-passkey-${sessionId}`;
      await db.transaction(async (tx) => {
        await tx.delete(verification).where(eq(verification.identifier, identifier));
        await tx.insert(verification).values({ identifier, value: challenge, expiresAt });
      });
    },

    async takePasskeyChallenge(sessionId) {
      if (!UUID.test(sessionId)) return undefined;
      const taken = await db
        .delete(verification)
        .where(eq(verification.identifier, `step-up-passkey-${sessionId}`))
        .returning({ value: verification.value, expiresAt: verification.expiresAt });
      const live = taken.find((row) => row.expiresAt > new Date());
      return live?.value;
    },

    async nameUnnamedPasskeys(userId, sessionId) {
      if (!UUID.test(userId) || !UUID.test(sessionId)) return;
      await db.execute(sql`
        update ${passkey} set name = left(s.device_label, 60)
          from ${session} s
         where s.id = ${sessionId} and s.user_id = ${userId} and s.device_label is not null
           and s.device_label <> '' and ${passkey.userId} = ${userId} and ${passkey.name} is null
      `);
    },

    async touchPasskey(userId, credentialId) {
      if (!UUID.test(userId)) return;
      await db
        .update(passkey)
        .set({ lastUsedAt: sql`now()` })
        .where(and(eq(passkey.credentialID, credentialId), eq(passkey.userId, userId)));
    },

    async putStepUpCode(sessionId, codeHash, expiresAt) {
      if (!UUID.test(sessionId)) return;
      const identifier = `step-up-${sessionId}`;
      await db.transaction(async (tx) => {
        await tx.delete(verification).where(eq(verification.identifier, identifier));
        await tx.insert(verification).values({ identifier, value: `${codeHash}:0`, expiresAt });
      });
    },

    async checkStepUpCode(sessionId, codeHash) {
      if (!UUID.test(sessionId)) return 'missing';
      const identifier = `step-up-${sessionId}`;
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: verification.id, value: verification.value })
          .from(verification)
          .where(and(eq(verification.identifier, identifier), sql`${verification.expiresAt} > now()`))
          .for('update')
          .limit(1);
        if (row === undefined) return 'missing' as const;
        const [hash = '', triesText = '0'] = row.value.split(':');
        if (hash === codeHash) {
          await tx.delete(verification).where(eq(verification.id, row.id));
          return 'ok' as const;
        }
        const tries = Number(triesText) + 1;
        if (tries >= STEP_UP_CODE_TRIES) await tx.delete(verification).where(eq(verification.id, row.id));
        else
          await tx
            .update(verification)
            .set({ value: `${hash}:${String(tries)}` })
            .where(eq(verification.id, row.id));
        return 'wrong' as const;
      });
    },

    async recordSecurityEvent(event) {
      if (!UUID.test(event.userId)) return;
      const sessionId = event.sessionId !== undefined && UUID.test(event.sessionId) ? event.sessionId : null;
      await db.insert(securityEvent).values({
        userId: event.userId,
        kind: event.kind,
        sessionId,
        ip: event.ip !== undefined && isIP(event.ip) !== 0 ? event.ip : null,
        country: event.country ?? null,
        deviceLabel: event.deviceLabel ?? null,
        detail: event.detail ?? {},
      });
    },

    async listSecurityEvents(userId, options) {
      if (!UUID.test(userId)) return [];
      const before = options.before;
      const rows = await db
        .select({
          id: securityEvent.id,
          at: securityEvent.at,
          kind: securityEvent.kind,
          country: securityEvent.country,
          deviceLabel: securityEvent.deviceLabel,
          detail: securityEvent.detail,
        })
        .from(securityEvent)
        .where(
          and(
            eq(securityEvent.userId, userId),
            gte(securityEvent.at, options.since),
            ...(before === undefined || !UUID.test(before.id)
              ? []
              : [sql`(${securityEvent.at}, ${securityEvent.id}) < (${before.at}::timestamptz, ${before.id}::uuid)`]),
          ),
        )
        .orderBy(desc(securityEvent.at), desc(securityEvent.id))
        .limit(Math.max(1, Math.min(options.limit, 200)));
      return rows.map((row) => ({
        id: row.id,
        at: new Date(row.at).toISOString(),
        kind: row.kind,
        country: row.country,
        deviceLabel: row.deviceLabel,
        detail: typeof row.detail === 'object' && row.detail !== null ? (row.detail as Record<string, unknown>) : {},
      }));
    },

    async sessionFacts(userId, sessionId) {
      if (!UUID.test(userId) || !UUID.test(sessionId)) return undefined;
      const [row] = await db
        .select({
          userAgent: session.userAgent,
          country: session.country,
          city: session.city,
          deviceLabel: session.deviceLabel,
          createdAt: session.createdAt,
          userCreatedAt: user.createdAt,
          signedInBefore: sql<boolean>`exists (select 1 from ${securityEvent} e where e.user_id = ${session.userId} and e.kind = 'sign_in' and e.session_id is distinct from ${session.id})`,
          hasKnownDevice: sql<boolean>`exists (select 1 from ${knownDevice} d where d.user_id = ${session.userId})`,
        })
        .from(session)
        .innerJoin(user, eq(user.id, session.userId))
        .where(and(eq(session.id, sessionId), eq(session.userId, userId), sql`${session.expiresAt} > now()`))
        .limit(1);
      return row === undefined
        ? undefined
        : { ...row, createdAt: new Date(row.createdAt), userCreatedAt: new Date(row.userCreatedAt) };
    },

    async deviceLastSeen(userId, deviceKey) {
      if (!UUID.test(userId) || !/^[0-9a-f]{64}$/.test(deviceKey)) return undefined;
      const [row] = await db
        .select({ lastSeen: knownDevice.lastSeen })
        .from(knownDevice)
        .where(and(eq(knownDevice.userId, userId), eq(knownDevice.deviceKey, deviceKey)))
        .limit(1);
      return row === undefined ? undefined : new Date(row.lastSeen);
    },

    async noteDevice(userId, deviceKey) {
      if (!UUID.test(userId) || !/^[0-9a-f]{64}$/.test(deviceKey)) return;
      await db
        .insert(knownDevice)
        .values({ userId, deviceKey })
        .onConflictDoUpdate({ target: [knownDevice.userId, knownDevice.deviceKey], set: { lastSeen: sql`now()` } });
    },

    async sweepAuthHistory(before, limit) {
      const cap = Math.max(1, Math.min(limit, 10_000));
      const events = await db.execute<{ id: string }>(
        sql`delete from ${securityEvent} where id in (select id from ${securityEvent} where ${securityEvent.at} < ${before.toISOString()}::timestamptz order by ${securityEvent.at} limit ${cap}) returning id`,
      );
      const devices = await db.execute<{ user_id: string }>(
        sql`delete from ${knownDevice} where (user_id, device_key) in (select user_id, device_key from ${knownDevice} where ${knownDevice.lastSeen} < ${before.toISOString()}::timestamptz limit ${cap}) returning user_id`,
      );
      return events.rows.length + devices.rows.length;
    },

    async setUserNameIfEmpty(id, name) {
      const trimmed = name.trim();
      if (!UUID.test(id) || trimmed === '') return false;
      const saved = await db
        .update(user)
        .set({ name: trimmed, updatedAt: sql`now()` })
        .where(and(eq(user.id, id), sql`btrim(${user.name}) = ''`))
        .returning({ id: user.id });
      return saved.length > 0;
    },

    async consumeRateLimit(key, rule, cost = 1) {
      // `cost` uses at once (an invite to 20 addresses is 20 sends); at least one.
      const uses = Math.max(1, Math.floor(cost));
      const now = Date.now();
      const closes = now + rule.window * 1000;
      // A fixed window: `last_request` holds when the window closes (not when it
      // opened, as Better Auth's own rows do). Better Auth prunes rows whose
      // `last_request` is older than its longest window, so a row here goes
      // only once its window is long over, whatever its length.
      const result = await db.execute<{ count: number; window_end: string }>(sql`
        insert into ${rateLimit} as r (key, count, last_request) values (${key}, ${uses}, ${closes})
        on conflict (key) do update set
          count = case when r.last_request <= ${now} then ${uses} else r.count + ${uses} end,
          last_request = case when r.last_request <= ${now} then ${closes} else r.last_request end
        returning r.count, r.last_request as window_end
      `);
      const row = result.rows[0];
      if (row === undefined) throw new Error('The rate limit row was not written.');
      if (row.count <= rule.max) return { allowed: true, retryAfterSeconds: undefined };
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((Number(row.window_end) - now) / 1000)) };
    },

    async assertIdentityRole() {
      const result = await pool.query<{
        role: string;
        unsafe: boolean;
        reaches_power: string | null;
        is_identity_member: boolean;
        is_app_member: boolean;
      }>(`
        select
          r.rolname as role,
          r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or d.datdba = r.oid as unsafe,
          (
            select string_agg(b.rolname, ', ' order by b.rolname) from pg_roles b
            where b.oid <> r.oid
              and (
                b.rolsuper or b.rolbypassrls or b.rolcreaterole or b.rolcreatedb
                or b.rolname in ('pg_read_all_data', 'pg_write_all_data')
              )
              -- MEMBER follows every grant, even one with neither INHERIT nor SET (held WITH ADMIN, say).
              and pg_has_role(r.oid, b.oid, 'MEMBER')
          ) as reaches_power,
          pg_has_role(r.oid, 'crm_identity', 'USAGE') as is_identity_member,
          pg_has_role(r.oid, 'crm_app', 'MEMBER') as is_app_member
        from pg_roles r
        cross join pg_database d
        where r.rolname = current_user and d.datname = current_database()
      `);
      const row = result.rows[0];
      if (!row) throw new Error('Could not read the connected identity role.');
      if (row.unsafe) {
        throw new Error(
          `The identity store is connected as "${row.role}", which owns the database, bypasses row level security, ` +
            'or creates roles or databases. Point IDENTITY_DATABASE_URL at the identity login role (see `pnpm db:identity-login`).',
        );
      }
      // Through a role it is in, directly or not (a Neon console role is in neon_superuser, say), counts too.
      if (row.reaches_power !== null) {
        throw new Error(
          `The identity store is connected as "${row.role}", a member of ${row.reaches_power}, which reads or writes ` +
            'every table or holds powers the identity login must not. Use a login made by `pnpm db:identity-login`.',
        );
      }
      if (row.is_app_member) {
        throw new Error(
          `The identity store is connected as "${row.role}", a member of crm_app. The identity login must reach no tenant table.`,
        );
      }
      if (!row.is_identity_member) {
        throw new Error(
          `The role "${row.role}" is not a member of crm_identity. Run \`pnpm db:migrate\` and \`pnpm db:identity-login\`.`,
        );
      }
    },

    authDatabase() {
      return drizzleAdapter(db, { provider: 'pg', schema: AUTH_MODELS, transaction: true });
    },

    close: () => pool.end(),
  };
}
