// The open thread count a table row and a board card show (the CRM flow pass, 31 October 2026), against a real
// Postgres as the app role: one grouped statement for a whole read, counting open threads only (resolved and emptied
// ones are out), nothing for a record the reader can't see, absent unless asked for, and an index walk (EXPLAIN).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { AccessRules } from '../access/policy.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { createRecord } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { readRecordsById } from '../records/records.ts';
import { rescope, testScope } from '../testing.ts';
import { createComment, deleteComment, setThreadResolved } from './comments.ts';
import { openThreadCounts, openThreadCountsStatement } from './counts.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-comment-counts-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Counts',
    slug: `counts-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const names = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string }>(
      sql`select a.id::text from attributes a join objects o on o.id = a.object_id where o.api_slug = 'companies' and a.api_slug = 'name'`,
    ),
  );
  const nameId = names.rows[0]?.id ?? '';
  const companies = created.objects.companies ?? '';
  const company = async (name: string) =>
    (await createRecord(scope, { objectId: companies, values: { [nameId]: name } })).recordId;
  const bea = newId();
  await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${scope.workspaceId}, ${bea}, 'Bea', 'bea@example.com', 'member', 'system', 'system')`,
    ),
  );
  const hidden: AccessRules = {
    levels: [
      { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: companies }, level: 'none' },
    ],
    records: [],
  };
  const asBea = rescope(scope, { actor: { type: 'member', id: bea }, role: 'member', rules: hidden });
  return { scope, company, asBea };
}

const hooks = () => [outboxHook({ mutationId: newId() })];

describe('open comment threads on a read of records', () => {
  it('counts a record’s open threads: replies are not threads, resolved and emptied threads are out', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const globex = await w.company('Globex');
    const quiet = await w.company('Quiet');
    const first = newId();
    await createComment(w.scope, { id: first, recordId: acme, body: 'One' }, hooks());
    await createComment(w.scope, { id: newId(), recordId: acme, threadId: first, body: 'A reply' }, hooks());
    const second = newId();
    await createComment(w.scope, { id: second, recordId: acme, body: 'Two' }, hooks());
    const done = newId();
    await createComment(w.scope, { id: done, recordId: globex, body: 'Done' }, hooks());
    await setThreadResolved(w.scope, { threadId: done, resolved: true }, hooks());
    const gone = newId();
    await createComment(w.scope, { id: gone, recordId: globex, body: 'Gone' }, hooks());
    await deleteComment(w.scope, { commentId: gone }, hooks());
    const read = await readRecordsById(w.scope, [acme, globex, quiet], undefined, { threadCounts: true });
    expect(read.map((record) => record.openThreads)).toEqual([2, 0, 0]);
    // Absent on a read that didn't ask: the count is one more statement, only when a screen shows it.
    const plain = await readRecordsById(w.scope, [acme]);
    expect(plain[0]).not.toHaveProperty('openThreads');
    // Resolving one moves the count down at once.
    await setThreadResolved(w.scope, { threadId: second, resolved: true }, hooks());
    expect((await readRecordsById(w.scope, [acme], undefined, { threadCounts: true }))[0]?.openThreads).toBe(1);
  });

  it('counts nothing for a record the reader can’t see: the record is absent, so its threads are never counted', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    await createComment(w.scope, { id: newId(), recordId: acme, body: 'Private' }, hooks());
    const seen = await readRecordsById(w.asBea, [acme], undefined, { threadCounts: true });
    expect(seen).toEqual([]);
    const owner = await readRecordsById(w.scope, [acme], undefined, { threadCounts: true });
    expect(owner[0]?.openThreads).toBe(1);
  });

  it('asks for the whole read in one grouped statement, walking a record index', async () => {
    const w = await workspace();
    const ids = await Promise.all(['A', 'B', 'C'].map((name) => w.company(name)));
    await createComment(w.scope, { id: newId(), recordId: ids[0] ?? '', body: 'x' }, hooks());
    const counted = await db.withWorkspace(w.scope.workspaceId, (tx) => openThreadCounts(tx, ids));
    expect(counted.get(ids[0] ?? '')).toBe(1);
    expect(counted.has(ids[1] ?? '')).toBe(false);
    const plan = await db.withWorkspace(w.scope.workspaceId, async (tx) => {
      // A handful of rows would make a sequential scan the cheapest plan; switched off, the planner shows whether
      // the index can answer the question at all.
      await tx.execute(sql`set local enable_seqscan = off`);
      const found = await tx.execute<{ 'QUERY PLAN': unknown }>(
        sql`explain (format json) ${openThreadCountsStatement(ids)}`,
      );
      return JSON.stringify(found.rows[0]?.['QUERY PLAN']);
    });
    // Through a record index (a thread's first comments by record), never a scan of every comment.
    expect(plan).toMatch(/comments_(by_record|record_all)/u);
    expect(plan).not.toContain('Seq Scan');
  });
});
