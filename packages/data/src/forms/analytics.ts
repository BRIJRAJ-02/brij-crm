// A form's analytics (spec 0063, AC-6321): one held read per workspace, form
// and range, modelled on the routing report store next door (`routing/
// reports.ts`), which solves the same problem — a report no change event
// names, so it is read when a screen first holds it and again whenever the
// person comes back to the page, at most once every `ANALYTICS_RETURN_GAP_MS`.
//
// Views and submissions arrive from visitors, who send no change event into
// this workspace, so there is nothing to subscribe to: coming back to the tab
// is the refresh. A failed read keeps what is already shown, and only a first
// read shows the failure, so a flaky network never blanks the numbers someone
// is reading. Nothing is fetched for a range no screen holds.
import type { FormAnalytics, FormAnalyticsRange } from '@crm/contracts';
import { toDataError } from '../errors.ts';

/** What the store needs: the read, and (for tests) the return signal and the clock. */
export interface FormAnalyticsDeps {
  readonly read: (workspace: string, formId: string, range: FormAnalyticsRange) => Promise<FormAnalytics>;
  /** Calls `refresh` whenever the person comes back to the page (focus, visible again); answers how to stop. */
  readonly onReturn?: (refresh: () => void) => () => void;
  /** The clock, for tests. */
  readonly now?: () => number;
}

/** One form's analytics state: loading, failed, or what the server last said. */
export type FormAnalyticsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly analytics: FormAnalytics };

/** A held analytics read, as a screen retains it. */
export interface FormAnalyticsHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => FormAnalyticsState;
  /** Held while the tab shows it: read when first held, and again whenever the person comes back to the page. */
  readonly retain: () => () => void;
  /** Reads it again (Try again). */
  readonly reload: () => void;
}

/** How soon after an answer coming back to the page reads again. Try again always reads. */
export const ANALYTICS_RETURN_GAP_MS = 30_000;

/** The browser's return signal: the window's focus and the document becoming visible. */
function browserReturn(refresh: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const onVisible = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

type Entry = FormAnalyticsHeld & { readonly isHeld: () => boolean };

/** The forms analytics store: every held read, refreshed when the person comes back to the tab. */
export function createFormAnalytics(deps: FormAnalyticsDeps) {
  const onReturn = deps.onReturn ?? browserReturn;
  const clock = deps.now ?? Date.now;
  const reads = new Map<string, Entry>();

  function make(workspace: string, formId: string, range: FormAnalyticsRange): Entry {
    let state: FormAnalyticsState = { status: 'loading' };
    let held = 0;
    // When a read last went out, answered or not, so returning after a failure doesn't read on every click back.
    let askedAt = Number.NEGATIVE_INFINITY;
    let reading: Promise<void> | undefined;
    let again = false;
    let release: (() => void) | undefined;
    const listeners = new Set<() => void>();
    const set = (next: FormAnalyticsState) => {
      // A new object every time, since `useSyncExternalStore` compares snapshots by identity.
      state = next;
      for (const listener of listeners) listener();
    };
    const read = (): void => {
      if (reading !== undefined) {
        again = true;
        return;
      }
      askedAt = clock();
      reading = deps
        .read(workspace, formId, range)
        .then(
          (analytics) => {
            set({ status: 'ready', analytics });
          },
          (error: unknown) => {
            // A failure never blanks numbers already on screen: only a first read shows one.
            if (state.status !== 'ready') set({ status: 'error', message: toDataError(error).message });
          },
        )
        .finally(() => {
          reading = undefined;
          if (again && held > 0) {
            again = false;
            read();
            return;
          }
          again = false;
        });
    };
    return {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain() {
        held += 1;
        if (held === 1) {
          read();
          release = onReturn(() => {
            // Focus and visibility both fire on one return: a read already out, or one tried lately, is enough.
            if (reading === undefined && clock() - askedAt >= ANALYTICS_RETURN_GAP_MS) read();
          });
        }
        return () => {
          held -= 1;
          if (held === 0) {
            release?.();
            release = undefined;
          }
        };
      },
      reload: read,
      isHeld: () => held > 0,
    };
  }

  return {
    /** One form's analytics over `range`, the same handle for every screen asking it. */
    view(workspace: string, formId: string, range: FormAnalyticsRange): FormAnalyticsHeld {
      const key = `${workspace}:${formId}:${String(range)}`;
      const found = reads.get(key);
      if (found !== undefined) return found;
      const made = make(workspace, formId, range);
      reads.set(key, made);
      // Unheld reads go, so the map stays as small as what screens show (switching range leaves the old one behind).
      for (const [old, entry] of reads) if (old !== key && !entry.isHeld()) reads.delete(old);
      return made;
    },
  };
}

/** The forms analytics store. */
export type FormAnalyticsStore = ReturnType<typeof createFormAnalytics>;
