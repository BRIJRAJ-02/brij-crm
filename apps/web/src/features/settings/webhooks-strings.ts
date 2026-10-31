// Settings › Webhooks (spec 0064): every word the screen shows. Short on purpose (spec 0058, AC-3).
import type { WebhookDeliveryState, WebhookDeliveryType, WebhookEventType } from '@crm/data';

/** Each event as the chips and the log name it. */
const EVENTS: Readonly<Record<WebhookDeliveryType, string>> = {
  'booking.created': 'Booking made',
  'booking.rescheduled': 'Booking moved',
  'booking.cancelled': 'Booking cancelled',
  'booking.no_show': 'No show',
  'form.submitted': 'Form submitted',
  'link_page.signup': 'Link page signup',
  ping: 'Test event',
};

/** Each delivery state as the log names it. */
const STATES: Readonly<Record<WebhookDeliveryState, string>> = {
  pending: 'Waiting',
  sent: 'Delivered',
  failed: 'Failed',
  gave_up: 'Gave up',
};

export const strings = {
  title: 'Webhooks',
  navLabel: 'Webhooks',
  description: 'Send bookings, form submissions and signups to other apps as they happen.',
  endpoints: 'Endpoints',
  add: 'Add endpoint',
  atLimit: 'You have 10 endpoints, the most a workspace can have.',
  emptyTitle: 'No endpoints yet',
  emptyText: 'Add one to send events to Zapier, Make, n8n or your own server.',
  unavailableTitle: 'Webhooks aren’t set up here yet',
  unavailableText: 'Check back soon.',
  failedTitle: 'Webhooks didn’t load',
  failedText: 'Try again in a moment.',
  columnEndpoint: 'Endpoint',
  columnEvents: 'Events',
  columnStatus: 'Status',
  columnLast: 'Last delivery',
  active: 'Active',
  off: 'Off',
  failing: 'Off, failing',
  failingHelp: 'Turned off after 3 days of failed deliveries. Fix the server, then turn it back on.',
  never: 'None yet',
  event: (type: WebhookDeliveryType | WebhookEventType) => EVENTS[type],
  state: (state: WebhookDeliveryState) => STATES[state],
  // Add endpoint
  addTitle: 'Add endpoint',
  url: 'Endpoint URL',
  urlPlaceholder: 'https://example.com/webhooks',
  descriptionLabel: 'Name',
  descriptionPlaceholder: 'Zapier',
  urlHint: 'Starts with https://',
  events: 'Events',
  cancel: 'Cancel',
  adding: 'Adding…',
  // The secret, shown once
  secretTitle: 'Copy your signing secret',
  secretText: 'Copy it now, you won’t see it again. Your developer uses it to check events came from Timefix.',
  copySecret: 'Copy secret',
  done: 'Done',
  // One endpoint
  endpointTitle: 'Endpoint',
  on: 'Send events',
  secret: 'Signing secret',
  secretHint: (hint: string) => `Ends in ${hint}`,
  overlap: 'The old secret works until',
  rotate: 'Rotate',
  rotateTitle: 'Rotate the signing secret?',
  rotateText: 'The old secret keeps working for 24 hours.',
  rotateAction: 'Rotate secret',
  rotating: 'Rotating…',
  test: 'Send test event',
  testing: 'Sending…',
  testResult: (delivery: { readonly state: WebhookDeliveryState; readonly responseStatus?: number }) =>
    delivery.state === 'sent'
      ? 'Delivered'
      : delivery.state === 'pending'
        ? 'Waiting'
        : `Failed${delivery.responseStatus === undefined ? '' : `, ${String(delivery.responseStatus)}`}`,
  failure: {
    address: 'That address isn’t allowed.',
    timeout: 'No answer within 10 seconds.',
    network: 'Couldn’t connect.',
    redirect: 'Redirects aren’t followed.',
    status: 'The server refused it.',
    too_large: 'Too large to send.',
  } as const,
  log: 'Deliveries',
  logEmpty: 'Nothing sent yet',
  logFailedTitle: 'Deliveries didn’t load',
  logEmptyText: 'Events show here as they’re sent. The log keeps 30 days.',
  columnEvent: 'Event',
  columnAnswer: 'Response',
  columnStatusCode: 'Code',
  columnTime: 'Took',
  columnAttempt: 'Attempt',
  columnWhen: 'When',
  ms: (ms: number) => `${String(ms)} ms`,
  resend: 'Resend',
  resent: 'Sent again',
  resendFailed: 'Sent again, but it failed.',
  more: 'Show more',
  delete: 'Delete endpoint',
  deleteTitle: 'Delete this endpoint?',
  deleteText: 'It stops getting events, and its log goes with it.',
  deleteAction: 'Delete endpoint',
  deleting: 'Deleting…',
  deleted: 'Endpoint deleted',
  close: 'Close',
  saveFailed: 'That didn’t save. Try again.',
} as const;
