// Spec 0019, milestones 3 and 4, against a real Postgres as the app role:
// saving notes (nothing stored until there is text, replays, the clash
// notice, the 200 KB refusal), their outbox rows, a record's list and its
// cursors, the timeline's note entries, access with injected rules, and
// deleting, restoring and the record's trash.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { AccessRules } from '../access/policy.ts';
import { getActivity } from '../engine/activity.ts';
import { deleteRecord, restoreRecord } from '../engine/deletion.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createRecord } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import { deleteNote, getNote, listNotes, restoreNote, saveNote } from './notes.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-notes-tests' });
});
afterAll(async () => {
  await db.close();
});

const doc = (...lines: string[]) => ({
  type: 'doc',
  content: lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Notes',
    slug: `notes-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const rows = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  const ids = Object.fromEntries(rows.rows.map((row) => [row.slug, row.id]));
  const bea = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${bea}, 'Bea', 'bea@example.com', 'member', 'system', 'system')`,
    ),
  );
  const companies = created.objects.companies ?? '';
  const company = async (name: string) =>
    (await createRecord(scope, { objectId: companies, values: { [ids['companies.name'] ?? '']: name } })).recordId;
  const level = (value: string): AccessRules => ({
    levels: [
      { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: companies }, level: value },
    ],
    records: [],
  });
  const as = (rules?: AccessRules) =>
    rescope(scope, { actor: { type: 'member', id: bea }, role: 'member', ...(rules ? { rules } : {}) });
  const outbox = async () =>
    (
      await db.withWorkspace(created.workspaceId, (tx) =>
        tx.execute<{ item_ids: string[]; record_ids: string[]; object_id: string | null; mutation_id: string | null }>(
          sql`select item_ids::text[] as item_ids, record_ids::text[] as record_ids, object_id::text as object_id, mutation_id::text as mutation_id from outbox where kind = 'notes' order by seq`,
        ),
      )
    ).rows;
  return { scope, ownerId: created.memberId, bea, companies, company, level, as, outbox };
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

describe('saveNote (AC-439 to AC-443, AC-448, AC-449)', () => {
  it('stores nothing until there is text, then creates the note at version 1 with one outbox row', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const id = newId();
    expect(
      await refusalOf(saveNote(w.scope, { id, recordId: acme, title: '  ', content: doc('   ') }, hooks())),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'content', message: 'Write something first.' });
    expect(await w.outbox()).toEqual([]);
    const mutationId = newId();
    const saved = await saveNote(
      w.scope,
      { id, recordId: acme, content: doc('Met at the fair.', 'Call back') },
      hooks(mutationId),
    );
    expect(saved.note).toMatchObject({
      id,
      recordId: acme,
      title: '',
      excerpt: 'Met at the fair. Call back',
      version: 1,
      canChange: true,
    });
    expect(saved.overwrote).toBeUndefined();
    expect(await w.outbox()).toEqual([
      { item_ids: [id], record_ids: [acme], object_id: w.companies, mutation_id: mutationId },
    ]);
    expect((await getNote(w.scope, { noteId: id })).content).toEqual(doc('Met at the fair.', 'Call back'));
  });

  it('answers a repeated first save with the same note and writes nothing twice; another record’s id is ID_TAKEN', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const globex = await w.company('Globex');
    const input = { id: newId(), recordId: acme, title: 'Kickoff', content: doc('Agenda') };
    const first = await saveNote(w.scope, input, hooks());
    const again = await saveNote(w.scope, { ...input, baseVersion: null }, hooks());
    expect(again).toEqual({ note: first.note });
    expect(await w.outbox()).toHaveLength(1);
    expect(await refusalOf(saveNote(w.scope, { ...input, recordId: globex }))).toMatchObject({ code: 'ID_TAKEN' });
  });

  it('saves later changes one version up, and names whose save it replaced when it started from an older one', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const id = newId();
    await saveNote(w.scope, { id, recordId: acme, content: doc('One') });
    const mine = await saveNote(w.scope, { id, recordId: acme, content: doc('Two'), baseVersion: 1 });
    expect(mine.note.version).toBe(2);
    expect(mine.overwrote).toBeUndefined();
    // Bea saved from version 1 while the owner had moved it to 2: hers wins, and she is told it replaced the owner's.
    const hers = await saveNote(w.as(), { id, recordId: acme, title: 'Hers', baseVersion: 1 });
    expect(hers.note).toMatchObject({ version: 3, title: 'Hers', updatedBy: { type: 'member', id: w.bea } });
    expect(hers.overwrote).toEqual({ by: { type: 'member', id: w.ownerId }, at: mine.note.updatedAt });
    // The same title again changes nothing.
    expect((await saveNote(w.as(), { id, recordId: acme, title: 'Hers', baseVersion: 3 })).note.version).toBe(3);
  });

  it('refuses a body over 200 KB as CONFIG_INVALID on content, and a script link as invalid input', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const big = doc('x'.repeat(250 * 1024));
    expect(await refusalOf(saveNote(w.scope, { id: newId(), recordId: acme, content: big }))).toEqual({
      code: 'CONFIG_INVALID',
      field: 'content',
      message: 'This note is too long to save. Split it into two notes.',
    });
    const evil = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:1' } }] }],
        },
      ],
    };
    expect(await refusalOf(saveNote(w.scope, { id: newId(), recordId: acme, content: evil }))).toMatchObject({
      code: 'INPUT_INVALID',
      field: 'content',
    });
    expect(await w.outbox()).toEqual([]);
  });
});

describe('access (AC-447)', () => {
  it('hides a hidden record’s notes, lets a reader read but not change them, and stores nothing refused', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const { note } = await saveNote(
      w.scope,
      { id: newId(), recordId: acme, title: 'Secret plan', content: doc('x') },
      hooks(),
    );
    const hidden = w.as(w.level('none'));
    expect(await refusalOf(getNote(hidden, { noteId: note.id }))).toEqual({
      code: 'NOT_FOUND',
      message: 'That note does not exist.',
    });
    expect(await refusalOf(listNotes(hidden, { recordId: acme }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(saveNote(hidden, { id: newId(), recordId: acme, title: 'Mine' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    const reader = w.as(w.level('read'));
    expect((await getNote(reader, { noteId: note.id })).canChange).toBe(false);
    expect((await listNotes(reader, { recordId: acme })).items.map((item) => item.id)).toEqual([note.id]);
    for (const call of [
      saveNote(reader, { id: newId(), recordId: acme, title: 'Mine' }),
      saveNote(reader, { id: note.id, recordId: acme, title: 'Changed' }),
      deleteNote(reader, { noteId: note.id }),
    ]) {
      expect(await refusalOf(call)).toEqual({
        code: 'FORBIDDEN',
        message: 'You can view this note but not change it.',
      });
    }
    expect(await w.outbox()).toHaveLength(1);
  });
});

describe('listNotes (AC-442)', () => {
  it('lists last edited first with the count, pages with no repeat or gap, and refuses a cursor it didn’t make', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const ids: string[] = [];
    for (const title of ['A', 'B', 'C', 'D', 'E']) {
      ids.push((await saveNote(w.scope, { id: newId(), recordId: acme, title })).note.id);
    }
    // Editing the first moves it to the top.
    await saveNote(w.scope, { id: ids[0] ?? '', recordId: acme, title: 'A again' });
    const first = await listNotes(w.scope, { recordId: acme, limit: 2 });
    expect(first.total).toEqual({ count: 5, atLeast: false });
    const seen = first.items.map((item) => item.id);
    let cursor = first.nextCursor;
    while (cursor !== undefined) {
      const page = await listNotes(w.scope, { recordId: acme, limit: 2, cursor });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    }
    expect(seen).toEqual([ids[0], ids[4], ids[3], ids[2], ids[1]]);
    for (const bad of ['nope', Buffer.from(JSON.stringify({ updatedAt: "x'--", id: newId() })).toString('base64url')]) {
      expect(await refusalOf(listNotes(w.scope, { recordId: acme, cursor: bad }))).toMatchObject({
        code: 'INPUT_INVALID',
        field: 'cursor',
      });
    }
  });
});

describe('the timeline’s note entries (AC-444)', () => {
  it('shows "added a note" with the title and the start of the text, and drops it when deleted', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const { note } = await saveNote(w.scope, {
      id: newId(),
      recordId: acme,
      title: 'Call notes',
      content: doc('They want 40 seats.'),
    });
    const entries = async () =>
      (await getActivity(w.scope, { recordId: acme })).entries.filter((entry) => entry.kind === 'note');
    expect(await entries()).toMatchObject([
      {
        kind: 'note',
        itemId: note.id,
        title: 'Call notes',
        excerpt: 'They want 40 seats.',
        actor: { type: 'member', id: w.ownerId },
      },
    ]);
    await deleteNote(w.scope, { noteId: note.id });
    expect(await entries()).toEqual([]);
  });
});

describe('deleting, restoring and the record’s trash (AC-445, AC-446)', () => {
  it('deletes a note at once and brings it back exactly as it was, each with one outbox row', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const { note } = await saveNote(
      w.scope,
      { id: newId(), recordId: acme, title: 'Keep me', content: doc('Body') },
      hooks(),
    );
    await deleteNote(w.scope, { noteId: note.id }, hooks());
    expect(await refusalOf(getNote(w.scope, { noteId: note.id }))).toMatchObject({ code: 'NOT_FOUND' });
    expect((await listNotes(w.scope, { recordId: acme })).total?.count).toBe(0);
    expect(await refusalOf(saveNote(w.scope, { id: note.id, recordId: acme, title: 'Edit' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    const back = await restoreNote(w.scope, { noteId: note.id }, hooks());
    expect(back).toEqual(note);
    expect((await getNote(w.scope, { noteId: note.id })).content).toEqual(doc('Body'));
    expect(await w.outbox()).toHaveLength(3);
  });

  it('hides a trashed record’s notes everywhere and brings them back with it; restoring one waits for the record', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const { note } = await saveNote(w.scope, { id: newId(), recordId: acme, title: 'On Acme' });
    await deleteNote(w.scope, { noteId: note.id });
    await restoreNote(w.scope, { noteId: note.id });
    await deleteRecord(w.scope, { recordId: acme });
    expect(await refusalOf(getNote(w.scope, { noteId: note.id }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(listNotes(w.scope, { recordId: acme }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(saveNote(w.scope, { id: note.id, recordId: acme, title: 'x' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    await restoreRecord(w.scope, { recordId: acme });
    expect((await getNote(w.scope, { noteId: note.id })).title).toBe('On Acme');
    await deleteNote(w.scope, { noteId: note.id });
    await deleteRecord(w.scope, { recordId: acme });
    expect(await refusalOf(restoreNote(w.scope, { noteId: note.id }))).toEqual({
      code: 'RECORD_DELETED',
      message: 'Restore the record first.',
    });
  });
});
