// A workspace's members as its screens show them (spec 0005): the Owner
// column and, later, the member picker resolve a member id to a name here.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { WorkspaceScoped } from './workspaces.ts';

/** One active member: the id actor values carry, their name in this workspace, and their email. */
export const MemberSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
});
/** One active member. */
export type MemberSummary = z.infer<typeof MemberSummary>;

/** A workspace's members. `list` answers the active ones, by name. */
export const membersContract = {
  list: oc.input(WorkspaceScoped).output(z.array(MemberSummary)),
};
