// Domain join's two emails (spec 0031, AC-819, AC-820): a request to join,
// to the workspace's owners and admins, and the approval, to the person who
// asked. A decline sends nothing.
import type { JoinApprovedEmail, JoinRequestEmail } from '@crm/contracts/emails';
import { workspaceOf, type Template } from '../template.ts';

/** Someone at the workspace's domain asked to join. */
export const joinRequest: Template<JoinRequestEmail> = (params, context) => {
  const workspace = workspaceOf(context);
  return {
    subject: `${params.requesterName} (${params.requesterEmail}) asked to join ${workspace}`,
    preheader: `${params.requesterEmail} would like to join ${workspace}. Approve or decline it in Members.`,
    eyebrow: workspace,
    heading: `${params.requesterName} asked to join`,
    blocks: [
      {
        type: 'paragraph',
        text: `${params.requesterName} (${params.requesterEmail}) would like to join ${workspace}. They found it because their address is at a domain the workspace lets people ask from.`,
      },
      { type: 'button', label: 'Review request', url: context.link(params.reviewPath) },
    ],
    why: `You got this email because you can invite people to ${workspace}.`,
  };
};

/** Their request was approved: they are in. */
export const joinApproved: Template<JoinApprovedEmail> = (params, context) => {
  const workspace = workspaceOf(context);
  return {
    subject: `You’ve joined ${workspace} on Timefix`,
    preheader: `Your request to join ${workspace} was approved.`,
    eyebrow: workspace,
    heading: `Welcome to ${workspace}`,
    blocks: [
      { type: 'paragraph', text: `Your request to join ${workspace} was approved. You’re a member now.` },
      { type: 'button', label: `Open ${workspace}`, url: context.link(params.openPath) },
    ],
    why: `You got this email because you asked to join ${workspace}.`,
  };
};
