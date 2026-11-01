// What the console keeps about a visit (spec 0047, AC-1626 and AC-1627): a
// daily visitor id, a device class, and whether the visit is a machine's. The
// address and the user agent go into the id's HMAC and are never kept.
import { createHmac } from 'node:crypto';
import { deviceFact } from '@crm/core';

/** The key visitor ids are made with, from a server secret (the forms' address salt), under its own label. */
export function visitorKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('crm-visitor-v1').digest();
}

/**
 * A visitor's id for one UTC day and one place (a site's host, or a booking
 * page): 32 hex digits of an HMAC of the day, the address, the user agent and
 * the place. The same browser tomorrow is someone new, on purpose.
 */
export function visitorId(
  key: Buffer,
  input: { readonly day: string; readonly ip: string | undefined; readonly userAgent: string; readonly place: string },
): string {
  return createHmac('sha256', key)
    .update([input.day, input.ip ?? '', input.userAgent, input.place].join('\n'))
    .digest('hex')
    .slice(0, 32);
}

/** Crawlers, link previews, monitors and scripts, by their user agent. */
const MACHINE =
  /bot|crawl|spider|slurp|headless|lighthouse|preview|curl|wget|python|axios|node-fetch|go-http|java\/|httpclient|monitor|pingdom|uptime|scrapy|facebookexternalhit|embedly|whatsapp|telegram|discord|slack/i;

/** Whether a user agent is a machine's (or absent): such a visit is never counted. */
export function isMachine(userAgent: string | undefined): boolean {
  return userAgent === undefined || userAgent.trim() === '' || MACHINE.test(userAgent);
}

/** A device class from a user agent: a phone, a tablet, or anything else as desktop. */
export function deviceOf(userAgent: string): 'mobile' | 'tablet' | 'desktop' {
  // One rule for site visits and link page views (spec 0061, AC-6116): core's.
  return deviceFact(userAgent);
}

/** Today's UTC day, `YYYY-MM-DD`. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}
