// `data.files` (#32), loaded lazily with the first Files tab: a record's files
// as screens see them. One held entry per workspace and record: its files
// newest first, the ones this tab is sending (with their progress, or why they
// were refused), and whether the reader may add or delete. A delete shows at
// once, and so does its Undo; a refusal puts the file back with a toast that
// says why. Live: a `files` event naming a held record reads it again (this
// tab's own echo is skipped by the router; one read at a time per record, and
// one more when something changed meanwhile, so a slow read never undoes this
// tab's own write), a coarse one and a resync every held record of the
// workspace, spread over up to 2 seconds; a record nobody shows reads when it
// is shown again. A record let go of, or one a loader opened (a hover's
// preload) and nobody showed, goes after 30 seconds.
import type { ChangeEvent, RecordFiles, RecordFileView } from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import type { MutationLog } from '../live/mutations.ts';
import type { Notice } from '../notice.ts';

/** The longest spread before a coarse event's reread, in ms. */
const SPREAD_MS = 2_000;

/** How long a record nobody shows keeps its files. */
const UNUSED_MS = 30_000;

/** The words the store raises itself. */
export const FILE_WORDS = {
  deleteFailed: 'The file wasn’t deleted.',
  restoreFailed: 'The file couldn’t be brought back.',
  uploadFailed: 'That file wasn’t added. Try again.',
  offline: 'You’re offline. Try again when you’re back.',
  tooMany: 'Too many files at once. Wait a moment and try again.',
} as const;

/** What sending one file answers: the file as stored, or the sentence that says why not. */
export type SendOutcome =
  { readonly ok: true; readonly file: RecordFileView } | { readonly ok: false; readonly message: string };

/** The calls the files store makes. */
export interface FilesApi {
  readonly list: (input: { readonly workspace: string; readonly recordId: string }) => Promise<RecordFiles>;
  readonly delete: (input: {
    readonly workspace: string;
    readonly fileId: string;
    readonly mutationId: string;
  }) => Promise<RecordFileView>;
  readonly restore: (input: {
    readonly workspace: string;
    readonly fileId: string;
    readonly mutationId: string;
  }) => Promise<RecordFileView>;
  /** Sends one file's bytes, reporting progress from 0 to 100; never rejects. */
  readonly send: (
    input: { readonly workspace: string; readonly recordId: string; readonly file: File; readonly mutationId: string },
    onProgress: (percent: number) => void,
  ) => Promise<SendOutcome>;
}

/** What the files store needs from the layer. */
export interface FilesDeps {
  readonly api: FilesApi;
  readonly mintId: () => string;
  readonly mutations: MutationLog;
  readonly notify: (notice: Notice) => void;
  /** Listens to a workspace's change events while a record's files are shown; the answer stops. */
  readonly watch: (workspace: string) => () => void;
  /** The timer, for tests. */
  readonly later?: (work: () => void, ms: number) => () => void;
  /** 0 to 1, for the coarse spread; tests pass their own. */
  readonly random?: () => number;
}

/** A file this tab is sending: its progress, or why it was refused (the row stays until dismissed). */
export interface SendingFile {
  readonly key: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
  readonly progress: number;
  readonly error?: string;
}

/** What a record's Files tab shows now. */
export interface FilesState {
  /** `unavailable` for a record missing or hidden. */
  readonly status: 'loading' | 'ready' | 'error' | 'unavailable';
  /** Stored files, newest first. */
  readonly files: readonly RecordFileView[];
  /** Files this tab is sending, oldest first. */
  readonly sending: readonly SendingFile[];
  readonly canChange: boolean;
  readonly error?: DataError;
}

/** One record's files, as a screen holds them. */
export interface RecordFilesSource {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => FilesState;
  /** Holds the files (and listens to the workspace) while a screen shows them; the answer lets go. */
  readonly retain: () => () => void;
  /** Reads it again (Try again). */
  readonly retry: () => void;
}

/** The files store. */
export interface FilesStore {
  readonly forRecord: (workspace: string, recordId: string) => RecordFilesSource;
  /** Sends files, each shown at once with its progress; a refused one stays with its reason until dismissed. */
  readonly upload: (workspace: string, recordId: string, files: readonly File[]) => Promise<void>;
  /** Takes a refused file's row away. */
  readonly dismiss: (workspace: string, recordId: string, key: string) => void;
  /** Deletes a file at once; answers whether it landed (a refusal puts it back with a toast). */
  readonly remove: (workspace: string, recordId: string, fileId: string) => Promise<boolean>;
  /** Brings a deleted file back (the toast's Undo), shown at once; answers whether it landed. */
  readonly restore: (workspace: string, recordId: string, file: RecordFileView) => Promise<boolean>;
  /** A live `files` event. */
  readonly changed: (workspace: string, event: Extract<ChangeEvent, { kind: 'files' }>) => void;
  /** Reads every held record of the workspace again. */
  readonly resync: (workspace: string) => void;
  /** Records trashed or restored: a held one reads again. */
  readonly records: (workspace: string, recordIds: readonly string[]) => void;
  readonly clear: () => void;
}

const defaultLater = (work: () => void, ms: number) => {
  const timer = setTimeout(work, ms);
  return () => {
    clearTimeout(timer);
  };
};

const EMPTY: FilesState = { status: 'loading', files: [], sending: [], canChange: false };

interface Held {
  readonly workspace: string;
  readonly recordId: string;
  readonly handle: RecordFilesSource;
  state: FilesState;
  holders: number;
  generation: number;
  /** A read is out; `dirty` asks for one more once it lands, so a write or an event during it is never lost. */
  reading: boolean;
  dirty: boolean;
  /** Something changed while nobody held it: read when held again. */
  stale: boolean;
  /** Files this tab deleted (or brought back) whose answer a read already out can't know: kept as this tab shows. */
  readonly removing: Set<string>;
  readonly adding: Map<string, RecordFileView>;
  stopWatch?: () => void;
  cancelDrop?: () => void;
  readonly listeners: Set<() => void>;
}

/** The stored files newest first, one per id. */
function ordered(files: readonly RecordFileView[]): readonly RecordFileView[] {
  const byId = new Map(files.map((file) => [file.fileId, file]));
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? a.fileId.localeCompare(b.fileId) : a.createdAt < b.createdAt ? 1 : -1,
  );
}

/** A refusal's toast: the store's own words, then the server's reason when it gave one. */
function refusalNotice(words: string, error: DataError): Notice {
  return { tone: 'danger', message: error.message === '' ? words : `${words} ${error.message}` };
}

/**
 * Sends one record file's bytes to `POST /api/records/:recordId/files` (#32) on `origin`: XMLHttpRequest, since
 * `fetch` reports no upload progress. Loaded with the store, never in the first load. Never rejects.
 */
export function createRecordFileSender(origin: string): FilesApi['send'] {
  return (input, onProgress) =>
    new Promise<SendOutcome>((resolve) => {
      const request = new XMLHttpRequest();
      const address = new URL(
        `/api/records/${encodeURIComponent(input.recordId)}/files?workspace=${encodeURIComponent(input.workspace)}`,
        origin,
      );
      request.open('POST', address.href);
      request.withCredentials = true;
      request.setRequestHeader('content-type', input.file.type === '' ? 'application/octet-stream' : input.file.type);
      request.setRequestHeader('x-file-name', encodeURIComponent(input.file.name));
      request.setRequestHeader('x-crm-mutation-id', input.mutationId);
      request.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      });
      request.addEventListener('load', () => {
        let answer: unknown;
        try {
          answer = JSON.parse(request.responseText);
        } catch {
          answer = undefined;
        }
        const body = typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>) : {};
        if (request.status === 201 && typeof body.fileId === 'string') {
          onProgress(100);
          resolve({ ok: true, file: body as unknown as RecordFileView });
          return;
        }
        if (request.status === 429) {
          resolve({ ok: false, message: FILE_WORDS.tooMany });
          return;
        }
        resolve({ ok: false, message: typeof body.message === 'string' ? body.message : FILE_WORDS.uploadFailed });
      });
      request.addEventListener('error', () => {
        resolve({ ok: false, message: FILE_WORDS.offline });
      });
      request.addEventListener('abort', () => {
        resolve({ ok: false, message: FILE_WORDS.uploadFailed });
      });
      request.send(input.file);
    });
}

/** A new files store. */
export function createFilesStore(deps: FilesDeps): FilesStore {
  const later = deps.later ?? defaultLater;
  const random = deps.random ?? Math.random;
  let held = new Map<string, Held>();
  const spreading = new Set<string>();

  const keyOf = (workspace: string, recordId: string) => `${workspace} ${recordId}`;
  const set = (entry: Held, state: FilesState) => {
    entry.state = state;
    for (const listener of entry.listeners) listener();
  };
  const isHeld = (entry: Held) => held.get(keyOf(entry.workspace, entry.recordId)) === entry;
  /** Drops an entry nobody holds `UNUSED_MS` from now: made by a loader (a hover's preload) or let go of. */
  const dropLater = (entry: Held) => {
    entry.cancelDrop?.();
    entry.cancelDrop = later(() => {
      entry.cancelDrop = undefined;
      if (entry.holders > 0 || !isHeld(entry)) return;
      entry.stopWatch?.();
      entry.stopWatch = undefined;
      held.delete(keyOf(entry.workspace, entry.recordId));
    }, UNUSED_MS);
  };

  /** Reads a record's files; one read at a time per record, and one more if anything changed while it was out. */
  const read = (entry: Held) => {
    if (entry.reading) {
      entry.dirty = true;
      return;
    }
    entry.reading = true;
    entry.dirty = false;
    entry.stale = false;
    entry.generation += 1;
    const generation = entry.generation;
    const settle = () => {
      entry.reading = false;
      if (entry.dirty) read(entry);
    };
    deps.api.list({ workspace: entry.workspace, recordId: entry.recordId }).then(
      (answer) => {
        if (entry.generation === generation && !entry.dirty) {
          const { error: _, ...state } = entry.state;
          const listed = answer.files.filter((file) => !entry.removing.has(file.fileId));
          set(entry, {
            ...state,
            status: 'ready',
            files: ordered([...listed, ...entry.adding.values()]),
            canChange: answer.canChange,
          });
          // A read sent after this tab's writes landed knows them: what it shows is the truth from here.
          entry.removing.clear();
          entry.adding.clear();
        }
        settle();
      },
      (thrown: unknown) => {
        if (entry.generation === generation && !entry.dirty) {
          const error = toDataError(thrown);
          if (error.code === 'NOT_FOUND') {
            set(entry, { ...EMPTY, status: 'unavailable', sending: entry.state.sending });
          } else if (entry.state.status !== 'ready') {
            // A failed reread keeps what is shown; only a first read shows the error.
            set(entry, { ...entry.state, status: 'error', error });
          }
        }
        settle();
      },
    );
  };

  const entryOf = (workspace: string, recordId: string): Held => {
    const key = keyOf(workspace, recordId);
    const found = held.get(key);
    if (found !== undefined) return found;
    const listeners = new Set<() => void>();
    const entry: Held = {
      workspace,
      recordId,
      state: EMPTY,
      holders: 0,
      generation: 0,
      reading: false,
      dirty: false,
      stale: false,
      removing: new Set(),
      adding: new Map(),
      listeners,
      handle: {
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => entry.state,
        retain: () => {
          // A handle whose entry was dropped (the router's cached loader data on Back) comes back to life.
          const revived = !isHeld(entry);
          if (revived) {
            const other = held.get(key);
            if (other === undefined) held.set(key, entry);
          }
          entry.holders += 1;
          entry.cancelDrop?.();
          entry.cancelDrop = undefined;
          entry.stopWatch ??= deps.watch(workspace);
          if (entry.holders === 1 && (entry.state.status !== 'ready' || revived || entry.stale)) read(entry);
          let released = false;
          return () => {
            if (released) return;
            released = true;
            entry.holders -= 1;
            if (entry.holders === 0) dropLater(entry);
          };
        },
        retry: () => {
          set(entry, { ...entry.state, status: 'loading' });
          read(entry);
        },
      },
    };
    held.set(key, entry);
    dropLater(entry);
    return entry;
  };

  const patchSending = (entry: Held, key: string, change: (file: SendingFile) => SendingFile | undefined) => {
    const sending = entry.state.sending.flatMap((file) => {
      if (file.key !== key) return [file];
      const next = change(file);
      return next === undefined ? [] : [next];
    });
    set(entry, { ...entry.state, sending });
  };

  const sendOne = async (entry: Held, key: string, file: File) => {
    const mutationId = deps.mintId();
    deps.mutations.sent(mutationId);
    const outcome = await deps.api.send(
      { workspace: entry.workspace, recordId: entry.recordId, file, mutationId },
      (progress) => {
        patchSending(entry, key, (shown) => ({ ...shown, progress }));
      },
    );
    if (!outcome.ok) {
      deps.mutations.forget(mutationId);
      patchSending(entry, key, (shown) => ({ ...shown, error: outcome.message }));
      return;
    }
    deps.mutations.answered(mutationId, 1);
    entry.adding.set(outcome.file.fileId, outcome.file);
    if (entry.reading) entry.dirty = true;
    set(entry, {
      ...entry.state,
      files: ordered([outcome.file, ...entry.state.files]),
      sending: entry.state.sending.filter((shown) => shown.key !== key),
    });
  };

  /** Deletes or brings back a file, shown at once either way; a refusal puts it back as it was. */
  const change = async (
    workspace: string,
    recordId: string,
    file: RecordFileView,
    deleting: boolean,
  ): Promise<boolean> => {
    const entry = entryOf(workspace, recordId);
    const { fileId } = file;
    const show = (gone: boolean) => {
      if (gone) {
        entry.removing.add(fileId);
        entry.adding.delete(fileId);
        set(entry, { ...entry.state, files: entry.state.files.filter((each) => each.fileId !== fileId) });
      } else {
        entry.removing.delete(fileId);
        entry.adding.set(fileId, file);
        set(entry, { ...entry.state, files: ordered([file, ...entry.state.files]) });
      }
    };
    show(deleting);
    const mutationId = deps.mintId();
    deps.mutations.sent(mutationId);
    try {
      await (deleting ? deps.api.delete : deps.api.restore)({ workspace, fileId, mutationId });
      deps.mutations.answered(mutationId, 1);
      if (entry.reading) entry.dirty = true;
      return true;
    } catch (thrown) {
      deps.mutations.forget(mutationId);
      const error = toDataError(thrown);
      // Gone already (someone else deleted it, or its Undo days are over): it stays gone, and the list reads again.
      if (error.code === 'NOT_FOUND') {
        show(true);
        read(entry);
      } else {
        show(!deleting);
      }
      deps.notify(refusalNotice(deleting ? FILE_WORDS.deleteFailed : FILE_WORDS.restoreFailed, error));
      return false;
    }
  };

  /** Reads a record shown now; one nobody shows reads when it is shown again. */
  const touch = (entry: Held) => {
    if (entry.holders > 0) read(entry);
    else entry.stale = true;
  };

  /** Reads every held record of the workspace again, spread over up to 2 seconds so a whole team doesn't in step. */
  const rereadSpread = (workspace: string) => {
    if (spreading.has(workspace)) return;
    spreading.add(workspace);
    later(
      () => {
        spreading.delete(workspace);
        for (const entry of held.values()) if (entry.workspace === workspace) touch(entry);
      },
      Math.round(random() * SPREAD_MS),
    );
  };

  /** Files a read of `recordId` knows of, by id: what `remove` and `restore` act on. */
  const fileOf = (workspace: string, recordId: string, fileId: string): RecordFileView | undefined =>
    held.get(keyOf(workspace, recordId))?.state.files.find((each) => each.fileId === fileId);

  return {
    forRecord: (workspace, recordId) => entryOf(workspace, recordId).handle,
    upload: async (workspace, recordId, files) => {
      const entry = entryOf(workspace, recordId);
      // Every picked file shows at once; they go one at a time, in the order picked (the server's limits like it).
      const queued = files.map((file) => ({ key: deps.mintId(), file }));
      set(entry, {
        ...entry.state,
        sending: [
          ...entry.state.sending,
          ...queued.map(({ key, file }) => ({
            key,
            name: file.name,
            size: file.size,
            contentType: file.type,
            progress: 0,
          })),
        ],
      });
      for (const { key, file } of queued) await sendOne(entry, key, file);
    },
    dismiss: (workspace, recordId, key) => {
      patchSending(entryOf(workspace, recordId), key, () => undefined);
    },
    remove: async (workspace, recordId, fileId) => {
      const file = fileOf(workspace, recordId, fileId);
      return file === undefined ? false : change(workspace, recordId, file, true);
    },
    restore: (workspace, recordId, file) => change(workspace, recordId, file, false),
    changed: (workspace, event) => {
      if (event.coarse === true) {
        rereadSpread(workspace);
        return;
      }
      for (const recordId of event.recordIds) {
        const entry = held.get(keyOf(workspace, recordId));
        if (entry !== undefined) touch(entry);
      }
    },
    resync: rereadSpread,
    records: (workspace, recordIds) => {
      for (const recordId of recordIds) {
        const entry = held.get(keyOf(workspace, recordId));
        if (entry !== undefined) touch(entry);
      }
    },
    clear: () => {
      for (const entry of held.values()) {
        entry.cancelDrop?.();
        entry.stopWatch?.();
        entry.stopWatch = undefined;
      }
      held = new Map();
      spreading.clear();
    },
  };
}
