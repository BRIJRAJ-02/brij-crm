// The workspace booking link (team scheduling brief, decision 3, 30 Oct
// 2026), against the real Postgres: a round robin page that belongs to the
// workspace and books "Everyone on the roster", whose members follow the
// workspace (a new member at once, a removed member or a guest never, someone
// switched off kept off); only booking.admin makes and manages it; its maker
// leaving pauses nothing; it is on nobody's profile or address; its public
// link books as any page's does; and the roster never reads across workspaces.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { defaultAvailability, type PublicBookInput } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingPage } from '../access/door.ts';
import { saveDefaultHours } from '../availability/schedules.ts';
import type { BookingCalendar } from '../booking/calendar.ts';
import {
  createBookingPage,
  deleteBookingPage,
  listBookingPages,
  listBookings,
  updateBookingPage,
} from '../booking/pages.ts';
import { readPageDestination, setPageDestination } from '../calendar/page-destination.ts';
import { bookPublicSlot, getPublicBookingPage, readPublicSlots } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { removeMember } from '../members/members.ts';
import { rescope, testScope } from '../testing.ts';
import { listRotations, updateRotation } from './rotations.ts';
import { EVERYONE_ROTATION_NAME } from './roster.ts';
import { ROTATION_ROLES } from './team.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
const LINK_KEY = Buffer.alloc(32, 9);
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-workspace-link-tests' });
});
afterAll(async () => {
  await db.close();
});

/** Sunday 1 November 2026, midnight UTC. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const at = (time: string) => `2026-11-02T${time}:00.000Z`;

const calendar: BookingCalendar = {
  busy: () => Promise.resolve({ status: 'none' }),
  events: () => Promise.resolve({ meetingId: newId() }),
};
const deps = { calendar, now: () => NOW, linkKey: LINK_KEY };

let made = 0;
/** A workspace whose owner, Ada, can sign in (so she has a handle's identity), and a way to add members. */
async function workspace() {
  made += 1;
  const userId = randomUUID();
  await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, $2, $3)`, [
    userId,
    'Ada Admin',
    `${userId}@example.com`,
  ]);
  const created = await createWorkspace(db, {
    name: 'Acme',
    slug: `wslink-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Admin', email: `${userId}@example.com`, userId },
  });
  const owner = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    userId,
  });
  // Ada works mornings only, so the afternoon belongs to whoever else is on.
  await saveDefaultHours(owner, { availability: hours('09:00', '12:00') });
  const addMember = async (name: string, role: 'admin' | 'member' = 'member', from = '09:00') => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${name.toLowerCase().replace(/ /g, '.')}-${id.slice(-6)}@acme.example`}, ${role}, 'system', 'system')`,
      ),
    );
    const scope = rescope(owner, { actor: { type: 'member', id }, role });
    await saveDefaultHours(scope, { availability: hours(from, '17:00') });
    return { id, scope };
  };
  return { ...created, userId, owner, addMember };
}

type World = Awaited<ReturnType<typeof workspace>>;

/** Weekdays `from` to `to` UTC. */
function hours(from: string, to: string) {
  const range: [string, string] = [from, to];
  return {
    ...defaultAvailability('UTC'),
    weekly: { mon: [range], tue: [range], wed: [range], thu: [range], fri: [range], sat: [], sun: [] },
  };
}

/** A workspace link made by `scope`: 30 minutes, "Everyone on the roster". */
async function workspaceLink(scope: World['owner'], title = 'Talk to us') {
  const page = await createBookingPage(scope, { id: newId(), title, timeZone: 'UTC', scope: 'workspace' }, NOW);
  return { page, entry: await enterBookingPage({ db }, page.publicKey) };
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

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

/** The host of each booking. */
async function hostOf(w: World, bookingId: string): Promise<string | undefined> {
  const rows = await db.withWorkspace(w.workspaceId, (tx) =>
    tx.execute<{ host: string }>(sql`select host_member_id::text as host from bookings where id = ${bookingId}::uuid`),
  );
  return rows.rows[0]?.host;
}

/** Who is free for 30 minutes from `time` on Monday, as the public page offers it: the start times. */
async function startsOf(entry: Awaited<ReturnType<typeof enterBookingPage>>) {
  const read = await readPublicSlots(entry, deps, {
    from: '2026-11-02T00:00:00.000Z',
    to: '2026-11-03T00:00:00.000Z',
    duration: 30,
    tz: 'UTC',
  });
  return read.slots.map((slot) => slot.start.slice(11, 16));
}

describe('the workspace link: making and managing it', () => {
  it('is made by booking.admin as a round robin page on "Everyone on the roster", and by nobody else', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const { page } = await workspaceLink(w.owner);
    expect(page).toMatchObject({ kind: 'round_robin', scope: 'workspace', ownerMemberId: w.memberId, canChange: true });
    expect(page.handle).toBeUndefined();
    const rotations = await listRotations(w.owner, NOW);
    expect(rotations).toHaveLength(1);
    expect(rotations[0]).toMatchObject({ name: EVERYONE_ROTATION_NAME, follows: 'everyone', pages: 1 });
    expect(page.hosts).toEqual({ fixed: [], rotations: [rotations[0]?.id] });
    // A second link books the same rotation: one fair count for the workspace.
    const second = await workspaceLink(w.owner, 'Support');
    expect(second.page.hosts?.rotations).toEqual([rotations[0]?.id]);
    expect(await refusalOf(workspaceLink(sam.scope))).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('is changed, paused and deleted by booking.admin only, never by its maker once they lose it', async () => {
    const w = await workspace();
    const bea = await w.addMember('Bea Boss', 'admin');
    const sam = await w.addMember('Sam Lee');
    const { page } = await workspaceLink(bea.scope);
    // Bea made it; as a plain member she manages nothing of it, nor lists it as her own.
    const beaDemoted = rescope(bea.scope, { role: 'member' });
    for (const scope of [sam.scope, beaDemoted]) {
      expect(
        await refusalOf(updateBookingPage(scope, { pageId: page.id, settings: { title: 'Mine now' } })),
      ).toMatchObject({ code: 'NOT_FOUND' });
      expect(await refusalOf(deleteBookingPage(scope, { pageId: page.id }))).toMatchObject({ code: 'NOT_FOUND' });
      expect((await listBookingPages(scope, NOW)).map((each) => each.id)).not.toContain(page.id);
      expect(await refusalOf(listBookings(scope, { pageId: page.id, when: 'upcoming' }, NOW))).toMatchObject({
        code: 'NOT_FOUND',
      });
      // Its "Add events to" is no one's to read or set but an admin's, its maker's least of all.
      expect(await refusalOf(readPageDestination(scope, { pageId: page.id }))).toMatchObject({ code: 'NOT_FOUND' });
      expect(await refusalOf(setPageDestination(scope, { pageId: page.id, calendarId: null }))).toMatchObject({
        code: 'NOT_FOUND',
      });
    }
    // An admin reads it, as nobody's own: no owner's calendar to name.
    expect(await readPageDestination(w.owner, { pageId: page.id })).toMatchObject({ isOwner: false });
    // Any admin manages it, its maker or not, and it is listed for them.
    const renamed = await updateBookingPage(w.owner, {
      pageId: page.id,
      settings: { title: 'Book Acme', slug: 'acme' },
    });
    expect(renamed).toMatchObject({ title: 'Book Acme', slug: 'acme' });
    expect((await listBookingPages(w.owner, NOW)).find((each) => each.id === page.id)?.scope).toBe('workspace');
    // Nobody's profile: no place on one, and no social links.
    expect(
      await refusalOf(updateBookingPage(w.owner, { pageId: page.id, settings: { profileSection: 'Team' } })),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'profileSection' });
    // The workspace's addresses are its own: a person's page may hold the same slug.
    const personal = await createBookingPage(
      w.owner,
      { id: newId(), title: 'Mine', timeZone: 'UTC', settings: { slug: 'acme' } },
      NOW,
    );
    expect(personal.slug).toBe('acme');
    expect(
      await refusalOf(
        createBookingPage(
          w.owner,
          { id: newId(), title: 'Other', timeZone: 'UTC', scope: 'workspace', settings: { slug: 'acme' } },
          NOW,
        ),
      ),
    ).toMatchObject({ code: 'SLUG_TAKEN', field: 'slug' });
  });

  it('is never on a profile or a /<handle>/<slug> address', async () => {
    const w = await workspace();
    await w.addMember('Sam Lee');
    const { page } = await workspaceLink(w.owner, 'Talk to us');
    const personal = await createBookingPage(w.owner, { id: newId(), title: 'Intro', timeZone: 'UTC' }, NOW);
    const found = await db.withWorkspace(w.workspaceId, async (tx) => {
      const profile = await tx.execute<{ page_id: string }>(
        sql`select page_id::text from crm_booking_profile_pages(${w.userId}::uuid, ${w.workspaceId}::uuid, null, null, null, 50)`,
      );
      const owned = await tx.execute<{ page_id: string }>(
        sql`select page_id::text from crm_booking_owner_pages(${w.userId}::uuid, ${w.workspaceId}::uuid, null)`,
      );
      const address = await tx.execute<{ page_id: string }>(
        sql`select page_id::text from crm_booking_page_by_address(${w.userId}::uuid, ${w.workspaceId}::uuid, ${page.slug})`,
      );
      const row = await tx.execute<{ owner_user_id: string | null }>(
        sql`select owner_user_id::text from booking_pages where id = ${page.id}::uuid`,
      );
      return { profile, owned, address, ownerUser: row.rows[0]?.owner_user_id };
    });
    expect(found.profile.rows.map((row) => row.page_id)).toEqual([personal.id]);
    expect(found.owned.rows.map((row) => row.page_id)).toEqual([personal.id]);
    expect(found.address.rows).toEqual([]);
    expect(found.ownerUser).toBeNull();
  });
});

describe('the workspace link: who it books', () => {
  it('books across every eligible member round robin, and a new member without editing the page', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const { entry } = await workspaceLink(w.owner);
    // Three visitors at 09:00: Ada, Sam and Kim each take one; then nobody is free at 09:00.
    const hosts = new Set<string | undefined>();
    for (let index = 0; index < 3; index += 1) {
      const booked = await bookPublicSlot(entry, deps, bookInput(at('09:00')));
      hosts.add(await hostOf(w, booked.bookingId));
    }
    expect(hosts).toEqual(new Set([w.memberId, sam.id, kim.id]));
    expect(await startsOf(entry)).not.toContain('09:00');
    // Lee joins the workspace: bookable at once, nothing about the page changed.
    const lee = await w.addMember('Lee Chan');
    expect(await startsOf(entry)).toContain('09:00');
    const fourth = await bookPublicSlot(entry, deps, bookInput(at('09:00')));
    expect(await hostOf(w, fourth.bookingId)).toBe(lee.id);
    const roster = (await listRotations(w.owner, NOW))[0]?.members.map((member) => member.memberId);
    expect(roster).toEqual(expect.arrayContaining([w.memberId, sam.id, kim.id, lee.id]));
  });

  it('takes only the roles that may host, as every rotation does (guests never; unknown roles fail closed)', async () => {
    const view = await testQuery<{ def: string }>(
      ownerUrl,
      `select pg_get_viewdef('rotation_roster'::regclass) as def`,
    );
    const roles = await testQuery<{ role: string }>(
      ownerUrl,
      `select unnest(enum_range(null::member_role))::text as role`,
    );
    const def = view[0]?.def ?? '';
    for (const { role } of roles) expect(def.includes(`'${role}'::text`)).toBe(ROTATION_ROLES.includes(role));
    expect(ROTATION_ROLES).not.toContain('guest');
  });

  it('never books a removed member, or someone switched off', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee', 'member', '13:00');
    const kim = await w.addMember('Kim Park', 'member', '13:00');
    const { entry } = await workspaceLink(w.owner);
    const rotation = (await listRotations(w.owner, NOW))[0];
    // Afternoons are Sam's and Kim's alone (Ada works mornings).
    expect(await startsOf(entry)).toContain('13:00');
    await removeMember(w.owner, { memberId: sam.id });
    await updateRotation(
      w.owner,
      {
        rotationId: rotation?.id ?? '',
        settings: {},
        members: [{ memberId: kim.id, weight: 100, priority: 2, dailyCap: null, weeklyCap: null, isOn: false }],
      },
      NOW,
    );
    // Removed and switched off: nobody is left for the afternoon, though Ada's morning still books.
    const starts = await startsOf(entry);
    expect(starts).not.toContain('13:00');
    expect(starts).toContain('09:00');
    const after = (await listRotations(w.owner, NOW))[0];
    expect(after?.members.map((member) => member.memberId)).not.toContain(sam.id);
    expect(after?.members.find((member) => member.memberId === kim.id)?.isOn).toBe(false);
    // Someone who has left isn't put back by a save naming them (a list read before they left): they are skipped.
    const saved = await updateRotation(w.owner, {
      rotationId: rotation?.id ?? '',
      settings: {},
      members: [{ memberId: sam.id, weight: 100, priority: 2, dailyCap: null, weeklyCap: null, isOn: true }],
    });
    expect(saved.members.map((member) => member.memberId)).not.toContain(sam.id);
  });

  it('stays live when the admin who made it leaves', async () => {
    const w = await workspace();
    const bea = await w.addMember('Bea Boss', 'admin');
    await w.addMember('Sam Lee');
    const { page, entry } = await workspaceLink(bea.scope);
    await removeMember(w.owner, { memberId: bea.id });
    const after = (await listBookingPages(w.owner, NOW)).find((each) => each.id === page.id);
    expect(after).toMatchObject({ status: 'live' });
    expect(after?.pausedReason).toBeUndefined();
    const booked = await bookPublicSlot(entry, deps, bookInput(at('10:00')));
    expect(await hostOf(w, booked.bookingId)).not.toBe(bea.id);
  });

  it('answers its public link as any team page does, naming the workspace and no host', async () => {
    const w = await workspace();
    await w.addMember('Sam Lee');
    const { page, entry } = await workspaceLink(w.owner, 'Talk to us');
    const shown = await getPublicBookingPage(entry);
    expect(shown).toMatchObject({ publicKey: page.publicKey, title: 'Talk to us', hostName: 'Acme' });
    expect(JSON.stringify(shown)).not.toContain('Sam Lee');
  });

  it('a late joiner starts at the pool’s average count, not at zero (spec 0029, AC-730)', async () => {
    const w = await workspace();
    await w.addMember('Sam Lee');
    const { entry } = await workspaceLink(w.owner);
    // Two meetings each for Ada and Sam.
    for (const time of ['09:00', '09:00', '10:00', '10:00']) await bookPublicSlot(entry, deps, bookInput(at(time)));
    const lee = await w.addMember('Lee Chan');
    const roster = (await listRotations(w.owner, NOW))[0];
    expect(roster?.members.find((member) => member.memberId === lee.id)?.count).toBe(2);
  });
});

describe('the roster is the workspace’s own', () => {
  it('reads nothing of another workspace’s roster', async () => {
    const a = await workspace();
    await a.addMember('Sam Lee');
    await workspaceLink(a.owner);
    const b = await workspace();
    const leaked = await db.withWorkspace(b.workspaceId, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from rotation_roster where workspace_id = ${a.workspaceId}::uuid`,
      ),
    );
    expect(leaked.rows[0]?.n).toBe(0);
    const own = await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from rotation_roster`),
    );
    expect(own.rows[0]?.n).toBe(2);
  });
});
