// The access table walk (spec 0009, AC-135, AC-139): every service `@crm/core`
// exports either has an entry saying what it checks, or is named here as
// taking no scope; and every entry is refused to a principal without the
// access, before anything is written.
import { sql } from 'drizzle-orm';
import { PERMISSIONS, type GlobalSearchResults } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import * as core from '../index.ts';
import * as system from '../system.ts';
import { testScope } from '../testing.ts';
import type { EngineScope } from './mint.ts';
import { ACCESS_TABLE, type AccessEntry } from './table.ts';

/** Exported functions that take no scope: the door, pure helpers, the bootstrap (which mints its own) and the runner. */
const NO_SCOPE: ReadonlySet<string> = new Set([
  // The door and its entries mint scopes; they don't take one. NO_RULE_SOURCE is what the door reads rules from
  // until #24 stores them: the door's input, not a service.
  'enterWorkspace',
  'enterWithKey',
  'enterAsActor',
  'systemScope',
  'NO_RULE_SOURCE',
  // Before any workspace: the status check, the signed in account, the bootstrap.
  'getSystemStatus',
  'getMe',
  // Spec 0031: passes the door itself (`enterWorkspace`) before it writes the caller's own preference.
  'setLastWorkspace',
  'startWorkspace',
  'workspaceSlugAvailable',
  // Spec 0031: an invitation's token is its way in; they mint the workspace's scope through the door's
  // enterInvitation, and isInvitedEmail answers sign up's yes or no.
  'peekInvite',
  'acceptInvite',
  'isInvitedEmail',
  // Domain join (spec 0031, slice 6): the signed in person's own workspaces to ask, through the door's domain
  // lookup and a system scope in each.
  'listJoinable',
  'requestToJoin',
  // A deleted workspace's owner only (spec 0031, AC-823): it reads the owner row itself and mints their scope.
  'enterDeletedWorkspace',
  // The worker's purge of a deleted workspace past its window (AC-823): the database's purge functions guard it.
  'purgeWorkspace',
  // The signed in person's own sessions (spec 0033): the identity store, by their user id, before any workspace.
  'listMySessions',
  'revokeMySession',
  'revokeMyOtherSessions',
  'isFresh',
  'deviceLabel',
  'deviceParts',
  // The step up (spec 0033, milestone 2): the session's own freshness, by its user and session ids.
  'accountSecurity',
  'twoFactorRequiredBy',
  // Account deletion's join requests (spec 0033): the person's own, found by their user id, changed as the system.
  'closeJoinRequestsOf',
  // The person's own security history and the new device alert (spec 0033, AC-897, AC-898): by their user id.
  'listMyActivity',
  'alertNewDevice',
  'deviceKey',
  'sweepAccountHistory',
  'requireFresh',
  'sessionFreshness',
  'startStepUp',
  'verifyStepUp',
  // Deleting your own account (spec 0033): the person's own workspaces, each entered through the door.
  'accountDeletionCheck',
  'deleteMyAccount',
  'deletedEmail',
  'createWorkspace',
  'createUserWorkspace',
  // The operator console (spec 0047): before any workspace, behind the api's operator gate; it reads across
  // workspaces only through the crm_operator definers, which answer counts. periodDays is pure.
  'operatorOverview',
  'operatorUsers',
  'operatorUser',
  'operatorPages',
  'operatorPage',
  'operatorSite',
  'periodDays',
  // Pure access functions.
  'can',
  // History's row mapping (spec 0046): a stored audit row and its names to an entry view, after the read's door.
  'toEntryView',
  // Calendar health's reach (spec 0037, AC-1307), read off a scope readCalendarHealth checks, and a colour mapping.
  'healthReach',
  'nearestHue',
  'objectLevel',
  'fieldLevel',
  'recordRule',
  'visibleAttributes',
  'filterRecordView',
  'readOnlyReason',
  'keyAccess',
  'policyKey',
  'filterEvent',
  'eventFacts',
  // Ids, cursors and refusals.
  'newId',
  'isUuidV7',
  'cursorBinding',
  'encodeCursor',
  'decodeCursor',
  'inputInvalid',
  'isInputError',
  'isRefusal',
  // The write path's own parts: hooks run inside the runner, which stays inside the package.
  'capChange',
  'cappedHook',
  'outboxHook',
  'outboxEvents',
  // The first record milestone's hook (spec 0010, AC-176): it runs inside the write, after the door let it in.
  'milestoneHook',
  // Change events as pure data (spec 0007): rows to events, the stub, the wire shape, catch up's collapse, and
  // the caller as an audience of one.
  'outboxEvent',
  'planDelivery',
  'workspaceEvent',
  'isAudiencesNeedChannels',
  'stubEvent',
  'wireEvent',
  'createCollapse',
  'audienceOf',
  // Background jobs (spec 0008): `startJob` runs inside the caller's write (its context carries the scope the
  // feature's own door made); the rest are the kinds, the registry, the runner's factory and pure helpers.
  'startJob',
  'toJobView',
  'isOverdue',
  'createRegistry',
  'defineKind',
  'kindContractProblems',
  'jobKinds',
  // Imports (spec 0040): the import and undo kinds, run by the runner as their starter.
  'recordsImport',
  'recordsImportUndo',
  'recordsExport',
  'createRunner',
  'retryDelayMs',
  // The daily cleanup's fan out (`@crm/core/system`): it takes the worker's deps and enters each workspace as the
  // system through the `systemScope` it is handed; its once key is a pure helper.
  'runDailyCleanup',
  'maintenanceKey',
  // Calendar sync (spec 0024): the worker's sync takes its deps and enters as the system through the
  // `systemScope` it is handed; the rest are pure (provider errors, emails, signed values, the token key).
  'syncConnection',
  'isProviderError',
  'providerError',
  'failureOf',
  'normaliseEmail',
  'signValue',
  'verifyValue',
  'deriveKey',
  'decodeTokenKey',
  // Forms (spec 0023): the public key's door, the form job's parts (the kind, its step and the owner seam, which
  // run inside the job's write as the system), a new key, and the pattern engine the submit check runs with.
  'enterPublicForm',
  'formsProcess',
  'processSubmission',
  'chooseOwner',
  'newPublicKey',
  // The visitor a form hands to a booking page, read from its answers: a pure helper, no scope.
  'visitorOf',
  // A workspace's public key for a snippet's tagging: a one way digest of its id, no scope.
  'workspacePublicKey',
  // Booking pages (spec 0025): the busy cache wraps the reader the api passes in; it takes no scope. The connected
  // calendar reads a host's connections as the system for the public page, which has no scope of its own.
  'createBusyCache',
  'connectedCalendar',
  // Booking changes (spec 0025, milestone 2): moving, cancelling and the move slots read take the target a door
  // made (hostTarget, which checks booking.manage, or the guest's token entry), not a scope, and the row decides
  // which bookings. The booking mail job's parts run as the system in the booking's workspace; its when line is pure.
  'cancelBooking',
  'moveBooking',
  'readMoveSlots',
  'prepareBookingMail',
  'markGuestsTold',
  'whenLine',
  // Round robin (spec 0029, AC-749): the booking mail job's needs_host step hands a leaving member's booking on, as
  // the system in its workspace.
  'handOnBooking',
  'remakeEvent',
  // Lead routing (spec 0043): the report checks its surface (the form's or page's own access) itself; the route and
  // the record facts it reads are pure. (A no show is marked through the booking's target: in the table.)
  'routingReport',
  'decideRoute',
  'recordFactKeys',
  // The notifications email (spec 0038): the worker's task parts, run as the member the door entered for it, on
  // that member's own rows only.
  'prepareNotificationEmail',
  'markEmailed',
  'releaseEmailed',
  'queueNextEmail',
  // Calendar sync milestones 2 and 3 (spec 0024): a push notice comes from outside any workspace and reads as the
  // system in the one its channel token names; the events factory takes no scope (its services run as the system).
  'takeCalendarNotice',
  'createCalendarEvents',
  'calendarEventsScope',
  // The visitor's calendar (spec 0028): the overlay is pure, and the token seal is the one calendar sync uses,
  // bound here to the guest's cookie rather than a workspace.
  'overlay',
  'sealTokens',
  'openTokens',
  // Queued email (the emails lane): the queue functions run inside the caller's own transaction, after its own
  // check (they take its `tx`, never a scope), and the key is pure. The worker's half (load, finish) runs as the
  // system in the email's workspace, and a preferences link's token is signed and read with the key passed in.
  'emailKey',
  'queueEmail',
  'queueEmails',
  'queueFormSubmissionNotice',
  'queueFormConfirmation',
  'queueCalendarDisconnected',
  'queueBookingCalendarRemoved',
  'queueImportFinished',
  'loadEmail',
  'finishEmail',
  'emailLinkToken',
  'readEmailLinkToken',
  // Availability schedules (spec 0035): the resolvers run inside a caller's transaction (the slot read), no scope.
  'defaultSchedule',
  'scheduleFor',
  // Home's metrics cache (spec 0041): a factory the api makes once, no scope.
  'createHomeMetricsCache',
  // A person's own account picture from our origin (23 Oct 2026): which of Google's pictures to serve, and its
  // version, from the session's user; pure, no scope.
  'servedPicture',
]);

const exported = { ...core, ...system } as Record<string, unknown>;
const functions = Object.keys(exported).filter((name) => typeof exported[name] === 'function');

describe('the access table', () => {
  it('has an entry for every exported service, and none for anything else', () => {
    const unlisted = functions.filter((name) => !NO_SCOPE.has(name) && !Object.hasOwn(ACCESS_TABLE, name));
    expect(unlisted).toEqual([]);
    const stale = Object.keys(ACCESS_TABLE).filter((name) => !functions.includes(name));
    expect(stale).toEqual([]);
    const both = functions.filter((name) => NO_SCOPE.has(name) && Object.hasOwn(ACCESS_TABLE, name));
    expect(both).toEqual([]);
  });
});

const { appUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-table-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
/** A workspace (its owner made it) with a second member of `role`, and that member's scope. */
async function memberOf(role: 'admin' | 'member') {
  made += 1;
  const created = await core.createWorkspace(db, {
    name: 'Table',
    slug: `table-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const memberId = core.newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${memberId}, 'Bea', 'bea@example.com', ${role}, 'system', 'system')`,
    ),
  );
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: memberId }, role });
  return { ...created, ownerId: created.memberId, memberId, scope };
}

type Service = (scope: EngineScope, ...rest: unknown[]) => Promise<unknown>;
const service = (name: string) => exported[name] as Service;

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (core.isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

const entries = Object.entries(ACCESS_TABLE) as [string, AccessEntry][];

/** The input an any member service needs to run at all (the inbox's own reads and changes, spec 0038). */
const ANY_MEMBER_INPUT: Readonly<Record<string, unknown>> = {
  listNotifications: { status: 'inbox' },
  markNotifications: { ids: [] },
  markAllRead: { status: 'inbox' },
  setNotificationSettings: { digest: false },
};

describe('the walk: a principal without the access is refused', () => {
  const byPermission = entries.filter(
    (entry): entry is [string, { readonly permission: core.Access['permissions'][number] }] => 'permission' in entry[1],
  );

  it.each(byPermission)('%s refuses a member without %o, FORBIDDEN with the catalog sentence', async (name, entry) => {
    const { scope } = await memberOf('member');
    expect(await refusalOf(service(name)(scope, {}))).toEqual({
      code: 'FORBIDDEN',
      message: PERMISSIONS[entry.permission].message,
    });
  });

  // History's Workspace changes (spec 0046, AC-4622): the audit log is in the walk above, owners and admins only.
  it('walks listAuditEvents as audit.read, refused to a member', async () => {
    expect(byPermission).toContainEqual(['listAuditEvents', { permission: 'audit.read' }]);
    const { scope } = await memberOf('member');
    expect(await refusalOf(core.listAuditEvents(scope))).toEqual({
      code: 'FORBIDDEN',
      message: 'Only workspace owners and admins can see workspace changes.',
    });
  });

  it.each(entries.filter(([, entry]) => 'ownerRules' in entry).map(([name]) => name))(
    '%s refuses a member acting on someone else',
    async (name) => {
      const { scope, ownerId } = await memberOf('member');
      expect(await refusalOf(service(name)(scope, { memberId: ownerId, role: 'member' }))).toMatchObject({
        code: 'FORBIDDEN',
      });
    },
  );

  it.each(entries.filter(([, entry]) => 'system' in entry).map(([name]) => name))(
    '%s refuses anyone but the system',
    async (name) => {
      const { scope } = await memberOf('admin');
      await expect(service(name)(scope)).rejects.toThrow(/Only the system/);
    },
  );

  it.each(entries.filter(([, entry]) => 'jobStarter' in entry).map(([name]) => name))(
    '%s finds no job a member didn’t start (NOT_FOUND), and lists none of them',
    async (name) => {
      const { scope, workspaceId, ownerId } = await memberOf('member');
      const registry = core.jobKinds({ environment: 'local' });
      const owner = testScope({ db, workspaceId, actor: { type: 'member', id: ownerId } });
      const job = await core.startTestJob(owner, registry, { id: core.newId(), items: 1, batchMillis: 0 });
      const call = service(name) as unknown as (...args: unknown[]) => Promise<unknown>;
      if (name === 'listJobs') {
        const listed = (await call(scope, registry, { scope: 'mine' })) as { jobs: { id: string }[] };
        expect(listed.jobs.map((each) => each.id)).not.toContain(job.id);
        return;
      }
      expect(await refusalOf(call(scope, registry, job.id))).toMatchObject({ code: 'NOT_FOUND' });
    },
  );

  it.each(entries.filter(([, entry]) => 'ownConnection' in entry).map(([name]) => name))(
    '%s refuses an API key, and finds no connection of another member (NOT_FOUND)',
    async (name) => {
      const { scope, workspaceId, ownerId } = await memberOf('member');
      const tokenKey = core.decodeTokenKey(Buffer.alloc(32, 7).toString('base64'));
      const exchanged = {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        accountEmail: 'owner@example.com',
      };
      const owner = testScope({ db, workspaceId, actor: { type: 'member', id: ownerId } });
      const theirs = await core.connectCalendar(owner, { provider: 'google', exchanged, tokenKey });
      // Their main calendar (spec 0024 milestone 5), for the services that name a calendar.
      const [calendar] = (await core.listMemberCalendars(owner)).accounts.flatMap((account) => account.calendars);
      const key = testScope({ db, workspaceId, actor: { type: 'api_key', id: core.newId() } });
      const call = service(name) as unknown as (...args: unknown[]) => Promise<unknown>;
      const input =
        name === 'connectCalendar'
          ? { provider: 'google', exchanged: { ...exchanged, accountEmail: 'bea@example.com' }, tokenKey }
          : { connectionId: theirs.id, calendarId: calendar?.id, sharing: 'private', showInWeek: false };
      expect(await refusalOf(call(key, input))).toMatchObject({ code: 'FORBIDDEN' });
      if (name === 'connectCalendar') return;
      expect(await refusalOf(call(scope, input))).toMatchObject({ code: 'NOT_FOUND' });
    },
  );

  it.each(entries.filter(([, entry]) => 'ownNav' in entry).map(([name]) => name))(
    '%s keeps to the caller’s own sidebar: a key reads the defaults and can’t change one',
    async (name) => {
      const { scope, workspaceId, ownerId } = await memberOf('member');
      const owner = testScope({ db, workspaceId, actor: { type: 'member', id: ownerId } });
      await core.changeNav(owner, { op: 'rail', on: true });
      const key = testScope({ db, workspaceId, actor: { type: 'api_key', id: core.newId() } });
      if (name === 'changeNav') {
        expect(await refusalOf(core.changeNav(key, { op: 'rail', on: true }))).toMatchObject({ code: 'FORBIDDEN' });
        return;
      }
      expect((await core.readNav(key)).rail).toBe(false);
      // Another member never sees the owner's rail: each reads their own row.
      expect((await core.readNav(scope)).rail).toBe(false);
      expect((await core.readNav(owner)).rail).toBe(true);
    },
  );

  it.each(entries.filter(([, entry]) => 'publicForm' in entry).map(([name]) => name))(
    '%s refuses any scope but its form’s public one',
    async (name) => {
      const { scope } = await memberOf('admin');
      await expect(
        service(name)(scope, core.jobKinds({ environment: 'local' }), { formId: core.newId() }),
      ).rejects.toThrow(/Only the form’s own public scope/);
    },
  );

  it.each(entries.filter(([, entry]) => 'bookingPages' in entry).map(([name]) => name))(
    '%s refuses a principal without booking.manage, and answers another member’s page as absent',
    async (name) => {
      const { scope, workspaceId, ownerId } = await memberOf('member');
      const key = testScope({ db, workspaceId, actor: { type: 'api_key', id: core.newId() }, scopes: [] });
      // Through a promise, since a change target is made at once (hostTarget throws rather than rejects), and
      // with an empty input too, for the services that take their deps before it (bookingGuestPath).
      expect(await refusalOf(Promise.resolve().then(() => service(name)(key, {}, {})))).toEqual({
        code: 'FORBIDDEN',
        message: PERMISSIONS['booking.manage'].message,
      });
      if (
        [
          'listBookingPages',
          'listWorkspaceBookings',
          'listMeetings',
          'readBookingsCalendar',
          'readTeamToday',
          'createBookingPage',
          'createTimeBlock',
          'removeTimeBlock',
          'bookAsHost',
          // A member's change target and the guest link name a booking, not a page; the row decides (change.test.ts).
          'hostTarget',
          'bookingGuestPath',
          // So do a no show (routing.test.ts) and a hand link to a record, then the record's own access
          // (change.test.ts: the booking another member's, the record hidden, read only or in another workspace).
          'markNoShow',
          'linkBookingRecord',
          // Rotations aren't pages: a member lists only the ones they're in (rotations.test.ts); a booking's
          // assignments are its host's (assignments are checked on the row, rotations.test.ts); a reassign is checked
          // on the booking and over both hosts (rotation.test.ts).
          'listRotations',
          'bookingAssignments',
          'reassignBooking',
          // A rotation's distribution: checked on the rotation (rotation.test.ts).
          'rotationDistribution',
        ].includes(name)
      )
        return;
      const owner = testScope({ db, workspaceId, actor: { type: 'member', id: ownerId } });
      const page = await core.createBookingPage(owner, { id: core.newId(), title: 'Intro', timeZone: 'UTC' });
      expect(
        await refusalOf(
          // `pageIds` for the profile order, which names the owner's page in a new order of the member's.
          service(name)(scope, { pageId: page.id, pageIds: [page.id], settings: {}, when: 'upcoming' }),
        ),
      ).toMatchObject({ code: 'NOT_FOUND' });
    },
  );

  it.each(entries.filter(([, entry]) => 'schedules' in entry).map(([name]) => name))(
    '%s refuses a principal without booking.manage, and answers another member and their schedule as absent',
    async (name) => {
      const { scope, workspaceId, ownerId } = await memberOf('member');
      const key = testScope({ db, workspaceId, actor: { type: 'api_key', id: core.newId() }, scopes: [] });
      expect(await refusalOf(service(name)(key, { timeZone: 'UTC', id: core.newId(), name: 'X' }))).toEqual({
        code: 'FORBIDDEN',
        message: PERMISSIONS['booking.manage'].message,
      });
      if (['readDefaultHours', 'saveDefaultHours'].includes(name)) return;
      // Whose schedules a plain member may view: their own alone, never a colleague's.
      if (name === 'listScheduleMembers') {
        const answer = (await service(name)(scope)) as { readonly members: readonly { readonly id: string }[] };
        const me = scope.access.principal.kind === 'member' ? scope.access.principal.memberId : undefined;
        expect(answer.members.map((each) => each.id)).toEqual([me]);
        return;
      }
      const owner = testScope({ db, workspaceId, actor: { type: 'member', id: ownerId } });
      const theirs = await core.createSchedule(owner, { id: core.newId(), name: 'Evenings', timeZone: 'UTC' });
      if (['listSchedules', 'createSchedule'].includes(name)) {
        expect(
          await refusalOf(service(name)(scope, { memberId: ownerId, timeZone: 'UTC', id: core.newId(), name: 'Mine' })),
        ).toMatchObject({ code: 'NOT_FOUND' });
        return;
      }
      expect(
        await refusalOf(
          service(name)(scope, { id: theirs.id, newId: core.newId(), updatedAt: theirs.updatedAt, name: 'Y' }),
        ),
      ).toMatchObject({ code: 'NOT_FOUND' });
    },
  );

  it.each(entries.filter(([, entry]) => 'anyMember' in entry).map(([name]) => name))(
    '%s answers any member',
    async (name) => {
      const { scope } = await memberOf('member');
      await expect(Promise.resolve(service(name)(scope, ANY_MEMBER_INPUT[name]))).resolves.toBeDefined();
    },
  );

  // Data levels (spec 0009, milestone 2): each data service, called by a principal at less than the level it
  // needs on People (and its list), answers as absent (a read) or refuses the change (a write).
  const dataEntries = entries.flatMap(([name, entry]) => ('data' in entry ? [[name, entry.data] as const] : []));

  it('has a case for every data entry, and none for anything else', () => {
    expect(dataEntries.map(([name]) => name).sort()).toEqual(Object.keys(DATA_CASES).sort());
  });

  it.each(dataEntries)('%s answers as absent to a principal at less than %s', async (name, level) => {
    const world = await dataWorld();
    const test = DATA_CASES[name];
    if (test === undefined) throw new Error(`${name} has no case.`);
    const scope = level === 'read' ? world.hidden : world.readOnly;
    const outcome = await settle(test.call(scope, world));
    if (test.expect === 'empty') {
      expect(outcome).toMatchObject({ ok: true });
      expect((test.leaves ?? none)(outcome.ok ? outcome.value : undefined, world)).toBe(true);
    } else {
      expect(outcome).toMatchObject({ ok: false, refusal: { code: test.expect } });
    }
    // The owner (the open policy) is let through the same call.
    const asOwner = await settle(test.call(world.owner, world));
    expect(asOwner.ok || !['NOT_FOUND', 'FORBIDDEN'].includes(asOwner.refusal.code)).toBe(true);
  });
});

/** A workspace whose People object a member can't see, and one where they may only read it (and its list). */
async function dataWorld() {
  const { scope: memberScope, workspaceId, objects, ownerId } = await memberOf('member');
  const people = objects.people ?? '';
  const owner = testScope({ db, workspaceId, actor: { type: 'member', id: ownerId } });
  const attributes = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{ id: string; api_slug: string }>(
      sql`select id::text, api_slug from attributes where object_id = ${people}`,
    ),
  );
  const attribute = (slug: string) => attributes.rows.find((row) => row.api_slug === slug)?.id ?? '';
  const stage = (
    await core.defineAttribute(owner, { objectId: people, apiSlug: 'stage', title: 'Stage', type: 'status' })
  ).attributeId;
  const recordId = (
    await core.createRecord(owner, {
      objectId: people,
      values: { [attribute('name')]: { firstName: 'Pilot' }, [attribute('job_title')]: 'Pilot' },
    })
  ).recordId;
  const trashedId = (
    await core.createRecord(owner, { objectId: people, values: { [attribute('name')]: { firstName: 'Gone' } } })
  ).recordId;
  await core.deleteRecord(owner, { recordId: trashedId });
  const { listId } = await core.defineList(owner, { objectId: people, apiSlug: 'crew', name: 'Crew' });
  const { entryId } = await core.addEntry(owner, { listId, recordId });
  const peopleView =
    (
      await db.withWorkspace(workspaceId, (tx) =>
        tx.execute<{ id: string }>(sql`select default_view_id::text as id from objects where id = ${people}`),
      )
    ).rows[0]?.id ?? '';
  const taskId = (
    await core.createTask(owner, {
      id: core.newId(),
      title: 'Call back',
      recordIds: [recordId],
      assigneeMemberId: ownerId,
    })
  ).id;
  const noteId = (
    await core.saveNote(owner, {
      id: core.newId(),
      recordId,
      title: 'Call notes',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
    })
  ).note.id;
  // A thread on that person (spec 0038).
  const thread = await core.createComment(owner, { id: core.newId(), recordId, body: 'First thoughts' });
  const threadId = thread.id;
  const commentId = thread.comments[0]?.id ?? '';
  const member = memberScope.actor;
  const objectRule = (objectId: string, level: string) => ({
    subject: { type: 'role' as const, role: 'member' },
    target: { type: 'object' as const, objectId },
    level,
  });
  const hidden = testScope({
    db,
    workspaceId,
    actor: member,
    role: 'member',
    rules: { levels: [objectRule(people, 'none')], records: [] },
  });
  const readOnly = testScope({
    db,
    workspaceId,
    actor: member,
    role: 'member',
    rules: { levels: [objectRule(people, 'read'), objectRule(listId, 'read')], records: [] },
  });
  // A form on People with one submission (spec 0023).
  const form = await core.createForm(owner, { id: core.newId(), name: 'Pilot form', mainObjectId: people });
  const live = await core.publishForm(owner, { formId: form.id, expectedRevision: form.revision });
  const visitor = await core.enterPublicForm({ db }, live.publicKey);
  await core.submitForm(visitor.scope, core.jobKinds({ environment: 'local' }), {
    formId: form.id,
    body: {
      idempotencyKey: core.newId(),
      versionNumber: 1,
      answers: { name: 'Pilot', email: 'pilot@example.com' },
      hidden: {},
      fillMs: 10_000,
    },
    captcha: { kind: 'off' },
  });
  const submissionId =
    (
      await db.withWorkspace(workspaceId, (tx) =>
        tx.execute<{ id: string }>(sql`select id::text from form_submissions where form_id = ${form.id}`),
      )
    ).rows[0]?.id ?? '';
  return {
    owner,
    hidden,
    readOnly,
    people,
    formId: form.id,
    submissionId,
    name: attribute('name'),
    jobTitle: attribute('job_title'),
    company: attribute('company'),
    associatedDeals: attribute('associated_deals'),
    stage,
    recordId,
    trashedId,
    listId,
    entryId,
    peopleView,
    taskId,
    noteId,
    threadId,
    commentId,
  };
}
type DataWorld = Awaited<ReturnType<typeof dataWorld>>;

type Outcome =
  | { readonly ok: true; readonly value: unknown; readonly refusal?: undefined }
  | { readonly ok: false; readonly refusal: { readonly code: string } };

/** A call's result, or its refusal (a batch's first refused record counts as its refusal). */
async function settle(call: Promise<unknown>): Promise<Outcome> {
  try {
    const value = await call;
    if (Array.isArray(value) && value.length === 1) {
      const [only] = value as unknown[];
      // A batch's one outcome: the engine's (`ok: false`) or the service's (refusals and no record).
      const isRefused =
        typeof only === 'object' &&
        only !== null &&
        'refusals' in only &&
        (('ok' in only && only.ok === false) || (!('ok' in only) && !('record' in only)));
      if (isRefused) {
        const [first] = only.refusals as { code: string }[];
        if (first !== undefined) return { ok: false, refusal: first };
      }
    }
    return { ok: true, value };
  } catch (error) {
    if (core.isRefusal(error)) return { ok: false, refusal: error.refusal };
    throw error;
  }
}

interface DataCase {
  readonly call: (scope: EngineScope, world: DataWorld) => Promise<unknown>;
  /** A refusal code, or `empty`: answered, with the hidden thing left out (`leaves`). */
  readonly expect: 'NOT_FOUND' | 'FORBIDDEN' | 'empty';
  readonly leaves?: (value: unknown, world: DataWorld) => boolean;
}

const none = (value: unknown) => Array.isArray(value) && value.length === 0;
const empty = (call: DataCase['call'], leaves: DataCase['leaves'] = none): DataCase => ({
  call,
  expect: 'empty',
  leaves,
});
const refused = (code: 'NOT_FOUND' | 'FORBIDDEN', call: DataCase['call']): DataCase => ({ call, expect: code });
const named = (world: DataWorld) => ({ [world.name]: { value: 'Renamed' } });

/** An import of one People row the owner made and staged, for the cases that need one. */
async function ownerImport(world: DataWorld): Promise<string> {
  const id = core.newId();
  await core.createImport(world.owner, {
    id,
    objectId: world.people,
    fileName: 'people.csv',
    rowCount: 1,
    errorRows: 0,
    settings: importSettings(world),
  });
  await core.stageImportRows(world.owner, {
    importId: id,
    rows: [{ rowNumber: 2, values: { [world.name]: { firstName: 'Ada' } } }],
  });
  return id;
}

/** One column, the name, and every row new. */
const importSettings = (world: DataWorld) => ({
  columns: [{ header: 'Name', target: { attributeId: world.name } }],
  onMatch: 'fill' as const,
  onNoMatch: 'create' as const,
});

/** An export of the world's form the owner started, written (its row count set), made once per world. */
async function ownerExport(world: DataWorld): Promise<string> {
  const exportId = `${world.formId.slice(0, 24)}0000000000e1`;
  await core.startSubmissionsExport(world.owner, core.jobKinds({ environment: 'local' }), {
    id: exportId,
    formId: world.formId,
    select: { kind: 'filter' },
  });
  await db.withWorkspace(world.owner.workspaceId, (tx) =>
    tx.execute(sql`update exports set row_count = 0 where id = ${exportId}`),
  );
  return exportId;
}

/** A meeting on the world's record with one attendee the CRM doesn't know, made once per world. */
async function meetingOn(world: DataWorld): Promise<string> {
  const meetingId = `${world.recordId.slice(0, 24)}000000000001`;
  await db.withWorkspace(world.owner.workspaceId, async (tx) => {
    await tx.execute(sql`
      insert into meetings (workspace_id, id, ical_uid, title, starts_at, ends_at, created_by_type, updated_by_type)
      values (${world.owner.workspaceId}, ${meetingId}, ${`uid-${meetingId}`}, 'Intro', now(), now(), 'calendar', 'calendar')
      on conflict do nothing
    `);
    await tx.execute(sql`
      insert into meeting_records (workspace_id, meeting_id, record_id, via, starts_at)
      values (${world.owner.workspaceId}, ${meetingId}, ${world.recordId}, 'attendee', now()) on conflict do nothing
    `);
    await tx.execute(sql`
      insert into meeting_attendees (workspace_id, meeting_id, email, position, match)
      values (${world.owner.workspaceId}, ${meetingId}, 'cy@northwind.com', 0, 'unknown') on conflict do nothing
    `);
  });
  return meetingId;
}

/** A restore's outcomes, its first refusal thrown as the call's own (a batch of one). */
function refusedOutcome(outcomes: readonly core.RestoreOutcome[]): readonly core.RestoreOutcome[] {
  const refusal = outcomes.find((outcome) => outcome.refusal !== undefined)?.refusal;
  if (refusal === undefined) return outcomes;
  throw Object.assign(new Error(refusal.message), { refusal, refusals: [refusal] });
}

/** The delete batch the world's trashed record carries. */
async function batchOf(world: DataWorld): Promise<string> {
  const rows = await db.withWorkspace(world.owner.workspaceId, (tx) =>
    tx.execute<{ batch: string }>(
      sql`select deleted_batch_id::text as batch from records where id = ${world.trashedId}`,
    ),
  );
  return rows.rows[0]?.batch ?? '';
}

/** Every data entry of the access table, called as the principal it is about. */
const DATA_CASES: Readonly<Record<string, DataCase>> = {
  // Reads, by a principal at `none` on People: absent.
  listObjects: empty(
    (scope) => core.listObjects(scope),
    (value, world) => Array.isArray(value) && !value.some((object: { id: string }) => object.id === world.people),
  ),
  listObjectAttributes: refused('NOT_FOUND', (scope, world) => core.listObjectAttributes(scope, world.people)),
  listAttributes: empty((scope, world) => core.listAttributes(scope, world.people)),
  listOptions: empty((scope, world) => core.listOptions(scope, world.stage)),
  getRecords: empty((scope, world) => core.getRecords(scope, { ids: [world.recordId] })),
  readRecordsById: empty((scope, world) => core.readRecordsById(scope, [world.recordId])),
  queryRecords: refused('NOT_FOUND', (scope, world) => core.queryRecords(scope, { objectId: world.people })),
  queryPage: refused('NOT_FOUND', (scope, world) => core.queryPage(scope, { objectId: world.people })),
  countMatches: refused('NOT_FOUND', (scope, world) => core.countMatches(scope, { objectId: world.people })),
  queryGroups: refused('NOT_FOUND', (scope, world) =>
    core.queryGroups(scope, { objectId: world.people, groupBy: world.stage, groupIds: [null] }),
  ),
  getHistory: refused('NOT_FOUND', (scope, world) =>
    core.getHistory(scope, { recordId: world.recordId, attributeId: world.jobTitle }),
  ),
  getValuesAsOf: refused('NOT_FOUND', (scope, world) =>
    core.getValuesAsOf(scope, { recordId: world.recordId, at: new Date().toISOString() }),
  ),
  getTimeInStages: refused('NOT_FOUND', (scope, world) =>
    core.getTimeInStages(scope, { recordId: world.recordId, attributeId: world.stage }),
  ),
  getEntries: empty((scope, world) => core.getEntries(scope, { ids: [world.entryId] })),
  getRecordEntries: empty((scope, world) => core.getRecordEntries(scope, { recordId: world.recordId })),
  getActivity: refused('NOT_FOUND', (scope, world) => core.getActivity(scope, { recordId: world.recordId })),
  getStageSince: refused('NOT_FOUND', (scope, world) =>
    core.getStageSince(scope, { recordId: world.recordId, attributeId: world.stage }),
  ),
  readTrashedRecord: refused('NOT_FOUND', (scope, world) => core.readTrashedRecord(scope, world.trashedId)),
  // The record picker's search (spec 0014): an object the reader can't see is absent.
  searchRecords: refused('NOT_FOUND', (scope, world) =>
    core.searchRecords(scope, { objectId: world.people, query: '' }),
  ),
  // The command menu (spec 0039): a record or view on an object the principal can't see is never found, listed as
  // recent (even one they opened while they could), or kept by a visit.
  searchWorkspace: empty(
    (scope) => core.searchWorkspace(scope, { query: 'Pilot' }),
    (value, world) => {
      const found = value as GlobalSearchResults;
      return (
        found.records.every((hit) => hit.ref.recordId !== world.recordId) &&
        found.views.every((view) => view.objectId !== world.people)
      );
    },
  ),
  listRecents: empty(
    async (scope, world) => {
      await core.visitRecent(world.readOnly, { kind: 'record', id: world.recordId });
      await core.visitRecent(world.readOnly, { kind: 'view', id: world.peopleView });
      return core.listRecents(scope);
    },
    (value) => Array.isArray(value) && value.length === 0,
  ),
  visitRecent: empty(
    async (scope, world) => {
      await core.visitRecent(scope, { kind: 'record', id: world.recordId });
      await core.visitRecent(scope, { kind: 'view', id: world.peopleView });
      return core.listRecents(world.readOnly);
    },
    (value) => Array.isArray(value) && value.length === 0,
  ),
  // Saved views (spec 0020): a view on an object the principal can't see is absent, and so can't be saved.
  listViews: refused('NOT_FOUND', (scope, world) => core.listViews(scope, world.people)),
  getView: refused('NOT_FOUND', (scope, world) => core.getView(scope, world.peopleView)),
  saveViewQuery: refused('NOT_FOUND', (scope, world) =>
    core.saveViewQuery(scope, { viewId: world.peopleView, sorts: [], baseQueryVersion: 1 }),
  ),
  createView: refused('NOT_FOUND', (scope, world) =>
    core.createView(scope, {
      id: core.newId(),
      objectId: world.people,
      name: 'Mine',
      kind: 'table',
      visibility: 'workspace',
      config: { columns: [], showNewAttributes: false, pinnedCount: 1, sorts: [] },
    }),
  ),
  updateView: refused('NOT_FOUND', (scope, world) => core.updateView(scope, { viewId: world.peopleView, name: 'X' })),
  setViewLayout: refused('NOT_FOUND', (scope, world) =>
    core.setViewLayout(scope, { viewId: world.peopleView, layout: { columns: [], pinnedCount: 1 } }),
  ),
  moveView: refused('NOT_FOUND', (scope, world) => core.moveView(scope, { viewId: world.peopleView, direction: 'up' })),
  deleteView: refused('NOT_FOUND', (scope, world) => core.deleteView(scope, { viewId: world.peopleView })),
  markViewOpened: refused('NOT_FOUND', (scope, world) => core.markViewOpened(scope, { viewId: world.peopleView })),
  queryTrash: empty((scope, world) =>
    core.queryTrash(scope, {}).then((page) => page.items.filter((item) => item.recordId === world.trashedId)),
  ),
  countTrash: empty(
    (scope) => core.countTrash(scope, {}),
    (value) => typeof value === 'object' && value !== null && 'count' in value && value.count === 0,
  ),
  // Tasks (spec 0019): a task whose only record is hidden is absent; its record's list is NOT_FOUND.
  getTasks: empty((scope, world) => core.getTasks(scope, { ids: [world.taskId] })),
  // Forms (spec 0023): a form on an object the principal can't see is absent, and so are its submissions.
  listForms: empty((scope) => core.listForms(scope, { archived: false }).then((page) => page.items)),
  getForm: refused('NOT_FOUND', (scope, world) => core.getForm(scope, { formId: world.formId })),
  formAttributes: refused('NOT_FOUND', (scope, world) => core.formAttributes(scope, { formId: world.formId })),
  previewForm: refused('NOT_FOUND', (scope, world) => core.previewForm(scope, { formId: world.formId })),
  isSlugAvailable: refused('NOT_FOUND', (scope, world) =>
    core.isSlugAvailable(scope, { formId: world.formId, slug: 'contact-us' }),
  ),
  listSubmissions: refused('NOT_FOUND', (scope, world) => core.listSubmissions(scope, { formId: world.formId })),
  getSubmission: refused('NOT_FOUND', (scope, world) =>
    core.getSubmission(scope, { submissionId: world.submissionId }),
  ),
  // Notes (spec 0019): a hidden record's notes are absent, its list NOT_FOUND as the record is.
  getNote: refused('NOT_FOUND', (scope, world) => core.getNote(scope, { noteId: world.noteId })),
  // Comments (spec 0038): a hidden record's threads are absent, to read and to write.
  listThreads: refused('NOT_FOUND', (scope, world) => core.listThreads(scope, { recordId: world.recordId })),
  getThreads: empty((scope, world) => core.getThreads(scope, { threadIds: [world.threadId] })),
  commentVersions: refused('NOT_FOUND', (scope, world) => core.commentVersions(scope, { commentId: world.commentId })),
  createComment: refused('NOT_FOUND', (scope, world) =>
    core.createComment(scope, { id: core.newId(), recordId: world.recordId, body: 'Mine' }),
  ),
  updateComment: refused('NOT_FOUND', (scope, world) =>
    core.updateComment(scope, { commentId: world.commentId, body: 'Changed' }),
  ),
  deleteComment: refused('NOT_FOUND', (scope, world) => core.deleteComment(scope, { commentId: world.commentId })),
  setThreadResolved: refused('NOT_FOUND', (scope, world) =>
    core.setThreadResolved(scope, { threadId: world.threadId, resolved: true }),
  ),
  toggleReaction: refused('NOT_FOUND', (scope, world) =>
    core.toggleReaction(scope, { commentId: world.commentId, emoji: '👍', on: true }),
  ),
  listNotes: refused('NOT_FOUND', (scope, world) => core.listNotes(scope, { recordId: world.recordId })),
  // Imports (spec 0040): a member at read only can't start one; anyone else's import is absent.
  createImport: refused('FORBIDDEN', (scope, world) =>
    core.createImport(scope, {
      id: core.newId(),
      objectId: world.people,
      fileName: 'people.csv',
      rowCount: 1,
      errorRows: 0,
      settings: importSettings(world),
    }),
  ),
  stageImportRows: refused('NOT_FOUND', async (scope, world) =>
    core.stageImportRows(scope, {
      importId: await ownerImport(world),
      rows: [{ rowNumber: 3, values: { [world.name]: { firstName: 'Bob' } } }],
    }),
  ),
  startImport: refused('NOT_FOUND', async (scope, world) =>
    core.startImport(scope, core.jobKinds({ environment: 'local' }), await ownerImport(world)),
  ),
  undoImport: refused('NOT_FOUND', async (scope, world) =>
    core.undoImport(scope, core.jobKinds({ environment: 'local' }), await ownerImport(world)),
  ),
  getImport: refused('NOT_FOUND', async (scope, world) => core.getImport(scope, await ownerImport(world))),
  listImportRefusals: refused('NOT_FOUND', async (scope, world) =>
    core.listImportRefusals(scope, { importId: await ownerImport(world) }),
  ),
  checkImportLinks: refused('FORBIDDEN', (scope, world) =>
    core.checkImportLinks(scope, { objectId: world.people, attributeId: world.name, names: ['Acme'] }),
  ),
  // Records exports (spec 0040): a hidden object can't be exported, and anyone else's export is absent.
  startRecordsExport: refused('NOT_FOUND', (scope, world) =>
    core.startRecordsExport(scope, core.jobKinds({ environment: 'local' }), {
      id: core.newId(),
      objectId: world.people,
      attributeIds: [world.name],
      timeZone: 'UTC',
    }),
  ),
  getRecordsExport: refused('NOT_FOUND', async (scope, world) => {
    const started = await core.startRecordsExport(world.owner, core.jobKinds({ environment: 'local' }), {
      id: core.newId(),
      objectId: world.people,
      attributeIds: [world.name],
      timeZone: 'UTC',
    });
    return core.getRecordsExport(scope, { exportId: started.id });
  }),
  // A submissions export (spec 0023 follow-up): a form on a hidden object is absent, and so is anyone's export.
  startSubmissionsExport: refused('NOT_FOUND', (scope, world) =>
    core.startSubmissionsExport(scope, core.jobKinds({ environment: 'local' }), {
      id: core.newId(),
      formId: world.formId,
      select: { kind: 'filter' },
    }),
  ),
  getExport: refused('NOT_FOUND', async (scope, world) =>
    core.getExport(scope, { exportId: await ownerExport(world) }),
  ),
  exportFile: refused('NOT_FOUND', async (scope, world) =>
    core.exportFile(scope, { exportId: await ownerExport(world) }),
  ),
  exportPart: refused('NOT_FOUND', async (scope, world) =>
    core.exportPart(scope, { exportId: await ownerExport(world), part: 0 }),
  ),
  // The sidebar's Tasks badge (spec 0034): a principal that can't read counts nothing.
  countDueTasks: empty(
    (scope) => core.countDueTasks(scope, { today: '2026-10-21' }),
    (value) => typeof value === 'object' && value !== null && 'count' in value && value.count === 0,
  ),
  listTasks: refused('NOT_FOUND', (scope, world) =>
    core.listTasks(scope, { scope: { recordId: world.recordId }, status: 'open' }),
  ),
  // Meetings (spec 0024): a hidden record's meetings are NOT_FOUND, as the record is.
  listMeetingsForRecord: refused('NOT_FOUND', (scope, world) =>
    core.listMeetingsForRecord(scope, { recordId: world.recordId }),
  ),
  // Add as person: making the person needs write on People, so a reader of the record is refused.
  addMeetingAttendee: refused('FORBIDDEN', async (scope, world) =>
    core.addMeetingAttendee(
      scope,
      { recordId: world.recordId, meetingId: await meetingOn(world), email: 'cy@northwind.com' },
      { isFreeDomain: () => false },
    ),
  ),
  // Writes, by a principal who may only read People and its list: 403.
  createRecord: refused('FORBIDDEN', (scope, world) => core.createRecord(scope, { objectId: world.people })),
  addRecord: refused('FORBIDDEN', (scope, world) =>
    core.addRecord(scope, { objectId: world.people, id: core.newId() }),
  ),
  setValues: refused('FORBIDDEN', (scope, world) =>
    core.setValues(scope, { recordId: world.recordId, values: named(world) }),
  ),
  setRecordValues: refused('FORBIDDEN', (scope, world) =>
    core.setRecordValues(scope, { recordId: world.recordId, values: named(world) }),
  ),
  setValuesBatch: refused('FORBIDDEN', (scope, world) =>
    core.setValuesBatch(scope, { items: [{ recordId: world.recordId, values: named(world) }] }),
  ),
  editRecord: refused('FORBIDDEN', (scope, world) =>
    core.editRecord(scope, { recordId: world.recordId, values: named(world) }),
  ),
  editRecords: refused('FORBIDDEN', (scope, world) =>
    core.editRecords(scope, { items: [{ recordId: world.recordId, values: named(world) }] }),
  ),
  deleteRecord: refused('FORBIDDEN', (scope, world) => core.deleteRecord(scope, { recordId: world.recordId })),
  restoreRecord: refused('FORBIDDEN', (scope, world) => core.restoreRecord(scope, { recordId: world.recordId })),
  deleteRecords: refused('FORBIDDEN', (scope, world) =>
    core.deleteRecords(scope, { objectId: world.people, recordIds: [world.recordId], batchId: core.newId() }),
  ),
  // Per record: the one outcome's refusal is the call's.
  restoreRecords: refused('FORBIDDEN', (scope, world) =>
    core.restoreRecords(scope, { recordIds: [world.trashedId] }).then(refusedOutcome),
  ),
  restoreBatch: refused('FORBIDDEN', async (scope, world) =>
    core.restoreBatch(scope, { batchId: await batchOf(world) }).then(refusedOutcome),
  ),
  updateMany: refused('FORBIDDEN', (scope, world) =>
    core.updateMany(scope, {
      objectId: world.people,
      recordIds: [world.recordId],
      edit: { attributeId: world.jobTitle, op: 'set', value: 'Pilot' },
    }),
  ),
  bulkEditRecords: refused('FORBIDDEN', (scope, world) =>
    core.bulkEditRecords(scope, {
      objectId: world.people,
      recordIds: [world.recordId],
      edit: { attributeId: world.jobTitle, op: 'clear' },
    }),
  ),
  startBulk: refused('FORBIDDEN', (scope, world) =>
    core.startBulk(scope, core.jobKinds({ environment: 'local' }), {
      id: core.newId(),
      action: 'delete',
      target: { kind: 'ids', objectId: world.people, recordIds: [world.recordId] },
    }),
  ),
  undoDelete: refused('FORBIDDEN', async (scope, world) =>
    core
      .undoDelete(scope, core.jobKinds({ environment: 'local' }), { batchId: await batchOf(world) })
      .then((answer) => (answer.mode === 'inline' ? refusedOutcome(answer.results) : answer)),
  ),
  // Link deltas (spec 0014): a record the principal may only read refuses before any far record is looked at.
  changeLinks: refused('FORBIDDEN', (scope, world) =>
    core.changeLinks(scope, {
      kind: 'remove',
      recordId: world.recordId,
      attributeId: world.associatedDeals,
      targetRecordIds: [world.trashedId],
    }),
  ),
  addRecordLinks: refused('FORBIDDEN', (scope, world) =>
    core.addRecordLinks(scope, {
      recordId: world.recordId,
      attributeId: world.company,
      targets: [{ objectId: world.people, recordId: world.trashedId }],
    }),
  ),
  removeRecordLinks: refused('FORBIDDEN', (scope, world) =>
    core.removeRecordLinks(scope, {
      recordId: world.recordId,
      attributeId: world.associatedDeals,
      targetRecordIds: [world.trashedId],
    }),
  ),
  addEntry: refused('FORBIDDEN', (scope, world) =>
    core.addEntry(scope, { listId: world.listId, recordId: world.recordId }),
  ),
  removeEntry: refused('FORBIDDEN', (scope, world) => core.removeEntry(scope, { entryId: world.entryId })),
  restoreEntry: refused('FORBIDDEN', (scope, world) => core.restoreEntry(scope, { entryId: world.entryId })),
  // Linking a record needs write on its object; changing a task another member owns needs write on a linked object.
  createTask: refused('FORBIDDEN', (scope, world) =>
    core.createTask(scope, { id: core.newId(), title: 'Mine', recordIds: [world.recordId] }),
  ),
  updateTask: refused('FORBIDDEN', (scope, world) =>
    core.updateTask(scope, { taskId: world.taskId, title: 'Renamed' }),
  ),
  deleteTask: refused('FORBIDDEN', (scope, world) => core.deleteTask(scope, { taskId: world.taskId })),
  restoreTask: refused('FORBIDDEN', (scope, world) => core.restoreTask(scope, { taskId: world.taskId })),
  // A note needs write on its record's object to be added, edited, deleted or restored.
  saveNote: refused('FORBIDDEN', (scope, world) =>
    core.saveNote(scope, { id: core.newId(), recordId: world.recordId, title: 'Mine' }),
  ),
  deleteNote: refused('FORBIDDEN', (scope, world) => core.deleteNote(scope, { noteId: world.noteId })),
  restoreNote: refused('FORBIDDEN', (scope, world) => core.restoreNote(scope, { noteId: world.noteId })),
};

describe('schema writes (AC-135)', () => {
  const attributeCount = (workspaceId: string, objectId: string) =>
    db
      .withWorkspace(workspaceId, (tx) =>
        tx.execute<{ count: number }>(sql`select count(*)::int as count from attributes where object_id = ${objectId}`),
      )
      .then((result) => result.rows[0]?.count);
  const outboxCount = (workspaceId: string) =>
    db
      .withWorkspace(workspaceId, (tx) => tx.execute<{ count: number }>(sql`select count(*)::int as count from outbox`))
      .then((result) => result.rows[0]?.count);

  it('refuses a member’s new attribute and writes no attribute and no outbox row; an admin’s succeeds', async () => {
    const asMember = await memberOf('member');
    const people = asMember.objects.people ?? '';
    const before = await attributeCount(asMember.workspaceId, people);
    const outboxBefore = await outboxCount(asMember.workspaceId);
    const hooks = [core.outboxHook({ mutationId: core.newId() })];
    expect(
      await refusalOf(
        core.createAttribute(
          asMember.scope,
          { objectId: people, id: core.newId(), title: 'Nickname', type: 'text' },
          hooks,
        ),
      ),
    ).toEqual({ code: 'FORBIDDEN', message: 'Only workspace owners and admins can change objects and attributes.' });
    expect(await attributeCount(asMember.workspaceId, people)).toBe(before);
    expect(await outboxCount(asMember.workspaceId)).toBe(outboxBefore);

    const asAdmin = await memberOf('admin');
    const made = await core.createAttribute(asAdmin.scope, {
      objectId: asAdmin.objects.people ?? '',
      id: core.newId(),
      title: 'Nickname',
      type: 'text',
    });
    expect(made.title).toBe('Nickname');
  });
});
