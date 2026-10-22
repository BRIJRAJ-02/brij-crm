// Routing reports (spec 0043, AC-1612): a form's or a team page's per rule counts over 30 or 90 days, one held read
// per workspace, surface and window. No change event names them (bookings and form answers have none yet), so, like
// Home, each is read when a screen first holds it and again whenever the person comes back to the page (at most once
// per 30 seconds). A write in this tab that moves the counts (a booking marked no show) reads the workspace's held
// reports again once it lands (`reloadWorkspace`); ones nobody holds are dropped, so they read afresh when held. A
// failed read keeps what is shown; only a first read shows the failure. Nothing is fetched for a read no screen holds.
import type { RoutingReport, RoutingReportInput } from '@crm/contracts';
import { toDataError } from '../errors.ts';

/** The surface a report reads: a form or a team booking page. */
export type RoutingReportSurface = RoutingReportInput['surface'];

/** A report's window, in days. */
export type RoutingReportDays = 30 | 90;

/** What the store needs: the read, and (for tests) the return signal and the clock. */
export interface RoutingReportsDeps {
  readonly report: (
    workspace: string,
    surface: RoutingReportSurface,
    days: RoutingReportDays,
  ) => Promise<RoutingReport>;
  /** Calls `refresh` whenever the person comes back to the page (focus, visible again); answers how to stop. */
  readonly onReturn?: (refresh: () => void) => () => void;
  /** The clock, for tests. */
  readonly now?: () => number;
}

/** One report's state: loading, failed, or what the server last said. */
export type RoutingReportState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly report: RoutingReport };

/** A held report, as a screen retains it. */
export interface RoutingReportHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => RoutingReportState;
  /** Held while a screen shows it: read when first held, and again whenever the person comes back to the page. */
  readonly retain: () => () => void;
  /** Reads it again (Try again). */
  readonly reload: () => void;
}

/** How soon after an answer coming back to the page reads again. Try again and a landed write always read. */
export const REPORT_RETURN_GAP_MS = 30_000;

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

type Entry = RoutingReportHeld & { readonly workspace: string; readonly isHeld: () => boolean };

/** The routing reports store: every workspace's held reports, read again on return and after a write that moves them. */
export function createRoutingReports(deps: RoutingReportsDeps) {
  const onReturn = deps.onReturn ?? browserReturn;
  const clock = deps.now ?? Date.now;
  const reads = new Map<string, Entry>();

  function make(workspace: string, surface: RoutingReportSurface, days: RoutingReportDays): Entry {
    let state: RoutingReportState = { status: 'loading' };
    let held = 0;
    // When a read last went out, answered or not, so returning to the page after a failure doesn't read each time.
    let askedAt = Number.NEGATIVE_INFINITY;
    let reading: Promise<void> | undefined;
    // A read asked for while one is out goes again once it lands, so a write's reread never takes an older answer.
    let again = false;
    let release: (() => void) | undefined;
    const listeners = new Set<() => void>();
    const set = (next: RoutingReportState) => {
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
        .report(workspace, surface, days)
        .then(
          (report) => {
            set({ status: 'ready', report });
          },
          (error: unknown) => {
            if (state.status !== 'ready') set({ status: 'error', message: toDataError(error).message });
          },
        )
        .finally(() => {
          reading = undefined;
          if (again && held > 0) {
            again = false;
            read();
          }
          again = false;
        });
    };
    return {
      workspace,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain() {
        held += 1;
        if (held === 1) {
          read();
          // Coming back within REPORT_RETURN_GAP_MS of the last answer reads nothing: focus fires on every click back.
          release = onReturn(() => {
            // Focus and visibility both fire on one return: a read already out, or one tried lately, is enough.
            if (reading === undefined && clock() - askedAt >= REPORT_RETURN_GAP_MS) read();
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
    /** One surface's report over `days`, the same handle for every screen asking it. */
    view(workspace: string, surface: RoutingReportSurface, days: RoutingReportDays): RoutingReportHeld {
      const id = surface.kind === 'form' ? surface.formId : surface.pageId;
      const key = `${workspace}:${surface.kind}:${id}:${String(days)}`;
      const found = reads.get(key);
      if (found !== undefined) return found;
      const made = make(workspace, surface, days);
      reads.set(key, made);
      // Unheld reports of other surfaces go, so the map stays as small as what screens show.
      for (const [old, entry] of reads) if (old !== key && !entry.isHeld()) reads.delete(old);
      return made;
    },
    /** A write that moves a workspace's counts landed: held reports read again, unheld ones are dropped. */
    reloadWorkspace(workspace: string): void {
      for (const [key, entry] of reads) {
        if (entry.workspace !== workspace) continue;
        if (entry.isHeld()) entry.reload();
        else reads.delete(key);
      }
    },
  };
}

/** The routing reports store. */
export type RoutingReports = ReturnType<typeof createRoutingReports>;
