// An invitation to join a workspace (spec 0031, AC-803 to AC-808), sent from
// the inviting request with the invitation's own link (its raw token is drawn
// into the email and never stored). Who invited, the role, the one button,
// and until when the link works, only for this address (AC-805).
import type { MemberInviteEmail } from '@crm/contracts/emails';
import { formatShortDay } from '../format.ts';
import { workspaceOf, type Template } from '../template.ts';

/** A role with its article, as a sentence says it. */
const ROLES: Readonly<Record<MemberInviteEmail['role'], string>> = {
  owner: 'an owner',
  admin: 'an admin',
  member: 'a member',
  guest: 'a guest',
};

/** A custom role's name with its article ("a Receptionist", "an Analyst"). */
const withArticle = (name: string): string => `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;

/** An invitation to join a workspace. */
export const memberInvite: Template<MemberInviteEmail> = (params, context) => {
  const workspace = workspaceOf(context);
  // A custom role by its own name (spec 0037), else the built in role.
  const role = params.roleName === undefined ? ROLES[params.role] : withArticle(params.roleName);
  const until = formatShortDay(params.expiresAt);
  return {
    subject: `${params.inviterName} invited you to ${workspace} on Timefix`,
    preheader: `Join ${workspace} as ${role}. The invitation works until ${until}.`,
    eyebrow: workspace,
    heading: `Join ${workspace} on Timefix`,
    blocks: [
      { type: 'paragraph', text: `${params.inviterName} invited you to join ${workspace} as ${role}.` },
      { type: 'button', label: 'Accept invitation', url: context.link(params.acceptPath) },
      {
        type: 'note',
        text: `The invitation works until ${until}, and only for this address. If you weren’t expecting it, you can ignore this email.`,
      },
    ],
    why: `You got this email because ${params.inviterName} invited this address to ${workspace}.`,
  };
};
