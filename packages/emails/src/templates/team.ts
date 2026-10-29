// Emails about a member's own background work: an import's result (#30), and
// any other job of theirs that failed (late trap #20). A mention has no email of its own: it goes in the
// notifications email (spec 0038), the one email a mention sends.
import type { ImportFinishedEmail, JobFailedEmail } from '@crm/contracts/emails';
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

/** A background job a member started ended `failed`: which, why, and where their jobs are. */
export const jobFailed: Template<JobFailedEmail> = (params, context) => ({
  subject: `${params.jobLabel} failed`,
  preheader: params.reason,
  eyebrow: workspaceOf(context),
  heading: `${params.jobLabel} failed`,
  blocks: [
    { type: 'paragraph', text: params.reason },
    { type: 'button', label: 'See your jobs', url: context.link(params.jobsPath) },
  ],
  why: `You got this email because you started this job in ${workspaceOf(context)}.`,
});
