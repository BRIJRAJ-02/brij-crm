// Welcome to a workspace (26 Oct 2026), and the link page every membership gets with it: the owner's "we need to
// create link page automatically as soon as someone signs up and also mention". The page is private until its owner
// edits it or shares it (27 Oct 2026), so the email says where it will be and how it goes public, and gives no link
// to it: the address would open nothing for them, or for anyone they forwarded it to. The address is written with the
// public host (`timefix.com/ada`) and links through the app's own origin (`/ada`), which sends it on, so the email
// never carries a link off the app's origin.
import type { LinkPageEmailPart, WorkspaceWelcomeEmail } from '@crm/contracts/emails';
import type { EmailBlock } from '../document.ts';
import { workspaceOf, type Template, type TemplateContext } from '../template.ts';

/** The link page's address as the email writes it: the public host and the handle. */
export function linkPageAddress(handle: string, context: TemplateContext): string {
  return `${context.publicHost ?? new URL(context.link('/')).host}/${handle}`;
}

/** What a welcome says about the link page: that it is live and unlisted, its address, and where to edit it. */
export function linkPageBlocks(linkPage: LinkPageEmailPart, context: TemplateContext): readonly EmailBlock[] {
  return [
    {
      type: 'paragraph',
      text: 'Your link page is live. Anyone with its address can open it; search engines aren’t told about it until you say so.',
    },
    {
      type: 'rows',
      layout: 'compact',
      rows: [
        // Its address, linked: the page answers from the moment the membership exists (27 October 2026).
        {
          label: 'Your page',
          value: linkPageAddress(linkPage.handle, context),
          url: context.link(`/${linkPage.handle}`),
        },
        { label: 'Edit your page', value: 'Add links, booking pages and forms', url: context.link(linkPage.editPath) },
      ],
    },
    { type: 'note', text: 'You can change your handle any time in Settings › Account › Profile.' },
  ];
}

/** A new member is in: the button into the workspace, and their link page, live and unlisted. */
export const workspaceWelcome: Template<WorkspaceWelcomeEmail> = (params, context) => {
  const workspace = workspaceOf(context);
  const page = params.linkPage;
  const made = params.created === true;
  const opening = made ? `${workspace} is ready.` : `You’re in ${workspace}.`;
  return {
    subject: `Welcome to ${workspace} on Timefix`,
    preheader: page === undefined ? opening : `${opening} Your link page is live too.`,
    eyebrow: workspace,
    heading: `Welcome to ${workspace}`,
    blocks: [
      {
        type: 'paragraph',
        text: made ? `Your workspace ${workspace} is ready.` : `You’re a member of ${workspace} now.`,
      },
      { type: 'button', label: `Open ${workspace}`, url: context.link(params.openPath) },
      ...(page === undefined ? [] : linkPageBlocks(page, context)),
    ],
    why: made
      ? `You got this email because you created ${workspace}.`
      : `You got this email because you joined ${workspace}.`,
  };
};
