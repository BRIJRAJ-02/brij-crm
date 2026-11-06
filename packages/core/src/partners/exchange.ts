// The token exchange (spec 0070, AC-7011): the partner's server swaps a connect's one time code for a connection and
// its access token, with its client secret and the PKCE verifier. Server to server: no session and no scope, so it
// reads the code under the workspace its public half names, as the door reads an API key.
//
// Every failure is a value, never a throw: `invalid_client` (the client id or secret is wrong, compared in constant
// time even for an unknown client id) or `invalid_grant` (anything about the code). A code works once, within 60
// seconds, for the partner it was given to, with the redirect address and verifier it was asked with; a failed try
// burns it. A code used a second time ends the connection it made (RFC 6749, 4.1.2), and that is written to History.
import type { PartnerConnectionView, PartnerModule } from '@crm/contracts';
import { PARTNER_MODULES } from '@crm/contracts';
import { schema, type Database, type PartnerIdentity, type WorkspaceTx } from '@crm/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { newId } from '../engine/ids.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { writeAudit } from '../members/audit.ts';
import {
  isClientId,
  newPartnerTokenSecret,
  parsePartnerCode,
  partnerAccessToken,
  partnerSecretMatches,
  partnerTokenHash,
  partnerTokenMatches,
  pkceMatches,
} from './tokens.ts';

const { members, partnerCodes, partnerConnections, workspaces } = schema;

/** What the exchange sends. */
export interface PartnerExchangeInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
}

/** The exchange's answer: the connection and its token (shown once), or why not. */
export type PartnerExchange =
  | { readonly ok: true; readonly token: string; readonly connection: PartnerConnectionView }
  | { readonly ok: false; readonly reason: 'invalid_client' | 'invalid_grant'; readonly message: string };

/** What the exchange needs: the tenant database, and the registry's read of one partner. */
export interface PartnerExchangeDeps {
  readonly db: Database;
  readonly partners: Pick<PartnerIdentity, 'partnerByClientId'>;
}

const BAD_CLIENT: PartnerExchange = {
  ok: false,
  reason: 'invalid_client',
  message: 'The client id or client secret is wrong.',
};
const BAD_CODE: PartnerExchange = {
  ok: false,
  reason: 'invalid_grant',
  message: 'That code isn’t one Timefix gave this app, or it ran out. Ask the person to connect again.',
};

/** Modules as stored, kept to the catalog. */
const modulesOf = (stored: readonly string[]): PartnerModule[] =>
  PARTNER_MODULES.filter((module) => stored.includes(module));

/** A code used again: the connection it made ends at once (no member ended it), with its History row. */
async function endReplayed(
  tx: WorkspaceTx,
  workspaceId: string,
  connectionId: string,
  partnerName: string,
): Promise<void> {
  const [ended] = await tx
    .update(partnerConnections)
    .set({ disconnectedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(partnerConnections.id, connectionId), isNull(partnerConnections.disconnectedAt)))
    .returning({ modules: partnerConnections.modules });
  if (ended === undefined) return;
  await writeAudit(tx, workspaceId, SYSTEM_ACTOR, {
    action: 'partner.disconnected',
    targetType: 'workspace',
    targetId: workspaceId,
    after: { name: partnerName, modules: modulesOf(ended.modules), reason: 'code_reused' },
  });
}

/** Swaps a code for a connection (AC-7011). */
export async function exchangePartnerCode(
  deps: PartnerExchangeDeps,
  input: PartnerExchangeInput,
): Promise<PartnerExchange> {
  const partner = isClientId(input.clientId) ? await deps.partners.partnerByClientId(input.clientId) : undefined;
  // Compared even with no partner, so an unknown client id takes as long as a wrong secret.
  if (!partnerSecretMatches(input.clientSecret, partner?.secretHash) || partner === undefined) return BAD_CLIENT;
  const parts = parsePartnerCode(input.code);
  if (parts === undefined) return BAD_CODE;
  return deps.db.withWorkspace(parts.workspaceId, async (tx): Promise<PartnerExchange> => {
    const [code] = await tx
      .select({
        partnerId: partnerCodes.partnerId,
        codeHash: partnerCodes.codeHash,
        codeChallenge: partnerCodes.codeChallenge,
        redirectUri: partnerCodes.redirectUri,
        modules: partnerCodes.modules,
        approvedByMemberId: partnerCodes.approvedByMemberId,
        usedAt: partnerCodes.usedAt,
        connectionId: partnerCodes.connectionId,
        expired: sql<boolean>`${partnerCodes.expiresAt} <= now()`,
      })
      .from(partnerCodes)
      .where(eq(partnerCodes.id, parts.id))
      .for('update');
    if (code === undefined || !partnerTokenMatches(parts.secret, code.codeHash) || code.partnerId !== partner.id) {
      return BAD_CODE;
    }
    if (code.usedAt !== null) {
      if (code.connectionId !== null) await endReplayed(tx, parts.workspaceId, code.connectionId, partner.name);
      return {
        ok: false,
        reason: 'invalid_grant',
        message:
          'That code was already used, so Timefix ended the connection it made. Ask the person to connect again.',
      };
    }
    // Anything else wrong burns the code: a stolen one can't be tried again with another verifier.
    const burn = async (): Promise<PartnerExchange> => {
      await tx.delete(partnerCodes).where(eq(partnerCodes.id, parts.id));
      return BAD_CODE;
    };
    if (code.expired || code.redirectUri !== input.redirectUri) return burn();
    if (!pkceMatches(input.codeVerifier, code.codeChallenge)) return burn();
    // The approver must still be an active owner of a live workspace: an approval doesn't outlive their ownership.
    const [approver] = await tx
      .select({ name: workspaces.name })
      .from(members)
      .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
      .where(
        and(
          eq(members.id, code.approvedByMemberId),
          eq(members.status, 'active'),
          eq(members.role, 'owner'),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1);
    if (approver === undefined) return burn();
    const modules = modulesOf(code.modules);
    const secret = newPartnerTokenSecret();
    const tokenHash = partnerTokenHash(secret);
    // One exchange per partner and workspace at a time: two codes swapped together would both find no live row.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`partner_connection:${parts.workspaceId}:${partner.id}`}, 0))`,
    );
    const [live] = await tx
      .select({ id: partnerConnections.id })
      .from(partnerConnections)
      .where(and(eq(partnerConnections.partnerId, partner.id), isNull(partnerConnections.disconnectedAt)))
      .for('update');
    // Connecting again keeps the connection (and, from slice 3, its people) and replaces its token.
    const [connection] =
      live === undefined
        ? await tx
            .insert(partnerConnections)
            .values({
              workspaceId: parts.workspaceId,
              id: newId(),
              partnerId: partner.id,
              modules,
              approvedByMemberId: code.approvedByMemberId,
              tokenHash,
            })
            .returning({ id: partnerConnections.id, createdAt: partnerConnections.createdAt })
        : await tx
            .update(partnerConnections)
            .set({ modules, approvedByMemberId: code.approvedByMemberId, tokenHash, updatedAt: sql`now()` })
            .where(eq(partnerConnections.id, live.id))
            .returning({ id: partnerConnections.id, createdAt: partnerConnections.createdAt });
    if (connection === undefined) throw new Error('A partner connection just written could not be read back.');
    await tx
      .update(partnerCodes)
      .set({ usedAt: sql`now()`, connectionId: connection.id })
      .where(eq(partnerCodes.id, parts.id));
    await writeAudit(
      tx,
      parts.workspaceId,
      { type: 'member', id: code.approvedByMemberId },
      {
        action: 'partner.connected',
        targetType: 'workspace',
        targetId: parts.workspaceId,
        after: { name: partner.name, modules },
      },
    );
    return {
      ok: true,
      token: partnerAccessToken({ workspaceId: parts.workspaceId, id: connection.id, secret }),
      connection: {
        id: connection.id,
        workspace: { id: parts.workspaceId, name: approver.name },
        modules,
        connectedAt: new Date(connection.createdAt).toISOString(),
      },
    };
  });
}
