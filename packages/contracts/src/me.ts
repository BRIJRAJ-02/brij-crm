// The signed in person (spec 0005): who they are and which workspaces they
// are in, so the app knows where to go after sign in.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { WorkspaceSummary } from './workspaces.ts';

/** The signed in person. `name` is empty until they give one (an email code sign up starts without). */
export const SignedInUser = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
});
/** The signed in person. */
export type SignedInUser = z.infer<typeof SignedInUser>;

/** Who is signed in, and their workspaces, oldest first (the first is where `/` goes). */
export const Me = z.object({
  user: SignedInUser,
  workspaces: z.array(WorkspaceSummary),
});
/** Who is signed in, and their workspaces. */
export type Me = z.infer<typeof Me>;

/** The signed in person: needs a session, answers 401 `UNAUTHENTICATED` without one. */
export const meContract = {
  get: oc.output(Me),
};
