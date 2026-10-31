// What a webhook says (spec 0064, AC-6426): for each event, what a receiver needs and nothing more, read in the
// transaction of the write it describes. A booking: its id, page, host, times in UTC with the invitee's zone, location
// kind, status, and the invitee's name, email and answers. A form: the submission id, the form, the answers by
// question key and where it came from. A signup: the email and the link page's handle. No tokens, no record ids, no
// file ids: an answer that is not text, a number, yes or no, a list of choices or a phone is left out. Each body is
// at most 64 KB; one over it loses its longer answers first, then its answers.
import {
  WEBHOOK_BODY_MAX_BYTES,
  type WebhookAnswer,
  type WebhookBookingData,
  type WebhookDeliveryType,
  type WebhookEnvelope,
  type WebhookFormData,
  type WebhookSource,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { sql } from 'drizzle-orm';

/** A stored answer as a payload carries it, or undefined when it is not one a receiver may get (a file's id). */
export function webhookAnswer(value: unknown): WebhookAnswer | undefined {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value.every((each): each is string => typeof each === 'string') ? [...value] : undefined;
  }
  if (typeof value === 'object' && value !== null && 'number' in value && typeof value.number === 'string') {
    const country = 'country' in value && typeof value.country === 'string' ? value.country : undefined;
    return { number: value.number, ...(country === undefined ? {} : { country }) };
  }
  return undefined;
}

/** Answers by key, each kept only when it is one a payload may carry. */
function answersOf(entries: Iterable<readonly [string, unknown]>): Record<string, WebhookAnswer> {
  const kept: Record<string, WebhookAnswer> = {};
  for (const [key, value] of entries) {
    const answer = webhookAnswer(value);
    if (answer !== undefined && key !== '') kept[key] = answer;
  }
  return kept;
}

/** A booking's answers: the page's questions by key, then the phone, note and guests the form asks for itself. */
function bookingAnswers(stored: unknown): Record<string, WebhookAnswer> {
  if (typeof stored !== 'object' || stored === null) return {};
  const record = stored as Readonly<Record<string, unknown>>;
  const questions = Array.isArray(record.questions) ? record.questions : [];
  const asked = questions.flatMap((question: unknown): (readonly [string, unknown])[] =>
    typeof question === 'object' && question !== null && 'key' in question && typeof question.key === 'string'
      ? [[question.key, 'value' in question ? question.value : undefined] as const]
      : [],
  );
  return answersOf([...asked, ['phone', record.phone], ['note', record.note], ['guests', record.guests]]);
}

interface BookingRow extends Record<string, unknown> {
  readonly id: string;
  readonly page_id: string;
  readonly page_title: string;
  readonly location: unknown;
  readonly host_name: string | null;
  readonly host_email: string | null;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly visitor_time_zone: string;
  readonly status: string;
  readonly no_show: boolean;
  readonly visitor_name: string;
  readonly visitor_email: string;
  readonly answers: unknown;
}

/** A booking event's data, read now in the write's transaction, or undefined when the booking isn't there. */
export async function bookingWebhookData(tx: WorkspaceTx, bookingId: string): Promise<WebhookBookingData | undefined> {
  const found = await tx.execute<BookingRow>(sql`
    select b.id, b.page_id, p.title as page_title, p.location, m.name as host_name, m.email as host_email,
      to_char(b.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as starts_at,
      to_char(b.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ends_at,
      b.visitor_time_zone, b.status, b.no_show_at is not null as no_show, b.visitor_name, b.visitor_email, b.answers
    from bookings b
    join booking_pages p on p.workspace_id = b.workspace_id and p.id = b.page_id
    left join members m on m.workspace_id = b.workspace_id and m.id = b.host_member_id
    where b.id = ${bookingId}::uuid
  `);
  const row = found.rows[0];
  if (row === undefined) return undefined;
  const location =
    typeof row.location === 'object' && row.location !== null && 'type' in row.location
      ? String(row.location.type)
      : 'none';
  return {
    booking_id: row.id,
    page: { id: row.page_id, title: row.page_title },
    host: { name: row.host_name ?? '', email: row.host_email ?? '' },
    start: row.starts_at,
    end: row.ends_at,
    time_zone: row.visitor_time_zone,
    location_kind: location,
    status: row.status === 'cancelled' ? 'cancelled' : row.no_show ? 'no_show' : 'confirmed',
    invitee: { name: row.visitor_name, email: row.visitor_email },
    answers: bookingAnswers(row.answers),
  };
}

/** The source fields a payload carries from a submission's stored context. */
const SOURCE_KEYS = ['page_url', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

/** A submission's source, from its stored context. */
function sourceOf(context: unknown): WebhookSource {
  if (typeof context !== 'object' || context === null) return {};
  const record = context as Readonly<Record<string, unknown>>;
  return Object.fromEntries(
    SOURCE_KEYS.flatMap((key) => (typeof record[key] === 'string' ? [[key, record[key]]] : [])),
  );
}

interface SubmissionRow extends Record<string, unknown> {
  readonly id: string;
  readonly form_id: string;
  readonly form_name: string;
  readonly answers: unknown;
  readonly context: unknown;
}

/** A form submission's data, read now in the write's transaction, or undefined when it isn't there. */
export async function formWebhookData(tx: WorkspaceTx, submissionId: string): Promise<WebhookFormData | undefined> {
  const found = await tx.execute<SubmissionRow>(sql`
    select s.id, s.form_id, f.name as form_name, s.answers, s.context
    from form_submissions s
    join forms f on f.workspace_id = s.workspace_id and f.id = s.form_id
    where s.id = ${submissionId}::uuid
  `);
  const row = found.rows[0];
  if (row === undefined) return undefined;
  const answers =
    typeof row.answers === 'object' && row.answers !== null && !Array.isArray(row.answers)
      ? answersOf(Object.entries(row.answers))
      : {};
  return {
    submission_id: row.id,
    form: { id: row.form_id, name: row.form_name },
    answers,
    source: sourceOf(row.context),
  };
}

/**
 * The link page a submission came from (`link_page.signup`, AC-6426): the handle of a link page in this workspace that
 * carries a block of this form and whose address (`/<handle>`, on any host, so a custom domain counts too) is the
 * referrer the visitor's browser sent. Undefined for any other submission.
 */
export async function signupHandle(
  tx: WorkspaceTx,
  input: { readonly formId: string; readonly referrer: string | undefined },
): Promise<string | undefined> {
  if (input.referrer === undefined || !URL.canParse(input.referrer)) return undefined;
  const path = new URL(input.referrer).pathname.replace(/\/+$/, '').toLowerCase();
  if (!/^\/[^/]+$/.test(path)) return undefined;
  const found = await tx.execute<{ handle: string }>(
    sql`select handle from crm_webhook_form_handles(${input.formId}::uuid)`,
  );
  return found.rows.find((row) => `/${row.handle.toLowerCase()}` === path)?.handle;
}

/** The first answer that reads as an email address, for a signup. */
export function emailAnswer(answers: Readonly<Record<string, WebhookAnswer>>): string | undefined {
  const preferred = answers.email;
  if (typeof preferred === 'string' && preferred.includes('@')) return preferred;
  return Object.values(answers).find(
    (value): value is string => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  );
}

/** A body's size in bytes, as sent. */
const sizeOf = (envelope: WebhookEnvelope) => Buffer.byteLength(JSON.stringify(envelope), 'utf8');

/** The longest an answer stays when a body is over its cap. */
const SHORT_ANSWER = 500;

/** Cuts each text answer of a data object that has `answers` to `max` characters. */
function cutAnswers(data: unknown, max: number | undefined): unknown {
  if (typeof data !== 'object' || data === null || !('answers' in data)) return data;
  const answers = (data as { readonly answers: Readonly<Record<string, WebhookAnswer>> }).answers;
  return {
    ...data,
    answers:
      max === undefined
        ? {}
        : Object.fromEntries(
            Object.entries(answers).map(([key, value]) => [
              key,
              typeof value === 'string' ? value.slice(0, max) : value,
            ]),
          ),
  };
}

/**
 * The body of one event (AC-6421), kept to 64 KB (AC-6426): as it is when it fits, else with every text answer cut
 * to 500 characters, else with no answers. Undefined when even that doesn't fit, which no event of ours reaches.
 */
export function webhookEnvelope(input: {
  readonly eventId: string;
  readonly type: WebhookDeliveryType;
  readonly createdAt: string;
  readonly workspaceId: string;
  readonly data: unknown;
}): WebhookEnvelope | undefined {
  const base = { id: input.eventId, type: input.type, created_at: input.createdAt, workspace_id: input.workspaceId };
  for (const max of [Infinity, SHORT_ANSWER, undefined]) {
    const envelope = { ...base, data: max === Infinity ? input.data : cutAnswers(input.data, max) };
    if (sizeOf(envelope) <= WEBHOOK_BODY_MAX_BYTES) return envelope;
  }
  return undefined;
}
