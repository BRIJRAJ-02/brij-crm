// The notes store against a fake API answered by hand and a fake clock (spec
// 0019, AC-439 to AC-443, AC-445): nothing stored until there is text, the
// 300 ms save and its 2 second most wait, one save in flight with the latest
// next, the offline retries then Retry, the size check before sending, the
// two notices, a save finishing after its window closed, the list's live
// reread, delete with Undo, and a note's linked records (migration 0135).
import type { Note, NoteSummary } from '@crm/contracts';
import type { RecordRefDisplay } from '@crm/contracts/values';
import { describe, expect, it } from 'vitest';
import { dataError } from '../errors.ts';
import { createMutationLog } from '../live/mutations.ts';
import { createNotesStore, NOTE_RETRY_SECONDS, type NotesApi } from './store.ts';

const WS = 'acme';
const ACME = '0199a6f2-0000-7000-8000-0000000000a1';
const ME = { type: 'member' as const, id: '0199a6f2-0000-7000-8000-000000000001' };
const BEA = { type: 'member' as const, id: '0199a6f2-0000-7000-8000-000000000002' };

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

interface Stored {
  title: string;
  content: unknown;
  version: number;
  updatedBy: typeof ME;
  updatedAt?: string;
}

function setup() {
  let clock = 0;
  const timers: { at: number; work: () => void; live: boolean }[] = [];
  const server = new Map<string, Stored>();
  const saves: { title?: string; content?: unknown; baseVersion?: number | null }[] = [];
  const notices: { message: string; action?: () => void }[] = [];
  let gate: Promise<void> | undefined;
  let open: () => void = () => undefined;
  let failNext: Error[] = [];
  let failDelete: Error | undefined;
  let failLink: Error | undefined;
  const links = new Map<string, RecordRefDisplay[]>();
  const linkCalls: { add?: readonly string[]; remove?: readonly string[] }[] = [];
  const savedOn: string[] = [];
  const summary = (id: string, held: Stored): NoteSummary => ({
    id,
    recordId: ACME,
    title: held.title,
    excerpt: '',
    version: held.version,
    canChange: true,
    createdAt: '2026-10-20T10:00:00.000Z',
    createdBy: ME,
    updatedAt: held.updatedAt ?? '2026-10-20T10:00:00.000Z',
    updatedBy: held.updatedBy,
  });
  const api: NotesApi = {
    list: () => {
      const items = [...server.entries()].map(([id, held]) => summary(id, held));
      return Promise.resolve({ items, total: { count: items.length, atLeast: false } });
    },
    get: ({ noteId }) => {
      const held = server.get(noteId);
      if (held === undefined) return Promise.reject(dataError('NOT_FOUND', 'That note does not exist.'));
      return Promise.resolve({
        ...summary(noteId, held),
        content: held.content,
        links: links.get(noteId) ?? [],
      } as Note);
    },
    save: async (input) => {
      saves.push({ title: input.title, content: input.content, baseVersion: input.baseVersion });
      savedOn.push(input.recordId);
      await gate;
      const failure = failNext.shift();
      if (failure !== undefined) throw failure;
      const held = server.get(input.id);
      const next: Stored = {
        title: input.title ?? held?.title ?? '',
        content: input.content ?? held?.content ?? doc(''),
        version: (held?.version ?? 0) + 1,
        updatedBy: ME,
        updatedAt: `2026-10-21T09:00:0${String((held?.version ?? 0) + 1)}.000Z`,
      };
      const overwrote =
        held !== undefined && input.baseVersion !== held.version ? { by: held.updatedBy, at: 'then' } : undefined;
      server.set(input.id, next);
      return { note: summary(input.id, next), ...(overwrote ? { overwrote } : {}) };
    },
    delete: ({ noteId }) => {
      const refused = failDelete;
      failDelete = undefined;
      if (refused !== undefined) return Promise.reject(refused);
      server.delete(noteId);
      return Promise.resolve({ ok: true });
    },
    restore: ({ noteId }) => {
      const held: Stored = { title: 'Back', content: doc('x'), version: 1, updatedBy: ME };
      server.set(noteId, held);
      return Promise.resolve(summary(noteId, held));
    },
    link: async ({ noteId, addRecordIds, removeRecordIds }) => {
      linkCalls.push({
        ...(addRecordIds ? { add: addRecordIds } : {}),
        ...(removeRecordIds ? { remove: removeRecordIds } : {}),
      });
      await gate;
      const refused = failLink;
      failLink = undefined;
      if (refused !== undefined) throw refused;
      const removed = new Set(removeRecordIds ?? []);
      const kept = (links.get(noteId) ?? []).filter((link) => !removed.has(link.recordId));
      const added = (addRecordIds ?? []).map((recordId): RecordRefDisplay => ({
        objectId: 'o2',
        recordId,
        name: `Server ${recordId.slice(-2)}`,
        kind: 'other',
      }));
      links.set(noteId, [...kept, ...added]);
      return { noteId, links: links.get(noteId) ?? [] };
    },
  };
  let minted = 0;
  let unsaved = false;
  const store = createNotesStore({
    api,
    mintId: () => `0199a6f2-0000-7000-8000-${String((minted += 1)).padStart(12, '0')}`,
    mutations: createMutationLog(),
    notify: (notice) =>
      notices.push({ message: notice.message, ...(notice.action ? { action: notice.action.onAction } : {}) }),
    watch: () => () => undefined,
    timelines: () => undefined,
    onUnsaved: (has) => {
      unsaved = has;
    },
    now: () => clock,
    later: (work, ms) => {
      const timer = { at: clock + ms, work, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  });
  /** Moves the clock on, running each timer due on the way, in order. */
  const advance = async (ms: number) => {
    const end = clock + ms;
    for (;;) {
      await flush();
      const due = timers.filter((timer) => timer.live && timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      due.live = false;
      clock = due.at;
      due.work();
    }
    clock = end;
    await flush();
  };
  return {
    store,
    server,
    saves,
    notices,
    advance,
    unsaved: () => unsaved,
    failWith: (...errors: Error[]) => {
      failNext = errors;
    },
    failDeleteWith: (refused: Error) => {
      failDelete = refused;
    },
    failLinkWith: (refused: Error) => {
      failLink = refused;
    },
    linkCalls,
    savedOn,
    hold: () => {
      gate = new Promise((resolve) => {
        open = resolve;
      });
    },
    release: () => {
      gate = undefined;
      open();
    },
  };
}

const offline = () => dataError('API_UNAVAILABLE', 'You’re offline.');

describe('the note session (spec 0019)', () => {
  it('stores nothing until the note holds text, then saves the body at once and the title 300 ms after typing stops (AC-439, AC-440)', async () => {
    const t = setup();
    const id = t.store.newId();
    const session = t.store.open(WS, { noteId: id, recordId: ACME, objectId: 'o1', isNew: true, canChange: true });
    const release = session.retain();
    session.setTitle('   ');
    await t.advance(5_000);
    expect(t.saves).toEqual([]);
    // The body comes from the editor's own 300 ms wait, so it saves at once; the blank title was never held.
    session.setDoc(doc('Met at the fair'));
    await t.advance(0);
    expect(t.saves).toEqual([{ content: doc('Met at the fair'), baseVersion: null }]);
    // A title waits 300 ms after typing stops.
    session.setTitle('Fair');
    await t.advance(299);
    expect(t.saves).toHaveLength(1);
    await t.advance(1);
    expect(t.saves[1]).toMatchObject({ title: 'Fair', baseVersion: 1 });
    expect(session.getSnapshot()).toMatchObject({ isNew: false, saveState: 'saved' });
    release();
    // Closing a new note that never held text stores nothing.
    const empty = t.store.open(WS, {
      noteId: t.store.newId(),
      recordId: ACME,
      objectId: 'o1',
      isNew: true,
      canChange: true,
    });
    empty.retain()();
    await t.advance(5_000);
    expect(t.saves).toHaveLength(2);
  });

  it('saves at least every 2 seconds while typing goes on, one save out at a time, the latest next', async () => {
    const t = setup();
    const session = t.store.open(WS, {
      noteId: t.store.newId(),
      recordId: ACME,
      objectId: 'o1',
      isNew: true,
      canChange: true,
    });
    session.retain();
    for (let i = 1; i <= 25; i += 1) {
      session.setDoc(doc('x'.repeat(i)));
      await t.advance(200);
    }
    // 5 seconds of typing a key every 200 ms: saved at 2 s and 4 s, never waiting for a pause.
    expect(t.saves.length).toBeGreaterThanOrEqual(2);
    t.hold();
    session.setDoc(doc('held'));
    await t.advance(300);
    const out = t.saves.length;
    session.setDoc(doc('later'));
    await t.advance(3_000);
    expect(t.saves).toHaveLength(out);
    t.release();
    await t.advance(0);
    expect(t.saves.at(-1)?.content).toEqual(doc('later'));
    expect(t.server.values().next().value?.content).toEqual(doc('later'));
  });

  it('tries a save with no answer again after 1, 2, 4, 8 and 15 s, then says Not saved with Retry, keeping the text', async () => {
    const t = setup();
    const session = t.store.open(WS, {
      noteId: t.store.newId(),
      recordId: ACME,
      objectId: 'o1',
      isNew: true,
      canChange: true,
    });
    session.retain();
    t.failWith(...Array.from({ length: NOTE_RETRY_SECONDS.length + 1 }, offline));
    session.setDoc(doc('On a plane'));
    expect(t.unsaved()).toBe(true);
    await t.advance(300);
    expect(session.getSnapshot().saveState).toBe('retrying');
    await t.advance(30_000);
    expect(t.saves).toHaveLength(NOTE_RETRY_SECONDS.length + 1);
    expect(session.getSnapshot()).toMatchObject({ saveState: 'failed', doc: doc('On a plane') });
    session.retry();
    await t.advance(0);
    expect(session.getSnapshot().saveState).toBe('saved');
    expect(t.unsaved()).toBe(false);
  });

  it('never sends a body over 200 KB, and says why with the text kept (AC-441)', async () => {
    const t = setup();
    const session = t.store.open(WS, {
      noteId: t.store.newId(),
      recordId: ACME,
      objectId: 'o1',
      isNew: true,
      canChange: true,
    });
    session.retain();
    session.setDoc(doc('x'.repeat(250 * 1024)));
    await t.advance(2_000);
    expect(t.saves).toEqual([]);
    expect(session.getSnapshot()).toMatchObject({ isTooLong: true, saveState: 'failed' });
    expect(session.getSnapshot().refusal?.message).toBe('This note is too long to save. Split it into two notes.');
  });

  it('shows their version when someone else saves and nothing is unsaved here, and says so (AC-443)', async () => {
    const t = setup();
    const id = '0199a6f2-0000-7000-8000-0000000000f1';
    t.server.set(id, { title: 'Plan', content: doc('v1'), version: 1, updatedBy: ME });
    const session = t.store.open(WS, { noteId: id, recordId: ACME, objectId: 'o1', isNew: false, canChange: true });
    session.retain();
    await t.advance(0);
    expect(session.getSnapshot()).toMatchObject({ status: 'ready', title: 'Plan', docKey: 0 });
    t.server.set(id, { title: 'Plan', content: doc('theirs'), version: 2, updatedBy: BEA });
    t.store.changed(WS, { seq: 2, at: '', kind: 'notes', recordIds: [ACME], noteIds: [id] });
    await t.advance(0);
    expect(session.getSnapshot()).toMatchObject({ doc: doc('theirs'), docKey: 1, notice: { kind: 'theirs', by: BEA } });
  });

  it('keeps unsaved text over someone else’s save and says it was saved over theirs (AC-443)', async () => {
    const t = setup();
    const id = '0199a6f2-0000-7000-8000-0000000000f2';
    t.server.set(id, { title: 'Plan', content: doc('v1'), version: 1, updatedBy: ME });
    const session = t.store.open(WS, { noteId: id, recordId: ACME, objectId: 'o1', isNew: false, canChange: true });
    session.retain();
    await t.advance(0);
    session.setDoc(doc('mine'));
    t.server.set(id, { title: 'Plan', content: doc('theirs'), version: 2, updatedBy: BEA });
    t.store.changed(WS, { seq: 2, at: '', kind: 'notes', recordIds: [ACME], noteIds: [id] });
    await t.advance(300);
    expect(t.saves.at(-1)).toMatchObject({ content: doc('mine'), baseVersion: 1 });
    expect(session.getSnapshot()).toMatchObject({ doc: doc('mine'), notice: { kind: 'overwrote', by: BEA } });
  });

  it('lets a pending save finish after the window closes, and offers the note again if it fails (AC-440)', async () => {
    const t = setup();
    const session = t.store.open(WS, {
      noteId: t.store.newId(),
      recordId: ACME,
      objectId: 'o1',
      isNew: true,
      canChange: true,
    });
    const release = session.retain();
    session.setDoc(doc('closing'));
    t.failWith(dataError('FORBIDDEN', 'You can view this note but not change it.'));
    release();
    await t.advance(0);
    expect(t.saves).toHaveLength(1);
    expect(t.notices).toMatchObject([{ message: 'Your note wasn’t saved.' }]);
    let opened = '';
    t.store.setOpener((_workspace, _object, _record, noteId) => {
      opened = noteId;
    });
    t.notices[0]?.action?.();
    expect(opened).not.toBe('');
  });
});

describe('the note session after review (spec 0019)', () => {
  it('holds nothing for a new note of spaces, so leaving asks nothing and closing sends nothing', async () => {
    const t = setup();
    const session = t.store.open(WS, {
      noteId: t.store.newId(),
      recordId: ACME,
      objectId: 'o1',
      isNew: true,
      canChange: true,
    });
    const release = session.retain();
    session.setTitle('   ');
    session.setDoc(doc('  '));
    expect(t.unsaved()).toBe(false);
    release();
    await t.advance(5_000);
    expect(t.saves).toEqual([]);
    expect(t.notices).toEqual([]);
  });

  it('saves a long run of title typing about every 2 seconds, never back to back', async () => {
    const t = setup();
    const session = t.store.open(WS, {
      noteId: t.store.newId(),
      recordId: ACME,
      objectId: 'o1',
      isNew: true,
      canChange: true,
    });
    session.retain();
    for (let i = 1; i <= 50; i += 1) {
      session.setTitle('x'.repeat(i));
      await t.advance(100);
    }
    // 5 seconds of typing a key every 100 ms: about one save each 2 seconds.
    expect(t.saves.length).toBeGreaterThanOrEqual(2);
    expect(t.saves.length).toBeLessThanOrEqual(4);
  });

  it('drops the last text of an editor that someone else’s version replaced', async () => {
    const t = setup();
    const id = '0199a6f2-0000-7000-8000-0000000000f9';
    t.server.set(id, { title: 'Plan', content: doc('v1'), version: 1, updatedBy: ME });
    const session = t.store.open(WS, { noteId: id, recordId: ACME, objectId: 'o1', isNew: false, canChange: true });
    session.retain();
    await t.advance(0);
    t.server.set(id, { title: 'Plan', content: doc('theirs'), version: 2, updatedBy: BEA });
    t.store.changed(WS, { seq: 2, at: '', kind: 'notes', recordIds: [ACME], noteIds: [id] });
    await t.advance(0);
    expect(session.getSnapshot().docKey).toBe(1);
    // The old editor unmounting hands over its text: older than what shows now, so nothing is sent.
    session.setDoc(doc('mine, stale'), 0);
    await t.advance(3_000);
    expect(t.saves).toEqual([]);
  });
});

describe('the note window in its page look (21 October 2026)', () => {
  it('says when the note was last edited: from its read, then from each save', async () => {
    const t = setup();
    const id = '0199a6f2-0000-7000-8000-0000000000fa';
    t.server.set(id, {
      title: 'Plan',
      content: doc('v1'),
      version: 1,
      updatedBy: BEA,
      updatedAt: '2026-10-19T08:00:00.000Z',
    });
    const session = t.store.open(WS, { noteId: id, recordId: ACME, objectId: 'o1', isNew: false, canChange: true });
    session.retain();
    await t.advance(0);
    expect(session.getSnapshot()).toMatchObject({ status: 'ready', updatedAt: '2026-10-19T08:00:00.000Z' });
    session.setDoc(doc('v2'));
    await t.advance(0);
    expect(session.getSnapshot()).toMatchObject({ saveState: 'saved', updatedAt: '2026-10-21T09:00:02.000Z' });
    // A new note has no edit time until its first save stores it.
    const fresh = t.store.open(WS, {
      noteId: t.store.newId(),
      recordId: ACME,
      objectId: 'o1',
      isNew: true,
      canChange: true,
    });
    expect(fresh.getSnapshot().updatedAt).toBeUndefined();
  });

  it('shows the note again when its delete is refused, and sends what was unsaved after all', async () => {
    const t = setup();
    const id = '0199a6f2-0000-7000-8000-0000000000fb';
    t.server.set(id, { title: 'Plan', content: doc('v1'), version: 1, updatedBy: ME });
    const session = t.store.open(WS, { noteId: id, recordId: ACME, objectId: 'o1', isNew: false, canChange: true });
    session.retain();
    await t.advance(0);
    session.setTitle('Plan B');
    t.failDeleteWith(dataError('FORBIDDEN', 'You can view this note but not change it.'));
    const removing = t.store.remove(WS, ACME, id);
    expect(session.getSnapshot().isUnavailable).toBe(true);
    expect(await removing).toMatchObject({ code: 'FORBIDDEN' });
    expect(session.getSnapshot().isUnavailable).toBe(false);
    await t.advance(300);
    expect(t.saves).toEqual([expect.objectContaining({ title: 'Plan B' })]);
    // A delete that lands sends nothing more.
    session.setTitle('Plan C');
    expect(await t.store.remove(WS, ACME, id)).toBeUndefined();
    await t.advance(3_000);
    expect(t.saves).toHaveLength(1);
    expect(session.getSnapshot().isUnavailable).toBe(true);
  });
});

describe('a record’s notes list (spec 0019, AC-442, AC-445)', () => {
  it('reads again on a notes event at most twice a second, and takes a deleted note out at once with Undo', async () => {
    const t = setup();
    const id = '0199a6f2-0000-7000-8000-0000000000f3';
    t.server.set(id, { title: 'One', content: doc('x'), version: 1, updatedBy: ME });
    const list = t.store.forRecord(WS, ACME);
    list.retain();
    await list.ready();
    expect(list.getSnapshot()).toMatchObject({ status: 'ready', total: { count: 1 } });
    t.server.set('0199a6f2-0000-7000-8000-0000000000f4', {
      title: 'Two',
      content: doc('y'),
      version: 1,
      updatedBy: BEA,
    });
    t.store.changed(WS, { seq: 3, at: '', kind: 'notes', recordIds: [ACME], noteIds: [] });
    t.store.changed(WS, { seq: 4, at: '', kind: 'notes', recordIds: [ACME], noteIds: [] });
    await t.advance(500);
    expect(list.getSnapshot().total?.count).toBe(2);
    expect(await t.store.remove(WS, ACME, id)).toBeUndefined();
    expect(list.getSnapshot().source.count).toBe(1);
    expect(await t.store.restore(WS, ACME, id)).toBeUndefined();
    expect(list.getSnapshot().source.getItem(0)?.id).toBe(id);
  });

  it('reads again for a job’s coarse change to its own object’s records only (spec 0022)', async () => {
    const t = setup();
    t.server.set('0199a6f2-0000-7000-8000-0000000000f5', {
      title: 'One',
      content: doc('x'),
      version: 1,
      updatedBy: ME,
    });
    const list = t.store.forRecord(WS, ACME, 'companies');
    list.retain();
    await list.ready();
    t.server.set('0199a6f2-0000-7000-8000-0000000000f6', {
      title: 'Two',
      content: doc('y'),
      version: 1,
      updatedBy: BEA,
    });
    const coarse = (seq: number, objectId: string) => {
      t.store.recordsChanged(WS, {
        seq,
        at: '',
        kind: 'records',
        objectId,
        recordIds: [],
        attributeIds: [],
        coarse: true,
        fromJob: true,
      });
    };
    coarse(5, 'people');
    await t.advance(500);
    expect(list.getSnapshot().total?.count).toBe(1);
    coarse(6, 'companies');
    await t.advance(500);
    expect(list.getSnapshot().total?.count).toBe(2);
  });
});

describe('a note’s linked records (migration 0135)', () => {
  const GLOBEX: RecordRefDisplay = {
    objectId: 'o2',
    recordId: '0199a6f2-0000-7000-8000-0000000000b2',
    name: 'Globex',
    kind: 'other',
  };

  it('links a record at once, takes the server’s answer, and puts it back on a refusal', async () => {
    const t = setup();
    const id = '0199a6f2-0000-7000-8000-0000000000c1';
    t.server.set(id, { title: 'Call', content: doc('x'), version: 1, updatedBy: ME });
    const session = t.store.open(WS, { noteId: id, recordId: ACME, objectId: 'o1', isNew: false, canChange: true });
    session.retain();
    await t.advance(0);
    expect(session.getSnapshot()).toMatchObject({ status: 'ready', recordId: ACME, links: [] });
    t.hold();
    const landed = session.setLinks({ add: [GLOBEX] });
    // Shown before the answer.
    expect(session.getSnapshot().links).toEqual([GLOBEX]);
    t.release();
    expect(await landed).toBeUndefined();
    expect(t.linkCalls).toEqual([{ add: [GLOBEX.recordId] }]);
    expect(session.getSnapshot().links.map((link) => link.name)).toEqual(['Server b2']);
    // Its own record is never sent as a link.
    expect(await session.setLinks({ add: [{ ...GLOBEX, recordId: ACME }] })).toBeUndefined();
    expect(t.linkCalls).toHaveLength(1);
    // A refused unlink puts the chip back and answers why.
    t.failLinkWith(dataError('FORBIDDEN', 'You can view this note but not change it.'));
    const refused = await session.setLinks({ remove: [GLOBEX.recordId] });
    expect(refused).toMatchObject({ code: 'FORBIDDEN' });
    expect(session.getSnapshot().links.map((link) => link.recordId)).toEqual([GLOBEX.recordId]);
  });

  it('saves a note opened from a record it links under its own record', async () => {
    const t = setup();
    const id = '0199a6f2-0000-7000-8000-0000000000c2';
    t.server.set(id, { title: 'Call', content: doc('x'), version: 1, updatedBy: ME });
    // Opened from Globex's page: the read says the note's own record is Acme.
    const session = t.store.open(WS, {
      noteId: id,
      recordId: GLOBEX.recordId,
      objectId: 'o2',
      isNew: false,
      canChange: true,
    });
    session.retain();
    await t.advance(0);
    expect(session.getSnapshot().recordId).toBe(ACME);
    session.setDoc(doc('More'));
    await t.advance(0);
    expect(t.saves.at(-1)).toMatchObject({ content: doc('More'), baseVersion: 1 });
    expect(t.savedOn.at(-1)).toBe(ACME);
  });
});
