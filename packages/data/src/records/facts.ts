// A record's facts for the stat strip under its header (13 Oct reference
// batch 4): its next meeting, when it was last contacted (the CRM flow pass),
// and on a status attribute when it entered the stage it is in now (a deal's
// stage age). Each source is read when a screen
// first holds it, and again each time a screen comes back to it, so a page
// opened again shows what is true now. Per record and status attribute, one
// source, kept while anything holds it.
import type { LastContacted, MeetingPage, StageSince } from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';

/** The record's next meeting: what it is and when it starts. */
export interface NextMeeting {
  readonly title: string;
  readonly startsAt: string;
}

/** What the strip reads, while it loads, once in, or after a failed read (each part absent when there is none). */
export interface RecordFactsState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly nextMeeting?: NextMeeting;
  /** When the record entered its current stage, ISO 8601 in UTC. */
  readonly stageSince?: string;
  /** When the record was last contacted (a call or meeting already past), ISO 8601 in UTC. */
  readonly lastContacted?: string;
  readonly error?: DataError;
}

/** One record's facts, as a screen holds them (`useRecordFacts` in `@crm/data/react`). */
export interface RecordFacts {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => RecordFactsState;
  /** Holds the facts while a screen shows them, reading them again; the returned function lets go. */
  readonly retain: () => () => void;
}

/** The calls the store makes. */
export interface RecordFactsApi {
  readonly meetings: (input: {
    readonly workspace: string;
    readonly recordId: string;
    readonly limit: number;
  }) => Promise<MeetingPage>;
  readonly stageSince: (input: {
    readonly workspace: string;
    readonly recordId: string;
    readonly attributeId: string;
  }) => Promise<StageSince>;
  readonly lastContacted: (input: { readonly workspace: string; readonly recordId: string }) => Promise<LastContacted>;
}

/** What the store needs: its calls, and the time now (ISO), so a meeting already over is no one's next. */
export interface RecordFactsDeps {
  readonly api: RecordFactsApi;
  readonly now: () => string;
}

/** The store: one `RecordFacts` per record and stage attribute. */
export interface RecordFactsStore {
  /**
   * `stageKey` (the stage the record shows now, and anything else that should read the facts again, such as the
   * newest activity) makes a new source, read afresh; it shows what the record's previous source showed meanwhile, so
   * the strip never flashes back to loading.
   */
  readonly forRecord: (
    workspace: string,
    recordId: string,
    stageAttributeId?: string,
    stageKey?: string,
  ) => RecordFacts;
}

/** Creates the facts store. */
export function createRecordFactsStore({ api, now }: RecordFactsDeps): RecordFactsStore {
  const sources = new Map<string, RecordFacts>();
  const make = (
    key: string,
    workspace: string,
    recordId: string,
    stageAttributeId: string | undefined,
    seed: RecordFactsState | undefined,
  ) => {
    // What the record showed until this read lands (a moved stage's old age, for the moment the read takes).
    let state: RecordFactsState = seed?.status === 'ready' ? seed : { status: 'loading' };
    let holders = 0;
    let asked = 0;
    const listeners = new Set<() => void>();
    const set = (next: RecordFactsState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const read = () => {
      asked += 1;
      const mine = asked;
      void Promise.all([
        // Upcoming first, soonest first: the first one not yet over is the next.
        api.meetings({ workspace, recordId, limit: 1 }),
        stageAttributeId === undefined
          ? Promise.resolve<StageSince>({})
          : api.stageSince({ workspace, recordId, attributeId: stageAttributeId }),
        api.lastContacted({ workspace, recordId }),
      ]).then(
        ([page, stage, contacted]) => {
          if (mine !== asked) return;
          const first = page.items[0];
          const isNext = first !== undefined && first.endsAt >= now() && first.status !== 'cancelled';
          set({
            status: 'ready',
            ...(isNext ? { nextMeeting: { title: first.title, startsAt: first.startsAt } } : {}),
            ...(stage.since === undefined ? {} : { stageSince: stage.since }),
            ...(contacted.at === undefined ? {} : { lastContacted: contacted.at }),
          });
        },
        (error: unknown) => {
          if (mine !== asked) return;
          set({ ...state, status: state.status === 'ready' ? 'ready' : 'error', error: toDataError(error) });
        },
      );
    };
    const facts: RecordFacts = {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: () => state,
      retain: () => {
        holders += 1;
        read();
        return () => {
          holders -= 1;
          if (holders === 0) sources.delete(key);
        };
      },
    };
    return facts;
  };
  return {
    forRecord: (workspace, recordId, stageAttributeId, stageKey) => {
      const key = `${workspace}:${recordId}:${stageAttributeId ?? ''}:${stageKey ?? ''}`;
      const held = sources.get(key);
      if (held !== undefined) return held;
      const prefix = `${workspace}:${recordId}:`;
      const previous = [...sources.entries()].find(([each]) => each.startsWith(prefix))?.[1];
      const made = make(key, workspace, recordId, stageAttributeId, previous?.getSnapshot());
      sources.set(key, made);
      return made;
    },
  };
}
