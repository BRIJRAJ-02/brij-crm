// A workspace's members as its screens show them (spec 0005): the Owner
// column and the member picker resolve a member id to a name here; the
// Members page (spec 0031) reads their roles too.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Role } from './access.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid } from './values/ids.ts';

/** One active member: the id actor values carry, their name in this workspace, and their email. */
export const MemberSummary = z.object({
  id: Uuid,
  name: z.string(),
  email: z.string(),
});
/** One active member. */
export type MemberSummary = z.infer<typeof MemberSummary>;

/** One active member as the Members page lists them (spec 0031, AC-810): their role and when they joined. */
export const MemberView = MemberSummary.extend({
  role: Role,
  joinedAt: z.iso.datetime({ offset: true }),
});
/** One active member as the Members page lists them. */
export type MemberView = z.infer<typeof MemberView>;

/** A workspace's members. `list` answers the active ones, by name, with their roles, to every member. */
export const membersContract = {
  list: oc.input(WorkspaceScoped).output(z.array(MemberView)),
};
