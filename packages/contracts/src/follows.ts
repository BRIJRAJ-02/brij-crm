// Following a record (collaboration: "changes to records you follow reach your inbox live"), and a workspace's
// sample data. A follow is the caller's own: no procedure takes a member id. A record the caller can't read answers
// 404 `NOT_FOUND`, the same as one that doesn't exist.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** Whether the caller follows a record. */
export const FollowState = z.object({ following: z.boolean() });
/** Whether the caller follows a record. */
export type FollowState = z.infer<typeof FollowState>;

/** One record the caller may read. */
export const FollowInput = WorkspaceScoped.extend({ recordId: Uuid });
/** One record the caller may read. */
export type FollowInput = z.infer<typeof FollowInput>;

/** Follows or unfollows a record. */
export const SetFollowInput = FollowInput.extend({ following: z.boolean(), mutationId: Uuid });
/** Follows or unfollows a record. */
export type SetFollowInput = z.infer<typeof SetFollowInput>;

/** The follow procedures, behind the member door. */
export const followsContract = {
  get: oc.input(FollowInput).output(FollowState),
  set: oc.input(SetFollowInput).output(FollowState),
};

/**
 * A workspace's sample data: whether any is live (`present`), the job adding it while one runs, and whether the
 * caller may add or remove it (owners and admins: it also sets Deals' stages and a Pipeline board).
 */
export const SampleDataState = z.object({
  present: z.boolean(),
  jobId: Uuid.optional(),
  canManage: z.boolean(),
});
/** A workspace's sample data. */
export type SampleDataState = z.infer<typeof SampleDataState>;

/** Starts adding sample data: answers the job. */
export const AddSampleDataInput = WorkspaceScoped.extend({ mutationId: Uuid });
/** Starts adding sample data. */
export type AddSampleDataInput = z.infer<typeof AddSampleDataInput>;

/** What adding sample data started. */
export const SampleDataJob = z.object({ jobId: Uuid });
/** What adding sample data started. */
export type SampleDataJob = z.infer<typeof SampleDataJob>;

/** Removes the sample data, as one batch its Undo brings back (`batchId`, a UUID v7 the client makes). */
export const RemoveSampleDataInput = WorkspaceScoped.extend({ batchId: Uuid, mutationId: Uuid });
/** Removes the sample data. */
export type RemoveSampleDataInput = z.infer<typeof RemoveSampleDataInput>;

/** How many sample records a remove (or its Undo) moved. */
export const SampleDataMoved = z.object({ records: z.number().int().min(0) });
/** How many sample records moved. */
export type SampleDataMoved = z.infer<typeof SampleDataMoved>;

/** The sample data procedures, behind the member door. */
export const sampleDataContract = {
  get: oc.input(WorkspaceScoped).output(SampleDataState),
  add: oc.input(AddSampleDataInput).output(SampleDataJob),
  remove: oc.input(RemoveSampleDataInput).output(SampleDataMoved),
  undoRemove: oc.input(RemoveSampleDataInput).output(SampleDataMoved),
};
