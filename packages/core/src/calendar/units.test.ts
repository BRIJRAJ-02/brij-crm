// Calendar sync's pure parts (spec 0024): the token seal (adapted from an
// earlier scheduling build's suite: every way it can be wrong is silent, so
// the adversarial cases are the point), the signed state, the provider's
// errors, and which events sync and how their attendees match.
import { describe, expect, it } from 'vitest';
import { outboxEvents } from '../engine/outbox.ts';
import { capChange, type Change } from '../engine/write.ts';
import { domainOf, lookupKeys, matchEvent, shouldSync, type Lookups } from './match.ts';
import { isPersistentCode, isProviderError, providerError, type ProviderEvent } from './provider.ts';
import { deriveKey, signValue, verifyValue } from './signing.ts';
import { retryDelay, syncWindow } from './sync.ts';
import { decodeTokenKey, openTokens, sealTokens, type TokenBinding } from './tokens.ts';

const KEY_A = decodeTokenKey(Buffer.alloc(32, 1).toString('base64'));
const KEY_B = decodeTokenKey(Buffer.alloc(32, 2).toString('base64'));
/** A Google refresh token's shape: long, with `/`, `-` and `_`. */
const TOKENS = {
  accessToken: `ya29.a0AfB_byC${'x'.repeat(200)}`,
  refreshToken: '1//09xYzAbCdEf-GhIjKlMnOpQrStUvWxYz_0123456789abcdefGHIJKLMNOP',
  expiresAt: '2026-10-19T10:00:00.000Z',
};
const BINDING: TokenBinding = {
  workspaceId: '01890a5d-ac96-774b-bcce-b302099a8057',
  memberId: '01890a5d-ac96-774b-bcce-b302099a8058',
  provider: 'google',
  accountEmail: 'ada@example.com',
};

describe('the token seal (AC-600)', () => {
  it('opens to exactly the tokens, with none of them readable in the sealed bytes', () => {
    const sealed = sealTokens(KEY_A, TOKENS, BINDING);
    expect(sealed.toString('latin1')).not.toContain('09xYzAbCdEf');
    expect(sealed[0]).toBe(1);
    expect(openTokens(KEY_A, sealed, BINDING)).toEqual(TOKENS);
  });

  it('uses a fresh IV every time: 100 seals, 100 IVs', () => {
    const ivs = new Set(
      Array.from({ length: 100 }, () => sealTokens(KEY_A, TOKENS, BINDING).subarray(1, 13).toString('hex')),
    );
    expect(ivs.size).toBe(100);
  });

  it('refuses a flipped byte anywhere, the wrong key, and another connection’s binding', () => {
    const sealed = sealTokens(KEY_A, TOKENS, BINDING);
    for (const at of [1, 13, 29, sealed.length - 1]) {
      const tampered = Buffer.from(sealed);
      tampered[at] = (tampered[at] ?? 0) ^ 0xff;
      expect(() => openTokens(KEY_A, tampered, BINDING), String(at)).toThrow(/did not open/);
    }
    expect(() => openTokens(KEY_B, sealed, BINDING)).toThrow(/did not open/);
    expect(() => openTokens(KEY_A, sealed, { ...BINDING, accountEmail: 'bea@example.com' })).toThrow(/did not open/);
    expect(() => openTokens(KEY_A, sealed, { ...BINDING, workspaceId: BINDING.memberId })).toThrow(/did not open/);
  });

  it('refuses another version and a value too short to be one, never handing back plaintext', () => {
    const sealed = sealTokens(KEY_A, TOKENS, BINDING);
    const other = Buffer.from(sealed);
    other[0] = 2;
    expect(() => openTokens(KEY_A, other, BINDING)).toThrow(/not in a form/);
    expect(() => openTokens(KEY_A, Buffer.from(JSON.stringify(TOKENS)), BINDING)).toThrow();
    expect(() => openTokens(KEY_A, Buffer.alloc(10), BINDING)).toThrow(/not in a form/);
  });

  it('takes a key of exactly 32 bytes, base64 or hex, and refuses any other length rather than pad it', () => {
    expect(decodeTokenKey('ab'.repeat(32))).toHaveLength(32);
    expect(decodeTokenKey(` ${Buffer.alloc(32, 7).toString('base64')}\n`)).toHaveLength(32);
    expect(() => decodeTokenKey(Buffer.alloc(16, 1).toString('base64'))).toThrow(/32 bytes/);
    expect(() => decodeTokenKey(Buffer.alloc(48, 1).toString('base64'))).toThrow(/32 bytes/);
    expect(() => decodeTokenKey('hunter2')).toThrow(/openssl rand/);
  });
});

describe('signed values (the OAuth state)', () => {
  const secret = deriveKey(KEY_A, 'calendar-oauth-state');
  const now = new Date('2026-10-19T09:00:00.000Z');

  it('reads back what it signed until it expires', () => {
    const value = signValue(secret, 'cs1', { w: 'acme', m: 'member', n: 'nonce' }, 600, now);
    expect(verifyValue(secret, 'cs1', value, now)).toMatchObject({ w: 'acme', m: 'member', n: 'nonce' });
    expect(verifyValue(secret, 'cs1', value, new Date(now.getTime() + 599_000))).toBeDefined();
    expect(verifyValue(secret, 'cs1', value, new Date(now.getTime() + 600_000))).toBeUndefined();
  });

  it('refuses another version, another secret, a changed payload and anything malformed', () => {
    const value = signValue(secret, 'cs1', { w: 'acme' }, 600, now);
    expect(verifyValue(secret, 'cs2', value, now)).toBeUndefined();
    expect(verifyValue(deriveKey(KEY_B, 'calendar-oauth-state'), 'cs1', value, now)).toBeUndefined();
    expect(verifyValue(deriveKey(KEY_A, 'another-purpose'), 'cs1', value, now)).toBeUndefined();
    const [version, , mac] = value.split('.');
    const forged = Buffer.from(JSON.stringify({ w: 'evil', e: 9_999_999_999 })).toString('base64url');
    expect(verifyValue(secret, 'cs1', `${version ?? ''}.${forged}.${mac ?? ''}`, now)).toBeUndefined();
    for (const bad of [undefined, '', 'cs1', 'cs1.a', 'cs1.a.b.c', 'x'.repeat(5000)]) {
      expect(verifyValue(secret, 'cs1', bad, now)).toBeUndefined();
    }
  });
});

describe('provider errors', () => {
  it('carry a stable code, and only a refused grant or call persists', () => {
    const error = providerError('CALENDAR_AUTH_REVOKED', 'Revoked.');
    expect(isProviderError(error)).toBe(true);
    expect(isProviderError(error, 'CALENDAR_AUTH_REVOKED')).toBe(true);
    expect(isProviderError(error, 'CALENDAR_UNAVAILABLE')).toBe(false);
    expect(isProviderError(new Error('plain'))).toBe(false);
    expect(isPersistentCode('CALENDAR_AUTH_REVOKED')).toBe(true);
    expect(isPersistentCode('CALENDAR_AUTH')).toBe(true);
    // Our own outage (a missing client secret, a 5xx) is never the member's to fix.
    expect(isPersistentCode('CALENDAR_UNAVAILABLE')).toBe(false);
  });

  it('waits at least a minute after a failure, longer while it lasts, never past the poll interval', () => {
    const now = new Date('2026-10-19T09:00:00.000Z');
    expect(retryDelay(now.toISOString(), now)).toBe(60_000);
    expect(retryDelay('2026-10-19T08:55:00.000Z', now)).toBe(300_000);
    expect(retryDelay('2026-10-19T06:00:00.000Z', now)).toBe(900_000);
    expect(syncWindow(now)).toEqual({ from: '2026-07-21T09:00:00.000Z', to: '2027-04-17T09:00:00.000Z' });
  });
});

/** An event with these attendees (the account first), confirmed, on 20 October. */
function event(attendees: ProviderEvent['attendees'], changes: Partial<ProviderEvent> = {}): ProviderEvent {
  return {
    id: 'e1',
    status: 'confirmed',
    icalUid: 'uid-1@google.com',
    title: 'Intro',
    start: { at: '2026-10-20T09:00:00.000Z', allDay: false },
    end: { at: '2026-10-20T09:30:00.000Z', allDay: false },
    attendees,
    isPrivate: false,
    ...changes,
  };
}
const me = { email: 'ada@acme.dev', response: 'accepted', isOrganizer: true, isSelf: true } as const;
const guest = (email: string, response: 'accepted' | 'declined' | 'needs_action' = 'accepted') =>
  ({ email, response, isOrganizer: false, isSelf: false }) as const;

describe('which events sync (AC-605)', () => {
  it('skips a cancelled event, one the account declined, and one with nobody else', () => {
    expect(shouldSync(event([me, guest('bea@globex.com')]))).toBe(true);
    expect(shouldSync(event([me, guest('bea@globex.com')], { status: 'cancelled' }))).toBe(false);
    expect(shouldSync(event([{ ...me, response: 'declined' }, guest('bea@globex.com')]))).toBe(false);
    expect(shouldSync(event([me]))).toBe(false);
    expect(shouldSync(event([]))).toBe(false);
    // An all day event with no attendees is no meeting either; with one, it is.
    const allDay = {
      start: { at: '2026-10-20T00:00:00.000Z', allDay: true },
      end: { at: '2026-10-21T00:00:00.000Z', allDay: true },
    };
    expect(shouldSync(event([], allDay))).toBe(false);
    expect(shouldSync(event([me, guest('bea@globex.com')], allDay))).toBe(true);
    // A guest who declined is still an attendee.
    expect(shouldSync(event([me, guest('bea@globex.com', 'declined')]))).toBe(true);
  });
});

describe('matching attendees (AC-606, AC-607)', () => {
  const lookups = (changes: Partial<Lookups> = {}): Lookups => ({
    members: new Map([['cal@acme.dev', 'member-cal']]),
    people: new Map([
      ['bea@globex.com', ['person-bea']],
      ['twin@globex.com', ['person-1', 'person-2']],
    ]),
    companies: new Map([
      ['globex.com', ['company-globex']],
      ['split.io', ['company-a', 'company-b']],
    ]),
    isFreeDomain: (domain) => domain === 'gmail.com',
    ...changes,
  });

  it('links one person, marks several ambiguous, others unknown, and members as members', () => {
    const matched = matchEvent(
      event([me, guest(' Bea@Globex.com '), guest('twin@globex.com'), guest('new@initech.com'), guest('cal@acme.dev')]),
      'member-ada',
      lookups(),
    );
    expect(matched.attendees.map((each) => [each.email, each.match, each.memberId ?? each.personRecordId])).toEqual([
      ['ada@acme.dev', 'member', 'member-ada'],
      ['bea@globex.com', 'linked', 'person-bea'],
      ['twin@globex.com', 'ambiguous', null],
      ['new@initech.com', 'unknown', null],
      ['cal@acme.dev', 'member', 'member-cal'],
    ]);
    expect(matched.isInternal).toBe(false);
    // The person, and the company of the external domain (once, however many attendees share it).
    expect(matched.links).toEqual([
      { recordId: 'person-bea', via: 'attendee' },
      { recordId: 'company-globex', via: 'domain' },
    ]);
  });

  it('names no company for a free email domain, a domain several companies hold, or a member', () => {
    const matched = matchEvent(event([me, guest('x@gmail.com'), guest('y@split.io')]), 'member-ada', lookups());
    expect(matched.links).toEqual([]);
    const free = lookupKeys(
      [event([me, guest('x@gmail.com'), guest('y@globex.com')])],
      (domain) => domain === 'gmail.com',
    );
    expect(free.domains).toEqual(['acme.dev', 'globex.com']);
  });

  it('keeps an internal meeting off every record (every attendee a member)', () => {
    const matched = matchEvent(event([me, guest('cal@acme.dev')]), 'member-ada', lookups());
    expect(matched).toMatchObject({ isInternal: true, links: [] });
  });

  it('keeps each email once and reads a domain from the last @', () => {
    const matched = matchEvent(event([me, guest('bea@globex.com'), guest('BEA@globex.com')]), 'member-ada', lookups());
    expect(matched.attendees).toHaveLength(2);
    expect(domainOf('a@b@Example.COM')).toBe('example.com');
    expect(domainOf('nobody')).toBeUndefined();
  });
});

describe('the meetings outbox row (AC-610)', () => {
  const change = (meetings: Change['meetings']): Change => ({
    kind: 'write',
    workspaceId: 'w',
    actor: { type: 'system', id: null },
    createdRecords: [],
    deletedRecords: [],
    restoredRecords: [],
    purgedRecords: [],
    createdEntries: [],
    removedEntries: [],
    restoredEntries: [],
    hiddenEntries: [],
    shownEntries: [],
    purgedEntries: [],
    changedEntries: [],
    values: [],
    references: [],
    coarseObjects: [],
    definitions: [],
    members: [],
    jobs: [],
    views: [],
    tasks: [],
    notes: [],
    meetings,
    schedules: [],
    comments: [],
    notifications: [],
  });
  const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

  it('names every meeting and every record before or after, once each', () => {
    const rows = outboxEvents(
      capChange(
        change([
          { meetingId: id(2), recordIds: [id(10), id(11)] },
          { meetingId: id(1), recordIds: [id(11)] },
          { meetingId: id(2), recordIds: [id(12)] },
        ]),
      ),
    );
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'meetings',
        itemIds: [id(1), id(2)],
        recordIds: [id(10), id(11), id(12)],
        coarse: false,
      }),
    ]);
  });

  it('goes coarse, naming nothing, past 1,000 meetings', () => {
    const many = Array.from({ length: 1001 }, (_, n) => ({ meetingId: id(n), recordIds: [] }));
    expect(outboxEvents(capChange(change(many)))).toEqual([
      expect.objectContaining({ kind: 'meetings', itemIds: [], recordIds: [], coarse: true }),
    ]);
    expect(outboxEvents(capChange(change([])))).toEqual([]);
  });
});
