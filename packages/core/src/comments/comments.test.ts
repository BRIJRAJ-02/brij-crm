// Spec 0038, milestone 1, against a real Postgres as the app role: comments
// and threads (create, reply, replay, edit with versions, delete with its
// placeholder, resolve, reactions, the thread cap), the notifications they
// make (mentions, replies, never yourself, edits that add or remove a
// mention), the inbox (list, count, marks, settings), access (a record the
// reader can't see hides its comments and their notifications, which come
// back with access), task assignments, the purge and a removed member.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { mentionToken } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { NO_RULE_SOURCE } from '../access/door.ts';
import type { AccessRules } from '../access/policy.ts';
import { deleteRecord, purgeRecords, restoreRecord } from '../engine/deletion.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createRecord } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { removeMember } from '../members/members.ts';
import {
  countUnread,
  getNotificationSettings,
  listNotifications,
  markAllRead,
  markEmailed,
  markNotifications,
  queueNextEmail,
  setNotificationSettings,
} from '../notifications/inbox.ts';
import { prepareNotificationEmail } from '../notifications/email.ts';
import { createTask, updateTask } from '../tasks/tasks.ts';
import { rescope, testScope } from '../testing.ts';
import {
  commentVersions,
  createComment,
  deleteComment,
  getThreads,
  listThreads,
  setThreadResolved,
  toggleReaction,
  updateComment,
} from './comments.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-comments-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Comments',
    slug: `comments-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const ada = created.memberId;
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: ada } });
  const rows = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  const ids = Object.fromEntries(rows.rows.map((row) => [row.slug, row.id]));
  const addMember = async (name: string) => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${name.toLowerCase()}@example.com`}, 'member', 'system', 'system')`,
      ),
    );
    return id;
  };
  const bea = await addMember('Bea');
  const cal = await addMember('Cal');
  const companies = created.objects.companies ?? '';
  const company = async (name: string) =>
    (await createRecord(scope, { objectId: companies, values: { [ids['companies.name'] ?? '']: name } })).recordId;
  const none: AccessRules = {
    levels: [
      { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: companies }, level: 'none' },
    ],
    records: [],
  };
  const as = (memberId: string, rules?: AccessRules) =>
    rescope(scope, { actor: { type: 'member', id: memberId }, role: 'member', ...(rules ? { rules } : {}) });
  const outbox = async (kind: 'comments' | 'notifications') =>
    (
      await db.withWorkspace(created.workspaceId, (tx) =>
        tx.execute<{ item_ids: string[]; record_ids: string[]; object_id: string | null }>(
          sql`select item_ids::text[] as item_ids, record_ids::text[] as record_ids, object_id::text as object_id from outbox where kind = ${kind}::outbox_kind order by seq`,
        ),
      )
    ).rows;
  const notifications = async () =>
    (
      await db.withWorkspace(created.workspaceId, (tx) =>
        tx.execute<{ member_id: string; kind: string; comment_id: string | null; task_id: string | null }>(
          sql`select member_id::text, kind, comment_id::text, task_id::text from notifications order by created_at, id`,
        ),
      )
    ).rows;
  return { scope, ada, bea, cal, companies, company, none, as, outbox, notifications, addMember };
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    if (isInputError(error)) return { code: 'INPUT_INVALID', ...error.inputProblem };
    throw error;
  }
  throw new Error('It was let through.');
}

const hooks = (mutationId = newId()) => [outboxHook({ mutationId })];

describe('comments (AC-1151 to AC-1158)', () => {
  it('starts a thread, replies in it, replays a retry, and lists threads newest first with their counts', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const first = newId();
    const thread = await createComment(w.scope, { id: first, recordId: acme, body: '  Hello there  ' }, hooks());
    expect(thread).toMatchObject({
      id: first,
      recordId: acme,
      comments: [{ id: first, body: 'Hello there', isDeleted: false, canEdit: true, canDelete: true, version: 1 }],
    });
    // The same create again: the same thread, nothing written twice.
    await createComment(w.scope, { id: first, recordId: acme, body: 'Hello there' }, hooks());
    const reply = newId();
    const replied = await createComment(
      w.as(w.bea),
      { id: reply, recordId: acme, threadId: first, body: 'Hi Ada' },
      hooks(),
    );
    expect(replied.comments.map((comment) => comment.id)).toEqual([first, reply]);
    expect(replied.comments[0]).toMatchObject({ canEdit: false, canDelete: false });
    const second = newId();
    await createComment(w.scope, { id: second, recordId: acme, body: 'Another topic' }, hooks());
    const page = await listThreads(w.scope, { recordId: acme });
    expect(page.threads.map((t) => t.id)).toEqual([second, first]);
    expect(page.counts).toEqual({ open: 2, resolved: 0 });
    // One comments row per write, naming the object, the record and the thread, never the text.
    const rows = await w.outbox('comments');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ item_ids: [first], record_ids: [acme], object_id: w.companies });
    // Someone else's id is taken.
    expect(
      await refusalOf(createComment(w.as(w.bea), { id: first, recordId: acme, body: 'Mine' }, hooks())),
    ).toMatchObject({ code: 'ID_TAKEN' });
  });

  it('refuses an empty, oversized or unstorable comment and a reply to another record’s thread, and keeps an unknown mention as text', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const globex = await w.company('Globex');
    expect(await refusalOf(createComment(w.scope, { id: newId(), recordId: acme, body: '   ' }))).toMatchObject({
      code: 'INPUT_INVALID',
      field: 'body',
    });
    expect(
      await refusalOf(createComment(w.scope, { id: newId(), recordId: acme, body: 'x'.repeat(10_001) })),
    ).toMatchObject({ code: 'INPUT_INVALID', field: 'body' });
    expect(
      await refusalOf(createComment(w.scope, { id: newId(), recordId: acme, body: 'Nul \u0000 here' })),
    ).toMatchObject({ code: 'INPUT_INVALID', field: 'body' });
    // A token naming nobody in the workspace stays in the text and notifies no one.
    const stranger = mentionToken(newId());
    const kept = await createComment(w.scope, { id: newId(), recordId: acme, body: `Hi ${stranger}` });
    expect(kept.comments[0]?.body).toBe(`Hi ${stranger}`);
    expect(await w.notifications()).toEqual([]);
    const first = newId();
    await createComment(w.scope, { id: first, recordId: acme, body: 'On Acme' });
    expect(
      await refusalOf(createComment(w.scope, { id: newId(), recordId: globex, threadId: first, body: 'Wrong place' })),
    ).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps each edit’s earlier text, refuses another’s edit and an empty one', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const id = newId();
    await createComment(w.scope, { id, recordId: acme, body: 'First' });
    const edited = await updateComment(w.scope, { commentId: id, body: 'Second' }, hooks());
    expect(edited.comments[0]).toMatchObject({ body: 'Second', version: 2 });
    expect(edited.comments[0]?.editedAt).toBeDefined();
    await updateComment(w.scope, { commentId: id, body: 'Third' });
    expect((await commentVersions(w.scope, { commentId: id })).map((v) => [v.version, v.body])).toEqual([
      [2, 'Second'],
      [1, 'First'],
    ]);
    expect(await refusalOf(updateComment(w.as(w.bea), { commentId: id, body: 'Hijack' }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await refusalOf(updateComment(w.scope, { commentId: id, body: '  ' }))).toMatchObject({
      code: 'INPUT_INVALID',
      message: "A comment can't be empty. Delete it instead.",
    });
  });

  it('leaves a placeholder for a deleted comment with live replies, and drops a thread once all are deleted', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const first = newId();
    const reply = newId();
    await createComment(w.scope, { id: first, recordId: acme, body: 'Question' });
    await createComment(w.as(w.bea), { id: reply, recordId: acme, threadId: first, body: 'Answer' });
    // Bea may not delete Ada's; an owner (comments.manage) may delete Bea's.
    expect(await refusalOf(deleteComment(w.as(w.bea), { commentId: first }))).toMatchObject({ code: 'FORBIDDEN' });
    await deleteComment(w.scope, { commentId: first }, hooks());
    const [thread] = await getThreads(w.scope, { threadIds: [first] });
    expect(thread?.comments[0]).toMatchObject({ id: first, isDeleted: true, body: '', canEdit: false });
    expect(thread?.comments[0]?.createdBy).toBeUndefined();
    await deleteComment(w.scope, { commentId: reply }, hooks());
    expect(await getThreads(w.scope, { threadIds: [first] })).toEqual([]);
    expect((await listThreads(w.scope, { recordId: acme })).threads).toEqual([]);
  });

  it('resolves and reopens a thread, and a reply reopens it', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const first = newId();
    await createComment(w.scope, { id: first, recordId: acme, body: 'Done?' });
    const resolved = await setThreadResolved(w.as(w.bea), { threadId: first, resolved: true }, hooks());
    expect(resolved.resolvedBy).toEqual({ type: 'member', id: w.bea });
    expect((await listThreads(w.scope, { recordId: acme })).counts).toEqual({ open: 0, resolved: 1 });
    expect((await listThreads(w.scope, { recordId: acme, resolved: true })).threads.map((t) => t.id)).toEqual([first]);
    const reopened = await createComment(w.scope, { id: newId(), recordId: acme, threadId: first, body: 'Not yet' });
    expect(reopened.resolvedAt).toBeUndefined();
  });

  it('toggles reactions per member, with counts and who', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const id = newId();
    await createComment(w.scope, { id, recordId: acme, body: 'Ship it' });
    await toggleReaction(w.scope, { commentId: id, emoji: '👍', on: true }, hooks());
    await toggleReaction(w.scope, { commentId: id, emoji: '👍', on: true }, hooks());
    const both = await toggleReaction(w.as(w.bea), { commentId: id, emoji: '👍', on: true }, hooks());
    expect(both.comments[0]?.reactions).toEqual([{ emoji: '👍', count: 2, mine: true, memberIds: [w.ada, w.bea] }]);
    const off = await toggleReaction(w.scope, { commentId: id, emoji: '👍', on: false }, hooks());
    expect(off.comments[0]?.reactions).toEqual([{ emoji: '👍', count: 1, mine: false, memberIds: [w.bea] }]);
    // A reaction notifies no one.
    expect(await w.notifications()).toEqual([]);
  });

  it('refuses the 501st comment of a thread', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const first = newId();
    await createComment(w.scope, { id: first, recordId: acme, body: 'Busy thread' });
    await db.withWorkspace(w.scope.workspaceId, (tx) =>
      tx.execute(sql`
        insert into comments (workspace_id, id, record_id, thread_id, body, created_by_type, created_by_id,
          created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
        select ${w.scope.workspaceId}::uuid, uuidv7(), ${acme}::uuid, ${first}::uuid, 'Reply ' || n, 'member',
          ${w.ada}::uuid, ${w.ada}::uuid, 'member', ${w.ada}::uuid, ${w.ada}::uuid
        from generate_series(1, 499) as n
      `),
    );
    expect(
      await refusalOf(createComment(w.scope, { id: newId(), recordId: acme, threadId: first, body: 'One more' })),
    ).toMatchObject({ code: 'LIMIT_REACHED', message: 'This thread is full. Start a new one.' });
  });
});

describe('access to comments (AC-1162, AC-1181)', () => {
  it('answers every read and write as unknown on a record the reader can’t see, and writes nothing', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const first = newId();
    await createComment(w.as(w.bea), { id: first, recordId: acme, body: 'Mine' });
    const before = (await w.outbox('comments')).length;
    const hidden = w.as(w.bea, w.none);
    const calls: readonly (readonly [string, () => Promise<unknown>])[] = [
      ['list', () => listThreads(hidden, { recordId: acme })],
      ['create', () => createComment(hidden, { id: newId(), recordId: acme, body: 'Hi' }, hooks())],
      ['reply', () => createComment(hidden, { id: newId(), recordId: acme, threadId: first, body: 'Hi' }, hooks())],
      ['update', () => updateComment(hidden, { commentId: first, body: 'Changed' }, hooks())],
      ['delete', () => deleteComment(hidden, { commentId: first }, hooks())],
      ['resolve', () => setThreadResolved(hidden, { threadId: first, resolved: true }, hooks())],
      ['react', () => toggleReaction(hidden, { commentId: first, emoji: '👀', on: true }, hooks())],
      ['versions', () => commentVersions(hidden, { commentId: first })],
    ];
    for (const [name, call] of calls) expect(await refusalOf(call()), name).toMatchObject({ code: 'NOT_FOUND' });
    expect(await getThreads(hidden, { threadIds: [first] })).toEqual([]);
    // In the trash, the same for everyone, the owner too.
    await deleteRecord(w.scope, { recordId: acme });
    expect(await getThreads(w.scope, { threadIds: [first] })).toEqual([]);
    expect(await refusalOf(listThreads(w.scope, { recordId: acme }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(updateComment(w.as(w.bea), { commentId: first, body: 'Now?' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await w.outbox('comments')).length).toBe(before);
  });

  it('carries the newest 20 replies of a busy thread, and the whole thread when asked', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const first = newId();
    await createComment(w.scope, { id: first, recordId: acme, body: 'Busy' });
    for (let index = 0; index < 23; index += 1) {
      await createComment(w.scope, { id: newId(), recordId: acme, threadId: first, body: `Reply ${String(index)}` });
    }
    const [windowed] = await getThreads(w.scope, { threadIds: [first] });
    expect(windowed?.comments).toHaveLength(21);
    expect(windowed?.comments[0]?.id).toBe(first);
    expect(windowed?.comments[1]?.body).toBe('Reply 3');
    expect(windowed?.earlierCount).toBe(3);
    const [whole] = await getThreads(w.scope, { threadIds: [first], whole: true });
    expect(whole?.comments).toHaveLength(24);
    expect(whole?.earlierCount).toBe(0);
  });
});

describe('notifications from comments (AC-1163, AC-1164, AC-1166, AC-1167)', () => {
  it('notifies a mention once, a reply to earlier writers, never the actor, and one notifications row per write', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const first = newId();
    await createComment(
      w.scope,
      { id: first, recordId: acme, body: `${mentionToken(w.bea)} and me ${mentionToken(w.ada)}` },
      hooks(),
    );
    expect(await w.notifications()).toEqual([{ member_id: w.bea, kind: 'mention', comment_id: first, task_id: null }]);
    expect((await w.outbox('notifications')).map((row) => row.item_ids)).toEqual([[w.bea]]);
    // Cal replies mentioning Bea: Bea gets the mention, Ada the reply, Cal nothing.
    const reply = newId();
    await createComment(
      w.as(w.cal),
      { id: reply, recordId: acme, threadId: first, body: `Agreed ${mentionToken(w.bea)}` },
      hooks(),
    );
    const made = (await w.notifications()).filter((row) => row.comment_id === reply);
    expect(made.map((row) => [row.member_id, row.kind]).sort()).toEqual(
      [
        [w.ada, 'reply'],
        [w.bea, 'mention'],
      ].sort(),
    );
    expect((await w.outbox('notifications')).at(-1)?.item_ids.sort()).toEqual([w.ada, w.bea].sort());
  });

  it('adds and removes a mention’s notification as an edit adds or removes it, and a delete removes them all', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const id = newId();
    await createComment(w.scope, { id, recordId: acme, body: `Hey ${mentionToken(w.bea)}` });
    await updateComment(w.scope, { commentId: id, body: `Hey ${mentionToken(w.bea)} ${mentionToken(w.cal)}` });
    expect((await w.notifications()).map((row) => row.member_id).sort()).toEqual([w.bea, w.cal].sort());
    await updateComment(w.scope, { commentId: id, body: `Hey ${mentionToken(w.cal)}` });
    expect((await w.notifications()).map((row) => row.member_id)).toEqual([w.cal]);
    await deleteComment(w.scope, { commentId: id }, hooks());
    expect(await w.notifications()).toEqual([]);
  });

  it('hides a notification while its record is hidden from the recipient, and shows it again with access', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    await createComment(w.scope, { id: newId(), recordId: acme, body: `Look ${mentionToken(w.bea)}` });
    const open = await listNotifications(w.as(w.bea), { status: 'inbox' });
    expect(open.items).toHaveLength(1);
    expect(open.items[0]).toMatchObject({
      kind: 'mention',
      actor: { type: 'member', id: w.ada },
      record: { recordId: acme, name: 'Acme' },
    });
    expect(await countUnread(w.as(w.bea))).toEqual({ count: 1, atLeast: false });
    // Companies at none for members: absent from the list and the count, and the comments are unknown.
    const hidden = w.as(w.bea, w.none);
    expect((await listNotifications(hidden, { status: 'inbox' })).items).toEqual([]);
    expect(await countUnread(hidden)).toEqual({ count: 0, atLeast: false });
    expect(await refusalOf(listThreads(hidden, { recordId: acme }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(createComment(hidden, { id: newId(), recordId: acme, body: 'Can I?' }))).toMatchObject({
      code: 'NOT_FOUND',
      message: 'That record does not exist.',
    });
    // In the trash: hidden from everyone, and back with a restore.
    await deleteRecord(w.scope, { recordId: acme });
    expect(await countUnread(w.as(w.bea))).toEqual({ count: 0, atLeast: false });
    await restoreRecord(w.scope, { recordId: acme });
    expect(await countUnread(w.as(w.bea))).toEqual({ count: 1, atLeast: false });
  });
});

describe('the inbox (AC-1169 to AC-1171, AC-1179, AC-1181)', () => {
  it('marks read, unread and done, filters, marks all read, and refuses another member’s notification', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const first = newId();
    await createComment(w.scope, { id: first, recordId: acme, body: `One ${mentionToken(w.bea)}` });
    await createComment(w.as(w.bea), { id: newId(), recordId: acme, threadId: first, body: 'Reply from Bea' });
    await createComment(w.scope, { id: newId(), recordId: acme, threadId: first, body: 'Back to Bea' });
    const bea = w.as(w.bea);
    const all = await listNotifications(bea, { status: 'inbox' });
    expect(all.items.map((item) => item.kind)).toEqual(['reply', 'mention']);
    expect((await listNotifications(bea, { status: 'inbox', kind: 'mention' })).items).toHaveLength(1);
    const [latest, earliest] = all.items;
    if (latest === undefined || earliest === undefined) throw new Error('Two notifications expected.');
    expect(await markNotifications(bea, { ids: [latest.id], read: true }, hooks())).toEqual({ changed: 1 });
    expect(await markNotifications(bea, { ids: [latest.id], read: true }, hooks())).toEqual({ changed: 0 });
    expect(await countUnread(bea)).toEqual({ count: 1, atLeast: false });
    expect((await listNotifications(bea, { status: 'inbox', unreadOnly: true })).items.map((i) => i.id)).toEqual([
      earliest.id,
    ]);
    await markNotifications(bea, { ids: [earliest.id], done: true }, hooks());
    expect((await listNotifications(bea, { status: 'done' })).items.map((i) => i.id)).toEqual([earliest.id]);
    expect(await countUnread(bea)).toEqual({ count: 0, atLeast: false });
    await markNotifications(bea, { ids: [latest.id], read: false }, hooks());
    expect(await markAllRead(bea, { status: 'inbox' }, hooks())).toEqual({ changed: 1 });
    expect(await refusalOf(markNotifications(bea, { ids: [latest.id], read: false, done: true }))).toMatchObject({
      code: 'INPUT_INVALID',
    });
    // Ada can't touch Bea's, by id or at all.
    expect(await refusalOf(markNotifications(w.scope, { ids: [latest.id], read: true }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await listNotifications(w.scope, { status: 'inbox' })).items.map((i) => i.id)).not.toContain(latest.id);
    // Each mark that changed something told Bea's other tabs, naming Bea only.
    const rows = await w.outbox('notifications');
    expect(rows.at(-1)?.item_ids).toEqual([w.bea]);
  });

  it('pages 50 at a time with a cursor, and refuses a forged one', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    for (let index = 0; index < 52; index += 1) {
      await createComment(w.scope, {
        id: newId(),
        recordId: acme,
        body: `Ping ${mentionToken(w.bea)} ${String(index)}`,
      });
    }
    const bea = w.as(w.bea);
    const page = await listNotifications(bea, { status: 'inbox' });
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).toBeDefined();
    const next = await listNotifications(bea, { status: 'inbox', cursor: page.nextCursor ?? '' });
    expect(next.items).toHaveLength(2);
    expect(next.nextCursor).toBeUndefined();
    expect(await refusalOf(listNotifications(bea, { status: 'inbox', cursor: 'nope' }))).toMatchObject({
      code: 'INPUT_INVALID',
      field: 'cursor',
    });
  });

  it('keeps settings per member with defaults, and needs a time zone for the digest', async () => {
    const w = await workspace();
    const bea = w.as(w.bea);
    expect(await getNotificationSettings(bea)).toEqual({
      emailMentions: true,
      emailReplies: false,
      emailAssignments: true,
      digest: false,
      version: 0,
    });
    expect(await refusalOf(setNotificationSettings(bea, { digest: true }))).toMatchObject({
      code: 'INPUT_INVALID',
      field: 'timeZone',
    });
    const saved = await setNotificationSettings(
      bea,
      { emailReplies: true, digest: true, timeZone: 'Asia/Kolkata' },
      hooks(),
    );
    expect(saved).toEqual({
      emailMentions: true,
      emailReplies: true,
      emailAssignments: true,
      digest: true,
      timeZone: 'Asia/Kolkata',
      version: 1,
    });
    expect((await getNotificationSettings(w.scope)).emailReplies).toBe(false);
    expect((await w.outbox('notifications')).at(-1)?.item_ids).toEqual([w.bea]);
  });
});

describe('task assignments (AC-1165)', () => {
  it('notifies the assignee once, never the one assigning themselves, and moves an unread one on reassignment', async () => {
    const w = await workspace();
    const task = newId();
    await createTask(w.scope, { id: task, title: 'Call Acme', assigneeMemberId: w.bea }, hooks());
    expect(await w.notifications()).toEqual([
      { member_id: w.bea, kind: 'task_assigned', comment_id: null, task_id: task },
    ]);
    const [item] = (await listNotifications(w.as(w.bea), { status: 'inbox' })).items;
    expect(item).toMatchObject({ kind: 'task_assigned', taskId: task, excerpt: 'Call Acme' });
    await updateTask(w.scope, { taskId: task, assigneeMemberId: w.cal }, hooks());
    expect((await w.notifications()).map((row) => row.member_id)).toEqual([w.cal]);
    await updateTask(w.scope, { taskId: task, isDone: true }, hooks());
    expect(await w.notifications()).toHaveLength(1);
    // Ada assigning herself notifies nobody.
    await createTask(w.scope, { id: newId(), title: 'Mine', assigneeMemberId: w.ada });
    expect(await w.notifications()).toHaveLength(1);
  });
});

describe('the purge and removed members (AC-1160, AC-1168)', () => {
  it('deletes a purged record’s comments and their notifications, and a removed member’s notifications and settings', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const globex = await w.company('Globex');
    const id = newId();
    await createComment(w.scope, { id, recordId: acme, body: `Bye ${mentionToken(w.bea)}` });
    await toggleReaction(w.scope, { commentId: id, emoji: '🎉', on: true });
    await updateComment(w.scope, { commentId: id, body: `Bye now ${mentionToken(w.bea)}` });
    await deleteRecord(w.scope, { recordId: acme });
    await runWrite(w.scope, (context) => purgeRecords(context, { recordIds: [acme] }));
    const left = await db.withWorkspace(w.scope.workspaceId, (tx) =>
      tx.execute<{ comments: number; versions: number; reactions: number; notifications: number }>(sql`
        select (select count(*)::int from comments) as comments, (select count(*)::int from comment_versions) as versions,
          (select count(*)::int from comment_reactions) as reactions, (select count(*)::int from notifications) as notifications
      `),
    );
    expect(left.rows[0]).toEqual({ comments: 0, versions: 0, reactions: 0, notifications: 0 });
    await createComment(w.scope, { id: newId(), recordId: globex, body: `Hi ${mentionToken(w.cal)}` });
    await setNotificationSettings(w.as(w.cal), { emailMentions: false });
    await removeMember(w.scope, { memberId: w.cal }, hooks());
    expect(await w.notifications()).toEqual([]);
    const settings = await db.withWorkspace(w.scope.workspaceId, (tx) =>
      tx.execute(sql`select 1 from notification_settings`),
    );
    expect(settings.rows).toEqual([]);
  });
});

describe('the notifications email (AC-1176, AC-1177)', () => {
  it('holds what is due as the member sees it, mentions named, and never sends one twice', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const thread = await createComment(
      w.scope,
      { id: newId(), recordId: acme, body: `Over to ${mentionToken(w.bea)} and ${mentionToken(w.cal)}` },
      hooks(),
    );
    const door = { db, rules: NO_RULE_SOURCE };
    const prepared = await prepareNotificationEmail(door, { workspaceId: w.scope.workspaceId, memberId: w.bea });
    if (prepared.skipped !== undefined) throw new Error(`Skipped: ${prepared.skipped}`);
    expect(prepared.to.email).toBe('bea@example.com');
    const [item, ...others] = prepared.params.items;
    expect(others).toEqual([]);
    expect(item?.sentence).toBe('Ada mentioned you');
    expect(item?.recordName).toBe('Acme');
    expect(item?.excerpt).toBe('Over to @Bea and @Cal');
    expect(item?.path).toMatch(
      new RegExp(`^/w/comments-[^/]+/objects/companies/${acme}/comments\\?thread=${thread.id}$`),
    );
    expect(prepared.params.inboxPath).toMatch(/^\/w\/comments-[^/]+\/inbox$/);
    await markEmailed(prepared.scope, prepared.ids);
    expect((await prepareNotificationEmail(door, { workspaceId: w.scope.workspaceId, memberId: w.bea })).skipped).toBe(
      'nothing',
    );
    // Replies are off by default; a read one is left out; a removed member gets nothing.
    await markNotifications(
      w.as(w.cal),
      { ids: (await listNotifications(w.as(w.cal), { status: 'inbox' })).items.map((n) => n.id), read: true },
      hooks(),
    );
    expect((await prepareNotificationEmail(door, { workspaceId: w.scope.workspaceId, memberId: w.cal })).skipped).toBe(
      'nothing',
    );
    await removeMember(w.scope, { memberId: w.bea }, hooks());
    expect((await prepareNotificationEmail(door, { workspaceId: w.scope.workspaceId, memberId: w.bea })).skipped).toBe(
      'removed',
    );
  });

  it('sends nothing the member can’t read now: a hidden record, a deleted comment', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const thread = await createComment(
      w.scope,
      { id: newId(), recordId: acme, body: `Secret plan for ${mentionToken(w.bea)}` },
      hooks(),
    );
    const input = { workspaceId: w.scope.workspaceId, memberId: w.bea };
    // Companies hidden from members: nothing to send, and no text of it.
    const hidden = await prepareNotificationEmail({ db, rules: () => Promise.resolve(w.none) }, input);
    expect(hidden.skipped).toBe('nothing');
    // The comment deleted: nothing either.
    await deleteComment(w.scope, { commentId: thread.id }, hooks());
    expect((await prepareNotificationEmail({ db, rules: NO_RULE_SOURCE }, input)).skipped).toBe('nothing');
  });

  it('holds 20 at most, and the rest go in the next email, queued once', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    for (let index = 0; index < 22; index += 1) {
      await createComment(
        w.scope,
        { id: newId(), recordId: acme, body: `Note ${String(index)} ${mentionToken(w.bea)}` },
        hooks(),
      );
    }
    const door = { db, rules: NO_RULE_SOURCE };
    const input = { workspaceId: w.scope.workspaceId, memberId: w.bea };
    const first = await prepareNotificationEmail(door, input);
    if (first.skipped !== undefined) throw new Error(`Skipped: ${first.skipped}`);
    expect(first.params.items).toHaveLength(20);
    expect(first.params.more).toBe(2);
    expect(first.hasMore).toBe(true);
    await markEmailed(first.scope, first.ids);
    await queueNextEmail(first.scope);
    await queueNextEmail(first.scope);
    const next = await prepareNotificationEmail(door, input);
    if (next.skipped !== undefined) throw new Error(`Skipped: ${next.skipped}`);
    expect(next.params.items).toHaveLength(2);
    expect(next.hasMore).toBe(false);
    expect(next.ids.some((id) => first.ids.includes(id))).toBe(false);
  });

  it('sends the daily digest once a day, of every kind still unread (AC-1178)', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    // Bea writes in a thread, Ada replies: a reply, whose email is off by default, still goes in the digest.
    const thread = await createComment(w.as(w.bea), { id: newId(), recordId: acme, body: 'First' }, hooks());
    await createComment(w.scope, { id: newId(), recordId: acme, body: 'Thanks', threadId: thread.id }, hooks());
    await setNotificationSettings(w.as(w.bea), { digest: true, timeZone: 'UTC' }, hooks());
    const door = { db, rules: NO_RULE_SOURCE };
    const input = { workspaceId: w.scope.workspaceId, memberId: w.bea, digest: true };
    const digest = await prepareNotificationEmail(door, input);
    if (digest.skipped !== undefined) throw new Error(`Skipped: ${digest.skipped}`);
    expect(digest.params.items.map((item) => item.sentence)).toEqual(['Ada replied in a thread']);
    expect((await prepareNotificationEmail(door, input)).skipped).toBe('nothing');
  });
});
