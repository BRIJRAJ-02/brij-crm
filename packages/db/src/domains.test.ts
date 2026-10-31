// Custom domains (spec 0064, migration 0145): the table keeps to its workspace, a proved host is one page's alone,
// and the two lookups across workspaces answer only what they say: a live host's handle, and whether a host is
// already proved somewhere else.
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from './client.ts';

const { appUrl, ownerUrl } = inject('testDatabase');

let owner: pg.Client;
let db: Database;

beforeAll(async () => {
  owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  db = createDatabase({ url: appUrl, applicationName: 'crm-domain-tests' });
});

afterAll(async () => {
  await owner.end();
  await db.close();
});

/** A person with a live link page in a new workspace, as the app and the identity store make them. */
async function pageOwner() {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const memberId = randomUUID();
  const handle = `d${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await owner.query(`insert into auth."user" (id, name, email) values ($1, 'Ada', $2)`, [
    userId,
    `${userId}@example.com`,
  ]);
  await db.withWorkspace(workspaceId, async (tx) => {
    await tx.execute(
      sql`insert into workspaces (id, name, slug, created_by_type, updated_by_type) values (${workspaceId}, 'Domains', ${`domains-${workspaceId}`}, 'system', 'system')`,
    );
    await tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, user_id, created_by_type, updated_by_type) values (${workspaceId}, ${memberId}, 'Ada', ${`ada-${memberId}@example.com`}, 'owner', ${userId}, 'system', 'system')`,
    );
  });
  await owner.query(`insert into auth.public_handles (handle, user_id, workspace_id) values ($1, $2, $3)`, [
    handle,
    userId,
    workspaceId,
  ]);
  await owner.query(
    `insert into auth.public_profiles (user_id, workspace_id, handle, shown_at) values ($1, $2, $3, now())`,
    [userId, workspaceId, handle],
  );
  return { userId, workspaceId, memberId, handle };
}

type PageOwner = Awaited<ReturnType<typeof pageOwner>>;

/** A domain row for `who`, as core writes one. */
async function domainOf(who: PageOwner, host: string, fields: { status?: string; verified?: boolean } = {}) {
  const id = randomUUID();
  await db.withWorkspace(who.workspaceId, (tx) =>
    tx.execute(
      sql`insert into public_domains (workspace_id, id, member_id, user_id, host, kind, status, verify_token, verified_at)
        values (${who.workspaceId}, ${id}, ${who.memberId}, ${who.userId}, ${host}, 'subdomain', ${fields.status ?? 'waiting'},
          ${randomBytes(16).toString('hex')}, ${fields.verified === true ? sql`now()` : null})`,
    ),
  );
  return id;
}

const handleOf = (workspaceId: string, host: string) =>
  db.withWorkspace(
    workspaceId,
    async (tx) =>
      (await tx.execute<{ handle: string | null }>(sql`select crm_live_domain_handle(${host}) as handle`)).rows[0]
        ?.handle,
  );

const bound = (workspaceId: string, host: string, mine?: string) =>
  db.withWorkspace(
    workspaceId,
    async (tx) =>
      (await tx.execute<{ bound: boolean }>(sql`select crm_domain_host_bound(${host}, ${mine ?? null}::uuid) as bound`))
        .rows[0]?.bound,
  );

const hostName = () => `book.${randomUUID().slice(0, 8)}.example.test`;

describe('public_domains (spec 0064, migration 0145)', () => {
  it("reads none of another workspace's domains, even with no filter", async () => {
    const a = await pageOwner();
    const b = await pageOwner();
    await domainOf(a, hostName());
    const seen = await db.withWorkspace(b.workspaceId, (tx) =>
      tx.execute<{ id: string }>(sql`select id from public_domains`),
    );
    expect(seen.rows).toEqual([]);
    await expect(
      db.withWorkspace(b.workspaceId, (tx) =>
        tx.execute(
          sql`insert into public_domains (workspace_id, member_id, user_id, host, kind, verify_token)
            values (${a.workspaceId}, ${a.memberId}, ${a.userId}, ${hostName()}, 'subdomain', ${randomBytes(16).toString('hex')})`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('keeps one domain per link page, and a proved host to one page everywhere', async () => {
    const a = await pageOwner();
    const b = await pageOwner();
    const host = hostName();
    await domainOf(a, host);
    await expect(domainOf(a, hostName())).rejects.toMatchObject({ cause: { code: '23505' } });
    // Asking is not proving: a second person may ask for the same host while nobody has proved it.
    const theirs = await domainOf(b, host);
    await db.withWorkspace(b.workspaceId, (tx) =>
      tx.execute(sql`update public_domains set verified_at = now(), status = 'checking' where id = ${theirs}`),
    );
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(sql`update public_domains set verified_at = now() where host = ${host}`),
      ),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });

  it('answers a handle only for a live, proved host whose page is public', async () => {
    const a = await pageOwner();
    const b = await pageOwner();
    const host = hostName();
    const id = await domainOf(a, host);
    expect(await handleOf(b.workspaceId, host)).toBeNull();
    await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute(sql`update public_domains set status = 'live' where id = ${id}`),
    );
    // Live but never proved reads as nothing.
    expect(await handleOf(b.workspaceId, host)).toBeNull();
    await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute(sql`update public_domains set verified_at = now() where id = ${id}`),
    );
    // From any workspace, or none at all: a visitor has none.
    expect(await handleOf(b.workspaceId, host)).toBe(a.handle);
    expect(await handleOf(randomUUID(), host)).toBe(a.handle);
    // A deleted workspace serves nothing.
    await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute(sql`update workspaces set deleted_at = now() where id = ${a.workspaceId}`),
    );
    expect(await handleOf(b.workspaceId, host)).toBeNull();
  });

  it('says whether a host is proved by another row, and nothing more', async () => {
    const a = await pageOwner();
    const b = await pageOwner();
    const host = hostName();
    const id = await domainOf(a, host, { status: 'checking', verified: true });
    expect(await bound(b.workspaceId, host)).toBe(true);
    expect(await bound(a.workspaceId, host, id)).toBe(false);
    expect(await bound(b.workspaceId, hostName())).toBe(false);
    await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute(sql`update public_domains set status = 'removed', removed_at = now() where id = ${id}`),
    );
    expect(await bound(b.workspaceId, host)).toBe(false);
  });

  it('queues a check for a domain of the caller’s workspace only, keyed by the domain', async () => {
    const a = await pageOwner();
    const b = await pageOwner();
    const id = await domainOf(a, hostName());
    const queue = (workspaceId: string, delay: number) =>
      db.withWorkspace(
        workspaceId,
        async (tx) =>
          (
            await tx.execute<{ queued: boolean }>(
              sql`select crm_enqueue_domain_check(${id}::uuid, ${delay}::integer) as queued`,
            )
          ).rows[0]?.queued,
      );
    expect(await queue(b.workspaceId, 0)).toBe(false);
    expect(await queue(a.workspaceId, 900)).toBe(true);
    expect(await queue(a.workspaceId, 10_000_000)).toBe(true);
    const rows = await owner.query<{ task: string; due: boolean }>(
      `select task_identifier as task, run_at <= now() + interval '1 day 1 minute' as due
       from graphile_worker.jobs where key = $1`,
      [`crm-domain:${a.workspaceId}:${id}`],
    );
    // One waiting row, its time clamped to a day.
    expect(rows.rows).toEqual([{ task: 'crm_domains_check', due: true }]);
  });
});
