// The person's own security history (spec 0033, AC-897, AC-898): Recent
// activity (the last 90 days, newest first), the new device alert after a
// sign in, and the sweep that deletes what is a year old. All of it lives in
// schema auth, read and written through the identity store by user id; no
// workspace is involved.
import { createHash } from 'node:crypto';
import { ACTIVITY_DAYS, SignInMethod, type ActivityPage, type ListActivityInput } from '@crm/contracts';
import type { IdentityStore } from '@crm/db';
import * as z from 'zod';
import { inputInvalid } from '../engine/refusals.ts';
import { deviceParts } from './device.ts';
import type { SessionCaller } from './sessions.ts';

const DAY = 24 * 60 * 60 * 1000;

/** How many events a page of Recent activity holds. */
export const ACTIVITY_PAGE = 20;

/** A device unseen this long signs in as new (AC-897). */
export const ALERT_AFTER_DAYS = 90;

/** How long security events and known devices are kept (AC-898). */
export const HISTORY_DAYS = 365;

/** What a cursor that isn't one of ours answers. */
export const ACTIVITY_CURSOR_MESSAGE = 'That list position is not valid here. Start again from the top.';

const Cursor = z.strictObject({ a: z.iso.datetime({ offset: true }), i: z.uuid() });

function encode(at: string, id: string): string {
  return Buffer.from(JSON.stringify({ a: at, i: id })).toString('base64url');
}

function decode(cursor: string): { readonly at: string; readonly id: string } {
  try {
    const parsed = Cursor.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (parsed.success) return { at: parsed.data.a, id: parsed.data.i };
  } catch {
    // Falls through to the refusal.
  }
  throw inputInvalid('cursor', ACTIVITY_CURSOR_MESSAGE);
}

/** A text the event kept, when it kept one. */
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** The caller's last 90 days of security events, newest first, a page at a time (AC-898). */
export async function listMyActivity(
  deps: { readonly identity: Pick<IdentityStore, 'listSecurityEvents'>; readonly now?: () => number },
  caller: SessionCaller,
  input: ListActivityInput,
): Promise<ActivityPage> {
  const now = (deps.now ?? Date.now)();
  const before = input.cursor === undefined ? undefined : decode(input.cursor);
  const rows = await deps.identity.listSecurityEvents(caller.userId, {
    since: new Date(now - ACTIVITY_DAYS * DAY),
    ...(before === undefined ? {} : { before }),
    limit: ACTIVITY_PAGE + 1,
  });
  const page = rows.slice(0, ACTIVITY_PAGE);
  const last = page.at(-1);
  return {
    items: page.map((row) => {
      const method = SignInMethod.safeParse(row.detail.method);
      const city = text(row.detail.city);
      return {
        id: row.id,
        at: row.at,
        kind: row.kind,
        ...(method.success ? { method: method.data } : {}),
        ...(row.deviceLabel === null || row.deviceLabel === '' ? {} : { deviceLabel: row.deviceLabel }),
        ...(row.country === null || row.country === '' ? {} : { country: row.country }),
        ...(city === undefined ? {} : { city }),
      };
    }),
    ...(rows.length > ACTIVITY_PAGE && last !== undefined ? { nextCursor: encode(last.at, last.id) } : {}),
  };
}

/** A device as known devices keep it: the SHA-256 of browser family, system and country, never the agent itself. */
export function deviceKey(userAgent: string | null, country: string | null): string {
  const { browser, system } = deviceParts(userAgent);
  return createHash('sha256')
    .update(`${browser}|${system}|${country ?? ''}`, 'utf8')
    .digest('hex');
}

/** What the alert email says: when, on what, roughly where. */
export interface SignInAlert {
  readonly when: Date;
  readonly device: string;
  readonly place?: string;
}

/** What the new device alert needs. */
export interface SignInAlertDeps {
  readonly identity: Pick<IdentityStore, 'sessionFacts' | 'noteDevice' | 'getUser' | 'recordSecurityEvent'>;
  /** Sends the alert to the account's address; the session id is its idempotency key. */
  readonly send: (to: string, alert: SignInAlert, sessionId: string) => Promise<void>;
  readonly now?: () => number;
}

/** The device's name for the email, when the session couldn't tell. */
export const UNKNOWN_DEVICE = 'a device we couldn’t name';

/**
 * After a sign in made its session (AC-897): notes the device, and emails the
 * account when the device (browser family, system, country) is new to it or
 * unseen for 90 days. Never on the account's first sign in, never for a
 * session already gone (a sign in held back for its second step makes its
 * own session when it passes), and once per session. Answers what it did.
 */
export async function alertNewDevice(
  deps: SignInAlertDeps,
  signedIn: { readonly userId: string; readonly sessionId: string },
): Promise<'gone' | 'known' | 'first' | 'sent'> {
  const facts = await deps.identity.sessionFacts(signedIn.userId, signedIn.sessionId);
  if (facts === undefined) return 'gone';
  const now = (deps.now ?? Date.now)();
  const noted = await deps.identity.noteDevice(
    signedIn.userId,
    deviceKey(facts.userAgent, facts.country),
    new Date(now - ALERT_AFTER_DAYS * DAY),
  );
  if (noted.isFirst) return 'first';
  if (!noted.isNew) return 'known';
  const person = await deps.identity.getUser(signedIn.userId);
  if (person === undefined) return 'gone';
  const place = [facts.city, facts.country].filter((part): part is string => part !== null && part !== '').join(', ');
  await deps.send(
    person.email,
    {
      when: facts.createdAt,
      device: facts.deviceLabel === null || facts.deviceLabel === '' ? UNKNOWN_DEVICE : facts.deviceLabel,
      ...(place === '' ? {} : { place }),
    },
    signedIn.sessionId,
  );
  await deps.identity.recordSecurityEvent({
    userId: signedIn.userId,
    kind: 'alert_sent',
    sessionId: signedIn.sessionId,
    ...(facts.country === null ? {} : { country: facts.country }),
    ...(facts.deviceLabel === null ? {} : { deviceLabel: facts.deviceLabel }),
  });
  return 'sent';
}

/** Deletes a batch of year old security events and known devices (AC-898). Answers how many went. */
export function sweepAccountHistory(
  deps: { readonly identity: Pick<IdentityStore, 'sweepAuthHistory'>; readonly now?: () => number },
  limit = 5000,
): Promise<number> {
  const now = (deps.now ?? Date.now)();
  return deps.identity.sweepAuthHistory(new Date(now - HISTORY_DAYS * DAY), limit);
}
