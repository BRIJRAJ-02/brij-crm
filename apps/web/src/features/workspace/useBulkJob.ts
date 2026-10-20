// A background bulk change a bar starts and follows (spec 0022, milestone 3):
// starting it with an id minted once, its count ("Counting…"), the confirm it
// waits for with the exact number, its progress with Cancel, and a count of
// zero said in the bar ("Nothing left to change."). Any other end raises the
// app's finish toast (`onJobFinished`), so it arrives on any page. Shared by
// the records table and the Trash.
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
import { useEffect, useState } from 'react';
import { bulkStrings, jobProgress } from './bulk.ts';

/** The statuses a job never leaves. */
const FINISHED: ReadonlySet<string> = new Set(['succeeded', 'failed', 'cancelled']);

/** How long a note in the bar stays ("Nothing left to change."). */
const NOTE_MS = 4000;

/** What a bar knows of the job it follows. */
export interface BulkJob {
  /** What it does, while one is followed. */
  readonly action: BulkAction | undefined;
  /** The job as held now, while one is followed. */
  readonly job: JobView | undefined;
  /** A job is starting or followed: the bar shows its progress in the actions' place. */
  readonly isRunning: boolean;
  /** The bar's progress ("Counting…", "Deleting 4,500 of 12,345"), while it counts or runs. */
  readonly progress: { readonly label: string; readonly value?: number } | undefined;
  /** A counted job waiting for its confirm, with its exact total. */
  readonly awaiting: JobView | undefined;
  /** A short note for the bar: a count of zero, or why a start was refused. */
  readonly note: { readonly text: string; readonly tone: 'info' | 'danger' } | undefined;
  /**
   * Says something in the bar: `info` ("Nothing left to change.") goes after
   * a few seconds; `danger` (a refused start) stays until the next start or
   * `forget`, so a refusal is never missed.
   */
  readonly say: (text: string, tone?: 'info' | 'danger') => void;
  /** Lets the note go (the selection was cleared). */
  readonly forget: () => void;
  /** Starts a job; answers why it was refused, if it was (nothing is followed then). */
  readonly start: (action: BulkAction, target: BulkTarget, edit?: BulkEdit) => Promise<DataError | undefined>;
  /** Confirms the counted job: it runs on its snapshot. */
  readonly confirm: () => void;
  /** Cancels the job: before its next batch, what it did stays done. */
  readonly cancel: () => void;
}

/** A bulk change this bar starts and follows until it ends. */
export function useBulkJob(slug: string): BulkJob {
  const { data } = useRouteContext({ from: '__root__' });
  const [following, setFollowing] = useState<{ readonly jobId: string; readonly action: BulkAction } | undefined>(
    undefined,
  );
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<BulkJob['note']>(undefined);
  const job = useJob(data.jobs, slug, following?.jobId);
  // Ended: the bar lets it go (a count of zero says so there; any other end has the app's toast).
  if (following !== undefined && job !== undefined && FINISHED.has(job.status)) {
    setFollowing(undefined);
    if (job.status === 'succeeded' && (job.total ?? 0) === 0) {
      setNote({ text: bulkStrings.nothingToChange, tone: 'info' });
    }
  }
  useEffect(() => {
    if (note === undefined || note.tone === 'danger') return;
    const timer = setTimeout(() => {
      setNote(undefined);
    }, NOTE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [note]);
  return {
    action: following?.action,
    job,
    isRunning: following !== undefined || starting,
    progress: job === undefined ? (starting ? { label: bulkStrings.starting } : undefined) : jobProgress(job),
    awaiting: job?.status === 'ready' ? job : undefined,
    note,
    say: (text, tone = 'info') => {
      setNote({ text, tone });
    },
    forget: () => {
      setNote(undefined);
    },
    start: async (action, target, edit) => {
      setStarting(true);
      setNote(undefined);
      try {
        const made = await data.records.startBulk(slug, {
          id: data.jobs.newId(),
          action,
          target,
          ...(edit === undefined ? {} : { edit }),
        });
        setFollowing({ jobId: made.id, action });
        return undefined;
      } catch (error) {
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
