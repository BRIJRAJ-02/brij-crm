// Emails about a member's own background work: an import's result (#30), and
// any other job of theirs that failed (late trap #20). A mention has no email of its own: it goes in the
// notifications email (spec 0038), the one email a mention sends.
import type { ImportFinishedEmail, JobFailedEmail, SchedulingChangedEmail } from '@crm/contracts/emails';
import { plural } from '../format.ts';

/** A count as the app writes it (1,204). */
const number = (count: number): string => new Intl.NumberFormat('en-GB').format(count);
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
        ? `Timefix couldn’t finish importing ${file} into ${params.objectName}. The rows it imported before it stopped are kept. Open the import to see what’s left, and import the rest again or undo it.`
        : `The import of ${file} into ${params.objectName} was cancelled. What it did before it stopped is kept.`;
  const counts = `${plural(params.created, 'record', 'records')} created, ${number(params.updated)} updated, ${number(params.skipped)} skipped`;
  // A finished import that left rows out says so up front, so the reader knows to open it.
  const ending =
    params.outcome === 'done' && params.failed > 0
      ? `Import finished, ${plural(params.failed, 'row', 'rows')} not imported`
      : ENDINGS[params.outcome];
  return {
    subject: `${ending}: ${params.objectName}`,
    preheader: `${counts}.`,
    eyebrow: workspaceOf(context),
    heading: ending,
    blocks: [
      { type: 'paragraph', text: what },
      {
        type: 'rows',
        layout: 'compact',
        rows: [
          { label: 'Created', value: number(params.created) },
          { label: 'Updated', value: number(params.updated) },
          { label: 'Skipped', value: number(params.skipped) },
          ...(params.failed === 0 ? [] : [{ label: 'Not imported', value: number(params.failed) }]),
        ],
      },
      { type: 'button', label: 'View import', url: context.link(params.resultPath) },
    ],
    why: `You got this email because you started this import in ${workspaceOf(context)}.`,
  };
};

/** A background job a member started ended `failed`: which, why, and where their jobs are. */
export const jobFailed: Template<JobFailedEmail> = (params, context) => ({
  // "Didn't finish" reads with any job's name, a long one ("Hand on a removed member's work") included.
  subject: `Didn’t finish: ${params.jobLabel}`,
  preheader: params.reason,
  eyebrow: workspaceOf(context),
  heading: `Didn’t finish: ${params.jobLabel}`,
  blocks: [
    { type: 'paragraph', text: params.reason },
    { type: 'button', label: 'Open Background jobs', url: context.link(params.jobsPath) },
  ],
  why: `You got this email because you started this job in ${workspaceOf(context)}.`,
});

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
