// Queueing an email (the emails lane): one `emails` row and one queue row,
// written in the caller's transaction, so the email exists exactly when the
// change it is about commits, and a change rolled back sends nothing. The
// queue row (`crm_enqueue_email`, a security definer owned by crm_queue)
// holds the workspace and the email's id only; the params stay in the tenant
// table. The key is the kind and the ids of what the email is about, so the
// same event queued twice (a retried job, a second call) makes one email.
// The worker's `crm_email` task sends it (`send.ts`).
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import {
  EMAIL_PARAMS,
  EmailAddress,
  type BookingCalendarRemovedEmail,
  type CalendarDisconnectedEmail,
  type EmailParams,
  type FormConfirmationEmail,
  type FormSubmissionEmail,
  type ImportFinishedEmail,
  type MentionEmail,
  type QueuedEmailKind,
} from '@crm/contracts/emails';
import type { WorkspaceTx } from '@crm/db';

/** Who an email goes to: a member (their address read when it is sent) or anyone else, by address. */
export type EmailReader = { readonly memberId: string } | { readonly address: string };

/** One email to queue: its kind, the ids that make it once, its reader and its params. */
export interface QueueEmailInput<K extends QueuedEmailKind> {
  readonly kind: K;
  /** The ids of what the email is about; with the kind, its idempotency key. Ids only, never a value. */
  readonly ids: readonly string[];
  readonly to: EmailReader;
  /** A member a reply goes to (a form's owner). */
  readonly replyToMemberId?: string;
  readonly params: EmailParams[K];
}

/**
 * What queueing answered: `queued` (this call made it), `exists` (the same
 * key was queued before: that email's id, nothing queued again), or
 * `refused` (params its template doesn't know): nothing is stored and the
 * caller's change goes on, since an email must never undo the change it is
 * about.
 */
export type QueuedEmail =
  | { readonly outcome: 'queued' | 'exists'; readonly emailId: string }
  | { readonly outcome: 'refused'; readonly code: 'PARAMS_INVALID' };

/** An id in a key: a uuid, a count or time in digits, or a word from the closed list a kind keys by. */
const Id = z.union([z.uuid(), z.string().regex(/^\d{1,12}$/), z.enum(['expired', 'failed'])]);

/** An email's idempotency key: its kind and the ids, `form_submission:<submission>:<member>`. Never a value. */
export function emailKey(kind: QueuedEmailKind, ids: readonly string[]): string {
  if (ids.length === 0) throw new Error('An email needs the ids of what it is about.');
  return [kind, ...ids.map((id) => Id.parse(id))].join(':');
}

/** One email checked and ready to store, or why not. */
type Checked =
  | {
      readonly ok: true;
      readonly row: {
        readonly kind: QueuedEmailKind;
        readonly key: string;
        readonly to_member_id: string | null;
        readonly to_address: string | null;
        readonly reply_to_member_id: string | null;
        readonly params: unknown;
      };
    }
  | { readonly ok: false };

/** Checks one email's params, reader and key. */
function check(input: QueueEmailInput<QueuedEmailKind>): Checked {
  const params = EMAIL_PARAMS[input.kind].safeParse(input.params);
  const address = 'address' in input.to ? EmailAddress.safeParse(input.to.address) : undefined;
  if (!params.success || address?.success === false) return { ok: false };
  return {
    ok: true,
    row: {
      kind: input.kind,
      key: emailKey(input.kind, input.ids),
      to_member_id: 'memberId' in input.to ? input.to.memberId : null,
      to_address: address?.data ?? null,
      reply_to_member_id: input.replyToMemberId ?? null,
      params: params.data,
    },
  };
}

/**
 * Queues emails in the caller's transaction (the workspace is the
 * transaction's), in two statements however many: one insert of every row
 * and one call of `crm_enqueue_email` per new row, server side. Each is
 * answered in order: queued, already queued under its key, or refused for
 * params its template doesn't know (nothing stored). A caller outside the
 * worker wakes it once the transaction commits (`commitWrite` does; a public
 * route calls `wakeRelay`), as for any job.
 */
export async function queueEmails(
  tx: WorkspaceTx,
  inputs: readonly QueueEmailInput<QueuedEmailKind>[],
): Promise<readonly QueuedEmail[]> {
  const checked = inputs.map(check);
  const rows = checked.flatMap((each) => (each.ok ? [each.row] : []));
  const ids = new Map<string, { readonly id: string; readonly made: boolean }>();
  if (rows.length > 0) {
    const inserted = await tx.execute<{ id: string; key: string }>(sql`
      insert into emails (workspace_id, kind, key, to_member_id, to_address, reply_to_member_id, params, created_by_type)
      select nullif(current_setting('app.workspace_id', true), '')::uuid, r.kind, r.key, r.to_member_id, r.to_address,
        r.reply_to_member_id, r.params, 'system'
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(
        kind text, key text, to_member_id uuid, to_address text, reply_to_member_id uuid, params jsonb
      )
      on conflict (workspace_id, key) do nothing
      returning id::text as id, key
    `);
    for (const row of inserted.rows) ids.set(row.key, { id: row.id, made: true });
    const made = inserted.rows.map((row) => row.id);
    if (made.length > 0) {
      const queued = await tx.execute<{ queued: boolean }>(
        sql`select crm_enqueue_email(id::uuid) as queued from jsonb_array_elements_text(${JSON.stringify(made)}::jsonb) as id`,
      );
      if (queued.rows.some((row) => !row.queued)) throw new Error('An email could not be queued.');
    }
    const taken = rows.map((row) => row.key).filter((key) => !ids.has(key));
    if (taken.length > 0) {
      const found = await tx.execute<{ id: string; key: string }>(
        sql`select id::text as id, key from emails where key in (select jsonb_array_elements_text(${JSON.stringify(taken)}::jsonb))`,
      );
      for (const row of found.rows) ids.set(row.key, { id: row.id, made: false });
    }
  }
  return checked.map((each): QueuedEmail => {
    if (!each.ok) return { outcome: 'refused', code: 'PARAMS_INVALID' };
    const stored = ids.get(each.row.key);
    if (stored === undefined) throw new Error('The email’s key is taken, but its row isn’t readable here.');
    return { outcome: stored.made ? 'queued' : 'exists', emailId: stored.id };
  });
}

/**
 * Queues one email in the caller's transaction: `queueEmails` for one. A key
 * queued before answers that email (`exists`), and params the template
 * doesn't know are refused (`refused`), never thrown, so the caller's change
 * still commits.
 */
export async function queueEmail<K extends QueuedEmailKind>(
  tx: WorkspaceTx,
  input: QueueEmailInput<K>,
): Promise<QueuedEmail> {
  const [answer] = await queueEmails(tx, [input]);
  if (answer === undefined) throw new Error('Queueing an email answered nothing.');
  return answer;
}

/**
 * A new submission's notice to one member (spec 0023, AC-1047), once per
 * submission and member. The forms code calls it in the transaction that
 * processes the submission, after its own checks (spam, the member's
 * `form_notice_prefs`); the member's email preferences are checked again when
 * it is sent.
 */
export function queueFormSubmissionNotice(
  tx: WorkspaceTx,
  input: { readonly submissionId: string; readonly memberId: string; readonly params: FormSubmissionEmail },
): Promise<QueuedEmail> {
  return queueEmail(tx, {
    kind: 'form_submission',
    ids: [input.submissionId, input.memberId],
    to: { memberId: input.memberId },
    params: input.params,
  });
}

/**
 * The visitor's confirmation (spec 0023, AC-1048), once per submission, with
 * replies going to the form's owner. The forms code decides whether one goes
 * (the form turns it on; never for spam; its per address daily limit).
 */
export function queueFormConfirmation(
  tx: WorkspaceTx,
  input: {
    readonly submissionId: string;
    readonly address: string;
    readonly replyToMemberId?: string;
    readonly params: FormConfirmationEmail;
  },
): Promise<QueuedEmail> {
  return queueEmail(tx, {
    kind: 'form_confirmation',
    ids: [input.submissionId],
    to: { address: input.address },
    ...(input.replyToMemberId === undefined ? {} : { replyToMemberId: input.replyToMemberId }),
    params: input.params,
  });
}

/**
 * A member's calendar stopped syncing (spec 0024): once per failing spell of
 * a connection (`since`, when the failures began) and reason, so a reconnect
 * and a later failure tell them again, and access withdrawn after 6 hours of
 * failures says so too.
 */
export function queueCalendarDisconnected(
  tx: WorkspaceTx,
  input: {
    readonly connectionId: string;
    readonly memberId: string;
    /** Why: `failed` (6 hours of failures), or `expired` (access withdrawn), which can follow it in one spell. */
    readonly reason: CalendarDisconnectedEmail['reason'];
    readonly since: Date;
    readonly params: CalendarDisconnectedEmail;
  },
): Promise<QueuedEmail> {
  return queueEmail(tx, {
    kind: 'calendar_disconnected',
    ids: [input.connectionId, input.reason, String(Math.floor(input.since.getTime() / 1000))],
    to: { memberId: input.memberId },
    params: input.params,
  });
}

/** The host's notice that a booking was cancelled because they deleted its calendar event: once per booking. */
export function queueBookingCalendarRemoved(
  tx: WorkspaceTx,
  input: { readonly bookingId: string; readonly memberId: string; readonly params: BookingCalendarRemovedEmail },
): Promise<QueuedEmail> {
  return queueEmail(tx, {
    kind: 'booking_calendar_removed',
    ids: [input.bookingId],
    to: { memberId: input.memberId },
    params: input.params,
  });
}

/** An import's result to the member who started it (#30): once per import. */
export function queueImportFinished(
  tx: WorkspaceTx,
  input: { readonly importId: string; readonly memberId: string; readonly params: ImportFinishedEmail },
): Promise<QueuedEmail> {
  return queueEmail(tx, {
    kind: 'import_finished',
    ids: [input.importId],
    to: { memberId: input.memberId },
    params: input.params,
  });
}

/** A mention's notice to the member mentioned (#29): once per mention and member. */
export function queueMention(
  tx: WorkspaceTx,
  input: { readonly mentionId: string; readonly memberId: string; readonly params: MentionEmail },
): Promise<QueuedEmail> {
  return queueEmail(tx, {
    kind: 'mention',
    ids: [input.mentionId, input.memberId],
    to: { memberId: input.memberId },
    params: input.params,
  });
}
