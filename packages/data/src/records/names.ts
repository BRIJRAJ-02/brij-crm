// The names of records a cell links to (a person's Company), so a reference
// chip says "Acme" and never "Unknown". A view's rows carry only the linked
// ids; the names are read here, once per record for the app load, in one
// batched `records.get` per frame (500 ids a call, the primary attribute
// only), and kept as display shapes, never as record bodies, so the store
// still holds one copy of each record. A live change to a named record (a
// rename) drops its name, and the next frame reads it again.
import type { RecordRefDisplay } from '@crm/contracts';
import type { Scheduler } from './view.ts';

/** A linked record's id, as a reference value holds it. */
export interface RecordRef {
  readonly objectId: string;
  readonly recordId: string;
}

/** The most ids one names read asks for (`MAX_GET_IDS`). */
const NAMES_PER_READ = 500;

/** What the names reader needs: the records read by id, the frame, and who to tell. */
export interface ReferenceNamesOptions {
  /** Reads records by id with the primary attribute only; ids the reader can't see are left out. */
  readonly read: (
    workspace: string,
    ids: readonly string[],
  ) => Promise<readonly { readonly id: string; readonly display: RecordRefDisplay }[]>;
  readonly schedule: Scheduler;
  /** Names arrived (or a read failed for good) in this workspace: its views render again. */
  readonly onNames: (workspace: string) => void;
  /** A record the store holds already knows its own name. */
  readonly held?: (recordId: string) => RecordRefDisplay | undefined;
  /** Runs `run` after `ms`: a failed read's next try. A timer by default; tests pass their own. */
  readonly later?: (run: () => void, ms: number) => void;
}

/** How many times a name is read before it shows as unknown, and the first wait between tries (doubling). */
const NAME_TRIES = 3;
const NAME_RETRY_MS = 1_000;

/** What a reference reads as while its name is on its way, or when it can't be read (hidden or gone). */
export type NameState = RecordRefDisplay | 'loading' | 'unknown';

/** The reference names for the app load: ask, read, forget. */
export interface ReferenceNames {
  /** The display for each linked record, asking for the ones not known yet (read in the next frame). */
  readonly displaysOf: (workspace: string, refs: readonly RecordRef[]) => readonly NameState[];
  /** Drops these records' names (a live change named them), so the next ask reads them again. */
  readonly forget: (workspace: string, recordIds: readonly string[]) => void;
  /** Drops every name held for a workspace (an object's name attribute changed), so each is asked for again. */
  readonly forgetAll: (workspace: string) => void;
  /** Displays already in hand (a record picked from a search, spec 0014): its chip shows at once, never a skeleton. */
  readonly learn: (workspace: string, displays: readonly RecordRefDisplay[]) => void;
  readonly clear: () => void;
}

/** Splits `items` into runs of at most `size`. */
const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/** Makes the reference names reader for one data layer. */
export function createReferenceNames({
  read,
  schedule,
  onNames,
  held = () => undefined,
  later = (run, ms) => {
    setTimeout(run, ms);
  },
}: ReferenceNamesOptions): ReferenceNames {
  // By workspace, then record id: a name, or 'unknown' once a read left it out.
  let known = new Map<string, Map<string, RecordRefDisplay | 'unknown'>>();
  // Asked for and not read yet, by workspace; and the ids a read is out for.
  let wanted = new Map<string, Set<string>>();
  let reading = new Map<string, Set<string>>();
  // Failed reads by workspace and id: tried again after a wait, then said unknown.
  let failures = new Map<string, number>();
  let isScheduled = false;
  // Bumped by clear(), so a read that lands after it changes nothing.
  let generation = 0;

  const knownIn = (workspace: string) => {
    const found = known.get(workspace);
    if (found !== undefined) return found;
    const made = new Map<string, RecordRefDisplay | 'unknown'>();
    known.set(workspace, made);
    return made;
  };

  const flush = () => {
    isScheduled = false;
    const asked = wanted;
    wanted = new Map();
    const at = generation;
    for (const [workspace, ids] of asked) {
      const out = reading.get(workspace) ?? new Set<string>();
      reading.set(workspace, out);
      const fresh = [...ids].filter((id) => !out.has(id));
      for (const id of fresh) out.add(id);
      for (const part of chunks(fresh, NAMES_PER_READ)) {
        read(workspace, part).then(
          (rows) => {
            if (at !== generation) return;
            const names = knownIn(workspace);
            const found = new Set<string>();
            for (const row of rows) {
              names.set(row.id, row.display);
              found.add(row.id);
            }
            // Left out: hidden from this person, or deleted. Said as unknown, never read again this load.
            for (const id of part) {
              if (!found.has(id)) names.set(id, 'unknown');
              out.delete(id);
            }
            onNames(workspace);
          },
          () => {
            if (at !== generation) return;
            // A failed read tries again after a wait (the views render, which asks again), twice, then the
            // names show as unknown rather than loading for ever.
            const names = knownIn(workspace);
            let tries = 0;
            for (const id of part) {
              out.delete(id);
              const key = `${workspace}\u0000${id}`;
              tries = (failures.get(key) ?? 0) + 1;
              failures.set(key, tries);
              if (tries >= NAME_TRIES) names.set(id, 'unknown');
            }
            if (tries >= NAME_TRIES) onNames(workspace);
            else {
              later(
                () => {
                  if (at === generation) onNames(workspace);
                },
                NAME_RETRY_MS * 2 ** (tries - 1),
              );
            }
          },
        );
      }
    }
  };

  const ask = (workspace: string, recordId: string) => {
    if (reading.get(workspace)?.has(recordId) === true) return;
    const set = wanted.get(workspace) ?? new Set<string>();
    wanted.set(workspace, set);
    set.add(recordId);
    if (isScheduled) return;
    isScheduled = true;
    schedule(flush);
  };

  return {
    displaysOf: (workspace, refs) =>
      refs.map((ref): NameState => {
        const own = held(ref.recordId);
        if (own !== undefined) return own;
        const name = known.get(workspace)?.get(ref.recordId);
        if (name !== undefined) return name;
        ask(workspace, ref.recordId);
        return 'loading';
      }),
    learn: (workspace, displays) => {
      const names = knownIn(workspace);
      for (const display of displays) if (!names.has(display.recordId)) names.set(display.recordId, display);
    },
    forget: (workspace, recordIds) => {
      const names = known.get(workspace);
      if (names === undefined) return;
      let dropped = false;
      for (const id of recordIds) dropped = names.delete(id) || dropped;
      if (dropped) onNames(workspace);
    },
    forgetAll: (workspace) => {
      // A read still out may have been answered before the change: every one is dropped (the generation), and
      // the screens of each workspace that had one out ask again.
      const out = [...reading.keys()].filter((id) => id !== workspace);
      generation += 1;
      reading = new Map();
      known.delete(workspace);
      for (const each of [workspace, ...out]) onNames(each);
    },
    clear: () => {
      generation += 1;
      known = new Map();
      wanted = new Map();
      reading = new Map();
      failures = new Map();
    },
  };
}
