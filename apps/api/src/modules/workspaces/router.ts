import { startWorkspace, workspaceSlugAvailable } from '@crm/core';
import { apiError, withInputFields } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { sendMilestones } from '../../monitoring/milestones.ts';
import { authed } from '../../orpc.ts';

/**
 * Web address checks one person may make a minute (spec 0036, AC-1215): far
 * more than anyone types, since first run asks 300 ms after the last key.
 */
export const SLUG_CHECKS_PER_MINUTE = { window: 60, max: 60 } as const;

/**
 * And a day: first run takes a handful, so a day's checks can't quietly walk
 * a list of company names to learn which have a workspace here.
 */
export const SLUG_CHECKS_PER_DAY = { window: 24 * 60 * 60, max: 500 } as const;

const VERIFY_FIRST = 'Verify your email by signing in with a code, then create a workspace.';

// Bootstrap: a session and a verified email; the workspace doesn't exist yet.
export const workspacesRouter = authed.workspaces.router({
  create: authed.workspaces.create.handler(async ({ context, input }) => {
    if (!context.user.emailVerified) throw apiError('EMAIL_UNVERIFIED', VERIFY_FIRST);
    // While sign up is closed, an account an invitation let in joins that workspace and starts none of its own
    // (spec 0031, owner decision 3), so one invitation can't grow into more people sending invitations.
    if (!context.mayStartWorkspace(context.user.email)) {
      throw apiError(
        'SIGNUP_CLOSED',
        'Making a workspace isn’t open yet. To join your team, open the invitation they emailed you.',
      );
    }
    // No hooks and no events (see commitWrite): its poke only costs the relay one empty look.
    const started = await commitWrite(context, undefined, () =>
      startWorkspace({ db: context.db, identity: context.identity }, context.user, input),
    ).catch((error: unknown) => {
      throw withInputFields(error, { SLUG_TAKEN: 'slug', ID_TAKEN: 'id' });
    });
    // Committed: `workspace_created` when this request made it (spec 0010, AC-175), nothing on a replay.
    sendMilestones(context, started.milestones);
    return { workspace: started.workspace };
  }),
  // First run's address field, as it is typed: the directory alone, counted per person across instances.
  slugAvailable: authed.workspaces.slugAvailable.handler(async ({ context, input }) => {
    if (!context.user.emailVerified) throw apiError('EMAIL_UNVERIFIED', VERIFY_FIRST);
    // Both windows count every check, so neither runs ahead of the other. The keys hold no `|`, so they never meet
    // Better Auth's own `<ip>|<path>` ones.
    const key = `workspace-slug:${context.user.id}`;
    const [minute, day] = await Promise.all([
      context.identity.consumeRateLimit(key, SLUG_CHECKS_PER_MINUTE),
      context.identity.consumeRateLimit(`${key}:day`, SLUG_CHECKS_PER_DAY),
    ]);
    if (!minute.allowed || !day.allowed) {
      throw apiError('RATE_LIMITED', 'Too many address checks. Wait a while, then try again.');
    }
    return workspaceSlugAvailable({ identity: context.identity }, input.slug);
  }),
});
