// The signed in member's preferences in each workspace (Settings › Account ›
// Preferences): time zone, date format, week start and landing page. One
// copy per workspace, read once and shared by every screen that formats a
// date and by the workspace's opening redirect. A change shows at once, is
// sent, and is put back with a toast if refused; an answer to an older change
// never undoes a newer one. Only the member holds their preferences, so no
// live event carries them: another device's change shows on its next read.
import type { MemberPreferences, UpdatePreferencesInput } from '@crm/contracts';
import { refusalSummary, toDataError } from '../errors.ts';
import type { Notice } from '../notice.ts';

export type { DateFormat, LandingPage, MemberPreferences, WeekStart } from '@crm/contracts';

/** A change to the member's own preferences: only the fields named change; `timeZone` null is the browser's. */
export type PreferencesChange = Omit<UpdatePreferencesInput, 'workspace' | 'mutationId'>;

/** The member's preferences as a screen holds them. */
export type PreferencesState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly preferences: MemberPreferences };

/** One workspace's preferences, read when first held. */
export interface PreferencesHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => PreferencesState;
  readonly retain: () => () => void;
}

/** What the store calls on the API. */
export interface PreferencesApi {
  readonly get: (input: { readonly workspace: string }) => Promise<MemberPreferences>;
  readonly update: (input: UpdatePreferencesInput) => Promise<MemberPreferences>;
}

/** What the store is made with. */
export interface PreferencesDeps {
  readonly api: PreferencesApi;
  readonly mintId: () => string;
  readonly notify: (notice: Notice) => void;
}

/** Applies a change to the preferences it names, as the server will. */
export function applyChange(preferences: MemberPreferences, change: PreferencesChange): MemberPreferences {
  const { timeZone: _kept, ...rest } = preferences;
  const timeZone = change.timeZone === undefined ? preferences.timeZone : (change.timeZone ?? undefined);
  return {
    ...rest,
    ...(timeZone === undefined ? {} : { timeZone }),
    ...(change.dateFormat === undefined ? {} : { dateFormat: change.dateFormat }),
    ...(change.weekStart === undefined ? {} : { weekStart: change.weekStart }),
    ...(change.landing === undefined ? {} : { landing: change.landing }),
  };
}

/** The member's preferences in each workspace. */
export function createPreferencesStore(deps: PreferencesDeps) {
  const held = new Map<string, ReturnType<typeof make>>();

  function make(workspace: string) {
    let state: PreferencesState = { status: 'loading' };
    let reading: Promise<MemberPreferences> | undefined;
    // What the server last said, and the newest change sent: an older answer never undoes a newer change.
    let confirmed: MemberPreferences | undefined;
    let sent = 0;
    const listeners = new Set<() => void>();
    const set = (next: PreferencesState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const read = (): Promise<MemberPreferences> => {
      reading ??= deps.api
        .get({ workspace })
        .then(
          (answer) => {
            confirmed = answer;
            // A change on its way keeps what it shows until its own answer lands.
            if (state.status !== 'ready' || sent === 0) set({ status: 'ready', preferences: answer });
            return answer;
          },
          (error: unknown) => {
            const refusal = toDataError(error);
            if (state.status !== 'ready') set({ status: 'error', message: refusal.message });
            throw refusal;
          },
        )
        .finally(() => {
          reading = undefined;
        });
      return reading;
    };
    return {
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain() {
        if (state.status !== 'ready') void read().catch(() => undefined);
        return () => undefined;
      },
      /** The preferences, read once: a route loader awaits it (and the opening redirect reads it). */
      load(): Promise<MemberPreferences> {
        return state.status === 'ready' ? Promise.resolve(state.preferences) : read();
      },
      async change(change: PreferencesChange): Promise<boolean> {
        if (state.status !== 'ready') return false;
        sent += 1;
        const mine = sent;
        set({ status: 'ready', preferences: applyChange(state.preferences, change) });
        try {
          const answer = await deps.api.update({ workspace, ...change, mutationId: deps.mintId() });
          confirmed = answer;
          if (mine === sent) set({ status: 'ready', preferences: answer });
          return true;
        } catch (error) {
          if (mine === sent && confirmed !== undefined) set({ status: 'ready', preferences: confirmed });
          deps.notify({ tone: 'danger', message: refusalSummary(toDataError(error)) });
          return false;
        }
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
    /** The member's preferences in a workspace, read when a screen first holds them. */
    of: (workspace: string): PreferencesHeld => of(workspace),
    /** Reads them once (a route loader); rejects with the refusal. */
    load: (workspace: string): Promise<MemberPreferences> => of(workspace).load(),
    /** Changes the fields named at once; put back with a toast if refused. Answers whether it landed. */
    change: (workspace: string, change: PreferencesChange): Promise<boolean> => of(workspace).change(change),
    /** Signed out: forgets every workspace's copy. */
    clear: (): void => {
      held.clear();
    },
  };
}
