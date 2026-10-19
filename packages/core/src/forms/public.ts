// The public form services (spec 0023, 0023-public-surface.md, milestone 1):
// what the hosted page renders, and storing a submission. They act in the
// scope `enterPublicForm` made from a public key: the form as the actor and
// no data access, so they read only the form's own rows and its mapped
// attributes' definitions, and never a record. A submission is stored first,
// in one insert with its job queued in the same transaction (AC-554), and
// nothing else is written by the request; processing happens in the job.
import { checkAnswers, publicQuestions, questionsOf, type PublicForm, type SubmitNext } from '@crm/contracts';
import { SubmitBody } from '@crm/contracts';
import type { PatternCompiler } from '@crm/contracts/validation';
import { schema } from '@crm/db';
import { refuse, refuseAll } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { inWorkspace } from '../access/run.ts';
import { startJob } from '../jobs/service.ts';
import type { JobRegistry } from '../jobs/registry.ts';
import { FORMS_PROCESS } from './process.ts';
import { loadForm, loadVersions, publicFormOf, versionByNumber, type FormRow } from './shared.ts';

const { formSubmissions } = schema;

/** What a form that isn't taking responses answers at its link (AC-549). */
export const FORM_CLOSED_MESSAGE = 'This form is not taking responses right now.';

/** Refuses (a programming error) any scope but the one the form's own public key made. */
function checkPublicScope(scope: EngineScope, formId: string): void {
  const { principal } = scope.access;
  if (principal.kind !== 'form' || principal.formId !== formId) {
    throw new Error('Only the form’s own public scope reads or submits it this way.');
  }
}

/** The form a public scope names, live or paused; anything else (a draft, archived, gone) is NOT_FOUND. */
function publicRow(form: FormRow | undefined): FormRow & { liveVersionId: string } {
  if (form === undefined || form.liveVersionId === null || form.status === 'draft' || form.status === 'archived') {
    throw refuse('NOT_FOUND', 'That form does not exist.');
  }
  return { ...form, liveVersionId: form.liveVersionId };
}

/**
 * A live form as its hosted page renders it (AC-587), or for a paused one
 * its status and the "not taking responses" message with nothing to fill in.
 */
export async function getPublicForm(
  scope: EngineScope,
  input: { readonly formId: string; readonly recaptchaSiteKey?: string },
): Promise<PublicForm> {
  checkPublicScope(scope, input.formId);
  return inWorkspace(scope, async (tx) => {
    const form = publicRow(await loadForm(tx, input.formId));
    const live = (await loadVersions(tx, [form.liveVersionId])).get(form.liveVersionId);
    if (live === undefined) throw new Error('A live form names a version that is gone.');
    const rendered = await publicFormOf(tx, form.mainObjectId, live.document, {
      publicKey: form.publicKey,
      status: form.status === 'paused' ? 'paused' : 'live',
      versionNumber: live.number,
      ...(input.recaptchaSiteKey === undefined ? {} : { recaptchaSiteKey: input.recaptchaSiteKey }),
    });
    if (form.status === 'paused') {
      return { ...rendered, steps: [], closedMessage: FORM_CLOSED_MESSAGE };
    }
    return rendered;
  });
}

/** What the API's reCAPTCHA check found (AC-583): a score, no token, a refused token, or no answer from Google. */
export type CaptchaVerdict =
  | { readonly kind: 'score'; readonly score: number }
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' }
  /** Google didn't answer in time, too many checks were in flight, or no secret is set (local): unchecked. */
  | { readonly kind: 'unavailable' };

/** What storing a submission takes besides the body. */
export interface SubmitInput {
  readonly formId: string;
  readonly body: SubmitBody;
  readonly captcha: CaptchaVerdict;
  /** The client address, already hashed with the salt. */
  readonly ipHash?: string;
  /** The pattern engine the answer check's rules run with (RE2 on the server). */
  readonly pattern: PatternCompiler;
}

/** What storing a submission answered: the visitor's next step, and how the bot checks judged it. */
export interface SubmitOutcome {
  readonly next: SubmitNext;
  readonly verdict: 'passed' | 'spam' | 'unchecked';
  /** True when this attempt was already stored (a retry of the same idempotency key). */
  readonly replayed: boolean;
}

/** The bot signals of a submission (AC-583, AC-584): what made it spam, or none. */
function spamSignals(
  body: SubmitBody,
  captcha: CaptchaVerdict,
  spam: { readonly minFillMs: number; readonly scoreThreshold: number },
): { readonly signals: readonly string[]; readonly verdict: SubmitOutcome['verdict'] } {
  const signals: string[] = [];
  if (body.honeypot !== undefined && body.honeypot.trim() !== '') signals.push('honeypot');
  if (body.fillMs === undefined || body.fillMs < spam.minFillMs) signals.push('too_fast');
  if (captcha.kind === 'missing') signals.push('captcha_missing');
  if (captcha.kind === 'invalid') signals.push('captcha_invalid');
  if (captcha.kind === 'score' && captcha.score < spam.scoreThreshold) signals.push('captcha_low_score');
  if (signals.length > 0) return { signals, verdict: 'spam' };
  return {
    signals: captcha.kind === 'unavailable' ? ['captcha_unavailable'] : [],
    verdict: captcha.kind === 'unavailable' ? 'unchecked' : 'passed',
  };
}

/**
 * Stores one submission (AC-553 to AC-556, AC-583 to AC-586). The form must
 * be live (a paused one answers 409 `FORM_CLOSED`). The body names the
 * version the visitor answered: the live one, or one behind it (its answers
 * then checked against the live version, missing newly required answers
 * accepted as empty); older answers 409 `FORM_CHANGED` and the page reloads.
 * A submission the bot checks flag is stored as `spam` with the answers to
 * known questions, unchecked, and processed never (AC-586); any other is
 * checked (`checkAnswers`, field errors as refusals on each question id,
 * nothing stored) and stored as `received` with its job queued. The same
 * idempotency key again answers the same next step and stores nothing more
 * (AC-555). The answer never says whether a record already exists.
 */
export async function submitForm(
  scope: EngineScope,
  registry: JobRegistry,
  input: SubmitInput,
  hooks: readonly AfterWrite[] = [],
): Promise<SubmitOutcome> {
  checkPublicScope(scope, input.formId);
  const body = SubmitBody.parse(input.body);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const form = publicRow(await loadForm(tx, input.formId));
      if (form.status !== 'live') throw refuse('FORM_CLOSED', FORM_CLOSED_MESSAGE);
      const live = (await loadVersions(tx, [form.liveVersionId])).get(form.liveVersionId);
      if (live === undefined) throw new Error('A live form names a version that is gone.');
      const next: SubmitNext =
        live.document.after.kind === 'message'
          ? { kind: 'message', text: live.document.after.text }
          : { kind: 'redirect', url: live.document.after.url };
      if (body.versionNumber !== live.number && body.versionNumber !== live.number - 1) {
        throw refuse('FORM_CHANGED', 'This form changed since the page loaded. Reload it and send again.');
      }
      // A visitor one version behind never saw the questions the live version added: none of them is required.
      const behind =
        body.versionNumber === live.number ? undefined : await versionByNumber(tx, form.id, body.versionNumber);
      const seen =
        behind === undefined ? undefined : new Set(questionsOf(behind.document).map((question) => question.id));
      const notRequired =
        seen === undefined
          ? undefined
          : new Set(questionsOf(live.document).flatMap((question) => (seen.has(question.id) ? [] : [question.id])));
      const rendered = await publicFormOf(tx, form.mainObjectId, live.document, {
        publicKey: form.publicKey,
        status: 'live',
        versionNumber: live.number,
        ...(notRequired === undefined ? {} : { notRequired }),
      });
      const judged = spamSignals(body, input.captcha, live.document.spam);
      let answers: Readonly<Record<string, unknown>>;
      if (judged.verdict === 'spam') {
        const known = new Set(publicQuestions(rendered).map((question) => question.id));
        answers = Object.fromEntries(Object.entries(body.answers).filter(([id]) => known.has(id)));
      } else {
        const checked = checkAnswers(rendered, body.answers, { pattern: input.pattern });
        if (!checked.ok) {
          const [first, ...rest] = Object.entries(checked.fields).map(([field, message]) => ({
            code: 'ATTRIBUTE_VALUE_INVALID' as const,
            message,
            field,
          }));
          if (first !== undefined) throw refuseAll([first, ...rest]);
        }
        answers = checked.ok ? checked.answers : {};
      }
      const inserted = await tx
        .insert(formSubmissions)
        .values({
          workspaceId: scope.workspaceId,
          formId: form.id,
          versionId: live.id,
          idempotencyKey: body.idempotencyKey,
          state: judged.verdict === 'spam' ? 'spam' : 'received',
          answers,
          hidden: body.hidden,
          spam: {
            verdict: judged.verdict,
            signals: judged.signals,
            ...(input.captcha.kind === 'score' ? { score: input.captcha.score } : {}),
          },
          ipHash: input.ipHash ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: formSubmissions.id });
      const [row] = inserted;
      if (row === undefined) return { next, verdict: judged.verdict, replayed: true };
      if (judged.verdict !== 'spam') {
        await startJob(context, registry, { kind: FORMS_PROCESS, params: { submissionId: row.id } });
      }
      return { next, verdict: judged.verdict, replayed: false };
    },
    hooks,
  );
  return result;
}
