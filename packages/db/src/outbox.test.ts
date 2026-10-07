// The outbox reader (spec 0005): the relay's one way to Postgres. One relay
// holds the lock; rows are read in order and marked inside withWorkspace; the
// definer function names only workspaces with something waiting; a dropped
// connection settles `lost` instead of crashing the process.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from './client.ts';
import { openDirectConnection } from './direct.ts';
import { createOutboxReader, type OutboxReader } from './outbox.ts';
import { OUTBOX_RETENTION } from './schema/outbox.ts';

const { appUrl, adminUrl } = inject('testDatabase');

let db: Database;
const readers: OutboxReader[] = [];

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-outbox-reader-tests' });
});

afterAll(async () => {
  for (const reader of readers) await reader.close();
  await db.close();
});

async function reader(applicationName = 'crm-outbox-reader-tests'): Promise<OutboxReader> {
  const opened = createOutboxReader(await openDirectConnection({ url: appUrl, applicationName }));
  readers.push(opened);
  return opened;
}

async function workspaceWithEvents(events: readonly { seq: number; published?: boolean }[]): Promise<string> {
  const workspaceId = randomUUID();
  await db.withWorkspace(workspaceId, async (tx) => {
    await tx.execute(
      sql`insert into workspaces (id, name, slug, created_by_type, updated_by_type) values (${workspaceId}, 'w', ${`w-${workspaceId}`}, 'system', 'system')`,
    );
    for (const event of events) {
      await tx.execute(
        sql`insert into outbox (workspace_id, seq, kind, object_id, record_ids, published_at) values (${workspaceId}, ${event.seq}, 'records', ${randomUUID()}, ${`{${randomUUID()}}`}, ${event.published === true ? sql`now()` : null})`,
      );
    }
  });
  return workspaceId;
}

describe('the outbox reader', () => {
  it('lets one reader hold the relay lock at a time, and frees it on unlock or close', async () => {
    const one = await reader();
    const two = await reader();
    expect(await one.lock()).toBe(true);
    expect(await two.lock()).toBe(false);
    await one.unlock();
    expect(await two.lock()).toBe(true);
    await two.close();
    expect(await one.lock()).toBe(true);
    await one.unlock();
  });

  it('reads one workspace’s pending rows in order, marks up to a number, and names only workspaces still waiting', async () => {
    const outbox = await reader();
    const busy = await workspaceWithEvents([{ seq: 1, published: true }, { seq: 3 }, { seq: 2 }, { seq: 4 }]);
    const other = await workspaceWithEvents([{ seq: 1 }]);
    const done = await workspaceWithEvents([{ seq: 1, published: true }]);

    const waiting = await outbox.workspaces(500);
    expect(waiting).toEqual(expect.arrayContaining([busy, other]));
    expect(waiting).not.toContain(done);

    const pending = await outbox.pending(busy, 10);
    expect(pending.map((row) => row.seq)).toEqual([2, 3, 4]);
    expect(pending[0]).toMatchObject({ kind: 'records', coarse: false, mutationId: undefined, attributeIds: [] });
    expect(pending[0]?.recordIds).toHaveLength(1);
    expect((await outbox.pending(busy, 1)).map((row) => row.seq)).toEqual([2]);

    expect(await outbox.mark(busy, 3)).toBe(2);
    expect((await outbox.pending(busy, 10)).map((row) => row.seq)).toEqual([4]);
    // Another workspace's rows are out of reach of a mark, whatever the number.
    expect(await outbox.mark(busy, 100)).toBe(1);
    expect((await outbox.pending(other, 10)).map((row) => row.seq)).toEqual([1]);
    expect(await outbox.workspaces(500)).not.toContain(busy);
  });

  it('marks the last batch and reads the next in one round trip, scoped to the workspace, leaving no setting behind', async () => {
    const direct = await openDirectConnection({ url: appUrl, applicationName: 'crm-outbox-reader-tests' });
    const queries: string[] = [];
    const query = direct.query.bind(direct) as (text: string, ...rest: unknown[]) => Promise<unknown>;
    // Count what reaches the client: each call is one round trip.
    Object.assign(direct, {
      query: (text: string, ...rest: unknown[]) => {
        queries.push(text);
        return query(text, ...rest);
      },
    });
    const outbox = createOutboxReader(direct);
    readers.push(outbox);
    const busy = await workspaceWithEvents([{ seq: 1 }, { seq: 2 }, { seq: 3 }, { seq: 4 }]);
    const other = await workspaceWithEvents([{ seq: 1 }, { seq: 2 }]);

    const before = queries.length;
    const next = await outbox.advance(busy, 2, 10);
    expect(queries.length - before).toBe(1);
    expect(next.marked).toBe(2);
    expect(next.rows.map((row) => row.seq)).toEqual([3, 4]);
    expect(next.rows[0]).toMatchObject({ kind: 'records', coarse: false, mutationId: undefined });
    // Row level security holds: a number past the other workspace's rows marks none of them.
    expect((await outbox.advance(busy, 100, 10)).marked).toBe(2);
    expect((await outbox.pending(other, 10)).map((row) => row.seq)).toEqual([1, 2]);
    // The setting lived only as long as that one transaction.
    const left = (await query("select current_setting('app.workspace_id', true) as setting")) as {
      rows: { setting: string }[];
    };
    expect(left.rows).toEqual([{ setting: '' }]);

    // Nothing reaches Postgres unless the id is a uuid and the number whole.
    const sent = queries.length;
    await expect(outbox.advance("x'; drop table outbox; --", 1, 10)).rejects.toThrow(TypeError);
    await expect(outbox.advance(busy, 1.5, 10)).rejects.toThrow(TypeError);
    await expect(outbox.mark(busy, Number.NaN)).rejects.toThrow(TypeError);
    expect(queries.length).toBe(sent);
  });

  it('prunes published rows exactly past OUTBOX_RETENTION, the interval crm_outbox_prune hard codes', async () => {
    const outbox = await reader();
    const workspaceId = await workspaceWithEvents([]);
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      const event = (seq: number, published: string | undefined) =>
        admin.query(
          `insert into outbox (workspace_id, seq, kind, object_id, published_at)
           values ($1, $2, 'records', $3, case when $4::text is null then null else now() - $4::interval end)`,
          [workspaceId, seq, randomUUID(), published ?? null],
        );
      // Just past the constant's cutoff, and just inside it.
      await event(1, `${OUTBOX_RETENTION} 1 minute`);
      await event(2, `${OUTBOX_RETENTION} -1 minute`);
      await event(3, undefined);
      expect(await outbox.prune(1_000)).toBeGreaterThanOrEqual(1);
      const left = await admin.query<{ seq: number }>(
        'select seq::int as seq from outbox where workspace_id = $1 order by seq',
        [workspaceId],
      );
      expect(left.rows.map((row) => row.seq)).toEqual([2, 3]);

      // A workspace's events go with it.
      await admin.query('delete from workspaces where id = $1', [workspaceId]);
      const gone = await admin.query('select 1 from outbox where workspace_id = $1', [workspaceId]);
      expect(gone.rowCount).toBe(0);
    } finally {
      await admin.end();
    }
  });

  it('hears a NOTIFY on crm_outbox naming a workspace, and ignores anything else', async () => {
    const outbox = await reader();
    const heard: string[] = [];
    await outbox.listen((workspaceId) => heard.push(workspaceId));
    const workspaceId = randomUUID();
    const sender = new pg.Client({ connectionString: appUrl });
    await sender.connect();
    try {
      await sender.query(`select pg_notify('crm_outbox', 'not a workspace')`);
      await sender.query(`select pg_notify('crm_outbox', $1)`, [workspaceId.toUpperCase()]);
    } finally {
      await sender.end();
    }
    await expect.poll(() => heard).toEqual([workspaceId]);
  });

  it('settles lost when the connection drops, without an unhandled error', async () => {
    const name = `crm-outbox-drop-${randomUUID().slice(0, 8)}`;
    const outbox = await reader(name);
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where application_name = $1', [name]);
    } finally {
      await admin.end();
    }
    await expect(outbox.lost).resolves.toBeInstanceOf(Error);
    await expect(outbox.lock()).rejects.toThrow();
  });
});
