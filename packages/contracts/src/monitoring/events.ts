// The product event catalog (spec 0010, AC-173): every event the CRM may send
// to PostHog, one strict Zod schema each. The PostHog wrapper takes only a
// `ProductEvent` and parses it before sending, so a property outside the
// catalog fails the type check and the parse. Ids and closed lists only: no
// email, name, value or free text can fit any of them (AC-165). A new event is
// a new schema here, reviewed like a contract change.
//
// Server only (`@crm/contracts/events`): it hashes with `node:crypto`, and the
// browser never contacts PostHog (AC-167), so it stays out of the main index.
import { createHash } from 'node:crypto';
import * as z from 'zod';
import { Uuid } from '../values/ids.ts';

/** A milestone a workspace reaches once, stored in `workspace_milestones` (AC-177). */
export const Milestone = z.enum(['workspace_created', 'first_record_created']);
/** A milestone a workspace reaches once. */
export type Milestone = z.infer<typeof Milestone>;

/** What kind of object a first record was made in: a standard object by its key, else `custom`. */
export const ObjectKind = z.enum(['people', 'companies', 'deals', 'custom']);
/** What kind of object a first record was made in. */
export type ObjectKind = z.infer<typeof ObjectKind>;

/** How a new account was made: an email code, or Google. */
export const SignUpMethod = z.enum(['email_code', 'google']);
/** How a new account was made. */
export type SignUpMethod = z.infer<typeof SignUpMethod>;

// Who the event is about: the user's id (`auth.user.id`, a uuid), never an email (AC-165).
const distinctId = Uuid;

/** A new account, sent once after Better Auth wrote it (AC-174). */
export const UserSignedUp = z.strictObject({
  event: z.literal('user_signed_up'),
  distinctId,
  properties: z.strictObject({ method: SignUpMethod }),
});
/** A new account. */
export type UserSignedUp = z.infer<typeof UserSignedUp>;

// What every milestone event carries beyond its properties: the fixed id `milestoneEventId` derives (so PostHog
// deduplicates a resend) and when the milestone row says it was reached (ISO 8601 UTC).
const milestone = { distinctId, id: Uuid, at: z.iso.datetime() };

/** A workspace made, sent once after its transaction commits (AC-175). */
export const WorkspaceCreated = z.strictObject({
  event: z.literal('workspace_created'),
  ...milestone,
  properties: z.strictObject({ workspace_id: Uuid }),
});
/** A workspace made. */
export type WorkspaceCreated = z.infer<typeof WorkspaceCreated>;

/** A workspace's first record made by a member, sent once after it commits (AC-176). */
export const FirstRecordCreated = z.strictObject({
  event: z.literal('first_record_created'),
  ...milestone,
  properties: z.strictObject({ workspace_id: Uuid, object_kind: ObjectKind }),
});
/** A workspace's first record made by a member. */
export type FirstRecordCreated = z.infer<typeof FirstRecordCreated>;

/** Every product event the CRM sends: the closed catalog (AC-173). */
export const ProductEvent = z.discriminatedUnion('event', [UserSignedUp, WorkspaceCreated, FirstRecordCreated]);
/** Every product event the CRM sends. */
export type ProductEvent = z.infer<typeof ProductEvent>;

/** The catalog's event names, for the wrapper's last check before anything leaves. */
export const PRODUCT_EVENT_NAMES: ReadonlySet<string> = new Set(
  ProductEvent.options.map((option) => option.shape.event.value),
);

// The fixed namespace milestone event ids are derived in. Never change it: a changed one would make every
// milestone's resend look new to PostHog.
const MILESTONE_NAMESPACE = '1ef35e3c-cdf3-4e47-b3e7-ab308901e0e6';

/**
 * A milestone event's fixed id (AC-177): the UUID v5 of the workspace id and
 * the milestone in a fixed namespace, so the same milestone always gets the
 * same id and PostHog keeps one event however often it is sent.
 */
export function milestoneEventId(workspaceId: string, milestone: Milestone): string {
  return uuidV5(MILESTONE_NAMESPACE, `${workspaceId.toLowerCase()}:${milestone}`);
}

/** The UUID v5 (RFC 9562, SHA-1) of `name` in `namespace`: the same inputs always give the same id. */
export function uuidV5(namespace: string, name: string): string {
  const hash = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8')
    .digest();
  const bytes = hash.subarray(0, 16);
  // Version 5 in the high nibble of byte 6, the RFC variant in the top bits of byte 8.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
