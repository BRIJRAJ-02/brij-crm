// The partner registry (spec 0070, AC-7010), on the identity login, which alone reads and writes schema `auth`: the
// operator console registers and changes partners, the connect page reads one's name and logo, and the token exchange
// reads its secret's hash. Only `secretHash` ever leaves here as a hash; the secret itself never reaches this file.
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { operatorEvent, partners } from '../schema/auth.ts';

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
}

/** A change to a partner: only the fields given; `logo: null` takes the logo away. */
export interface PartnerChange {
  readonly name?: string;
  readonly logo?: { readonly bytes: Buffer; readonly type: string } | null;
  readonly frameOrigins?: readonly string[];
  readonly redirectUris?: readonly string[];
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
          })
          .returning(ROW);
        if (row === undefined) throw new Error('A partner just made could not be read back.');
        const made = toRow(row);
        await logChange(tx, audit, made, { clientId: made.clientId });
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
        await logChange(tx, audit, changed, { logoChanged: change.logo !== undefined });
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
  };
}
