// The two form emails (spec 0023): the notice a member gets for each new
// submission (AC-1047), and the visitor's copy of what they sent, when the
// form turns it on (AC-1048). The answers come as the form's questions and
// the replies, already cut to what the reader may see.
import type { EmailRow, FormConfirmationEmail, FormSubmissionEmail } from '@crm/contracts/emails';
import type { DocumentRow, EmailBlock } from '../document.ts';
import { formatMoment } from '../format.ts';
import { clip, workspaceOf, type Template, type TemplateContext } from '../template.ts';

/** A form's answers as stacked rows (questions run long), each linked when it carries an app path. */
function answerRows(answers: readonly EmailRow[], context: TemplateContext): readonly DocumentRow[] {
  return answers.map((answer) => ({
    label: answer.label,
    value: answer.value,
    ...(answer.href === undefined ? {} : { url: context.link(answer.href) }),
  }));
}

/** Who sent a submission, as they gave themselves. */
function senderOf(submitter: FormSubmissionEmail['submitter']): string | undefined {
  if (submitter.name !== undefined && submitter.email !== undefined) return `${submitter.name} (${submitter.email})`;
  return submitter.name ?? submitter.email;
}

/** The first answers as one preview line. */
function answersPreview(answers: readonly EmailRow[]): string | undefined {
  if (answers.length === 0) return undefined;
  return clip(answers.map((answer) => `${answer.label}: ${answer.value}`).join(', '), 140);
}

/** A new submission to a form, for one member told about it. */
export const formSubmission: Template<FormSubmissionEmail> = (params, context) => {
  const who = params.submitter.name ?? params.submitter.email;
  const from = senderOf(params.submitter);
  const when = formatMoment(params.submittedAt, params.timeZone);
  const blocks: EmailBlock[] = [
    {
      type: 'rows',
      layout: 'compact',
      rows: [...(from === undefined ? [] : [{ label: 'From', value: from }]), { label: 'Submitted', value: when }],
    },
  ];
  const unfiled = params.filed === false;
  if (unfiled) {
    blocks.unshift({
      type: 'note',
      text: 'This submission couldn’t be added to the CRM. Open it to add it with Add to CRM.',
    });
  }
  if (params.answers.length > 0) {
    blocks.push({ type: 'rows', layout: 'stacked', rows: answerRows(params.answers, context) });
  }
  blocks.push({ type: 'button', label: 'Open submission', url: context.link(params.submissionPath) });
  return {
    subject: who === undefined ? `New submission to ${params.formName}` : `${who} filled in ${params.formName}`,
    preheader: answersPreview(params.answers) ?? `Submitted ${when}.`,
    eyebrow: workspaceOf(context),
    heading: unfiled
      ? `New submission to ${params.formName}, not added to the CRM`
      : `New submission to ${params.formName}`,
    blocks,
    why:
      params.reason === 'lead'
        ? `You got this email because this lead was given to you in ${workspaceOf(context)}.`
        : params.reason === 'maker'
          ? `You got this email because you made the form ${params.formName} in ${workspaceOf(context)}.`
          : `You got this email because you made ${params.formName} or its lead was given to you, in ${workspaceOf(context)}.`,
  };
};

/** The subject and heading a confirmation takes when its form sets none (spec 0023's default). */
export const CONFIRMATION_DEFAULT_SUBJECT = 'We got your message';

/** The visitor's copy of what they sent. */
export const formConfirmation: Template<FormConfirmationEmail> = (params, context) => {
  const title = params.subject ?? CONFIRMATION_DEFAULT_SUBJECT;
  const opening = params.message ?? `Thanks for filling in ${params.formName}.`;
  const blocks: EmailBlock[] = [{ type: 'paragraph', text: opening }];
  if (params.answers.length > 0) {
    blocks.push(
      {
        type: 'note',
        text: `Here’s a copy of what you sent on ${formatMoment(params.submittedAt, params.timeZone)}.`,
      },
      { type: 'rows', layout: 'stacked', rows: answerRows(params.answers, context) },
    );
  }
  return {
    subject: title,
    preheader: clip(opening, 140),
    eyebrow: workspaceOf(context),
    heading: title,
    blocks,
    why: `You got this email because this address was entered on ${params.formName}, a form by ${workspaceOf(context)}. If that wasn’t you, you can ignore it.`,
  };
};
