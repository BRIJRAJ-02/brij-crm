// `data.jobs` (spec 0008, milestone 1): the workspace's background jobs as
// screens see them. One copy of each job per workspace, shared by every view
// (`mine`, `all`) that shows it; a view is a window of pages from
// `jobs.list`, unfinished jobs first, then the newest. Live `jobs` events
// (spec 0007's kind, the job ids named) fetch the named jobs again; a coarse
// one (the channel holds someone who may not read them) refetches the
// unfinished jobs held and each view's first page, once, spread over up to 2
// seconds. A cancel shows at once and rolls back with a message if refused.
// The jobs this browser started are watched until they end, and each one's
// end is told to the app (`onFinished`), which raises the toast.
//
// Plain TypeScript with no runtime imports beyond the layer's own types, so it
// sits in the first load.
import type { JobStarter, JobStatus, JobView } from '@crm/contracts';
import { refusalSummary, toDataError, type DataError } from '../errors.ts';
import type { MutationLog } from '../live/mutations.ts';
import type { LiveEventOf } from '../live/router.ts';
import type { Notice } from '../notice.ts';

/** Which jobs a view shows: the person's own, or every job (holders of `jobs.manage`). */
export type JobsScope = 'mine' | 'all';

/** A test job's settings, as the Background jobs page sends them. */
export interface TestJobSettings {
  readonly items: number;
  readonly batchSize?: number;
  readonly batchMillis?: number;
  readonly refuseEvery?: number;
  readonly failAtPosition?: number;
}

/** The calls the jobs store makes, each mapped to a DataError by the layer. */
export interface JobsApi {
  readonly list: (input: {
    readonly workspace: string;
    readonly scope: JobsScope;
    readonly cursor?: string;
  }) => Promise<{ readonly jobs: readonly JobView[]; readonly nextCursor?: string | undefined }>;
  readonly get: (input: { readonly workspace: string; readonly jobId: string }) => Promise<JobView>;
  readonly cancel: (input: {
    readonly workspace: string;
    readonly jobId: string;
    readonly mutationId: string;
  }) => Promise<JobView>;
  readonly confirm: (input: {
    readonly workspace: string;
    readonly jobId: string;
    readonly mutationId: string;
  }) => Promise<JobView>;
  readonly startTest: (
    input: TestJobSettings & { readonly workspace: string; readonly id: string; readonly mutationId: string },
  ) => Promise<JobView>;
}

/** What the jobs store needs from the layer. */
export interface JobsDeps {
  readonly api: JobsApi;
  readonly mintId: () => string;
  readonly mutations: MutationLog;
  readonly notify: (notice: Notice) => void;
  /** Listens to a workspace's change events; the answer stops. */
  readonly watch: (workspace: string) => () => void;
  /** The person's member id in the workspace, for `mine` (undefined when it can't be read). */
  readonly memberOf: (workspace: string) => Promise<string | undefined>;
  /** Runs `work` once after a random 0 to 2 seconds, however often it is asked meanwhile (per `key`). */
  readonly spread: (key: string, work: () => void) => void;
  /** A job this browser started has ended: the app says how. */
  readonly onFinished: (workspace: string, job: JobView) => void;
}

/** What a view of jobs shows now. */
export interface JobsSnapshot {
  /** `loading` before the first page, `error` when it failed, else `ready`. */
  readonly status: 'loading' | 'ready' | 'error';
  /** Unfinished first, then finished, newest first. */
  readonly jobs: readonly JobView[];
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly error?: DataError;
}

/** One view of a workspace's jobs. */
export interface JobsView {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => JobsSnapshot;
  /** Holds the view (and listens to the workspace's changes) while a screen shows it; the answer lets go. */
  readonly retain: () => () => void;
  /** Settles once the first page is in (or failed). */
  readonly ready: () => Promise<void>;
  /** The next page, after the last one loaded. */
  readonly more: () => Promise<void>;
  /** Reads the first page again (Retry). */
  readonly reload: () => Promise<void>;
}

const FINISHED: readonly JobStatus[] = ['succeeded', 'failed', 'cancelled'];
const isFinished = (job: Pick<JobView, 'status'>): boolean => FINISHED.includes(job.status);
const progress = (job: JobView): number => job.done + job.refused + job.skipped;

/**
 * Whether `next` may replace `held`: a finished job never goes back to
 * unfinished, and progress never goes backwards (two reads landing out of
 * order), so the newer read wins.
 */
function mayReplace(held: JobView | undefined, next: JobView): boolean {
  if (held === undefined) return true;
  if (isFinished(held) && !isFinished(next)) return false;
  return progress(next) >= progress(held);
}

/** The order a view shows: unfinished first, then newest first (by creation time, then id). */
function byListOrder(a: JobView, b: JobView): number {
  const finished = Number(isFinished(a)) - Number(isFinished(b));
  if (finished !== 0) return finished;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

const starterIs = (starter: JobStarter, memberId: string | undefined) =>
  starter.type === 'member' && memberId !== undefined && starter.memberId === memberId;

/** The jobs store: every workspace's jobs, the views over them, and the jobs this browser started. */
export function createJobsStore(deps: JobsDeps) {
  // One copy of each job, per workspace.
  const held = new Map<string, Map<string, JobView>>();
  const views = new Map<string, ReturnType<typeof makeView>>();
  // The jobs this browser started and hasn't heard the end of, per workspace, and the watch that hears it.
  const startedHere = new Map<string, Set<string>>();
  const watching = new Map<string, () => void>();
  const fetching = new Set<string>();

  const jobsOf = (workspace: string): Map<string, JobView> => {
    const found = held.get(workspace);
    if (found !== undefined) return found;
    const made = new Map<string, JobView>();
    held.set(workspace, made);
    return made;
  };

  const viewsOf = (workspace: string) =>
    [...views.entries()].filter(([key]) => key.startsWith(`${workspace}\u0000`)).map(([, view]) => view);

  /** Tells the app about a job this browser started that just ended, once, and stops watching when none is left. */
  const tellIfEnded = (workspace: string, job: JobView) => {
    const mine = startedHere.get(workspace);
    if (mine === undefined || !mine.has(job.id) || !isFinished(job)) return;
    mine.delete(job.id);
    deps.onFinished(workspace, job);
    if (mine.size === 0) {
      startedHere.delete(workspace);
      watching.get(workspace)?.();
      watching.delete(workspace);
    }
  };

  /** Puts a read (or a write's answer, `force`) of a job in the store, and tells every view of its workspace. */
  const put = (workspace: string, job: JobView, force = false) => {
    const jobs = jobsOf(workspace);
    if (!force && !mayReplace(jobs.get(job.id), job)) return;
    jobs.set(job.id, job);
    for (const view of viewsOf(workspace)) view.saw(job);
    tellIfEnded(workspace, job);
  };

  const drop = (workspace: string, jobId: string) => {
    jobsOf(workspace).delete(jobId);
    for (const view of viewsOf(workspace)) view.forget(jobId);
    startedHere.get(workspace)?.delete(jobId);
  };

  /**
   * Undoes an optimistic change the server refused: a job it no longer shows
   * (NOT_FOUND) is dropped; otherwise the copy from before goes back, but only
   * while the optimistic copy is still the one held, so a newer read that
   * landed meanwhile is never overwritten.
   */
  const rollBack = (
    workspace: string,
    jobId: string,
    shown: JobView | undefined,
    before: JobView | undefined,
    failure: DataError,
  ) => {
    if (failure.code === 'NOT_FOUND') {
      drop(workspace, jobId);
      return;
    }
    if (before !== undefined && shown !== undefined && jobsOf(workspace).get(jobId) === shown) {
      put(workspace, before, true);
    }
  };

  /** Reads one job again; NOT_FOUND drops it (gone, or no longer visible). One read per job at a time. */
  const refetch = (workspace: string, jobId: string) => {
    const key = `${workspace}\u0000${jobId}`;
    if (fetching.has(key)) return;
    fetching.add(key);
    deps.api
      .get({ workspace, jobId })
      .then(
        (job) => {
          put(workspace, job);
        },
        (error: unknown) => {
          if (toDataError(error).code === 'NOT_FOUND') drop(workspace, jobId);
        },
      )
      .finally(() => fetching.delete(key));
  };

  function makeView(workspace: string, scope: JobsScope) {
    let ids: string[] = [];
    let cursor: string | undefined;
    let status: JobsSnapshot['status'] = 'loading';
    let error: DataError | undefined;
    let loadingMore = false;
    let first: Promise<void> | undefined;
    let snapshot: JobsSnapshot = { status, jobs: [], hasMore: false, loadingMore };
    let retained = 0;
    let release: (() => void) | undefined;
    const listeners = new Set<() => void>();

    const announce = () => {
      const jobs = jobsOf(workspace);
      const shown = ids.flatMap((id) => {
        const job = jobs.get(id);
        return job === undefined ? [] : [job];
      });
      snapshot = {
        status,
        jobs: shown.sort(byListOrder),
        hasMore: cursor !== undefined,
        loadingMore,
        ...(error === undefined ? {} : { error }),
      };
      for (const listener of listeners) listener();
    };

    const loadFirst = (): Promise<void> => {
      const loading = deps.api.list({ workspace, scope }).then(
        (page) => {
          for (const job of page.jobs) put(workspace, job, true);
          ids = page.jobs.map((job) => job.id);
          cursor = page.nextCursor;
          status = 'ready';
          error = undefined;
          announce();
        },
        (failed: unknown) => {
          status = 'error';
          error = toDataError(failed);
          announce();
        },
      );
      first = loading;
      return loading;
    };

    return {
      /** A job was read or changed: shown if it's in this view, or belongs in it (a new one). */
      saw(job: JobView) {
        if (ids.includes(job.id)) {
          announce();
          return;
        }
        if (status !== 'ready') return;
        if (scope === 'all') {
          ids = [job.id, ...ids];
          announce();
          return;
        }
        void deps.memberOf(workspace).then((me) => {
          if (!starterIs(job.startedBy, me) || ids.includes(job.id)) return;
          ids = [job.id, ...ids];
          announce();
        });
      },
      forget(jobId: string) {
        if (!ids.includes(jobId)) return;
        ids = ids.filter((id) => id !== jobId);
        announce();
      },
      /** Whether a screen shows it. */
      isRetained: () => retained > 0,
      ids: () => ids,
      reloadFirst: loadFirst,
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
          if (retained === 1) release = deps.watch(workspace);
          let released = false;
          return () => {
            if (released) return;
            released = true;
            retained -= 1;
            if (retained === 0) {
              release?.();
              release = undefined;
            }
          };
        },
        ready: () => first ?? loadFirst(),
        async more() {
          if (cursor === undefined || loadingMore) return;
          loadingMore = true;
          announce();
          try {
            const page = await deps.api.list({ workspace, scope, cursor });
            for (const job of page.jobs) put(workspace, job);
            ids = [...ids, ...page.jobs.map((job) => job.id).filter((id) => !ids.includes(id))];
            cursor = page.nextCursor;
          } catch (failed) {
            deps.notify({ tone: 'danger', message: toDataError(failed).message });
          } finally {
            loadingMore = false;
            announce();
          }
        },
        reload: async () => {
          status = ids.length === 0 ? 'loading' : status;
          announce();
          await loadFirst();
        },
      } satisfies JobsView,
    };
  }

  /** The view of a workspace's jobs for `scope`, the same one for every screen that asks. */
  const view = (workspace: string, scope: JobsScope): JobsView => {
    const key = `${workspace}\u0000${scope}`;
    const found = views.get(key);
    if (found !== undefined) return found.api;
    const made = makeView(workspace, scope);
    views.set(key, made);
    return made.api;
  };

  return {
    view,
    /** A new job id: mint it once per form, and send the same one on a retry, so nothing starts twice. */
    newId: () => deps.mintId(),
    /**
     * Starts a test job (`dev.simulate`, local and previews only) with the
     * id from `newId`. Waits for the server (it is refused in production),
     * then shows it in every view; its end raises `onFinished`. A refusal
     * raises a toast saying why, and rejects.
     */
    async startTest(workspace: string, id: string, settings: TestJobSettings): Promise<JobView> {
      const mutationId = deps.mintId();
      deps.mutations.sent(mutationId);
      try {
        const job = await deps.api.startTest({ workspace, id, mutationId, ...settings });
        deps.mutations.answered(mutationId, 1);
        const mine = startedHere.get(workspace) ?? new Set<string>();
        startedHere.set(workspace, mine);
        mine.add(job.id);
        if (!watching.has(workspace)) watching.set(workspace, deps.watch(workspace));
        put(workspace, job, true);
        return job;
      } catch (error) {
        deps.mutations.forget(mutationId);
        // Say why (production has no test job; a member may not run one); the screen only stops its spinner.
        deps.notify({ tone: 'danger', message: refusalSummary(toDataError(error)) });
        throw error;
      }
    },
    /**
     * Cancels a job (AC-107): it shows `cancelling` (running) or `cancelled`
     * at once; a refusal puts it back and says why. Answers whether the
     * cancel landed.
     */
    async cancel(workspace: string, jobId: string): Promise<boolean> {
      const before = jobsOf(workspace).get(jobId);
      const shown: JobView | undefined =
        before === undefined
          ? undefined
          : { ...before, status: before.status === 'running' ? 'cancelling' : 'cancelled', cancellable: false };
      if (shown !== undefined) put(workspace, shown, true);
      const mutationId = deps.mintId();
      deps.mutations.sent(mutationId);
      try {
        const answer = await deps.api.cancel({ workspace, jobId, mutationId });
        deps.mutations.answered(mutationId, 1);
        put(workspace, answer, true);
        return true;
      } catch (error) {
        deps.mutations.forget(mutationId);
        const failure = toDataError(error);
        rollBack(workspace, jobId, shown, before, failure);
        // Finished meanwhile: read it again, so the row shows how it ended.
        if (failure.code === 'JOB_FINISHED') refetch(workspace, jobId);
        deps.notify({ tone: 'danger', message: refusalSummary(failure) });
        return false;
      }
    },
    /**
     * Confirms a job waiting in `ready` (AC-109): it shows `queued` at once; a
     * refusal (expired, finished, or not ready) puts it back, says why, and
     * reads it again so the row shows where it really is. Answers whether the
     * confirm landed.
     */
    async confirm(workspace: string, jobId: string): Promise<boolean> {
      const before = jobsOf(workspace).get(jobId);
      let shown: JobView | undefined;
      if (before !== undefined && before.status === 'ready') {
        const { expiresAt: _expiresAt, ...rest } = before;
        shown = { ...rest, status: 'queued' };
        put(workspace, shown, true);
      }
      const mutationId = deps.mintId();
      deps.mutations.sent(mutationId);
      try {
        const answer = await deps.api.confirm({ workspace, jobId, mutationId });
        deps.mutations.answered(mutationId, 1);
        put(workspace, answer, true);
        return true;
      } catch (error) {
        deps.mutations.forget(mutationId);
        const failure = toDataError(error);
        rollBack(workspace, jobId, shown, before, failure);
        if (failure.code !== 'NOT_FOUND') refetch(workspace, jobId);
        deps.notify({ tone: 'danger', message: refusalSummary(failure) });
        return false;
      }
    },
    /**
     * A live `jobs` event: the named jobs are read again when a view or this
     * browser's own start holds them, or a view could show them; a coarse one
     * rereads the unfinished jobs held and each view's first page, spread.
     */
    changed(workspace: string, event: LiveEventOf<'jobs'>) {
      const shown = viewsOf(workspace).some((view) => view.isRetained());
      if (event.coarse === true) {
        deps.spread(`jobs ${workspace}`, () => {
          for (const job of jobsOf(workspace).values()) if (!isFinished(job)) refetch(workspace, job.id);
          for (const view of viewsOf(workspace)) if (view.isRetained()) void view.reloadFirst();
        });
        return;
      }
      const jobs = jobsOf(workspace);
      const mine = startedHere.get(workspace);
      for (const jobId of event.jobIds) {
        if (shown || jobs.has(jobId) || mine?.has(jobId) === true) refetch(workspace, jobId);
      }
    },
    /** Everything held of the workspace is read again (a resync after a gap the outbox no longer covers). */
    resync(workspace: string) {
      for (const job of jobsOf(workspace).values()) if (!isFinished(job)) refetch(workspace, job.id);
      for (const view of viewsOf(workspace)) if (view.isRetained()) void view.reloadFirst();
    },
    /** Forgets everything: the session ended. */
    clear() {
      held.clear();
      views.clear();
      startedHere.clear();
      for (const stop of watching.values()) stop();
      watching.clear();
    },
  };
}

/** The jobs store. */
export type JobsStore = ReturnType<typeof createJobsStore>;
