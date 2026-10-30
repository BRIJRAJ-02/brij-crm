// `data.notes` (spec 0019, milestone 3): notes as screens see them, loaded
// lazily with the first screen that shows one. Two parts:
//
// - a record's list (`forRecord`): its notes, last edited first, 20 at a time
//   as it scrolls, with the count for the tab's label. A `notes` event naming
//   the record reads its loaded pages again, at most twice a second; a coarse
//   one reads every loaded list. Nothing polls.
// - the note window's session (`open`): one per note while a window or a
//   pending save holds it. It sends nothing for a new note until the title or
//   the text holds something; then it saves 300 ms after typing stops and at
//   least every 2 seconds while it goes on, one save in flight at a time, the
//   latest state next. A save that gets no answer tries again after 1, 2, 4,
//   8 and 15 seconds, then says "Not saved." with Retry and keeps the text; a
//   refusal stops at once with its message. A body over 200 KB is never sent
//   (the same refusal the service gives). When someone else saves the note:
//   with nothing unsaved here, the session reads theirs and says so; with
//   unsaved text, the next save goes over theirs and says that (last write
//   wins, AC-443). Closing with a save pending lets it finish; if it then
//   fails, a toast offers to open the note again with the text. A note links
//   other records besides its own (migration 0136): the session holds them,
//   and `setLinks` changes them at once, put back on a refusal.
//
// A call or a meeting logged on a record (migration 0141) is a note with a
// kind, saved whole by the Log activity dialog, not by a session: `logActivity`
// and `updateActivity` wait for the server (the dialog stays open on a
// refusal, with what was typed), then put the note in every list of every
// record it is on and have their timelines read again.
import {
  NOTE_CONTENT_MAX_BYTES,
  NOTE_PAGE,
  NOTE_PAGE_MAX,
  NOTE_TOO_LONG,
  noteBytes,
  richTextToPlain,
} from '@crm/contracts/note-limits';
import type { NoteKind, NoteOutcome } from '@crm/contracts/note-limits';
import type { ChangeEvent, Note, NoteLinks, NotePage, NoteSummary, SaveNoteResult, TaskTotal } from '@crm/contracts';
import type { ActorReferenceValue as Actor, RecordRefDisplay } from '@crm/contracts/values';
import { dataError, toDataError, type DataError } from '../errors.ts';
import type { MutationLog } from '../live/mutations.ts';
import type { Notice } from '../notice.ts';

/** How long after typing stops a note saves. */
export const NOTE_SAVE_DELAY_MS = 300;

/** The longest a note waits to save while typing goes on. */
export const NOTE_SAVE_MAX_WAIT_MS = 2_000;

/** The waits before each try again of a save that got no answer (spec 0006's offline schedule), in seconds. */
export const NOTE_RETRY_SECONDS = [1, 2, 4, 8, 15] as const;

/** How often a list reads its pages again on events, at most. */
const LIST_REREAD_MS = 500;

/** How long a list nobody shows keeps its ids before it lets them go. */
const UNUSED_MS = 30_000;

/** Failures that may pass on their own: tried again on the schedule. Anything else is a refusal. */
const PASSING = new Set(['API_UNAVAILABLE', 'INTERNAL', 'RATE_LIMITED', 'TOO_MANY_REQUESTS']);

/** The words the store raises itself. */
export const NOTE_WORDS = {
  notSaved: 'Your note wasn’t saved.',
  openNote: 'Open note',
  unavailable: 'This note isn’t available. Its record may have been deleted, or you may not have access to it.',
} as const;

/** The calls the notes store makes, each mapped to a DataError by the layer. */
export interface NotesApi {
  readonly list: (input: {
    readonly workspace: string;
    /** Absent: the workspace's Notes page. */
    readonly recordId?: string;
    readonly cursor?: string;
    readonly limit?: number;
  }) => Promise<NotePage>;
  readonly get: (input: { readonly workspace: string; readonly noteId: string }) => Promise<Note>;
  readonly save: (input: {
    readonly workspace: string;
    readonly id: string;
    readonly recordId: string;
    readonly title?: string;
    readonly content?: unknown;
    readonly kind?: NoteKind;
    readonly occurredAt?: string;
    readonly durationMinutes?: number | null;
    readonly outcome?: NoteOutcome | null;
    readonly baseVersion?: number | null;
    readonly mutationId: string;
  }) => Promise<SaveNoteResult>;
  readonly delete: (input: {
    readonly workspace: string;
    readonly noteId: string;
    readonly mutationId: string;
  }) => Promise<unknown>;
  readonly restore: (input: {
    readonly workspace: string;
    readonly noteId: string;
    readonly mutationId: string;
  }) => Promise<NoteSummary>;
  readonly link: (input: {
    readonly workspace: string;
    readonly noteId: string;
    readonly addRecordIds?: readonly string[];
    readonly removeRecordIds?: readonly string[];
    readonly mutationId: string;
  }) => Promise<NoteLinks>;
}

/** What the notes store needs from the layer. */
export interface NotesDeps {
  readonly api: NotesApi;
  readonly mintId: () => string;
  readonly mutations: MutationLog;
  readonly notify: (notice: Notice) => void;
  /** Listens to a workspace's change events while a list or a session is shown; the answer stops. */
  readonly watch: (workspace: string) => () => void;
  /** A note changed on these records: their open timelines read their first page again. */
  readonly timelines: (workspace: string, recordIds: readonly string[] | 'all') => void;
  /** Told whenever some note has (or no longer has) changes not yet saved, for the page's "Leave site?". */
  readonly onUnsaved?: (hasUnsaved: boolean) => void;
  /** The timer, for tests. */
  readonly later?: (work: () => void, ms: number) => () => void;
  /** The clock, for tests. */
  readonly now?: () => number;
}

/** What a record's notes list shows now. */
export interface NoteListState {
  /** `unavailable` for a record missing, trashed or hidden. */
  readonly status: 'loading' | 'ready' | 'error' | 'unavailable';
  readonly source: {
    readonly count: number;
    readonly getItem: (index: number) => NoteSummary | undefined;
    readonly getKey: (note: NoteSummary) => string;
    readonly onRangeChange: (range: { readonly start: number; readonly end: number }) => void;
  };
  /** How many notes the record has (counted up to 10,000, `atLeast` past it), once the first page is in. */
  readonly total?: TaskTotal;
  readonly error?: DataError;
}

/** One record's notes, as a screen holds them. */
export interface NoteList {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => NoteListState;
  /** Holds the list (and listens to the workspace) while a screen shows it; the answer lets go. */
  readonly retain: () => () => void;
  /** Settles once the first page is in (or failed). */
  readonly ready: () => Promise<void>;
  /** Reads it again from the top (Try again). */
  readonly retry: () => void;
}

/** Where a session's saving stands. */
export type NoteSaveState = 'idle' | 'saving' | 'saved' | 'retrying' | 'failed';

/** A notice the window shows above the editor (AC-443). */
export interface NoteNotice {
  /** `theirs`: their version shows now; `overwrote`: yours was saved over theirs. */
  readonly kind: 'theirs' | 'overwrote';
  readonly by: Actor;
}

/** What the note window shows now. */
export interface NoteSessionState {
  /** `missing`: it doesn't exist, was deleted, or the reader can't see it. */
  readonly status: 'loading' | 'ready' | 'missing' | 'error';
  readonly noteId: string;
  /** The note's own record (the page's, for a new note), which decides who may see it. */
  readonly recordId: string;
  /** Its own record as a chip shows it, once read. */
  readonly record?: RecordRefDisplay;
  /** The other records it links that the reader may see, in link order (migration 0136). */
  readonly links: readonly RecordRefDisplay[];
  /** Not stored yet (a new note with nothing in it). */
  readonly isNew: boolean;
  readonly title: string;
  /** The body to start the editor from; undefined for an empty new note. */
  readonly doc?: unknown;
  /** Changes when the body was replaced from outside (someone else's save): the window remounts the editor. */
  readonly docKey: number;
  /** Whether the reader may change it (false: read only). */
  readonly canChange: boolean;
  readonly saveState: NoteSaveState;
  /** Why the last save was refused, for a danger Callout; the text stays. */
  readonly refusal?: DataError;
  /** The body is over 200 KB: nothing is sent until it is shorter. */
  readonly isTooLong: boolean;
  /** The note went away under the window (deleted, its record trashed, or access lost). */
  readonly isUnavailable: boolean;
  readonly notice?: NoteNotice;
  /** The last read's failure, for the window's error state. */
  readonly error?: DataError;
  /** When it was last saved, by anyone (the window's "Edited 3 hours ago"); undefined until it is stored. */
  readonly updatedAt?: string;
}

/** One open note, as the note window holds it. */
export interface NoteSession {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => NoteSessionState;
  /** Holds the session while the window shows it; the answer lets go (a pending save still finishes). */
  readonly retain: () => () => void;
  readonly setTitle: (title: string) => void;
  /**
   * The editor's `onChange`, already debounced by the editor itself, so it
   * saves at once (one save out at a time). `fromDocKey` is the `docKey` the
   * editor was made for: text from an editor someone else's version replaced
   * is dropped.
   */
  readonly setDoc: (doc: unknown, fromDocKey?: number) => void;
  /** Saves now what is unsaved (the window closing, or Retry). */
  readonly flush: () => void;
  /** Tries a failed save again, or reads a failed note again. */
  readonly retry: () => void;
  readonly dismissNotice: () => void;
  /**
   * Links records to the note and unlinks others, shown at once; a refusal
   * puts them back and is answered, for the field to show (migration 0136).
   */
  readonly setLinks: (change: {
    readonly add?: readonly RecordRefDisplay[];
    readonly remove?: readonly string[];
  }) => Promise<DataError | undefined>;
}

/** A call or meeting as the Log activity dialog holds it. */
export interface ActivityDraft {
  readonly kind: Exclude<NoteKind, 'note'>;
  /** When it happened, ISO 8601 in UTC. */
  readonly occurredAt: string;
  /** Minutes, 1 to 1,440; absent for none. */
  readonly durationMinutes?: number;
  readonly outcome?: NoteOutcome;
  /** The notes, a rich text document; absent when nothing was written (or, on an edit, left as it was). */
  readonly doc?: unknown;
}

/** What saving an activity answered. */
export interface ActivityResult {
  /** The stored note, once the save landed. */
  readonly note?: NoteSummary;
  /** The save was refused or failed: nothing was stored, and the dialog stays open on it. */
  readonly failure?: DataError;
  /** The note is stored, but its links were not changed. */
  readonly linkFailure?: DataError;
  /** An edit started from an older version: whose save it replaced. */
  readonly overwrote?: SaveNoteResult['overwrote'];
}

const defaultLater = (work: () => void, ms: number) => {
  const timer = setTimeout(work, ms);
  return () => {
    clearTimeout(timer);
  };
};

/** Whether a title and a body hold anything worth storing. */
const hasText = (title: string, doc: unknown) =>
  title.trim() !== '' || (doc !== undefined && richTextToPlain(doc).trim() !== '');

/** The notes store: every workspace's note lists and open notes. */
/** The workspace's Notes page's list, in the place of a record id (record ids are uuids). */
const EVERY_RECORD = '';

export function createNotesStore(deps: NotesDeps) {
  const later = deps.later ?? defaultLater;
  const now = deps.now ?? Date.now;
  const lists = new Map<string, ReturnType<typeof makeList>>();
  const sessions = new Map<string, ReturnType<typeof makeSession>>();
  // A function the app gives, to open a note window again (a failed save's toast).
  let opener: ((workspace: string, objectId: string, recordId: string, noteId: string) => void) | undefined;
  let unsavedSaid = false;

  const keyOf = (workspace: string, id: string) => `${workspace}\u0000${id}`;
  const listsOf = (workspace: string) => [...lists.values()].filter((list) => list.workspace === workspace);
  const sessionsOf = (workspace: string) => [...sessions.values()].filter((each) => each.workspace === workspace);

  /** Tells the app whether any note has changes not yet saved. */
  const sayUnsaved = () => {
    const has = [...sessions.values()].some((each) => each.hasUnsaved());
    if (has === unsavedSaid) return;
    unsavedSaid = has;
    deps.onUnsaved?.(has);
  };

  // The object of each record whose notes were opened (its record page names it), so a coarse change to another
  // object's records leaves its list and windows alone.
  const recordObjects = new Map<string, string>();
  /** Whether a coarse change to `objectId`'s records may touch this record: its object, or one unknown here. */
  const mayBeOf = (workspace: string, recordId: string, objectId: string): boolean => {
    const known = recordObjects.get(keyOf(workspace, recordId));
    return known === undefined || known === objectId;
  };

  /** Every loaded list of this record (and the Notes page's) reads its pages again soon. */
  const dirtyRecord = (workspace: string, recordId: string) => {
    for (const list of listsOf(workspace))
      if (list.recordId === recordId || list.recordId === EVERY_RECORD) list.dirty();
  };
  /** The record's own lists take the note at once; the Notes page's reads again (its rows carry the record's chip). */
  const putNote = (workspace: string, recordId: string, note: NoteSummary) => {
    for (const list of listsOf(workspace)) {
      if (list.recordId === recordId) list.put(note);
      else if (list.recordId === EVERY_RECORD) list.dirty();
    }
  };
  /** The record's lists, the Notes page's among them, as the API asks for them. */
  const scopeOf = (recordId: string) => (recordId === EVERY_RECORD ? {} : { recordId });

  function makeList(workspace: string, recordId: string) {
    let items: NoteSummary[] = [];
    let cursor: string | undefined;
    let total: TaskTotal | undefined;
    let state: NoteListState['status'] = 'loading';
    let error: DataError | undefined;
    let first: Promise<void> | undefined;
    let retained = 0;
    let release: (() => void) | undefined;
    let cancelUnused: (() => void) | undefined;
    let cancelReread: (() => void) | undefined;
    let lastRead = 0;
    let stale = false;
    let loadingMore = false;
    let turn = 0;
    const listeners = new Set<() => void>();

    const source = (): NoteListState['source'] => {
      const shown = items;
      const count =
        cursor === undefined
          ? shown.length
          : Math.max(shown.length + 1, Math.min(total?.count ?? 0, shown.length + NOTE_PAGE));
      return {
        count,
        getItem: (index) => shown[index],
        getKey: (note) => note.id,
        onRangeChange: (range) => {
          if (range.end >= shown.length && cursor !== undefined) void more();
        },
      };
    };
    let snapshot: NoteListState = { status: state, source: source() };
    const announce = () => {
      snapshot = {
        status: state,
        source: source(),
        ...(total === undefined ? {} : { total }),
        ...(error === undefined ? {} : { error }),
      };
      for (const listener of listeners) listener();
    };

    /** Reads the first `upTo` notes again: the list's truth from the top. */
    // One reread out at a time: one asked for meanwhile runs when it lands, so a busy note never starves the list.
    let reading: Promise<void> | undefined;
    let readAgain = false;
    const rereadTop = () => {
      if (reading !== undefined) {
        readAgain = true;
        return;
      }
      reading = readTop(Math.max(Math.min(items.length, NOTE_PAGE_MAX), NOTE_PAGE)).finally(() => {
        reading = undefined;
        if (readAgain) {
          readAgain = false;
          rereadTop();
        }
      });
    };
    const readTop = (upTo: number): Promise<void> => {
      turn += 1;
      const mine = turn;
      lastRead = now();
      const run = async () => {
        const read: NoteSummary[] = [];
        let next: string | undefined;
        let counted: TaskTotal | undefined;
        do {
          const page = await deps.api.list({
            workspace,
            ...scopeOf(recordId),
            limit: Math.min(NOTE_PAGE_MAX, Math.max(NOTE_PAGE, upTo - read.length)),
            ...(next === undefined ? {} : { cursor: next }),
          });
          if (mine !== turn) return;
          read.push(...page.items);
          counted ??= page.total;
          next = page.nextCursor;
        } while (next !== undefined && read.length < upTo);
        items = read;
        cursor = next;
        total = counted ?? total;
        state = 'ready';
        error = undefined;
        announce();
      };
      return run().catch((failed: unknown) => {
        if (mine !== turn) return;
        const failure = toDataError(failed);
        if (failure.code === 'NOT_FOUND') {
          state = 'unavailable';
          items = [];
          cursor = undefined;
        } else if (state !== 'ready') {
          state = 'error';
        }
        error = failure;
        announce();
      });
    };

    const more = async (): Promise<void> => {
      if (cursor === undefined || loadingMore || state !== 'ready') return;
      loadingMore = true;
      const mine = turn;
      try {
        const page = await deps.api.list({ workspace, ...scopeOf(recordId), cursor });
        if (mine !== turn) return;
        const have = new Set(items.map((note) => note.id));
        items = [...items, ...page.items.filter((note) => !have.has(note.id))];
        cursor = page.nextCursor;
        announce();
      } catch {
        // The next scroll asks again.
      } finally {
        loadingMore = false;
      }
    };

    const list = {
      workspace,
      recordId,
      announce,
      /** A save landed here or elsewhere: the list reads again, at most twice a second, only while shown. */
      dirty() {
        if (first === undefined) return;
        if (retained === 0) {
          stale = true;
          return;
        }
        if (cancelReread !== undefined) return;
        const wait = Math.max(0, lastRead + LIST_REREAD_MS - now());
        cancelReread = later(() => {
          cancelReread = undefined;
          rereadTop();
        }, wait);
      },
      /** This tab's own save: the summary takes its place at the top at once (last edited first). */
      put(note: NoteSummary) {
        if (state !== 'ready') return;
        const was = items.some((each) => each.id === note.id);
        items = [note, ...items.filter((each) => each.id !== note.id)];
        if (!was && total !== undefined) total = { ...total, count: total.count + 1 };
        announce();
      },
      /** A note gone (deleted here): out of the list at once. */
      forget(noteId: string) {
        if (!items.some((each) => each.id === noteId)) return;
        items = items.filter((each) => each.id !== noteId);
        if (total !== undefined) total = { ...total, count: Math.max(0, total.count - 1) };
        announce();
      },
      api: {
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => snapshot,
        retain() {
          retained += 1;
          cancelUnused?.();
          cancelUnused = undefined;
          if (retained === 1) {
            release = deps.watch(workspace);
            if (first === undefined) first = readTop(NOTE_PAGE);
            else if (stale) {
              stale = false;
              void readTop(Math.max(items.length, NOTE_PAGE));
            }
          }
          let released = false;
          return () => {
            if (released) return;
            released = true;
            retained -= 1;
            if (retained > 0) return;
            release?.();
            release = undefined;
            cancelUnused = later(() => {
              items = [];
              cursor = undefined;
              stale = true;
              announce();
            }, UNUSED_MS);
          };
        },
        ready: () => (first ??= readTop(NOTE_PAGE)),
        retry: () => {
          state = items.length === 0 ? 'loading' : state;
          announce();
          first = readTop(Math.max(items.length, NOTE_PAGE));
        },
      } satisfies NoteList,
    };
    return list;
  }

  function makeSession(
    workspace: string,
    noteId: string,
    recordId: string,
    objectId: string,
    isNewNote: boolean,
    canChange: boolean,
  ) {
    let status: NoteSessionState['status'] = isNewNote ? 'ready' : 'loading';
    // The note's own record: the page's until a read says otherwise (a note opened from a record it links).
    let homeId = recordId;
    let home: RecordRefDisplay | undefined;
    let links: readonly RecordRefDisplay[] = [];
    let isNew = isNewNote;
    let title = '';
    let doc: unknown;
    let docKey = 0;
    let may = canChange;
    let version: number | null = null;
    let saveState: NoteSaveState = 'idle';
    let refusal: DataError | undefined;
    let isTooLong = false;
    let isUnavailable = false;
    let notice: NoteNotice | undefined;
    let error: DataError | undefined;
    let updatedAt: string | undefined;
    // What changed since the last save went out: sent next.
    let pending: { title?: string; doc?: unknown } = {};
    // What was unsaved when a delete from this tab went out: sent after all if the delete is refused.
    let heldBack: { title?: string; doc?: unknown } = {};
    let firstPendingAt: number | undefined;
    let cancelDebounce: (() => void) | undefined;
    let cancelMax: (() => void) | undefined;
    let cancelRetry: (() => void) | undefined;
    let inFlight = false;
    let tries = 0;
    let retained = 0;
    let release: (() => void) | undefined;
    let closed = false;
    // Deleted from this tab: a save of it failing afterwards stays quiet.
    let deletedHere = false;
    const listeners = new Set<() => void>();

    const current = (): NoteSessionState => ({
      status,
      noteId,
      recordId: homeId,
      ...(home === undefined ? {} : { record: home }),
      links,
      isNew,
      title,
      ...(doc === undefined ? {} : { doc }),
      docKey,
      canChange: may,
      saveState,
      ...(refusal === undefined ? {} : { refusal }),
      isTooLong,
      isUnavailable,
      ...(notice === undefined ? {} : { notice }),
      ...(error === undefined ? {} : { error }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
    });
    let snapshot = current();
    const announce = () => {
      snapshot = current();
      for (const listener of listeners) listener();
      sayUnsaved();
    };

    const hasPending = () => pending.title !== undefined || pending.doc !== undefined;
    const clearTimers = () => {
      cancelDebounce?.();
      cancelDebounce = undefined;
      cancelMax?.();
      cancelMax = undefined;
    };

    /** Lets the session go once nothing holds it and nothing is left to save. */
    const maybeEnd = () => {
      if (retained > 0 || inFlight || hasPending()) return;
      const key = keyOf(workspace, noteId);
      if (sessions.get(key) === session) sessions.delete(key);
      sayUnsaved();
    };

    /** Reads the note (opening it, or someone else saved it), replacing the body when nothing is unsaved here. */
    // One read out at a time per session: events arriving meanwhile ask for one more read when it lands.
    let readOut = false;
    let readNext = false;
    const read = (fromEvent: boolean) => {
      if (readOut) {
        readNext = true;
        return;
      }
      readOut = true;
      const done = () => {
        readOut = false;
        if (readNext) {
          readNext = false;
          read(true);
        }
      };
      deps.api.get({ workspace, noteId }).then(
        (note) => {
          done();
          if (fromEvent && (hasPending() || inFlight)) return;
          const newer = version === null || note.version > version;
          if (!newer) return;
          const replaced = fromEvent && version !== null;
          // The editor starts again only when the body changed (their edit may have been the title alone).
          const bodyChanged = JSON.stringify(note.content) !== JSON.stringify(doc);
          version = note.version;
          title = note.title;
          doc = note.content;
          may = note.canChange;
          homeId = note.recordId;
          home = note.record;
          links = note.links;
          updatedAt = note.updatedAt;
          isNew = false;
          status = 'ready';
          error = undefined;
          if (replaced) {
            if (bodyChanged) docKey += 1;
            notice = { kind: 'theirs', by: note.updatedBy };
          }
          announce();
        },
        (failed: unknown) => {
          done();
          const failure = toDataError(failed);
          if (failure.code === 'NOT_FOUND') {
            if (status === 'ready') isUnavailable = true;
            else status = 'missing';
          } else if (!fromEvent) {
            status = 'error';
            error = failure;
          }
          announce();
        },
      );
    };

    /** Sends what is unsaved, unless a save is out (the latest state goes once it lands). */
    const fire = () => {
      clearTimers();
      // A new note with no text yet (spaces, or text typed and deleted) holds nothing to save (AC-439).
      if (isNew && !hasText(title, doc)) {
        pending = {};
        firstPendingAt = undefined;
        sayUnsaved();
        maybeEnd();
        return;
      }
      if (inFlight || !hasPending() || isUnavailable) return;
      cancelRetry?.();
      cancelRetry = undefined;
      const sent = { ...pending };
      if (sent.doc !== undefined && noteBytes(sent.doc) > NOTE_CONTENT_MAX_BYTES) {
        isTooLong = true;
        refusal = dataError('CONFIG_INVALID', NOTE_TOO_LONG);
        saveState = 'failed';
        announce();
        return;
      }
      isTooLong = false;
      inFlight = true;
      // The next change starts its own 2 second most wait from here.
      firstPendingAt = undefined;
      saveState = tries === 0 ? 'saving' : 'retrying';
      announce();
      const mutationId = deps.mintId();
      deps.mutations.sent(mutationId);
      deps.api
        .save({
          workspace,
          id: noteId,
          recordId: homeId,
          mutationId,
          baseVersion: version,
          ...(sent.title === undefined ? {} : { title: sent.title }),
          ...(sent.doc === undefined ? {} : { content: sent.doc }),
        })
        .then(
          (answer) => {
            deps.mutations.answered(mutationId, 1);
            inFlight = false;
            tries = 0;
            version = answer.note.version;
            updatedAt = answer.note.updatedAt;
            isNew = false;
            may = answer.note.canChange;
            refusal = undefined;
            // What was sent is saved; anything typed since stays pending.
            if (pending.title === sent.title) delete pending.title;
            if (pending.doc === sent.doc) delete pending.doc;
            if (answer.overwrote !== undefined) notice = { kind: 'overwrote', by: answer.overwrote.by };
            saveState = hasPending() ? 'saving' : 'saved';
            // Its own record's lists and each linked record's take the new summary.
            const shownOn = [homeId, ...links.map((link) => link.recordId)];
            for (const each of shownOn) putNote(workspace, each, answer.note);
            deps.timelines(workspace, shownOn);
            announce();
            // Anything typed meanwhile waits its own turn (300 ms, at most 2 s), never straight after this save.
            if (hasPending()) schedule();
            else maybeEnd();
          },
          (failed: unknown) => {
            deps.mutations.forget(mutationId);
            inFlight = false;
            const failure = toDataError(failed);
            if (PASSING.has(failure.code)) {
              const wait = NOTE_RETRY_SECONDS[tries];
              if (wait !== undefined) {
                tries += 1;
                saveState = 'retrying';
                cancelRetry = later(fire, wait * 1000);
                announce();
                return;
              }
              tries = 0;
              saveState = 'failed';
              refusal = undefined;
            } else {
              tries = 0;
              saveState = 'failed';
              refusal = failure;
              isTooLong = failure.code === 'CONFIG_INVALID' && failure.message === NOTE_TOO_LONG;
              if (failure.code === 'NOT_FOUND') isUnavailable = true;
            }
            announce();
            // A note deleted from this tab meanwhile says nothing more: its delete was the person's last word.
            if (closed && retained === 0 && !deletedHere) {
              // The window is gone: a toast offers it again, with the text this session still holds.
              deps.notify({
                tone: 'danger',
                message: NOTE_WORDS.notSaved,
                action: {
                  label: NOTE_WORDS.openNote,
                  onAction: () => {
                    opener?.(workspace, objectId, homeId, noteId);
                  },
                },
              });
            }
          },
        );
    };

    /**
     * Sets the save's timers: 300 ms after the last change (at once for the
     * body, which the editor already waited 300 ms for), at most 2 seconds
     * after the first unsaved change.
     */
    const schedule = (delay: number = NOTE_SAVE_DELAY_MS) => {
      const at = now();
      firstPendingAt ??= at;
      cancelDebounce?.();
      cancelDebounce = later(fire, delay);
      if (cancelMax === undefined) {
        cancelMax = later(fire, Math.max(0, firstPendingAt + NOTE_SAVE_MAX_WAIT_MS - at));
      }
    };

    /** A change typed: the title saved 300 ms after typing stops, the body when the editor hands it over. */
    const changed = (delay: number = NOTE_SAVE_DELAY_MS) => {
      notice = notice?.kind === 'overwrote' ? undefined : notice;
      if (isNew && !hasText(title, doc)) {
        // Nothing stored until there is text (AC-439), and nothing held as unsaved either.
        pending = {};
        announce();
        return;
      }
      schedule(delay);
      if (saveState === 'saved' || saveState === 'idle') saveState = 'saving';
      announce();
    };
    const session = {
      workspace,
      noteId,
      /** Every record it shows on: its own and the ones it links (a trash of any of them reads it again). */
      shownOn: () => new Set([homeId, ...links.map((link) => link.recordId)]),
      hasUnsaved: () => (hasPending() && !(isNew && !hasText(title, doc))) || inFlight,
      /** A live event named this note: someone else saved it, or it went away. */
      changedElsewhere() {
        if (status === 'loading' || isNew) return;
        read(true);
      },
      /** Its record was trashed or restored: read again, which says unavailable when it is gone. */
      recordChanged() {
        if (isNew) return;
        read(true);
      },
      /** Deleted from this tab: unavailable at once, nothing more is sent. */
      gone() {
        deletedHere = true;
        clearTimers();
        cancelRetry?.();
        heldBack = { ...heldBack, ...pending };
        pending = {};
        isUnavailable = true;
        announce();
        maybeEnd();
      },
      /** The delete from this tab was refused: the note is back as it was, and anything unsaved goes after all. */
      kept() {
        if (!deletedHere) return;
        deletedHere = false;
        isUnavailable = false;
        pending = { ...heldBack, ...pending };
        heldBack = {};
        announce();
        if (hasPending()) schedule();
      },
      api: {
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => snapshot,
        retain() {
          retained += 1;
          closed = false;
          const key = keyOf(workspace, noteId);
          if (sessions.get(key) !== session) sessions.set(key, session);
          if (retained === 1) release = deps.watch(workspace);
          let released = false;
          return () => {
            if (released) return;
            released = true;
            retained -= 1;
            if (retained > 0) return;
            release?.();
            release = undefined;
            closed = true;
            // Closing with a save pending lets it finish now (AC-440).
            if (hasPending() && !isTooLong && saveState !== 'failed') fire();
            maybeEnd();
          };
        },
        setTitle(next: string) {
          if (!may || isUnavailable) return;
          title = next;
          pending = { ...pending, title: next };
          changed();
        },
        setDoc(next: unknown, fromDocKey?: number) {
          // An editor that was replaced (someone else's version came in) hands over its last text as it goes:
          // that text is older than what shows now, so it is dropped rather than saved over theirs.
          if (!may || isUnavailable || (fromDocKey !== undefined && fromDocKey !== docKey)) return;
          doc = next;
          pending = { ...pending, doc: next };
          changed(0);
        },
        flush: fire,
        retry() {
          if (status === 'error') {
            status = 'loading';
            announce();
            read(false);
            return;
          }
          tries = 0;
          refusal = undefined;
          fire();
        },
        dismissNotice() {
          notice = undefined;
          announce();
        },
        async setLinks(change) {
          const removed = new Set(change.remove ?? []);
          const held = new Set(links.map((link) => link.recordId));
          const added = (change.add ?? []).filter((link) => !held.has(link.recordId) && link.recordId !== homeId);
          const before = links;
          const touched = [
            ...added.map((link) => link.recordId),
            ...before.flatMap((link) => (removed.has(link.recordId) ? [link.recordId] : [])),
          ];
          if (touched.length === 0) return undefined;
          links = [...before.filter((link) => !removed.has(link.recordId)), ...added];
          announce();
          const mutationId = deps.mintId();
          deps.mutations.sent(mutationId);
          try {
            const answer = await deps.api.link({
              workspace,
              noteId,
              mutationId,
              ...(added.length === 0 ? {} : { addRecordIds: added.map((link) => link.recordId) }),
              ...(removed.size === 0 ? {} : { removeRecordIds: [...removed] }),
            });
            deps.mutations.answered(mutationId, 1);
            links = answer.links;
            announce();
            for (const each of touched) dirtyRecord(workspace, each);
            deps.timelines(workspace, touched);
            return undefined;
          } catch (failed) {
            deps.mutations.forget(mutationId);
            links = before;
            announce();
            return toDataError(failed);
          }
        },
      } satisfies NoteSession,
    };
    if (!isNewNote) read(false);
    return session;
  }

  /**
   * One save of a call or meeting, then its link changes, waiting for the server. The save is an upsert by the id
   * the dialog minted, so a retry after a lost answer stores nothing twice. Once it lands, every list of every
   * record it is on takes it (and reads again, for its place by when it happened) and their timelines read.
   */
  async function saveActivity(
    workspace: string,
    input: {
      readonly noteId: string;
      readonly recordId: string;
      readonly draft: ActivityDraft;
      /** An edit: the version it started from; absent for a new one. */
      readonly baseVersion?: number;
      readonly add: readonly RecordRefDisplay[];
      readonly remove: readonly string[];
    },
  ): Promise<ActivityResult> {
    const { draft } = input;
    const isEdit = input.baseVersion !== undefined;
    if (draft.doc !== undefined && noteBytes(draft.doc) > NOTE_CONTENT_MAX_BYTES) {
      return { failure: dataError('CONFIG_INVALID', NOTE_TOO_LONG) };
    }
    const mutationId = deps.mintId();
    deps.mutations.sent(mutationId);
    let answer: SaveNoteResult;
    try {
      answer = await deps.api.save({
        workspace,
        id: input.noteId,
        recordId: input.recordId,
        mutationId,
        kind: draft.kind,
        occurredAt: draft.occurredAt,
        // An edit clears a duration or outcome the dialog no longer holds; a new one just has none.
        ...(draft.durationMinutes === undefined
          ? isEdit
            ? { durationMinutes: null }
            : {}
          : { durationMinutes: draft.durationMinutes }),
        ...(draft.outcome === undefined ? (isEdit ? { outcome: null } : {}) : { outcome: draft.outcome }),
        ...(draft.doc === undefined ? {} : { content: draft.doc }),
        ...(input.baseVersion === undefined ? {} : { baseVersion: input.baseVersion }),
      });
      deps.mutations.answered(mutationId, 1);
    } catch (failed) {
      deps.mutations.forget(mutationId);
      return { failure: toDataError(failed) };
    }
    let linkFailure: DataError | undefined;
    if (input.add.length > 0 || input.remove.length > 0) {
      const linkId = deps.mintId();
      deps.mutations.sent(linkId);
      try {
        await deps.api.link({
          workspace,
          noteId: input.noteId,
          mutationId: linkId,
          ...(input.add.length === 0 ? {} : { addRecordIds: input.add.map((link) => link.recordId) }),
          ...(input.remove.length === 0 ? {} : { removeRecordIds: input.remove }),
        });
        deps.mutations.answered(linkId, 1);
      } catch (failed) {
        deps.mutations.forget(linkId);
        linkFailure = toDataError(failed);
      }
    }
    const shownOn = [input.recordId, ...input.add.map((link) => link.recordId), ...input.remove];
    // A plain note's place is the top; a call or meeting's is where it happened, so its lists read again instead.
    // Records it was just unlinked from only read again.
    if (answer.note.kind === 'note') {
      for (const each of new Set([input.recordId, ...input.add.map((link) => link.recordId)])) {
        putNote(workspace, each, answer.note);
      }
    }
    for (const each of new Set(shownOn)) dirtyRecord(workspace, each);
    deps.timelines(workspace, [...new Set(shownOn)]);
    return {
      note: answer.note,
      ...(linkFailure === undefined ? {} : { linkFailure }),
      ...(answer.overwrote === undefined ? {} : { overwrote: answer.overwrote }),
    };
  }

  return {
    /**
     * Logs a call or meeting on a record (migration 0141): one save under the id the dialog minted, then the
     * records it also links. Waits for the server. A refusal comes back as `failure` with nothing stored.
     */
    logActivity: (
      workspace: string,
      input: {
        readonly noteId: string;
        readonly recordId: string;
        readonly draft: ActivityDraft;
        readonly links: readonly RecordRefDisplay[];
      },
    ): Promise<ActivityResult> =>
      saveActivity(workspace, {
        noteId: input.noteId,
        recordId: input.recordId,
        draft: input.draft,
        add: input.links,
        remove: [],
      }),
    /** Saves an edit of a logged call or meeting from the version the dialog read, and its link changes. */
    updateActivity: (
      workspace: string,
      input: {
        readonly noteId: string;
        readonly recordId: string;
        readonly baseVersion: number;
        readonly draft: ActivityDraft;
        readonly add: readonly RecordRefDisplay[];
        readonly remove: readonly string[];
      },
    ): Promise<ActivityResult> => saveActivity(workspace, input),
    /** One note with its body, for the Log activity dialog's edit. Rejects with a DataError. */
    async read(workspace: string, noteId: string): Promise<Note> {
      try {
        return await deps.api.get({ workspace, noteId });
      } catch (failed) {
        throw toDataError(failed);
      }
    },
    /**
     * A record's notes, last edited first, the same list for every screen that
     * asks. `objectId` names the record's object, so a background job's changes
     * to another object's records leave the list (and its windows) alone.
     */
    /**
     * The workspace's Notes page: every note the person may see, last edited
     * first, each with its record's chip; live as a record's list is (any
     * notes event, and a record trashed or restored, reads it again).
     */
    forWorkspace(workspace: string): NoteList {
      const key = keyOf(workspace, EVERY_RECORD);
      const found = lists.get(key);
      if (found !== undefined) return found.api;
      const made = makeList(workspace, EVERY_RECORD);
      lists.set(key, made);
      return made.api;
    },
    forRecord(workspace: string, recordId: string, objectId?: string): NoteList {
      const key = keyOf(workspace, recordId);
      if (objectId !== undefined) recordObjects.set(key, objectId);
      const found = lists.get(key);
      if (found !== undefined) return found.api;
      const made = makeList(workspace, recordId);
      lists.set(key, made);
      return made.api;
    },
    /**
     * The note window's session: an existing note by id, or a new one with
     * the id the window minted (`isNew`), which stores nothing until it holds
     * text. The same session while anything holds it.
     */
    open(
      workspace: string,
      input: {
        readonly noteId: string;
        readonly recordId: string;
        /** The record's object, for the "Open note" link a failed save's toast offers. */
        readonly objectId: string;
        readonly isNew: boolean;
        readonly canChange: boolean;
      },
    ): NoteSession {
      const key = keyOf(workspace, input.noteId);
      const found = sessions.get(key);
      if (found !== undefined) return found.api;
      const made = makeSession(workspace, input.noteId, input.recordId, input.objectId, input.isNew, input.canChange);
      sessions.set(key, made);
      return made.api;
    },
    /** A new note's id: minted once when the window opens, and its first save's retry key. */
    newId: () => deps.mintId(),
    /** Whether any note has changes not yet saved (the page's "Leave site?"). */
    hasUnsaved: () => [...sessions.values()].some((each) => each.hasUnsaved()),
    /** The app's way to open a note window again, for a failed save's toast. */
    setOpener(open: (workspace: string, objectId: string, recordId: string, noteId: string) => void) {
      opener = open;
    },
    /**
     * Deletes a note (AC-445): out of every list and its window at once; the
     * answer says whether it landed (a refusal puts it back in its lists, and
     * its open window shows it again, with anything unsaved sent after all).
     */
    async remove(workspace: string, recordId: string, noteId: string): Promise<DataError | undefined> {
      // Out of every list that shows it: its own record's, each linked record's, and the Notes page's.
      for (const list of listsOf(workspace)) list.forget(noteId);
      const shownOn = sessions.get(keyOf(workspace, noteId))?.shownOn() ?? new Set([recordId]);
      sessions.get(keyOf(workspace, noteId))?.gone();
      const mutationId = deps.mintId();
      deps.mutations.sent(mutationId);
      try {
        await deps.api.delete({ workspace, noteId, mutationId });
        deps.mutations.answered(mutationId, 1);
        deps.timelines(workspace, [...shownOn]);
        return undefined;
      } catch (failed) {
        deps.mutations.forget(mutationId);
        for (const each of shownOn) dirtyRecord(workspace, each);
        sessions.get(keyOf(workspace, noteId))?.kept();
        return toDataError(failed);
      }
    },
    /** Brings a deleted note back (Undo): into its lists again. Answers the refusal, if any. */
    async restore(workspace: string, recordId: string, noteId: string): Promise<DataError | undefined> {
      const mutationId = deps.mintId();
      deps.mutations.sent(mutationId);
      try {
        const note = await deps.api.restore({ workspace, noteId, mutationId });
        deps.mutations.answered(mutationId, 1);
        sessions.delete(keyOf(workspace, noteId));
        putNote(workspace, recordId, note);
        // Every loaded list reads again: the lists of the records it links take it back too.
        for (const list of listsOf(workspace)) list.dirty();
        deps.timelines(workspace, 'all');
        return undefined;
      } catch (failed) {
        deps.mutations.forget(mutationId);
        return toDataError(failed);
      }
    },
    /**
     * A live `notes` event: every loaded list of a record it names reads again
     * (at most twice a second), and each open session of a note it names reads
     * it (someone else's save, or it went away). A coarse one does both for
     * everything held of the workspace.
     */
    changed(workspace: string, event: Extract<ChangeEvent, { kind: 'notes' }>) {
      const coarse = event.coarse === true;
      const records = new Set(event.recordIds);
      const notes = new Set(event.noteIds);
      for (const list of listsOf(workspace)) {
        if (coarse || records.has(list.recordId) || list.recordId === EVERY_RECORD) list.dirty();
      }
      for (const each of sessionsOf(workspace)) if (coarse || notes.has(each.noteId)) each.changedElsewhere();
      deps.timelines(workspace, coarse ? 'all' : event.recordIds);
    },
    /**
     * A live `records` event naming records trashed or restored: their notes
     * go or come back (AC-446). A coarse one (a background job's, paced)
     * touches only the lists and windows of its object's records (or of a
     * record whose object isn't known here).
     */
    recordsChanged(workspace: string, event: Extract<ChangeEvent, { kind: 'records' }>) {
      const lifecycle = new Set([...(event.deletedIds ?? []), ...(event.restoredIds ?? [])]);
      const coarse = event.coarse === true;
      if (!coarse && lifecycle.size === 0) return;
      const touches = (recordId: string) =>
        coarse ? mayBeOf(workspace, recordId, event.objectId) : lifecycle.has(recordId);
      for (const list of listsOf(workspace)) if (list.recordId === EVERY_RECORD || touches(list.recordId)) list.dirty();
      for (const each of sessionsOf(workspace)) if ([...each.shownOn()].some(touches)) each.recordChanged();
    },
    /** Everything held of the workspace is read again (a resync after a gap the outbox no longer covers). */
    resync(workspace: string) {
      for (const list of listsOf(workspace)) list.dirty();
      for (const each of sessionsOf(workspace)) each.changedElsewhere();
    },
    /** Forgets everything: the session ended. */
    clear() {
      recordObjects.clear();
      lists.clear();
      sessions.clear();
      sayUnsaved();
    },
  };
}

/** The notes store. */
export type NotesStore = ReturnType<typeof createNotesStore>;
