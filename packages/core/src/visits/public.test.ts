// The guest's side of Table seating (spec 0066 B7 lite) against the real Postgres as the app role: the door finds
// a place by its public key only while Table seating takes reservations; a guest reserves, finds the reservation by
// token or by code with email (never by code alone), changes and cancels within the cutoffs; three upcoming per
// email; a ticked marketing box is a request confirmed by email (double opt-in); and nothing of another guest
// reaches an answer.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PublicReserveInput } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { enterTablePage } from '../access/table-door.ts';
import { NO_CALENDAR } from '../booking/calendar.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { rollingWeek } from '../../test/dates-kit.ts';
import { addResource, visitWorkspace, type VisitWorkspace } from '../../test/visits-kit.ts';
import { confirmNews } from './news.ts';
import { guestCancel, guestChange, guestIcs, guestReserve, guestTimes, guestVisit, readTablePage } from './public.ts';
import { getTableSetup, saveTableSetup } from './table-service.ts';
import { prepareVisitMail, visitManageToken } from './mail.ts';
import { cancelVisit, moveVisit } from './move.ts';
import { placeVisit } from './book.ts';
import { readTableService, setReservationAlert } from './table-service.ts';
import { inWorkspace } from '../access/run.ts';
import { addMember } from '../../test/visits-kit.ts';
import { systemScope } from '../access/door.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
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
/** With the link key, so a ticked news box's email is queued with its signed link. */
const newsDeps = { ...deps, linkKey: new Uint8Array(32).fill(7) };
/** A confirm on the real clock: a link is signed when its request is made, and the fixture clock is a year out. */
const confirmDeps = { linkKey: newsDeps.linkKey };

/** The news emails queued in a workspace, oldest first. */
async function newsMails(w: { readonly sql: VisitWorkspace['sql'] }) {
  return (
    await w.sql<{
      key: string;
      to_address: string;
      status: string;
      params: { readonly business?: string; readonly confirmPath?: string };
    }>(
      sql`select key, to_address, status::text, params from emails where kind = 'reservation_news' order by created_at, id`,
    )
  ).rows;
}

/** The token a confirm path carries in its fragment. */
const tokenOf = (path: string | undefined): string =>
  new URLSearchParams((path ?? '').split('#')[1] ?? '').get('news') ?? '';

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
    // Generic, so the page never says whether an email already has reservations here.
    let over: unknown;
    try {
      await guestReserve(entry, deps, reserve(`${week.tuesday}T18:00:00.000Z`, email));
    } catch (error) {
      over = error;
    }
    expect(isRefusal(over) ? [over.refusal.code, over.refusal.message] : over).toEqual([
      'CONFLICT',
      'We couldn’t take this reservation online. Please call the restaurant.',
    ]);
  });

  it('counts the upcoming limit again under the place lock, past a first count that missed a parallel reservation', async () => {
    const { w } = await restaurant();
    const service = await inWorkspace(w.owner, (tx) => readTableService(tx, w.placeId));
    if (service === undefined) throw new Error('No table service.');
    const email = `race-${randomUUID().slice(0, 8)}@example.com`;
    const book = (start: string) =>
      placeVisit(w.owner, deps, {
        placeId: w.placeId,
        items: [{ serviceId: service.serviceId, variantId: service.variantId }],
        party: 2,
        start,
        client: { name: 'Grace Hopper', email },
        source: 'online',
        idempotencyKey: randomUUID(),
        perEmail: { max: 1, message: 'Over.' },
      });
    await book(at('18:00'));
    expect(await code(book(at('21:00')))).toBe('CONFLICT');
  });

  it('keeps a ticked marketing box as a request and emails its link; nothing counts until it is confirmed', async () => {
    const { w, key } = await restaurant();
    const entry = await enterTablePage({ db }, key);
    const email = `news-${randomUUID().slice(0, 8)}@example.com`;
    const input = { ...reserve(at('18:00'), email), marketing: true };
    const ticked = await guestReserve(entry, newsDeps, input);
    expect(ticked.news).toBe('emailed');
    const unticked = await guestReserve(entry, newsDeps, reserve(at('21:00')));
    expect(unticked.news).toBeUndefined();
    // No consent anywhere a consent is read: only the request.
    expect((await w.sql(sql`select 1 from consent_records`)).rows).toEqual([]);
    const requests = (
      await w.sql<{ purpose: string; source_id: string; wording: string; confirmed: boolean }>(
        sql`select purpose, source_id::text, wording, confirmed_at is not null as confirmed from consent_requests`,
      )
    ).rows;
    expect(requests).toEqual([
      {
        purpose: 'marketing_email',
        source_id: ticked.booked.appointmentId,
        wording: 'Send me news and offers from Somewhere Nowhere.',
        confirmed: false,
      },
    ]);
    // One email to the address typed, carrying the confirm link and nothing of the reservation.
    const mails = await newsMails(w);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to_address).toBe(email);
    expect(mails[0]?.params.business).toBe('Somewhere Nowhere');
    expect(mails[0]?.params.confirmPath).toMatch(new RegExp(`^/r/${key}/manage#news=`));
    expect(JSON.stringify(mails[0]?.params)).not.toContain('Grace');
    // A retry of the same reservation asks nothing more.
    const replayed = await guestReserve(entry, newsDeps, input);
    expect(replayed.booked.replayed).toBe(true);
    expect(replayed.news).toBe('asked_before');
    expect(await newsMails(w)).toHaveLength(1);
  });

  it('confirms once from the link, grants then, and refuses a forged, foreign or expired link', async () => {
    const { w, key } = await restaurant();
    const entry = await enterTablePage({ db }, key);
    const made = await guestReserve(entry, newsDeps, { ...reserve(at('18:00')), marketing: true });
    const token = tokenOf((await newsMails(w))[0]?.params.confirmPath);
    expect(await code(confirmNews(entry, confirmDeps, `${token}x`))).toBe('NOT_FOUND');
    expect(await code(confirmNews(entry, { linkKey: new Uint8Array(32).fill(9) }, token))).toBe('NOT_FOUND');
    // Another restaurant's page never opens this workspace's request.
    const other = await restaurant();
    expect(await code(confirmNews(await enterTablePage({ db }, other.key), confirmDeps, token))).toBe('NOT_FOUND');
    expect(await confirmNews(entry, confirmDeps, token)).toBe('confirmed');
    expect(await confirmNews(entry, confirmDeps, token)).toBe('already');
    const rows = (
      await w.sql<{ granted: boolean; source_type: string; source_id: string; record_id: string }>(
        sql`select granted, source_type, source_id::text, record_id::text from consent_records`,
      )
    ).rows;
    expect(rows).toEqual([
      {
        granted: true,
        source_type: 'appointment',
        source_id: made.booked.appointmentId,
        record_id: made.booked.personRecordId,
      },
    ]);
    // A request that ran out confirms nothing, whatever its token says.
    const late = await guestReserve(entry, newsDeps, { ...reserve(at('21:00')), marketing: true });
    const lateToken = tokenOf((await newsMails(w))[1]?.params.confirmPath);
    await testQuery(
      ownerUrl,
      `update consent_requests set requested_at = now() - interval '8 days', expires_at = now() - interval '1 day'
       where source_id = $1`,
      [late.booked.appointmentId],
    );
    expect(await code(confirmNews(entry, confirmDeps, lateToken))).toBe('NOT_FOUND');
    expect((await w.sql(sql`select 1 from consent_records`)).rows).toHaveLength(1);
  });

  it('lets a confirm from the inbox opt back in over a withdrawal, and asks nothing while the Person already said yes', async () => {
    const { w, key } = await restaurant();
    const entry = await enterTablePage({ db }, key);
    const email = `opted-${randomUUID().slice(0, 8)}@example.com`;
    const first = await guestReserve(entry, newsDeps, { ...reserve(at('18:00'), email), marketing: true });
    const person = first.booked.personRecordId ?? '';
    expect(await confirmNews(entry, confirmDeps, tokenOf((await newsMails(w))[0]?.params.confirmPath))).toBe(
      'confirmed',
    );
    // Already yes: a second tick asks nothing.
    const again = await guestReserve(entry, newsDeps, { ...reserve(at('19:30'), email), marketing: true });
    expect(again.news).toBe('already_given');
    // They withdrew afterwards (the CRM): a tick asks again, and only their confirm grants.
    await w.sql(sql`
      insert into consent_records (workspace_id, record_id, purpose, granted, wording, wording_version, source_type)
      values (${w.workspaceId}::uuid, ${person}::uuid, 'marketing_email', false, 'Withdrawn.', 1, 'member')
    `);
    const third = await guestReserve(entry, newsDeps, { ...reserve(at('21:00'), email), marketing: true });
    expect(third.news).toBe('emailed');
    const latest = async () =>
      (
        await w.sql<{ granted: boolean }>(
          sql`select granted from consent_records where record_id = ${person}::uuid order by at desc, id desc limit 1`,
        )
      ).rows[0]?.granted;
    expect(await latest()).toBe(false);
    const mails = await newsMails(w);
    expect(mails).toHaveLength(2);
    expect(await confirmNews(entry, confirmDeps, tokenOf(mails[1]?.params.confirmPath))).toBe('confirmed');
    expect(await latest()).toBe(true);
    // Withdrawn again: the old link never reads as a yes, and writes nothing.
    await w.sql(sql`
      insert into consent_records (workspace_id, record_id, purpose, granted, wording, wording_version, source_type)
      values (${w.workspaceId}::uuid, ${person}::uuid, 'marketing_email', false, 'Withdrawn.', 1, 'member')
    `);
    expect(await code(confirmNews(entry, confirmDeps, tokenOf(mails[1]?.params.confirmPath)))).toBe('NOT_FOUND');
    expect(await latest()).toBe(false);
  });

  it('confirms only at the place that asked, and never onto a deleted Person', async () => {
    const { w, key } = await restaurant();
    const entry = await enterTablePage({ db }, key);
    const made = await guestReserve(entry, newsDeps, { ...reserve(at('18:00')), marketing: true });
    const token = tokenOf((await newsMails(w))[0]?.params.confirmPath);
    // The same workspace through another place's door: refused.
    expect(await code(confirmNews({ ...entry, placeId: randomUUID() }, confirmDeps, token))).toBe('NOT_FOUND');
    await testQuery(ownerUrl, `update records set deleted_at = now(), deleted_by_type = 'system' where id = $1`, [
      made.booked.personRecordId,
    ]);
    expect(await code(confirmNews(entry, confirmDeps, token))).toBe('NOT_FOUND');
    expect((await w.sql(sql`select 1 from consent_records`)).rows).toEqual([]);
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
    const { w, key } = await restaurant();
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
    // The cutoff holds under the lock too, against the locked row: a change that passed the first check while another
    // moved the visit closer is still refused.
    expect(
      await code(
        moveVisit(w.owner, late, {
          appointmentId: changed.appointmentId,
          start: at('21:00'),
          online: true,
          cutoff: { minutes: 120, message: 'Too late.' },
        }),
      ),
    ).toBe('BOOKING_CLOSED');
    expect(
      await code(
        cancelVisit(w.owner, late, {
          appointmentId: changed.appointmentId,
          cutoff: { minutes: 120, message: 'Too late.' },
        }),
      ),
    ).toBe('BOOKING_CLOSED');
    const cancelled = await guestCancel(entry, deps, { guest, reason: 'Plans changed' });
    expect(cancelled).toMatchObject({ cancelled: true, visit: { status: 'cancelled' } });
    expect((await guestCancel(entry, deps, { guest })).cancelled).toBe(false);
    expect(await guestTimes(entry, deps, { party: 2, date: DAY })).toContain(at('20:00'));
  });
});

describe('the guest’s emails (AC-6555)', () => {
  const KEY = Buffer.alloc(32, 9);
  const keyed = { ...deps, linkKey: KEY };
  const queued = (appointmentId: string) =>
    testQuery<{ kind: string; key: string | null }>(
      ownerUrl,
      `select payload->>'kind' as kind, key from graphile_worker._private_jobs j
       join graphile_worker._private_tasks t on t.id = j.task_id
       where t.identifier = 'crm_visit_mail' and payload->>'appointmentId' = $1 order by j.id`,
      [appointmentId],
    );

  it('queues the confirmation and reminders, words them with the code and a manage link on the public origin', async () => {
    const { w, key } = await restaurant();
    const entry = await enterTablePage({ db }, key);
    const made = await guestReserve(entry, keyed, reserve(at('18:00')));
    const id = made.booked.appointmentId;
    // The derived token is the one the guest was given, and the one an email writes days later.
    expect(made.manageToken).toBe(visitManageToken(KEY, id).token);
    // The key's version is signed: a rotated key's version 2 makes a different token, and version 1 stays computable.
    expect(visitManageToken(KEY, id, 2).token).not.toBe(made.manageToken);
    expect(visitManageToken(KEY, id, 1).token).toBe(made.manageToken);
    expect((await queued(id)).map((row) => row.kind)).toEqual(['confirmed', 'reminder_24h', 'reminder_2h']);
    const links = {
      appOrigin: 'https://app.timefix.com',
      publicOrigin: 'https://timefix.com',
      linkKey: KEY,
      organizerEmail: 'reservations@timefix.com',
    };
    const prepared = await prepareVisitMail(systemScope(db, w.workspaceId), links, {
      appointmentId: id,
      kind: 'confirmed',
    });
    const [mail, staff] = prepared.messages;
    expect(mail?.subject).toBe('Your table at Somewhere Nowhere is booked');
    // The owner hears of a new online reservation by default, with a link to the Reservations page on its day.
    expect(prepared.messages).toHaveLength(2);
    expect(staff).toMatchObject({ to: 'ada@example.com', subject: 'New reservation: Grace Hopper, 2 guests' });
    expect(staff?.button?.url).toMatch(
      /^https:\/\/app\.timefix\.com\/w\/visits-[^/]+\/reservations\?date=\d{4}-\d{2}-\d{2}&place=[0-9a-f-]{36}$/,
    );
    expect(staff?.ics).toBeUndefined();
    expect(mail?.rows).toContainEqual({ label: 'Reservation code', value: made.visit.lookupCode });
    expect(mail?.button?.url).toBe(`https://timefix.com/r/${key}/manage#${made.manageToken ?? ''}`);
    expect(mail?.ics?.method).toBe('REQUEST');

    // A change queues `changed` and replaces the reminders; a cancel queues `cancelled`, and the reminders skip.
    await guestChange(entry, keyed, { guest: { token: made.manageToken ?? '' }, start: at('20:00') });
    await guestCancel(entry, keyed, { guest: { token: made.manageToken ?? '' } });
    const kinds = (await queued(id)).map((row) => row.kind);
    expect(kinds.filter((kind) => kind === 'reminder_24h')).toHaveLength(1);
    expect(kinds).toEqual(expect.arrayContaining(['changed', 'cancelled']));
    const reminder = await prepareVisitMail(systemScope(db, w.workspaceId), links, {
      appointmentId: id,
      kind: 'reminder_24h',
    });
    expect(reminder.skipped).toBe('status cancelled');
    const cancelled = await prepareVisitMail(systemScope(db, w.workspaceId), links, {
      appointmentId: id,
      kind: 'cancelled',
    });
    expect(cancelled.messages[0]?.ics?.method).toBe('CANCEL');
    expect(cancelled.messages[0]?.button).toBeUndefined();
  });
});

describe('the staff’s new reservation email (spec 0066 B7 lite)', () => {
  const links = {
    appOrigin: 'https://app.timefix.com',
    linkKey: Buffer.alloc(32, 9),
    organizerEmail: 'reservations@timefix.com',
  };

  it('goes to members who can Run service and chose it, the owner by default, never for a desk booking', async () => {
    const { w, key } = await restaurant();
    const entry = await enterTablePage({ db }, key);
    // A plain member who switched it on still can't Run service: never emailed.
    const plain = await addMember(w, 'Pat');
    await w.sql(sql`
      insert into reservation_alerts (workspace_id, place_id, member_id, enabled)
      values (${w.workspaceId}::uuid, ${w.placeId}::uuid, ${plain}::uuid, true)
    `);
    const made = await guestReserve(entry, deps, reserve(at('18:00')));
    const scope = systemScope(db, w.workspaceId);
    const first = await prepareVisitMail(scope, links, { appointmentId: made.booked.appointmentId, kind: 'confirmed' });
    expect(first.messages.map((mail) => mail.to).slice(1)).toEqual(['ada@example.com']);
    // The owner turns it off: only the guest's confirmation goes.
    await setReservationAlert(w.owner, { placeId: w.placeId, on: false });
    expect((await getTableSetup(w.owner, { placeId: w.placeId })).notifyMe).toBe(false);
    const second = await prepareVisitMail(scope, links, {
      appointmentId: made.booked.appointmentId,
      kind: 'confirmed',
    });
    expect(second.messages).toHaveLength(1);
    // A reminder never carries a staff email.
    await setReservationAlert(w.owner, { placeId: w.placeId, on: true });
    const reminder = await prepareVisitMail(scope, links, {
      appointmentId: made.booked.appointmentId,
      kind: 'reminder_24h',
    });
    expect(reminder.messages).toHaveLength(1);
  });
});
