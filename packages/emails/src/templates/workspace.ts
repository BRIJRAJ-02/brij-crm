// A deleted workspace's notice (spec 0031, AC-823), to each active member.
// An owner's has the button back to restore it within the window.
import type { WorkspaceDeletedEmail, WorkspaceRestoredEmail } from '@crm/contracts/emails';
import { workspaceOf, type Template } from '../template.ts';

/** The workspace was deleted: nobody can open it, and it goes for good on `until`. */
export const workspaceDeleted: Template<WorkspaceDeletedEmail> = (params, context) => {
  const workspace = workspaceOf(context);
  return {
    subject: `${workspace} was deleted`,
    preheader: `${params.deletedBy} deleted ${workspace}. It goes for good on ${params.until}.`,
    eyebrow: workspace,
    heading: `${workspace} was deleted`,
    blocks: [
      { type: 'paragraph', text: `${params.deletedBy} deleted ${workspace}, so nobody can open it now.` },
      params.restorePath === undefined
        ? {
            type: 'paragraph',
            text: `Its owners can restore it until ${params.until}. After that, it’s gone for good.`,
          }
        : {
            type: 'paragraph',
            text: `As an owner, you can restore it until ${params.until}. After that, it’s gone for good.`,
          },
      ...(params.restorePath === undefined
        ? []
        : [{ type: 'button' as const, label: `Restore ${workspace}`, url: context.link(params.restorePath) }]),
    ],
    why: `You got this email because you’re a member of ${workspace}.`,
  };
};

/** The workspace was restored (late trap #89): it opens again, everything in it as it was. */
export const workspaceRestored: Template<WorkspaceRestoredEmail> = (params, context) => {
  const workspace = workspaceOf(context);
  return {
    subject: `${workspace} was restored`,
    preheader: `${params.restoredBy} restored ${workspace}. It opens again, as it was.`,
    eyebrow: workspace,
    heading: `${workspace} was restored`,
    blocks: [
      {
        type: 'paragraph',
        text: `${params.restoredBy} restored ${workspace}, so it won’t be deleted. Everything in it is as it was.`,
      },
      { type: 'button', label: `Open ${workspace}`, url: context.link(params.openPath) },
    ],
    why: `You got this email because you’re a member of ${workspace}.`,
  };
};
