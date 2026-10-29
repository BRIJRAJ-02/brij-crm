// Booking privacy between members (the owner's ask of 29 October 2026: "don't show someone else's booking if
// they're in the same workspace"), against the real Postgres as the app role. A meeting a booking made links to the
// visitor's person; on that person's Meetings tab and timeline only the booking's host, a co-host, its page's owner
// and an admin see it in full, with the visitor's answers. Any other member gets it as a private meeting (its time,
// "Private meeting", nothing else), and the realtime audience's facts say who may see it. A co-host may act on it.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { PRIVATE_MEETING_TITLE } from '@crm/contracts';
import { enterBookingPage } from '../access/door.ts';
import { readMeetingFacts } from '../calendar/facts.ts';
import { addMeetingAttendee } from '../calendar/people.ts';
import { listMeetingsForRecord } from '../calendar/meetings.ts';
import { getActivity } from '../engine/activity.ts';
import { newId } from '../engine/ids.ts';
import { createRecord } from '../engine/records.ts';
import type { EngineScope } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import { NO_CALENDAR } from './calendar.ts';
import { bookingGuestPath } from './change.ts';
import { createBookingPage } from './pages.ts';
import { bookPublicSlot } from './public.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-booking-seen-tests' });
});
afterAll(async () => {
  await db.close();
});

const NOW = new Date('2026-11-01T00:00:00.000Z');
const LINK_KEY = Buffer.alloc(32, 7);

const memberOf = (scope: EngineScope) =>
  scope.access.principal.kind === 'member' ? scope.access.principal.memberId : '';

/**
 * A workspace where Pat owns a page, Hal hosts its booking, Cora co-hosts it, Bo is a plain colleague and Ann an
 * admin; the booking's meeting is on the visitor's person, with an answer to the page's question.
 */
async function world() {
  const created = await createWorkspace(db, {
    name: 'Booking privacy',
    slug: `booking-seen-${newId().slice(-12)}`,
    firstMember: { name: 'Olga Owner', email: 'olga@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const addMember = async (name: string, role: 'admin' | 'member') => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${name}-${id}@example.com`}, ${role}, 'system', 'system')`,
      ),
    );
    return rescope(owner, { actor: { type: 'member', id }, role });
  };
  const pat = await addMember('Pat', 'member');
  const hal = await addMember('Hal', 'member');
  const cora = await addMember('Cora', 'member');
  const bo = await addMember('Bo', 'member');
  const ann = await addMember('Ann', 'admin');

  const page = await createBookingPage(pat, { id: newId(), title: 'Discovery call', timeZone: 'UTC' }, NOW);
  const entry = await enterBookingPage({ db }, page.publicKey);
  const { bookingId } = await bookPublicSlot(
    entry,
    { calendar: NO_CALENDAR, now: () => NOW, linkKey: LINK_KEY },
    {
      idempotencyKey: newId(),
      start: '2026-11-02T09:00:00.000Z',
      duration: 30,
      name: 'Vera Visitor',
      email: 'vera@example.org',
      timeZone: 'Europe/London',
    },
  );

  const objects = await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute<{ id: string; name: string }>(sql`
      select o.id::text as id, a.id::text as name from objects o
      join attributes a on a.workspace_id = o.workspace_id and a.object_id = o.id and a.api_slug = 'name'
      where o.standard_key = 'people'
    `),
  );
  const people = objects.rows[0];
  if (people === undefined) throw new Error('No People object.');
  const person = await createRecord(owner, {
    objectId: people.id,
    values: { [people.name]: { firstName: 'Vera', lastName: 'Visitor' } },
  });

  const meetingId = newId();
  await db.withWorkspace(created.workspaceId, async (tx) => {
    // Hal hosts it (the page is Pat's), Cora co-hosts it.
    await tx.execute(sql`update bookings set host_member_id = ${memberOf(hal)}::uuid where id = ${bookingId}::uuid`);
    await tx.execute(sql`
      insert into booking_hosts (workspace_id, booking_id, member_id, during, status)
      select workspace_id, id, ${memberOf(cora)}::uuid, during, status from bookings where id = ${bookingId}::uuid
    `);
    // The meeting the booking made, on the visitor's person, with a video link, a place and the visitor attending.
    await tx.execute(sql`
      insert into meetings (workspace_id, id, ical_uid, title, starts_at, ends_at, location, video_url, created_by_crm,
        booking_id, created_by_type, updated_by_type)
      values (${created.workspaceId}, ${meetingId}, ${`uid-${meetingId}`}, 'Discovery call with Vera',
        '2026-11-02T09:00:00Z', '2026-11-02T09:30:00Z', 'Room 4', 'https://meet.example/abc', true, ${bookingId}::uuid,
        'system', 'system')
    `);
    await tx.execute(sql`
      insert into meeting_attendees (workspace_id, meeting_id, email, name, position, response, is_organizer,
        person_record_id, match)
      values (${created.workspaceId}, ${meetingId}, 'vera@example.org', 'Vera Visitor', 0, 'accepted', false,
        ${person.recordId}::uuid, 'linked')
    `);
    await tx.execute(sql`
      insert into meeting_records (workspace_id, meeting_id, record_id, via, starts_at)
      values (${created.workspaceId}, ${meetingId}, ${person.recordId}::uuid, 'attendee', '2026-11-02T09:00:00Z')
    `);
    const answers = {
      questions: [
        { questionId: 'q1', key: 'budget', label: 'Budget', answerType: 'short_text', value: 'Forty thousand' },
      ],
    };
    await tx.execute(sql`
      update bookings set meeting_id = ${meetingId}::uuid, answers = ${JSON.stringify(answers)}::jsonb
      where id = ${bookingId}::uuid
    `);
  });
  return {
    owner,
    pat,
    hal,
    cora,
    bo,
    ann,
    bookingId,
    meetingId,
    personId: person.recordId,
    workspaceId: created.workspaceId,
  };
}

describe('a colleague’s booking on the visitor’s record', () => {
  it('shows in full, with its answers, only to its host, co-host, page owner and an admin', async () => {
    const w = await world();
    for (const reader of [w.hal, w.cora, w.pat, w.ann]) {
      const [meeting] = (await listMeetingsForRecord(reader, { recordId: w.personId })).items;
      expect(meeting).toMatchObject({
        id: w.meetingId,
        title: 'Discovery call with Vera',
        detailsHidden: false,
        isPrivate: false,
        location: 'Room 4',
        videoUrl: 'https://meet.example/abc',
        attendees: [expect.objectContaining({ email: 'vera@example.org' })],
      });
      const entry = (await getActivity(reader, { recordId: w.personId })).entries.find(
        (each) => each.kind === 'meeting',
      );
      expect(entry).toMatchObject({ title: 'Discovery call with Vera', answers: [{ label: 'Budget' }] });
    }
  });

  it('reads as a private meeting to any other member: its time alone, no details and no answers', async () => {
    const w = await world();
    const page = await listMeetingsForRecord(w.bo, { recordId: w.personId });
    expect(page.items).toEqual([
      {
        id: w.meetingId,
        title: PRIVATE_MEETING_TITLE,
        startsAt: '2026-11-02T09:00:00.000Z',
        endsAt: '2026-11-02T09:30:00.000Z',
        allDay: false,
        status: 'confirmed',
        isPrivate: true,
        detailsHidden: true,
        attendees: [],
      },
    ]);
    const activity = await getActivity(w.bo, { recordId: w.personId });
    const entry = activity.entries.find((each) => each.kind === 'meeting');
    expect(entry).toMatchObject({ title: PRIVATE_MEETING_TITLE, meeting: { detailsHidden: true } });
    expect(entry).not.toHaveProperty('answers');
    const said = JSON.stringify([page, activity]);
    for (const secret of ['Discovery call with Vera', 'Room 4', 'meet.example', 'vera@example.org', 'Forty thousand']) {
      expect(said).not.toContain(secret);
    }
  });

  it('tells the realtime audience who may see it: host, co-host and page owner (admins by permission)', async () => {
    const w = await world();
    const facts = await db.withWorkspace(w.workspaceId, (tx) => readMeetingFacts(tx, [w.meetingId]));
    expect([...(facts[w.meetingId]?.bookingSeerMemberIds ?? [])].sort()).toEqual(
      [memberOf(w.hal), memberOf(w.cora), memberOf(w.pat)].sort(),
    );
  });

  it('answers a colleague adding one of its attendees as if the meeting weren’t there', async () => {
    const w = await world();
    const input = { recordId: w.personId, meetingId: w.meetingId, email: 'vera@example.org' };
    const options = { isFreeDomain: () => false };
    await expect(addMeetingAttendee(w.bo, input, options)).rejects.toMatchObject({ refusal: { code: 'NOT_FOUND' } });
    // The host gets past the check: Vera is already a person, so there is no one to add.
    await expect(addMeetingAttendee(w.hal, input, options)).rejects.toMatchObject({
      refusal: { code: 'CONFIG_INVALID' },
    });
  });

  it('lets a co-host act on the booking, and answers a colleague as if it weren’t there', async () => {
    const w = await world();
    expect((await bookingGuestPath(w.cora, { linkKey: LINK_KEY }, { bookingId: w.bookingId })).path).toContain('/');
    await expect(bookingGuestPath(w.bo, { linkKey: LINK_KEY }, { bookingId: w.bookingId })).rejects.toMatchObject({
      refusal: { code: 'NOT_FOUND' },
    });
  });
});
