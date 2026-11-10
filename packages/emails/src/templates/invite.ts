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
  if (params.login !== undefined) return ownLogin(params, context);
  if (params.page !== undefined) return pageHandover(params, context);
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

/**
 * A page's hand over (Team pages, 9 Nov 2026): the link page someone made for this person, theirs to manage from now
 * with a login of their own at this address. Same layout and the same one button as an invitation to join.
 */
const pageHandover: Template<MemberInviteEmail> = (params, context) => {
  const workspace = workspaceOf(context);
  const until = formatShortDay(params.expiresAt);
  const handle = params.page?.handle;
  const page = handle === undefined ? 'your link page' : `your link page, /${handle}`;
  return {
    subject: `${params.inviterName} invited you to manage your page on Timefix`,
    preheader: `Set up your login to edit ${page}. The invitation works until ${until}.`,
    eyebrow: workspace,
    heading: 'Manage your page on Timefix',
    blocks: [
      {
        type: 'paragraph',
        text: `${params.inviterName} made ${page} in ${workspace}, and invited you to manage it yourself.`,
      },
      { type: 'button', label: 'Set up your login', url: context.link(params.acceptPath) },
      {
        type: 'note',
        text: `The invitation works until ${until}, and only for this address. If you weren’t expecting it, you can ignore this email.`,
      },
    ],
    why: `You got this email because ${params.inviterName} invited this address to manage a page in ${workspace}.`,
  };
};

/**
 * A connected app's person's own Timefix login (spec 0070, AC-7023): they keep using the app as before, and can also
 * sign in to Timefix directly, to the same page. Same layout and the same one button as a page's hand over.
 */
const ownLogin: Template<MemberInviteEmail> = (params, context) => {
  const workspace = workspaceOf(context);
  const until = formatShortDay(params.expiresAt);
  const handle = params.page?.handle;
  const page = handle === undefined ? 'your link page' : `your link page, /${handle}`;
  const app = params.login?.app;
  const keep = app === undefined ? 'Keep using the app you use now as before.' : `Keep using ${app} as before.`;
  return {
    subject: 'Set up your Timefix login',
    preheader: `Sign in to Timefix directly to manage ${page}. The invitation works until ${until}.`,
    eyebrow: workspace,
    heading: 'Set up your Timefix login',
    blocks: [
      {
        type: 'paragraph',
        text: `${params.inviterName} asked for a Timefix login for you, so you can manage ${page} in ${workspace}. ${keep} You can also sign in to Timefix directly.`,
      },
      { type: 'button', label: 'Set up your login', url: context.link(params.acceptPath) },
      {
        type: 'note',
        text: `The invitation works until ${until}, and only for this address. If you weren’t expecting it, you can ignore this email.`,
      },
    ],
    why: `You got this email because ${params.inviterName} asked for a Timefix login for this address in ${workspace}.`,
  };
};
