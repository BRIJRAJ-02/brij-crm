// Rotations that follow a team (spec 0037, AC-1327, AC-1442; lane L3b), against the real Postgres: a rotation
// following Sales lists Sales's active non guest members as they come and go, with nothing written to it when the team
// changes but a leaver's own settings deleted; a new hire is bookable at once and starts at the pool's average; a 25th
// member joins with no refusal; a leaver drops out and, rejoining, starts afresh at the pool's average; fewer than 2
// people offer no times; only booking.admin makes a rotation follow a team; a team a rotation follows can't be deleted
// (TEAM_IN_USE); the roster never reads across workspaces; and 30 parallel bookings across two pages sharing members
// of a 50 member following rotation never deadlock (AC-1431, run again here).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { defaultAvailability, type PublicBookInput, type RotationSettings } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterBookingPage } from '../access/door.ts';
import type { EngineScope } from '../access/mint.ts';
import { saveDefaultHours } from '../availability/schedules.ts';
import type { BookingCalendar } from '../booking/calendar.ts';
import { createBookingPage } from '../booking/pages.ts';
import { bookPublicSlot, readPublicSlots } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { changeTeamMembers, createTeam, deleteTeam } from '../teams/teams.ts';
import { rescope, testScope } from '../testing.ts';
import { createRotation, deleteRotation, listRotations, updateRotation } from './rotations.ts';

const { appUrl } = inject('testDatabase');
const LINK_KEY = Buffer.alloc(32, 5);
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-follow-team-tests' });
});
afterAll(async () => {
  await db.close();
});

/** Sunday 1 November 2026, midnight UTC. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const MONDAY = '2026-11-02';
const at = (time: string) => `${MONDAY}T${time}:00.000Z`;

const calendar: BookingCalendar = {
  busy: () => Promise.resolve({ status: 'none' }),
  events: () => Promise.resolve({ meetingId: newId() }),
};
const deps = { calendar, now: () => NOW, linkKey: LINK_KEY };

const SETTINGS: RotationSettings = { name: 'Sales', strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'none' };

let made = 0;
/** A workspace whose owner is Ada, and a way to add members with weekday hours `from` to `to` UTC (or none). */
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Acme',
    slug: `follow-team-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Admin', email: 'ada@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const addMember = async (
    name: string,
    options: { from?: string; to?: string; hours?: boolean; role?: 'admin' | 'member' | 'guest' } = {},
  ) => {
    const id = newId();
    const role = options.role ?? 'member';
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${name.toLowerCase().replace(/ /g, '.')}-${id.slice(-6)}@acme.example`}, ${role}, 'system', 'system')`,
      ),
    );
    const scope = rescope(owner, { actor: { type: 'member', id }, role: role === 'guest' ? 'member' : role });
    if (options.hours !== false && role !== 'guest') {
      const range: [string, string] = [options.from ?? '09:00', options.to ?? '17:00'];
      await saveDefaultHours(scope, {
        availability: {
          ...defaultAvailability('UTC'),
          weekly: { mon: [range], tue: [range], wed: [range], thu: [range], fri: [range], sat: [], sun: [] },
        },
      });
    }
    return { id, scope };
  };
  return { ...created, owner, addMember };
}

type World = Awaited<ReturnType<typeof workspace>>;

/** A team called `name` holding `memberIds`. */
const team = (w: World, name: string, memberIds: readonly string[]) =>
  createTeam(w.owner, { id: newId(), name, memberIds: [...memberIds] });

/** A rotation following `teamId`, and a live round robin page booking from it. */
async function following(w: World, teamId: string, name = 'Sales') {
  const rotation = await createRotation(
    w.owner,
    { id: newId(), settings: { ...SETTINGS, name }, followsTeamId: teamId },
    NOW,
  );
  const page = await createBookingPage(
    w.owner,
    {
      id: newId(),
      title: `${name} demo`,
      timeZone: 'UTC',
      kind: 'round_robin',
      hosts: { fixed: [], rotations: [rotation.id] },
    },
    NOW,
  );
  return { rotation, page, entry: await enterBookingPage({ db }, page.publicKey) };
}

let visitors = 0;
const bookInput = (start: string): PublicBookInput => {
  visitors += 1;
  return {
    idempotencyKey: newId(),
    start,
    duration: 30,
    name: `Visitor ${String(visitors)}`,
    email: `visitor-${String(visitors)}@client${String(visitors)}.example`,
    timeZone: 'UTC',
  };
};

const mondaySlots = (entry: Awaited<ReturnType<typeof enterBookingPage>>) =>
  readPublicSlots(entry, deps, {
    from: `${MONDAY}T00:00:00.000Z`,
    to: '2026-11-03T00:00:00.000Z',
    duration: 30,
    tz: 'UTC',
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

/** The rotation as `scope` lists it. */
async function viewOf(scope: EngineScope, rotationId: string) {
  const found = (await listRotations(scope, NOW)).find((rotation) => rotation.id === rotationId);
  if (found === undefined) throw new Error('The rotation is not listed.');
  return found;
}

/** Every stored settings row of the rotation, by member. */
async function storedRows(w: World, rotationId: string) {
  const rows = await db.withWorkspace(w.workspaceId, (tx) =>
    tx.execute<{ member_id: string; weight: number }>(
      sql`select member_id::text, weight from rotation_members where rotation_id = ${rotationId}::uuid order by member_id`,
    ),
  );
  return rows.rows;
}

/** The host of each booking. */
async function hostOf(w: World, bookingId: string) {
  const rows = await db.withWorkspace(w.workspaceId, (tx) =>
    tx.execute<{ host: string }>(sql`select host_member_id::text as host from bookings where id = ${bookingId}::uuid`),
  );
  return rows.rows[0]?.host;
}

describe('a rotation that follows a team (AC-1327)', () => {
  it('lists the team’s active members who aren’t guests, as the team stands', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const gus = await w.addMember('Gus Guest', { role: 'guest' });
    const out = await w.addMember('Olive Other');
    const sales = await team(w, 'Sales', [sam.id, kim.id, gus.id]);
    const { rotation } = await following(w, sales.id);
    expect(rotation).toMatchObject({ follows: 'team', followsTeamId: sales.id, followsTeamName: 'Sales' });
    expect(rotation.members.map((member) => member.memberId).sort()).toEqual([kim.id, sam.id].sort());
    expect(rotation.members.every((member) => member.isOn && member.weight === 100 && member.priority === 2)).toBe(
      true,
    );
    expect(rotation.members.map((member) => member.memberId)).not.toContain(out.id);
    // Nothing is stored for it until it gives out work.
    expect(await storedRows(w, rotation.id)).toEqual([]);
  });

  it('switches someone with neither hours nor a calendar off, and on once they set hours', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const new1 = await w.addMember('Nia New', { hours: false });
    const sales = await team(w, 'Sales', [sam.id, kim.id, new1.id]);
    const { rotation } = await following(w, sales.id);
    expect(rotation.members.find((member) => member.memberId === new1.id)?.isOn).toBe(false);
    await saveDefaultHours(new1.scope, { availability: defaultAvailability('UTC') });
    expect((await viewOf(w.owner, rotation.id)).members.find((member) => member.memberId === new1.id)?.isOn).toBe(true);
  });

  it('keeps each member’s own settings, editable per member, without anyone joining or leaving by a save', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const sales = await team(w, 'Sales', [sam.id, kim.id]);
    const { rotation } = await following(w, sales.id);
    const saved = await updateRotation(
      w.owner,
      {
        rotationId: rotation.id,
        settings: {},
        members: [{ memberId: kim.id, weight: 50, priority: 4, dailyCap: 3, weeklyCap: null, isOn: true }],
      },
      NOW,
    );
    expect(saved.members).toHaveLength(2);
    expect(saved.members.find((member) => member.memberId === kim.id)).toMatchObject({
      weight: 50,
      priority: 4,
      dailyCap: 3,
    });
  });

  it('offers no times once left with fewer than 2 people, nothing refusing the change, and times again at 2', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const sales = await team(w, 'Sales', [sam.id, kim.id]);
    const { entry } = await following(w, sales.id);
    expect((await mondaySlots(entry)).slots.length).toBeGreaterThan(0);
    await changeTeamMembers(w.owner, { teamId: sales.id, remove: [kim.id] });
    expect((await mondaySlots(entry)).slots).toEqual([]);
    await changeTeamMembers(w.owner, { teamId: sales.id, add: [kim.id] });
    expect((await mondaySlots(entry)).slots.length).toBeGreaterThan(0);
  });

  it('lets only booking.admin make a rotation follow a team', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const sales = await team(w, 'Sales', [sam.id, kim.id]);
    const member = rescope(w.owner, { actor: { type: 'member', id: sam.id }, role: 'member' });
    expect(
      await refusalOf(createRotation(member, { id: newId(), settings: SETTINGS, followsTeamId: sales.id }, NOW)),
    ).toMatchObject({ code: 'FORBIDDEN' });
    const chosen = await createRotation(
      w.owner,
      {
        id: newId(),
        settings: SETTINGS,
        members: [sam.id, kim.id].map((memberId) => ({
          memberId,
          weight: 100,
          priority: 2,
          dailyCap: null,
          weeklyCap: null,
          isOn: true,
        })),
      },
      NOW,
    );
    // Sam is in it, so he sees it, and is refused; nobody follows a team without booking.admin.
    expect(
      await refusalOf(updateRotation(member, { rotationId: chosen.id, settings: {}, followsTeamId: sales.id }, NOW)),
    ).toMatchObject({ code: 'FORBIDDEN' });
    // A team that isn't there is refused on its field.
    expect(
      await refusalOf(createRotation(w.owner, { id: newId(), settings: SETTINGS, followsTeamId: newId() }, NOW)),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'followsTeamId' });
  });

  it('turns a rotation of chosen people into one following a team, and back, keeping the stayers’ settings', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const lee = await w.addMember('Lee Out');
    const sales = await team(w, 'Sales', [sam.id, kim.id]);
    const chosen = await createRotation(
      w.owner,
      {
        id: newId(),
        settings: SETTINGS,
        members: [sam.id, lee.id].map((memberId) => ({
          memberId,
          weight: memberId === sam.id ? 40 : 100,
          priority: 2,
          dailyCap: null,
          weeklyCap: null,
          isOn: true,
        })),
      },
      NOW,
    );
    const followed = await updateRotation(
      w.owner,
      { rotationId: chosen.id, settings: {}, followsTeamId: sales.id },
      NOW,
    );
    expect(followed.follows).toBe('team');
    expect(followed.members.map((member) => member.memberId).sort()).toEqual([kim.id, sam.id].sort());
    expect(followed.members.find((member) => member.memberId === sam.id)?.weight).toBe(40);
    // Lee left it with the switch: his settings for it went.
    expect((await storedRows(w, chosen.id)).map((row) => row.member_id)).toEqual([sam.id]);
    // Back to chosen people needs the people.
    expect(
      await refusalOf(updateRotation(w.owner, { rotationId: chosen.id, settings: {}, followsTeamId: null }, NOW)),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'members' });
    const back = await updateRotation(
      w.owner,
      {
        rotationId: chosen.id,
        settings: {},
        followsTeamId: null,
        members: followed.members.map((member) => ({
          memberId: member.memberId,
          weight: member.weight,
          priority: member.priority,
          dailyCap: member.dailyCap,
          weeklyCap: member.weeklyCap,
          isOn: member.isOn,
        })),
      },
      NOW,
    );
    expect(back.follows).toBeUndefined();
    expect(back.members.find((member) => member.memberId === sam.id)?.weight).toBe(40);
    // Now chosen, a team change no longer moves it.
    const nia = await w.addMember('Nia New');
    await changeTeamMembers(w.owner, { teamId: sales.id, add: [nia.id] });
    expect((await viewOf(w.owner, chosen.id)).members).toHaveLength(2);
  });

  it('never reads another workspace’s team or members', async () => {
    const w = await workspace();
    const other = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const sales = await team(w, 'Sales', [sam.id, kim.id]);
    const { rotation } = await following(w, sales.id);
    expect(await listRotations(other.owner, NOW)).toEqual([]);
    expect(
      await refusalOf(createRotation(other.owner, { id: newId(), settings: SETTINGS, followsTeamId: sales.id }, NOW)),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'followsTeamId' });
    // Even with the workspace filter removed, the view reads only the reader's own workspace.
    const seen = await db.withWorkspace(other.workspaceId, (tx) =>
      tx.execute(sql`select 1 from rotation_roster where rotation_id = ${rotation.id}::uuid`),
    );
    expect(seen.rows).toEqual([]);
  });
});

describe('a team change moves a following rotation with no write but a leaver’s (AC-1442)', () => {
  it('books a new hire at once, at the pool’s average, with nothing written to the rotation', async () => {
    const w = await workspace();
    // Sam and Kim work mornings only; the new hire works afternoons.
    const sam = await w.addMember('Sam Lee', { to: '12:00' });
    const kim = await w.addMember('Kim Park', { to: '12:00' });
    const sales = await team(w, 'Sales', [sam.id, kim.id]);
    const { rotation, entry } = await following(w, sales.id);
    for (const time of ['09:00', '09:30', '10:00', '10:30']) await bookPublicSlot(entry, deps, bookInput(at(time)));
    const before = await storedRows(w, rotation.id);
    expect(before).toHaveLength(2);
    const nia = await w.addMember('Nia New', { from: '13:00' });
    await changeTeamMembers(w.owner, { teamId: sales.id, add: [nia.id] });
    // No write to the rotation: the same two rows, and Nia listed at the average of 2.
    expect(await storedRows(w, rotation.id)).toEqual(before);
    const listed = (await viewOf(w.owner, rotation.id)).members.find((member) => member.memberId === nia.id);
    expect(listed).toMatchObject({ isOn: true, weight: 100, count: 2 });
    // The next booking, in the afternoon, goes to her.
    const booked = await bookPublicSlot(entry, deps, bookInput(at('14:00')));
    expect(await hostOf(w, booked.bookingId)).toBe(nia.id);
  });

  it('takes a 25th member with no refusal', async () => {
    const w = await workspace();
    const people = await Promise.all(Array.from({ length: 24 }, (_, index) => w.addMember(`Member ${String(index)}`)));
    const sales = await team(
      w,
      'Sales',
      people.map((person) => person.id),
    );
    const { rotation } = await following(w, sales.id);
    const late = await w.addMember('Member 24');
    await changeTeamMembers(w.owner, { teamId: sales.id, add: [late.id] });
    expect((await viewOf(w.owner, rotation.id)).members).toHaveLength(25);
  });

  it('drops a leaver at once, deletes their settings, and starts a rejoiner at the pool’s average', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const lee = await w.addMember('Lee Leaver');
    const sales = await team(w, 'Sales', [sam.id, kim.id, lee.id]);
    const { rotation, entry } = await following(w, sales.id);
    await updateRotation(
      w.owner,
      {
        rotationId: rotation.id,
        settings: {},
        members: [{ memberId: lee.id, weight: 20, priority: 0, dailyCap: null, weeklyCap: null, isOn: true }],
      },
      NOW,
    );
    for (const time of ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']) {
      await bookPublicSlot(entry, deps, bookInput(at(time)));
    }
    await changeTeamMembers(w.owner, { teamId: sales.id, remove: [lee.id] });
    const after = await viewOf(w.owner, rotation.id);
    expect(after.members.map((member) => member.memberId)).not.toContain(lee.id);
    expect((await storedRows(w, rotation.id)).map((row) => row.member_id)).not.toContain(lee.id);
    // Their bookings stay theirs.
    const kept = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`select 1 from bookings where host_member_id = ${lee.id}::uuid`),
    );
    expect(kept.rows.length).toBeGreaterThan(0);
    // Back in Sales: weight 100 again, counted from the others' average, not from 0 and not from their old count.
    await changeTeamMembers(w.owner, { teamId: sales.id, add: [lee.id] });
    const rejoined = await viewOf(w.owner, rotation.id);
    const others = rejoined.members.filter((member) => member.memberId !== lee.id);
    const average = others.reduce((sum, member) => sum + (member.count ?? 0), 0) / others.length;
    expect(rejoined.members.find((member) => member.memberId === lee.id)).toMatchObject({
      weight: 100,
      priority: 2,
      count: average,
    });
  });
});

describe('a team a rotation follows (AC-826 as widened)', () => {
  it('can’t be deleted while followed, and can once the rotation is gone', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const sales = await team(w, 'Sales', [sam.id, kim.id]);
    const rotation = await createRotation(
      w.owner,
      { id: newId(), settings: { ...SETTINGS, name: 'Inbound' }, followsTeamId: sales.id },
      NOW,
    );
    expect(await refusalOf(deleteTeam(w.owner, { teamId: sales.id }))).toMatchObject({
      code: 'TEAM_IN_USE',
      message: 'Sales is followed by Inbound. Change them first.',
    });
    await deleteRotation(w.owner, { rotationId: rotation.id });
    await deleteTeam(w.owner, { teamId: sales.id });
  });
});

describe('the race with a 50 member rotation that follows a team (AC-1431, run again by L3b)', () => {
  it('serialises 30 parallel bookings on two pages sharing members, with no deadlock and no double booking', async () => {
    const w = await workspace();
    const people: { readonly id: string }[] = [];
    for (let start = 0; start < 50; start += 10) {
      people.push(
        ...(await Promise.all(
          Array.from({ length: 10 }, (_, index) => w.addMember(`Rep ${String(start + index)}`, { to: '10:00' })),
        )),
      );
    }
    const ids = people.map((person) => person.id);
    const sales = await team(w, 'Sales', ids);
    const first = await following(w, sales.id, 'Inbound');
    // A rotation of chosen people sharing members with the following one.
    const shared = await createRotation(
      w.owner,
      {
        id: newId(),
        settings: { ...SETTINGS, name: 'Partners' },
        members: ids.slice(0, 5).map((memberId) => ({
          memberId,
          weight: 100,
          priority: 2,
          dailyCap: null,
          weeklyCap: null,
          isOn: true,
        })),
      },
      NOW,
    );
    const second = await createBookingPage(
      w.owner,
      {
        id: newId(),
        title: 'Partner call',
        timeZone: 'UTC',
        kind: 'round_robin',
        hosts: { fixed: [], rotations: [shared.id, first.rotation.id] },
      },
      NOW,
    );
    const secondEntry = await enterBookingPage({ db }, second.publicKey);
    const times = ['09:00', '09:30'];
    const settled = await Promise.allSettled(
      Array.from({ length: 30 }, (_, index) =>
        bookPublicSlot(
          index % 2 === 0 ? first.entry : secondEntry,
          deps,
          bookInput(at(times[index % times.length] ?? '09:00')),
        ),
      ),
    );
    // Every refusal is a taken time, never a deadlock (40P01) or anything else.
    for (const each of settled) {
      if (each.status === 'rejected') expect(isRefusal(each.reason) && each.reason.refusal.code).toBe('SLOT_TAKEN');
    }
    expect(settled.filter((each) => each.status === 'fulfilled').length).toBeGreaterThan(8);
    const overlaps = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`
        select 1 from booking_hosts a join booking_hosts b on a.member_id = b.member_id and a.booking_id < b.booking_id
        where a.status = 'confirmed' and b.status = 'confirmed' and a.during && b.during`),
    );
    expect(overlaps.rows).toEqual([]);
  }, 120_000);
});
