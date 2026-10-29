// Book someone in (spec 0027, AC-709, AC-710, AC-712), against the real
// Postgres: the member's own time is theirs to give, but never twice.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import type { AccessRules } from '../access/policy.ts';
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
      linkKey: Buffer.alloc(32, 7),
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
    // The member who booked them in is on it first: a guest's own copy never shows the organiser, so without them
    // the person booked in has nothing naming who booked them (owner, 25 Oct 2026).
    expect(cal.events[0]?.attendees.map((each) => each.email)).toEqual([
      'ada@example.com',
      'grace@navy.example',
      'alan@example.com',
    ]);
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

  it('a key another host on the page used books nothing, and never answers their booking', async () => {
    const w = await workspace();
    const page = await pageOf(w.owner);
    const bea = await w.addMember('Bea');
    const beaId = bea.actor.id;
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(
        sql`insert into booking_page_members (workspace_id, page_id, member_id, position) values (${w.workspaceId}, ${page.id}, ${beaId}, 1)`,
      ),
    );
    const once = input(page.id);
    await bookAsHost(w.owner, calendar().deps, once);
    expect(
      await refusalOf(bookAsHost(bea, calendar().deps, { ...once, start: new Date('2026-11-03T20:00:00.000Z') })),
    ).toMatchObject({ code: 'ID_TAKEN' });
  });

  it('says why the guest isn’t in the CRM when their record can’t be made, and the booking stands (late trap #71)', async () => {
    const w = await workspace();
    const page = await pageOf(w.owner);
    // Required with nothing to fill it, written straight to the row: settings refuses it while a page is live.
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`
        insert into attributes (workspace_id, id, object_id, api_slug, title, type, is_required, position,
          created_by_type, updated_by_type)
        select ${w.workspaceId}::uuid, ${newId()}::uuid, id, 'desk_phone', 'Desk phone', 'text', true, 99, 'system', 'system'
        from objects where standard_key = 'people'
      `),
    );
    const booked = await bookAsHost(w.owner, calendar().deps, input(page.id));
    expect(booked.notInCrm).toBe(
      'Desk phone on People is required and nothing fills it. Give it a default, or make it optional.',
    );
    const week = await readBookingsCalendar(w.owner, {
      from: '2026-11-02T00:00:00.000Z',
      to: '2026-11-03T00:00:00.000Z',
    });
    expect(week.bookings).toHaveLength(1);
    expect(week.bookings[0]).not.toHaveProperty('personRecordId');
  });

  it('a host who can’t see People and Companies learns nothing of the guest’s records', async () => {
    const w = await workspace();
    // Ada files Grace first, so the person and company already exist.
    await bookAsHost(w.owner, calendar().deps, input((await pageOf(w.owner)).id));
    const objects = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ id: string }>(sql`select id::text as id from objects where standard_key in ('people', 'companies')`),
    );
    const rules: AccessRules = {
      levels: objects.rows.map((row) => ({
        subject: { type: 'role', role: 'member' },
        target: { type: 'object', objectId: row.id },
        level: 'none',
      })),
      records: [],
    };
    const bea = rescope(await w.addMember('Bea'), { rules });
    const page = await createBookingPage(bea, { id: newId(), title: 'Bea’s call', timeZone: 'UTC' }, NOW);
    const booked = await bookAsHost(
      bea,
      calendar().deps,
      input(page.id, { start: new Date('2026-11-03T20:00:00.000Z') }),
    );
    // Nothing says whether the guest was new: a new one would be refused, a matched one not.
    expect(booked.notInCrm).toBeUndefined();
    const week = await readBookingsCalendar(bea, { from: '2026-11-03T00:00:00.000Z', to: '2026-11-04T00:00:00.000Z' });
    expect(week.bookings).toHaveLength(1);
    expect(week.bookings[0]).not.toHaveProperty('personRecordId');
    expect(week.bookings[0]).not.toHaveProperty('companyRecordId');
  });
});

describe('several guests and the calendar the member picks (spec 0027’s follow ups)', () => {
  /** One account for `memberId` in `status`, with each calendar named and its access role. */
  async function account(
    workspaceId: string,
    memberId: string,
    status: 'connected' | 'revoked',
    calendars: readonly { readonly id: string; readonly role: 'owner' | 'writer' | 'reader' }[],
  ) {
    const connection = newId();
    await db.withWorkspace(workspaceId, async (tx) => {
      await tx.execute(sql`
        insert into calendar_connections (workspace_id, id, member_id, provider, account_email, status, is_default, tokens,
          created_by_type, updated_by_type)
        values (${workspaceId}, ${connection}, ${memberId}, 'google', ${`${connection}@example.com`}, ${status}, false,
          '\\x00', 'system', 'system')
      `);
      for (const [index, calendar] of calendars.entries()) {
        await tx.execute(sql`
          insert into calendar_calendars (workspace_id, id, connection_id, member_id, provider_calendar_id, name,
            access_role, is_primary, check_conflicts, show_in_week, sync, is_destination, created_by_type, updated_by_type)
          values (${workspaceId}, ${calendar.id}, ${connection}, ${memberId}, ${calendar.id}, ${`Calendar ${String(index)}`},
            ${calendar.role}, ${index === 0}, true, true, true, false, 'system', 'system')
        `);
      }
    });
  }

  it('invites several guests once each, in the order given, leaving out who it is with', async () => {
    const w = await workspace();
    const page = await pageOf(w.owner);
    const cal = calendar();
    const booked = await bookAsHost(
      w.owner,
      cal.deps,
      input(page.id, {
        guests: [
          'alan@example.com',
          'Katherine@Nasa.example',
          'alan@example.com',
          'GRACE@navy.example',
          'bea@example.com',
        ],
      }),
    );
    expect(cal.events[0]?.attendees.map((each) => each.email)).toEqual([
      'ada@example.com',
      'grace@navy.example',
      'alan@example.com',
      'katherine@nasa.example',
      'bea@example.com',
    ]);
    const week = await readBookingsCalendar(w.owner, {
      from: '2026-11-02T00:00:00.000Z',
      to: '2026-11-03T00:00:00.000Z',
    });
    expect(week.bookings.find((each) => each.id === booked.bookingId)?.guests).toEqual([
      'alan@example.com',
      'katherine@nasa.example',
      'bea@example.com',
    ]);
  });

  it('puts the event on the calendar picked, and refuses one that isn’t the member’s to write (AC-712)', async () => {
    const w = await workspace();
    const page = await pageOf(w.owner);
    const bea = await w.addMember('Bea');
    const [work, holidays, gone, beas] = [newId(), newId(), newId(), newId()];
    await account(w.workspaceId, w.memberId, 'connected', [
      { id: work, role: 'writer' },
      { id: holidays, role: 'reader' },
    ]);
    await account(w.workspaceId, w.memberId, 'revoked', [{ id: gone, role: 'owner' }]);
    await account(w.workspaceId, bea.actor.id ?? '', 'connected', [{ id: beas, role: 'owner' }]);
    const cal = calendar();
    await bookAsHost(w.owner, cal.deps, input(page.id, { calendarId: work }));
    expect(cal.events[0]?.calendarId).toBe(work);
    // A calendar they may only read, one on an account whose grant is gone, a colleague's, and one that doesn't
    // exist all answer alike, and nothing is booked.
    for (const [index, calendarId] of [holidays, gone, beas, newId()].entries()) {
      const refused = calendar();
      expect(
        await refusalOf(
          bookAsHost(
            w.owner,
            refused.deps,
            input(page.id, { calendarId, start: new Date(Date.UTC(2026, 10, 3 + index, 20)) }),
          ),
        ),
      ).toMatchObject({ code: 'NOT_FOUND', field: 'calendarId' });
      expect(refused.events).toEqual([]);
    }
    const week = await readBookingsCalendar(w.owner, {
      from: '2026-11-02T00:00:00.000Z',
      to: '2026-11-09T00:00:00.000Z',
    });
    expect(week.bookings).toHaveLength(1);
  });

  it('answers a retry with the booking it made, even once the calendar picked is disconnected', async () => {
    const w = await workspace();
    const page = await pageOf(w.owner);
    const work = newId();
    await account(w.workspaceId, w.memberId, 'connected', [{ id: work, role: 'writer' }]);
    const asked = input(page.id, { calendarId: work });
    const first = await bookAsHost(w.owner, calendar().deps, asked);
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update calendar_connections set status = 'revoked' where member_id = ${w.memberId}::uuid`),
    );
    const retried = calendar();
    expect(await bookAsHost(w.owner, retried.deps, asked)).toEqual({ bookingId: first.bookingId, replayed: true });
    expect(retried.events).toEqual([]);
  });
});
