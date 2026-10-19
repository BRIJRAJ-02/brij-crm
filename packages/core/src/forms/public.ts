// The public form services (spec 0023, 0023-experience.md, The visitor; Bots
// and abuse, adjusted): what the hosted page renders, who may post (the
// sites and the signature a site's own form needs), and storing a
// submission. They act in the scope `enterPublicForm` made from an address:
// the form as the actor and no data access, so they read only the form's own
// rows and never a record. A submission is stored first, in one insert with
// its job queued in the same transaction (AC-554); processing happens there.
import { checkAnswers, HONEYPOT_KEY, SubmitBody, type PublicForm, type SubmitNext } from '@crm/contracts';
import { schema } from '@crm/db';
import { refuse, refuseAll } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { inWorkspace } from '../access/run.ts';
import { startJob } from '../jobs/service.ts';
import type { JobRegistry } from '../jobs/registry.ts';
import { FORMS_PROCESS } from './process.ts';
import { loadForm, loadVersions, publicFormOf, type FormRow } from './shared.ts';

const { formSubmissions } = schema;

/** What a form that isn't taking enquiries answers at its link (AC-549, AC-662). */
export const FORM_CLOSED_MESSAGE = 'This form isn’t taking enquiries right now.';

/** Refuses (a programming error) any scope but the one the form's own public key made. */
function checkPublicScope(scope: EngineScope, formId: string): void {
  const { principal } = scope.access;
  if (principal.kind !== 'form' || principal.formId !== formId) {
    throw new Error('Only the form’s own public scope reads or submits it this way.');
  }
}

/** The form a public scope names, live or paused; anything else (never published, archived, gone) is NOT_FOUND. */
function publicRow(form: FormRow | undefined): FormRow & { liveVersionId: string } {
  if (form === undefined || form.liveVersionId === null || form.status === 'draft' || form.status === 'archived') {
    throw refuse('NOT_FOUND', 'That form does not exist.');
  }
  return { ...form, liveVersionId: form.liveVersionId };
}

/** A live form as its hosted page renders it (AC-587, AC-659); a paused one with no questions (AC-662). */
export async function getPublicForm(
  scope: EngineScope,
  input: { readonly formId: string; readonly recaptchaSiteKey?: string },
): Promise<PublicForm> {
  checkPublicScope(scope, input.formId);
  return inWorkspace(scope, async (tx) => {
    const form = publicRow(await loadForm(tx, input.formId));
    const live = (await loadVersions(tx, [form.liveVersionId])).get(form.liveVersionId);
    if (live === undefined) throw new Error('A live form names a version that is gone.');
    const rendered = publicFormOf(live.document, {
      publicKey: form.publicKey,
      status: form.status === 'paused' ? 'paused' : 'live',
      versionNumber: live.number,
      ...(input.recaptchaSiteKey === undefined ? {} : { recaptchaSiteKey: input.recaptchaSiteKey }),
    });
    return form.status === 'paused' ? { ...rendered, questions: [] } : rendered;
  });
}

/** Who may post to a form: the sites listed for "Your own form", and whether their posts must be signed. */
export interface PostingRules {
  readonly allowedOrigins: readonly string[];
  readonly requireSignature: boolean;
  readonly signingSecret: string;
}

/** The form's posting rules, for the API's origin and signature checks before a submit is read. */
export async function postingRules(scope: EngineScope, input: { readonly formId: string }): Promise<PostingRules> {
  checkPublicScope(scope, input.formId);
  return inWorkspace(scope, async (tx) => {
    const form = publicRow(await loadForm(tx, input.formId));
    return {
      allowedOrigins: [...form.allowedOrigins],
      requireSignature: form.requireSignature,
      signingSecret: form.signingSecret,
    };
  });
}

/**
 * What the API's reCAPTCHA check found, when reCAPTCHA is on: a score, no
 * token, a refused token, Google not answering; `off` when no keys are set
 * (the default), so the honeypot, timing and limits decide alone.
 */
export type CaptchaVerdict =
  | { readonly kind: 'off' }
  | { readonly kind: 'score'; readonly score: number }
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unavailable' };

/** What storing a submission takes besides the body. */
export interface SubmitInput {
  readonly formId: string;
  readonly body: SubmitBody;
  readonly captcha: CaptchaVerdict;
  /** The client address, already hashed with the salt. */
  readonly ipHash?: string;
}

/** What storing a submission answered: the visitor's next step, and how the bot checks judged it. */
export interface SubmitOutcome {
  readonly next: SubmitNext;
  readonly verdict: 'passed' | 'spam' | 'unchecked';
  /** True when this attempt was already stored (a retry of the same idempotency key). */
  readonly replayed: boolean;
}

/** The bot signals of a submission (spec 0023, Bots and abuse, adjusted): what made it spam, or none. */
function spamSignals(
  body: ReturnType<typeof SubmitBody.parse>,
  captcha: CaptchaVerdict,
  spam: { readonly minFillMs: number; readonly scoreThreshold: number },
): { readonly signals: readonly string[]; readonly verdict: SubmitOutcome['verdict'] } {
  const signals: string[] = [];
  const trap = body[HONEYPOT_KEY];
  if (trap !== undefined && trap.trim() !== '') signals.push('honeypot');
  if (body.fillMs === undefined || body.fillMs < spam.minFillMs) signals.push('too_fast');
  if (captcha.kind === 'missing') signals.push('captcha_missing');
  if (captcha.kind === 'invalid') signals.push('captcha_invalid');
  if (captcha.kind === 'score' && captcha.score < spam.scoreThreshold) signals.push('captcha_low_score');
  if (signals.length > 0) return { signals, verdict: 'spam' };
  if (captcha.kind === 'unavailable') return { signals: ['captcha_unavailable'], verdict: 'unchecked' };
  return { signals: [], verdict: 'passed' };
}

/**
 * Stores one submission (AC-553 to AC-556). The form must be live (a paused
 * one is 410 `FORM_CLOSED`, AC-662), and its answers are checked against the
 * live version whatever version the page loaded (unknown keys dropped; a
 * question added since and left empty fails only if it is required). A
 * submission the bot checks flag is stored as `spam` with its answers to
 * known questions and gets the same answer as success (AC-586); any other is
 * checked (`checkAnswers`, field errors as refusals on each question key,
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
      const { after } = live.document;
      const next: SubmitNext =
        after.kind === 'message'
          ? { kind: 'message', text: after.message, offersMeeting: false }
          : { kind: 'redirect', url: after.url };
      const rendered = publicFormOf(live.document, {
        publicKey: form.publicKey,
        status: 'live',
        versionNumber: live.number,
      });
      const judged = spamSignals(body, input.captcha, live.document.spam);
      let answers: Readonly<Record<string, unknown>>;
      if (judged.verdict === 'spam') {
        const known = new Set(rendered.questions.map((question) => question.key));
        answers = Object.fromEntries(Object.entries(body.answers).filter(([key]) => known.has(key)));
      } else {
        const checked = checkAnswers(rendered, body.answers);
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
