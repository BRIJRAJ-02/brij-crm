// A background bulk change a bar starts and follows (spec 0022, milestone 3):
// starting it with an id minted once per intent (a start sent again names the
// same job, AC-540), its count ("Counting…"), the count it waits on for its
// confirm ("12,345 people counted", with Review), its progress with Cancel
// ("Stopping after this batch…" once cancelled), and how it ended when nothing
// else says so: a count of zero ("Nothing left to change.") or a failure before
// it touched anything (its reason, AC-539), in the bar, or in a toast for a
// change started outside it (Empty trash). Any other end raises the app's
// finish toast (`onJobFinished`), so it arrives on any page. A change still
// counting or waiting for its confirm is cancelled when the screen goes, so it
// never waits an hour unconfirmed. Shared by the records table and the Trash.
import {
  dataError,
  isDataError,
  type BulkAction,
  type BulkEdit,
  type BulkTarget,
  type DataError,
  type JobView,
} from '@crm/data';
import { useJob } from '@crm/data/react';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { bulkStrings, jobProgress, type ObjectNames } from './bulk.ts';

/** The statuses a job never leaves. */
const FINISHED: ReadonlySet<string> = new Set(['succeeded', 'failed', 'cancelled']);

/** The statuses of a change that hasn't run yet: counting, or waiting for its confirm. */
const UNCONFIRMED: ReadonlySet<string> = new Set(['preparing', 'ready']);

/** How long a note in the bar stays ("Nothing left to change."). */
const NOTE_MS = 4000;

/** Where a change's own ending is said: in the bar that started it, or in a toast (started outside the bar). */
export type NotesIn = 'bar' | 'toast';

/** A short note for the bar: a count of zero (info), or why a change was refused or failed (danger). */
export interface BulkNote {
  readonly text: string;
  readonly tone: 'info' | 'danger';
}

/** What a bar knows of the job it follows. */
export interface BulkJob {
  /** What it does, while one is followed. */
  readonly action: BulkAction | undefined;
  /** The job as held now, while one is followed. */
  readonly job: JobView | undefined;
  /** A job is starting or followed: the bar shows its progress in the actions' place. */
  readonly isRunning: boolean;
  /** Its start is out, nothing to cancel yet ("Starting"). */
  readonly isStarting: boolean;
  /** The bar's progress ("Counting…", "12,345 people counted", "Deleting 4,500 of 12,345"), while it runs. */
  readonly progress: { readonly label: string; readonly value?: number } | undefined;
  /** Counted and waiting for its confirm: the bar offers Review, and the confirm shows `job.total`. */
  readonly isCounted: boolean;
  /** Cancel was pressed while it ran: it stops after its current batch. */
  readonly isCancelling: boolean;
  /** Cancel is offered: it can be cancelled now, or stays (pending) while the change stops. */
  readonly canCancel: boolean;
  /** A note for the bar: a count of zero, or why a start was refused or the change failed. */
  readonly note: BulkNote | undefined;
  /**
   * Says something in the bar: `info` ("Nothing left to change.") goes after
   * a few seconds; `danger` (a refused start) stays until the next start or
   * `forget`, so a refusal is never missed.
   */
  readonly say: (text: string, tone?: 'info' | 'danger') => void;
  /** Lets the note go (the selection was cleared). */
  readonly forget: () => void;
  /**
   * Starts a job; answers why it was refused, if it was (nothing is followed
   * then). Pressed again for the same change, it sends the same id. `notesIn`
   * says where its own ending is said: `toast` for a change started outside
   * the bar.
   */
  readonly start: (
    action: BulkAction,
    target: BulkTarget,
    edit?: BulkEdit,
    notesIn?: NotesIn,
  ) => Promise<DataError | undefined>;
  /** Confirms the counted job: it runs on its snapshot. */
  readonly confirm: () => void;
  /** Cancels the job: before its next batch, what it did stays done. */
  readonly cancel: () => void;
}

/** Whether focus fell to the page (its control went with a change), so it may be handed on without taking it. */
export function isFocusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
}

/**
 * What makes two starts the same change: the action, what it acts on and the
 * edit, without the moment they were asked at (`asOf`, `now`), and ids in
 * order, so the same selection asked twice is one intent.
 */
function intentOf(action: BulkAction, target: BulkTarget, edit: BulkEdit | undefined): string {
  const { kind } = target;
  const on =
    target.kind === 'ids'
      ? { kind, objectId: target.objectId ?? null, ids: [...target.recordIds].sort() }
      : target.kind === 'matching'
        ? { kind, objectId: target.objectId, filter: target.filter ?? null, except: [...target.except].sort() }
        : target.kind === 'trash'
          ? { kind, objectId: target.objectId ?? null, except: [...target.except].sort() }
          : { kind, batchId: target.batchId };
  return JSON.stringify({ action, on, edit: edit ?? null });
}

/**
 * A bulk change this bar starts and follows until it ends. `names` count its
 * records ("12,345 people counted"); `onNothingLeft` hears a count of zero, so
 * the screen clears the selection the change was for.
 */
export function useBulkJob(slug: string, names: ObjectNames, onNothingLeft?: () => void): BulkJob {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const [following, setFollowing] = useState<
    { readonly jobId: string; readonly action: BulkAction; readonly notesIn: NotesIn } | undefined
  >(undefined);
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<BulkNote | undefined>(undefined);
  // How the last followed job ended, when it needs saying outside the bar (a toast) or the selection clearing.
  const [ended, setEnded] = useState<
    { readonly jobId: string; readonly toast?: BulkNote; readonly isNothingLeft: boolean } | undefined
  >(undefined);
  // Kept current by the jobs store: live, or read again on its own timer while live updates are paused or off.
  const job = useJob(data.jobs, slug, following?.jobId);
  // The id of the change asked for now, minted once per intent: a start sent again after a lost answer, or
  // Delete pressed again, names the same job, and the server answers the one it made (AC-540).
  const intent = useRef<{ readonly key: string; readonly id: string } | undefined>(undefined);
  // Ended: the bar lets it go. A count of zero, or a failure before it touched anything, is said here (AC-539);
  // any other end has the app's toast.
  if (following !== undefined && job !== undefined && FINISHED.has(job.status)) {
    setFollowing(undefined);
    const isNothingLeft = job.status === 'succeeded' && (job.total ?? 0) === 0;
    const isFailedUntouched = job.status === 'failed' && job.done + job.refused + job.skipped === 0;
    const said: BulkNote | undefined = isNothingLeft
      ? { text: bulkStrings.nothingToChange, tone: 'info' }
      : isFailedUntouched
        ? { text: job.error?.message ?? bulkStrings.somethingWrong, tone: 'danger' }
        : undefined;
    if (said !== undefined && following.notesIn === 'bar') setNote(said);
    setEnded({
      jobId: job.id,
      ...(said !== undefined && following.notesIn === 'toast' ? { toast: said } : {}),
      isNothingLeft,
    });
  }
  const tellNothingLeft = useRef(onNothingLeft);
  useLayoutEffect(() => {
    tellNothingLeft.current = onNothingLeft;
  });
  useEffect(() => {
    if (ended === undefined) return;
    if (ended.toast !== undefined) toasts.toast({ tone: ended.toast.tone, message: ended.toast.text });
    if (ended.isNothingLeft) tellNothingLeft.current?.();
  }, [ended, toasts]);
  useEffect(() => {
    if (note === undefined || note.tone === 'danger') return;
    const timer = setTimeout(() => {
      setNote(undefined);
    }, NOTE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [note]);

  // A change still counting or waiting for its confirm when the screen goes has nobody left to confirm it: it is
  // cancelled, so it never waits an hour unconfirmed (AC-528). A confirmed one runs on.
  const latest = useRef<{ readonly jobId?: string; readonly status?: string }>({});
  useLayoutEffect(() => {
    latest.current = {
      ...(following === undefined ? {} : { jobId: following.jobId }),
      ...(job === undefined ? {} : { status: job.status }),
    };
  });
  const isGone = useRef(false);
  useEffect(() => {
    isGone.current = false;
    return () => {
      isGone.current = true;
      const { jobId, status } = latest.current;
      if (jobId !== undefined && status !== undefined && UNCONFIRMED.has(status)) void data.jobs.cancel(slug, jobId);
    };
  }, [data, slug]);

  return {
    action: following?.action,
    job,
    isRunning: following !== undefined || starting,
    isStarting: starting,
    progress: job === undefined ? (starting ? { label: bulkStrings.starting } : undefined) : jobProgress(job, names),
    isCounted: job?.status === 'ready',
    isCancelling: job?.status === 'cancelling',
    canCancel: job !== undefined && (job.cancellable || job.status === 'cancelling'),
    note,
    say: (text, tone = 'info') => {
      setNote({ text, tone });
    },
    forget: () => {
      setNote(undefined);
    },
    start: async (action, target, edit, notesIn = 'bar') => {
      const key = intentOf(action, target, edit);
      const id = intent.current?.key === key ? intent.current.id : data.jobs.newId();
      intent.current = { key, id };
      setStarting(true);
      setNote(undefined);
      try {
        const made = await data.records.startBulk(slug, {
          id,
          action,
          target,
          ...(edit === undefined ? {} : { edit }),
        });
        // Followed: the next start is a new change.
        intent.current = undefined;
        // The screen went while it started: nobody is left to confirm it.
        if (isGone.current) {
          if (UNCONFIRMED.has(made.status)) void data.jobs.cancel(slug, made.id);
          return undefined;
        }
        setFollowing({ jobId: made.id, action, notesIn });
        return undefined;
      } catch (error) {
        // The id stays: pressed again for the same change, a start that did land is answered, never made twice.
        return isDataError(error) ? error : dataError('INTERNAL', bulkStrings.somethingWrong);
      } finally {
        setStarting(false);
      }
    },
    // Both show at once in the store (the job leaves `ready`), so the confirm closes.
    confirm: () => {
      if (following !== undefined) void data.jobs.confirm(slug, following.jobId);
    },
    cancel: () => {
      if (following !== undefined) void data.jobs.cancel(slug, following.jobId);
    },
  };
}
