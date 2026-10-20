// Book someone in (spec 0027, AC-709, AC-710, AC-712), against the real
// Postgres: the member's own time is theirs to give, but never twice.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import { createTimeBlock } from './blocks.ts';
import type { BookingEvent } from './calendar.ts';
import { bookAsHost, type HostBookingInput } from './host.ts';
import { readBookingsCalendar } from './list.ts';
import { createBookingPage } from './pages.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-booking-host-tests' });
});
afterAll(async () => {
  await db.close();
});

/** Sunday 1 November 2026, midnight UTC. */
const NOW = new Date('2026-11-01T00:00:00.000Z');

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Host',
    slug: `host-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Host', email: 'ada@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const addMember = async (name: string) => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${name}-${id}@example.com`}, 'member', 'system', 'system')`,
      ),
    );
    return rescope(owner, { actor: { type: 'member', id }, role: 'member' });
  };
  return { ...created, owner, addMember };
}

function calendar() {
  const events: BookingEvent[] = [];
  return {
    events,
    deps: {
      now: () => NOW,
      calendar: {
        events: (event: BookingEvent) => {
          events.push(event);
          return Promise.resolve({ meetingId: newId() });
        },
      },
    },
  };
}

const input = (pageId: string, over: Partial<HostBookingInput> = {}): HostBookingInput => ({
  idempotencyKey: newId(),
  pageId,
  start: new Date('2026-11-02T20:00:00.000Z'),
  minutes: 45,
  name: 'Grace Hopper',
  email: 'grace@navy.example',
  timeZone: 'America/New_York',
  guests: ['Alan@Example.com', 'grace@navy.example'],
  message: 'Grabbing the hour we talked about.',
  ...over,
});

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

const pageOf = (scope: EngineScope) =>
  createBookingPage(scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' }, NOW);

describe('book someone in (AC-709, AC-710)', () => {
  it('books outside the hours and inside the member’s own block, files the guest and invites everyone', async () => {
    const w = await workspace();
    const page = await pageOf(w.owner);
    // 20:00 UTC is outside 09:00 to 17:00, and inside a block the member made.
    await createTimeBlock(w.owner, {
      id: newId(),
      kind: 'block',
      repeat: 'once',
      date: '2026-11-02',
      startMinute: 19 * 60,
      endMinute: 22 * 60,
      timeZone: 'UTC',
    });
    const cal = calendar();
    const booked = await bookAsHost(w.owner, cal.deps, input(page.id));
    expect(booked.replayed).toBe(false);

    const week = await readBookingsCalendar(w.owner, {
      from: '2026-11-02T00:00:00.000Z',
      to: '2026-11-03T00:00:00.000Z',
    });
    expect(week.bookings).toMatchObject([
      {
        id: booked.bookingId,
        startsAt: '2026-11-02T20:00:00.000Z',
        endsAt: '2026-11-02T20:45:00.000Z',
        visitorName: 'Grace Hopper',
        status: 'confirmed',
        guests: ['alan@example.com'],
        note: 'Grabbing the hour we talked about.',
      },
    ]);
    expect(week.bookings[0]?.personRecordId).toBeDefined();
    expect(cal.events).toHaveLength(1);
    expect(cal.events[0]?.attendees.map((each) => each.email)).toEqual(['grace@navy.example', 'alan@example.com']);
  });

  it('a retry gives back the first booking', async () => {
    const w = await workspace();
    const page = await pageOf(w.owner);
    const once = input(page.id);
    const first = await bookAsHost(w.owner, calendar().deps, once);
    const again = await bookAsHost(w.owner, calendar().deps, once);
    expect(again).toEqual({ bookingId: first.bookingId, replayed: true });
  });

  it('never overlaps another booking of the member’s', async () => {
    const w = await workspace();
    const page = await pageOf(w.owner);
    await bookAsHost(w.owner, calendar().deps, input(page.id));
    expect(
      await refusalOf(
        bookAsHost(w.owner, calendar().deps, input(page.id, { start: new Date('2026-11-02T20:30:00.000Z') })),
      ),
    ).toMatchObject({ code: 'SLOT_TAKEN', message: 'Something else is already in that time.' });
    // Back to back is fine.
    await expect(
      bookAsHost(w.owner, calendar().deps, input(page.id, { start: new Date('2026-11-02T20:45:00.000Z') })),
    ).resolves.toMatchObject({ replayed: false });
  });

  it('refuses the past, a length out of bounds, and a page the member isn’t on', async () => {
    const w = await workspace();
    const page = await pageOf(w.owner);
    expect(
      await refusalOf(
        bookAsHost(w.owner, calendar().deps, input(page.id, { start: new Date('2026-10-31T09:00:00.000Z') })),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'start' });
    expect(await refusalOf(bookAsHost(w.owner, calendar().deps, input(page.id, { minutes: 481 })))).toMatchObject({
      code: 'CONFIG_INVALID',
      field: 'minutes',
    });
    const bea = await w.addMember('Bea');
    expect(await refusalOf(bookAsHost(bea, calendar().deps, input(page.id)))).toMatchObject({
      code: 'NOT_FOUND',
      field: 'pageId',
    });
    const elsewhere = await workspace();
    expect(await refusalOf(bookAsHost(elsewhere.owner, calendar().deps, input(page.id)))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('a key has no time of its own to give (AC-712)', async () => {
    const w = await workspace();
    const page = await pageOf(w.owner);
    const key = testScope({ db, workspaceId: w.workspaceId, actor: { type: 'api_key', id: newId() }, scopes: [] });
    expect(await refusalOf(bookAsHost(key, calendar().deps, input(page.id)))).toMatchObject({ code: 'FORBIDDEN' });
  });
});
