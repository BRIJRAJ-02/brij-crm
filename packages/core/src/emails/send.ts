// Sending a queued email, the worker's half (the emails lane): read one email
// with what drawing it needs (its reader's address, the reply address, the
// workspace's name and address, whether its reader turned its topic off),
// then record how sending went. Nothing here draws or sends: the worker's
// `crm_email` task does, through the api's mailer, between the two calls, so
// no transaction is open while the mail service answers. System only
// (`@crm/core/system`).
import { sql } from 'drizzle-orm';
import { EMAIL_KIND_TOPICS, QueuedEmailKind, type EmailTopic } from '@crm/contracts/emails';
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
      readonly reason: 'recipient_gone' | 'opted_out' | 'unknown_kind' | 'stale' | 'workspace_deleted';
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
  readonly reply_email: string | null;
  readonly reply_active: boolean | null;
  readonly workspace_name: string;
  readonly workspace_slug: string;
  readonly workspace_deleted: boolean;
  readonly created_at: Date;
  readonly stale: boolean;
}

/** Reads one queued email and everything drawing it needs, in the scope's workspace. */
export async function loadEmail(scope: EngineScope, emailId: string): Promise<LoadedEmail> {
  return inWorkspace(scope, async (tx) => {
    const found = await tx.execute<EmailRow>(sql`
      select e.id::text as id, e.kind, e.status, e.params, e.to_member_id::text as to_member_id, e.to_address,
        m.email as member_email, m.status = 'active' as member_active,
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
    return {
      kind: 'send',
      email: {
        id: row.id,
        kind: kind.data,
        params: row.params,
        to,
        ...(row.reply_active === true && row.reply_email !== null ? { replyTo: row.reply_email } : {}),
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
