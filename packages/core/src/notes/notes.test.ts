// Spec 0019, milestones 3 and 4, against a real Postgres as the app role:
// saving notes (nothing stored until there is text, replays, the clash
// notice, the 200 KB refusal), their outbox rows, a record's list and its
// cursors, the timeline's note entries, access with injected rules, and
// deleting, restoring and the record's trash, and a note linked to several
// records (migration 0136).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { AccessRules } from '../access/policy.ts';
import { getActivity } from '../engine/activity.ts';
import { deleteRecord, purgeRecords, restoreRecord } from '../engine/deletion.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createRecord } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { rescope, testScope } from '../testing.ts';
import { deleteNote, getNote, linkNote, listNotes, restoreNote, saveNote } from './notes.ts';

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
  const ownedCompany = async (name: string, memberId: string) =>
    (
      await createRecord(scope, {
        objectId: companies,
        values: {
          [ids['companies.name'] ?? '']: name,
          [ids['companies.owner'] ?? '']: { type: 'member', id: memberId },
        },
      })
    ).recordId;
  /** A record rule: members see only the companies they own (spec 0009's `own`). */
  const ownCompanies: AccessRules = {
    levels: [],
    records: [
      {
        subject: { type: 'role', role: 'member' },
        objectId: companies,
        kind: 'own',
        attributeId: ids['companies.owner'] ?? '',
      },
    ],
  };
  const people = created.objects.people ?? '';
  const person = async (firstName: string) =>
    (await createRecord(scope, { objectId: people, values: { [ids['people.name'] ?? '']: { firstName } } })).recordId;
  return {
    scope,
    ownerId: created.memberId,
    bea,
    companies,
    company,
    people,
    person,
    level,
    as,
    outbox,
    ownedCompany,
    ownCompanies,
  };
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
    // Each call starts only when its turn comes, so none is refused before anything awaits it.
    for (const call of [
      () => saveNote(reader, { id: newId(), recordId: acme, title: 'Mine' }),
      () => saveNote(reader, { id: note.id, recordId: acme, title: 'Changed' }),
      () => deleteNote(reader, { noteId: note.id }),
    ]) {
      expect(await refusalOf(call())).toEqual({
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

describe('the security review (spec 0019, milestones 3 and 4)', () => {
  it('applies an injected record rule: notes on a company the member doesn’t own are absent, in every read and write', async () => {
    const w = await workspace();
    const mine = await w.ownedCompany('Mine', w.bea);
    const theirs = await w.ownedCompany('Theirs', w.ownerId);
    const onMine = (await saveNote(w.scope, { id: newId(), recordId: mine, title: 'Mine' })).note;
    const onTheirs = (await saveNote(w.scope, { id: newId(), recordId: theirs, title: 'Theirs' })).note;
    const bea = w.as(w.ownCompanies);
    expect((await listNotes(bea, { recordId: mine })).items.map((note) => note.id)).toEqual([onMine.id]);
    expect(await refusalOf(listNotes(bea, { recordId: theirs }))).toMatchObject({ code: 'NOT_FOUND' });
    // The workspace's Notes page: the owner sees both, last edited first, each with its record; Bea only hers.
    const all = await listNotes(w.scope, {});
    expect(all.items.map((note) => [note.id, note.record?.recordId])).toEqual([
      [onTheirs.id, theirs],
      [onMine.id, mine],
    ]);
    expect(all.total).toBeUndefined();
    expect((await listNotes(bea, {})).items.map((note) => note.id)).toEqual([onMine.id]);
    expect((await listNotes(w.as(w.level('none')), {})).items).toEqual([]);
    expect(await refusalOf(getNote(bea, { noteId: onTheirs.id }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(saveNote(bea, { id: onTheirs.id, recordId: theirs, title: 'Mine now' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await refusalOf(saveNote(bea, { id: newId(), recordId: theirs, title: 'New' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await refusalOf(deleteNote(bea, { noteId: onTheirs.id }))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('answers two tries of the same first save racing each other with the same note, stored once', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const input = { id: newId(), recordId: acme, title: 'Race', content: doc('One') };
    const [a, b] = await Promise.all([saveNote(w.scope, input, hooks()), saveNote(w.scope, input, hooks())]);
    expect(a.note.id).toBe(b.note.id);
    expect(b.note.version).toBe(1);
    expect(await w.outbox()).toHaveLength(1);
  });

  it('never tells a writer their own earlier save was replaced', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const id = newId();
    await saveNote(w.scope, { id, recordId: acme, content: doc('One') });
    await saveNote(w.scope, { id, recordId: acme, content: doc('Two'), baseVersion: 1 });
    // A second tab of the same person still on version 1.
    const stale = await saveNote(w.scope, { id, recordId: acme, content: doc('Three'), baseVersion: 1 });
    expect(stale.overwrote).toBeUndefined();
    expect(stale.note.version).toBe(3);
  });

  it('refuses NUL in a title or the body as invalid input, never a database error', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    expect(await refusalOf(saveNote(w.scope, { id: newId(), recordId: acme, title: 'a\u0000b' }))).toMatchObject({
      code: 'INPUT_INVALID',
      field: 'title',
    });
    expect(await refusalOf(saveNote(w.scope, { id: newId(), recordId: acme, content: doc('a\u0000b') }))).toMatchObject(
      {
        code: 'INPUT_INVALID',
        field: 'content',
      },
    );
  });
});

describe('a note on several records (migration 0136)', () => {
  const hooks = () => [outboxHook()];

  it('links a record: the note shows on its Notes tab and timeline, saves from its page, and unlinks', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const globex = await w.company('Globex');
    const id = newId();
    await saveNote(w.scope, { id, recordId: acme, title: 'Renewal', content: doc('Both teams.') }, hooks());
    const linked = await linkNote(w.scope, { noteId: id, addRecordIds: [globex] }, hooks());
    expect(linked.links.map((link) => link.recordId)).toEqual([globex]);
    // One notes row naming both records, sorted, for the object's viewers.
    expect((await w.outbox()).at(-1)).toMatchObject({ item_ids: [id], record_ids: [acme, globex].sort() });
    expect(await getNote(w.scope, { noteId: id })).toMatchObject({
      recordId: acme,
      record: { recordId: acme },
      links: [{ recordId: globex }],
    });
    const onGlobex = await listNotes(w.scope, { recordId: globex });
    expect(onGlobex.items.map((note) => note.id)).toEqual([id]);
    expect(onGlobex.total).toEqual({ count: 1, atLeast: false });
    expect((await listNotes(w.scope, { recordId: acme })).items.map((note) => note.id)).toEqual([id]);
    // The workspace's Notes page lists it once, on its own record.
    expect((await listNotes(w.scope, {})).items.filter((note) => note.id === id)).toHaveLength(1);
    const timeline = (await getActivity(w.scope, { recordId: globex })).entries.filter((each) => each.kind === 'note');
    expect(timeline).toMatchObject([{ itemId: id, title: 'Renewal' }]);
    // Saved from the linked record's page: the same note, its own record kept.
    const saved = await saveNote(w.scope, { id, recordId: globex, content: doc('Changed.'), baseVersion: 1 }, hooks());
    expect(saved.note).toMatchObject({ id, recordId: acme, version: 2 });
    // Linking again changes nothing, and its own record can't be unlinked.
    const again = await linkNote(w.scope, { noteId: id, addRecordIds: [globex], removeRecordIds: [acme] });
    expect(again.links).toHaveLength(1);
    await linkNote(w.scope, { noteId: id, removeRecordIds: [globex] }, hooks());
    expect((await listNotes(w.scope, { recordId: globex })).items).toEqual([]);
    expect(await getNote(w.scope, { noteId: id })).toMatchObject({ links: [] });
  });

  it('follows the note’s own record for access, and each link’s for linking', async () => {
    const w = await workspace();
    const hidden = await w.ownedCompany('Hidden', w.ownerId);
    const beas = await w.ownedCompany('Bea’s', w.bea);
    const id = newId();
    await saveNote(w.scope, { id, recordId: hidden, content: doc('Private.') });
    await linkNote(w.scope, { noteId: id, addRecordIds: [beas] });
    // Bea sees her company but not the note's own record: the note is absent everywhere for her.
    const bea = w.as(w.ownCompanies);
    expect((await listNotes(bea, { recordId: beas })).items).toEqual([]);
    expect(await refusalOf(getNote(bea, { noteId: id }))).toMatchObject({ code: 'NOT_FOUND' });
    const timeline = (await getActivity(bea, { recordId: beas })).entries.filter((each) => each.kind === 'note');
    expect(timeline).toEqual([]);
    expect(await refusalOf(linkNote(bea, { noteId: id, removeRecordIds: [beas] }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    // Saved from Bea's company's page, the note she can't see answers as absent, never as linked or not.
    expect(await refusalOf(saveNote(bea, { id, recordId: beas, content: doc('Mine now.') }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    // A reader of companies may not link; nobody may link a record they can't see, or one that doesn't exist.
    const own = newId();
    await saveNote(w.scope, { id: own, recordId: beas, content: doc('Mine.') });
    const reader = w.as(w.level('read'));
    expect(await refusalOf(linkNote(reader, { noteId: own, addRecordIds: [hidden] }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await refusalOf(linkNote(bea, { noteId: own, addRecordIds: [hidden] }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await refusalOf(linkNote(w.scope, { noteId: own, addRecordIds: [newId()] }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('names the note only on its own record’s object: a linked object’s row names the record alone', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const ada = await w.person('Ada');
    const id = newId();
    await saveNote(w.scope, { id, recordId: acme, content: doc('Both.') }, hooks());
    await linkNote(w.scope, { noteId: id, addRecordIds: [ada] }, hooks());
    const rows = (await w.outbox()).slice(-2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ object_id: w.companies, item_ids: [id], record_ids: [acme] }),
        expect.objectContaining({ object_id: w.people, item_ids: [], record_ids: [ada] }),
      ]),
    );
  });

  it('links at most 20 records, and a purged link leaves the note on its own record', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const id = newId();
    await saveNote(w.scope, { id, recordId: acme, content: doc('Many.') });
    const others: string[] = [];
    for (let at = 0; at < 19; at += 1) others.push(await w.company(`Co ${String(at)}`));
    await linkNote(w.scope, { noteId: id, addRecordIds: others });
    const extra = await w.company('One too many');
    expect(await refusalOf(linkNote(w.scope, { noteId: id, addRecordIds: [extra] }))).toMatchObject({
      code: 'LIMIT_REACHED',
    });
    const [gone] = others;
    if (gone === undefined) throw new Error('No record to purge.');
    await deleteRecord(w.scope, { recordId: gone });
    await runWrite(w.scope, (context) => purgeRecords(context, { recordIds: [gone] }));
    const note = await getNote(w.scope, { noteId: id });
    expect(note.links).toHaveLength(18);
    expect(note.links.map((link) => link.recordId)).not.toContain(gone);
    // Its own record purged takes the note, and its other links, with it.
    await deleteRecord(w.scope, { recordId: acme });
    await runWrite(w.scope, (context) => purgeRecords(context, { recordIds: [acme] }));
    const left = await db.withWorkspace(w.scope.workspaceId, (tx) =>
      tx.execute<{ notes: number; links: number }>(
        sql`select (select count(*)::int from notes) as notes, (select count(*)::int from note_records) as links`,
      ),
    );
    expect(left.rows[0]).toEqual({ notes: 0, links: 0 });
  });
});

describe('a call or meeting logged on a record (migration 0141)', () => {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  const timeline = async (scope: Parameters<typeof getActivity>[0], recordId: string) =>
    (await getActivity(scope, { recordId })).entries.filter(
      (entry) => entry.kind === 'note' || entry.kind === 'call' || entry.kind === 'logged_meeting',
    );

  it('logs a call with no text, a time in the past, a duration and an outcome; a plain note has none of them', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const id = newId();
    const yesterday = hoursAgo(26);
    const saved = await saveNote(
      w.scope,
      { id, recordId: acme, kind: 'call', occurredAt: yesterday, durationMinutes: 30, outcome: 'connected' },
      hooks(),
    );
    expect(saved.note).toMatchObject({
      id,
      kind: 'call',
      occurredAt: yesterday,
      durationMinutes: 30,
      outcome: 'connected',
      title: '',
      excerpt: '',
      version: 1,
    });
    const plain = await saveNote(w.scope, { id: newId(), recordId: acme, content: doc('Hello.') });
    expect(plain.note).toMatchObject({ kind: 'note', occurredAt: plain.note.createdAt });
    expect(plain.note.durationMinutes).toBeUndefined();
    expect(plain.note.outcome).toBeUndefined();
    // A plain note still needs text; a call with none is a call.
    expect(await refusalOf(saveNote(w.scope, { id: newId(), recordId: acme, title: ' ' }))).toMatchObject({
      code: 'CONFIG_INVALID',
      field: 'content',
    });
    const meeting = await saveNote(w.scope, { id: newId(), recordId: acme, kind: 'meeting', outcome: 'no_show' });
    expect(meeting.note).toMatchObject({ kind: 'meeting', outcome: 'no_show' });
    // No time given: now, to the moment it was made.
    expect(meeting.note.occurredAt).toBe(meeting.note.createdAt);
  });

  it('refuses a detail its kind does not take, a duration out of range, a kind that changes and a time a day ahead', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const field = (name: string): unknown => expect.objectContaining({ code: 'INPUT_INVALID', field: name });
    const id = newId();
    await saveNote(w.scope, { id, recordId: acme, kind: 'call', durationMinutes: 15 });
    // A call takes its own outcomes, never a meeting's.
    expect(await refusalOf(saveNote(w.scope, { id: newId(), recordId: acme, kind: 'call', outcome: 'held' }))).toEqual(
      field('outcome'),
    );
    expect(
      await refusalOf(saveNote(w.scope, { id: newId(), recordId: acme, kind: 'meeting', outcome: 'connected' })),
    ).toEqual(field('outcome'));
    for (const minutes of [0, 1441, 2.5]) {
      expect(
        await refusalOf(saveNote(w.scope, { id: newId(), recordId: acme, kind: 'call', durationMinutes: minutes })),
      ).toEqual(field('durationMinutes'));
    }
    // A plain note has no time, duration or outcome of its own.
    for (const details of [{ occurredAt: hoursAgo(5) }, { durationMinutes: 10 }, { outcome: 'held' as const }]) {
      const refused = await refusalOf(
        saveNote(w.scope, { id: newId(), recordId: acme, content: doc('Plain.'), ...details }),
      );
      expect(refused).toMatchObject({ code: 'INPUT_INVALID' });
    }
    // Logging is for what happened: a day ahead is the most.
    expect(
      await refusalOf(
        saveNote(w.scope, {
          id: newId(),
          recordId: acme,
          kind: 'call',
          occurredAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        }),
      ),
    ).toEqual(field('occurredAt'));
    const soon = await saveNote(w.scope, {
      id: newId(),
      recordId: acme,
      kind: 'call',
      occurredAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(soon.note.kind).toBe('call');
    // A kind is for life.
    expect(await refusalOf(saveNote(w.scope, { id, recordId: acme, kind: 'meeting' }))).toEqual(field('kind'));
    // Nothing the refusals tried was stored: the first call and the one an hour ahead.
    expect((await listNotes(w.scope, { recordId: acme })).items).toHaveLength(2);
  });

  it('edits the time, duration and outcome of an entry, clears them with null, and writes nothing when nothing changed', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const id = newId();
    const first = hoursAgo(30);
    const second = hoursAgo(3);
    await saveNote(w.scope, {
      id,
      recordId: acme,
      kind: 'call',
      occurredAt: first,
      durationMinutes: 15,
      outcome: 'no_answer',
    });
    const edited = await saveNote(
      w.scope,
      {
        id,
        recordId: acme,
        kind: 'call',
        occurredAt: second,
        durationMinutes: 45,
        outcome: 'left_message',
        baseVersion: 1,
      },
      hooks(),
    );
    expect(edited.note).toMatchObject({ version: 2, occurredAt: second, durationMinutes: 45, outcome: 'left_message' });
    const same = await saveNote(
      w.scope,
      { id, recordId: acme, occurredAt: second, durationMinutes: 45, outcome: 'left_message' },
      hooks(),
    );
    expect(same.note.version).toBe(2);
    const cleared = await saveNote(w.scope, { id, recordId: acme, durationMinutes: null, outcome: null });
    expect(cleared.note).toMatchObject({ version: 3, occurredAt: second });
    expect(cleared.note.durationMinutes).toBeUndefined();
    expect(cleared.note.outcome).toBeUndefined();
    // A repeat of the first save after a lost answer writes nothing.
    const replay = await saveNote(w.scope, { id, recordId: acme, kind: 'call', occurredAt: second });
    expect(replay.note.version).toBe(3);
  });

  it('sits at the moment it happened on the timeline, on every record it is on, and a filter reads only its kinds', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const globex = await w.company('Globex');
    const call = newId();
    const note = newId();
    const meeting = newId();
    const yesterday = hoursAgo(26);
    await saveNote(w.scope, { id: note, recordId: acme, title: 'Today', content: doc('Made just now.') });
    await saveNote(w.scope, {
      id: call,
      recordId: acme,
      kind: 'call',
      occurredAt: yesterday,
      durationMinutes: 20,
      outcome: 'connected',
      content: doc('Talked renewal.'),
    });
    await saveNote(w.scope, {
      id: meeting,
      recordId: acme,
      kind: 'meeting',
      occurredAt: hoursAgo(50),
      outcome: 'held',
    });
    // Linked a moment ago, it still sits where it happened on the other record.
    await linkNote(w.scope, { noteId: call, addRecordIds: [globex] });
    const all = await timeline(w.scope, acme);
    expect(all.map((entry) => [entry.kind, entry.itemId])).toEqual([
      ['note', note],
      ['call', call],
      ['logged_meeting', meeting],
    ]);
    expect(all[1]).toMatchObject({
      durationMinutes: 20,
      outcome: 'connected',
      excerpt: 'Talked renewal.',
      actor: { type: 'member', id: w.ownerId },
    });
    expect(Date.parse(all[1]?.key.split('|')[0] ?? '')).toBe(Date.parse(yesterday));
    const there = await timeline(w.scope, globex);
    expect(there).toMatchObject([{ kind: 'call', itemId: call, durationMinutes: 20 }]);
    expect(Date.parse(there[0]?.key.split('|')[0] ?? '')).toBe(Date.parse(yesterday));
    // A filter reads only the kinds it names: Calls, Meetings (a logged one is a meeting) and Notes alone.
    const only = async (kinds: ('note' | 'call' | 'logged_meeting')[]) =>
      (await getActivity(w.scope, { recordId: acme, kinds })).entries.map((entry) => entry.itemId);
    expect(await only(['call'])).toEqual([call]);
    expect(await only(['logged_meeting'])).toEqual([meeting]);
    expect(await only(['note'])).toEqual([note]);
    expect(await only(['call', 'logged_meeting'])).toEqual([call, meeting]);
  });

  it('lists a call where it happened and a note where it was last edited, with a cursor that holds the same order', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const call = newId();
    const oldCall = newId();
    const note = newId();
    await saveNote(w.scope, { id: oldCall, recordId: acme, kind: 'call', occurredAt: hoursAgo(72) });
    await saveNote(w.scope, { id: call, recordId: acme, kind: 'call', occurredAt: hoursAgo(26) });
    await saveNote(w.scope, { id: note, recordId: acme, title: 'Fresh', content: doc('Just now.') });
    const whole = await listNotes(w.scope, { recordId: acme });
    expect(whole.items.map((item) => item.id)).toEqual([note, call, oldCall]);
    // Editing a call does not move it: it is listed by when it happened.
    await saveNote(w.scope, { id: oldCall, recordId: acme, content: doc('Added notes later.') });
    expect((await listNotes(w.scope, { recordId: acme })).items.map((item) => item.id)).toEqual([note, call, oldCall]);
    // Paged one at a time, the cursor carries the listed moment: nothing repeats, nothing is skipped.
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page += 1) {
      const got = await listNotes(w.scope, { recordId: acme, limit: 1, ...(cursor === undefined ? {} : { cursor }) });
      seen.push(...got.items.map((item) => item.id));
      cursor = got.nextCursor;
    }
    expect(seen).toEqual([note, call, oldCall]);
    expect(cursor).toBeUndefined();
    // The workspace's Notes page lists them in the same order.
    expect((await listNotes(w.scope, {})).items.map((item) => item.id)).toEqual([note, call, oldCall]);
  });

  it('follows its record’s access: a member who may only read cannot log, edit or delete, and one who sees none sees none of it', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const id = newId();
    await saveNote(w.scope, { id, recordId: acme, kind: 'call', durationMinutes: 10, outcome: 'connected' });
    const reader = w.as(w.level('read'));
    // Read: it shows (with its details), and cannot be changed.
    expect((await getNote(reader, { noteId: id })).canChange).toBe(false);
    expect(await refusalOf(saveNote(reader, { id: newId(), recordId: acme, kind: 'call' }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await refusalOf(saveNote(reader, { id, recordId: acme, outcome: 'no_answer' }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await refusalOf(deleteNote(reader, { noteId: id }))).toMatchObject({ code: 'FORBIDDEN' });
    // None: it is absent, whatever kind, duration or outcome it has.
    const none = w.as(w.level('none'));
    expect(await refusalOf(getNote(none, { noteId: id }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(saveNote(none, { id: newId(), recordId: acme, kind: 'call' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await refusalOf(listNotes(none, { recordId: acme }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(getActivity(none, { recordId: acme }))).toMatchObject({ code: 'NOT_FOUND' });
    // A record rule: a call on a record the member may not see is absent, one on a record they own is theirs.
    const beas = await w.ownedCompany('Bea’s', w.bea);
    const mine = newId();
    await saveNote(w.scope, { id: mine, recordId: beas, kind: 'meeting', outcome: 'held' });
    const rule = w.as(w.ownCompanies);
    expect(await refusalOf(getNote(rule, { noteId: id }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await getNote(rule, { noteId: mine })).toMatchObject({ kind: 'meeting', outcome: 'held' });
    expect((await timeline(rule, beas)).map((entry) => entry.itemId)).toEqual([mine]);
  });

  it('deletes with one call, and Undo brings back the time, duration, outcome and text exactly', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const id = newId();
    const at = hoursAgo(10);
    await saveNote(w.scope, {
      id,
      recordId: acme,
      kind: 'meeting',
      occurredAt: at,
      durationMinutes: 60,
      outcome: 'held',
      content: doc('Agreed the scope.'),
    });
    await deleteNote(w.scope, { noteId: id }, hooks());
    expect(await timeline(w.scope, acme)).toEqual([]);
    expect((await listNotes(w.scope, { recordId: acme })).items).toEqual([]);
    const back = await restoreNote(w.scope, { noteId: id }, hooks());
    expect(back).toMatchObject({ kind: 'meeting', occurredAt: at, durationMinutes: 60, outcome: 'held' });
    expect(await timeline(w.scope, acme)).toMatchObject([
      { kind: 'logged_meeting', itemId: id, excerpt: 'Agreed the scope.', durationMinutes: 60 },
    ]);
  });
});
