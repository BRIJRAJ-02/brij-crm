// The partner registry (spec 0070, AC-7010), on the identity login, which alone reads and writes schema `auth`: the
// operator console registers and changes partners, the connect page reads one's name and logo, and the token exchange
// reads its secret's hash. Only `secretHash` ever leaves here as a hash; the secret itself never reaches this file.
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { managedUsers, operatorEvent, partners, session, user } from '../schema/auth.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_ID = /^tfp_[A-Za-z0-9_-]{22}$/;

/** A partner as the registry keeps it, without its logo's bytes. */
export interface PartnerRow {
  readonly id: string;
  readonly clientId: string;
  readonly name: string;
  /** The logo's version while it has one; undefined with none. */
  readonly logoVersion?: number;
  readonly frameOrigins: readonly string[];
  readonly redirectUris: readonly string[];
  readonly secretHint: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly secretReplacedAt?: Date;
  /** A sandbox partner (spec 0070, AC-7035). */
  readonly isTest: boolean;
}

/** A partner with its secret's hash, for the token exchange's check only. */
export interface PartnerWithSecret extends PartnerRow {
  readonly secretHash: Buffer;
}

/** A logo as it is served. */
export interface PartnerLogo {
  readonly bytes: Buffer;
  readonly type: string;
  readonly version: number;
}

/** What a new partner is made of: its secret already hashed. */
export interface NewPartner {
  readonly clientId: string;
  readonly name: string;
  readonly logo?: { readonly bytes: Buffer; readonly type: string };
  readonly frameOrigins: readonly string[];
  readonly redirectUris: readonly string[];
  readonly secretHash: Buffer;
  readonly secretHint: string;
  readonly createdBy: string;
  /** A sandbox partner (spec 0070, AC-7035). */
  readonly isTest?: boolean;
}

/** A change to a partner: only the fields given; `logo: null` takes the logo away. */
export interface PartnerChange {
  readonly name?: string;
  readonly logo?: { readonly bytes: Buffer; readonly type: string } | null;
  readonly frameOrigins?: readonly string[];
  readonly redirectUris?: readonly string[];
  readonly isTest?: boolean;
}

/**
 * Who changed the registry, for the console's log (spec 0047's `operator_event`): written in the change's own
 * transaction, so a change never commits without its row. Never a secret.
 */
export interface PartnerAudit {
  readonly userId: string;
  readonly action: string;
  readonly requestId: string;
}

/** The registry's piece of the identity store. */
export interface PartnerIdentity {
  /** Every partner, newest first (at most 500). */
  listPartners(): Promise<readonly PartnerRow[]>;
  partnerById(id: string): Promise<PartnerRow | undefined>;
  /** By the public client id, with the secret's hash: the exchange's and the connect page's read. */
  partnerByClientId(clientId: string): Promise<PartnerWithSecret | undefined>;
  addPartner(partner: NewPartner, audit: PartnerAudit): Promise<PartnerRow>;
  updatePartner(id: string, change: PartnerChange, audit: PartnerAudit): Promise<PartnerRow | undefined>;
  /** Puts a new secret's hash in place of the old one, which stops working with this write. */
  replacePartnerSecret(
    id: string,
    secretHash: Buffer,
    secretHint: string,
    audit: PartnerAudit,
  ): Promise<PartnerRow | undefined>;
  /** The logo at this version only: any other version reads no bytes. */
  partnerLogo(clientId: string, version: number): Promise<PartnerLogo | undefined>;
  /**
   * The identity of a partner's managed member (spec 0070, AC-7020, AC-7021): the one already made for this workspace,
   * partner and external id, its name brought up to date, or a new one. A new identity's email is a made up address
   * under `.invalid`, never the person's, with no password and no linked account, so nothing can sign in as it and no
   * Timefix account with the person's real address is ever merged with it. Idempotent: two calls at once answer the
   * same id. Answers the user id.
   */
  ensureManagedUser(person: ManagedPerson): Promise<string>;
  /**
   * The identity of a page only person (9 Nov 2026): someone a Team pages manager added, whom no partner owns. Made
   * exactly as a partner's managed identity is (a made up `.invalid` address, no password, no linked account, so it
   * never signs in and is never merged with anyone's account), keyed by the workspace and their managed row's id with
   * no partner. Idempotent, as `ensureManagedUser` is. Answers the user id.
   */
  ensurePageOnlyUser(person: PageOnlyPerson): Promise<string>;
  /**
   * Drops a page only identity that never joined a workspace: the add that made it was refused after it was made (a
   * race on the address, the handle or the last seat). Only an identity with no partner and no workspace membership
   * goes; anything else is left alone. Answers whether it went.
   */
  dropPageOnlyUser(userId: string): Promise<boolean>;
  /** Ends every session of a managed identity (AC-7022); any other identity's are never touched. Answers how many. */
  endManagedUserSessions(userId: string): Promise<number>;
  /** Whether this identity is a partner's managed member's (AC-7023): such an identity never starts a session itself. */
  isManagedUser(userId: string): Promise<boolean>;
  /**
   * Ends every embedded session of these connections at once (spec 0070, AC-7013, AC-7035): a disconnect, or the
   * console's wipe of a sandbox partner. Sessions without an embed scope are never touched. Answers how many.
   */
  endEmbedSessions(connectionIds: readonly string[]): Promise<number>;
  /**
   * Hands a page only person's identity over to the person at `email` (Team pages, Invite to manage their page): the
   * identity becomes an ordinary login at that address, verified by the invitation it was mailed, so signing in there
   * with a code (or Google, which links by verified email) opens the same member, page, handle and history. Only the
   * page only identity of this workspace and person; never a partner's (AC-7021). Answers `taken` when another login
   * already holds the address (identities are never merged), `gone` when it is no page only identity here any more,
   * else `claimed`. One transaction.
   */
  claimPageOnlyUser(claim: PageOnlyClaim): Promise<'claimed' | 'taken' | 'gone'>;
  /**
   * Undoes `claimPageOnlyUser` when the workspace's half of the hand over was refused after it (a race): the identity
   * goes back to its made up address with no verified email, is a page only identity again, and any session it started
   * meanwhile ends. Only while it still holds `email`. Best effort for the caller.
   */
  unclaimPageOnlyUser(claim: PageOnlyClaim): Promise<void>;
}

/** A page only identity handed to the person at an address: the identity, its workspace and person, and the address. */
export interface PageOnlyClaim {
  readonly userId: string;
  readonly workspaceId: string;
  readonly personId: string;
  /** Lowercase, as the invitation holds it. */
  readonly email: string;
}

/** Whether a failure is Postgres's unique violation, on the error or the one it wraps (drizzle wraps them). */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if ('code' in current && current.code === '23505') return true;
    current = current.cause;
  }
  return false;
}

/** Who a managed identity is made for, and the name it shows on their link page. */
export interface ManagedPerson {
  readonly workspaceId: string;
  readonly partnerId: string;
  readonly externalId: string;
  readonly name: string;
}

/** Who a page only identity is made for: their managed row's id (made by the caller), and their page's name. */
export interface PageOnlyPerson {
  readonly workspaceId: string;
  readonly personId: string;
  readonly name: string;
}

/** A partner's own id for a person, as the database checks it. */
const EXTERNAL_ID = /^[A-Za-z0-9._~:@+=|-]{1,128}$/;
/** Where every managed identity's made up address lives: `.invalid` never resolves (RFC 2606), so no mail goes there. */
export const MANAGED_DOMAIN = 'managed.timefix.invalid';

/** Whether an address is a managed identity's made up one (never a person's), which no screen shows. */
export function isManagedAddress(email: string): boolean {
  return email.toLowerCase().endsWith(`@${MANAGED_DOMAIN}`);
}

const ROW = {
  id: partners.id,
  clientId: partners.clientId,
  name: partners.name,
  hasLogo: sql<boolean>`${partners.logo} is not null`,
  logoVersion: partners.logoVersion,
  frameOrigins: partners.frameOrigins,
  redirectUris: partners.redirectUris,
  secretHint: partners.secretHint,
  createdAt: partners.createdAt,
  updatedAt: partners.updatedAt,
  secretReplacedAt: partners.secretReplacedAt,
  isTest: partners.isTest,
};

type Selected = {
  id: string;
  clientId: string;
  name: string;
  hasLogo: boolean;
  logoVersion: number;
  frameOrigins: string[];
  redirectUris: string[];
  secretHint: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  secretReplacedAt: Date | string | null;
  isTest: boolean;
};

const toRow = (row: Selected): PartnerRow => ({
  id: row.id,
  clientId: row.clientId,
  name: row.name,
  ...(row.hasLogo ? { logoVersion: row.logoVersion } : {}),
  frameOrigins: row.frameOrigins,
  redirectUris: row.redirectUris,
  secretHint: row.secretHint,
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
  ...(row.secretReplacedAt === null ? {} : { secretReplacedAt: new Date(row.secretReplacedAt) }),
  isTest: row.isTest,
});

type Tx = Parameters<Parameters<NodePgDatabase<Record<string, unknown>>['transaction']>[0]>[0];

/** The console's row for a registry change, in the change's transaction: the partner and what it is now. */
async function logChange(tx: Tx, audit: PartnerAudit, row: PartnerRow, after: Readonly<Record<string, unknown>>) {
  await tx.insert(operatorEvent).values({
    userId: audit.userId,
    action: audit.action,
    target: row.id,
    requestId: audit.requestId.slice(0, 100),
    after: { name: row.name, redirectUris: row.redirectUris, frameOrigins: row.frameOrigins, ...after },
  });
}

/** The registry, on the identity login's Drizzle instance. */
export function createPartnerIdentity(db: NodePgDatabase<Record<string, unknown>>): PartnerIdentity {
  return {
    async listPartners() {
      const rows = await db.select(ROW).from(partners).orderBy(desc(partners.createdAt)).limit(500);
      return rows.map(toRow);
    },

    async partnerById(id) {
      if (!UUID.test(id)) return undefined;
      const [row] = await db.select(ROW).from(partners).where(eq(partners.id, id)).limit(1);
      return row === undefined ? undefined : toRow(row);
    },

    async partnerByClientId(clientId) {
      if (!CLIENT_ID.test(clientId)) return undefined;
      const [row] = await db
        .select({ ...ROW, secretHash: partners.secretHash })
        .from(partners)
        .where(eq(partners.clientId, clientId))
        .limit(1);
      return row === undefined ? undefined : { ...toRow(row), secretHash: row.secretHash };
    },

    async addPartner(partner, audit) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(partners)
          .values({
            clientId: partner.clientId,
            name: partner.name,
            logo: partner.logo?.bytes ?? null,
            logoType: partner.logo?.type ?? null,
            logoVersion: partner.logo === undefined ? 0 : 1,
            frameOrigins: [...partner.frameOrigins],
            redirectUris: [...partner.redirectUris],
            secretHash: partner.secretHash,
            secretHint: partner.secretHint,
            createdBy: partner.createdBy,
            isTest: partner.isTest === true,
          })
          .returning(ROW);
        if (row === undefined) throw new Error('A partner just made could not be read back.');
        const made = toRow(row);
        await logChange(tx, audit, made, { clientId: made.clientId, isTest: made.isTest });
        return made;
      });
    },

    async updatePartner(id, change, audit) {
      if (!UUID.test(id)) return undefined;
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(partners)
          .set({
            updatedAt: sql`now()`,
            ...(change.name === undefined ? {} : { name: change.name }),
            ...(change.frameOrigins === undefined ? {} : { frameOrigins: [...change.frameOrigins] }),
            ...(change.redirectUris === undefined ? {} : { redirectUris: [...change.redirectUris] }),
            ...(change.isTest === undefined ? {} : { isTest: change.isTest }),
            ...(change.logo === undefined
              ? {}
              : change.logo === null
                ? { logo: null, logoType: null }
                : {
                    logo: change.logo.bytes,
                    logoType: change.logo.type,
                    logoVersion: sql`${partners.logoVersion} + 1`,
                  }),
          })
          .where(eq(partners.id, id))
          .returning(ROW);
        if (row === undefined) return undefined;
        const changed = toRow(row);
        await logChange(tx, audit, changed, {
          logoChanged: change.logo !== undefined,
          ...(change.isTest === undefined ? {} : { isTest: change.isTest }),
        });
        return changed;
      });
    },

    async replacePartnerSecret(id, secretHash, secretHint, audit) {
      if (!UUID.test(id)) return undefined;
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(partners)
          .set({ secretHash, secretHint, secretReplacedAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(partners.id, id))
          .returning(ROW);
        if (row === undefined) return undefined;
        const replaced = toRow(row);
        await logChange(tx, audit, replaced, { secretHint });
        return replaced;
      });
    },

    async partnerLogo(clientId, version) {
      if (!CLIENT_ID.test(clientId) || !Number.isSafeInteger(version)) return undefined;
      const [row] = await db
        .select({ bytes: partners.logo, type: partners.logoType, version: partners.logoVersion })
        .from(partners)
        .where(and(eq(partners.clientId, clientId), eq(partners.logoVersion, version), isNotNull(partners.logo)))
        .limit(1);
      if (row === undefined || row.bytes === null || row.type === null) return undefined;
      return { bytes: row.bytes, type: row.type, version: row.version };
    },

    async ensureManagedUser(person) {
      const { workspaceId, partnerId, externalId } = person;
      if (!UUID.test(workspaceId) || !UUID.test(partnerId) || !EXTERNAL_ID.test(externalId)) {
        throw new TypeError('A managed identity needs a workspace, a partner and an external id.');
      }
      return ensureManaged(db, { workspaceId, partnerId, externalId, name: person.name });
    },

    async ensurePageOnlyUser(person) {
      const { workspaceId, personId } = person;
      if (!UUID.test(workspaceId) || !UUID.test(personId)) {
        throw new TypeError('A page only identity needs a workspace and a person id.');
      }
      return ensureManaged(db, {
        workspaceId,
        partnerId: undefined,
        externalId: personId.toLowerCase(),
        name: person.name,
      });
    },

    async dropPageOnlyUser(userId) {
      if (!UUID.test(userId)) return false;
      const dropped = await db
        .delete(user)
        .where(
          and(
            eq(user.id, userId),
            sql`exists (select 1 from ${managedUsers} where ${managedUsers.userId} = ${userId}::uuid and ${managedUsers.partnerId} is null)`,
            sql`not exists (select 1 from auth.workspace_membership wm where wm.user_id = ${userId}::uuid)`,
          ),
        )
        .returning({ id: user.id });
      return dropped.length > 0;
    },

    async claimPageOnlyUser(claim) {
      const { userId, workspaceId, personId } = claim;
      const email = claim.email.trim().toLowerCase();
      if (!UUID.test(userId) || !UUID.test(workspaceId) || !UUID.test(personId) || !email.includes('@')) return 'gone';
      if (isManagedAddress(email)) return 'taken';
      try {
        return await db.transaction(async (tx) => {
          const [held] = await tx
            .select({ userId: managedUsers.userId })
            .from(managedUsers)
            .where(
              and(
                eq(managedUsers.userId, userId),
                eq(managedUsers.workspaceId, workspaceId),
                isNull(managedUsers.partnerId),
                eq(managedUsers.externalId, personId.toLowerCase()),
              ),
            )
            .for('update');
          if (held === undefined) return 'gone';
          const [other] = await tx
            .select({ id: user.id })
            .from(user)
            .where(and(sql`lower(${user.email}) = ${email}`, sql`${user.id} <> ${userId}::uuid`))
            .limit(1);
          if (other !== undefined) return 'taken';
          await tx
            .update(user)
            .set({ email, emailVerified: true, updatedAt: sql`now()` })
            .where(eq(user.id, userId));
          await tx.delete(managedUsers).where(eq(managedUsers.userId, userId));
          // None should exist (the session hook refused it), but a login starts with none from before.
          await tx.delete(session).where(eq(session.userId, userId));
          return 'claimed';
        });
      } catch (error) {
        // Another login took the address at the same moment: its unique index says so.
        if (isUniqueViolation(error)) return 'taken';
        throw error;
      }
    },

    async unclaimPageOnlyUser(claim) {
      const { userId, workspaceId, personId } = claim;
      const email = claim.email.trim().toLowerCase();
      if (!UUID.test(userId) || !UUID.test(workspaceId) || !UUID.test(personId)) return;
      await db.transaction(async (tx) => {
        const back = await tx
          .update(user)
          .set({ email: `${userId}@${MANAGED_DOMAIN}`, emailVerified: false, updatedAt: sql`now()` })
          .where(and(eq(user.id, userId), sql`lower(${user.email}) = ${email}`))
          .returning({ id: user.id });
        if (back.length === 0) return;
        await tx
          .insert(managedUsers)
          .values({ userId, workspaceId, partnerId: null, externalId: personId.toLowerCase() })
          .onConflictDoNothing();
        await tx.delete(session).where(eq(session.userId, userId));
      });
    },

    async endManagedUserSessions(userId) {
      if (!UUID.test(userId)) return 0;
      const ended = await db
        .delete(session)
        .where(
          and(
            eq(session.userId, userId),
            sql`exists (select 1 from ${managedUsers} where ${managedUsers.userId} = ${userId}::uuid)`,
          ),
        )
        .returning({ id: session.id });
      return ended.length;
    },

    async isManagedUser(userId) {
      if (!UUID.test(userId)) return false;
      const [row] = await db
        .select({ userId: managedUsers.userId })
        .from(managedUsers)
        .where(eq(managedUsers.userId, userId))
        .limit(1);
      return row !== undefined;
    },

    async endEmbedSessions(connectionIds) {
      const ids = connectionIds.filter((id) => UUID.test(id));
      if (ids.length === 0) return 0;
      const ended = await db
        .delete(session)
        .where(inArray(session.embedConnectionId, ids))
        .returning({ id: session.id });
      return ended.length;
    },
  };
}

/**
 * The managed identity for this workspace, partner (none for a page only person) and external id, its name brought up
 * to date, or a new one under `.invalid`. Two calls at once answer the same id.
 */
async function ensureManaged(
  db: NodePgDatabase<Record<string, unknown>>,
  key: {
    readonly workspaceId: string;
    readonly partnerId: string | undefined;
    readonly externalId: string;
    readonly name: string;
  },
): Promise<string> {
  const { workspaceId, partnerId, externalId } = key;
  const name = key.name.trim().slice(0, 80);
  const keyed = and(
    eq(managedUsers.workspaceId, workspaceId),
    partnerId === undefined ? isNull(managedUsers.partnerId) : eq(managedUsers.partnerId, partnerId),
    eq(managedUsers.externalId, externalId),
  );
  const existing = async (tx: Tx) => {
    const [row] = await tx
      .select({ userId: managedUsers.userId, name: user.name })
      .from(managedUsers)
      .innerJoin(user, eq(user.id, managedUsers.userId))
      .where(keyed)
      .limit(1);
    if (row === undefined) return undefined;
    if (row.name !== name) {
      await tx
        .update(user)
        .set({ name, updatedAt: sql`now()` })
        .where(eq(user.id, row.userId));
    }
    return row.userId;
  };
  return db.transaction(async (tx) => {
    const found = await existing(tx);
    if (found !== undefined) return found;
    // Two calls at once: the second waits on the first's key here, then finds what it made.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`managed:${workspaceId}:${partnerId ?? 'page'}:${externalId}`}, 0))`,
    );
    const after = await existing(tx);
    if (after !== undefined) return after;
    const id = randomUUID();
    await tx.insert(user).values({ id, name, email: `${id}@${MANAGED_DOMAIN}`, emailVerified: false });
    await tx.insert(managedUsers).values({ userId: id, workspaceId, partnerId: partnerId ?? null, externalId });
    return id;
  });
}
