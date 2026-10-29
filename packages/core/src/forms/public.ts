// The public form services (spec 0023, 0023-experience.md, The visitor; Bots
// and abuse, adjusted): what the hosted page renders, who may post (the
// sites and the signature a site's own form needs), and storing a
// submission. They act in the scope `enterPublicForm` made from an address:
// the form as the actor and no data access, so they read only the form's own
// rows and never a record. A submission is stored first, in one insert with
// its job queued in the same transaction (AC-554); processing happens there.
import {
  BOOKING_COUNTDOWN,
  checkAnswers,
  formStrings,
  hiddenFacts,
  storedContext,
  SubmitBody,
  type Facts,
  type FormDocument,
  type PublicForm,
  type Route,
  type SubmitNext,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { createHmac } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { isRefusal, refuse, refuseAll } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { inWorkspace } from '../access/run.ts';
import { pagePath } from '../booking/handles.ts';
import { startJob } from '../jobs/service.ts';
import type { JobRegistry } from '../jobs/registry.ts';
import { FORMS_PROCESS } from './process.ts';
import { attachUploads, claimUploads } from './uploads.ts';
import { routeSubmission, storedRoute, submissionDecision } from '../routing/forms.ts';
import { workspaceAddressProblem } from '../booking/workspace-addresses.ts';
import { loadForm, loadVersions, publicFormOf, workspacePublicKey, type FormRow } from './shared.ts';
import {
  judgeSubmission,
  REPEAT_WINDOW_HOURS,
  scoreContent,
  type CaptchaVerdict,
  type SpamJudgement,
  type TicketVerdict,
} from './spam.ts';

const { bookingPages, formSubmissions } = schema;

/**
 * What a form signs to hand its visitor to a booking page (AC-1057, spec 0025
 * AC-642): the submission and the page, and nothing personal. The name and
 * email are read from the stored submission when the page asks, so a link
 * that is copied, logged or kept in history carries no one's details.
 */
export interface BookingHandoff {
  readonly submissionId: string;
  readonly bookingPageId: string;
}

/** Signs a hand off into the token the booking page's address carries; the API holds the key. */
export type SignHandoff = (handoff: BookingHandoff) => string;

/** The visitor's email (the form's first email question) and name (the `name` question, else a short text labelled with "name"). */
export function visitorOf(
  document: Pick<FormDocument, 'questions'>,
  answers: Readonly<Record<string, unknown>>,
): { readonly name?: string; readonly email?: string } {
  const text = (key: string | undefined) => {
    const value = key === undefined ? undefined : answers[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 200) : undefined;
  };
  const email = text(document.questions.find((question) => question.answerType === 'email')?.key);
  // By key first; else a short text labelled as a name, but never a company's or a team's ("Company name").
  const named =
    document.questions.find(
      (question) => question.answerType === 'short_text' && ['name', 'full_name', 'your_name'].includes(question.key),
    ) ??
    document.questions.find(
      (question) =>
        question.answerType === 'short_text' &&
        /name/i.test(question.label) &&
        !/company|business|organi[sz]ation|team|brand|product/i.test(question.label),
    );
  const name = text(named?.key);
  return { ...(name === undefined ? {} : { name }), ...(email === undefined ? {} : { email }) };
}

/**
 * The next step a stored submission gives (AC-570, AC-1057; spec 0043,
 * AC-1606): the routing rule's route when one matched, else the form's own
 * After someone sends it: the thank you, the redirect, or the booking page
 * with a signed hand off when that page is live right now; a paused or
 * deleted page falls back to the thank you.
 */
async function nextOf(
  tx: WorkspaceTx,
  document: FormDocument,
  submissionId: string | undefined,
  sign: SignHandoff | undefined,
  route: Route | undefined,
  where: { readonly workspaceId: string; readonly publicOrigins: readonly string[] },
): Promise<SubmitNext> {
  const { after } = document;
  // A redirect that has come to name another workspace's page is never followed (spec 0056, AC-5612): a rule's falls
  // through to the form's own next step, and the form's own is answered as its thank you.
  const stays = async (url: string) =>
    (await workspaceAddressProblem(tx, where.workspaceId, url, where.publicOrigins)) === undefined;
  if (route?.kind === 'message') return { kind: 'message', text: route.message, offersMeeting: false };
  if (route?.kind === 'redirect' && (await stays(route.url))) return { kind: 'redirect', url: route.url };
  if (route?.kind === 'book' && submissionId !== undefined) {
    const countdownSeconds = after.kind === 'booking' ? after.countdownSeconds : BOOKING_COUNTDOWN.default;
    const routed = await bookingNext(tx, route.bookingPageId, submissionId, sign, countdownSeconds, route.message);
    if (routed !== undefined) return routed;
  }
  if (after.kind === 'redirect') {
    return (await stays(after.url))
      ? { kind: 'redirect', url: after.url }
      : { kind: 'message', text: '', offersMeeting: false };
  }
  if (after.kind === 'message') return { kind: 'message', text: after.message, offersMeeting: false };
  const booked =
    submissionId === undefined
      ? undefined
      : await bookingNext(tx, after.bookingPageId, submissionId, sign, after.countdownSeconds, after.message);
  return booked ?? { kind: 'message', text: after.message, offersMeeting: false };
}

/** On to a booking page with a signed hand off, when the page is live; undefined when it is paused or gone. */
async function bookingNext(
  tx: WorkspaceTx,
  bookingPageId: string,
  submissionId: string,
  sign: SignHandoff | undefined,
  countdownSeconds: number,
  text: string,
): Promise<SubmitNext | undefined> {
  const [page] = await tx
    .select({
      publicKey: bookingPages.publicKey,
      slug: bookingPages.slug,
      workspaceId: bookingPages.workspaceId,
      ownerUserId: bookingPages.ownerUserId,
      isPrivate: bookingPages.isPrivate,
    })
    .from(bookingPages)
    .where(and(eq(bookingPages.id, bookingPageId), eq(bookingPages.status, 'live'), isNull(bookingPages.deletedAt)));
  if (page === undefined) return undefined;
  const token = sign?.({ submissionId, bookingPageId });
  // The page's own address: `/<handle>/<slug>` once its owner has a handle, else `/b/<key>`.
  const url = `${await pagePath(tx, page)}${token === undefined ? '' : `?p=${encodeURIComponent(token)}`}`;
  return { kind: 'booking', url, countdownSeconds, text };
}

/**
 * A hand off's submission, read in the booking page's own workspace (row
 * level security keeps another workspace's out), and only when the version
 * it was sent to sends its visitors on to this very page: the signature is
 * not the only thing binding a submission to a page (security review, 21
 * October 2026). Undefined otherwise.
 */
async function handedOff(tx: WorkspaceTx, submissionId: string, pageId: string) {
  const [row] = await tx
    .select({
      id: formSubmissions.id,
      versionId: formSubmissions.versionId,
      answers: formSubmissions.answers,
      hidden: formSubmissions.hidden,
      context: formSubmissions.context,
    })
    .from(formSubmissions)
    .where(eq(formSubmissions.id, submissionId));
  if (row === undefined) return undefined;
  const version = (await loadVersions(tx, [row.versionId])).get(row.versionId);
  if (version === undefined) return undefined;
  const { after } = version.document;
  // The page the form's After sends to, or the one a routing rule sent this submission to (spec 0043).
  const routedHere =
    (after.kind === 'booking' && after.bookingPageId === pageId) ||
    (await submissionDecision(tx, row.id))?.routedPageId === pageId;
  if (!routedHere) return undefined;
  return { id: row.id, document: version.document, answers: row.answers, hidden: row.hidden, context: row.context };
}

/**
 * The name and email a hand off's submission gave (AC-1058), for the booking
 * page `pageId` its form sends visitors on to; empty for any other.
 */
export async function handoffVisitor(
  tx: WorkspaceTx,
  submissionId: string,
  pageId: string,
): Promise<{ readonly name?: string; readonly email?: string }> {
  const found = await handedOff(tx, submissionId, pageId);
  if (found === undefined) return {};
  const answers =
    typeof found.answers === 'object' && found.answers !== null ? (found.answers as Record<string, unknown>) : {};
  return visitorOf(found.document, answers);
}

/**
 * What a hand off's submission answered (spec 0057, AC-5713), for the booking page `pageId` its form sends visitors on
 * to only: each answered question's key, its answer, and the attribute it was filed on with the form's target object.
 * Empty for any other page.
 */
export async function handoffAnswers(
  tx: WorkspaceTx,
  submissionId: string,
  pageId: string,
): Promise<
  readonly {
    readonly key: string;
    readonly value: unknown;
    readonly filedOn?: { objectId: string; attributeId: string };
  }[]
> {
  const found = await handedOff(tx, submissionId, pageId);
  if (found === undefined) return [];
  const answers =
    typeof found.answers === 'object' && found.answers !== null ? (found.answers as Record<string, unknown>) : {};
  const objectId = found.document.targets.main?.objectId;
  return found.document.questions.flatMap((question) => {
    if (!Object.hasOwn(answers, question.key)) return [];
    const attributeId = question.filedOn?.attributeId;
    return [
      {
        key: question.key,
        value: answers[question.key],
        ...(attributeId === undefined || objectId === undefined ? {} : { filedOn: { objectId, attributeId } }),
      },
    ];
  });
}

/**
 * What a hand off's submission gave, as page `pageId`'s routing rules read it (spec 0043, AC-1608): its answers by
 * question key and the visit's hidden fields as `hidden.<name>`; empty for any other page.
 */
export async function handoffFacts(tx: WorkspaceTx, submissionId: string, pageId: string): Promise<Facts> {
  const found = await handedOff(tx, submissionId, pageId);
  if (found === undefined) return {};
  const answers =
    typeof found.answers === 'object' && found.answers !== null ? (found.answers as Record<string, unknown>) : {};
  return { ...answers, ...hiddenFacts(found.hidden, found.context) };
}

/** The submission a booking on page `pageId` links to (AC-1058): one this page's form handed on, else undefined. */
export async function handoffSubmission(
  tx: WorkspaceTx,
  submissionId: string,
  pageId: string,
): Promise<string | undefined> {
  return (await handedOff(tx, submissionId, pageId))?.id;
}

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

/** What storing a submission takes besides the body. */
export interface SubmitInput {
  readonly formId: string;
  readonly body: SubmitBody;
  readonly captcha: CaptchaVerdict;
  /** What the API made of the fill ticket; `missing` when the API checked none. */
  readonly ticket?: TicketVerdict;
  /** The client address, already hashed with the salt. */
  readonly ipHash?: string;
  /** True when a site's server signed the post with the form's secret. */
  readonly signed?: boolean;
  /** True when the per form and email limit was spent: a content sign, not a refusal. */
  readonly emailOverLimit?: boolean;
  /** The server key answers are hashed with for repeats; without it repeats aren't looked for. */
  readonly answersKey?: string;
  /** Signs the booking hand off when the form sends visitors on to book (AC-1057). */
  readonly signHandoff?: SignHandoff;
  /** Our own public origins: a redirect to another workspace's page is never followed (spec 0056, AC-5612). */
  readonly publicOrigins?: readonly string[];
}

/** What storing a submission answered: the visitor's next step, and how the spam checks judged it. */
export interface SubmitOutcome {
  readonly next: SubmitNext;
  readonly verdict: SpamJudgement['verdict'];
  /** True when this attempt was already stored (a retry of the same idempotency key). */
  readonly replayed: boolean;
}

/** HMAC-SHA256 of answers with their keys in order, under the server's key and the form's id: the same answers on one form always hash the same, and nothing links them elsewhere. */
function answersHash(key: string, formId: string, answers: Readonly<Record<string, unknown>>): string {
  const sorted = Object.fromEntries(Object.entries(answers).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return createHmac('sha256', key)
    .update(`${formId}\n${JSON.stringify(sorted)}`)
    .digest('hex');
}

/** Whether a submission with this idempotency key is already stored for the form. */
async function storedAttempt(tx: WorkspaceTx, formId: string, key: string): Promise<boolean> {
  const [first] = await tx
    .select({ id: formSubmissions.id })
    .from(formSubmissions)
    .where(and(eq(formSubmissions.formId, formId), eq(formSubmissions.idempotencyKey, key)));
  return first !== undefined;
}

/** How many submissions to this form in the last day carried exactly these answers (at most 3 are counted). */
async function repeatsOf(tx: WorkspaceTx, workspaceId: string, formId: string, hash: string): Promise<number> {
  const result = await tx.execute<{ repeats: number }>(sql`
    select count(*)::int as repeats from (
      select 1 from ${formSubmissions}
      where ${formSubmissions.workspaceId} = ${workspaceId}
        and ${formSubmissions.formId} = ${formId}
        and ${formSubmissions.answersHash} = ${hash}
        and ${formSubmissions.receivedAt} > now() - make_interval(hours => ${REPEAT_WINDOW_HOURS})
      limit 3
    ) as same`);
  return result.rows[0]?.repeats ?? 0;
}

/**
 * Stores one submission (AC-553 to AC-556). The form must be live (a paused
 * one is 410 `FORM_CLOSED`, AC-662), and its answers are checked against the
 * live version whatever version the page loaded (unknown keys dropped; a
 * question added since and left empty fails only if it is required). A
 * submission a bot signal flags (`judgeSubmission`) is stored as `spam` with
 * its answers to known questions and gets the same answer as success
 * (AC-586); any other is checked (`checkAnswers`, field errors as refusals on
 * each question key, nothing stored), its content scored (`scoreContent`,
 * with the same answers' repeats on this form in the last day), and stored
 * as `spam`, `needs_review` (waiting for `resolveSubmission`, no job) or
 * `received` with its job queued. Spam and review answer as success too. The same
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
  // A snippet names its workspace: one pasted onto another workspace's form address is refused as not found.
  const named = body.context?.workspace;
  if (named !== undefined && named !== workspacePublicKey(scope.workspaceId)) {
    throw refuse('NOT_FOUND', 'That form does not exist.');
  }
  const cameFrom = body.context === undefined ? {} : storedContext(body.context);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const form = publicRow(await loadForm(tx, input.formId));
      if (form.status !== 'live') throw refuse('FORM_CLOSED', FORM_CLOSED_MESSAGE);
      const live = (await loadVersions(tx, [form.liveVersionId])).get(form.liveVersionId);
      if (live === undefined) throw new Error('A live form names a version that is gone.');
      const rendered = publicFormOf(live.document, {
        publicKey: form.publicKey,
        status: 'live',
        versionNumber: live.number,
      });
      const ticket = input.ticket ?? { kind: 'missing' };
      const known = new Set(rendered.questions.map((question) => question.key));
      // Bot signals need no answers: one of them stores the submission as spam, its answers unchecked.
      const bot = judgeSubmission({
        ...(body.company_url === undefined ? {} : { honeypot: body.company_url }),
        ...(body.fillMs === undefined ? {} : { fillMs: body.fillMs }),
        ticket,
        captcha: input.captcha,
        settings: live.document.spam,
        content: { score: 0, signals: [] },
      });
      let answers: Readonly<Record<string, unknown>>;
      let judged: SpamJudgement;
      let hash: string | undefined;
      let claimedIds: readonly string[] = [];
      if (bot.verdict === 'spam') {
        // A spam submission keeps its files with it, quarantined (late trap #52): a real visitor a bot signal caught
        // (autofill in the honeypot, 25 Oct 2026) is released later, and their file has to be there to file. They
        // go when the submission does, as any attached upload does. An upload that can't be claimed (not this form's,
        // taken, or past its day) is dropped, never a refusal: a bot is told nothing.
        const kept = Object.fromEntries(Object.entries(body.answers).filter(([key]) => known.has(key)));
        const fileKeys = new Set(rendered.questions.filter((q) => q.answerType === 'file').map((q) => q.key));
        answers = Object.fromEntries(Object.entries(kept).filter(([key]) => !fileKeys.has(key)));
        try {
          const claimed = await claimUploads(tx, {
            formId: form.id,
            questions: rendered.questions,
            answers: kept,
            invalid: formStrings(rendered.language).fileInvalid,
          });
          answers = claimed.answers;
          claimedIds = claimed.ids;
        } catch (error) {
          if (!isRefusal(error)) throw error;
        }
        judged = bot;
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
        // Hashed as the visitor sent them (a file as its upload id), so a retry hashes the same as the first try.
        const sent = answers;
        try {
          const claimed = await claimUploads(tx, {
            formId: form.id,
            questions: rendered.questions,
            answers,
            invalid: formStrings(rendered.language).fileInvalid,
          });
          answers = claimed.answers;
          claimedIds = claimed.ids;
        } catch (error) {
          // A retry of a submission that was stored: its files are attached already, and the insert below answers as a replay.
          if (!isRefusal(error) || !(await storedAttempt(tx, form.id, body.idempotencyKey))) throw error;
        }
        hash =
          Object.keys(sent).length === 0 || input.answersKey === undefined
            ? undefined
            : answersHash(input.answersKey, form.id, sent);
        const content = scoreContent({
          questions: rendered.questions,
          answers,
          repeats: hash === undefined ? 0 : await repeatsOf(tx, scope.workspaceId, form.id, hash),
          ticket,
          ...(body.fillMs === undefined ? {} : { fillMs: body.fillMs }),
          ...(input.signed === true ? { signed: true } : {}),
          ...(input.emailOverLimit === true ? { emailOverLimit: true } : {}),
        });
        judged = judgeSubmission({
          ...(body.fillMs === undefined ? {} : { fillMs: body.fillMs }),
          ticket,
          captcha: input.captcha,
          settings: live.document.spam,
          content,
        });
      }
      const state = judged.verdict === 'spam' ? 'spam' : judged.verdict === 'review' ? 'needs_review' : 'received';
      const inserted = await tx
        .insert(formSubmissions)
        .values({
          workspaceId: scope.workspaceId,
          formId: form.id,
          versionId: live.id,
          idempotencyKey: body.idempotencyKey,
          state,
          answers,
          hidden: body.hidden,
          context: Object.keys(cameFrom).length === 0 ? null : cameFrom,
          spam: {
            verdict: judged.verdict,
            signals: judged.signals,
            contentScore: judged.score,
            ...(input.captcha.kind === 'score' ? { score: input.captcha.score } : {}),
          },
          ipHash: input.ipHash ?? null,
          answersHash: hash ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: formSubmissions.id });
      const [row] = inserted;
      if (row === undefined) {
        // A retry: the same next step, handed off for the submission the first attempt stored, but only to the
        // same answers from the same address. Anyone else repeating a key gets the thank you, never a token for
        // someone else's name and email (security review, 21 October 2026).
        const [first] = await tx
          .select({ id: formSubmissions.id, ipHash: formSubmissions.ipHash, answersHash: formSubmissions.answersHash })
          .from(formSubmissions)
          .where(and(eq(formSubmissions.formId, form.id), eq(formSubmissions.idempotencyKey, body.idempotencyKey)));
        const same =
          first !== undefined && first.ipHash === (input.ipHash ?? null) && first.answersHash === (hash ?? null);
        const again = await nextOf(
          tx,
          live.document,
          same ? first.id : undefined,
          input.signHandoff,
          same ? await storedRoute(tx, live.document, first.id) : undefined,
          { workspaceId: scope.workspaceId, publicOrigins: input.publicOrigins ?? [] },
        );
        return { next: again, verdict: judged.verdict, replayed: true };
      }
      await attachUploads(tx, { submissionId: row.id, ids: claimedIds });
      if (state === 'received') {
        await startJob(context, registry, { kind: FORMS_PROCESS, params: { submissionId: row.id } });
      }
      // Routing (spec 0043, AC-1606): only a submission taken as received is routed; spam and held ones get the fallback.
      const route =
        state === 'received'
          ? await routeSubmission(tx, {
              workspaceId: scope.workspaceId,
              formId: form.id,
              submissionId: row.id,
              document: live.document,
              answers,
              hidden: body.hidden,
              context: cameFrom,
            })
          : undefined;
      const next = await nextOf(tx, live.document, row.id, input.signHandoff, route, {
        workspaceId: scope.workspaceId,
        publicOrigins: input.publicOrigins ?? [],
      });
      return { next, verdict: judged.verdict, replayed: false };
    },
    hooks,
  );
  return result;
}
