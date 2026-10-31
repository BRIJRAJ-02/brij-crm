// The guest role (spec 0031, slice 9, AC-828, AC-829; spec 0037, AC-1432), against a real Postgres as the app role:
// a member made a guest leaves scheduling in the role change's own transaction, the confirm's counts say so
// beforehand, a guest takes no seat, reads nobody's address, and can't be put back into a rotation.
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { defaultAvailability, PERMISSIONS } from '@crm/contracts';
import { createDatabase } from '@crm/db';
import { saveDefaultHours } from '../availability/schedules.ts';
import { audiences } from '../access/audiences.ts';
import { systemScope } from '../access/door.ts';
import { createBookingPage, updateBookingPage } from '../booking/pages.ts';
import { newId } from '../engine/ids.ts';
import { createRotation, updateRotation } from '../rotation/rotations.ts';
import { grantDelegation } from '../scheduling/delegations.ts';
import { createTask, listTasks } from '../tasks/tasks.ts';
import { jobTestKit, refusalOf } from '../../test/jobs-kit.ts';
import { inviteMembers, setInviteLink } from './invitations.ts';
import { listMembers, previewGuest, setMemberRole } from './members.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
const db = createDatabase({ url: appUrl, applicationName: 'crm-guest-tests' });
afterAll(async () => {
  await db.close();
});

const { team } = jobTestKit(db, ownerUrl);
const NOW = new Date('2026-11-01T00:00:00.000Z');

/** Ada (owner) with Gus and Hal (members, both with hours), and a round robin of the two. */
async function world() {
  const t = await team(['member', 'member']);
  const [gus = '', hal = ''] = t.ids;
  const gusScope = t.as(gus, 'member');
  const halScope = t.as(hal, 'member');
  const read = async <T extends Record<string, unknown>>(statement: ReturnType<typeof sql>) =>
    db.withWorkspace(t.workspaceId, async (tx) => (await tx.execute<T>(statement)).rows);
  for (const scope of [gusScope, halScope]) await saveDefaultHours(scope, { availability: defaultAvailability('UTC') });
  const seat = (memberId: string) => ({
    memberId,
    weight: 100,
    priority: 2,
    dailyCap: null,
    weeklyCap: null,
    isOn: true,
  });
  const rotation = await createRotation(t.owner, {
    id: newId(),
    settings: { name: 'Sales', strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'owner' },
    members: [seat(gus), seat(hal)],
  });
  return { ...t, gus, hal, gusScope, halScope, read, seat, rotation };
}

describe('making a member a guest (AC-1432)', () => {
  it('counts what stops, then takes them off their pages, rotations and delegations in the one change', async () => {
    const w = await world();
    // Gus's own page, which nobody else hosts, and a delegation over him to Hal.
    await createBookingPage(w.gusScope, { id: newId(), title: 'Intro', timeZone: 'UTC' }, NOW);
    await grantDelegation(w.gusScope, {
      delegateMemberId: w.hal,
      target: { type: 'member', memberId: w.gus },
      level: 'manage',
    });
    expect(await previewGuest(w.owner, { memberId: w.gus })).toEqual({
      pausedPages: 1,
      rotations: 1,
      upcomingBookings: 0,
      delegations: 1,
    });
    // Only a holder of members.manage asks, before anything is read.
    expect(await refusalOf(previewGuest(w.halScope, { memberId: w.gus }))).toEqual({
      code: 'FORBIDDEN',
      message: PERMISSIONS['members.manage'].message,
    });

    expect(await setMemberRole(w.owner, { memberId: w.gus, role: 'guest' })).toMatchObject({
      id: w.gus,
      role: 'guest',
    });
    expect(await w.read(sql`select role::text as role from members where id = ${w.gus}::uuid`)).toEqual([
      { role: 'guest' },
    ]);
    expect(await w.read(sql`select title, status::text as status from booking_pages where title = 'Intro'`)).toEqual([
      { title: 'Intro', status: 'paused' },
    ]);
    expect(await w.read(sql`select member_id::text as id from rotation_members order by member_id`)).toEqual([
      { id: w.hal },
    ]);
    expect(await w.read(sql`select id from schedule_delegations`)).toEqual([]);
    // Nothing is left to count.
    expect(await previewGuest(w.owner, { memberId: w.gus })).toEqual({
      pausedPages: 0,
      rotations: 0,
      upcomingBookings: 0,
      delegations: 0,
    });
  });

  it('refuses a guest back into a rotation, MEMBER_INVALID', async () => {
    const w = await world();
    await setMemberRole(w.owner, { memberId: w.gus, role: 'guest' });
    expect(
      await refusalOf(
        updateRotation(w.owner, { rotationId: w.rotation.id, settings: {}, members: [w.seat(w.hal), w.seat(w.gus)] }),
      ),
    ).toMatchObject({ code: 'MEMBER_INVALID', message: 'Guests can’t take bookings.' });
    expect(
      await refusalOf(
        createRotation(w.owner, {
          id: newId(),
          settings: { name: 'Guests', strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'owner' },
          members: [w.seat(w.gus)],
        }),
      ),
    ).toMatchObject({ code: 'MEMBER_INVALID' });
  });
});

describe('a guest reading the workspace (AC-829)', () => {
  it('gets names and roles, nobody’s address, and finds no one by an address', async () => {
    const w = await world();
    await setMemberRole(w.owner, { memberId: w.gus, role: 'guest' });
    const guest = w.as(w.gus, 'guest');
    const page = await listMembers(guest);
    expect(page.members.length).toBe(3);
    for (const member of page.members) expect(member).not.toHaveProperty('email');
    // A search by address finds nothing for a guest, so no address is guessed a letter at a time.
    expect((await listMembers(guest, { search: 'ada@' })).members).toEqual([]);
    expect((await listMembers(guest, { search: 'Ada' })).members.map((each) => each.name)).toEqual(['Ada']);
    // Everyone else still reads addresses.
    expect((await listMembers(w.owner)).members.every((member) => member.email !== undefined)).toBe(true);
  });

  it('sees no task that links nothing unless it is theirs', async () => {
    const w = await world();
    await setMemberRole(w.owner, { memberId: w.gus, role: 'guest' });
    const guest = w.as(w.gus, 'guest');
    await createTask(w.owner, { id: newId(), title: 'Team task' });
    const theirs = await createTask(w.owner, { id: newId(), title: 'For Gus', assigneeMemberId: w.gus });
    const seen = await listTasks(guest, { scope: { mine: 'all' }, status: 'open' });
    expect(seen.items.map((task) => task.id)).toEqual([theirs.id]);
  });

  it('refuses invitations, join requests and team changes FORBIDDEN', async () => {
    const w = await world();
    await setMemberRole(w.owner, { memberId: w.gus, role: 'guest' });
    const guest = w.as(w.gus, 'guest');
    expect(await refusalOf(inviteMembers(guest, { emails: ['x@example.com'], role: 'guest' }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await refusalOf(setMemberRole(guest, { memberId: w.hal, role: 'guest' }))).toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('seats (AC-809)', () => {
  it('takes none for a guest invitation, and one to make a guest a member again', async () => {
    const w = await world();
    // Ada, Gus and Hal hold three seats, and the plan has three.
    const full = w.as(w.ownerId, 'owner', { seats: 3 });
    expect(await refusalOf(inviteMembers(full, { emails: ['m@example.com'], role: 'member' }))).toMatchObject({
      code: 'SEAT_LIMIT',
    });
    expect((await inviteMembers(full, { emails: ['g@example.com'], role: 'guest' })).sent).toHaveLength(1);
    // Gus as a guest frees his seat; back to member he needs one, and has it.
    await setMemberRole(full, { memberId: w.gus, role: 'guest' });
    expect((await inviteMembers(full, { emails: ['n@example.com'], role: 'member' })).sent).toHaveLength(1);
    expect(await refusalOf(setMemberRole(full, { memberId: w.gus, role: 'member' }))).toMatchObject({
      code: 'SEAT_LIMIT',
    });
  });
});

describe('what a guest can never be or do (spec 0031, slice 9)', () => {
  it('is never a delegate, nor delegated over, and reaches nobody', async () => {
    const w = await world();
    await setMemberRole(w.owner, { memberId: w.gus, role: 'guest' });
    expect(
      await refusalOf(
        grantDelegation(w.owner, { delegateMemberId: w.gus, target: { type: 'everyone' }, level: 'view' }),
      ),
    ).toMatchObject({ code: 'DELEGATE_INVALID' });
    expect(
      await refusalOf(
        grantDelegation(w.owner, {
          delegateMemberId: w.hal,
          target: { type: 'member', memberId: w.gus },
          level: 'manage',
        }),
      ),
    ).toMatchObject({ code: 'DELEGATE_INVALID' });
  });

  it('can’t have a page of theirs turned back on, until they are a member again', async () => {
    const w = await world();
    const page = await createBookingPage(w.gusScope, { id: newId(), title: 'Intro', timeZone: 'UTC' }, NOW);
    await setMemberRole(w.owner, { memberId: w.gus, role: 'guest' });
    expect(
      await refusalOf(updateBookingPage(w.owner, { pageId: page.id, settings: { status: 'live' } }, NOW)),
    ).toMatchObject({ code: 'MEMBER_INVALID' });
    await setMemberRole(w.owner, { memberId: w.gus, role: 'member' });
    expect(await updateBookingPage(w.owner, { pageId: page.id, settings: { status: 'live' } }, NOW)).toMatchObject({
      status: 'live',
    });
  });

  it('keeps tasks for themselves only', async () => {
    const w = await world();
    await setMemberRole(w.owner, { memberId: w.gus, role: 'guest' });
    const guest = w.as(w.gus, 'guest');
    expect(
      await refusalOf(createTask(guest, { id: newId(), title: 'Ping Hal', assigneeMemberId: w.hal })),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(await createTask(guest, { id: newId(), title: 'Mine', assigneeMemberId: w.gus })).toMatchObject({
      title: 'Mine',
    });
  });

  it('hears live changes on an audience of their own, apart from the members’ (spec 0007, milestone 4)', async () => {
    const w = await world();
    await setMemberRole(w.owner, { memberId: w.gus, role: 'guest' });
    const groups = await audiences(systemScope(db, w.workspaceId));
    const theirs = groups.find((group) => group.members.some((member) => member.memberId === w.gus));
    expect(theirs?.members.map((member) => member.memberId)).toEqual([w.gus]);
    expect(theirs?.policy.defaultObject).toBe('none');
  });

  it('keeps a guest invite link a guest one when only its expiry changes', async () => {
    const w = await world();
    expect(await setInviteLink(w.owner, { enabled: true, role: 'guest' })).toMatchObject({ role: 'guest' });
    expect(await setInviteLink(w.owner, { enabled: true, expiresInDays: 7 })).toMatchObject({ role: 'guest' });
    expect(await setInviteLink(w.owner, { enabled: true, role: 'member' })).toMatchObject({ role: 'member' });
  });
});
