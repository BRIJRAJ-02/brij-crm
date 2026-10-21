// Settings › Workspace › General (spec 0031, slice 7, AC-822, AC-823): the
// workspace's name, default time zone and fixed address, and the owner's
// delete and restore. The `workspace` namespace (singular) is the open
// workspace's own settings; `workspaces` (plural) is the list you are in.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { TimeZoneName } from './booking/settings.ts';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped, WorkspaceSlug } from './workspaces.ts';

/** How long a deleted workspace waits before its purge, while an owner can restore it (AC-823). */
export const WORKSPACE_PURGE_DAYS = 30;

/** A workspace's name: 1 to 64 characters, trimmed (AC-822). */
export const WorkspaceName = z.string().trim().min(1, 'Name the workspace.').max(64, 'Use at most 64 characters.');
/** A workspace's name. */
export type WorkspaceName = z.infer<typeof WorkspaceName>;

/** The open workspace's settings, as Workspace › General shows them to any member. */
export const WorkspaceSettings = z.object({
  id: Uuid,
  name: z.string(),
  slug: WorkspaceSlug,
  timeZone: z.string(),
  /** A logo on our origin; absent until #32, so the page shows initials. */
  logoUrl: z.string().optional(),
});
/** The open workspace's settings. */
export type WorkspaceSettings = z.infer<typeof WorkspaceSettings>;

/** A change to the workspace's name, default time zone, or both (`workspace.manage`). */
export const UpdateWorkspaceInput = WorkspaceScoped.extend({
  name: WorkspaceName.optional(),
  timeZone: TimeZoneName.optional(),
  mutationId: Uuid,
});
/** A change to the workspace's settings. */
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceInput>;

/** Deleting the workspace: the owner types its name to confirm (AC-823, the owner, 21 October 2026). */
export const DeleteWorkspaceInput = WorkspaceScoped.extend({
  confirmName: z.string().max(200),
  mutationId: Uuid,
});
/** Deleting the workspace. */
export type DeleteWorkspaceInput = z.infer<typeof DeleteWorkspaceInput>;

/** A deleted workspace as its owner sees it within the window: its name, and when it goes for good. */
export const DeletedWorkspace = z.object({
  name: z.string(),
  slug: WorkspaceSlug,
  purgeAfter: z.iso.datetime({ offset: true }),
});
/** A deleted workspace, as its owner sees it. */
export type DeletedWorkspace = z.infer<typeof DeletedWorkspace>;

/**
 * The open workspace's settings. `get` answers any member; `update` needs
 * `workspace.manage`; `delete` is owners only (`workspace.delete`) and
 * refuses 422 `CONFIRM_MISMATCH` unless `confirmName` is the workspace's name.
 */
export const workspaceContract = {
  get: oc.input(WorkspaceScoped).output(WorkspaceSettings),
  update: oc.input(UpdateWorkspaceInput).output(WorkspaceSettings),
  delete: oc.input(DeleteWorkspaceInput).output(DeletedWorkspace),
};

/**
 * A deleted workspace's owners, before any workspace scope (the door refuses
 * a deleted workspace): `deleted` and `restore` each answer an owner of it
 * within its window, and NOT_FOUND to anyone else, as for an unknown address.
 */
export const deletedWorkspaceContract = {
  deleted: oc.input(WorkspaceScoped).output(DeletedWorkspace),
  restore: oc.input(WorkspaceScoped.extend({ mutationId: Uuid })).output(WorkspaceSettings),
};
