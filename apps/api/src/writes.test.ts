// The one write path (spec 0005, AC-39), in the style of door.test.ts: every
// procedure in the contract is either a read or a write named here; every
// write goes through `commitWrite`, so it pokes the relay once its write
// commits (and not when refused); and each stores exactly one outbox row per
// object it touched, with its mutation id. A new write procedure fails here
// until it is added to WRITES, which proves it pokes.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contract, defaultAvailability } from '@crm/contracts';
import { newId, NO_CALENDAR } from '@crm/core';
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
  // Fails on purpose when switched on (spec 0010); it writes nothing either way.
  'system.testFault',
  'me.get',
  // The caller's own preference in schema auth (spec 0031, AC-802): no tenant change, no outbox row.
  'me.setLastWorkspace',
  // Your own account (spec 0033): sessions, step up and passkeys live in schema auth only, so no tenant change
  // and no outbox row. Deleting the account is the one account write (below): it leaves each workspace.
  'account.sessions.list',
  'account.sessions.revoke',
  'account.sessions.revokeOthers',
  'account.security.get',
  'account.stepUp.start',
  'account.stepUp.verify',
  'account.stepUp.passkeyOptions',
  'account.stepUp.verifyPasskey',
  'account.passkeys.rename',
  'account.passkeys.remove',
  'account.deletion.check',
  'workspaces.slugAvailable',
  'objects.list',
  'attributes.list',
  'members.list',
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
  'deletedWorkspace.deleted',
  'access.mine',
  // The roles every role picker offers (spec 0037, AC-1439).
  'roles.list',
  'records.query',
  'records.count',
  'records.groups',
  'records.get',
  'records.activity',
  'records.getTrashed',
  'records.search',
  'realtime.connectionToken',
  'realtime.subscriptionToken',
  'realtime.catchUp',
  'jobs.list',
  'jobs.get',
  // Imports and exports (spec 0040): one import or export, its staged rows and the far records it would link.
  'imports.get',
  'imports.rows',
  'imports.links',
  'exports.get',
  'usage.get',
  'views.list',
  'views.get',
  // The one view write with no outbox row (spec 0020, AC-488): the member's own last opened view.
  'views.markOpened',
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
  'bookings.list',
  'bookings.listAll',
  'bookings.meetings',
  'bookings.calendar',
  'home.teamToday',
  'home.metrics',
  'bookings.hours',
  // Where a booking could move (its page's slots), and the guest page's address: both read only.
  'bookings.moveSlots',
  'bookings.guestLink',
  // Availability schedules (spec 0035).
  'schedules.members',
  'schedules.list',
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
const invitationTokens = new Map<string, string>();
/** Sign in codes still go to Mailpit, where signIn reads them. */
const mailpit = createMailpitMailer({ url: MAILPIT_URL, from: 'Timefix <noreply@example.com>' });

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp(
    { db, identity },
    {},
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
  readonly record_ids: string[];
  readonly attribute_ids: string[];
  readonly item_ids: string[];
  readonly mutation_id: string | null;
}

async function outboxOf(workspaceId: string): Promise<OutboxRow[]> {
  return testQuery<OutboxRow & Record<string, unknown>>(
    ownerUrl,
    'select kind, object_id, record_ids, attribute_ids, item_ids, mutation_id from outbox where workspace_id = $1 order by seq',
    [workspaceId],
  );
}

type Member = Awaited<ReturnType<typeof memberWithWorkspace>>;

/** An import of one Job title column into People, made through the API (its own write first, unless it is the case's). */
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
      columns: [{ header: 'Job title', target: { attributeId: m.attribute('job_title') } }],
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
    rows: [{ rowNumber: 2, values: { [m.attribute('job_title')]: 'Engineer' } }],
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

const WRITES: Record<string, (m: Member, mutationId: string) => Promise<readonly Partial<OutboxRow>[]>> = {
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
    return [{ kind: 'members' }, { kind: 'members', item_ids: [mate.memberId], mutation_id: mutationId }];
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
  // Domain join (slice 6, AC-819, AC-820): settings and requests nobody's screen follows live, so no row, until an
  // approval brings someone in (one members row).
  'joinRequests.setDomains': async (m, mutationId) => {
    await m.client.joinRequests.setDomains({ workspace: m.slug, domains: ['example.com'], mutationId });
    return [];
  },
  'join.request': async (m) => {
    await m.client.joinRequests.setDomains({ workspace: m.slug, domains: ['example.com'], mutationId: newId() });
    const asker = await signIn(app);
    await rpcClient(app, asker.cookie).join.request({ workspaceId: m.workspace.id });
    return [];
  },
  'joinRequests.decide': async (m, mutationId) => {
    await m.client.joinRequests.setDomains({ workspace: m.slug, domains: ['example.com'], mutationId: newId() });
    const asker = await signIn(app);
    await rpcClient(app, asker.cookie).join.request({ workspaceId: m.workspace.id });
    const [request] = await m.client.joinRequests.list({ workspace: m.slug });
    await m.client.joinRequests.decide({ workspace: m.slug, requestId: request?.id ?? '', approve: true, mutationId });
    return [{ kind: 'members', mutation_id: mutationId }];
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
  // Calendar sync (spec 0024): a sharing change names the connection's meetings and their records; so does a
  // disconnect, for the meetings it removed.
  'calendar.connections.update': async (m, mutationId) => {
    const { connectionId, meetingId, recordId } = await heldMeeting(m);
    await m.client.calendar.connections.update({ workspace: m.slug, connectionId, sharing: 'private', mutationId });
    return [
      { kind: 'records', record_ids: [recordId] },
      { kind: 'meetings', item_ids: [meetingId], record_ids: [recordId], mutation_id: mutationId },
    ];
  },
  'calendar.connections.remove': async (m, mutationId) => {
    const { connectionId, meetingId, recordId } = await heldMeeting(m);
    await m.client.calendar.connections.remove({ workspace: m.slug, connectionId, mutationId });
    return [
      { kind: 'records', record_ids: [recordId] },
      { kind: 'meetings', item_ids: [meetingId], record_ids: [recordId], mutation_id: mutationId },
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
      rows: [{ rowNumber: 2, values: { [m.attribute('job_title')]: 'Engineer' } }],
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

/** How many writes (each one poke) a case in WRITES makes before and with its own. */
const WRITES_MADE: Readonly<Record<string, number>> = {
  // Imports (spec 0040): the import made (and its rows staged) first, then the write.
  'imports.stage': 2,
  'imports.start': 3,
  'imports.undo': 5,
  'members.setRole': 3,
  'members.remove': 3,
  'members.leave': 3,
  'members.transferOwnership': 3,
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
  'bookings.blocks.remove': 2,
  'bookings.bookAsHost': 2,
  'bookings.cancel': 3,
  'bookings.markNoShow': 3,
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
