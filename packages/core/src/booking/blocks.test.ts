// Calendar blocks and holds in core (spec 0027, AC-703 to AC-707, AC-712),
// against the real Postgres: what a block closes on the public page and on a
// booking, weekly turns across a clock change, holds that only a private page
// may book, and that a member's blocks are theirs alone.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { enterBookingPage } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import type { EngineScope } from '../access/mint.ts';
import { rescope, testScope } from '../testing.ts';
import { createTimeBlock, removeTimeBlock, weeklyTurns, type TimeBlockDraft } from './blocks.ts';
import { NO_CALENDAR } from './calendar.ts';
import { readBookingsCalendar } from './list.ts';
import { createBookingPage, updateBookingPage } from './pages.ts';
import { bookPublicSlot, readPublicSlots } from './public.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-booking-blocks-tests' });
});
afterAll(async () => {
  await db.close();
});

/** Sunday 1 November 2026, midnight UTC. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const deps = { calendar: NO_CALENDAR, now: () => NOW };

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Blocks',
    slug: `blocks-${String(count)}-${String(Date.now())}`,
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

/** A live page of `scope`'s: weekdays 09:00 to 17:00 UTC, 30 minutes. */
async function livePage(scope: EngineScope, isPrivate = false) {
  const page = await createBookingPage(scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' }, NOW);
  if (isPrivate) {
    await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute(sql`update booking_pages set is_private = true where id = ${page.id}::uuid`),
    );
  }
  return { page, entry: await enterBookingPage({ db }, page.publicKey) };
}

/** Monday 2 November's slot starts, as UTC "HH:MM". */
async function mondayStarts(publicKey: string, day = '2026-11-02') {
  const entry = await enterBookingPage({ db }, publicKey);
  const next = new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString();
  const { slots } = await readPublicSlots(entry, deps, {
    from: `${day}T00:00:00.000Z`,
    to: next,
    duration: 30,
    tz: 'UTC',
  });
  return slots.map((slot) => slot.start.slice(11, 16));
}

const draft = (over: Partial<TimeBlockDraft> = {}): TimeBlockDraft => ({
  kind: 'block',
  repeat: 'once',
  date: '2026-11-02',
  startMinute: 10 * 60,
  endMinute: 11 * 60,
  timeZone: 'UTC',
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

describe('blocks close time (AC-703, AC-706)', () => {
  it('a one off block closes its span on the page, and removing it reopens it', async () => {
    const w = await workspace();
    const { page } = await livePage(w.owner);
    expect(await mondayStarts(page.publicKey)).toContain('10:00');

    const block = await createTimeBlock(w.owner, draft({ label: 'Dentist' }));
    expect(block).toMatchObject({
      kind: 'block',
      repeat: 'once',
      label: 'Dentist',
      startsAt: '2026-11-02T10:00:00.000Z',
      endsAt: '2026-11-02T11:00:00.000Z',
    });
    const starts = await mondayStarts(page.publicKey);
    expect(starts).not.toContain('10:00');
    expect(starts).not.toContain('10:30');
    expect(starts).toContain('09:30');
    expect(starts).toContain('11:00');

    await removeTimeBlock(w.owner, { id: block.id });
    expect(await mondayStarts(page.publicKey)).toContain('10:00');
  });

  it('a weekly block closes its weekday from its first date on, and never before', async () => {
    const w = await workspace();
    const { page } = await livePage(w.owner);
    await createTimeBlock(w.owner, draft({ repeat: 'weekly', date: '2026-11-09' }));
    expect(await mondayStarts(page.publicKey, '2026-11-02')).toContain('10:00');
    expect(await mondayStarts(page.publicKey, '2026-11-09')).not.toContain('10:00');
    expect(await mondayStarts(page.publicKey, '2026-11-16')).not.toContain('10:00');
    // Tuesday is another weekday.
    expect(await mondayStarts(page.publicKey, '2026-11-10')).toContain('10:00');
  });

  it('refuses a booking into blocked time, even one picked before the block was made', async () => {
    const w = await workspace();
    const { entry } = await livePage(w.owner);
    await createTimeBlock(w.owner, draft());
    expect(
      await refusalOf(
        bookPublicSlot(entry, deps, {
          idempotencyKey: newId(),
          start: '2026-11-02T10:30:00.000Z',
          duration: 30,
          name: 'Grace Hopper',
          email: 'grace@navy.example',
          timeZone: 'UTC',
        }),
      ),
    ).toMatchObject({ code: 'SLOT_TAKEN' });
  });

  it('refuses a span back to front, a weekly hold and a block naming a page', async () => {
    const w = await workspace();
    expect(await refusalOf(createTimeBlock(w.owner, draft({ startMinute: 660, endMinute: 600 })))).toMatchObject({
      code: 'CONFIG_INVALID',
      field: 'endMinute',
    });
    expect(await refusalOf(createTimeBlock(w.owner, draft({ kind: 'hold', repeat: 'weekly' })))).toMatchObject({
      code: 'CONFIG_INVALID',
      field: 'repeat',
    });
    expect(await refusalOf(createTimeBlock(w.owner, draft({ pageId: newId() })))).toMatchObject({
      code: 'CONFIG_INVALID',
      field: 'pageId',
    });
  });
});

describe('holds open only for a private page (AC-704, AC-707)', () => {
  it('closes a hold for an ordinary page, opens it for a private one, even outside the hours', async () => {
    const w = await workspace();
    const { page: open } = await livePage(w.owner);
    const { page: hidden } = await livePage(w.owner, true);
    await createTimeBlock(w.owner, draft({ kind: 'hold' }));
    await createTimeBlock(w.owner, draft({ kind: 'hold', startMinute: 18 * 60, endMinute: 19 * 60 }));

    const ordinary = await mondayStarts(open.publicKey);
    expect(ordinary).not.toContain('10:00');
    expect(ordinary).not.toContain('18:00');

    const priv = await mondayStarts(hidden.publicKey);
    expect(priv).toContain('10:00');
    expect(priv).toContain('18:00');
    expect(priv).toContain('18:30');
    expect(priv).not.toContain('19:00');
  });

  it('a hold carved for one private page stays closed for another', async () => {
    const w = await workspace();
    const { page: first } = await livePage(w.owner, true);
    const { page: second } = await livePage(w.owner, true);
    await createTimeBlock(w.owner, draft({ kind: 'hold', startMinute: 18 * 60, endMinute: 19 * 60, pageId: first.id }));
    expect(await mondayStarts(first.publicKey)).toContain('18:00');
    expect(await mondayStarts(second.publicKey)).not.toContain('18:00');
  });

  it('a page turns private through its settings, and says so (AC-708)', async () => {
    const w = await workspace();
    const { page } = await livePage(w.owner);
    expect(page.isPrivate).toBe(false);
    const changed = await updateBookingPage(w.owner, { pageId: page.id, settings: { isPrivate: true } }, NOW);
    expect(changed.isPrivate).toBe(true);
    await createTimeBlock(w.owner, draft({ kind: 'hold', startMinute: 18 * 60, endMinute: 19 * 60 }));
    expect(await mondayStarts(page.publicKey)).toContain('18:00');
  });

  it('refuses a hold for a page the member doesn’t book', async () => {
    const w = await workspace();
    const other = await w.addMember('Bea');
    const { page } = await livePage(other, true);
    expect(await refusalOf(createTimeBlock(w.owner, draft({ kind: 'hold', pageId: page.id })))).toMatchObject({
      code: 'NOT_FOUND',
      field: 'pageId',
    });
  });
});

describe('a member’s blocks are their own (AC-705, AC-712)', () => {
  it('the calendar shows the reader’s own blocks, each weekly turn once, and never another member’s', async () => {
    const w = await workspace();
    const bea = await w.addMember('Bea');
    const once = await createTimeBlock(w.owner, draft({ label: 'Dentist' }));
    const weekly = await createTimeBlock(
      w.owner,
      draft({ repeat: 'weekly', startMinute: 13 * 60, endMinute: 14 * 60 }),
    );
    await createTimeBlock(bea, draft());

    const week = await readBookingsCalendar(w.owner, {
      from: '2026-11-02T00:00:00.000Z',
      to: '2026-11-16T00:00:00.000Z',
    });
    expect(week.blocks.map((each) => [each.blockId, each.startsAt])).toEqual([
      [once.id, '2026-11-02T10:00:00.000Z'],
      [weekly.id, '2026-11-02T13:00:00.000Z'],
      [weekly.id, '2026-11-09T13:00:00.000Z'],
    ]);
    expect(week.blocks[0]).toMatchObject({ kind: 'block', repeat: 'once', label: 'Dentist' });
    expect(new Set(week.blocks.map((each) => each.key)).size).toBe(3);

    const beas = await readBookingsCalendar(bea, { from: '2026-11-02T00:00:00.000Z', to: '2026-11-09T00:00:00.000Z' });
    expect(beas.blocks).toHaveLength(1);
  });

  it('nobody removes another member’s block, nor one in another workspace', async () => {
    const w = await workspace();
    const bea = await w.addMember('Bea');
    const block = await createTimeBlock(w.owner, draft());
    expect(await refusalOf(removeTimeBlock(bea, { id: block.id }))).toMatchObject({ code: 'NOT_FOUND' });

    const elsewhere = await workspace();
    expect(await refusalOf(removeTimeBlock(elsewhere.owner, { id: block.id }))).toMatchObject({ code: 'NOT_FOUND' });
    // Still there: the owner removes it.
    await expect(removeTimeBlock(w.owner, { id: block.id })).resolves.toEqual({ id: block.id });
  });

  it('a key with no member has no calendar to block', async () => {
    const w = await workspace();
    const key = testScope({ db, workspaceId: w.workspaceId, actor: { type: 'api_key', id: newId() }, scopes: [] });
    expect(await refusalOf(createTimeBlock(key, draft()))).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('weekly turns (pure)', () => {
  const block = {
    weekday: 1,
    startMinute: 9 * 60,
    endMinute: 10 * 60,
    timeZone: 'Europe/London',
    fromDate: '2026-10-19',
  };

  it('keeps 09:00 local across the clock change, so UTC moves an hour', () => {
    const turns = weeklyTurns(block, new Date('2026-10-19T00:00:00Z'), new Date('2026-11-03T00:00:00Z'));
    expect(turns.map((turn) => [turn.date, turn.span.start.toISOString()])).toEqual([
      ['2026-10-19', '2026-10-19T08:00:00.000Z'],
      ['2026-10-26', '2026-10-26T09:00:00.000Z'],
      ['2026-11-02', '2026-11-02T09:00:00.000Z'],
    ]);
  });

  it('starts at its first date and ends at midnight for 1440', () => {
    const late = { ...block, startMinute: 23 * 60, endMinute: 1440, fromDate: '2026-10-26' };
    const turns = weeklyTurns(late, new Date('2026-10-19T00:00:00Z'), new Date('2026-10-28T00:00:00Z'));
    expect(turns.map((turn) => [turn.span.start.toISOString(), turn.span.end.toISOString()])).toEqual([
      ['2026-10-26T23:00:00.000Z', '2026-10-27T00:00:00.000Z'],
    ]);
  });
});
