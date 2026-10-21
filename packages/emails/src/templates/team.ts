// Emails for the lanes still to come, ready for them to queue: an import's
// result (#30) and a mention (#29).
import type { ImportFinishedEmail } from '@crm/contracts/emails';
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
