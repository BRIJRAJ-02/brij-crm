// Automations (parity #53), Settings › Automations: the workspace's automations and the newest runs of its log, one
// held copy per workspace, loaded with the first screen that asks (`import()`, never the first load). Every change is
// shown at once, sent, and put back with a toast if refused; a delete says Undo in its toast and brings the same
// automation back. A run finishing, an automatic switch off and another tab's change all arrive as one `automations`
// event (naming nothing), which reads the list and the log again (`changed`, coalesced). A held copy also reads again
// when a screen holds it and the last read is more than a moment old.
import type { Automation, AutomationDefinition, AutomationRun } from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import type { Notice } from '../notice.ts';
import { refusalSummary } from '../refusals.ts';

export type { Automation, AutomationDefinition, AutomationRun } from '@crm/contracts';

/** The words the store's toast says. */
const WORDS = { deleted: 'Automation deleted', undo: 'Undo' } as const;

/** What a screen reads. */
export type AutomationsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: DataError }
  | {
      readonly status: 'ready';
      readonly automations: readonly Automation[];
      readonly runs: readonly AutomationRun[];
      readonly max: number;
    };

/** The calls the store makes (the data layer adds the mutation ids and the read gate). */
export interface AutomationsApi {
  readonly list: (workspace: string) => Promise<{ readonly automations: readonly Automation[]; readonly max: number }>;
  readonly runs: (workspace: string) => Promise<{ readonly runs: readonly AutomationRun[] }>;
  readonly create: (input: {
    readonly workspace: string;
    readonly id: string;
    readonly definition: AutomationDefinition;
  }) => Promise<Automation>;
  readonly update: (input: {
    readonly workspace: string;
    readonly automationId: string;
    readonly definition: AutomationDefinition;
  }) => Promise<Automation>;
  readonly setEnabled: (input: {
    readonly workspace: string;
    readonly automationId: string;
    readonly enabled: boolean;
  }) => Promise<Automation>;
  readonly remove: (input: { readonly workspace: string; readonly automationId: string }) => Promise<unknown>;
  readonly restore: (input: { readonly workspace: string; readonly automationId: string }) => Promise<Automation>;
}

/** What the store is made with. */
export interface AutomationsDeps {
  readonly api: AutomationsApi;
  readonly mintId: () => string;
  readonly notify: (notice: Notice) => void;
  /** Watches a workspace's live events while a copy of it is held. */
  readonly watch?: (workspace: string) => () => void;
  readonly now?: () => number;
}

/** A read this recent serves a new holder as it is: the loader and the screen it opens hold it together. */
export const AUTOMATIONS_FRESH_MS = 1_000;

/** One workspace's held automations. */
export interface AutomationsHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => AutomationsState;
  /** Held while a screen shows it; reads again if the last read is old. */
  readonly retain: () => () => void;
  /** For a route loader: settles once a first read did (rejecting with its failure). */
  readonly ready: () => Promise<void>;
  readonly reload: () => void;
  /** A new automation's id: mint it once per New automation and send the same one again on a retry. */
  readonly newId: () => string;
  /** Makes one, on. Answers whether it landed (a refusal is a toast and `false`). */
  readonly create: (id: string, definition: AutomationDefinition) => Promise<boolean>;
  readonly update: (id: string, definition: AutomationDefinition) => Promise<boolean>;
  readonly setEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  /** Deletes one at once; the toast says Undo. */
  readonly remove: (id: string) => Promise<boolean>;
}

/** An automation shown switched on or off before the server answers: on clears the reason and the failure count. */
function switched(one: Automation, enabled: boolean): Automation {
  if (!enabled) return { ...one, enabled };
  const rest = Object.fromEntries(
    Object.entries(one).filter(([key]) => key !== 'disabledReason'),
  ) as unknown as Automation;
  return { ...rest, enabled, failures: 0 };
}

/** The automations store. */
export function createAutomationsStore(deps: AutomationsDeps) {
  const now = deps.now ?? Date.now;
  const held = new Map<string, ReturnType<typeof make>>();

  function make(workspace: string) {
    let state: AutomationsState = { status: 'loading' };
    let reading: Promise<void> | undefined;
    let readAt: number | undefined;
    let holders = 0;
    let stopWatching: (() => void) | undefined;
    // A read sent before a change would put its older answer over it: it is asked again instead.
    let version = 0;
    let writing = 0;
    let owed = false;
    let coalesce: ReturnType<typeof setTimeout> | undefined;
    const listeners = new Set<() => void>();
    const set = (next: AutomationsState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const read = (): Promise<void> => {
      const sentAt = version;
      reading ??= Promise.all([deps.api.list(workspace), deps.api.runs(workspace)]).then(
        ([list, log]) => {
          reading = undefined;
          if (writing > 0 && state.status === 'ready') {
            owed = true;
            return undefined;
          }
          if (sentAt !== version) return read();
          readAt = now();
          set({ status: 'ready', automations: list.automations, runs: log.runs, max: list.max });
          return undefined;
        },
        (error: unknown) => {
          reading = undefined;
          const failure = toDataError(error);
          if (state.status !== 'ready') set({ status: 'error', error: failure });
          throw failure;
        },
      );
      return reading;
    };
    const ready = (): Extract<AutomationsState, { status: 'ready' }> | undefined =>
      state.status === 'ready' ? state : undefined;
    /** Shows a change; reads sent before it are stale. */
    const show = (automations: readonly Automation[]) => {
      const current = ready();
      if (current === undefined) return;
      version += 1;
      set({ ...current, automations });
    };
    const replace = (automation: Automation) => {
      const current = ready();
      if (current === undefined) return;
      show(current.automations.map((one) => (one.id === automation.id ? automation : one)));
    };
    const stale = () => {
      version += 1;
      readAt = undefined;
      if (holders > 0) void read().catch(() => undefined);
    };
    const begin = () => {
      writing += 1;
      version += 1;
    };
    const end = () => {
      writing = Math.max(0, writing - 1);
      if (writing === 0 && owed) {
        owed = false;
        void read().catch(() => undefined);
      }
    };
    /** Sends a change; on a refusal puts `before` back, tells the person, and reads the truth again. */
    const write = async (
      shownNow: (() => void) | undefined,
      send: () => Promise<Automation | undefined>,
      before: readonly Automation[] | undefined,
    ): Promise<boolean> => {
      begin();
      shownNow?.();
      try {
        const saved = await send();
        if (saved !== undefined) replace(saved);
        return true;
      } catch (error) {
        if (before !== undefined) show(before);
        stale();
        deps.notify({ tone: 'danger', message: refusalSummary(toDataError(error)) });
        return false;
      } finally {
        end();
      }
    };
    const held_: AutomationsHeld = {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain() {
        holders += 1;
        if (holders === 1) stopWatching = deps.watch?.(workspace);
        if (readAt === undefined || now() - readAt >= AUTOMATIONS_FRESH_MS) void read().catch(() => undefined);
        return () => {
          holders -= 1;
          if (holders === 0) {
            stopWatching?.();
            stopWatching = undefined;
          }
        };
      },
      ready: () => (state.status === 'ready' ? Promise.resolve() : read()),
      reload() {
        if (state.status === 'error') set({ status: 'loading' });
        void read().catch(() => undefined);
      },
      newId: deps.mintId,
      create: (id, definition) =>
        write(
          undefined,
          async () => {
            const made = await deps.api.create({ workspace, id, definition });
            const current = ready();
            if (current !== undefined && !current.automations.some((one) => one.id === made.id)) {
              show([...current.automations, made]);
            }
            return made;
          },
          undefined,
        ),
      update: (id, definition) =>
        write(undefined, () => deps.api.update({ workspace, automationId: id, definition }), undefined),
      setEnabled(id, enabled) {
        const before = ready()?.automations;
        return write(
          () => {
            if (before === undefined) return;
            // Switching on clears the reason at once; the answer says who it runs as.
            show(before.map((one) => (one.id === id ? switched(one, enabled) : one)));
          },
          () => deps.api.setEnabled({ workspace, automationId: id, enabled }),
          before,
        );
      },
      async remove(id) {
        const before = ready()?.automations;
        const landed = await write(
          () => {
            if (before !== undefined) show(before.filter((one) => one.id !== id));
          },
          async () => {
            await deps.api.remove({ workspace, automationId: id });
            return undefined;
          },
          before,
        );
        if (landed) {
          deps.notify({
            tone: 'success',
            message: WORDS.deleted,
            action: {
              label: WORDS.undo,
              onAction: () => {
                void write(
                  undefined,
                  async () => {
                    const back = await deps.api.restore({ workspace, automationId: id });
                    const current = ready();
                    if (current !== undefined && !current.automations.some((one) => one.id === back.id)) {
                      show([...current.automations, back].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
                    }
                    return back;
                  },
                  undefined,
                );
              },
            },
          });
        }
        return landed;
      },
    };
    return {
      held: held_,
      /** An `automations` event: coalesced, so a burst of runs reads once. */
      changed() {
        if (coalesce !== undefined) return;
        coalesce = setTimeout(() => {
          coalesce = undefined;
          stale();
        }, 300);
      },
      stale,
      dispose() {
        if (coalesce !== undefined) clearTimeout(coalesce);
        stopWatching?.();
      },
    };
  }

  const of = (workspace: string) => {
    const found = held.get(workspace);
    if (found !== undefined) return found;
    const made = make(workspace);
    held.set(workspace, made);
    return made;
  };

  return {
    held: (workspace: string): AutomationsHeld => of(workspace).held,
    /** A live `automations` event of the workspace. */
    changed(workspace: string): void {
      held.get(workspace)?.changed();
    },
    /** A resync: every held copy reads again. */
    resync(): void {
      for (const entry of held.values()) entry.stale();
    },
    /** Signed out: forgets every workspace's. */
    clear(): void {
      for (const entry of held.values()) entry.dispose();
      held.clear();
    },
  };
}

/** The automations store. */
export type AutomationsStore = ReturnType<typeof createAutomationsStore>;
