// The two form emails (spec 0023): the notice a member gets for each new
// submission (AC-1047), and the visitor's copy of what they sent, when the
// form turns it on (AC-1048). The answers come as the form's questions and
// the replies, already cut to what the reader may see.
import type { EmailRow, FormConfirmationEmail, FormResumeEmail, FormSubmissionEmail } from '@crm/contracts/emails';
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
  const when = formatMoment(params.submittedAt, params.timeZone);
  // The sender is in the answers already (their name, their email): a From row said it twice (forms fix b4).
  const from = params.answers.length === 0 ? senderOf(params.submitter) : undefined;
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
  // Replies go to the visitor (the worker sets Reply-To from their address), so the way to answer them is Reply.
  if (params.submitter.email !== undefined) {
    blocks.push({
      type: 'note',
      text: `Reply to this email to answer ${params.submitter.name ?? params.submitter.email}.`,
    });
  }
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
        : params.reason === 'listed'
          ? `You got this email because ${params.formName} tells you about new submissions in ${workspaceOf(context)}.`
          : params.reason === 'maker'
            ? `You got this email because you made the form ${params.formName} in ${workspaceOf(context)}.`
            : `You got this email because you made ${params.formName} or its lead was given to you, in ${workspaceOf(context)}.`,
  };
};

/** The subject and heading a confirmation takes when its form sets none (spec 0023's default). */
export const CONFIRMATION_DEFAULT_SUBJECT = 'We got your message';

/**
 * The visitor's copy of what they sent. It never names the form by its internal name (forms fix b3: "Thanks for
 * filling in Lead qualification v2" told a visitor what the team calls them): the form's headline when it has one,
 * else plain words. No time either: it was the workspace's zone, not the visitor's.
 */
export const formConfirmation: Template<FormConfirmationEmail> = (params, context) => {
  const title = params.subject ?? CONFIRMATION_DEFAULT_SUBJECT;
  const opening = params.message ?? 'Thanks, we got it. We will come back to you soon.';
  const blocks: EmailBlock[] = [{ type: 'paragraph', text: opening }];
  if (params.answers.length > 0) {
    blocks.push(
      { type: 'note', text: 'Here’s a copy of what you sent.' },
      { type: 'rows', layout: 'stacked', rows: answerRows(params.answers, context) },
    );
  }
  const where = params.headline === undefined ? 'a form' : `“${params.headline}”, a form`;
  return {
    subject: title,
    preheader: clip(opening, 140),
    eyebrow: workspaceOf(context),
    heading: title,
    blocks,
    why: `You got this email because this address was entered on ${where} by ${workspaceOf(context)}. If that wasn’t you, you can ignore it.`,
  };
};

/** The subject a resume link email takes. */
export const RESUME_SUBJECT = 'Finish your form when you’re ready';

/**
 * The resume link a visitor asked for (spec 0063, AC-6319). One button and
 * one line: the email names the form and when the link stops working, and
 * carries not one answer, so forwarding it gives away nothing but the chance
 * to finish the form.
 */
export const formResume: Template<FormResumeEmail> = (params, context) => {
  const until = formatMoment(params.expiresAt, params.timeZone);
  const opening = `Pick up ${params.formName} where you left off. This link works until ${until}.`;
  return {
    subject: RESUME_SUBJECT,
    preheader: clip(opening, 140),
    eyebrow: workspaceOf(context),
    heading: RESUME_SUBJECT,
    blocks: [
      { type: 'paragraph', text: opening },
      { type: 'button', label: 'Finish the form', url: context.link(params.resumePath) },
    ],
    why: `You got this email because this address was entered on ${params.formName}, a form by ${workspaceOf(context)}, and the link was asked for. If that wasn’t you, you can ignore it.`,
  };
};
