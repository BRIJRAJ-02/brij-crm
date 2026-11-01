// Colleagues' personal booking pages (spec 0037, AC-1263, AC-1264, AC-1273, AC-1332's Manage half), against a real
// Postgres as the app role: Manage over the owner lists and changes their personal pages (named for the list), See
// does not, a page's "Add events to" is the owner's alone, every change by someone else is audited with the fields
// that changed and folded into the owner's notice, and a rotation that adds or removes them tells them too.
import { sql } from 'drizzle-orm';
import type { Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { systemScope } from '../access/door.ts';
import { createSchedule } from '../availability/schedules.ts';
import { readPageDestination, setPageDestination } from '../calendar/page-destination.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { createRotation, updateRotation } from '../rotation/rotations.ts';
import { grantDelegation } from '../scheduling/delegations.ts';
import { pageLines, rotationLines, runSchedulingNotice } from '../scheduling/notice.ts';
import { testScope } from '../testing.ts';
import { pageAuditSides, type PageAudited } from './page-audit.ts';
import {
  createBookingPage,
  deleteBookingPage,
  getBookingPage,
  listBookingPages,
  listBookings,
  updateBookingPage,
} from './pages.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-colleague-pages-tests' });
});
afterAll(async () => {
  await db.close();
});

const NOW = new Date('2026-11-01T00:00:00.000Z');

let made = 0;
/** Olga the owner; Bea, a member with a page; Priya, whom Bea lets see or manage her scheduling; Bo, with no reach. */
async function world(level: 'view' | 'manage') {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Pages',
    slug: `colleague-pages-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Olga Owner', email: 'olga@example.com' },
  });
  const add = async (name: string, role: Role) => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${id}@example.com`}, ${role}, 'system', 'system')`,
      ),
    );
    return id;
  };
  const as = (id: string, role: Role = 'member') =>
    testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id }, role });
  const bea = await add('Bea Rao', 'member');
  const priya = await add('Priya Shah', 'member');
  const bo = await add('Bo Lee', 'member');
  const owner = created.memberId;
  await grantDelegation(as(bea), { delegateMemberId: priya, target: { type: 'member', memberId: bea }, level });
  const page = await createBookingPage(as(bea), { id: newId(), title: 'Intro call', timeZone: 'UTC' }, NOW);
  const audits = (action: string) =>
    testQuery<{ actor_member_id: string; target_type: string; target_id: string; before: unknown; after: unknown }>(
      ownerUrl,
      `select actor_member_id::text, target_type, target_id, before, after from audit_events
         where workspace_id = $1 and action = $2 order by at, id`,
      [created.workspaceId, action],
    );
  return { ...created, owner, bea, priya, bo, page, as, audits };
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

describe('Manage over a colleague reaches their personal pages (AC-1273, AC-1332)', () => {
  it('lists them under the owner’s name and lets the manager change them', async () => {
    const w = await world('manage');
    const listed = await listBookingPages(w.as(w.priya), NOW);
    expect(listed.map((page) => [page.id, page.ownerName, page.canChange])).toEqual([[w.page.id, 'Bea Rao', true]]);
    // The owner's own list names nobody.
    const own = await listBookingPages(w.as(w.bea), NOW);
    expect(own[0]?.ownerName).toBeUndefined();
    const changed = await updateBookingPage(
      w.as(w.priya),
      { pageId: w.page.id, settings: { location: { type: 'phone' }, bufferBefore: 10 } },
      NOW,
    );
    expect(changed).toMatchObject({ location: { type: 'phone' }, bufferBefore: 10, ownerName: 'Bea Rao' });
    expect((await getBookingPage(w.as(w.priya), { pageId: w.page.id }, NOW)).canChange).toBe(true);
    // The address and the profile stay the owner's.
    expect(
      await refusalOf(updateBookingPage(w.as(w.priya), { pageId: w.page.id, settings: { slug: 'mine' } }, NOW)),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('audits a change by someone else with only the fields that changed, and the owner’s own change not', async () => {
    const w = await world('manage');
    await updateBookingPage(w.as(w.bea), { pageId: w.page.id, settings: { title: 'Bea’s intro' } }, NOW);
    await updateBookingPage(w.as(w.priya), { pageId: w.page.id, settings: { location: { type: 'phone' } } }, NOW);
    const rows = await w.audits('booking_page.changed_for');
    expect(rows).toEqual([
      {
        actor_member_id: w.priya,
        target_type: 'member',
        target_id: w.bea,
        before: { memberId: w.bea, pageId: w.page.id, title: 'Bea’s intro', fields: { location: 'video' } },
        after: { memberId: w.bea, pageId: w.page.id, title: 'Bea’s intro', fields: { location: 'phone' } },
      },
    ]);
  });

  it('folds page changes into the owner’s notice, and its inbox', async () => {
    const w = await world('manage');
    await updateBookingPage(w.as(w.priya), { pageId: w.page.id, settings: { location: { type: 'phone' } } }, NOW);
    await updateBookingPage(w.as(w.priya), { pageId: w.page.id, settings: { dailyLimit: 4 } }, NOW);
    const system = systemScope(db, w.workspaceId);
    expect(await runSchedulingNotice(system, { actorMemberId: w.priya, memberId: w.bea })).toBe('queued');
    const emails = await testQuery<{ to_member_id: string; params: { lines: string[] } }>(
      ownerUrl,
      `select to_member_id::text, params from emails where workspace_id = $1 and kind = 'scheduling_changed'`,
      [w.workspaceId],
    );
    expect(emails).toEqual([
      {
        to_member_id: w.bea,
        params: expect.objectContaining({
          lines: [
            'Intro call: location changed from Video call to Phone',
            'Intro call: max per day changed from no limit to 4',
          ],
        }) as unknown,
      },
    ]);
    const inbox = await testQuery<{ member_id: string; actor_member_id: string }>(
      ownerUrl,
      `select member_id::text, actor_member_id::text from notifications
         where workspace_id = $1 and kind::text = 'scheduling_changed'`,
      [w.workspaceId],
    );
    expect(inbox).toEqual([{ member_id: w.bea, actor_member_id: w.priya }]);
  });

  it('audits a delete by someone else', async () => {
    const w = await world('manage');
    await deleteBookingPage(w.as(w.priya), { pageId: w.page.id });
    const [row] = await w.audits('booking_page.changed_for');
    expect(row?.after).toEqual({ memberId: w.bea, pageId: w.page.id, title: 'Intro call', deleted: true, fields: {} });
  });

  it('gives See, or no reach, none of them (hidden means absent)', async () => {
    const w = await world('view');
    expect(await listBookingPages(w.as(w.priya), NOW)).toEqual([]);
    expect(await listBookingPages(w.as(w.bo), NOW)).toEqual([]);
    for (const who of [w.priya, w.bo]) {
      expect(await refusalOf(getBookingPage(w.as(who), { pageId: w.page.id }, NOW))).toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(
        await refusalOf(updateBookingPage(w.as(who), { pageId: w.page.id, settings: { bufferBefore: 5 } }, NOW)),
      ).toMatchObject({ code: 'NOT_FOUND' });
      expect(await refusalOf(readPageDestination(w.as(who), { pageId: w.page.id }))).toMatchObject({
        code: 'NOT_FOUND',
      });
    }
  });

  it('lists the page’s bookings to the manager', async () => {
    const w = await world('manage');
    expect(await listBookings(w.as(w.priya), { pageId: w.page.id, when: 'upcoming' }, NOW)).toEqual([]);
    expect(await refusalOf(listBookings(w.as(w.bo), { pageId: w.page.id, when: 'upcoming' }, NOW))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reaches nothing once the owner is removed, nor a round robin page they made', async () => {
    const w = await world('manage');
    const other = await createBookingPage(w.as(w.bea), { id: newId(), title: 'Team call', timeZone: 'UTC' }, NOW);
    await testQuery(ownerUrl, `update booking_pages set kind = 'round_robin' where id = $1`, [other.id]);
    expect((await listBookingPages(w.as(w.priya), NOW)).map((page) => page.id)).toEqual([w.page.id]);
    expect(await refusalOf(getBookingPage(w.as(w.priya), { pageId: other.id }, NOW))).toMatchObject({
      code: 'NOT_FOUND',
    });
    await testQuery(ownerUrl, `update members set status = 'removed' where id = $1`, [w.bea]);
    expect(await listBookingPages(w.as(w.priya), NOW)).toEqual([]);
    // Each call made only when awaited: one started early rejects before anything listens (an unhandled rejection).
    for (const call of [
      () => getBookingPage(w.as(w.priya), { pageId: w.page.id }, NOW),
      () => updateBookingPage(w.as(w.priya), { pageId: w.page.id, settings: { bufferBefore: 5 } }, NOW),
      () => readPageDestination(w.as(w.priya), { pageId: w.page.id }),
    ]) {
      expect(await refusalOf(call())).toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('reaches no page of another workspace', async () => {
    const w = await world('manage');
    const elsewhere = await world('manage');
    expect(await refusalOf(getBookingPage(w.as(w.priya), { pageId: elsewhere.page.id }, NOW))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('"Add events to" stays the owner’s (AC-1273, decision 14)', () => {
  it('reads without a calendar to a manager or an admin, and refuses their change', async () => {
    const w = await world('manage');
    for (const [who, role] of [
      [w.priya, 'member'],
      [w.owner, 'owner'],
    ] as const) {
      const read = await readPageDestination(w.as(who, role), { pageId: w.page.id });
      expect(read).toEqual({ status: 'default', isOwner: false });
      expect(await refusalOf(setPageDestination(w.as(who, role), { pageId: w.page.id, calendarId: null }))).toEqual({
        code: 'FORBIDDEN',
        message: 'Only Bea chooses where this page’s events go.',
      });
    }
    expect(await readPageDestination(w.as(w.bea), { pageId: w.page.id })).toEqual({ status: 'default', isOwner: true });
  });
});

describe('a rotation tells who joined or left (AC-1264)', () => {
  it('audits who joined and left, and the notice says so once the changes don’t cancel out', async () => {
    const w = await world('manage');
    const admin = w.as(w.owner, 'owner');
    // Everyone a rotation seats has hours of their own.
    for (const who of [w.bea, w.priya, w.bo]) {
      await createSchedule(w.as(who), { id: newId(), name: 'Weekdays', timeZone: 'UTC' });
    }
    const member = (memberId: string) => ({
      memberId,
      weight: 100,
      priority: 2,
      dailyCap: null,
      weeklyCap: null,
      isOn: true,
    });
    const rotation = await createRotation(
      admin,
      {
        id: newId(),
        settings: { name: 'Sales', strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'owner' },
        members: [member(w.bea), member(w.priya)],
      },
      NOW,
    );
    await updateRotation(
      admin,
      { rotationId: rotation.id, settings: {}, members: [member(w.priya), member(w.bo)] },
      NOW,
    );
    const rows = await w.audits('rotation.changed');
    expect(rows.map((row) => row.after)).toEqual([
      { name: 'Sales', added: [w.bea, w.priya], removed: [] },
      { name: 'Sales', added: [w.bo], removed: [w.bea] },
    ]);
    const system = systemScope(db, w.workspaceId);
    // Bea was added and removed in one window: nothing to tell. Bo was added.
    expect(await runSchedulingNotice(system, { actorMemberId: w.owner, memberId: w.bea })).toBe('nothing');
    expect(await runSchedulingNotice(system, { actorMemberId: w.owner, memberId: w.bo })).toBe('queued');
    const [email] = await testQuery<{ params: { lines: string[] } }>(
      ownerUrl,
      `select params from emails where workspace_id = $1 and kind = 'scheduling_changed' and to_member_id = $2`,
      [w.workspaceId, w.bo],
    );
    expect(email?.params.lines).toEqual(['Added to the Sales rotation']);
  });
});

describe('the notice lines (pure)', () => {
  const side = (fields: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    memberId: 'm',
    pageId: 'p1',
    title: 'Intro call',
    fields,
    ...extra,
  });
  it('words each field, folds a window and says nothing when it cancels out', () => {
    expect(
      pageLines([
        { before: side({ durations: [30] }), after: side({ durations: [30, 60] }) },
        { before: side({ status: 'live' }), after: side({ status: 'paused' }) },
        { before: side({ isPrivate: false }), after: side({ isPrivate: true }) },
      ]),
    ).toEqual([
      'Intro call: length changed from 30 min to 30 or 60 min',
      'Intro call: turned off',
      'Intro call: now Link only',
    ]);
    expect(
      pageLines([
        { before: side({ bufferBefore: 0 }), after: side({ bufferBefore: 15 }) },
        { before: side({ bufferBefore: 15 }), after: side({ bufferBefore: 0 }) },
      ]),
    ).toEqual([]);
    expect(
      pageLines([
        { before: side({ title: 'Intro call' }), after: side({ title: 'First chat' }, { title: 'First chat' }) },
      ]),
    ).toEqual(['Page renamed: Intro call to First chat']);
    expect(pageLines([{ before: side({}), after: side({}, { deleted: true }) }])).toEqual(['Intro call: page deleted']);
  });

  it('tells a rotation’s net change only', () => {
    const row = (added: string[], removed: string[]) => ({ targetId: 'r1', after: { name: 'Sales', added, removed } });
    expect(rotationLines('m', [row(['m'], [])])).toEqual(['Added to the Sales rotation']);
    expect(rotationLines('m', [row([], ['m'])])).toEqual(['Removed from the Sales rotation']);
    expect(rotationLines('m', [row(['m'], []), row([], ['m'])])).toEqual([]);
    expect(rotationLines('m', [row(['x'], [])])).toEqual([]);
  });

  it('keeps only the fields that changed, never a location’s address or a question’s text', () => {
    const page = {
      title: 'Intro call',
      status: 'live',
      durations: [30],
      location: { type: 'address', value: '1 Main St' },
      scheduleId: null,
      scheduleName: 'Working hours',
      bufferBefore: 0,
      bufferAfter: 0,
      minNoticeMinutes: 0,
      windowDays: 60,
      dailyLimit: null,
      slotStep: null,
      isPrivate: false,
      description: '',
      questions: [],
      rescheduleHost: 'same',
      defaultView: 'month',
      fileToCrm: true,
      answersObjectId: null,
    } as unknown as PageAudited;
    expect(pageAuditSides('m', 'p', page, page)).toBeUndefined();
    const sides = pageAuditSides('m', 'p', page, {
      ...page,
      location: { type: 'address', value: '2 Main St' },
      questions: [{}],
    } as unknown as PageAudited);
    expect(sides?.after.fields).toEqual({ questions: 1 });
  });
});
