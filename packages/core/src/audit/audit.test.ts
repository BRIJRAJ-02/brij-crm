// Workspace changes' read (spec 0046) against a real Postgres as the app role:
// the two guards (a member can't read the log, and another workspace's rows
// never show), keyset paging over rows one transaction wrote, the answer with
// no IP, request id or raw before and after, the statements a page costs, and
// a read that writes nothing.
import { sql } from 'drizzle-orm';
import { PERMISSIONS, type AuditPage } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { NO_RULE_SOURCE, enterAsActor } from '../access/door.ts';
import type { EngineScope } from '../access/mint.ts';
import { newId } from '../engine/ids.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { writeAudit } from '../members/audit.ts';
import { inviteMembers } from '../members/invitations.ts';
import { setMemberRole } from '../members/members.ts';
import { testScope } from '../testing.ts';
import { updateWorkspace } from '../workspace/settings.ts';
import { AUDIT_CURSOR_MESSAGE, listAuditEvents } from './audit.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
/** Every statement the counting connection sends while `counting` is on, but its transaction's begin and commit. */
const statements: string[] = [];
let counting = false;
let counted: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-audit-tests' });
  counted = createDatabase({
    url: appUrl,
    applicationName: 'crm-audit-count-tests',
    onPool: (pool) => {
      pool.on('connect', (client) => {
        const query = client.query.bind(client) as (...args: unknown[]) => unknown;
        Object.assign(client, {
          query: (...args: unknown[]) => {
            const first = args[0];
            const text =
              typeof first === 'string'
                ? first
                : typeof first === 'object' && first !== null && 'text' in first && typeof first.text === 'string'
                  ? first.text
                  : '';
            if (counting && !/^\s*(begin|commit|rollback)\b/i.test(text)) statements.push(text);
            return query(...args);
          },
        });
      });
    },
  });
});
afterAll(async () => {
  await Promise.all([db.close(), counted.close()]);
});

const tag = () => newId().slice(-12);

/** A workspace its owner made, with a second member of `role`, and scopes for both on `database`. */
async function workspace(role: 'admin' | 'member' = 'member', database: Database = db) {
  const created = await createWorkspace(db, {
    name: 'Acme',
    slug: `audit-${tag()}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const { workspaceId, memberId: ownerId } = created;
  const otherId = newId();
  await db.withWorkspace(workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${otherId}, 'Bea', ${`${otherId}@example.com`}, ${role}, 'system', 'system')`,
    ),
  );
  return {
    workspaceId,
    ownerId,
    otherId,
    owner: testScope({ db: database, workspaceId, actor: { type: 'member', id: ownerId } }),
    other: testScope({ db: database, workspaceId, actor: { type: 'member', id: otherId }, role }),
  };
}

/** An invite, a role change and a rename, through the services. */
async function threeChanges(at: Awaited<ReturnType<typeof workspace>>, name: string) {
  await inviteMembers(at.owner, { emails: [`${tag()}@example.com`], role: 'member' });
  await setMemberRole(at.owner, { memberId: at.otherId, role: 'admin' });
  await updateWorkspace(at.owner, { name });
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

/** Every page from the top, `limit` rows at a time. */
async function allPages(scope: EngineScope, limit: number): Promise<AuditPage[]> {
  const pages: AuditPage[] = [];
  let cursor: string | undefined;
  do {
    const page = await listAuditEvents(scope, { limit, ...(cursor === undefined ? {} : { cursor }) });
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor !== undefined && pages.length < 50);
  return pages;
}

const FORBIDDEN = { code: 'FORBIDDEN', message: PERMISSIONS['audit.read'].message };

describe('a member can’t read the log (AC-4622, AC-4634)', () => {
  it('refuses a member, and an admin just lowered to member, before any statement touches the log', async () => {
    const at = await workspace('member', counted);
    await threeChanges(at, 'Acme Ltd');
    expect(FORBIDDEN.message).toBe('Only workspace owners and admins can read the audit log.');
    statements.length = 0;
    counting = true;
    try {
      expect(await refusalOf(listAuditEvents(at.other))).toEqual(FORBIDDEN);
    } finally {
      counting = false;
    }
    expect(statements).toEqual([]);

    // An admin reads it; lowered to member, the door's next scope (their current role) is refused.
    const admin = await workspace('admin', counted);
    const before = await enterAsActor(
      { db: counted, rules: NO_RULE_SOURCE },
      { workspaceId: admin.workspaceId, actor: { type: 'member', id: admin.otherId } },
    );
    expect((await listAuditEvents(before)).entries).toEqual([]);
    await setMemberRole(admin.owner, { memberId: admin.otherId, role: 'member' });
    const lowered = await enterAsActor(
      { db: counted, rules: NO_RULE_SOURCE },
      { workspaceId: admin.workspaceId, actor: { type: 'member', id: admin.otherId } },
    );
    statements.length = 0;
    counting = true;
    try {
      expect(await refusalOf(listAuditEvents(lowered))).toEqual(FORBIDDEN);
    } finally {
      counting = false;
    }
    expect(statements.filter((text) => text.includes('audit_events'))).toEqual([]);
    expect(statements).toEqual([]);
  });

  it('refuses an API key without the audit.read scope', async () => {
    const at = await workspace();
    const key = testScope({ db, workspaceId: at.workspaceId, actor: { type: 'api_key', id: newId() }, scopes: [] });
    expect(await refusalOf(listAuditEvents(key))).toEqual(FORBIDDEN);
  });
});

describe('another workspace’s rows never show (AC-4623, AC-4635)', () => {
  it('answers each owner their own rows, and a cursor from one workspace pages the other’s own rows only', async () => {
    const a = await workspace();
    const b = await workspace();
    await threeChanges(a, 'Alpha');
    await threeChanges(b, 'Beta');
    const ofA = (await listAuditEvents(a.owner)).entries;
    const ofB = (await listAuditEvents(b.owner)).entries;
    for (const entries of [ofA, ofB]) {
      expect(entries.map((entry) => entry.action)).toEqual([
        'workspace.updated',
        'member.role_changed',
        'invitation.created',
      ]);
    }
    expect(ofA[0]?.params).toMatchObject({ to: 'Alpha' });
    expect(ofB[0]?.params).toMatchObject({ to: 'Beta' });
    const idsOfA = new Set(ofA.map((entry) => entry.id));
    expect(ofB.some((entry) => idsOfA.has(entry.id))).toBe(false);
    // An admin of A reads A's log too.
    const adminOfA = testScope({ db, workspaceId: a.workspaceId, actor: { type: 'member', id: a.otherId } });
    expect((await listAuditEvents(adminOfA)).entries.map((entry) => entry.id)).toEqual(ofA.map((entry) => entry.id));

    // B's rows are newer than A's: a cursor minted in A (after A's first row) is just a position in B.
    const first = await listAuditEvents(a.owner, { limit: 1 });
    expect(first.nextCursor).toBeDefined();
    const crossed = await listAuditEvents(b.owner, { cursor: first.nextCursor ?? '' });
    expect(crossed.entries.some((entry) => idsOfA.has(entry.id))).toBe(false);
    const idsOfB = new Set(ofB.map((entry) => entry.id));
    expect(crossed.entries.every((entry) => idsOfB.has(entry.id))).toBe(true);
    // And the other way: a cursor from B, used in A, reads only A's own rows (all older than it).
    const fromB = await listAuditEvents(b.owner, { limit: 1 });
    const back = await listAuditEvents(a.owner, { cursor: fromB.nextCursor ?? '' });
    expect(back.entries.map((entry) => entry.id)).toEqual(ofA.map((entry) => entry.id));
  });
});

describe('paging (AC-4603, AC-4627)', () => {
  it('reads an invite of 20 sharing one `at` over pages of 7, each row once, in the order of one page', async () => {
    const at = await workspace();
    await inviteMembers(at.owner, {
      emails: Array.from({ length: 20 }, (_, index) => `p${String(index)}-${tag()}@example.com`),
      role: 'member',
    });
    const whole = await listAuditEvents(at.owner);
    expect(whole.entries).toHaveLength(20);
    expect(whole.nextCursor).toBeUndefined();
    expect(new Set(whole.entries.map((entry) => entry.at)).size).toBe(1);
    expect(whole.entries[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    const pages = await allPages(at.owner, 7);
    expect(pages.map((page) => page.entries.length)).toEqual([7, 7, 6]);
    const paged = pages.flatMap((page) => page.entries.map((entry) => entry.id));
    expect(new Set(paged).size).toBe(20);
    expect(paged).toEqual(whole.entries.map((entry) => entry.id));
  });

  it('refuses a cursor with its microseconds cut, or one that isn’t ours, as INPUT_INVALID', async () => {
    const at = await workspace();
    await threeChanges(at, 'Acme Ltd');
    const { nextCursor } = await listAuditEvents(at.owner, { limit: 1 });
    const position = JSON.parse(Buffer.from(nextCursor ?? '', 'base64url').toString('utf8')) as {
      a: string;
      i: string;
    };
    const cut = Buffer.from(
      JSON.stringify({ a: position.a.replace(/(\.\d{3})\d{3}Z$/, '$1Z'), i: position.i }),
    ).toString('base64url');
    for (const cursor of [cut, 'not-a-cursor', Buffer.from('{"a":1}').toString('base64url')]) {
      const error = await listAuditEvents(at.owner, { cursor }).then(
        () => undefined,
        (failed: unknown) => failed,
      );
      expect(isInputError(error)).toBe(true);
      expect(isInputError(error) ? error.inputProblem : undefined).toEqual({
        field: 'cursor',
        message: AUDIT_CURSOR_MESSAGE,
      });
    }
  });
});

describe('what leaves the server (AC-4609, AC-4624)', () => {
  it('holds no IP, no request id, no raw before or after key, and never a linked record', async () => {
    const at = await workspace();
    const recordId = newId();
    await db.withWorkspace(at.workspaceId, async (tx) => {
      const owner = { type: 'member', id: at.ownerId } as const;
      const source = { ip: '198.51.100.23', requestId: 'req-6f1c-secret' };
      await writeAudit(
        tx,
        at.workspaceId,
        owner,
        {
          action: 'workspace.updated',
          targetType: 'workspace',
          targetId: at.workspaceId,
          before: { name: 'Acme', rawSecretKey: 'hidden-before' },
          after: { name: 'Acme Ltd', rawSecretKey: 'hidden-after' },
        },
        source,
      );
      await writeAudit(
        tx,
        at.workspaceId,
        owner,
        {
          action: 'booking.record_linked',
          targetType: 'booking',
          targetId: newId(),
          before: { recordId: null },
          after: { recordId },
        },
        source,
      );
    });
    const page = await listAuditEvents(at.owner);
    // One transaction wrote both, so they share `at` and read in the order they were written.
    expect(page.entries.map((entry) => entry.action)).toEqual(['workspace.updated', 'booking.record_linked']);
    const text = JSON.stringify(page);
    for (const hidden of [
      '198.51.100.23',
      'req-6f1c-secret',
      'rawSecretKey',
      'hidden-before',
      'hidden-after',
      recordId,
    ]) {
      expect(text).not.toContain(hidden);
    }
    expect(text).not.toMatch(/"(ip|requestId|request_id)":/);
    // An entry is only its view: a raw before or after never rides along (a change's typed values are its own).
    for (const entry of page.entries) {
      expect(Object.keys(entry).sort()).toEqual(['action', 'actor', 'at', 'changes', 'id', 'params', 'target']);
    }
    expect(page.entries[1]).toMatchObject({ target: { type: 'booking', isGone: true }, params: {}, changes: [] });
  });
});

describe('statements and writes (AC-4625, AC-4628)', () => {
  it('reads a page in 4 statements and an empty one in 3, selecting no IP or request id, and writes nothing', async () => {
    const empty = await workspace('member', counted);
    statements.length = 0;
    counting = true;
    try {
      expect(await listAuditEvents(empty.owner)).toEqual({ entries: [] });
    } finally {
      counting = false;
    }
    // The workspace setting, the statement timeout, the page.
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain('app.workspace_id');
    expect(statements[1]).toContain('statement_timeout');
    expect(statements[2]).toContain('from audit_events');

    const at = await workspace('member', counted);
    await threeChanges(at, 'Acme Ltd');
    const outboxBefore = await outboxCount(at.workspaceId);
    statements.length = 0;
    counting = true;
    let page: AuditPage;
    try {
      page = await listAuditEvents(at.owner);
    } finally {
      counting = false;
    }
    expect(page.entries).toHaveLength(3);
    // And one statement naming everything the page mentions, however many rows.
    expect(statements).toHaveLength(4);
    expect(statements[3]).toContain('union all');
    const pageStatement = statements[2] ?? '';
    expect(pageStatement).not.toMatch(/\bip\b|request_id/);
    for (const text of statements) expect(text).not.toMatch(/^\s*(insert|update|delete)\b/i);
    expect(await outboxCount(at.workspaceId)).toBe(outboxBefore);
  });
});

async function outboxCount(workspaceId: string): Promise<number> {
  const found = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from outbox where workspace_id = ${workspaceId}`),
  );
  return found.rows[0]?.n ?? 0;
}
