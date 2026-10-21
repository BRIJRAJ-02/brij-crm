// Background jobs (spec 0008): what a job looks like to the screens, the
// queue payload the worker parses, the kinds' labels, and the `jobs.*`
// procedures. Long work runs in the worker as a job; the screens list jobs,
// follow their progress and cancel them. Every procedure is on the member
// door, and a job the caller may not see answers the same 404 as one that
// doesn't exist.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid, uuidV7 } from './values/ids.ts';

/**
 * Each kind the screens may name, with its label, its lane and whether it can
 * be cancelled. The registry in `packages/core` declares the rest (its params,
 * its step) and checks it matches this. `dev.simulate` and its light twin run
 * only locally and in previews (AC-123); `maintenance.daily` runs everywhere.
 */
export const JOB_KINDS = {
  'dev.simulate': { label: 'Test job', lane: 'heavy', cancellable: true },
  'dev.simulate_light': { label: 'Light test job', lane: 'light', cancellable: true },
  // The daily cleanup (milestone 3, AC-112): one per workspace a day, the system's, never cancelled.
  'maintenance.daily': { label: 'Daily cleanup', lane: 'heavy', cancellable: false },
  // A form submission turned into records (spec 0023, AC-554, AC-566): the system's, on the light lane.
  'forms.process': { label: 'Form submission', lane: 'light', cancellable: false },
  // Submissions filed with the form's current mapping (Add to CRM), a member's, one item per submission.
  'forms.file': { label: 'Add to CRM', lane: 'heavy', cancellable: true },
  // The current mapping applied to earlier submissions (Sync old records), a member's, safe to run again.
  'forms.sync': { label: 'Sync old records', lane: 'heavy', cancellable: true },
  // A form's submissions written to a CSV file (Export), a member's.
  'forms.export': { label: 'Export submissions', lane: 'heavy', cancellable: true },
  // Bulk changes (spec 0022, milestone 3): a member's, counted and confirmed first, in batches of 500.
  'records.bulk_edit': { label: 'Bulk edit', lane: 'heavy', cancellable: true },
  'records.bulk_delete': { label: 'Bulk delete', lane: 'heavy', cancellable: true },
  'records.bulk_restore': { label: 'Restore from trash', lane: 'heavy', cancellable: true },
  'records.purge': { label: 'Delete forever', lane: 'heavy', cancellable: true },
  // Import and export (spec 0037): a CSV's rows written as the member, taking one back, and a view written out.
  'records.import': { label: 'Import', lane: 'heavy', cancellable: true },
  'records.import_undo': { label: 'Undo import', lane: 'heavy', cancellable: false },
  'records.export': { label: 'Export', lane: 'heavy', cancellable: true },
} as const satisfies Record<
  string,
  { readonly label: string; readonly lane: 'heavy' | 'light'; readonly cancellable: boolean }
>;

/** A kind the screens know by name. */
export const JobKind = z.enum(Object.keys(JOB_KINDS) as [keyof typeof JOB_KINDS, ...(keyof typeof JOB_KINDS)[]]);
/** A kind the screens know by name. */
export type JobKind = z.infer<typeof JobKind>;

/** What the screens call a kind they don't know (a newer deploy's, or a test's). */
export const UNKNOWN_JOB_LABEL = 'Background job';

/** A kind's label for the screens: its `JOB_KINDS` label, or `UNKNOWN_JOB_LABEL`. */
export function jobLabel(kind: string): string {
  return Object.hasOwn(JOB_KINDS, kind) ? JOB_KINDS[kind as JobKind].label : UNKNOWN_JOB_LABEL;
}

/** Every status a job moves through (spec 0008, state transitions). */
export const JOB_STATUSES = [
  'preparing',
  'ready',
  'queued',
  'running',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
] as const;
/** Where a job is. */
export const JobStatus = z.enum(JOB_STATUSES);
/** Where a job is. */
export type JobStatus = z.infer<typeof JobStatus>;

/** The statuses a job never leaves. */
export const FINISHED_JOB_STATUSES: readonly JobStatus[] = ['succeeded', 'failed', 'cancelled'];

/** True for a status a job never leaves. */
export function isFinishedJob(status: JobStatus): boolean {
  return FINISHED_JOB_STATUSES.includes(status);
}

/**
 * The codes a job itself can end with (`JobView.error.code`, never an HTTP
 * answer): its batches kept failing, its params no longer parse (or its kind
 * is gone after a deploy), its starter was removed, its workspace was
 * deleted, or it waited unconfirmed past its hour. A step's own `failed`
 * outcome names an existing code from the error map instead.
 */
export const JOB_OUTCOME_CODES = [
  'JOB_FAILED',
  'JOB_INVALID',
  'ACTOR_REMOVED',
  'WORKSPACE_GONE',
  'JOB_EXPIRED',
] as const;

/** The most record ids one refusal group names (AC-105). */
export const REFUSAL_GROUP_IDS = 20;

/** Refused items of one code: how many, and the first ids by position. */
export const JobRefusalGroup = z.object({
  code: z.string(),
  count: z.number().int().min(1),
  itemIds: z.array(Uuid).max(REFUSAL_GROUP_IDS),
});
/** Refused items of one code. */
export type JobRefusalGroup = z.infer<typeof JobRefusalGroup>;

/** A job's summary: its refusals grouped by code (AC-105), and whatever else the kind reports. */
export const JobResult = z
  .object({
    refusals: z.array(JobRefusalGroup).optional(),
  })
  .catchall(z.unknown());
/** A job's summary. */
export type JobResult = z.infer<typeof JobResult>;

/** Who started a job: a member (by member id), or the system. */
export const JobStarter = z.object({
  type: z.enum(['member', 'system']),
  memberId: Uuid.optional(),
});
/** Who started a job. */
export type JobStarter = z.infer<typeof JobStarter>;

/**
 * One job as a screen shows it: its kind and label, where it is, its
 * progress (`total` absent when the kind can't know it, so the bar is
 * indeterminate), who started it, its times, `retryAt` while a failed try
 * waits, `expiresAt` while it waits for a confirm, how it ended, its summary,
 * and whether the caller may cancel it now.
 */
export const JobView = z.object({
  id: Uuid,
  kind: z.string(),
  label: z.string(),
  status: JobStatus,
  subject: z.object({ type: z.string(), id: Uuid }).optional(),
  total: z.number().int().min(0).optional(),
  done: z.number().int().min(0),
  refused: z.number().int().min(0),
  skipped: z.number().int().min(0),
  startedBy: JobStarter,
  createdAt: z.iso.datetime({ offset: true }),
  startedAt: z.iso.datetime({ offset: true }).optional(),
  finishedAt: z.iso.datetime({ offset: true }).optional(),
  retryAt: z.iso.datetime({ offset: true }).optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  result: JobResult.optional(),
  cancellable: z.boolean(),
});
/** One job as a screen shows it. */
export type JobView = z.infer<typeof JobView>;

/** The most jobs one page of `jobs.list` holds. */
export const JOBS_PAGE = 50;

/**
 * A page of jobs: `mine` (the caller's own) or `all` (every job in the
 * workspace, system ones included, for holders of `jobs.manage`). Unfinished
 * jobs come first, then those finished in the last 30 days, newest first.
 */
export const JobsListInput = WorkspaceScoped.extend({
  scope: z.enum(['mine', 'all']).default('mine'),
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(JOBS_PAGE).optional(),
});
/** A page of jobs to read. */
export type JobsListInput = z.input<typeof JobsListInput>;

/** A page of jobs, and the cursor for the next one when there is more. */
export const JobList = z.object({
  jobs: z.array(JobView),
  nextCursor: z.string().optional(),
});
/** A page of jobs. */
export type JobList = z.infer<typeof JobList>;

/** One job, by id. */
export const JobInput = WorkspaceScoped.extend({ jobId: Uuid });
/** One job, by id. */
export type JobInput = z.infer<typeof JobInput>;

/** A change to one job (cancel, confirm), with the browser's id for the write. */
export const JobWriteInput = JobInput.extend({ mutationId: Uuid });
/** A change to one job. */
export type JobWriteInput = z.infer<typeof JobWriteInput>;

/** The most items one job holds (AC-116). */
export const MAX_JOB_ITEMS = 1_000_000;

/** The most items a test job may have. */
export const MAX_TEST_JOB_ITEMS = 200_000;

/**
 * A test job (`dev.simulate`, local and previews only): `id` is the browser's
 * uuid v7 and the retry key; `items` synthetic items, `batchSize` a batch,
 * each batch waiting `batchMillis`, every `refuseEvery`th item refused with
 * `SIMULATED_REFUSAL`, and one throw at `failAtPosition` (retried). With
 * `confirm`, its items come from a snapshot and it waits in `ready` for
 * `jobs.confirm`.
 */
export const StartTestJobInput = WorkspaceScoped.extend({
  id: uuidV7('The job id must be a UUID v7.'),
  items: z.number().int().min(1).max(MAX_TEST_JOB_ITEMS),
  batchSize: z.number().int().min(1).max(5_000).optional(),
  batchMillis: z.number().int().min(0).max(2_000).default(0),
  failAtPosition: z.number().int().min(1).optional(),
  refuseEvery: z.number().int().min(1).optional(),
  /** Snapshot the items in the background, then wait for `jobs.confirm` (AC-109). */
  confirm: z.boolean().optional(),
  mutationId: Uuid,
});
/** A test job to start. */
export type StartTestJobInput = z.input<typeof StartTestJobInput>;

/**
 * What a Graphile queue row carries for a job: its workspace and its id,
 * nothing else (AC-115). Strict, so a row with anything more is refused.
 */
export const QueuePayload = z.strictObject({
  workspaceId: Uuid,
  jobId: Uuid,
});
/** What a queue row carries. */
export type QueuePayload = z.infer<typeof QueuePayload>;

/**
 * Background jobs, on the member door. `list` and `get` read; `cancel`
 * (the starter, or `jobs.manage`), `confirm` (the same; a `ready` job only)
 * and `startTest` (`jobs.manage`, local and previews only, else 404) write.
 * A job the caller may not see is 404 `NOT_FOUND`; cancelling a finished job
 * is 409 `JOB_FINISHED`, and one whose kind can't be cancelled 409
 * `JOB_NOT_CANCELLABLE`.
 */
export const jobsContract = {
  list: oc.input(JobsListInput).output(JobList),
  get: oc.input(JobInput).output(JobView),
  cancel: oc.input(JobWriteInput).output(JobView),
  confirm: oc.input(JobWriteInput).output(JobView),
  startTest: oc.input(StartTestJobInput).output(JobView),
};
