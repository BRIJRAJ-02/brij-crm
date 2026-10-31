// The one write path (spec 0005, AC-39), in the style of door.test.ts: every
// procedure in the contract is either a read or a write named here; every
// write goes through `commitWrite`, so it pokes the relay once its write
// commits (and not when refused); and each stores exactly one outbox row per
// object it touched, with its mutation id. A new write procedure fails here
// until it is added to WRITES, which proves it pokes.
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contract, DEFAULT_PAGE_THEME, defaultAvailability } from '@crm/contracts';
import { decodeWebhookKey, newId, NO_CALENDAR } from '@crm/core';
import { bookPublicSlot, enterBookingPage } from '@crm/core/public';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createMailpitMailer } from './mail/mailpit.ts';
import { MAILPIT_URL, rpcClient, signIn, signInApp, testConnections } from '../test/sign-in.ts';
import { failure, memberWithWorkspace } from '../test/workspace.ts';

const { ownerUrl } = inject('testDatabase');

/** The procedures that change nothing. Every other procedure is a write, and must be in WRITES below. */
const READS: ReadonlySet<string> = new Set([
  'system.status',
  // Automations (parity #53): the list and the run log.
  'automations.list',
  'automations.runs',
  // Fails on purpose when switched on (spec 0010); it writes nothing either way.
  'system.testFault',
  'me.get',
  // The caller's own preference in schema auth (spec 0031, AC-802): no tenant change, no outbox row.
  'me.setLastWorkspace',
  // Your own account (spec 0033): sessions and step up live in schema auth only, so no tenant change
  // and no outbox row. Deleting the account is the one account write (below): it leaves each workspace.
  'account.sessions.list',
  'account.sessions.revoke',
  'account.sessions.revokeOthers',
  'account.security.get',
  'account.activity.list',
  'account.stepUp.start',
  'account.stepUp.verify',
  'account.deletion.check',
  // A workspace's sign in rules (spec 0033, milestone 4): reading them.
  'workspaceSecurity.get',
  // Settings › Webhooks (spec 0064): the endpoints and a page of one's log.
  'webhooks.list',
  'webhooks.deliveries',
  'workspaces.slugAvailable',
  'objects.list',
  'attributes.list',
  // What an attribute's change would touch, read before the change (the flow pass).
  'attributes.impact',
  // What changing an attribute's type would do, read before the change (the field types lane).
  'attributes.checkTypeChange',
  'members.list',
  // Teams (spec 0031, slice 8): the list every member reads.
  'teams.list',
  // An object's access, as its Access tab reads it (spec 0032).
  'accessRules.get',
  // Preview as (spec 0032, AC-858): reads as someone else through the policy; its one write is an audit row, no outbox.
  'accessRules.preview',
  // Invitations (spec 0031): the open list, and the invitation page's look (no session).
  'invitations.list',
  'invitations.peek',
  // The invite link as its card shows it (slice 6, AC-818).
  'invitations.link',
  // What a removal will do, for the remove dialog (slice 5, AC-816).
  'members.removalPreview',
  // Domain join (slice 6): the workspaces to ask, a workspace's domains, and its open requests.
  'join.list',
  'joinRequests.domains',
  'joinRequests.list',
  // Slice 7: Workspace › General, Account › Profile, and a deleted workspace as its owner sees it.
  'workspace.get',
  'profile.get',
  // The link page (spec 0051): the caller's own blocks, and the booking pages they may place.
  'profile.items',
  'profile.counts',
  'profile.pageChoices',
  // The forms the caller may place on the page (spec 0052, AC-5213): their own, read only.
  'profile.formChoices',
  // Add to Wallet (spec 0055): the address to save their own page from, made and never stored.
  'profile.walletLink',
  'deletedWorkspace.deleted',
  'access.mine',
  // Settings › History's Workspace changes (spec 0046).
  'audit.list',
  // The operator console (spec 0047): read only, across workspaces, behind the operator gate.
  'operator.overview',
  'operator.users',
  'operator.user',
  'operator.pages',
  'operator.page',
  'operator.site',
  // The roles every role picker offers (spec 0037, AC-1439).
  'roles.list',
  // Scheduling access (spec 0037): a member's delegations both ways, and the members in their See reach.
  'scheduling.delegations.list',
  'members.visible',
  'records.query',
  'records.count',
  // Lists and their entries (spec 0048).
  'lists.list',
  'entries.query',
  'entries.count',
  'entries.groups',
  'entries.get',
  'entries.membership',
  'entries.forRecord',
  'records.objectCounts',
  'records.groups',
  // A column's calculation (the CRM flow pass): a read.
  'records.aggregate',
  'records.aggregateGroups',
  'records.get',
  'records.activity',
  // How long a record has sat in its current stage (a status attribute's history): a read.
  'records.stageSince',
  'records.getTrashed',
  'records.search',
  // A record page's related section (spec 0014, milestone 3): one side's linked records, a page at a time.
  'links.page',
  'realtime.connectionToken',
  'realtime.subscriptionToken',
  'realtime.catchUp',
  'jobs.list',
  'jobs.get',
  // Imports and exports (spec 0040): one import or export, its staged rows and the far records it would link.
  'imports.get',
  'imports.rows',
  'imports.links',
  'imports.matches',
  'exports.get',
  'usage.get',
  'views.list',
  'views.get',
  // The one view write with no outbox row (spec 0020, AC-488): the member's own last opened view.
  'views.markOpened',
  // Saved reports (the reports lane): a chart's definition holds no records, so its writes store no outbox row, as
  // `views.markOpened` stores none; another tab reads the list again when it opens it. The service tests prove them.
  'reports.list',
  'reports.create',
  'reports.update',
  'reports.delete',
  // The command menu (spec 0039): its search, and the member's own recent items (no outbox row, like markOpened).
  'search.query',
  'recents.list',
  'recents.visit',
  // Settings › Account › Preferences: the member's own, no outbox row (like markOpened); the change writes an audit row.
  'preferences.get',
  'preferences.update',
  'trash.query',
  'trash.count',
  'tasks.get',
  'tasks.list',
  'tasks.due',
  'notes.get',
  'notes.list',
  // Comments and the inbox (spec 0038).
  'comments.list',
  'comments.get',
  'comments.versions',
  'notifications.list',
  'notifications.count',
  'notifications.settings',
  'calendar.connections.list',
  'calendar.meetings.forRecord',
  'calendar.settings.get',
  'calendar.calendars.list',
  'calendar.pageDestination.get',
  'calendar.health',
  'forms.list',
  'forms.get',
  'forms.attributes',
  'forms.preview',
  'forms.slugAvailable',
  'submissions.list',
  'submissions.get',
  'submissions.getExport',
  'forms.syncPreview',
  // Booking pages (spec 0025).
  'bookingPages.list',
  'bookingPages.get',
  // Where a page's answers may be filed (spec 0057): People and its attributes as this reader may write them.
  'bookingPages.attributes',
  'bookings.list',
  'bookings.listAll',
  'bookings.meetings',
  'bookings.calendar',
  'bookings.teamDay',
  'home.teamToday',
  'home.metrics',
  'bookings.hours',
  // Where a booking could move (its page's slots), and the guest page's address: both read only.
  'bookings.moveSlots',
  'bookings.guestLink',
  // Availability schedules (spec 0035).
  'schedules.members',
  'schedules.list',
  'timeOff.list',
  // Meeting limits (spec 0037): a member's limits and this day's and week's counts.
  'limits.get',
  // The limits a meeting at a time lands against: New meeting's warning (read only).
  'limits.at',
  // The Team week (spec 0037): the roster over everyone's default schedules.
  'availability.teamWeek',
  'schedules.get',
  // Round robin (spec 0029): the rotations a member may see, and why a booking went to its host.
  'rotations.list',
  'rotations.distribution',
  'bookings.assignments',
  // The sidebar (spec 0034).
  'nav.get',
  // Lead routing's report (spec 0043).
  'routing.report',
]);

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
let pokes = 0;
/** The invitation tokens the app mailed, by address, read off the links (the mailer below stands in for Mailpit). */
/** A handle nobody holds: these cases claim one so there is a page to change, and run beside each other. */
const freeHandle = () => `p${newId().replaceAll('-', '').slice(0, 20)}`;

const invitationTokens = new Map<string, string>();
/** Sign in codes still go to Mailpit, where signIn reads them. */
const mailpit = createMailpitMailer({ url: MAILPIT_URL, from: 'Timefix <noreply@example.com>' });

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp(
    { db, identity },
    // Webhooks (spec 0064) are on only with a sealing key: a fresh one for this suite.
    { webhookKey: decodeWebhookKey(randomBytes(32).toString('base64')) },
    {
      wakeRelay: () => (pokes += 1),
      mailer: {
        transport: 'mailpit',
        send: (message) => {
          const token = /\/invite\/([A-Za-z0-9_-]{43})/.exec(message.text)?.[1];
          if (token !== undefined) invitationTokens.set(message.to, token);
          return mailpit.send(message);
        },
      },
    },
  ));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** Every procedure in the contract, by its dotted path. */
function paths(tree: unknown, prefix: readonly string[] = []): string[] {
  if (typeof tree !== 'object' || tree === null) return [];
  if ('~orpc' in tree && prefix.length > 0) return [prefix.join('.')];
  return Object.entries(tree).flatMap(([key, value]) => paths(value, [...prefix, key]));
}

interface OutboxRow {
  readonly kind: string;
  readonly object_id: string;
  readonly list_id: string | null;
  readonly record_ids: string[];
  readonly attribute_ids: string[];
  readonly item_ids: string[];
  readonly mutation_id: string | null;
}

async function outboxOf(workspaceId: string): Promise<OutboxRow[]> {
  return testQuery<OutboxRow & Record<string, unknown>>(
    ownerUrl,
    'select kind, object_id, list_id, record_ids, attribute_ids, item_ids, mutation_id from outbox where workspace_id = $1 order by seq',
    [workspaceId],
  );
}

type Member = Awaited<ReturnType<typeof memberWithWorkspace>>;

/**
 * An import of a Name and a Job title column into People, made through the API (its own write first, unless it is
 * the case's). Name is there because People's Name is required with no default, and an import that creates
 * records is refused when no column fills a required field.
 */
async function importOf(m: Member, mutationId = newId()): Promise<string> {
  const id = newId();
  await m.client.imports.create({
    workspace: m.slug,
    id,
    objectId: m.people.id,
    fileName: 'people.csv',
    rowCount: 1,
    errorRows: 0,
    settings: {
      columns: [
        { header: 'Name', target: { attributeId: m.attribute('name'), part: 'first' } },
        { header: 'Job title', target: { attributeId: m.attribute('job_title') } },
      ],
      onMatch: 'skip',
      onNoMatch: 'create',
    },
    mutationId,
  });
  return id;
}

/** An import with its one row staged (two writes before the case's). */
async function stagedImportOf(m: Member): Promise<string> {
  const importId = await importOf(m);
  await m.client.imports.stage({
    workspace: m.slug,
    importId,
    rows: [{ rowNumber: 2, values: { [m.attribute('job_title')]: 'Engineer', [m.attribute('name')]: 'Ada' } }],
    mutationId: newId(),
  });
  return importId;
}

/** A select attribute "Tier" on People with two options, made with them in one write (one definitions row). */
async function tierOn(m: Member): Promise<{ readonly id: string; readonly options: readonly string[] }> {
  const options = [newId(), newId()];
  const made = await m.client.attributes.create({
    workspace: m.slug,
    objectId: m.people.id,
    id: newId(),
    title: 'Tier',
    type: 'select',
    options: [
      { id: options[0] ?? '', label: 'Silver', hue: 'gray' },
      { id: options[1] ?? '', label: 'Platinum', hue: 'blue' },
    ],
    mutationId: newId(),
  });
  return { id: made.id, options };
}

/** A person made through the app, for a case that deletes or restores one. */
async function personFor(m: Member): Promise<string> {
  const id = newId();
  await m.client.records.create({
    workspace: m.slug,
    objectId: m.people.id,
    id,
    values: { [m.attribute('name')]: { firstName: 'Ada' } },
    mutationId: newId(),
  });
  return id;
}

/** A second person in the member's workspace: invited and accepted through the app, with their own client. */
async function teammate(m: Member) {
  const invitee = await signIn(app);
  await m.client.invitations.create({
    workspace: m.slug,
    emails: [invitee.email],
    role: 'member',
    mutationId: newId(),
  });
  const client = rpcClient(app, invitee.cookie);
  await client.invitations.accept({ token: invitationTokens.get(invitee.email) ?? '' });
  const memberId = (await client.access.mine({ workspace: m.slug })).memberId;
  return { client, memberId };
}

/** One write's rows, one per object in object id order (the outbox hook's), each naming its one record. */
function byObject(recordOf: Readonly<Record<string, string>>, mutationId?: string): Partial<OutboxRow>[] {
  return Object.entries(recordOf)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([objectId, recordId]) => ({
      kind: 'records',
      object_id: objectId,
      record_ids: [recordId],
      ...(mutationId === undefined ? {} : { mutation_id: mutationId }),
    }));
}

/** A person and a company in the member's workspace, and Companies' Team side (spec 0014's link writes). */
async function linkPair(m: Member) {
  const personId = newId();
  await m.client.records.create({
    workspace: m.slug,
    objectId: m.people.id,
    id: personId,
    values: { [m.attribute('name')]: { firstName: 'Ada' } },
    mutationId: newId(),
  });
  const companyAttributes = await m.client.attributes.list({ workspace: m.slug, objectId: m.companies.id });
  const team = companyAttributes.find((each) => each.apiSlug === 'team')?.id ?? '';
  const name = companyAttributes.find((each) => each.apiSlug === 'name')?.id ?? '';
  const companyId = newId();
  await m.client.records.create({
    workspace: m.slug,
    objectId: m.companies.id,
    id: companyId,
    values: { [name]: 'Acme' },
    mutationId: newId(),
  });
  return { personId, companyId, team };
}

/**
 * A schedule of the member's (spec 0035), not their default, and the ids its write's `schedules` row names: their
 * first schedule stores their virtual default beside it.
 */
async function schedule(m: Member) {
  const made = await m.client.schedules.create({
    workspace: m.slug,
    id: newId(),
    name: 'Evenings',
    timeZone: 'UTC',
    mutationId: newId(),
  });
  const { schedules } = await m.client.schedules.list({ workspace: m.slug, timeZone: 'UTC' });
  return { made, named: schedules.map((each) => each.id ?? '').sort() };
}

/** A Monday two to three weeks ahead: inside the Team week's reach (a year on), and never in a week already gone. */
function rosterMonday(weeksOn: number): string {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 14 + ((8 - day.getUTCDay()) % 7) + weeksOn * 7);
  return day.toISOString().slice(0, 10);
}
const ROSTER_MONDAY = rosterMonday(0);

/** The member's own Monday on the Team week, 10 to 2 that week only, as read first so the stale check passes. */
async function rosterDay(m: Member, mutationId: string) {
  const week = await m.client.availability.teamWeek({ workspace: m.slug, weekStart: ROSTER_MONDAY });
  const own = week.rows[0];
  if (own === undefined) throw new Error('The Team week had no row for its reader.');
  const set = await m.client.availability.setDay({
    workspace: m.slug,
    memberId: own.memberId,
    date: ROSTER_MONDAY,
    hours: [['10:00', '14:00']],
    updatedAt: own.schedule.updatedAt,
    mutationId,
  });
  return { memberId: own.memberId, schedule: set.schedule };
}

/**
 * A calendar connection of the member's with one synced meeting that shows on a person they made: stored by hand
 * (the owner role), as a sync would leave them, since connecting is the OAuth redirect, not a procedure.
 */
async function heldMeeting(m: Member): Promise<{ connectionId: string; meetingId: string; recordId: string }> {
  const recordId = await personFor(m);
  const [member] = await testQuery<{ id: string }>(
    ownerUrl,
    `select id::text from members where workspace_id = $1 and status = 'active' limit 1`,
    [m.workspace.id],
  );
  const memberId = member?.id ?? '';
  const connectionId = newId();
  const meetingId = newId();
  await testQuery(
    ownerUrl,
    `insert into calendar_connections (workspace_id, id, member_id, provider, account_email, status, tokens,
       created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
     values ($1, $2, $3, 'google', 'ada@acme.dev', 'connected', '\\x00'::bytea, 'member', $3, $3, 'member', $3, $3)`,
    [m.workspace.id, connectionId, memberId],
  );
  await testQuery(
    ownerUrl,
    `insert into meetings (workspace_id, id, ical_uid, title, starts_at, ends_at, created_by_type, updated_by_type)
     values ($1, $2, 'intro@google.com', 'Intro', now(), now(), 'calendar', 'calendar')`,
    [m.workspace.id, meetingId],
  );
  await testQuery(
    ownerUrl,
    `insert into meeting_sources (workspace_id, meeting_id, connection_id, provider_event_id, calendar_id)
     values ($1, $2, $3, 'intro', 'primary')`,
    [m.workspace.id, meetingId, connectionId],
  );
  // Its main calendar (spec 0024 milestone 5), syncing, shown and taking bookings.
  await testQuery(
    ownerUrl,
    `insert into calendar_calendars (workspace_id, connection_id, member_id, provider_calendar_id, name, access_role,
       is_primary, check_conflicts, show_in_week, sync, is_destination, created_by_type, updated_by_type)
     values ($1, $2, $3, 'primary', 'ada@acme.dev', 'owner', true, true, true, true, true, 'calendar', 'calendar')`,
    [m.workspace.id, connectionId, memberId],
  );
  await testQuery(
    ownerUrl,
    `insert into meeting_records (workspace_id, meeting_id, record_id, via, starts_at) values ($1, $2, $3, 'attendee', now())`,
    [m.workspace.id, meetingId, recordId],
  );
  return { connectionId, meetingId, recordId };
}

/**
 * Each write procedure, called once through the real app: what it should
 * store in the outbox (one row per object it touched), given the member's
 * workspace and the mutation id it sent.
 */
/**
 * A booking a member made for a guest on a new page, through the API: two writes before the case's (the page,
 * then the booking, whose person's records row comes first in the outbox).
 */
async function hostBooking(m: Member): Promise<string> {
  const page = await m.client.bookingPages.create({
    workspace: m.slug,
    id: newId(),
    title: 'Intro',
    timeZone: 'UTC',
    mutationId: newId(),
  });
  const { bookingId } = await m.client.bookings.bookAsHost({
    workspace: m.slug,
    idempotencyKey: newId(),
    pageId: page.id,
    start: new Date(Date.now() + 86_400_000).toISOString(),
    minutes: 30,
    name: 'Grace Hopper',
    // A free mail domain, so only the person is filed (no company).
    email: 'grace@gmail.com',
    timeZone: 'UTC',
    guests: [],
    mutationId: newId(),
  });
  return bookingId;
}

/**
 * A Blank list over People with one person in it, made through the API: three writes (the list, the person, the
 * entry), each with its own outbox row, before the case's.
 */
async function listWithEntry(m: Member): Promise<{ listId: string; recordId: string; entryId: string }> {
  const listId = newId();
  await m.client.lists.create({
    workspace: m.slug,
    id: listId,
    objectId: m.people.id,
    name: 'Crew',
    template: 'blank',
    mutationId: newId(),
  });
  const recordId = newId();
  await m.client.records.create({
    workspace: m.slug,
    objectId: m.people.id,
    id: recordId,
    values: { [m.attribute('name')]: { firstName: 'Ada' } },
    mutationId: newId(),
  });
  const entryId = newId();
  await m.client.entries.add({ workspace: m.slug, id: entryId, listId, recordId, mutationId: newId() });
  return { listId, recordId, entryId };
}

/** The three rows `listWithEntry` stores: the list's definitions, the person, the entry. */
const listRows = (m: Member, made: { listId: string; recordId: string; entryId: string }) => [
  { kind: 'definitions', list_id: made.listId },
  { kind: 'records', object_id: m.people.id, record_ids: [made.recordId] },
  { kind: 'entries', list_id: made.listId, item_ids: [made.entryId], record_ids: [made.recordId] },
];

/** A shared view on People, made through the API (its own write and outbox row before the case's). */
async function sharedViewOf(m: Member, name = 'Pipeline'): Promise<string> {
  const id = newId();
  await m.client.views.create({
    workspace: m.slug,
    id,
    objectId: m.people.id,
    name,
    kind: 'table',
    visibility: 'workspace',
    config: { columns: [], showNewAttributes: false, pinnedCount: 1, sorts: [] },
    mutationId: newId(),
  });
  return id;
}

/** A webhook endpoint made through the API (its own write before the case's). */
async function webhookOf(m: Member): Promise<string> {
  const made = await m.client.webhooks.create({
    workspace: m.slug,
    url: 'https://hooks.example.com/timefix',
    events: ['booking.created'],
    mutationId: newId(),
  });
  return made.endpoint.id;
}

const WRITES: Record<string, (m: Member, mutationId: string) => Promise<readonly Partial<OutboxRow>[]>> = {
  // Webhooks (spec 0064): a workspace's own automation settings, which nobody's screen follows live, so no row.
  'webhooks.create': async (m, mutationId) => {
    await m.client.webhooks.create({
      workspace: m.slug,
      url: 'https://hooks.example.com/timefix',
      events: ['form.submitted'],
      mutationId,
    });
    return [];
  },
  'webhooks.update': async (m, mutationId) => {
    const endpointId = await webhookOf(m);
    await m.client.webhooks.update({ workspace: m.slug, endpointId, status: 'off', mutationId });
    return [];
  },
  'webhooks.rotateSecret': async (m, mutationId) => {
    const endpointId = await webhookOf(m);
    await m.client.webhooks.rotateSecret({ workspace: m.slug, endpointId, mutationId });
    return [];
  },
  'webhooks.delete': async (m, mutationId) => {
    const endpointId = await webhookOf(m);
    await m.client.webhooks.delete({ workspace: m.slug, endpointId, mutationId });
    return [];
  },
  'webhooks.test': async (m, mutationId) => {
    const endpointId = await webhookOf(m);
    await m.client.webhooks.test({ workspace: m.slug, endpointId, mutationId });
    return [];
  },
  'webhooks.resend': async (m, mutationId) => {
    const endpointId = await webhookOf(m);
    const ping = await m.client.webhooks.test({ workspace: m.slug, endpointId, mutationId: newId() });
    await m.client.webhooks.resend({ workspace: m.slug, deliveryId: ping.id, mutationId });
    return [];
  },
  // A workspace's sign in rules (spec 0033): the door reads them on every request, so no screen needs an event.
  'workspaceSecurity.set': async (m) => {
    await m.client.workspaceSecurity.set({ workspace: m.slug, sessionLengthDays: 7 });
    return [];
  },
  'workspaceSecurity.signOutEveryone': async (m) => {
    await m.client.workspaceSecurity.signOutEveryone({ workspace: m.slug });
    return [];
  },
  // Invitations (spec 0031): nobody's screen shows another's invitations live, so no row; accepting adds a member.
  'invitations.create': async (m, mutationId) => {
    await m.client.invitations.create({ workspace: m.slug, emails: ['grace@example.com'], role: 'member', mutationId });
    return [];
  },
  'invitations.resend': async (m, mutationId) => {
    const made = await m.client.invitations.create({
      workspace: m.slug,
      emails: ['grace@example.com'],
      role: 'member',
      mutationId: newId(),
    });
    await m.client.invitations.resend({ workspace: m.slug, invitationId: made.invited[0]?.id ?? '', mutationId });
    return [];
  },
  // The invite link (slice 6): a setting nobody's screen follows live, so no row.
  'invitations.setLink': async (m, mutationId) => {
    await m.client.invitations.setLink({ workspace: m.slug, enabled: true, mutationId });
    return [];
  },
  'invitations.revoke': async (m, mutationId) => {
    const made = await m.client.invitations.create({
      workspace: m.slug,
      emails: ['grace@example.com'],
      role: 'member',
      mutationId: newId(),
    });
    await m.client.invitations.revoke({ workspace: m.slug, invitationId: made.invited[0]?.id ?? '', mutationId });
    return [];
  },
  // Members (spec 0031): each case brings a teammate in first (an invite and its accept, one members row).
  'members.setRole': async (m, mutationId) => {
    const mate = await teammate(m);
    await m.client.members.setRole({ workspace: m.slug, memberId: mate.memberId, role: 'admin', mutationId });
    // Their scheduling reach changed with the role (spec 0037, AC-1274).
    return [
      { kind: 'members' },
      { kind: 'members', item_ids: [mate.memberId], mutation_id: mutationId },
      { kind: 'access', item_ids: [mate.memberId], mutation_id: mutationId },
    ];
  },
  'members.remove': async (m, mutationId) => {
    const mate = await teammate(m);
    await m.client.members.remove({ workspace: m.slug, memberId: mate.memberId, mutationId });
    // A removal also names whose access changed, so their own tabs are cut off (AC-817).
    return [
      { kind: 'members' },
      { kind: 'members', item_ids: [mate.memberId], mutation_id: mutationId },
      { kind: 'access', item_ids: [mate.memberId], mutation_id: mutationId },
    ];
  },
  // Scheduling access (spec 0037, AC-1257): the delegate's reach changed, so their own tabs read it again.
  'scheduling.delegations.grant': async (m, mutationId) => {
    const mate = await teammate(m);
    await m.client.scheduling.delegations.grant({
      workspace: m.slug,
      delegateMemberId: mate.memberId,
      target: { type: 'everyone' },
      level: 'manage',
      mutationId,
    });
    // The teammate's join first (a members row), then the grant's.
    return [{ kind: 'members' }, { kind: 'access', item_ids: [mate.memberId], mutation_id: mutationId }];
  },
  'scheduling.delegations.revoke': async (m, mutationId) => {
    const mate = await teammate(m);
    const made = await m.client.scheduling.delegations.grant({
      workspace: m.slug,
      delegateMemberId: mate.memberId,
      target: { type: 'everyone' },
      level: 'view',
      mutationId: newId(),
    });
    await m.client.scheduling.delegations.revoke({ workspace: m.slug, id: made.id, mutationId });
    return [
      { kind: 'members' },
      { kind: 'access', item_ids: [mate.memberId] },
      { kind: 'access', item_ids: [mate.memberId], mutation_id: mutationId },
    ];
  },
  'members.transferOwnership': async (m, mutationId) => {
    const mate = await teammate(m);
    await m.client.members.transferOwnership({ workspace: m.slug, memberId: mate.memberId, mutationId });
    return [{ kind: 'members' }, { kind: 'members', mutation_id: mutationId }];
  },
  'members.leave': async (m, mutationId) => {
    const mate = await teammate(m);
    await mate.client.members.leave({ workspace: m.slug, mutationId });
    return [
      { kind: 'members' },
      { kind: 'members', item_ids: [mate.memberId], mutation_id: mutationId },
      { kind: 'access', item_ids: [mate.memberId], mutation_id: mutationId },
    ];
  },
  // Domain join (slice 6, AC-819, AC-820): settings nobody's screen follows live, so no row; a request tells the
  // admins in their inbox (one notifications row), and an approval brings someone in (one members row).
  'joinRequests.setDomains': async (m, mutationId) => {
    await m.client.joinRequests.setDomains({ workspace: m.slug, domains: ['example.com'], mutationId });
    return [];
  },
  'join.request': async (m) => {
    await m.client.joinRequests.setDomains({ workspace: m.slug, domains: ['example.com'], mutationId: newId() });
    const asker = await signIn(app);
    await rpcClient(app, asker.cookie).join.request({ workspaceId: m.workspace.id });
    return [{ kind: 'notifications' }];
  },
  'joinRequests.decide': async (m, mutationId) => {
    await m.client.joinRequests.setDomains({ workspace: m.slug, domains: ['example.com'], mutationId: newId() });
    const asker = await signIn(app);
    await rpcClient(app, asker.cookie).join.request({ workspaceId: m.workspace.id });
    const [request] = await m.client.joinRequests.list({ workspace: m.slug });
    await m.client.joinRequests.decide({ workspace: m.slug, requestId: request?.id ?? '', approve: true, mutationId });
    return [{ kind: 'notifications' }, { kind: 'members', mutation_id: mutationId }];
  },
  // Slice 7: the workspace's own settings and delete, and its restore, which nobody's screen follows live; a
  // profile change reaches every member's list (one members row).
  'workspace.update': async (m, mutationId) => {
    await m.client.workspace.update({ workspace: m.slug, name: 'Renamed', mutationId });
    return [];
  },
  'workspace.delete': async (m, mutationId) => {
    const { name } = await m.client.workspace.get({ workspace: m.slug });
    await m.client.workspace.delete({ workspace: m.slug, confirmName: name, mutationId });
    return [];
  },
  'deletedWorkspace.restore': async (m, mutationId) => {
    const { name } = await m.client.workspace.get({ workspace: m.slug });
    await m.client.workspace.delete({ workspace: m.slug, confirmName: name, mutationId: newId() });
    await m.client.deletedWorkspace.restore({ workspace: m.slug, mutationId });
    return [];
  },
  'profile.update': async (m, mutationId) => {
    const me = await m.client.profile.update({ workspace: m.slug, name: 'Renamed', mutationId });
    return [{ kind: 'members', item_ids: [me.memberId], mutation_id: mutationId }];
  },
  // The look of the link page (spec 0054) and whether search engines may show it (spec 0055) live in schema auth
  // beside its blocks: no tenant change, so no outbox row of their own. Both need a handle to change, so each
  // claims one first, and that claim is the one row the case expects.
  'profile.saveTheme': async (m, mutationId) => {
    const me = await m.client.profile.update({ workspace: m.slug, handle: freeHandle(), mutationId: newId() });
    await m.client.profile.saveTheme({
      workspace: m.slug,
      theme: { ...DEFAULT_PAGE_THEME, ground: 'paper' },
      mutationId,
    });
    return [{ kind: 'members', item_ids: [me.memberId] }];
  },
  'profile.setIndexable': async (m, mutationId) => {
    const me = await m.client.profile.update({ workspace: m.slug, handle: freeHandle(), mutationId: newId() });
    await m.client.profile.setIndexable({ workspace: m.slug, indexable: false, mutationId });
    return [{ kind: 'members', item_ids: [me.memberId] }];
  },
  // Sharing the link page makes it public (27 Oct 2026): one column in schema auth, no outbox row of its own.
  'profile.show': async (m, mutationId) => {
    const me = await m.client.profile.update({ workspace: m.slug, handle: freeHandle(), mutationId: newId() });
    await m.client.profile.show({ workspace: m.slug, mutationId });
    return [{ kind: 'members', item_ids: [me.memberId] }];
  },
  // The picture a pasted link shows instead of the drawn card (spec 0055, AC-5511): one column in schema auth,
  // so no outbox row of its own. The smallest real PNG there is, so the bytes pass their own signature check.
  'profile.setShareImage': async (m, mutationId) => {
    const me = await m.client.profile.update({ workspace: m.slug, handle: freeHandle(), mutationId: newId() });
    await m.client.profile.setShareImage({
      workspace: m.slug,
      image: {
        type: 'image/png',
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      },
      mutationId,
    });
    return [{ kind: 'members', item_ids: [me.memberId] }];
  },
  // Bringing a link in bio page across (spec 0055): hidden blocks in schema auth, so no outbox row either. The
  // page it reads is the test outside fetch's fixed one, so nothing here touches the network.
  'profile.importLinks': async (m, mutationId) => {
    await m.client.profile.importLinks({
      workspace: m.slug,
      id: newId(),
      url: 'https://linktr.ee/someone',
      mutationId,
    });
    return [];
  },
  // The link page's blocks (spec 0051) live in schema auth: no tenant change, so no outbox row.
  'profile.saveItem': async (m, mutationId) => {
    await m.client.profile.saveItem({
      workspace: m.slug,
      id: newId(),
      block: { kind: 'link', title: 'Site', url: 'https://example.com' },
      mutationId,
    });
    return [];
  },
  'profile.orderItems': async (m, mutationId) => {
    const block = { kind: 'heading', title: 'Work' } as const;
    const item = await m.client.profile.saveItem({ workspace: m.slug, id: newId(), block, mutationId: newId() });
    await m.client.profile.orderItems({ workspace: m.slug, ids: [item.id], mutationId });
    return [];
  },
  'profile.archiveItem': async (m, mutationId) => {
    const block = { kind: 'heading', title: 'Work' } as const;
    const item = await m.client.profile.saveItem({ workspace: m.slug, id: newId(), block, mutationId: newId() });
    await m.client.profile.archiveItem({ workspace: m.slug, id: item.id, archived: true, mutationId });
    return [];
  },
  'profile.deleteItem': async (m, mutationId) => {
    const block = { kind: 'heading', title: 'Work' } as const;
    const item = await m.client.profile.saveItem({ workspace: m.slug, id: newId(), block, mutationId: newId() });
    await m.client.profile.deleteItem({ workspace: m.slug, id: item.id, mutationId });
    return [];
  },
  'invitations.accept': async (m) => {
    const invitee = await signIn(app);
    await m.client.invitations.create({
      workspace: m.slug,
      emails: [invitee.email],
      role: 'member',
      mutationId: newId(),
    });
    await rpcClient(app, invitee.cookie).invitations.accept({ token: invitationTokens.get(invitee.email) ?? '' });
    return [{ kind: 'members' }];
  },
  // Deleting your account (spec 0033) removes you from each workspace: one members row there.
  'account.deletion.confirm': async (m) => {
    const person = await signIn(app);
    await m.client.invitations.create({
      workspace: m.slug,
      emails: [person.email],
      role: 'member',
      mutationId: newId(),
    });
    const client = rpcClient(app, person.cookie);
    await client.invitations.accept({ token: invitationTokens.get(person.email) ?? '' });
    await client.account.deletion.confirm({ email: person.email });
    // Like a leave, it also names whose access changed, so their own tabs are cut off (AC-817).
    return [{ kind: 'members' }, { kind: 'members' }, { kind: 'access' }];
  },
  'workspaces.create': async (m) => {
    await m.client.workspaces.create({
      id: newId(),
      name: 'Second',
      slug: `second-${newId().slice(-12)}`,
      memberName: 'Ada',
    });
    // Its events would go to a workspace nobody can be subscribed to yet: none, in the new workspace or this one.
    return [];
  },
  // Lists (spec 0048): a new list stores one definitions row naming it; each entry write one entries row.
  'lists.create': async (m, mutationId) => {
    const id = newId();
    await m.client.lists.create({
      workspace: m.slug,
      id,
      objectId: m.people.id,
      name: 'Hiring',
      template: 'pipeline',
      mutationId,
    });
    return [{ kind: 'definitions', list_id: id, mutation_id: mutationId }];
  },
  'entries.add': async (m, mutationId) => {
    const made = await listWithEntry(m);
    const recordId = newId();
    await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id: recordId,
      values: { [m.attribute('name')]: { firstName: 'Bo' } },
      mutationId: newId(),
    });
    const id = newId();
    await m.client.entries.add({ workspace: m.slug, id, listId: made.listId, recordId, mutationId });
    return [
      ...listRows(m, made),
      { kind: 'records', object_id: m.people.id, record_ids: [recordId] },
      { kind: 'entries', list_id: made.listId, item_ids: [id], record_ids: [recordId], mutation_id: mutationId },
    ];
  },
  'entries.setValues': async (m, mutationId) => {
    const made = await listWithEntry(m);
    const attributeId = newId();
    await m.client.attributes.create({
      workspace: m.slug,
      objectId: m.people.id,
      listId: made.listId,
      id: attributeId,
      title: 'Note',
      type: 'text',
      mutationId: newId(),
    });
    await m.client.entries.setValues({
      workspace: m.slug,
      entryId: made.entryId,
      values: { [attributeId]: { value: 'Call back' } },
      mutationId,
    });
    return [
      ...listRows(m, made),
      { kind: 'definitions', list_id: made.listId, attribute_ids: [attributeId] },
      { kind: 'entries', list_id: made.listId, item_ids: [made.entryId], mutation_id: mutationId },
    ];
  },
  'entries.remove': async (m, mutationId) => {
    const made = await listWithEntry(m);
    await m.client.entries.remove({ workspace: m.slug, entryIds: [made.entryId], mutationId });
    return [
      ...listRows(m, made),
      { kind: 'entries', list_id: made.listId, item_ids: [made.entryId], mutation_id: mutationId },
    ];
  },
  'entries.restore': async (m, mutationId) => {
    const made = await listWithEntry(m);
    await m.client.entries.remove({ workspace: m.slug, entryIds: [made.entryId], mutationId: newId() });
    await m.client.entries.restore({ workspace: m.slug, entryIds: [made.entryId], mutationId });
    return [
      ...listRows(m, made),
      { kind: 'entries', list_id: made.listId, item_ids: [made.entryId] },
      { kind: 'entries', list_id: made.listId, item_ids: [made.entryId], mutation_id: mutationId },
    ];
  },
  'lists.update': async (m, mutationId) => {
    const made = await listWithEntry(m);
    await m.client.lists.update({ workspace: m.slug, listId: made.listId, name: 'Talent', mutationId });
    return [...listRows(m, made), { kind: 'definitions', list_id: made.listId, mutation_id: mutationId }];
  },
  'lists.archive': async (m, mutationId) => {
    const made = await listWithEntry(m);
    await m.client.lists.archive({ workspace: m.slug, listId: made.listId, mutationId });
    return [...listRows(m, made), { kind: 'definitions', list_id: made.listId, mutation_id: mutationId }];
  },
  'lists.restore': async (m, mutationId) => {
    const made = await listWithEntry(m);
    await m.client.lists.archive({ workspace: m.slug, listId: made.listId, mutationId: newId() });
    await m.client.lists.restore({ workspace: m.slug, listId: made.listId, mutationId });
    return [
      ...listRows(m, made),
      { kind: 'definitions', list_id: made.listId },
      { kind: 'definitions', list_id: made.listId, mutation_id: mutationId },
    ];
  },
  'entries.addMany': async (m, mutationId) => {
    const made = await listWithEntry(m);
    const recordId = newId();
    await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id: recordId,
      values: { [m.attribute('name')]: { firstName: 'Bo' } },
      mutationId: newId(),
    });
    const id = newId();
    await m.client.entries.addMany({
      workspace: m.slug,
      listId: made.listId,
      recordIds: [recordId],
      ids: [id],
      mutationId,
    });
    return [
      ...listRows(m, made),
      { kind: 'records', object_id: m.people.id, record_ids: [recordId] },
      { kind: 'entries', list_id: made.listId, item_ids: [id], record_ids: [recordId], mutation_id: mutationId },
    ];
  },
  // A list's bulk jobs (AC-4817, AC-4825): each start stores one jobs row.
  'entries.addMatching': async (m, mutationId) => {
    const made = await listWithEntry(m);
    const job = await m.client.entries.addMatching({
      workspace: m.slug,
      id: newId(),
      listId: made.listId,
      target: { kind: 'ids', objectId: m.people.id, recordIds: [made.recordId] },
      mutationId,
    });
    return [...listRows(m, made), { kind: 'jobs', item_ids: [job.id], mutation_id: mutationId }];
  },
  'entries.removeMatching': async (m, mutationId) => {
    const made = await listWithEntry(m);
    const job = await m.client.entries.removeMatching({
      workspace: m.slug,
      id: newId(),
      listId: made.listId,
      target: { kind: 'ids', entryIds: [made.entryId] },
      mutationId,
    });
    return [...listRows(m, made), { kind: 'jobs', item_ids: [job.id], mutation_id: mutationId }];
  },
  'entries.undoJob': async (m, mutationId) => {
    const made = await listWithEntry(m);
    const started = await m.client.entries.removeMatching({
      workspace: m.slug,
      id: newId(),
      listId: made.listId,
      target: { kind: 'ids', entryIds: [made.entryId] },
      mutationId: newId(),
    });
    // Only a finished change is undone: this one is ended by hand, as its run would.
    await testQuery(ownerUrl, `update jobs set status = 'succeeded', finished_at = now() where id = $1`, [started.id]);
    const job = await m.client.entries.undoJob({ workspace: m.slug, id: newId(), jobId: started.id, mutationId });
    return [
      ...listRows(m, made),
      { kind: 'jobs', item_ids: [started.id] },
      { kind: 'jobs', item_ids: [job.id], mutation_id: mutationId },
    ];
  },
  'records.create': async (m, mutationId) => {
    const id = newId();
    await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id,
      values: { [m.attribute('name')]: { firstName: 'Ada', lastName: 'Lovelace' } },
      mutationId,
    });
    return [{ kind: 'records', object_id: m.people.id, record_ids: [id], mutation_id: mutationId }];
  },
  'records.setValues': async (m, mutationId) => {
    const id = newId();
    await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id,
      values: { [m.attribute('name')]: { firstName: 'Ada' } },
      mutationId: newId(),
    });
    const before = (await outboxOf(m.workspace.id)).length;
    await m.client.records.setValues({
      workspace: m.slug,
      recordId: id,
      values: { [m.attribute('job_title')]: { value: 'Analyst' } },
      mutationId,
    });
    expect((await outboxOf(m.workspace.id)).length - before).toBe(1);
    // The first row is the create's; the second, this write's.
    return [
      { kind: 'records', object_id: m.people.id, record_ids: [id] },
      { kind: 'records', object_id: m.people.id, record_ids: [id], mutation_id: mutationId },
    ];
  },
  'records.setValuesBatch': async (m, mutationId) => {
    const ids = [newId(), newId()];
    for (const id of ids) {
      await m.client.records.create({
        workspace: m.slug,
        objectId: m.people.id,
        id,
        values: { [m.attribute('name')]: { firstName: 'Ada' } },
        mutationId: newId(),
      });
    }
    await m.client.records.setValuesBatch({
      workspace: m.slug,
      items: ids.map((recordId) => ({ recordId, values: { [m.attribute('job_title')]: { value: 'Analyst' } } })),
      mutationId,
    });
    // The two creates' rows, then this write's one row for both records.
    return [
      { kind: 'records', object_id: m.people.id, record_ids: [ids[0] ?? ''] },
      { kind: 'records', object_id: m.people.id, record_ids: [ids[1] ?? ''] },
      { kind: 'records', object_id: m.people.id, record_ids: ids, mutation_id: mutationId },
    ];
  },
  // Bulk actions and the trash (spec 0022): one records row for the object, naming the records.
  'records.deleteMany': async (m, mutationId) => {
    const id = await personFor(m);
    await m.client.records.deleteMany({
      workspace: m.slug,
      objectId: m.people.id,
      recordIds: [id],
      batchId: newId(),
      mutationId,
    });
    return [
      { kind: 'records', object_id: m.people.id, record_ids: [id] },
      { kind: 'records', object_id: m.people.id, record_ids: [id], mutation_id: mutationId },
    ];
  },
  'records.restoreBatch': async (m, mutationId) => {
    const id = await personFor(m);
    const batchId = newId();
    await m.client.records.deleteMany({
      workspace: m.slug,
      objectId: m.people.id,
      recordIds: [id],
      batchId,
      mutationId: newId(),
    });
    await m.client.records.restoreBatch({ workspace: m.slug, batchId, mutationId });
    return [
      { kind: 'records', object_id: m.people.id, record_ids: [id] },
      { kind: 'records', object_id: m.people.id, record_ids: [id] },
      { kind: 'records', object_id: m.people.id, record_ids: [id], mutation_id: mutationId },
    ];
  },
  'trash.deleteForever': async (m, mutationId) => {
    const id = await personFor(m);
    await m.client.records.deleteMany({
      workspace: m.slug,
      objectId: m.people.id,
      recordIds: [id],
      batchId: newId(),
      mutationId: newId(),
    });
    await m.client.trash.deleteForever({ workspace: m.slug, recordIds: [id], mutationId });
    return [
      { kind: 'records', object_id: m.people.id, record_ids: [id] },
      { kind: 'records', object_id: m.people.id, record_ids: [id] },
      { kind: 'records', object_id: m.people.id, record_ids: [id], mutation_id: mutationId },
    ];
  },
  'records.startBulk': async (m, mutationId) => {
    const id = await personFor(m);
    const job = await m.client.records.startBulk({
      workspace: m.slug,
      id: newId(),
      action: 'delete',
      target: { kind: 'ids', objectId: m.people.id, recordIds: [id] },
      mutationId,
    });
    return [
      { kind: 'records', object_id: m.people.id, record_ids: [id] },
      { kind: 'jobs', item_ids: [job.id], mutation_id: mutationId },
    ];
  },
  'records.updateMany': async (m, mutationId) => {
    const id = await personFor(m);
    await m.client.records.updateMany({
      workspace: m.slug,
      objectId: m.people.id,
      recordIds: [id],
      edit: { attributeId: m.attribute('job_title'), op: 'set', value: 'Analyst' },
      mutationId,
    });
    return [
      { kind: 'records', object_id: m.people.id, record_ids: [id] },
      { kind: 'records', object_id: m.people.id, record_ids: [id], mutation_id: mutationId },
    ];
  },
  'trash.restore': async (m, mutationId) => {
    const id = await personFor(m);
    await m.client.records.deleteMany({
      workspace: m.slug,
      objectId: m.people.id,
      recordIds: [id],
      batchId: newId(),
      mutationId: newId(),
    });
    await m.client.trash.restore({ workspace: m.slug, recordIds: [id], mutationId });
    return [
      { kind: 'records', object_id: m.people.id, record_ids: [id] },
      { kind: 'records', object_id: m.people.id, record_ids: [id] },
      { kind: 'records', object_id: m.people.id, record_ids: [id], mutation_id: mutationId },
    ];
  },
  'attributes.create': async (m, mutationId) => {
    const made = await m.client.attributes.create({
      workspace: m.slug,
      objectId: m.people.id,
      id: newId(),
      title: 'Lead score',
      type: 'number',
      mutationId,
    });
    return [{ kind: 'definitions', object_id: m.people.id, attribute_ids: [made.id], mutation_id: mutationId }];
  },
  // Attribute writes (spec 0012, milestone 2): one definitions row per object, naming the attributes changed.
  'attributes.update': async (m, mutationId) => {
    const attributeId = m.attribute('job_title');
    await m.client.attributes.update({ workspace: m.slug, attributeId, title: 'Role', mutationId });
    return [{ kind: 'definitions', object_id: m.people.id, attribute_ids: [attributeId], mutation_id: mutationId }];
  },
  'attributes.reorder': async (m, mutationId) => {
    const attributeId = m.attribute('job_title');
    await m.client.attributes.reorder({ workspace: m.slug, attributeId, position: 0, mutationId });
    return [{ kind: 'definitions', object_id: m.people.id, attribute_ids: [attributeId], mutation_id: mutationId }];
  },
  'attributes.archive': async (m, mutationId) => {
    // A relationship's end: both ends archive, one row for each object.
    const ends = await m.client.attributes.archive({
      workspace: m.slug,
      attributeId: m.attribute('company'),
      mutationId,
    });
    return ends
      .map((end) => ({
        kind: 'definitions',
        object_id: end.objectId,
        attribute_ids: [end.id],
        mutation_id: mutationId,
      }))
      .sort((a, b) => a.object_id.localeCompare(b.object_id));
  },
  // A type change: the column's values change shape, so the object's records read again (coarse), and its definition.
  'attributes.changeType': async (m, mutationId) => {
    const attributeId = m.attribute('job_title');
    await m.client.attributes.changeType({ workspace: m.slug, attributeId, to: 'long_text', mutationId });
    return [
      { kind: 'records', object_id: m.people.id, mutation_id: mutationId },
      { kind: 'definitions', object_id: m.people.id, attribute_ids: [attributeId], mutation_id: mutationId },
    ];
  },
  'attributes.restore': async (m, mutationId) => {
    const attributeId = m.attribute('job_title');
    await m.client.attributes.archive({ workspace: m.slug, attributeId, mutationId: newId() });
    await m.client.attributes.restore({ workspace: m.slug, attributeId, mutationId });
    return [
      { kind: 'definitions', object_id: m.people.id, attribute_ids: [attributeId] },
      { kind: 'definitions', object_id: m.people.id, attribute_ids: [attributeId], mutation_id: mutationId },
    ];
  },
  // Relationship writes (spec 0014): one definitions row for each object, naming its side.
  'links.add': async (m, mutationId) => {
    const { personId, companyId, team } = await linkPair(m);
    await m.client.links.add({
      workspace: m.slug,
      recordId: companyId,
      attributeId: team,
      targets: [{ objectId: m.people.id, recordId: personId }],
      mutationId,
    });
    // One row per object (in object id order): the near company and the far person.
    return [
      { kind: 'records', object_id: m.people.id, record_ids: [personId] },
      { kind: 'records', object_id: m.companies.id, record_ids: [companyId] },
      ...byObject({ [m.companies.id]: companyId, [m.people.id]: personId }, mutationId),
    ];
  },
  'links.remove': async (m, mutationId) => {
    const { personId, companyId, team } = await linkPair(m);
    await m.client.links.add({
      workspace: m.slug,
      recordId: companyId,
      attributeId: team,
      targets: [{ objectId: m.people.id, recordId: personId }],
      mutationId: newId(),
    });
    await m.client.links.remove({
      workspace: m.slug,
      recordId: companyId,
      attributeId: team,
      targetRecordIds: [personId],
      mutationId,
    });
    return [
      { kind: 'records', object_id: m.people.id, record_ids: [personId] },
      { kind: 'records', object_id: m.companies.id, record_ids: [companyId] },
      ...byObject({ [m.companies.id]: companyId, [m.people.id]: personId }),
      ...byObject({ [m.companies.id]: companyId, [m.people.id]: personId }, mutationId),
    ];
  },
  'relationships.create': async (m, mutationId) => {
    const made = await m.client.relationships.create({
      workspace: m.slug,
      id: newId(),
      cardinality: 'many_to_many',
      from: { objectId: m.people.id, title: 'Investments' },
      to: { objectId: m.companies.id, title: 'Investors' },
      mutationId,
    });
    return [made.from, made.to]
      .map((end) => ({
        kind: 'definitions',
        object_id: end.objectId,
        attribute_ids: [end.id],
        mutation_id: mutationId,
      }))
      .sort((a, b) => a.object_id.localeCompare(b.object_id));
  },
  'relationships.update': async (m, mutationId) => {
    const made = await m.client.relationships.create({
      workspace: m.slug,
      id: newId(),
      cardinality: 'many_to_one',
      from: { objectId: m.people.id, title: 'Manager' },
      to: { objectId: m.people.id, title: 'Reports' },
      mutationId: newId(),
    });
    await m.client.relationships.update({
      workspace: m.slug,
      relationshipId: made.relationshipId,
      from: { title: 'Lead' },
      to: { title: 'Team members' },
      mutationId,
    });
    const both = [made.from.id, made.to.id].sort();
    return [
      { kind: 'definitions', object_id: m.people.id, attribute_ids: both },
      { kind: 'definitions', object_id: m.people.id, attribute_ids: both, mutation_id: mutationId },
    ];
  },
  // Option writes (spec 0012, milestone 3): one definitions row for the attribute's object, naming the attribute.
  'options.create': async (m, mutationId) => {
    const tier = await tierOn(m);
    await m.client.options.create({ workspace: m.slug, attributeId: tier.id, id: newId(), label: 'Gold', mutationId });
    return [
      { kind: 'definitions', object_id: m.people.id, attribute_ids: [tier.id] },
      { kind: 'definitions', object_id: m.people.id, attribute_ids: [tier.id], mutation_id: mutationId },
    ];
  },
  'options.update': async (m, mutationId) => {
    const tier = await tierOn(m);
    await m.client.options.update({ workspace: m.slug, optionId: tier.options[0] ?? '', label: 'Bronze', mutationId });
    return [
      { kind: 'definitions', object_id: m.people.id, attribute_ids: [tier.id] },
      { kind: 'definitions', object_id: m.people.id, attribute_ids: [tier.id], mutation_id: mutationId },
    ];
  },
  'options.reorder': async (m, mutationId) => {
    const tier = await tierOn(m);
    await m.client.options.reorder({ workspace: m.slug, optionId: tier.options[1] ?? '', position: 0, mutationId });
    return [
      { kind: 'definitions', object_id: m.people.id, attribute_ids: [tier.id] },
      { kind: 'definitions', object_id: m.people.id, attribute_ids: [tier.id], mutation_id: mutationId },
    ];
  },
  'options.archive': async (m, mutationId) => {
    const tier = await tierOn(m);
    await m.client.options.archive({ workspace: m.slug, optionId: tier.options[0] ?? '', mutationId });
    return [
      { kind: 'definitions', object_id: m.people.id, attribute_ids: [tier.id] },
      { kind: 'definitions', object_id: m.people.id, attribute_ids: [tier.id], mutation_id: mutationId },
    ];
  },
  'options.restore': async (m, mutationId) => {
    const tier = await tierOn(m);
    const optionId = tier.options[0] ?? '';
    await m.client.options.archive({ workspace: m.slug, optionId, mutationId: newId() });
    await m.client.options.restore({ workspace: m.slug, optionId, mutationId });
    return [
      { kind: 'definitions', object_id: m.people.id, attribute_ids: [tier.id] },
      { kind: 'definitions', object_id: m.people.id, attribute_ids: [tier.id] },
      { kind: 'definitions', object_id: m.people.id, attribute_ids: [tier.id], mutation_id: mutationId },
    ];
  },
  // Object writes (spec 0012): one definitions row naming the object, no attributes (the object itself changed).
  'objects.create': async (m, mutationId) => {
    const made = await m.client.objects.create({
      workspace: m.slug,
      id: newId(),
      singularName: 'Project',
      pluralName: 'Projects',
      icon: 'folder',
      hue: 'blue',
      mutationId,
    });
    return [{ kind: 'definitions', object_id: made.id, attribute_ids: [], mutation_id: mutationId }];
  },
  'objects.update': async (m, mutationId) => {
    await m.client.objects.update({ workspace: m.slug, objectId: m.people.id, pluralName: 'Contacts', mutationId });
    return [{ kind: 'definitions', object_id: m.people.id, attribute_ids: [], mutation_id: mutationId }];
  },
  'objects.reorder': async (m, mutationId) => {
    await m.client.objects.reorder({ workspace: m.slug, objectId: m.people.id, position: 2, mutationId });
    return [{ kind: 'definitions', object_id: m.people.id, attribute_ids: [], mutation_id: mutationId }];
  },
  'objects.archive': async (m, mutationId) => {
    await m.client.objects.archive({ workspace: m.slug, objectId: m.people.id, mutationId });
    return [{ kind: 'definitions', object_id: m.people.id, attribute_ids: [], mutation_id: mutationId }];
  },
  'objects.restore': async (m, mutationId) => {
    await m.client.objects.restore({ workspace: m.slug, objectId: m.people.id, mutationId });
    return [{ kind: 'definitions', object_id: m.people.id, attribute_ids: [], mutation_id: mutationId }];
  },
  // Saved views (spec 0020): one views row for the view's object, naming the view.
  'views.saveQuery': async (m, mutationId) => {
    const { views } = await m.client.views.list({ workspace: m.slug, objectId: m.people.id });
    const viewId = views[0]?.id ?? '';
    await m.client.views.saveQuery({
      workspace: m.slug,
      viewId,
      sorts: [{ attributeId: m.attribute('name'), direction: 'ascending' }],
      baseQueryVersion: 1,
      mutationId,
    });
    return [{ kind: 'views', object_id: m.people.id, item_ids: [viewId], mutation_id: mutationId }];
  },
  'views.create': async (m, mutationId) => {
    const id = newId();
    await m.client.views.create({
      workspace: m.slug,
      id,
      objectId: m.people.id,
      name: 'Pilots',
      kind: 'table',
      visibility: 'private',
      config: { columns: [], showNewAttributes: false, pinnedCount: 1, sorts: [] },
      mutationId,
    });
    return [{ kind: 'views', object_id: m.people.id, item_ids: [id], mutation_id: mutationId }];
  },
  'views.update': async (m, mutationId) => {
    const viewId = await sharedViewOf(m);
    await m.client.views.update({ workspace: m.slug, viewId, name: 'Crew', mutationId });
    return [
      { kind: 'views', item_ids: [viewId] },
      { kind: 'views', object_id: m.people.id, item_ids: [viewId], mutation_id: mutationId },
    ];
  },
  'views.setLayout': async (m, mutationId) => {
    const { views } = await m.client.views.list({ workspace: m.slug, objectId: m.people.id });
    const viewId = views[0]?.id ?? '';
    await m.client.views.setLayout({
      workspace: m.slug,
      viewId,
      layout: { columns: [{ attributeId: m.attribute('name'), width: 240 }], pinnedCount: 1 },
      mutationId,
    });
    return [{ kind: 'views', object_id: m.people.id, item_ids: [viewId], mutation_id: mutationId }];
  },
  'views.move': async (m, mutationId) => {
    const first = await sharedViewOf(m, 'First');
    const second = await sharedViewOf(m, 'Second');
    await m.client.views.move({ workspace: m.slug, viewId: second, direction: 'up', mutationId });
    return [
      { kind: 'views', item_ids: [first] },
      { kind: 'views', item_ids: [second] },
      { kind: 'views', object_id: m.people.id, item_ids: [first, second].sort(), mutation_id: mutationId },
    ];
  },
  'views.setLocked': async (m, mutationId) => {
    const viewId = await sharedViewOf(m);
    await m.client.views.setLocked({ workspace: m.slug, viewId, locked: true, mutationId });
    return [
      { kind: 'views', item_ids: [viewId] },
      { kind: 'views', object_id: m.people.id, item_ids: [viewId], mutation_id: mutationId },
    ];
  },
  'views.setDefault': async (m, mutationId) => {
    const { views } = await m.client.views.list({ workspace: m.slug, objectId: m.people.id });
    const old = views[0]?.id ?? '';
    const viewId = await sharedViewOf(m);
    await m.client.views.setDefault({ workspace: m.slug, objectId: m.people.id, viewId, mutationId });
    return [
      { kind: 'views', item_ids: [viewId] },
      { kind: 'views', object_id: m.people.id, item_ids: [old, viewId].sort(), mutation_id: mutationId },
    ];
  },
  'views.delete': async (m, mutationId) => {
    const viewId = await sharedViewOf(m);
    await m.client.views.delete({ workspace: m.slug, viewId, mutationId });
    return [
      { kind: 'views', item_ids: [viewId] },
      { kind: 'views', object_id: m.people.id, item_ids: [viewId], mutation_id: mutationId },
    ];
  },
  // The sidebar (spec 0034, AC-937): one nav row naming the member, and nothing of what changed.
  'nav.change': async (m, mutationId) => {
    const { memberId } = await m.client.access.mine({ workspace: m.slug });
    await m.client.nav.change({ workspace: m.slug, op: { op: 'rail', on: true }, mutationId });
    return [{ kind: 'nav', item_ids: [memberId], mutation_id: mutationId }];
  },
  // Tasks (spec 0019, AC-448): one tasks row per write, naming the task and every record linked before or after.
  'tasks.create': async (m, mutationId) => {
    const record = await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id: newId(),
      values: { [m.attribute('name')]: { firstName: 'Ada' } },
      mutationId: newId(),
    });
    const task = await m.client.tasks.create({
      workspace: m.slug,
      id: newId(),
      title: 'Call back',
      recordIds: [record.id],
      mutationId,
    });
    return [
      { kind: 'records', record_ids: [record.id] },
      { kind: 'tasks', item_ids: [task.id], record_ids: [record.id], mutation_id: mutationId },
    ];
  },
  'tasks.update': async (m, mutationId) => {
    const task = await m.client.tasks.create({
      workspace: m.slug,
      id: newId(),
      title: 'Call back',
      mutationId: newId(),
    });
    await m.client.tasks.update({ workspace: m.slug, taskId: task.id, isDone: true, mutationId });
    return [
      { kind: 'tasks', item_ids: [task.id] },
      { kind: 'tasks', item_ids: [task.id], record_ids: [], mutation_id: mutationId },
    ];
  },
  'tasks.delete': async (m, mutationId) => {
    const task = await m.client.tasks.create({ workspace: m.slug, id: newId(), title: 'Gone', mutationId: newId() });
    await m.client.tasks.delete({ workspace: m.slug, taskId: task.id, mutationId });
    return [
      { kind: 'tasks', item_ids: [task.id] },
      { kind: 'tasks', item_ids: [task.id], record_ids: [], mutation_id: mutationId },
    ];
  },
  'tasks.restore': async (m, mutationId) => {
    const task = await m.client.tasks.create({ workspace: m.slug, id: newId(), title: 'Back', mutationId: newId() });
    await m.client.tasks.delete({ workspace: m.slug, taskId: task.id, mutationId: newId() });
    await m.client.tasks.restore({ workspace: m.slug, taskId: task.id, mutationId });
    return [
      { kind: 'tasks', item_ids: [task.id] },
      { kind: 'tasks', item_ids: [task.id] },
      { kind: 'tasks', item_ids: [task.id], record_ids: [], mutation_id: mutationId },
    ];
  },
  // Notes (spec 0019, AC-448): one notes row per write, naming the note, its record and the record's object.
  'notes.save': async (m, mutationId) => {
    const record = await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id: newId(),
      values: { [m.attribute('name')]: { firstName: 'Ada' } },
      mutationId: newId(),
    });
    const { note } = await m.client.notes.save({
      workspace: m.slug,
      id: newId(),
      recordId: record.id,
      title: 'Call notes',
      mutationId,
    });
    return [
      { kind: 'records', record_ids: [record.id] },
      { kind: 'notes', object_id: m.people.id, item_ids: [note.id], record_ids: [record.id], mutation_id: mutationId },
    ];
  },
  'notes.delete': async (m, mutationId) => {
    const record = await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id: newId(),
      values: { [m.attribute('name')]: { firstName: 'Ada' } },
      mutationId: newId(),
    });
    const { note } = await m.client.notes.save({
      workspace: m.slug,
      id: newId(),
      recordId: record.id,
      title: 'Gone',
      mutationId: newId(),
    });
    await m.client.notes.delete({ workspace: m.slug, noteId: note.id, mutationId });
    return [
      { kind: 'records', record_ids: [record.id] },
      { kind: 'notes', item_ids: [note.id] },
      { kind: 'notes', object_id: m.people.id, item_ids: [note.id], record_ids: [record.id], mutation_id: mutationId },
    ];
  },
  'notes.restore': async (m, mutationId) => {
    const record = await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id: newId(),
      values: { [m.attribute('name')]: { firstName: 'Ada' } },
      mutationId: newId(),
    });
    const { note } = await m.client.notes.save({
      workspace: m.slug,
      id: newId(),
      recordId: record.id,
      title: 'Back',
      mutationId: newId(),
    });
    await m.client.notes.delete({ workspace: m.slug, noteId: note.id, mutationId: newId() });
    await m.client.notes.restore({ workspace: m.slug, noteId: note.id, mutationId });
    return [
      { kind: 'records', record_ids: [record.id] },
      { kind: 'notes', item_ids: [note.id] },
      { kind: 'notes', item_ids: [note.id] },
      { kind: 'notes', object_id: m.people.id, item_ids: [note.id], record_ids: [record.id], mutation_id: mutationId },
    ];
  },
  // A note's links (migration 0135): one notes row per object, naming every record linked before or after.
  'notes.link': async (m, mutationId) => {
    const made = async (firstName: string) =>
      m.client.records.create({
        workspace: m.slug,
        objectId: m.people.id,
        id: newId(),
        values: { [m.attribute('name')]: { firstName } },
        mutationId: newId(),
      });
    const home = await made('Ada');
    const other = await made('Bea');
    const { note } = await m.client.notes.save({
      workspace: m.slug,
      id: newId(),
      recordId: home.id,
      title: 'Both',
      mutationId: newId(),
    });
    await m.client.notes.link({ workspace: m.slug, noteId: note.id, addRecordIds: [other.id], mutationId });
    return [
      { kind: 'records', record_ids: [home.id] },
      { kind: 'records', record_ids: [other.id] },
      { kind: 'notes', item_ids: [note.id] },
      {
        kind: 'notes',
        object_id: m.people.id,
        item_ids: [note.id],
        record_ids: [home.id, other.id].sort(),
        mutation_id: mutationId,
      },
    ];
  },
  // Calendar sync (spec 0024): a sharing change names the connection's meetings and their records; so does a
  // disconnect, for the meetings it removed. Each also names the member in a `calendars` row, so their other tabs
  // read their connections again.
  'calendar.connections.update': async (m, mutationId) => {
    const { memberId } = await m.client.access.mine({ workspace: m.slug });
    const { connectionId, meetingId, recordId } = await heldMeeting(m);
    await m.client.calendar.connections.update({ workspace: m.slug, connectionId, sharing: 'private', mutationId });
    return [
      { kind: 'records', record_ids: [recordId] },
      { kind: 'meetings', item_ids: [meetingId], record_ids: [recordId], mutation_id: mutationId },
      { kind: 'calendars', item_ids: [memberId], mutation_id: mutationId },
    ];
  },
  'calendar.connections.remove': async (m, mutationId) => {
    const { memberId } = await m.client.access.mine({ workspace: m.slug });
    const { connectionId, meetingId, recordId } = await heldMeeting(m);
    await m.client.calendar.connections.remove({ workspace: m.slug, connectionId, mutationId });
    return [
      { kind: 'records', record_ids: [recordId] },
      { kind: 'meetings', item_ids: [meetingId], record_ids: [recordId], mutation_id: mutationId },
      { kind: 'calendars', item_ids: [memberId], mutation_id: mutationId },
    ];
  },
  // Sync now queues the connection's sync: a job row, no outbox row, and one poke so the worker wakes for it.
  'calendar.connections.syncNow': async (m, mutationId) => {
    const { connectionId, recordId } = await heldMeeting(m);
    await m.client.calendar.connections.syncNow({ workspace: m.slug, connectionId, mutationId });
    return [{ kind: 'records', record_ids: [recordId] }];
  },
  // Refresh (milestone 5) queues the connection's sync, as Sync now does: no outbox row.
  'calendar.connections.refresh': async (m, mutationId) => {
    const { connectionId, recordId } = await heldMeeting(m);
    await m.client.calendar.connections.refresh({ workspace: m.slug, connectionId, mutationId });
    return [{ kind: 'records', record_ids: [recordId] }];
  },
  // Sync meetings off while the calendar still shows: its meeting leaves its records (AC-1002).
  'calendar.calendars.update': async (m, mutationId) => {
    const { memberId } = await m.client.access.mine({ workspace: m.slug });
    const { connectionId, meetingId, recordId } = await heldMeeting(m);
    const [main] = await testQuery<{ id: string }>(
      ownerUrl,
      `select id::text from calendar_calendars where connection_id = $1`,
      [connectionId],
    );
    await m.client.calendar.calendars.update({
      workspace: m.slug,
      calendarId: main?.id ?? '',
      sync: false,
      mutationId,
    });
    return [
      { kind: 'records', record_ids: [recordId] },
      { kind: 'meetings', item_ids: [meetingId], record_ids: [recordId], mutation_id: mutationId },
      { kind: 'calendars', item_ids: [memberId], mutation_id: mutationId },
    ];
  },
  // Where bookings go: the member's own setting, no outbox row.
  'calendar.destination.set': async (m, mutationId) => {
    const { connectionId, recordId } = await heldMeeting(m);
    const [main] = await testQuery<{ id: string }>(
      ownerUrl,
      `select id::text from calendar_calendars where connection_id = $1`,
      [connectionId],
    );
    await m.client.calendar.destination.set({ workspace: m.slug, calendarId: main?.id ?? '', mutationId });
    return [{ kind: 'records', record_ids: [recordId] }];
  },
  'calendar.destination.dismissNotice': async (m, mutationId) => {
    const { recordId } = await heldMeeting(m);
    await m.client.calendar.destination.dismissNotice({ workspace: m.slug, mutationId });
    return [{ kind: 'records', record_ids: [recordId] }];
  },
  // A page's own destination: a booking page setting, no outbox row.
  'calendar.pageDestination.set': async (m, mutationId) => {
    const { connectionId, recordId } = await heldMeeting(m);
    const [main] = await testQuery<{ id: string }>(
      ownerUrl,
      `select id::text from calendar_calendars where connection_id = $1`,
      [connectionId],
    );
    const page = await m.client.bookingPages.create({
      workspace: m.slug,
      id: newId(),
      title: 'Intro',
      timeZone: 'UTC',
      mutationId: newId(),
    });
    await m.client.calendar.pageDestination.set({
      workspace: m.slug,
      pageId: page.id,
      calendarId: main?.id ?? '',
      mutationId,
    });
    return [{ kind: 'records', record_ids: [recordId] }];
  },
  // Add as person (milestone 2): the new person's record, and the meeting now on the person's timeline too.
  'calendar.meetings.addAttendee': async (m, mutationId) => {
    const { meetingId, recordId } = await heldMeeting(m);
    await testQuery(
      ownerUrl,
      `insert into meeting_attendees (workspace_id, meeting_id, email, name, position, match)
       values ($1, $2, 'cy@initech.example', 'Cy Ng', 1, 'unknown')`,
      [m.workspace.id, meetingId],
    );
    const added = await m.client.calendar.meetings.addAttendee({
      workspace: m.slug,
      recordId,
      meetingId,
      email: 'cy@initech.example',
      mutationId,
    });
    return [
      { kind: 'records', record_ids: [recordId] },
      { kind: 'records', record_ids: [added.recordId], mutation_id: mutationId },
      { kind: 'meetings', item_ids: [meetingId], mutation_id: mutationId },
    ];
  },
  // The workspace's calendar settings: a setting, not CRM data, so no outbox row; one poke.
  'calendar.settings.update': async (m, mutationId) => {
    await m.client.calendar.settings.update({ workspace: m.slug, createUnknownPeople: true, mutationId });
    return [];
  },
  // Ask to reconnect (spec 0037, AC-1309): an audit row and an email to a colleague whose calendar broke (stored by
  // hand, as a sync leaves it), no outbox row; one poke, which wakes the job drain to send it.
  'calendar.askReconnect': async (m, mutationId) => {
    const colleague = newId();
    await testQuery(
      ownerUrl,
      `insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
       values ($1, $2, 'Kim Park', 'kim@acme.dev', 'member', 'system', 'system')`,
      [m.workspace.id, colleague],
    );
    await testQuery(
      ownerUrl,
      `insert into calendar_connections (workspace_id, id, member_id, provider, account_email, status, tokens,
         created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
       values ($1, $2, $3, 'google', 'kim@acme.dev', 'expired', '\\x00'::bytea, 'member', $3, $3, 'member', $3, $3)`,
      [m.workspace.id, newId(), colleague],
    );
    await m.client.calendar.askReconnect({ workspace: m.slug, memberId: colleague, mutationId });
    return [];
  },
  // Booking pages (spec 0025): settings, not CRM data, so no outbox row; still one poke per write.
  'bookingPages.create': async (m, mutationId) => {
    await m.client.bookingPages.create({ workspace: m.slug, id: newId(), title: 'Intro', timeZone: 'UTC', mutationId });
    return [];
  },
  'bookingPages.update': async (m, mutationId) => {
    const page = await m.client.bookingPages.create({
      workspace: m.slug,
      id: newId(),
      title: 'Intro',
      timeZone: 'UTC',
      mutationId: newId(),
    });
    await m.client.bookingPages.update({
      workspace: m.slug,
      pageId: page.id,
      settings: { title: 'Hello' },
      mutationId,
    });
    return [];
  },
  'bookingPages.delete': async (m, mutationId) => {
    const page = await m.client.bookingPages.create({
      workspace: m.slug,
      id: newId(),
      title: 'Intro',
      timeZone: 'UTC',
      mutationId: newId(),
    });
    await m.client.bookingPages.delete({ workspace: m.slug, pageId: page.id, mutationId });
    return [];
  },
  // The profile's order (owner ask A102): settings too, so no outbox row; one poke.
  'bookingPages.reorderProfile': async (m, mutationId) => {
    const page = await m.client.bookingPages.create({
      workspace: m.slug,
      id: newId(),
      title: 'Intro',
      timeZone: 'UTC',
      mutationId: newId(),
    });
    await m.client.bookingPages.reorderProfile({ workspace: m.slug, pageIds: [page.id], mutationId });
    return [];
  },
  // The default schedule's hours (spec 0035): the first save stores "Working hours", one `schedules` row.
  'bookings.setHours': async (m, mutationId) => {
    const { availability } = await m.client.bookings.hours({ workspace: m.slug, timeZone: 'UTC' });
    await m.client.bookings.setHours({ workspace: m.slug, availability, mutationId });
    const { schedules } = await m.client.schedules.list({ workspace: m.slug, timeZone: 'UTC' });
    return [{ kind: 'schedules', item_ids: [schedules[0]?.id ?? ''], mutation_id: mutationId }];
  },
  // Availability schedules (spec 0035): one `schedules` row per write, its schedule ids only. A member's first
  // schedule stores their virtual default beside it, so its row names both.
  'schedules.create': async (m, mutationId) => {
    await m.client.schedules.create({
      workspace: m.slug,
      id: newId(),
      name: 'Evenings',
      timeZone: 'UTC',
      mutationId,
    });
    const { schedules } = await m.client.schedules.list({ workspace: m.slug, timeZone: 'UTC' });
    return [
      {
        kind: 'schedules',
        item_ids: schedules.map((each) => each.id ?? '').sort(),
        mutation_id: mutationId,
      },
    ];
  },
  'schedules.update': async (m, mutationId) => {
    const { made, named } = await schedule(m);
    await m.client.schedules.update({
      workspace: m.slug,
      id: made.id ?? '',
      name: 'Late',
      updatedAt: made.updatedAt ?? '',
      mutationId,
    });
    return [
      { kind: 'schedules', item_ids: named },
      { kind: 'schedules', item_ids: [made.id ?? ''], mutation_id: mutationId },
    ];
  },
  // The mark moves: its row names the new default and the old one.
  'schedules.setDefault': async (m, mutationId) => {
    const { made, named } = await schedule(m);
    const old = named.find((id) => id !== made.id) ?? '';
    await m.client.schedules.setDefault({ workspace: m.slug, id: made.id ?? '', mutationId });
    return [
      { kind: 'schedules', item_ids: named },
      { kind: 'schedules', item_ids: [made.id ?? '', old].sort(), mutation_id: mutationId },
    ];
  },
  'schedules.duplicate': async (m, mutationId) => {
    const { made, named } = await schedule(m);
    const copy = await m.client.schedules.duplicate({
      workspace: m.slug,
      id: made.id ?? '',
      newId: newId(),
      mutationId,
    });
    return [
      { kind: 'schedules', item_ids: named },
      { kind: 'schedules', item_ids: [copy.id ?? ''], mutation_id: mutationId },
    ];
  },
  'schedules.delete': async (m, mutationId) => {
    const { made, named } = await schedule(m);
    await m.client.schedules.delete({ workspace: m.slug, id: made.id ?? '', mutationId });
    return [
      { kind: 'schedules', item_ids: named },
      { kind: 'schedules', item_ids: [made.id ?? ''], mutation_id: mutationId },
    ];
  },
  'bookings.bookAsHost': async (m, mutationId) => {
    const page = await m.client.bookingPages.create({
      workspace: m.slug,
      id: newId(),
      title: 'Intro',
      timeZone: 'UTC',
      mutationId: newId(),
    });
    await m.client.bookings.bookAsHost({
      workspace: m.slug,
      idempotencyKey: newId(),
      pageId: page.id,
      start: new Date(Date.now() + 86_400_000).toISOString(),
      minutes: 30,
      name: 'Grace Hopper',
      // A free mail domain, so only the person is filed (no company).
      email: 'grace@gmail.com',
      timeZone: 'UTC',
      guests: [],
      mutationId,
    });
    return [{ kind: 'records', object_id: m.people.id, mutation_id: mutationId }];
  },
  'bookings.cancel': async (m, mutationId) => {
    const bookingId = await hostBooking(m);
    await m.client.bookings.cancel({ workspace: m.slug, bookingId, reason: 'Clash', mutationId });
    return [{ kind: 'records', object_id: m.people.id }];
  },
  // A no show (spec 0043): on a booking moved into the past by hand; settings like a cancel's, but no record changes.
  'bookings.markNoShow': async (m, mutationId) => {
    const bookingId = await hostBooking(m);
    await testQuery(
      ownerUrl,
      `update bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '90 minutes',
         during = tstzrange(now() - interval '2 hours', now() - interval '90 minutes', '[)') where id = $1`,
      [bookingId],
    );
    await m.client.bookings.markNoShow({ workspace: m.slug, bookingId, noShow: true, mutationId });
    // Only the booking's own row (its person filed by the host's booking): the mark itself stores none.
    return [{ kind: 'records', object_id: m.people.id }];
  },
  // A booking linked to a deal by hand (polish F2): settings like a no show, so the link stores no row of its own.
  'bookings.link': async (m, mutationId) => {
    const bookingId = await hostBooking(m);
    const deals = (await m.client.objects.list({ workspace: m.slug })).find((object) => object.standardKey === 'deals');
    if (deals?.primaryAttributeId === undefined) throw new Error('The template has no Deals.');
    const recordId = newId();
    // Named, since a deal's Name is required.
    await m.client.records.create({
      workspace: m.slug,
      objectId: deals.id,
      id: recordId,
      values: { [deals.primaryAttributeId]: 'Navy rollout' },
      mutationId: newId(),
    });
    await m.client.bookings.link({ workspace: m.slug, bookingId, recordId, mutationId });
    return [
      { kind: 'records', object_id: m.people.id },
      { kind: 'records', object_id: deals.id },
    ];
  },
  'bookings.move': async (m, mutationId) => {
    const bookingId = await hostBooking(m);
    // To a time the page offers (a move refuses any other), read first: a read, so no poke.
    const { slots } = await m.client.bookings.moveSlots({
      workspace: m.slug,
      bookingId,
      from: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      to: new Date(Date.now() + 16 * 86_400_000).toISOString(),
    });
    const start = slots[0]?.start;
    if (start === undefined) throw new Error('The page offers no time to move to.');
    await m.client.bookings.move({ workspace: m.slug, bookingId, start, mutationId });
    return [{ kind: 'records', object_id: m.people.id }];
  },
  'bookings.blocks.create': async (m, mutationId) => {
    await m.client.bookings.blocks.create({
      workspace: m.slug,
      id: newId(),
      kind: 'block',
      repeat: 'once',
      date: '2026-11-02',
      startMinute: 600,
      endMinute: 660,
      timeZone: 'UTC',
      mutationId,
    });
    return [];
  },
  'bookings.blocks.remove': async (m, mutationId) => {
    const block = await m.client.bookings.blocks.create({
      workspace: m.slug,
      id: newId(),
      kind: 'block',
      repeat: 'weekly',
      date: '2026-11-02',
      startMinute: 600,
      endMinute: 660,
      timeZone: 'UTC',
      mutationId: newId(),
    });
    await m.client.bookings.blocks.remove({ workspace: m.slug, id: block.id, mutationId });
    return [];
  },
  // Time off (spec 0037): one `time_off` row naming nothing, so open tabs read the Team week, time off and Host away
  // again.
  'timeOff.create': async (m, mutationId) => {
    await m.client.timeOff.create({
      workspace: m.slug,
      id: newId(),
      fromDate: '2030-11-03',
      toDate: '2030-11-07',
      reason: 'vacation',
      mutationId,
    });
    return [{ kind: 'time_off', item_ids: [], mutation_id: mutationId }];
  },
  'timeOff.update': async (m, mutationId) => {
    const made = await m.client.timeOff.create({
      workspace: m.slug,
      id: newId(),
      fromDate: '2030-11-03',
      toDate: '2030-11-07',
      reason: 'vacation',
      mutationId: newId(),
    });
    await m.client.timeOff.update({
      workspace: m.slug,
      id: made.entry.id,
      fromDate: '2030-11-04',
      toDate: '2030-11-07',
      reason: 'travel',
      updatedAt: made.entry.updatedAt,
      mutationId,
    });
    return [
      { kind: 'time_off', item_ids: [] },
      { kind: 'time_off', item_ids: [], mutation_id: mutationId },
    ];
  },
  'timeOff.delete': async (m, mutationId) => {
    const made = await m.client.timeOff.create({
      workspace: m.slug,
      id: newId(),
      fromDate: '2030-11-03',
      toDate: '2030-11-07',
      reason: 'sick',
      mutationId: newId(),
    });
    await m.client.timeOff.delete({ workspace: m.slug, id: made.entry.id, mutationId });
    return [
      { kind: 'time_off', item_ids: [] },
      { kind: 'time_off', item_ids: [], mutation_id: mutationId },
    ];
  },
  // Meeting limits (spec 0037): limits share time off's `time_off` row naming nothing, so open Limits sections read again.
  'limits.set': async (m, mutationId) => {
    await m.client.limits.set({ workspace: m.slug, perDay: 4, perWeek: 20, mutationId });
    return [{ kind: 'time_off', item_ids: [], mutation_id: mutationId }];
  },
  // The Team week (spec 0037): every write goes through the schedules' write path, so each stores a `schedules` row.
  'availability.setDay': async (m, mutationId) => {
    const set = await rosterDay(m, mutationId);
    return [{ kind: 'schedules', item_ids: [set.schedule.id], mutation_id: mutationId }];
  },
  'availability.copyWeek': async (m, mutationId) => {
    const set = await rosterDay(m, newId());
    await m.client.availability.copyWeek({
      workspace: m.slug,
      memberIds: [set.memberId],
      fromWeekStart: ROSTER_MONDAY,
      toWeekStart: rosterMonday(1),
      mutationId,
    });
    return [
      { kind: 'schedules', item_ids: [set.schedule.id] },
      { kind: 'schedules', item_ids: [set.schedule.id], mutation_id: mutationId },
    ];
  },
  'availability.setUsualHours': async (m, mutationId) => {
    const set = await rosterDay(m, newId());
    const nine = (): [string, string][] => [['09:00', '17:00']];
    await m.client.availability.setUsualHours({
      workspace: m.slug,
      memberIds: [set.memberId],
      weekly: {
        mon: [['10:00', '16:00']],
        tue: nine(),
        wed: nine(),
        thu: nine(),
        fri: nine(),
        sat: [],
        sun: [],
      },
      mutationId,
    });
    return [
      { kind: 'schedules', item_ids: [set.schedule.id] },
      { kind: 'schedules', item_ids: [set.schedule.id], mutation_id: mutationId },
    ];
  },
  // Imports (spec 0040): made, staged and started through the one write path; start and undo each start a job.
  'imports.create': async (m, mutationId) => {
    await importOf(m, mutationId);
    return [];
  },
  'imports.stage': async (m, mutationId) => {
    const importId = await importOf(m);
    await m.client.imports.stage({
      workspace: m.slug,
      importId,
      rows: [{ rowNumber: 2, values: { [m.attribute('job_title')]: 'Engineer', [m.attribute('name')]: 'Ada' } }],
      mutationId,
    });
    return [];
  },
  'imports.start': async (m, mutationId) => {
    const importId = await stagedImportOf(m);
    await m.client.imports.start({ workspace: m.slug, importId, mutationId });
    return [{ kind: 'jobs', mutation_id: mutationId }];
  },
  'imports.undo': async (m, mutationId) => {
    const importId = await stagedImportOf(m);
    const started = await m.client.imports.start({ workspace: m.slug, importId, mutationId: newId() });
    // An import still running can't be undone: its job cancelled first.
    await m.client.jobs.cancel({ workspace: m.slug, jobId: started.jobId ?? '', mutationId: newId() });
    // As if the job had written its row before the cancel: the undo has something to take back.
    await testQuery(ownerUrl, `update import_rows set outcome = 'created' where import_id = $1`, [importId]);
    await m.client.imports.undo({ workspace: m.slug, importId, mutationId });
    return [{ kind: 'jobs' }, { kind: 'jobs' }, { kind: 'jobs', mutation_id: mutationId }];
  },
  'exports.start': async (m, mutationId) => {
    await m.client.exports.start({
      workspace: m.slug,
      id: newId(),
      objectId: m.people.id,
      attributeIds: [m.attribute('name')],
      timeZone: 'UTC',
      mutationId,
    });
    return [{ kind: 'jobs', mutation_id: mutationId }];
  },
  // Background jobs (spec 0008): one jobs row per write, naming the job.
  'jobs.startTest': async (m, mutationId) => {
    const job = await m.client.jobs.startTest({ workspace: m.slug, id: newId(), items: 3, mutationId });
    return [{ kind: 'jobs', item_ids: [job.id], mutation_id: mutationId }];
  },
  'jobs.cancel': async (m, mutationId) => {
    const job = await m.client.jobs.startTest({ workspace: m.slug, id: newId(), items: 3, mutationId: newId() });
    await m.client.jobs.cancel({ workspace: m.slug, jobId: job.id, mutationId });
    return [
      { kind: 'jobs', item_ids: [job.id] },
      { kind: 'jobs', item_ids: [job.id], mutation_id: mutationId },
    ];
  },
  'jobs.confirm': async (m, mutationId) => {
    const job = await m.client.jobs.startTest({ workspace: m.slug, id: newId(), items: 3, mutationId: newId() });
    // Milestone 2 makes a ready job (a snapshot that waits for a confirm); here one is set by hand.
    await testQuery(
      ownerUrl,
      "update jobs set status = 'ready', expires_at = now() + interval '1 hour' where id = $1",
      [job.id],
    );
    await m.client.jobs.confirm({ workspace: m.slug, jobId: job.id, mutationId });
    return [
      { kind: 'jobs', item_ids: [job.id] },
      { kind: 'jobs', item_ids: [job.id], mutation_id: mutationId },
    ];
  },
};

/** A form on People, made through the procedures: draft, or published. */
async function formOn(m: Member, publish = false) {
  const form = await m.client.forms.create({
    workspace: m.slug,
    id: newId(),
    name: 'Contact us',
    mainObjectId: m.people.id,
    mutationId: newId(),
  });
  if (!publish) return form;
  return m.client.forms.publish({
    workspace: m.slug,
    formId: form.id,
    expectedRevision: form.revision,
    mutationId: newId(),
  });
}

/** A submission of the form, stored straight in the table as the owner, in `state`. */
async function storedSubmission(m: Member, formId: string, state: string, spam: object = {}): Promise<string> {
  const [row] = await testQuery<{ id: string }>(
    ownerUrl,
    `insert into form_submissions (workspace_id, form_id, version_id, idempotency_key, answers, state, spam)
     select f.workspace_id, f.id, f.live_version_id, gen_random_uuid(), '{}', $2, $3::jsonb from forms f where f.id = $1
     returning id::text`,
    [formId, state, JSON.stringify(spam)],
  );
  if (row === undefined) throw new Error('No submission stored.');
  return row.id;
}

// Forms (spec 0023): their writes store no outbox row of their own; a retry queues its job, whose row names it.
Object.assign(WRITES, {
  'forms.create': async (m: Member) => {
    await formOn(m);
    return [];
  },
  'forms.saveDraft': async (m: Member, mutationId: string) => {
    const form = await formOn(m);
    await m.client.forms.saveDraft({
      workspace: m.slug,
      formId: form.id,
      document: form.draft,
      expectedRevision: form.revision,
      mutationId,
    });
    return [];
  },
  'forms.publish': async (m: Member) => {
    await formOn(m, true);
    return [];
  },
  'forms.setStatus': async (m: Member, mutationId: string) => {
    const form = await formOn(m, true);
    await m.client.forms.setStatus({ workspace: m.slug, formId: form.id, status: 'paused', mutationId });
    return [];
  },
  'forms.updateSettings': async (m: Member, mutationId: string) => {
    const form = await formOn(m);
    await m.client.forms.updateSettings({
      workspace: m.slug,
      formId: form.id,
      slug: `a-${newId().slice(-8)}`,
      mutationId,
    });
    return [];
  },
  'forms.rotateSecret': async (m: Member, mutationId: string) => {
    const form = await formOn(m);
    await m.client.forms.rotateSecret({ workspace: m.slug, formId: form.id, mutationId });
    return [];
  },
  'forms.setTarget': async (m: Member, mutationId: string) => {
    const form = await formOn(m);
    await m.client.forms.setTarget({
      workspace: m.slug,
      formId: form.id,
      mainObjectId: m.companies.id,
      expectedRevision: form.revision,
      mutationId,
    });
    return [];
  },
  'forms.duplicate': async (m: Member, mutationId: string) => {
    const form = await formOn(m);
    await m.client.forms.duplicate({ workspace: m.slug, formId: form.id, id: newId(), mutationId });
    return [];
  },
  'forms.delete': async (m: Member, mutationId: string) => {
    const form = await formOn(m);
    await m.client.forms.delete({ workspace: m.slug, formId: form.id, mutationId });
    return [];
  },
  'submissions.release': async (m: Member, mutationId: string) => {
    const form = await formOn(m, true);
    const submissionId = await storedSubmission(m, form.id, 'spam');
    await m.client.submissions.release({ workspace: m.slug, submissionId, mutationId });
    return [{ kind: 'jobs', mutation_id: mutationId }];
  },
  'submissions.markSpam': async (m: Member, mutationId: string) => {
    const form = await formOn(m, true);
    const submissionId = await storedSubmission(m, form.id, 'failed');
    await m.client.submissions.markSpam({ workspace: m.slug, submissionId, mutationId });
    return [];
  },
  'submissions.resolve': async (m: Member, mutationId: string) => {
    const form = await formOn(m, true);
    const submissionId = await storedSubmission(m, form.id, 'needs_review', { verdict: 'review' });
    await m.client.submissions.resolve({
      workspace: m.slug,
      submissionId,
      resolution: { kind: 'not_spam' },
      mutationId,
    });
    return [{ kind: 'jobs', mutation_id: mutationId }];
  },
  'submissions.addToCrm': async (m: Member, mutationId: string) => {
    const form = await formOn(m, true);
    const submissionId = await storedSubmission(m, form.id, 'failed');
    await m.client.submissions.addToCrm({
      workspace: m.slug,
      formId: form.id,
      submissionIds: [submissionId],
      mutationId,
    });
    return [{ kind: 'jobs', mutation_id: mutationId }];
  },
  'submissions.export': async (m: Member, mutationId: string) => {
    const form = await formOn(m, true);
    await m.client.submissions.export({
      workspace: m.slug,
      id: newId(),
      formId: form.id,
      select: { kind: 'filter' },
      mutationId,
    });
    return [{ kind: 'jobs', mutation_id: mutationId }];
  },
  'forms.syncStart': async (m: Member, mutationId: string) => {
    const form = await formOn(m, true);
    await m.client.forms.syncStart({ workspace: m.slug, formId: form.id, scope: 'all', jobId: newId(), mutationId });
    return [{ kind: 'jobs', mutation_id: mutationId }];
  },
  'submissions.retry': async (m: Member, mutationId: string) => {
    const form = await formOn(m, true);
    const submissionId = await storedSubmission(m, form.id, 'failed');
    await m.client.submissions.retry({ workspace: m.slug, submissionId, mutationId });
    return [{ kind: 'jobs', mutation_id: mutationId }];
  },
  'submissions.delete': async (m: Member, mutationId: string) => {
    const form = await formOn(m, true);
    const submissionId = await storedSubmission(m, form.id, 'spam');
    await m.client.submissions.delete({ workspace: m.slug, submissionId, mutationId });
    return [];
  },
});

/** A rotation of the member and a second member, both with their own hours (spec 0029: a rotation needs 2). */
async function rotationOn(m: Member, mutationId = newId()) {
  // Hours seeded by hand (spec 0035's default schedules), so the only writes counted are the rotation's own.
  const availability = defaultAvailability('UTC');
  const [me] = await testQuery<{ id: string }>(
    ownerUrl,
    `select id::text from members where workspace_id = $1 and status = 'active' limit 1`,
    [m.workspace.id],
  );
  const other = newId();
  await testQuery(
    ownerUrl,
    `insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
     values ($1, $2, 'Kim Park', 'kim@acme.dev', 'member', 'system', 'system')`,
    [m.workspace.id, other],
  );
  await testQuery(
    ownerUrl,
    `insert into availability_schedules (workspace_id, member_id, name, is_default, availability, created_by_type, updated_by_type)
     values ($1, $2, 'Working hours', true, $4, 'system', 'system'), ($1, $3, 'Working hours', true, $4, 'system', 'system')`,
    [m.workspace.id, other, me?.id ?? '', JSON.stringify(availability)],
  );
  const pooled = (memberId: string) => ({
    memberId,
    weight: 100,
    priority: 2,
    dailyCap: null,
    weeklyCap: null,
    isOn: true,
  });
  return m.client.rotations.create({
    workspace: m.slug,
    id: newId(),
    settings: { name: 'Sales', strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'owner' },
    members: [pooled(me?.id ?? ''), pooled(other)],
    mutationId,
  });
}

/** A guest's booking on a round robin page of the member's rotation, at 10:00 UTC on the next weekday but one. */
async function teamBooking(m: Member): Promise<{ readonly bookingId: string; readonly rotationId: string }> {
  const rotation = await rotationOn(m);
  const page = await m.client.bookingPages.create({
    workspace: m.slug,
    id: newId(),
    title: 'Team call',
    timeZone: 'UTC',
    kind: 'round_robin',
    hosts: { fixed: [], rotations: [rotation.id] },
    mutationId: newId(),
  });
  const day = new Date(Date.now() + 2 * 86_400_000);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
  day.setUTCHours(10, 0, 0, 0);
  const booked = await bookPublicSlot(
    await enterBookingPage({ db }, page.publicKey),
    { calendar: NO_CALENDAR, linkKey: Buffer.alloc(32, 7) },
    {
      idempotencyKey: newId(),
      start: day.toISOString(),
      duration: 30,
      name: 'Grace Hopper',
      email: 'grace@navy.example',
      timeZone: 'UTC',
    },
  );
  return { bookingId: booked.bookingId, rotationId: rotation.id };
}

// Rotations (spec 0029): settings, not CRM data, so no outbox row; one poke per write.
Object.assign(WRITES, {
  // The seat to the other member of the rotation, the next in it (spec 0029, AC-748).
  'bookings.reassign': async (m: Member, mutationId: string) => {
    const { bookingId } = await teamBooking(m);
    await m.client.bookings.reassign({ workspace: m.slug, bookingId, mutationId });
    return [];
  },
  // A count adjustment, and one undone (spec 0037, AC-1329): settings like the rotation, so no outbox row.
  // A member's upcoming bookings in the rotation handed on (spec 0029, AC-750).
  'rotations.reassignUpcoming': async (m: Member, mutationId: string) => {
    const { bookingId, rotationId } = await teamBooking(m);
    const [host] = await testQuery<{ id: string }>(
      ownerUrl,
      `select host_member_id::text as id from bookings where id = $1`,
      [bookingId],
    );
    // Switched off first: a member still on would only be seated again.
    await testQuery(ownerUrl, `update rotation_members set is_on = false where rotation_id = $1 and member_id = $2`, [
      rotationId,
      host?.id ?? '',
    ]);
    await m.client.rotations.reassignUpcoming({ workspace: m.slug, rotationId, memberId: host?.id ?? '', mutationId });
    return [];
  },
  'rotations.adjust': async (m: Member, mutationId: string) => {
    const rotation = await rotationOn(m);
    const [first] = rotation.members;
    await m.client.rotations.adjust({
      workspace: m.slug,
      rotationId: rotation.id,
      memberId: first?.memberId ?? '',
      units: 2,
      note: 'Covered for Kim last week',
      mutationId,
    });
    return [];
  },
  'rotations.undoAdjustment': async (m: Member, mutationId: string) => {
    const rotation = await rotationOn(m);
    const [first] = rotation.members;
    const made = await m.client.rotations.adjust({
      workspace: m.slug,
      rotationId: rotation.id,
      memberId: first?.memberId ?? '',
      units: -1,
      note: 'Too many this week',
      mutationId: newId(),
    });
    await m.client.rotations.undoAdjustment({
      workspace: m.slug,
      rotationId: rotation.id,
      adjustmentId: made.id,
      mutationId,
    });
    return [];
  },
  'rotations.create': async (m: Member, mutationId: string) => {
    await rotationOn(m, mutationId);
    return [];
  },
  'rotations.update': async (m: Member, mutationId: string) => {
    const rotation = await rotationOn(m);
    await m.client.rotations.update({
      workspace: m.slug,
      rotationId: rotation.id,
      settings: { name: 'AEs' },
      mutationId,
    });
    return [];
  },
  'rotations.delete': async (m: Member, mutationId: string) => {
    const rotation = await rotationOn(m);
    await m.client.rotations.delete({ workspace: m.slug, rotationId: rotation.id, mutationId });
    return [];
  },
});

/** A comment by the member on a new person of theirs, made in its own write: its record and thread. */
async function commentOn(m: Member): Promise<{ readonly recordId: string; readonly threadId: string }> {
  const recordId = await personFor(m);
  const thread = await m.client.comments.create({
    workspace: m.slug,
    id: newId(),
    recordId,
    body: 'Hello',
    mutationId: newId(),
  });
  return { recordId, threadId: thread.id };
}

/** A notification for the member, stored by hand (the owner role): a mention by the system on a comment of theirs. */
async function notificationFor(m: Member): Promise<string> {
  const { recordId, threadId } = await commentOn(m);
  const [member] = await testQuery<{ id: string }>(
    ownerUrl,
    `select id::text from members where workspace_id = $1 and status = 'active' limit 1`,
    [m.workspace.id],
  );
  const id = newId();
  await testQuery(
    ownerUrl,
    `insert into notifications (workspace_id, id, member_id, kind, actor_type, record_id, thread_id, comment_id)
     values ($1, $2, $3, 'mention', 'system', $4, $5, $5)`,
    [m.workspace.id, id, member?.id ?? '', recordId, threadId],
  );
  return id;
}

// Comments and the inbox (spec 0038, AC-1167, AC-1183): one comments row per write naming the object, the record and
// the thread, and a notifications row naming only the members whose inbox or settings changed.
Object.assign(WRITES, {
  'comments.create': async (m: Member, mutationId: string) => {
    const recordId = await personFor(m);
    const thread = await m.client.comments.create({ workspace: m.slug, id: newId(), recordId, body: 'Hi', mutationId });
    return [
      { kind: 'records', record_ids: [recordId] },
      {
        kind: 'comments',
        object_id: m.people.id,
        record_ids: [recordId],
        item_ids: [thread.id],
        mutation_id: mutationId,
      },
    ];
  },
  'comments.update': async (m: Member, mutationId: string) => {
    const { recordId, threadId } = await commentOn(m);
    await m.client.comments.update({ workspace: m.slug, commentId: threadId, body: 'Edited', mutationId });
    return [
      { kind: 'records', record_ids: [recordId] },
      { kind: 'comments', item_ids: [threadId] },
      {
        kind: 'comments',
        object_id: m.people.id,
        record_ids: [recordId],
        item_ids: [threadId],
        mutation_id: mutationId,
      },
    ];
  },
  'comments.delete': async (m: Member, mutationId: string) => {
    const { recordId, threadId } = await commentOn(m);
    await m.client.comments.delete({ workspace: m.slug, commentId: threadId, mutationId });
    return [
      { kind: 'records', record_ids: [recordId] },
      { kind: 'comments', item_ids: [threadId] },
      {
        kind: 'comments',
        object_id: m.people.id,
        record_ids: [recordId],
        item_ids: [threadId],
        mutation_id: mutationId,
      },
    ];
  },
  'comments.resolve': async (m: Member, mutationId: string) => {
    const { recordId, threadId } = await commentOn(m);
    await m.client.comments.resolve({ workspace: m.slug, threadId, resolved: true, mutationId });
    return [
      { kind: 'records', record_ids: [recordId] },
      { kind: 'comments', item_ids: [threadId] },
      {
        kind: 'comments',
        object_id: m.people.id,
        record_ids: [recordId],
        item_ids: [threadId],
        mutation_id: mutationId,
      },
    ];
  },
  'comments.react': async (m: Member, mutationId: string) => {
    const { recordId, threadId } = await commentOn(m);
    await m.client.comments.react({ workspace: m.slug, commentId: threadId, emoji: '🎉', on: true, mutationId });
    return [
      { kind: 'records', record_ids: [recordId] },
      { kind: 'comments', item_ids: [threadId] },
      {
        kind: 'comments',
        object_id: m.people.id,
        record_ids: [recordId],
        item_ids: [threadId],
        mutation_id: mutationId,
      },
    ];
  },
  'notifications.mark': async (m: Member, mutationId: string) => {
    const id = await notificationFor(m);
    await m.client.notifications.mark({ workspace: m.slug, ids: [id], read: true, mutationId });
    return [
      { kind: 'records' },
      { kind: 'comments' },
      { kind: 'notifications', record_ids: [], mutation_id: mutationId },
    ];
  },
  'notifications.markAllRead': async (m: Member, mutationId: string) => {
    await notificationFor(m);
    await m.client.notifications.markAllRead({ workspace: m.slug, status: 'inbox', mutationId });
    return [
      { kind: 'records' },
      { kind: 'comments' },
      { kind: 'notifications', record_ids: [], mutation_id: mutationId },
    ];
  },
  'notifications.setSettings': async (m: Member, mutationId: string) => {
    await m.client.notifications.setSettings({ workspace: m.slug, emailReplies: true, mutationId });
    return [{ kind: 'notifications', record_ids: [], mutation_id: mutationId }];
  },
});

// Automations (parity #53): one `automations` row naming nothing, whatever the write changed.
const DUE_DEFINITION = {
  trigger: { kind: 'task_due' as const },
  actions: [{ kind: 'notify' as const, who: { kind: 'owner' as const }, message: 'Due' }],
};
Object.assign(WRITES, {
  'automations.create': async (m: Member, mutationId: string) => {
    await m.client.automations.create({ workspace: m.slug, id: newId(), definition: DUE_DEFINITION, mutationId });
    return [{ kind: 'automations', mutation_id: mutationId }];
  },
  'automations.update': async (m: Member, mutationId: string) => {
    const made = await m.client.automations.create({
      workspace: m.slug,
      id: newId(),
      definition: DUE_DEFINITION,
      mutationId: newId(),
    });
    await m.client.automations.update({
      workspace: m.slug,
      automationId: made.id,
      definition: DUE_DEFINITION,
      mutationId,
    });
    return [{ kind: 'automations' }, { kind: 'automations', mutation_id: mutationId }];
  },
  'automations.setEnabled': async (m: Member, mutationId: string) => {
    const made = await m.client.automations.create({
      workspace: m.slug,
      id: newId(),
      definition: DUE_DEFINITION,
      mutationId: newId(),
    });
    await m.client.automations.setEnabled({ workspace: m.slug, automationId: made.id, enabled: false, mutationId });
    return [{ kind: 'automations' }, { kind: 'automations', mutation_id: mutationId }];
  },
  'automations.remove': async (m: Member, mutationId: string) => {
    const made = await m.client.automations.create({
      workspace: m.slug,
      id: newId(),
      definition: DUE_DEFINITION,
      mutationId: newId(),
    });
    await m.client.automations.remove({ workspace: m.slug, automationId: made.id, mutationId });
    return [{ kind: 'automations' }, { kind: 'automations', mutation_id: mutationId }];
  },
  'automations.restore': async (m: Member, mutationId: string) => {
    const made = await m.client.automations.create({
      workspace: m.slug,
      id: newId(),
      definition: DUE_DEFINITION,
      mutationId: newId(),
    });
    await m.client.automations.remove({ workspace: m.slug, automationId: made.id, mutationId: newId() });
    await m.client.automations.restore({ workspace: m.slug, automationId: made.id, mutationId });
    return [{ kind: 'automations' }, { kind: 'automations' }, { kind: 'automations', mutation_id: mutationId }];
  },
});

/** How many writes (each one poke) a case in WRITES makes before and with its own. */
const WRITES_MADE: Readonly<Record<string, number>> = {
  // Webhooks (spec 0064): the endpoint made first (and a test event before a resend).
  'webhooks.update': 2,
  'webhooks.rotateSecret': 2,
  'webhooks.delete': 2,
  'webhooks.test': 2,
  'webhooks.resend': 3,
  // Lists (spec 0048): the list, its person and their entry first, then the case's own writes.
  'entries.add': 5,
  'entries.setValues': 5,
  'entries.remove': 4,
  'entries.restore': 5,
  // A team made first, then the write (spec 0031, slice 8).
  // A teammate invited and accepted first, then the write.
  'accessRules.set': 3,
  'teams.rename': 2,
  'teams.delete': 2,
  'teams.changeMembers': 2,
  'lists.update': 4,
  'lists.archive': 4,
  'lists.restore': 5,
  'entries.addMany': 5,
  'entries.addMatching': 4,
  'entries.removeMatching': 4,
  'entries.undoJob': 5,
  // Imports (spec 0040): the import made (and its rows staged) first, then the write.
  'automations.update': 2,
  'automations.setEnabled': 2,
  'automations.remove': 2,
  'automations.restore': 3,
  'imports.stage': 2,
  'imports.start': 3,
  'imports.undo': 5,
  'members.setRole': 3,
  'members.remove': 3,
  'members.leave': 3,
  'members.transferOwnership': 3,
  'scheduling.delegations.grant': 3,
  'scheduling.delegations.revoke': 4,
  'invitations.resend': 2,
  'invitations.revoke': 2,
  'invitations.accept': 2,
  // Domain join: the domains set first, then the request (and the decision).
  'join.request': 2,
  'joinRequests.decide': 3,
  'deletedWorkspace.restore': 2,
  'account.deletion.confirm': 3,
  'views.update': 2,
  'views.move': 3,
  'views.setLocked': 2,
  'views.setDefault': 2,
  'views.delete': 2,
  'records.setValues': 2,
  'records.setValuesBatch': 3,
  'records.deleteMany': 2,
  'records.restoreBatch': 3,
  'records.updateMany': 2,
  'records.startBulk': 2,
  'trash.deleteForever': 3,
  'trash.restore': 3,
  'jobs.cancel': 2,
  'jobs.confirm': 2,
  'tasks.create': 2,
  'tasks.update': 2,
  'tasks.delete': 2,
  'tasks.restore': 3,
  'notes.save': 2,
  'notes.delete': 3,
  'notes.restore': 4,
  'notes.link': 4,
  'comments.create': 2,
  'comments.update': 3,
  'comments.delete': 3,
  'comments.resolve': 3,
  'comments.react': 3,
  'notifications.mark': 3,
  'notifications.markAllRead': 3,
  'calendar.connections.update': 2,
  'calendar.connections.remove': 2,
  'calendar.connections.syncNow': 2,
  'calendar.meetings.addAttendee': 2,
  'calendar.connections.refresh': 2,
  'calendar.calendars.update': 2,
  'calendar.destination.set': 2,
  'calendar.destination.dismissNotice': 2,
  'calendar.pageDestination.set': 3,
  'bookingPages.update': 2,
  'rotations.create': 1,
  'bookings.reassign': 3,
  'rotations.adjust': 2,
  'rotations.reassignUpcoming': 3,
  'rotations.undoAdjustment': 3,
  'rotations.update': 2,
  'rotations.delete': 2,
  'bookingPages.delete': 2,
  'bookingPages.reorderProfile': 2,
  'profile.saveTheme': 2,
  'profile.setIndexable': 2,
  'profile.show': 2,
  'profile.setShareImage': 2,
  'profile.orderItems': 2,
  'profile.archiveItem': 2,
  'profile.deleteItem': 2,
  'bookings.blocks.remove': 2,
  'timeOff.update': 2,
  'timeOff.delete': 2,
  'availability.copyWeek': 2,
  'availability.setUsualHours': 2,
  'bookings.bookAsHost': 2,
  'bookings.cancel': 3,
  'bookings.markNoShow': 3,
  // The page, the booking and the deal, then the link.
  'bookings.link': 4,
  'bookings.move': 3,
  // A schedule made first, then the write (spec 0035).
  'schedules.update': 2,
  'schedules.setDefault': 2,
  'schedules.duplicate': 2,
  'schedules.delete': 2,
  'attributes.restore': 2,
  'relationships.update': 2,
  'links.add': 3,
  'links.remove': 4,
  'options.create': 2,
  'options.update': 2,
  'options.reorder': 2,
  'options.archive': 2,
  'options.restore': 3,
  'forms.saveDraft': 2,
  'forms.publish': 2,
  'forms.setStatus': 3,
  'forms.updateSettings': 2,
  'forms.rotateSecret': 2,
  'forms.setTarget': 2,
  'forms.duplicate': 2,
  'forms.delete': 2,
  'submissions.release': 3,
  'submissions.markSpam': 3,
  'submissions.resolve': 3,
  'submissions.addToCrm': 3,
  'submissions.export': 3,
  'forms.syncStart': 3,
  'submissions.retry': 3,
  'submissions.delete': 3,
};

// Teams (spec 0031, slice 8): every team write stores a `members` row (everyone's team list reads again), naming the
// people it changed and the writer; a change of people also stores the `access` row (their access, AC-825).
Object.assign(WRITES, {
  'teams.create': async (m: Member, mutationId: string) => {
    const me = (await m.client.access.mine({ workspace: m.slug })).memberId;
    await m.client.teams.create({ workspace: m.slug, name: 'Sales', mutationId });
    return [{ kind: 'members', item_ids: [me], mutation_id: mutationId }];
  },
  'teams.rename': async (m: Member, mutationId: string) => {
    const me = (await m.client.access.mine({ workspace: m.slug })).memberId;
    const team = await m.client.teams.create({ workspace: m.slug, name: 'Sales', mutationId: newId() });
    await m.client.teams.rename({ workspace: m.slug, teamId: team.id, name: 'Revenue', mutationId });
    return [{ kind: 'members' }, { kind: 'members', item_ids: [me], mutation_id: mutationId }];
  },
  'teams.delete': async (m: Member, mutationId: string) => {
    const me = (await m.client.access.mine({ workspace: m.slug })).memberId;
    const team = await m.client.teams.create({ workspace: m.slug, name: 'Sales', mutationId: newId() });
    await m.client.teams.delete({ workspace: m.slug, teamId: team.id, mutationId });
    return [{ kind: 'members' }, { kind: 'members', item_ids: [me], mutation_id: mutationId }];
  },
  'teams.changeMembers': async (m: Member, mutationId: string) => {
    const me = (await m.client.access.mine({ workspace: m.slug })).memberId;
    const team = await m.client.teams.create({ workspace: m.slug, name: 'Sales', mutationId: newId() });
    await m.client.teams.changeMembers({ workspace: m.slug, teamId: team.id, add: [me], mutationId });
    return [
      { kind: 'members' },
      { kind: 'members', item_ids: [me], mutation_id: mutationId },
      { kind: 'access', item_ids: [me], mutation_id: mutationId },
    ];
  },
});

// Access rules (spec 0032, AC-852): a rule change stores one `access` row naming the members the subject covers (a
// team with no one in it covers nobody, so a team's first rule stores none).
Object.assign(WRITES, {
  'accessRules.set': async (m: Member, mutationId: string) => {
    const mate = await teammate(m);
    // The Member role stops seeing People: its one member (the teammate) reads their access again.
    await m.client.accessRules.set({
      workspace: m.slug,
      objectId: m.people.id,
      subject: { type: 'role', role: 'member' },
      rule: { level: 'none', records: 'all' },
      mutationId,
    });
    return [{ kind: 'members' }, { kind: 'access', item_ids: [mate.memberId], mutation_id: mutationId }];
  },
});

describe('the one write path', () => {
  it('knows every procedure in the contract as a read or a write', () => {
    const unknown = paths(contract).filter((path) => !READS.has(path) && !(path in WRITES));
    expect(unknown).toEqual([]);
    expect(Object.keys(WRITES).filter((path) => READS.has(path))).toEqual([]);
  });

  it('builds hooks and pokes the relay only in hooks.ts: no module file does either by hand', async () => {
    const root = fileURLToPath(new URL('./modules/', import.meta.url));
    const files = (await readdir(root, { recursive: true })).filter((file) => file.endsWith('router.ts'));
    const sources = await Promise.all(files.map(async (file) => [file, await readFile(join(root, file), 'utf8')]));
    expect(sources.length).toBeGreaterThan(0);
    const byHand = sources
      .filter(([, source]) => /\bwriteHooks\b|\bwakeRelay\b|\boutboxHook\b/.test(source ?? ''))
      .map(([file]) => file);
    expect(byHand).toEqual([]);
  });

  it.each(Object.keys(WRITES))(
    '%s pokes the relay once its write commits, and stores one outbox row per object it touched',
    async (path) => {
      const m = await memberWithWorkspace(app);
      const write = WRITES[path];
      if (write === undefined) throw new Error(`No write named ${path}.`);
      const mutationId = newId();
      const before = pokes;
      const expected = await write(m, mutationId);
      // One poke per write the case made (setValues makes its record first).
      expect(pokes - before).toBe(WRITES_MADE[path] ?? 1);
      const rows = await outboxOf(m.workspace.id);
      expect(rows).toHaveLength(expected.length);
      expected.forEach((row, index) => expect(rows[index]).toMatchObject(row));
    },
  );

  it('pokes nothing, and stores nothing, for a refused write', async () => {
    const m = await memberWithWorkspace(app);
    const before = pokes;
    await failure(() =>
      m.client.records.create({ workspace: m.slug, objectId: newId(), id: newId(), mutationId: newId() }),
    );
    await failure(() =>
      m.client.attributes.create({
        workspace: m.slug,
        objectId: m.people.id,
        id: newId(),
        apiSlug: 'name',
        title: 'Name',
        type: 'text',
        mutationId: newId(),
      }),
    );
    expect(pokes).toBe(before);
    expect(await outboxOf(m.workspace.id)).toEqual([]);
  });
});
