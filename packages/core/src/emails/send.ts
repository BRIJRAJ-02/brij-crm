// Sending a queued email, the worker's half (the emails lane): read one email
// with what drawing it needs (its reader's address, the reply address, the
// workspace's name and address, whether its reader turned its topic off),
// then record how sending went. Nothing here draws or sends: the worker's
// `crm_email` task does, through the api's mailer, between the two calls, so
// no transaction is open while the mail service answers. System only
// (`@crm/core/system`).
import { sql } from 'drizzle-orm';
import { EMAIL_KIND_TOPICS, EmailAddress, QueuedEmailKind, type EmailTopic } from '@crm/contracts/emails';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';

/** How long a queued email may wait before it is too old to send. */
const STALE_AFTER = '24 hours';

/** A queued email ready to draw and send. */
export interface EmailToSend {
  readonly id: string;
  readonly kind: QueuedEmailKind;
  /** Its params as stored: the worker parses them by the kind's schema as it draws them. */
  readonly params: unknown;
  readonly to: string;
  readonly replyTo?: string;
  /**
   * The name it is sent as, in place of the product's: the workspace's, for an email to someone outside it (a
   * visitor's copy of their form, forms fix b3), so it reads as from the business they wrote to.
   */
  readonly fromName?: string;
  /** The member reader, for the preferences link; none for an address reader. */
  readonly memberId?: string;
  /** Its topic, when its reader can turn it off. */
  readonly topic?: EmailTopic;
  readonly workspaceName: string;
  readonly workspaceSlug: string;
  /** When it was queued: the preferences link is dated by it, so a retry draws the same email. */
  readonly createdAt: Date;
}

/** What reading a queued email found. */
export type LoadedEmail =
  | { readonly kind: 'send'; readonly email: EmailToSend }
  /** Already sent, skipped or failed, or gone: nothing to do. */
  | { readonly kind: 'done' }
  /**
   * Not to be sent: its workspace was deleted, its member reader was removed
   * or turned its topic off, it names a kind this code doesn't know, or it
   * waited more than a day (the runners were off, or it was queued again long
   * after): news that old is no longer worth sending.
   */
  | {
      readonly kind: 'skip';
      readonly reason:
        'recipient_gone' | 'opted_out' | 'unknown_kind' | 'stale' | 'workspace_deleted' | 'managed_member';
    };

interface EmailRow extends Record<string, unknown> {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly params: unknown;
  readonly to_member_id: string | null;
  readonly to_address: string | null;
  readonly member_email: string | null;
  readonly member_active: boolean | null;
  readonly member_managed: boolean;
  readonly reply_email: string | null;
  readonly reply_active: boolean | null;
  readonly workspace_name: string;
  readonly workspace_slug: string;
  readonly workspace_deleted: boolean;
  readonly created_at: Date;
  readonly stale: boolean;
}

/** The kinds that go to someone outside the workspace about it: sent as the workspace, not the product. */
const GUEST_KINDS: ReadonlySet<QueuedEmailKind> = new Set(['form_confirmation', 'form_resume', 'reservation_news']);

/**
 * The only kinds a partner's managed member gets (spec 0070, AC-7023): what their page's visitors trigger. Everything
 * else Timefix would tell a member (a welcome, scheduling and calendar notices, a page edited for them) is the
 * partner's to say, so it is skipped.
 */
const MANAGED_MEMBER_KINDS: ReadonlySet<QueuedEmailKind> = new Set(['form_submission']);

/**
 * Where a reply goes: the member the email names (a visitor's copy replies to the form's owner); for a new
 * submission's notice, the visitor who sent it, as they typed their address (forms fix b4: "Reply" in the inbox
 * answers them, as Tally's and Typeform's notices do). Undefined leaves replies with the sender.
 */
function replyAddress(kind: QueuedEmailKind, row: EmailRow): string | undefined {
  if (row.reply_active === true && row.reply_email !== null) return row.reply_email;
  if (kind !== 'form_submission') return undefined;
  const params = row.params;
  const submitter =
    typeof params === 'object' && params !== null ? (params as { readonly submitter?: unknown }).submitter : undefined;
  const email =
    typeof submitter === 'object' && submitter !== null ? (submitter as { readonly email?: unknown }).email : undefined;
  const parsed = EmailAddress.safeParse(email);
  return parsed.success ? parsed.data : undefined;
}

/** Reads one queued email and everything drawing it needs, in the scope's workspace. */
export async function loadEmail(scope: EngineScope, emailId: string): Promise<LoadedEmail> {
  return inWorkspace(scope, async (tx) => {
    const found = await tx.execute<EmailRow>(sql`
      select e.id::text as id, e.kind, e.status, e.params, e.to_member_id::text as to_member_id, e.to_address,
        m.email as member_email, m.status = 'active' as member_active,
        exists (
          select 1 from managed_members mm where mm.workspace_id = e.workspace_id and mm.member_id = e.to_member_id
            and mm.claimed_at is null
        ) as member_managed,
        r.email as reply_email, r.status = 'active' as reply_active,
        w.name as workspace_name, w.slug as workspace_slug, w.deleted_at is not null as workspace_deleted,
        e.created_at,
        e.created_at < now() - ${STALE_AFTER}::interval as stale
      from emails e
      join workspaces w on w.id = e.workspace_id
      left join members m on m.workspace_id = e.workspace_id and m.id = e.to_member_id
      left join members r on r.workspace_id = e.workspace_id and r.id = e.reply_to_member_id
      where e.id = ${emailId}::uuid
    `);
    const [row] = found.rows;
    if (row === undefined || row.status !== 'queued') return { kind: 'done' };
    if (row.stale) return { kind: 'skip', reason: 'stale' };
    // A deleted workspace sends nothing (spec 0031): an email queued before the deletion carries its records'
    // words, and every link in it, the preferences link included, leads to a workspace that is no longer there.
    // A restore inside the day lets the ones still queued go.
    if (row.workspace_deleted) return { kind: 'skip', reason: 'workspace_deleted' };
    const kind = QueuedEmailKind.safeParse(row.kind);
    if (!kind.success) return { kind: 'skip', reason: 'unknown_kind' };
    const topic = EMAIL_KIND_TOPICS[kind.data];
    let to: string | undefined;
    if (row.to_member_id !== null) {
      if (row.member_active !== true || row.member_email === null) return { kind: 'skip', reason: 'recipient_gone' };
      if (row.member_managed && !MANAGED_MEMBER_KINDS.has(kind.data)) return { kind: 'skip', reason: 'managed_member' };
      to = row.member_email;
      if (topic !== undefined) {
        const choice = await tx.execute<{ subscribed: boolean }>(sql`
          select subscribed from email_preferences where member_id = ${row.to_member_id}::uuid and topic = ${topic}
        `);
        if (choice.rows[0]?.subscribed === false) return { kind: 'skip', reason: 'opted_out' };
      }
    } else {
      to = row.to_address ?? undefined;
    }
    if (to === undefined) return { kind: 'skip', reason: 'recipient_gone' };
    const replyTo = replyAddress(kind.data, row);
    return {
      kind: 'send',
      email: {
        id: row.id,
        kind: kind.data,
        params: row.params,
        to,
        ...(replyTo === undefined ? {} : { replyTo }),
        ...(GUEST_KINDS.has(kind.data) ? { fromName: row.workspace_name } : {}),
        ...(row.to_member_id === null ? {} : { memberId: row.to_member_id }),
        ...(topic === undefined ? {} : { topic }),
        workspaceName: row.workspace_name,
        workspaceSlug: row.workspace_slug,
        createdAt: new Date(row.created_at),
      },
    };
  });
}

/** How one try at sending went. */
export type EmailOutcome =
  | { readonly status: 'sent' }
  /** Not sent and never will be: the reason is a code (`opted_out`, `recipient_gone`, `params_invalid`, …). */
  | { readonly status: 'skipped' | 'failed'; readonly code: string }
  /** This try failed and another will come: counted, the email stays queued. */
  | { readonly status: 'retry'; readonly code: string };

/**
 * Records a try at sending one email. A finished email (sent, skipped,
 * failed) has its params and its address blanked, so what it said lives no
 * longer than it took to send; the row keeps its kind, key and outcome until
 * the daily cleanup. An email no longer queued is left as it is.
 */
export async function finishEmail(scope: EngineScope, emailId: string, outcome: EmailOutcome): Promise<void> {
  await inWorkspace(scope, (tx) =>
    tx.execute(
      outcome.status === 'retry'
        ? sql`
          update emails set attempts = attempts + 1, error_code = ${outcome.code}, updated_at = now()
          where id = ${emailId}::uuid and status = 'queued'`
        : sql`
          update emails set status = ${outcome.status}::email_status,
            error_code = ${outcome.status === 'sent' ? null : outcome.code},
            attempts = attempts + ${outcome.status === 'skipped' ? 0 : 1},
            sent_at = ${outcome.status === 'sent' ? sql`now()` : null},
            params = '{}'::jsonb, to_address = null, updated_at = now()
          where id = ${emailId}::uuid and status = 'queued'`,
    ),
  );
}
