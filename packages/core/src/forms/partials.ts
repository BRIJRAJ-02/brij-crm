// Save and resume (spec 0063, AC-6319, AC-6330): a visitor's part filled form,
// kept so they can finish it later.
//
// The rules this module holds, which the tests beside it prove:
//
// - A partial is never a submission. It is never filed, never notified, never
//   counted as a submission and never shown in Submissions, and it is deleted
//   the moment one is stored (`dropPartial`) or thirty days after it was made
//   (the daily cleanup).
// - The link carries one opaque token and nothing else: no answer, no email,
//   no name. The token is 32 random bytes; only its SHA-256 reaches a row, so
//   a stolen database opens nobody's answers.
// - Answers are checked question by question exactly as a submit's are, so a
//   partial can hold nothing a submission couldn't.
//
// Everything here acts in the scope `enterPublicForm` made from the form's
// public key: the form as the actor, no data access, no record ever read.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  checkAnswers,
  PARTIAL_KEPT_DAYS,
  PARTIALS_PER_ADDRESS,
  RESUME_TOKEN_BYTES,
  ResumeToken,
  savesProgress,
  type PartialSaved,
  type ResumedFill,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq, sql } from 'drizzle-orm';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { inWorkspace } from '../access/run.ts';
import { runWrite } from '../engine/write.ts';
import { queueFormResume } from '../emails/queue.ts';
import { loadForm, loadVersions, publicFormOf } from './shared.ts';

const { formPartials } = schema;

/** What a resume link refuses with: never whether the token simply expired, so nothing can be learnt by probing. */
const UNKNOWN_PARTIAL = 'That link has expired. Fill the form in again.';

/** The SHA-256 of a resume token, in hex: the only form of it a row ever holds. */
export function partialTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A fresh resume token: `RESUME_TOKEN_BYTES` of randomness, base64url, never stored and never logged. */
export function mintResumeToken(): string {
  return randomBytes(RESUME_TOKEN_BYTES).toString('base64url');
}

/**
 * Whether two token hashes are the same, compared in constant time. The hash
 * is looked up by index, so this is belt and braces, but a timing difference
 * on a secret is never worth leaving in.
 */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Refuses (a programming error) any scope but the one the form's own public key made. */
function checkPublicScope(scope: EngineScope, formId: string): void {
  const { principal } = scope.access;
  if (principal.kind !== 'form' || principal.formId !== formId) {
    throw new Error('Only the form’s own public scope saves or resumes it.');
  }
}

/** The live form and version a partial is saved against; a form that isn't live takes no partial. */
async function liveForm(tx: WorkspaceTx, formId: string) {
  const form = await loadForm(tx, formId);
  if (form === undefined || form.liveVersionId === null || form.status !== 'live') {
    throw refuse('NOT_FOUND', 'That form does not exist.');
  }
  const live = (await loadVersions(tx, [form.liveVersionId])).get(form.liveVersionId);
  if (live === undefined) throw new Error('A live form names a version that is gone.');
  return { form, live };
}

/**
 * The answers of a part filled form worth keeping: every one that comes out
 * canonical, and nothing else.
 *
 * A half filled form is half invalid by nature — the visitor is still typing,
 * and a question they have not reached has no answer yet — so this must never
 * be all or nothing the way a submit is. `checkAnswers` answers with field
 * errors rather than partial results, so the answers it objected to are
 * dropped and it is asked again, until it is happy. That is at most one round
 * per question, and in practice one or two.
 *
 * `absentNotAsked` is what makes this safe: a question with no answer yet is
 * skipped rather than required, so nothing is ever invented for one.
 */
function keptAnswers(
  form: Parameters<typeof checkAnswers>[0],
  given: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  let answers: Record<string, unknown> = { ...given };
  // Bounded by the keys given: each round drops at least one, so this always ends.
  for (let round = 0; round <= Object.keys(given).length; round += 1) {
    const checked = checkAnswers(form, answers, { absentNotAsked: true });
    if (checked.ok) return checked.answers;
    const bad = Object.keys(checked.fields);
    if (bad.length === 0) return {};
    answers = Object.fromEntries(Object.entries(answers).filter(([key]) => !bad.includes(key)));
  }
  return {};
}

/** What saving a partial takes. */
export interface SavePartialInput {
  readonly formId: string;
  /** The answers so far, as the page has them; checked here exactly as a submit's are. */
  readonly answers: Readonly<Record<string, unknown>>;
  readonly stepId?: string;
  /** The token the visitor already holds, when this isn't their first save. */
  readonly resumeToken?: string;
  /** The saver's address, already hashed with the salt: rate limits and the per address cap only. */
  readonly ipHash?: string;
}

/**
 * Saves a visitor's progress (AC-6319). The answers are run through
 * `checkAnswers` against the live version, so a partial holds only canonical
 * answers to questions this form actually asks; an answer that doesn't fit is
 * simply left out rather than refusing the save, because a half filled form
 * is half invalid by nature and the visitor is still typing.
 *
 * A form whose owner turned save and resume off (`savesProgress`) stores
 * nothing and says so, so the page can stop asking.
 *
 * The token is minted on the first save only. A later save with a token that
 * is unknown, expired or another form's is treated as a first save and gets a
 * new one: a visitor is never shown someone else's answers, and never told
 * which it was.
 */
export async function savePartial(scope: EngineScope, input: SavePartialInput): Promise<PartialSaved> {
  checkPublicScope(scope, input.formId);
  const { result } = await runWrite(scope, async ({ tx }) => {
    const { form, live } = await liveForm(tx, input.formId);
    if (!savesProgress(live.document)) {
      throw refuse('FORBIDDEN', 'This form doesn’t save progress.');
    }
    const rendered = publicFormOf(live.document, {
      publicKey: form.publicKey,
      status: 'live',
      versionNumber: live.number,
    });
    const answers = keptAnswers(rendered, input.answers);
    const existing =
      input.resumeToken === undefined ? undefined : await rowOfToken(tx, input.formId, input.resumeToken);
    if (existing !== undefined) {
      const expiresAt = await tx
        .update(formPartials)
        .set({
          answers,
          stepId: input.stepId ?? null,
          versionId: live.id,
          updatedAt: new Date(),
        })
        .where(and(eq(formPartials.workspaceId, scope.workspaceId), eq(formPartials.id, existing.id)))
        .returning({ expiresAt: formPartials.expiresAt });
      const when = expiresAt[0]?.expiresAt;
      if (when !== undefined) {
        return { resumeToken: input.resumeToken ?? '', expiresAt: when.toISOString() };
      }
    }
    // A new partial: the per address cap first, so one saver can never fill the table for a form.
    if (input.ipHash !== undefined) await capPerAddress(tx, scope.workspaceId, input.formId, input.ipHash);
    const token = mintResumeToken();
    const [row] = await tx
      .insert(formPartials)
      .values({
        workspaceId: scope.workspaceId,
        formId: form.id,
        versionId: live.id,
        tokenHash: partialTokenHash(token),
        answers,
        stepId: input.stepId ?? null,
        ipHash: input.ipHash ?? null,
        expiresAt: sql`now() + make_interval(days => ${PARTIAL_KEPT_DAYS})`,
      })
      .returning({ expiresAt: formPartials.expiresAt });
    if (row === undefined) throw new Error('A partial was not stored.');
    return { resumeToken: token, expiresAt: row.expiresAt.toISOString() };
  });
  return result;
}

/** The oldest partials past the per address cap, removed before a new one is stored. */
async function capPerAddress(tx: WorkspaceTx, workspaceId: string, formId: string, ipHash: string): Promise<void> {
  await tx.execute(sql`
    delete from form_partials where (workspace_id, id) in (
      select workspace_id, id from form_partials
      where workspace_id = ${workspaceId} and form_id = ${formId} and ip_hash = ${ipHash}
      order by created_at desc offset ${PARTIALS_PER_ADDRESS - 1}
    )
  `);
}

/** One live partial of this form by its token, or undefined for an unknown, expired or another form's token. */
async function rowOfToken(tx: WorkspaceTx, formId: string, token: string) {
  const parsed = ResumeToken.safeParse(token);
  if (!parsed.success) return undefined;
  const hash = partialTokenHash(parsed.data);
  const [row] = await tx
    .select({
      id: formPartials.id,
      formId: formPartials.formId,
      versionId: formPartials.versionId,
      tokenHash: formPartials.tokenHash,
      answers: formPartials.answers,
      stepId: formPartials.stepId,
      expiresAt: formPartials.expiresAt,
    })
    .from(formPartials)
    .where(and(eq(formPartials.formId, formId), eq(formPartials.tokenHash, hash)));
  if (row === undefined || !sameHash(row.tokenHash, hash)) return undefined;
  // Expiry is checked on the read as well as by the cleanup: a row the sweep hasn't reached yet is already closed.
  return row.expiresAt.getTime() <= Date.now() ? undefined : row;
}

/**
 * The answers and step a resume token opens (AC-6319), read only. Answers to
 * questions the live version no longer has are dropped here, so a form
 * published again while someone was away still resumes, with what still fits.
 * An unknown, expired or foreign token is NOT_FOUND, in the same words either
 * way.
 */
export async function resumePartial(
  scope: EngineScope,
  input: { readonly formId: string; readonly resumeToken: string },
): Promise<ResumedFill> {
  checkPublicScope(scope, input.formId);
  return inWorkspace(scope, async (tx) => {
    const { form, live } = await liveForm(tx, input.formId);
    const row = await rowOfToken(tx, input.formId, input.resumeToken);
    if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_PARTIAL);
    const rendered = publicFormOf(live.document, {
      publicKey: form.publicKey,
      status: 'live',
      versionNumber: live.number,
    });
    const answers = keptAnswers(rendered, row.answers as Readonly<Record<string, unknown>>);
    const steps = new Set(live.document.steps.map((step) => step.id));
    return {
      answers,
      ...(row.stepId !== null && steps.has(row.stepId) ? { stepId: row.stepId } : {}),
      expiresAt: row.expiresAt.toISOString(),
    };
  });
}

/**
 * Removes the partial a token names, on an accepted submit (AC-6319: a
 * partial is deleted on submit). It runs in the submit's own transaction, so
 * a submission that doesn't commit leaves the visitor's saved answers alone.
 * An unknown token removes nothing and says nothing: this is never a place to
 * learn whether a token exists.
 */
export async function dropPartial(tx: WorkspaceTx, formId: string, token: string | undefined): Promise<void> {
  if (token === undefined) return;
  const parsed = ResumeToken.safeParse(token);
  if (!parsed.success) return;
  await tx
    .delete(formPartials)
    .where(and(eq(formPartials.formId, formId), eq(formPartials.tokenHash, partialTokenHash(parsed.data))));
}

/** Everything a resume link email needs, all of it read from the partial's own row. */
export interface ResumeLinkTarget {
  /** The partial's id, which the email is keyed by, so asking twice in a day sends once. */
  readonly id: string;
  /** The address the visitor already typed into this form; absent when they have typed none yet. */
  readonly email?: string;
  readonly formName: string;
  /** The form's public address, which the link is built on. */
  readonly publicKey: string;
  /** ISO 8601 UTC: when the link stops working. */
  readonly expiresAt: string;
}

/**
 * What a resume link email would be sent to and about (AC-6319). The address
 * comes from the form's own email answer among the *saved* answers, never
 * from the request, so nobody can have a link mailed to someone else's
 * address. An unknown, expired or foreign token is NOT_FOUND.
 */
export async function resumeLinkTarget(
  scope: EngineScope,
  input: { readonly formId: string; readonly resumeToken: string },
): Promise<ResumeLinkTarget> {
  checkPublicScope(scope, input.formId);
  return inWorkspace(scope, async (tx) => {
    const { form, live } = await liveForm(tx, input.formId);
    const row = await rowOfToken(tx, input.formId, input.resumeToken);
    if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_PARTIAL);
    const stored = row.answers as Readonly<Record<string, unknown>>;
    const key = live.document.questions.find((question) => question.answerType === 'email')?.key;
    const value = key === undefined ? undefined : stored[key];
    const email = typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 254) : undefined;
    return {
      id: row.id,
      ...(email === undefined ? {} : { email }),
      formName: form.name,
      publicKey: form.publicKey,
      expiresAt: row.expiresAt.toISOString(),
    };
  });
}

/** What sending a resume link answered: it went, or there was no address to send it to. */
export type ResumeLinkSent = { readonly sent: true } | { readonly sent: false; readonly reason: 'no-email' };

/**
 * Emails the visitor their resume link (AC-6319). The address is the one
 * already saved in this form's own email answer, never one from the request,
 * and the link carries the token and nothing else (AC-6330): no answer, no
 * name, no word of what has been filled in. `queueFormResume` is keyed by the
 * partial and the UTC day, so pressing the button again the same day sends
 * nothing more.
 *
 * The link is an app path, not a full address: an email may only link to the
 * app's own origin (`onAppOrigin`), which is what serves `/f/:key`, so the
 * core builds no origin out of its own environment and none is passed in.
 */
export async function sendResumeLink(
  scope: EngineScope,
  input: { readonly formId: string; readonly resumeToken: string },
): Promise<ResumeLinkSent> {
  checkPublicScope(scope, input.formId);
  const target = await resumeLinkTarget(scope, { formId: input.formId, resumeToken: input.resumeToken });
  const { email } = target;
  if (email === undefined) return { sent: false, reason: 'no-email' };
  // A path, not a full address: the renderer joins it to the app's own origin, the only one an email may link to.
  const path = `/f/${encodeURIComponent(target.publicKey)}?resume=${encodeURIComponent(input.resumeToken)}`;
  const { result } = await runWrite(scope, async ({ tx }) => {
    await queueFormResume(tx, {
      // Digits only: an email's key takes ids, counts and times, never free text (`emailKey`), so the UTC day
      // goes in as `YYYYMMDD`. It is still one link a day per saved form.
      day: new Date().toISOString().slice(0, 10).replaceAll('-', ''),
      partialId: target.id,
      address: email,
      params: { formName: target.formName.slice(0, 200), resumePath: path, expiresAt: target.expiresAt },
    });
    return { sent: true } as const;
  });
  return result;
}
