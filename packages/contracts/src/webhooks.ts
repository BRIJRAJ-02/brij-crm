// Outgoing webhooks (spec 0064, slice 3, AC-6419 to AC-6426): Settings › Webhooks lists a workspace's endpoints,
// each with the events it gets, a signing secret shown once, and a delivery log. Everything here needs
// `webhooks.manage` (owners and admins). A delivery is a signed POST whose body is `WebhookEnvelope`; what `data`
// holds for each event type is one strict schema below, so a payload can carry nothing outside its list.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** The events an endpoint can subscribe to (AC-6419), in the order the screen shows them. */
export const WEBHOOK_EVENT_TYPES = [
  'booking.created',
  'booking.rescheduled',
  'booking.cancelled',
  'booking.no_show',
  'form.submitted',
  'link_page.signup',
] as const;
/** One event an endpoint can subscribe to. */
export const WebhookEventType = z.enum(WEBHOOK_EVENT_TYPES);
/** One event an endpoint can subscribe to. */
export type WebhookEventType = z.infer<typeof WebhookEventType>;

/** What a delivery can carry: a subscribed event, or the `ping` Send test event sends (AC-6425). */
export const WebhookDeliveryType = z.enum([...WEBHOOK_EVENT_TYPES, 'ping']);
/** What a delivery can carry. */
export type WebhookDeliveryType = z.infer<typeof WebhookDeliveryType>;

/** The most endpoints one workspace may have (AC-6419). */
export const WEBHOOK_ENDPOINTS_MAX = 10;
/** The longest description (the data model). */
export const WEBHOOK_DESCRIPTION_MAX = 120;
/** The longest endpoint address. */
export const WEBHOOK_URL_MAX = 2_048;
/** The largest body a delivery sends (AC-6426). */
export const WEBHOOK_BODY_MAX_BYTES = 64 * 1024;
/** How much of a receiver's answer the log keeps (AC-6425). */
export const WEBHOOK_EXCERPT_MAX = 1_024;
/** How many days the delivery log keeps (AC-6425). */
export const WEBHOOK_LOG_DAYS = 30;
/** How long the old secret keeps signing after a rotation (AC-6420). */
export const WEBHOOK_ROTATION_OVERLAP_HOURS = 24;
/** The most test events and resends per endpoint per minute (the API table). */
export const WEBHOOK_SENDS_PER_MINUTE = 10;
/** How many deliveries one page of the log holds. */
export const WEBHOOK_DELIVERIES_PAGE = 25;

/**
 * An endpoint's address as typed: an https address of at most 2,048 characters. Whether it may be used (port 443,
 * a host name rather than an address, never a private one) is the server's call, which answers CONFIG_INVALID with
 * one line saying why.
 */
export const WebhookUrl = z
  .string()
  .trim()
  .min(1, 'Enter the address to send events to.')
  .max(WEBHOOK_URL_MAX, 'Keep the address to 2,048 characters.')
  .refine((value) => URL.canParse(value) && new URL(value).protocol === 'https:', {
    error: 'Use an https address.',
  });
/** An endpoint's address as typed. */
export type WebhookUrl = z.infer<typeof WebhookUrl>;

/** The events an endpoint gets: at least one, each once. */
export const WebhookEvents = z
  .array(WebhookEventType)
  .min(1, 'Pick at least one event.')
  .max(WEBHOOK_EVENT_TYPES.length)
  .refine((events) => new Set(events).size === events.length, { error: 'Pick each event once.' });
/** The events an endpoint gets. */
export type WebhookEvents = z.infer<typeof WebhookEvents>;

/** A short note on what the endpoint is for. */
export const WebhookDescription = z
  .string()
  .trim()
  .max(WEBHOOK_DESCRIPTION_MAX, 'Keep the description to 120 characters.');

/** Where a delivery is: waiting, delivered, failed (another try is due, or none for a test), or given up. */
export const WebhookDeliveryState = z.enum(['pending', 'sent', 'failed', 'gave_up']);
/** Where a delivery is. */
export type WebhookDeliveryState = z.infer<typeof WebhookDeliveryState>;

/** Why an endpoint is off: turned off by someone, or by every delivery failing for 3 days (AC-6423). */
export const WebhookOffReason = z.enum(['turned_off', 'failing']);
/** Why an endpoint is off. */
export type WebhookOffReason = z.infer<typeof WebhookOffReason>;

/** The newest delivery to an endpoint, as its row shows it. */
export const WebhookLastDelivery = z.strictObject({
  state: WebhookDeliveryState,
  responseStatus: z.number().int().optional(),
  at: z.iso.datetime(),
});
/** The newest delivery to an endpoint. */
export type WebhookLastDelivery = z.infer<typeof WebhookLastDelivery>;

/** One endpoint as the screen shows it. The secret itself is never here, only its last 4 characters (AC-6420). */
export const WebhookEndpoint = z.strictObject({
  id: Uuid,
  url: z.string(),
  description: z.string(),
  events: z.array(WebhookEventType),
  status: z.enum(['active', 'off']),
  offReason: WebhookOffReason.optional(),
  /** The secret's last 4 characters. */
  secretHint: z.string(),
  /** While the old secret still signs beside the new one, until when (AC-6420). */
  previousSecretUntil: z.iso.datetime().optional(),
  lastDelivery: WebhookLastDelivery.optional(),
  createdAt: z.iso.datetime(),
});
/** One endpoint. */
export type WebhookEndpoint = z.infer<typeof WebhookEndpoint>;

/** The workspace's endpoints, newest first; `available` is false where this server has no `WEBHOOK_SECRET_KEY`. */
export const WebhookList = z.strictObject({
  available: z.boolean(),
  endpoints: z.array(WebhookEndpoint),
});
/** The workspace's endpoints. */
export type WebhookList = z.infer<typeof WebhookList>;

/** An endpoint with its whole secret: answered by create and rotate only, and shown once. */
export const WebhookWithSecret = z.strictObject({
  endpoint: WebhookEndpoint,
  secret: z.string(),
});
/** An endpoint with its whole secret. */
export type WebhookWithSecret = z.infer<typeof WebhookWithSecret>;

/** One delivery in the log (AC-6425): its event, what the receiver answered, how long it took, which try. */
export const WebhookDelivery = z.strictObject({
  id: Uuid,
  eventId: Uuid,
  eventType: WebhookDeliveryType,
  attempt: z.number().int().min(1),
  state: WebhookDeliveryState,
  responseStatus: z.number().int().optional(),
  responseMs: z.number().int().min(0).optional(),
  /** The first 1 KB of what the receiver answered, as text. */
  responseExcerpt: z.string().optional(),
  /** Why nothing came back: the address was refused, it timed out, the network failed, or it redirected. */
  failure: z.enum(['address', 'timeout', 'network', 'redirect', 'status', 'too_large']).optional(),
  nextAttemptAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
  sentAt: z.iso.datetime().optional(),
});
/** One delivery in the log. */
export type WebhookDelivery = z.infer<typeof WebhookDelivery>;

/** A page of an endpoint's log, newest first, and where the next starts while there are more. */
export const WebhookDeliveryPage = z.strictObject({
  deliveries: z.array(WebhookDelivery),
  nextCursor: z.string().optional(),
});
/** A page of an endpoint's log. */
export type WebhookDeliveryPage = z.infer<typeof WebhookDeliveryPage>;

/** Lists the workspace's endpoints. */
export const WebhookListInput = WorkspaceScoped.strict();
/** Lists the workspace's endpoints. */
export type WebhookListInput = z.infer<typeof WebhookListInput>;

/** Adds an endpoint (AC-6419): an https address, a short description and at least one event. */
export const WebhookCreateInput = WorkspaceScoped.extend({
  url: WebhookUrl,
  description: WebhookDescription.default(''),
  events: WebhookEvents,
  mutationId: Uuid,
}).strict();
/** Adds an endpoint. */
export type WebhookCreateInput = z.input<typeof WebhookCreateInput>;

/** Changes an endpoint: only the fields named. `status: 'active'` turns an endpoint that was turned off back on. */
export const WebhookUpdateInput = WorkspaceScoped.extend({
  endpointId: Uuid,
  url: WebhookUrl.optional(),
  description: WebhookDescription.optional(),
  events: WebhookEvents.optional(),
  status: z.enum(['active', 'off']).optional(),
  mutationId: Uuid,
}).strict();
/** Changes an endpoint. */
export type WebhookUpdateInput = z.input<typeof WebhookUpdateInput>;

/** One endpoint, for rotate, delete and Send test event. */
export const WebhookEndpointInput = WorkspaceScoped.extend({ endpointId: Uuid, mutationId: Uuid }).strict();
/** One endpoint. */
export type WebhookEndpointInput = z.infer<typeof WebhookEndpointInput>;

/** A page of an endpoint's log. */
export const WebhookDeliveriesInput = WorkspaceScoped.extend({
  endpointId: Uuid,
  cursor: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(100).default(WEBHOOK_DELIVERIES_PAGE),
}).strict();
/** A page of an endpoint's log. */
export type WebhookDeliveriesInput = z.input<typeof WebhookDeliveriesInput>;

/** Sends one delivery again, now. */
export const WebhookResendInput = WorkspaceScoped.extend({ deliveryId: Uuid, mutationId: Uuid }).strict();
/** Sends one delivery again. */
export type WebhookResendInput = z.infer<typeof WebhookResendInput>;

/** An answer a payload carries: text, a number, yes or no, a list of choices, or a phone. Never a file's id. */
export const WebhookAnswer = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.strictObject({ number: z.string(), country: z.string().optional() }),
]);
/** An answer a payload carries. */
export type WebhookAnswer = z.infer<typeof WebhookAnswer>;

/** Answers by question key. */
const Answers = z.record(z.string(), WebhookAnswer);

/** A booking event's data (AC-6426): the booking, its page and host, the times in UTC with the zone, and the invitee. */
export const WebhookBookingData = z.strictObject({
  booking_id: Uuid,
  page: z.strictObject({ id: Uuid, title: z.string() }),
  host: z.strictObject({ name: z.string(), email: z.string() }),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  time_zone: z.string(),
  location_kind: z.string(),
  status: z.enum(['confirmed', 'cancelled', 'no_show']),
  invitee: z.strictObject({ name: z.string(), email: z.string() }),
  answers: Answers,
});
/** A booking event's data. */
export type WebhookBookingData = z.infer<typeof WebhookBookingData>;

/** Where a form submission came from: the UTM tags and the referrer, as the visitor's browser gave them. */
export const WebhookSource = z.strictObject({
  page_url: z.string().optional(),
  referrer: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_term: z.string().optional(),
  utm_content: z.string().optional(),
});
/** Where a form submission came from. */
export type WebhookSource = z.infer<typeof WebhookSource>;

/** A form submission's data (AC-6426): the submission, its form, the answers by question key and the source. */
export const WebhookFormData = z.strictObject({
  submission_id: Uuid,
  form: z.strictObject({ id: Uuid, name: z.string() }),
  answers: Answers,
  source: WebhookSource,
});
/** A form submission's data. */
export type WebhookFormData = z.infer<typeof WebhookFormData>;

/** A link page signup's data (AC-6426): the email and the link page's handle, nothing more. */
export const WebhookSignupData = z.strictObject({
  email: z.string(),
  handle: z.string(),
});
/** A link page signup's data. */
export type WebhookSignupData = z.infer<typeof WebhookSignupData>;

/** A test event's data: nothing but that it is one. */
export const WebhookPingData = z.strictObject({ message: z.string() });
/** A test event's data. */
export type WebhookPingData = z.infer<typeof WebhookPingData>;

/** Each delivery type's data schema. */
export const WEBHOOK_DATA = {
  'booking.created': WebhookBookingData,
  'booking.rescheduled': WebhookBookingData,
  'booking.cancelled': WebhookBookingData,
  'booking.no_show': WebhookBookingData,
  'form.submitted': WebhookFormData,
  'link_page.signup': WebhookSignupData,
  ping: WebhookPingData,
} as const satisfies Readonly<Record<WebhookDeliveryType, z.ZodType>>;

/** The data an event type carries. */
export type WebhookData<T extends WebhookDeliveryType> = z.infer<(typeof WEBHOOK_DATA)[T]>;

/**
 * Every delivery's body (AC-6421): the event's id (a UUID v7, the same on every try, so a receiver drops
 * duplicates), its type, when it happened, the workspace, and the type's data.
 */
export const WebhookEnvelope = z.strictObject({
  id: Uuid,
  type: WebhookDeliveryType,
  created_at: z.iso.datetime(),
  workspace_id: Uuid,
  data: z.unknown(),
});
/** Every delivery's body. */
export type WebhookEnvelope = z.infer<typeof WebhookEnvelope>;

/** Whether `envelope`'s data is exactly its type's schema: nothing outside the list (AC-6426). */
export function isWebhookEnvelope(envelope: unknown): envelope is WebhookEnvelope {
  const parsed = WebhookEnvelope.safeParse(envelope);
  return parsed.success && WEBHOOK_DATA[parsed.data.type].safeParse(parsed.data.data).success;
}

/**
 * Settings › Webhooks (spec 0064, AC-6419 to AC-6425), every procedure behind `webhooks.manage`. `create` and
 * `rotateSecret` answer the whole secret, once; nothing else ever does. A refused address is CONFIG_INVALID on
 * `url`; an eleventh endpoint is CONFIG_INVALID; test and resend past 10 a minute an endpoint are RATE_LIMITED.
 */
export const webhooksContract = {
  list: oc.input(WebhookListInput).output(WebhookList),
  create: oc.input(WebhookCreateInput).output(WebhookWithSecret),
  update: oc.input(WebhookUpdateInput).output(WebhookEndpoint),
  rotateSecret: oc.input(WebhookEndpointInput).output(WebhookWithSecret),
  delete: oc.input(WebhookEndpointInput).output(z.strictObject({ deleted: z.boolean() })),
  test: oc.input(WebhookEndpointInput).output(WebhookDelivery),
  deliveries: oc.input(WebhookDeliveriesInput).output(WebhookDeliveryPage),
  resend: oc.input(WebhookResendInput).output(WebhookDelivery),
};
