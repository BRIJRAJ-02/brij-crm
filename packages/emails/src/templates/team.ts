// Emails for the lanes still to come, ready for them to queue: an import's
// result (#30). A mention has no email of its own: it goes in the
// notifications email (spec 0038), the one email a mention sends.
import type { ImportFinishedEmail, SchedulingChangedEmail } from '@crm/contracts/emails';
import { plural } from '../format.ts';
import { workspaceOf, type Template } from '../template.ts';

/** An import's ending, in a heading's words. */
const ENDINGS: Readonly<Record<ImportFinishedEmail['outcome'], string>> = {
  done: 'Import finished',
  failed: 'Import failed',
  cancelled: 'Import cancelled',
};

/** An import a member started has finished. */
export const importFinished: Template<ImportFinishedEmail> = (params, context) => {
  const file = params.fileName ?? 'your file';
  const what =
    params.outcome === 'done'
      ? `Timefix finished importing ${file} into ${params.objectName}.`
      : params.outcome === 'failed'
        ? `Timefix couldn’t finish importing ${file} into ${params.objectName}. What it did before it stopped is kept.`
        : `The import of ${file} into ${params.objectName} was cancelled. What it did before it stopped is kept.`;
  const counts = `${plural(params.created, 'record', 'records')} created, ${String(params.updated)} updated, ${String(params.skipped)} skipped`;
  return {
    subject: `${ENDINGS[params.outcome]}: ${params.objectName}`,
    preheader: `${counts}.`,
    eyebrow: workspaceOf(context),
    heading: ENDINGS[params.outcome],
    blocks: [
      { type: 'paragraph', text: what },
      {
        type: 'rows',
        layout: 'compact',
        rows: [
          { label: 'Created', value: String(params.created) },
          { label: 'Updated', value: String(params.updated) },
          { label: 'Skipped', value: String(params.skipped) },
          ...(params.failed === 0 ? [] : [{ label: 'Failed', value: String(params.failed) }]),
        ],
      },
      { type: 'button', label: 'View the results', url: context.link(params.resultPath) },
    ],
    why: `You got this email because you started this import in ${workspaceOf(context)}.`,
  };
};

/**
 * Someone else changed the reader's scheduling (spec 0037, AC-1264): ten minutes of one person's changes, a line
 * each, and the way to their hours.
 */
export const schedulingChanged: Template<SchedulingChangedEmail> = (params, context) => {
  const subject = `${params.actorName} changed your scheduling`;
  const count = params.lines.length + params.more;
  return {
    subject,
    preheader: `${plural(count, 'change', 'changes')} to your scheduling in ${workspaceOf(context)}.`,
    eyebrow: workspaceOf(context),
    heading: subject,
    blocks: [
      {
        type: 'paragraph',
        text: `${params.actorName} changed your scheduling in ${workspaceOf(context)}. Here is what is different now.`,
      },
      ...params.lines.map((line) => ({ type: 'paragraph' as const, text: line })),
      ...(params.more === 0
        ? []
        : [{ type: 'paragraph' as const, text: `And ${plural(params.more, 'more change', 'more changes')}.` }]),
      { type: 'button', label: 'See your hours', url: context.link(params.availabilityPath) },
    ],
    why: `You got this email because ${params.actorName} can manage your scheduling in ${workspaceOf(context)}.`,
  };
};
