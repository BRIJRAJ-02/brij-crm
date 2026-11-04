// Following a background job a form screen started (Add to CRM, Sync old records, an export) to its end, through the
// one jobs view the data layer keeps live. The screen says what it started; this calls it back once the job is done.
import type { JobView, JobsView } from '@crm/data';
import { useJobs } from '@crm/data/react';
import { useEffect, useRef } from 'react';

/** The jobs the data layer holds one by one (`data.jobs.get` and `follow` for one workspace). */
export interface HeldJobs {
  readonly get: (jobId: string) => JobView | undefined;
  readonly follow: (listener: () => void) => () => void;
}

/** The statuses a job never leaves. */
const FINISHED: readonly JobView['status'][] = ['succeeded', 'failed', 'cancelled'];

/**
 * The reader's jobs, live while the screen shows, and `follow(jobId, onDone)`,
 * which calls `onDone` once with the job when it finishes. `job(id)` reads one
 * for its progress.
 */
export function useJobFollower(view: JobsView, held?: HeldJobs) {
  const snapshot = useJobs(view);
  const waiting = useRef(new Map<string, (job: JobView) => void>());
  // The latest jobs, so `follow` can answer at once for a job that finished before it was followed.
  const latest = useRef(snapshot.jobs);
  useEffect(() => {
    latest.current = snapshot.jobs;
    for (const job of snapshot.jobs) {
      const done = waiting.current.get(job.id);
      if (done !== undefined && FINISHED.includes(job.status)) {
        waiting.current.delete(job.id);
        done(job);
      }
    }
  }, [snapshot]);
  // A job this tab started is also held one by one, and read again on a timer while live updates are paused (forms
  // fix a7: an export waited forever with them paused). Its end is heard from there too, once.
  useEffect(() => {
    if (held === undefined) return undefined;
    return held.follow(() => {
      for (const [jobId, done] of waiting.current) {
        const job = held.get(jobId);
        if (job !== undefined && FINISHED.includes(job.status)) {
          waiting.current.delete(jobId);
          done(job);
        }
      }
    });
  }, [held]);
  return {
    follow: (jobId: string, onDone: (job: JobView) => void) => {
      const known = latest.current.find((each) => each.id === jobId);
      if (known !== undefined && FINISHED.includes(known.status)) {
        onDone(known);
        return;
      }
      waiting.current.set(jobId, onDone);
      // The view takes in a new job only once its first page is read: read it now (once), so this job joins it, as
      // it is or as its live events tell. Retaining it alone never reads it.
      void view.ready();
    },
    job: (jobId: string | undefined) =>
      jobId === undefined ? undefined : snapshot.jobs.find((each) => each.id === jobId),
  };
}

/** A job's progress as a percentage, when it knows its total. */
export function progressOf(job: JobView | undefined): number | undefined {
  if (job?.total === undefined || job.total === 0) return undefined;
  return Math.round(((job.done + job.refused + job.skipped) / job.total) * 100);
}
