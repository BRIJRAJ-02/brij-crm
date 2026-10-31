// A record's files (#32): the Files tab on every record. The bytes go up through
// `POST /api/records/:recordId/files` (the body is the file, as a form's file
// answer is) and come back through `GET /api/files/:fileId`; listing, deleting
// and bringing one back are the `files.*` procedures behind the member door.
// The limits live here, the one place, so the screen refuses early and the
// server enforces the same. Whoever may read the record lists and downloads its
// files; whoever may change it adds, deletes and restores them.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Timestamp } from './values/attribute-values.ts';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

export * from './file-limits.ts';

/** One file on a record's Files tab, as a reader sees it. */
export const RecordFileView = z.object({
  fileId: Uuid,
  recordId: Uuid,
  /** Made safe at upload (`sanitiseFileName`). */
  name: z.string(),
  size: z.number().int().min(0),
  contentType: z.string(),
  createdAt: Timestamp,
  /** The member who added it; absent for a file nobody signed in added. */
  createdByMemberId: Uuid.optional(),
});
/** One file on a record's Files tab. */
export type RecordFileView = z.infer<typeof RecordFileView>;

/** A record's files, newest first (at most 100, so no paging), and whether the reader may add or delete them. */
export const RecordFiles = z.object({
  files: z.array(RecordFileView),
  canChange: z.boolean(),
});
/** A record's files. */
export type RecordFiles = z.infer<typeof RecordFiles>;

/** A record's files. */
export const ListRecordFilesInput = WorkspaceScoped.extend({ recordId: Uuid });
/** A record's files. */
export type ListRecordFilesInput = z.infer<typeof ListRecordFilesInput>;

/** Deletes a file from a record's Files tab, or brings a deleted one back (its Undo). */
export const RecordFileChangeInput = WorkspaceScoped.extend({ fileId: Uuid, mutationId: Uuid });
/** Deletes or brings back a record's file. */
export type RecordFileChangeInput = z.infer<typeof RecordFileChangeInput>;

/** The record files procedures (#32). Every one takes `WorkspaceScoped` input and is served behind the member door. */
export const filesContract = {
  list: oc.input(ListRecordFilesInput).output(RecordFiles),
  delete: oc.input(RecordFileChangeInput).output(RecordFileView),
  restore: oc.input(RecordFileChangeInput).output(RecordFileView),
};
