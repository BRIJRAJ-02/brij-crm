// The notifications email (spec 0038, AC-1176, AC-1177): a member's unread
// notifications in one workspace, newest first, each its sentence, the record
// it is about and its words, linked to where it opens; then the inbox. The
// subject names the count and the workspace. An optional email: the footer
// carries the member's notification settings.
import type { NotificationsEmail } from '@crm/contracts/emails';
import type { DocumentRow } from '../document.ts';
import { clip, workspaceOf, type Template } from '../template.ts';

/** "1 new notification", "3 new notifications". */
const countOf = (count: number) => (count === 1 ? '1 new notification' : `${String(count)} new notifications`);

/** A member's unread notifications in one workspace. */
export const notifications: Template<NotificationsEmail> = (params, context) => {
  const workspace = workspaceOf(context);
  const total = params.items.length + params.more;
  const [first] = params.items;
  const rows: DocumentRow[] = params.items.map((item) => ({
    label: item.recordName === undefined ? item.sentence : `${item.sentence} on ${item.recordName}`,
    value: item.excerpt === '' ? 'Open it' : clip(item.excerpt, 200),
    url: context.link(item.path),
  }));
  const isDigest = params.digest === true;
  return {
    subject: isDigest ? `Your daily digest: ${countOf(total)} in ${workspace}` : `${countOf(total)} in ${workspace}`,
    preheader: first === undefined ? countOf(total) : first.sentence,
    eyebrow: workspace,
    heading: isDigest ? 'Your daily digest' : `${countOf(total)} for you`,
    blocks: [
      { type: 'rows', layout: 'stacked', rows },
      ...(params.more > 0 ? [{ type: 'note' as const, text: `And ${String(params.more)} more in your inbox.` }] : []),
      { type: 'button', label: 'Open your inbox', url: context.link(params.inboxPath) },
    ],
    why: isDigest
      ? `You got this email because you turned on the daily digest in ${workspace}.`
      : `You got this email because you get email for these notifications in ${workspace}.`,
  };
};
