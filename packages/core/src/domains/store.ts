// A link page's custom domain in the database (spec 0064, slice 1). Only the page's owner reads or changes it: every
// member read and write is the caller's own row (`user_id`), through their own scope; the check job reads and saves
// any row of a workspace as the system. No audit row and no change event, as for the rest of a link page: the page is
// the person's, not the workspace's, and only its owner ever holds this card.
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { CustomDomain, DnsRecord, type DomainStatus } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { ownUserId } from '../access/door.ts';
import { inWorkspace } from '../access/run.ts';
import { isUuid } from '../engine/ids.ts';
import { postgresError, refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { publicProfilesOf } from '../booking/handles.ts';
import type { NormalHost } from './hosts.ts';
import {
  DOMAIN_PROBLEMS,
  ownershipRecord,
  recordsFor,
  type CheckDecision,
  type CheckedDomain,
  type StoredStatus,
} from './status.ts';

/** How soon the first check runs after an add: a minute, for an owner who set the records before adding. */
export const FIRST_CHECK_SECONDS = 60;

/** How soon a removed domain's detach is tried again when the at once removal failed. */
export const DETACH_RETRY_SECONDS = 120;

/** A domain row as the check reads it. */
export interface DomainRow extends CheckedDomain {
  readonly id: string;
  readonly workspaceId: string;
  readonly problem?: string;
  readonly lastCheckedAt?: Date;
  readonly detachedAt?: Date;
}

interface StoredRow extends Record<string, unknown> {
  readonly id: string;
  readonly workspace_id: string;
  readonly host: string;
  readonly kind: string;
  readonly status: string;
  readonly verify_token: string;
  readonly dns_records: unknown;
  readonly problem: string | null;
  readonly waiting_since: Date | string;
  readonly verified_at: Date | string | null;
  readonly live_at: Date | string | null;
  readonly last_checked_at: Date | string | null;
  readonly detached_at: Date | string | null;
}

const COLUMNS = sql`id::text as id, workspace_id::text as workspace_id, host, kind, status, verify_token, dns_records, problem, waiting_since, verified_at, live_at, last_checked_at, detached_at`;

const STATUSES: readonly StoredStatus[] = ['waiting', 'checking', 'live', 'attention', 'failed', 'removed'];

const at = (value: Date | string | null): Date | undefined =>
  value === null ? undefined : value instanceof Date ? value : new Date(value);

/** A stored row as the check reads it; a status or kind the code doesn't know reads as a failed subdomain. */
function rowOf(row: StoredRow): DomainRow {
  const records = Array.isArray(row.dns_records)
    ? row.dns_records.flatMap((record: unknown) => {
        const parsed = DnsRecord.safeParse(record);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const status = STATUSES.find((known) => known === row.status) ?? 'failed';
  const verifiedAt = at(row.verified_at);
  const liveAt = at(row.live_at);
  const lastCheckedAt = at(row.last_checked_at);
  const detachedAt = at(row.detached_at);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    host: row.host,
    kind: row.kind === 'apex' ? 'apex' : 'subdomain',
    status,
    verifyToken: row.verify_token,
    records,
    waitingSince: at(row.waiting_since) ?? new Date(0),
    ...(row.problem === null ? {} : { problem: row.problem }),
    ...(verifiedAt === undefined ? {} : { verifiedAt }),
    ...(liveAt === undefined ? {} : { liveAt }),
    ...(lastCheckedAt === undefined ? {} : { lastCheckedAt }),
    ...(detachedAt === undefined ? {} : { detachedAt }),
  };
}

/** A row as its owner's card reads it (a removed one is never shown). */
export function viewOf(row: DomainRow): CustomDomain {
  const status: DomainStatus = row.status === 'removed' ? 'failed' : row.status;
  const records = row.records.length > 0 ? row.records : recordsFor(row);
  // The ownership record always leads, whatever an older row stored.
  const own = ownershipRecord(row.host, row.verifyToken);
  return CustomDomain.parse({
    id: row.id,
    host: row.host,
    kind: row.kind,
    status,
    ...(row.problem === undefined ? {} : { problem: row.problem }),
    records: [own, ...records.filter((record) => record.purpose !== 'ownership')],
    ...(row.lastCheckedAt === undefined ? {} : { checkedAt: row.lastCheckedAt.toISOString() }),
    ...(row.liveAt === undefined ? {} : { liveAt: row.liveAt.toISOString() }),
  });
}

/**
 * Whose rows a scope reaches: a member's own (by their sign in identity), or every row of the workspace for the
 * system's check job. Anyone else reaches none.
 */
function reachOf(scope: EngineScope): { readonly userId?: string } {
  const { principal } = scope.access;
  if (principal.kind === 'system') return {};
  return { userId: ownUserId(scope) };
}

const ownedBy = (reach: { readonly userId?: string }) =>
  reach.userId === undefined ? sql`true` : sql`user_id = ${reach.userId}::uuid`;

/** Puts the domain's next check on the queue, in the caller's transaction (`crm_enqueue_domain_check`). */
async function queueCheck(tx: WorkspaceTx, id: string, inSeconds: number): Promise<void> {
  await tx.execute(sql`select crm_enqueue_domain_check(${id}::uuid, ${Math.round(inSeconds)}::integer)`);
}

/** The caller's link page's domain in this workspace, or undefined while it has none (a removed one included). */
export async function getMyDomain(scope: EngineScope): Promise<CustomDomain | undefined> {
  const userId = ownUserId(scope);
  const found = await inWorkspace(scope, (tx) =>
    tx.execute<StoredRow>(
      sql`select ${COLUMNS} from public_domains where user_id = ${userId}::uuid and status <> 'removed' limit 1`,
    ),
  );
  const row = found.rows[0];
  return row === undefined ? undefined : viewOf(rowOf(row));
}

/** A new domain's ownership token: 16 random bytes as 32 hex characters (the table's check holds the shape). */
export function newVerifyToken(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Adds a domain to the caller's link page in this workspace (AC-6401, AC-6402, AC-6408). The host comes already
 * normalised (`normaliseHost`), with the routing records Vercel recommends when the api could read them. Refused:
 * a person with no link page here (`NOT_FOUND`), a page with a domain already (`LIMIT_REACHED`), and a host another
 * page has proved (`IN_USE`, "That domain is already in use."). Its first check is queued in the same transaction.
 */
export async function addMyDomain(
  scope: EngineScope,
  input: { readonly host: NormalHost; readonly routing?: readonly DnsRecord[]; readonly token?: string },
): Promise<CustomDomain> {
  const userId = ownUserId(scope);
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', 'Only a signed in person has a link page.');
  const token = input.token ?? newVerifyToken();
  const records = [
    ownershipRecord(input.host.host, token),
    ...(input.routing ?? []).filter((record) => record.purpose === 'routing'),
  ];
  return inWorkspace(scope, async (tx) => {
    const profiles = await publicProfilesOf(tx, scope.workspaceId, [userId]);
    if (!profiles.has(userId)) throw refuse('NOT_FOUND', 'Pick a handle before you add a domain.');
    const held = await tx.execute<{ id: string }>(
      sql`select id::text as id from public_domains where user_id = ${userId}::uuid and status <> 'removed' limit 1`,
    );
    if (held.rows.length > 0) throw refuse('LIMIT_REACHED', 'Your page has a domain already. Remove it first.');
    const bound = await tx.execute<{ bound: boolean }>(
      sql`select crm_domain_host_bound(${input.host.host}, null::uuid) as bound`,
    );
    if (bound.rows[0]?.bound === true) throw refuse('IN_USE', DOMAIN_PROBLEMS.inUse);
    let made: StoredRow | undefined;
    try {
      const inserted = await tx.execute<StoredRow>(
        sql`insert into public_domains (workspace_id, member_id, user_id, host, kind, verify_token, dns_records)
          values (${scope.workspaceId}::uuid, ${principal.memberId}::uuid, ${userId}::uuid, ${input.host.host},
            ${input.host.kind}, ${token}, ${JSON.stringify(records)}::jsonb)
          returning ${COLUMNS}`,
      );
      made = inserted.rows[0];
    } catch (error) {
      if (postgresError(error)?.code === '23505') {
        throw refuse('LIMIT_REACHED', 'Your page has a domain already. Remove it first.');
      }
      throw error;
    }
    if (made === undefined) throw new Error('The domain insert answered no row.');
    await queueCheck(tx, made.id, FIRST_CHECK_SECONDS);
    return viewOf(rowOf(made));
  });
}

/** One domain as the check reads it: the caller's own, or any of the workspace's for the system. */
export async function readDomainForCheck(scope: EngineScope, domainId: string): Promise<DomainRow | undefined> {
  if (!isUuid(domainId)) return undefined;
  const reach = reachOf(scope);
  const found = await inWorkspace(scope, (tx) =>
    tx.execute<StoredRow>(
      sql`select ${COLUMNS} from public_domains where id = ${domainId}::uuid and ${ownedBy(reach)}`,
    ),
  );
  const row = found.rows[0];
  return row === undefined ? undefined : rowOf(row);
}

/**
 * A failed domain starts waiting again (Try again, AC-6408): seven more days for its TXT record, from now. Any other
 * domain is as it was. Answers the row after.
 */
export async function restartDomain(scope: EngineScope, domainId: string): Promise<DomainRow | undefined> {
  if (!isUuid(domainId)) return undefined;
  const reach = reachOf(scope);
  const found = await inWorkspace(scope, (tx) =>
    tx.execute<StoredRow>(
      sql`update public_domains set status = 'waiting', problem = null, waiting_since = now(), updated_at = now()
        where id = ${domainId}::uuid and ${ownedBy(reach)} and status = 'failed' and verified_at is null
        returning ${COLUMNS}`,
    ),
  );
  const row = found.rows[0];
  return row === undefined ? await readDomainForCheck(scope, domainId) : rowOf(row);
}

/**
 * Saves what a check decided (AC-6403, AC-6404), and queues the next check in the same transaction when there is
 * one. The first time the TXT record is found the host becomes this page's alone: if another page proved it first,
 * the unique index refuses it and the domain fails with "That domain is already in use."
 */
export async function saveDomainCheck(
  scope: EngineScope,
  domainId: string,
  decision: CheckDecision,
): Promise<DomainRow | undefined> {
  if (!isUuid(domainId)) return undefined;
  const reach = reachOf(scope);
  const save = (tx: WorkspaceTx, next: CheckDecision) =>
    tx.execute<StoredRow>(
      sql`update public_domains set
          status = ${next.status},
          problem = ${next.problem ?? null},
          dns_records = ${JSON.stringify(next.records)}::jsonb,
          verified_at = case when ${next.verifiedNow} then coalesce(verified_at, now()) else verified_at end,
          live_at = case when ${next.liveNow} then now() else live_at end,
          last_checked_at = now(),
          updated_at = now()
        where id = ${domainId}::uuid and ${ownedBy(reach)} and status <> 'removed'
        returning ${COLUMNS}`,
    );
  try {
    return await inWorkspace(scope, async (tx) => {
      const saved = (await save(tx, decision)).rows[0];
      if (saved !== undefined && decision.nextInSeconds !== undefined) {
        await queueCheck(tx, domainId, decision.nextInSeconds);
      }
      return saved === undefined ? undefined : rowOf(saved);
    });
  } catch (error) {
    if (postgresError(error)?.code !== '23505' || !decision.verifiedNow) throw error;
    const taken: CheckDecision = {
      status: 'failed',
      problem: DOMAIN_PROBLEMS.inUse,
      verifiedNow: false,
      liveNow: false,
      records: decision.records,
    };
    return await inWorkspace(scope, async (tx) => {
      const saved = (await save(tx, taken)).rows[0];
      return saved === undefined ? undefined : rowOf(saved);
    });
  }
}

/**
 * Removes the caller's domain (AC-6408): the host is freed at once and serves nothing from now on. Answers what the
 * api needs to take it out of the Vercel project (the host, and whether it was ever added there: only a proved one
 * was), or undefined when there was nothing of theirs to remove. A proved one's detach is also queued, as the
 * fallback for an at once removal that fails.
 */
export async function removeMyDomain(
  scope: EngineScope,
  domainId: string,
): Promise<{ readonly host: string; readonly kind: 'apex' | 'subdomain'; readonly attached: boolean } | undefined> {
  if (!isUuid(domainId)) return undefined;
  const userId = ownUserId(scope);
  return inWorkspace(scope, async (tx) => {
    const found = await tx.execute<StoredRow>(
      sql`update public_domains set status = 'removed', removed_at = now(), updated_at = now()
        where id = ${domainId}::uuid and user_id = ${userId}::uuid and status <> 'removed'
        returning ${COLUMNS}`,
    );
    const row = found.rows[0];
    if (row === undefined) return undefined;
    const removed = rowOf(row);
    const attached = removed.verifiedAt !== undefined;
    if (attached) await queueCheck(tx, domainId, DETACH_RETRY_SECONDS);
    return { host: removed.host, kind: removed.kind, attached };
  });
}

/** Marks a removed domain as out of the Vercel project, so nothing tries to detach it again. */
export async function markDomainDetached(scope: EngineScope, domainId: string): Promise<void> {
  if (!isUuid(domainId)) return;
  const reach = reachOf(scope);
  await inWorkspace(scope, (tx) =>
    tx.execute(
      sql`update public_domains set detached_at = now(), updated_at = now()
        where id = ${domainId}::uuid and ${ownedBy(reach)} and status = 'removed' and detached_at is null`,
    ),
  );
}

/**
 * The live custom host of a person's link page in a workspace, read inside that workspace's transaction (the link
 * page's own read, for its canonical address, AC-6407), or undefined.
 */
export async function liveHostOf(tx: WorkspaceTx, userId: string): Promise<string | undefined> {
  if (!isUuid(userId)) return undefined;
  const found = await tx.execute<{ host: string }>(
    sql`select host from public_domains where user_id = ${userId}::uuid and status = 'live' and verified_at is not null limit 1`,
  );
  return found.rows[0]?.host;
}
