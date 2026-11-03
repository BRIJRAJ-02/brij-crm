// The guest's side of Table seating (spec 0066 B7 lite) against the real Postgres as the app role: the door finds
// a place by its public key only while Table seating takes reservations; a guest reserves, finds the reservation by
// token or by code with email (never by code alone), changes and cancels within the cutoffs; three upcoming per
// email; a ticked marketing box is a consent; and nothing of another guest reaches an answer.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PublicReserveInput } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { enterTablePage } from '../access/table-door.ts';
import { NO_CALENDAR } from '../booking/calendar.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { rollingWeek } from '../../test/dates-kit.ts';
import { addResource, visitWorkspace } from '../../test/visits-kit.ts';
import { guestCancel, guestChange, guestIcs, guestReserve, guestTimes, guestVisit, readTablePage } from './public.ts';
import { getTableSetup, saveTableSetup } from './table-service.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-visits-public-tests' });
});
afterAll(async () => {
  await db.close();
});

const week = rollingWeek();
const DAY = week.monday;
const at = (time: string) => `${DAY}T${time}:00.000Z`;
const NOW = new Date(`${week.sunday}T09:00:00Z`);
const deps = { busy: NO_CALENDAR.busy, now: () => NOW };

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isInputError(error)) return `INPUT:${error.inputProblem.field}`;
    if (isRefusal(error)) return error.refusal.code;
    throw error;
  }
}

async function restaurant(options: { readonly publish?: boolean } = {}) {
  const w = await visitWorkspace(db);
  await addResource(w, 'T1', { min: 1, max: 4 });
  const setup = await getTableSetup(w.owner, { placeId: w.placeId });
  await saveTableSetup(w.owner, {
    placeId: w.placeId,
    rules: { ...setup.rules, noticeMinutes: 0, partyMax: 4, online: options.publish ?? true },
  });
  return { w, key: setup.publicKey };
}

const reserve = (start: string, email = `g-${randomUUID().slice(0, 8)}@example.com`): PublicReserveInput => ({
  idempotencyKey: randomUUID(),
  party: 2,
  start,
  name: 'Grace Hopper',
  email,
  phone: '+44 20 7946 0000',
  marketing: false,
});

describe('the reservation page (AC-6550, AC-6551)', () => {
  it('opens by the place key, says when it isn’t taking reservations, and refuses an unknown key', async () => {
    const off = await restaurant({ publish: false });
    const entry = await enterTablePage({ db }, off.key);
    const page = await readTablePage(entry, { now: () => NOW });
    expect(page).toMatchObject({ taking: false, partyMin: 1, partyMax: 4, today: week.sunday });
    expect(page.business.name).toBe('Somewhere Nowhere');
    expect(await code(guestTimes(entry, deps, { party: 2, date: DAY }))).toBe('BOOKING_CLOSED');
    expect(await code(enterTablePage({ db }, 'AAAAAAAAAAAAAAAA'))).toBe('NOT_FOUND');
    expect(await code(enterTablePage({ db }, 'short'))).toBe('NOT_FOUND');
  });

  it('offers times, reserves, and answers SLOT_TAKEN with the next free times when the table went', async () => {
    const { key } = await restaurant();
    const entry = await enterTablePage({ db }, key);
    expect((await readTablePage(entry, { now: () => NOW })).taking).toBe(true);
    const times = await guestTimes(entry, deps, { party: 2, date: DAY });
    expect(times[0]).toBe(at('18:00'));
    const first = await guestReserve(entry, deps, reserve(at('18:00')));
    expect(first.visit).toMatchObject({ status: 'booked', party: 2, start: at('18:00') });
    expect(first.visit.lookupCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(first.manageToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    let taken: unknown;
    try {
      await guestReserve(entry, deps, reserve(at('18:00')));
    } catch (error) {
      taken = error;
    }
    expect(isRefusal(taken) ? taken.refusal.code : taken).toBe('SLOT_TAKEN');
    expect((taken as { next?: string[] }).next?.[0]).toBe(at('19:30'));
    // Nothing of another guest: the times answer is instants only.
    expect(JSON.stringify(await guestTimes(entry, deps, { party: 2, date: DAY }))).not.toContain('Grace');
  });

  it('refuses a party outside the online range, and a fourth upcoming reservation for one email', async () => {
    const { key } = await restaurant();
    const entry = await enterTablePage({ db }, key);
    expect(await code(guestReserve(entry, deps, { ...reserve(at('18:00')), party: 9 }))).toBe('INPUT:party');
    const email = `four-${randomUUID().slice(0, 8)}@example.com`;
    for (const time of ['18:00', '19:30', '21:00']) await guestReserve(entry, deps, reserve(at(time), email));
    expect(await code(guestReserve(entry, deps, reserve(`${week.tuesday}T18:00:00.000Z`, email)))).toBe('INPUT:email');
  });

  it('keeps a ticked marketing box as a consent on the guest’s Person, and nothing when unticked', async () => {
    const { w, key } = await restaurant();
    const entry = await enterTablePage({ db }, key);
    const ticked = await guestReserve(entry, deps, { ...reserve(at('18:00')), marketing: true });
    await guestReserve(entry, deps, reserve(at('21:00')));
    const rows = (
      await w.sql<{ purpose: string; source_id: string; wording: string }>(
        sql`select purpose, source_id::text, wording from consent_records where source_type = 'appointment'`,
      )
    ).rows;
    expect(rows).toEqual([
      {
        purpose: 'marketing',
        source_id: ticked.booked.appointmentId,
        wording: 'Send me news and offers from Somewhere Nowhere.',
      },
    ]);
  });
});

describe('the manage page (AC-6555)', () => {
  it('finds a reservation by token, or by code with the matching email only', async () => {
    const { key } = await restaurant();
    const entry = await enterTablePage({ db }, key);
    const input = reserve(at('18:00'));
    const made = await guestReserve(entry, deps, input);
    const token = made.manageToken ?? '';
    expect((await guestVisit(entry, { token }, deps)).lookupCode).toBe(made.visit.lookupCode);
    const lower = made.visit.lookupCode.toLowerCase();
    expect(
      (await guestVisit(entry, { code: `${lower.slice(0, 4)}-${lower.slice(4)}`, email: input.email }, deps)).start,
    ).toBe(at('18:00'));
    expect(await code(guestVisit(entry, { code: made.visit.lookupCode, email: 'someone@else.example' }, deps))).toBe(
      'NOT_FOUND',
    );
    // Another place's key never opens it.
    const other = await enterTablePage({ db }, (await restaurant()).key);
    expect(await code(guestVisit(other, { token }, deps))).toBe('NOT_FOUND');
    const ics = await guestIcs(
      entry,
      { token },
      {
        uidDomain: 'timefix.com',
        pageUrl: 'https://timefix.com/r/x/manage',
        organizerEmail: 'reservations@timefix.com',
      },
    );
    expect(ics).toContain('SUMMARY:Table for 2 at Somewhere Nowhere');
    expect(ics).toContain(`Your reservation code is ${made.visit.lookupCode}`);
  });

  it('changes time and party within the cutoff, then refuses past it, and cancels once', async () => {
    const { key } = await restaurant();
    const entry = await enterTablePage({ db }, key);
    const made = await guestReserve(entry, deps, reserve(at('18:00')));
    const guest = { token: made.manageToken ?? '' };
    const changed = await guestChange(entry, deps, { guest, start: at('20:00'), party: 4 });
    expect(changed.visit).toMatchObject({ start: at('20:00'), party: 4 });
    // 18:00 is free again; 20:00 is held.
    const times = await guestTimes(entry, deps, { party: 2, date: DAY });
    expect(times).toContain(at('18:00'));
    expect(times).not.toContain(at('20:00'));
    const late = { busy: NO_CALENDAR.busy, now: () => new Date(at('18:30')) };
    expect(await code(guestChange(entry, late, { guest, start: at('21:30') }))).toBe('BOOKING_CLOSED');
    expect(await code(guestCancel(entry, late, { guest }))).toBe('BOOKING_CLOSED');
    const cancelled = await guestCancel(entry, deps, { guest, reason: 'Plans changed' });
    expect(cancelled).toMatchObject({ cancelled: true, visit: { status: 'cancelled' } });
    expect((await guestCancel(entry, deps, { guest })).cancelled).toBe(false);
    expect(await guestTimes(entry, deps, { party: 2, date: DAY })).toContain(at('20:00'));
  });
});
