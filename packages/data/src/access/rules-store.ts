// An object's access rules for its Access tab (spec 0032), held in the data layer so two admins on the same tab see
// each other's changes: one source per workspace and object, read when a screen first holds it, shown at once on a
// change (the screen hands the shape it expects) with the server's answer put in place, and read again when a live
// `access` event for the workspace arrives (100 ms coalesced; this tab's own write is skipped by its mutation id). A
// read that started before a write landed is dropped and asked again, and an older answer for one subject never
// lands over a newer change to it. No Zod here: it sits in the first load.
import type { ObjectAccess, RuleSubject, SetObjectAccessResult } from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';

/** What the Access tab reads: loading, the access, or the read's failure (with the access kept when it had one). */
export interface ObjectAccessState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly access?: ObjectAccess;
  readonly error?: DataError;
}

/** One object's access as a screen holds it (`useObjectAccess` in `@crm/data/react`). */
export interface ObjectAccessSource {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ObjectAccessState;
  /** Holds it while a screen shows it (live while held); the returned function lets go. */
  readonly retain: () => () => void;
  /** Reads it again (a failed read's Try again). */
  readonly retry: () => void;
}

/** The rule one subject is given; `null` clears it. */
export type AccessRule = Parameters<RulesStoreDeps['put']>[3];

/** What the store needs: the calls, the live watch, and a timer. */
export interface RulesStoreDeps {
  readonly get: (workspace: string, objectId: string) => Promise<ObjectAccess>;
  readonly put: (
    workspace: string,
    objectId: string,
    subject: RuleSubject,
    rule: {
      readonly level: ObjectAccess['subjects'][number]['level'];
      readonly records: ObjectAccess['subjects'][number]['records'];
      readonly fields?: ObjectAccess['subjects'][number]['fields'];
    } | null,
  ) => Promise<SetObjectAccessResult>;
  readonly watch?: (workspace: string) => () => void;
  readonly later?: (run: () => void, ms: number) => () => void;
}

/** The store: sources by workspace and object, the one write, and the live hook. */
export interface RulesStore {
  /** `initial`, when the route already read it, shows at once and is read again behind it. */
  readonly view: (workspace: string, objectId: string, initial?: ObjectAccess) => ObjectAccessSource;
  /**
   * Sets one subject's access: `shown(current)` shows at once, the answer replaces it, a refusal reads the object
   * again and rejects with the refusal.
   */
  readonly set: (
    workspace: string,
    objectId: string,
    subject: RuleSubject,
    rule: AccessRule,
    shown: (current: ObjectAccess) => ObjectAccess,
  ) => Promise<SetObjectAccessResult>;
  /** A live `access` event for the workspace: every held source of it reads again. */
  readonly changed: (workspace: string) => void;
  readonly clear: () => void;
}

/** How long a burst of live events waits before the held sources read again. */
export const ACCESS_COALESCE_MS = 100;

const timer = (run: () => void, ms: number) => {
  const id = setTimeout(run, ms);
  return () => {
    clearTimeout(id);
  };
};

/** One subject's key: a role by name, a team by id. */
const subjectKey = (subject: RuleSubject): string =>
  subject.type === 'role' ? `role:${subject.role}` : `team:${subject.teamId}`;

interface Entry {
  readonly workspace: string;
  readonly source: ObjectAccessSource;
  readonly read: () => void;
  readonly set: (next: ObjectAccessState) => void;
  readonly state: () => ObjectAccessState;
  /** Bumped by every write sent or landed: a read that began before it is dropped. */
  generation: number;
  holders: number;
}

/** Creates the store. */
export function createRulesStore({ get, put, watch, later = timer }: RulesStoreDeps): RulesStore {
  const entries = new Map<string, Entry>();
  const sent = new Map<string, number>();
  const pending = new Map<string, () => void>();
  const keyOf = (workspace: string, objectId: string) => `${workspace}\u0000${objectId}`;

  const make = (key: string, workspace: string, objectId: string, initial?: ObjectAccess): Entry => {
    let state: ObjectAccessState = initial === undefined ? { status: 'loading' } : { status: 'ready', access: initial };
    const listeners = new Set<() => void>();
    let stopWatching: (() => void) | undefined;
    let asked = 0;
    const entry: Entry = {
      workspace,
      generation: 0,
      holders: 0,
      state: () => state,
      set: (next) => {
        state = next;
        for (const listener of listeners) listener();
      },
      read: () => {
        asked += 1;
        const mine = asked;
        const at = entry.generation;
        void get(workspace, objectId).then(
          (access) => {
            if (mine !== asked) return;
            // A write landed meanwhile: this answer may be older than what is shown, so ask again.
            if (at !== entry.generation) {
              entry.read();
              return;
            }
            entry.set({ status: 'ready', access });
          },
          (error: unknown) => {
            if (mine !== asked) return;
            entry.set({ ...state, status: state.access === undefined ? 'error' : 'ready', error: toDataError(error) });
          },
        );
      },
      source: {
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => state,
        retain: () => {
          entry.holders += 1;
          if (entry.holders === 1) stopWatching = watch?.(workspace);
          entry.read();
          return () => {
            entry.holders -= 1;
            if (entry.holders > 0) return;
            stopWatching?.();
            stopWatching = undefined;
            entries.delete(key);
          };
        },
        retry: () => {
          if (state.status === 'error') entry.set({ status: 'loading' });
          entry.read();
        },
      },
    };
    return entry;
  };

  const entryOf = (workspace: string, objectId: string, initial?: ObjectAccess): Entry => {
    const key = keyOf(workspace, objectId);
    const held = entries.get(key);
    if (held !== undefined) return held;
    const made = make(key, workspace, objectId, initial);
    entries.set(key, made);
    return made;
  };

  return {
    view: (workspace, objectId, initial) => entryOf(workspace, objectId, initial).source,
    set: async (workspace, objectId, subject, rule, shown) => {
      const entry = entryOf(workspace, objectId);
      const key = `${keyOf(workspace, objectId)}\u0000${subjectKey(subject)}`;
      const mine = (sent.get(key) ?? 0) + 1;
      sent.set(key, mine);
      entry.generation += 1;
      const current = entry.state().access;
      if (current !== undefined) entry.set({ status: 'ready', access: shown(current) });
      const isLatest = () => sent.get(key) === mine;
      try {
        const answer = await put(workspace, objectId, subject, rule);
        entry.generation += 1;
        // An older answer never lands over a newer change.
        if (isLatest()) entry.set({ status: 'ready', access: answer.access });
        return answer;
      } catch (error) {
        entry.generation += 1;
        if (isLatest()) entry.read();
        throw toDataError(error);
      }
    },
    changed: (workspace) => {
      if (pending.has(workspace)) return;
      pending.set(
        workspace,
        later(() => {
          pending.delete(workspace);
          for (const entry of entries.values()) if (entry.workspace === workspace && entry.holders > 0) entry.read();
        }, ACCESS_COALESCE_MS),
      );
    },
    clear: () => {
      for (const cancel of pending.values()) cancel();
      pending.clear();
      entries.clear();
      sent.clear();
    },
  };
}
