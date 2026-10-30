// The data layer against a fake API (spec 0005): the real oRPC handler over
// the shared contract with stand in procedures, and Better Auth's routes
// answered by hand in the shapes the API sends. Checks the caching, the error
// shape every failure takes, and that a 401 signs out once.
import {
  contract,
  defaultAvailability,
  type AttributeDefinition,
  type BookingPageView,
  type BookingsCalendarView,
  type AttributeOption,
  type AuditListInput,
  type AuditPage,
  type ChangeEvent,
  type DeleteManyResults,
  type GlobalSearchResults,
  type RecentItem,
  type RestoreResults,
  type RoutingRule,
  type UpdateManyResults,
  type TrashPage,
  type JobView,
  type Me,
  type MemberView,
  type MyAccess,
  type ObjectSummary,
  type RecordActivity,
  type RecordView,
  type RelationshipView,
  type SearchResult,
  type Usage,
  type TrashedRecord,
  type View,
  type ViewLayout,
  type ViewsList,
} from '@crm/contracts';
import { implement, ORPCError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { describe, expect, it, vi } from 'vitest';
import { dataError, isUnseenFault, parseRetryAfter } from './errors.ts';
import { refusalFor, refusalSummary } from './refusals.ts';
import {
  createDataLayer,
  createIdMinter,
  isDataError,
  isEditableHere,
  isAskedOnCreate,
  searchMembers,
  toActorDisplays,
  toFieldAttribute,
  withPendingOptions,
  type DataError,
  type DataFault,
  type Notice,
  type ReplacedValue,
} from './index.ts';
import { createLive, type LiveChannel, type LiveTransport } from './live/live.ts';

const ORIGIN = 'https://crm.test';

const ME: Me = {
  user: { id: '0199a6f2-0000-7000-8000-000000000001', name: 'Ada Lovelace', email: 'ada@example.com' },
  workspaces: [{ id: '0199a6f2-0000-7000-8000-000000000002', slug: 'acme', name: 'Acme' }],
  isOperator: false,
};

const PEOPLE: ObjectSummary = {
  id: '0199a6f2-0000-7000-8000-000000000003',
  apiSlug: 'people',
  singularName: 'Person',
  pluralName: 'People',
  icon: 'user',
  hue: 'blue',
  standardKey: 'people',
  primaryAttributeId: '0199a6f2-0000-7000-8000-000000000004',
  access: 'write',
  position: 0,
  isStandard: true,
  isArchived: false,
};

const TITLE: AttributeDefinition = {
  id: '0199a6f2-0000-7000-8000-000000000005',
  objectId: '0199a6f2-0000-7000-8000-000000000003',
  isPrimary: false,
  isArchived: false,
  apiSlug: 'job_title',
  title: 'Job title',
  type: 'text',
  isMulti: false,
  isRequired: false,
  isUnique: false,
  isSystem: false,
  config: {},
  position: 3,
};

const ADA_MEMBER: MemberView = {
  id: '0199a6f2-0000-7000-8000-000000000006',
  name: 'Ada',
  email: 'ada@example.com',
  role: 'member',
  joinedAt: '2026-10-01T09:00:00.000Z',
};

/** A person as the API answers one. */
const personRow = (index: number, title = 'Engineer'): RecordView => {
  const id = `0199a6f2-0000-7000-8000-${(100 + index).toString(16).padStart(12, '0')}`;
  const actor = { type: 'member' as const, id: ADA_MEMBER.id };
  return {
    id,
    objectId: PEOPLE.id,
    createdAt: '2026-10-08T09:00:00.000Z',
    createdBy: actor,
    updatedAt: '2026-10-08T09:00:00.000Z',
    updatedBy: actor,
    display: { objectId: PEOPLE.id, recordId: id, name: `P${String(index)}`, kind: 'person' },
    revision: 0,
    values: { [TITLE.id]: title },
    versions: { [TITLE.id]: '0199a6f2-0001-7000-8000-000000000000' },
    linkTotals: {},
  };
};

/** What each stand in procedure does; a test overrides the ones it needs. */
interface Behaviour {
  me: () => Me | Promise<Me>;
  objects: (workspace: string) => ObjectSummary[];
  create: () => { workspace: Me['workspaces'][number] };
  slugAvailable: (slug: string) => { available: boolean };
  members: () => MemberView[];
  access: () => MyAccess;
  attributes: () => AttributeDefinition[];
  addAttribute: () => AttributeDefinition;
  /** What attributes.update answers, and reorder, archive and restore (spec 0012, milestone 2). */
  attributeWrite: () => AttributeDefinition[];
  count: () => number;
  query: (position: number, limit: number) => RecordView[];
  setValues: () => RecordView | Promise<RecordView>;
  get: (ids: readonly string[]) => RecordView[];
  /** The workspace's head, as the subscription token carries it. */
  head: () => number;
  /** What `realtime.catchUp` answers from `after`. */
  catchUp: (after: number) => { head: number; reset: boolean; events: ChangeEvent[] };
  /** Background jobs: the list's pages, one job, a cancel's answer, a test job's answer. */
  jobsList: (cursor: string | undefined) => { jobs: JobView[]; nextCursor?: string };
  jobGet: (jobId: string) => JobView;
  jobCancel: (jobId: string) => JobView;
  jobStartTest: (id: string) => JobView;
  /** What every object write answers (spec 0012). */
  objectWrite: () => ObjectSummary;
  usage: () => Usage;
  /** A page of a record's timeline (spec 0017). */
  activity: (recordId: string, cursor?: string) => RecordActivity;
  /** A record in the trash (spec 0017). */
  trashed: (recordId: string) => TrashedRecord;
  /** A page of the audit log (spec 0046). */
  auditList: (input: AuditListInput) => AuditPage;
  /** A workspace's sign in rules (spec 0033). */
  workspaceSecurityGet: () => never;
  /** What every option write answers (spec 0012, milestone 3). */
  optionWrite: () => AttributeOption;
  /** What both relationship writes answer (spec 0014). */
  relationshipWrite: () => RelationshipView;
  /** What `records.search` answers for a query (spec 0014). */
  search: (query: string) => SearchResult[];
  /** Saved views (spec 0020): an object's list, one view, a save's answer. */
  viewsList: (objectId: string) => ViewsList;
  viewGet: (viewId: string) => View;
  viewSave: (input: { readonly viewId: string; readonly baseQueryVersion: number; readonly force?: boolean }) => View;
  viewLayout: (input: { readonly viewId: string; readonly layout: ViewLayout }) => View;
  /** Bulk delete and its undo (spec 0022): each record's outcome. */
  deleteMany: (recordIds: readonly string[]) => DeleteManyResults['results'];
  restoreBatch: (batchId: string) => RestoreResults['results'];
  /** Bulk edit (spec 0022, milestone 2): each record's outcome. */
  updateMany: (recordIds: readonly string[]) => UpdateManyResults['results'];
  /** The trash (spec 0022): a page, the count, a restore's outcomes. */
  trashQuery: () => TrashPage;
  trashCount: () => { count: number; atLeast: boolean };
  trashRestore: (recordIds: readonly string[]) => RestoreResults['results'];
  /** The command menu (spec 0039): a search's answer, the recent items, and each visit as sent. */
  globalSearch: (query: string) => GlobalSearchResults;
  recents: () => RecentItem[];
  /** Booking pages (spec 0025): one page's read, and an update's answer, which a team page's rules ride (spec 0043). */
  bookingPagesGet: (pageId: string) => BookingPageView;
  bookingPagesUpdate: (input: {
    readonly pageId: string;
    readonly routing?: { readonly rules: readonly RoutingRule[] } | undefined;
  }) => BookingPageView | Promise<BookingPageView>;
  /** What `account.deletion.confirm` answers (spec 0033). */
  deleteAccount: () => Promise<{ deleted: true }>;
  /** What `bookings.calendar` answers: Bookings' week (spec 0025). */
  bookingsCalendar: () => BookingsCalendarView;
}

const unauthenticated = () => new ORPCError('UNAUTHENTICATED', { status: 401, message: 'Sign in to continue.' });

/** A stand in for a procedure these tests never call. */
const notServed = (): never => {
  throw new ORPCError('NOT_FOUND', { status: 404, message: 'Not served by this fake.' });
};

/** A fake API behind `fetch`: oRPC on `/api/rpc`, Better Auth's routes on `/api/auth`, and a log of what was called. */
function fakeApi(overrides: Partial<Behaviour> = {}, auth: (path: string, body: unknown) => Response = okAuth) {
  const behaviour: Behaviour = {
    me: () => ME,
    objects: () => [PEOPLE],
    create: () => ({ workspace: { id: '0199a6f2-0000-7000-8000-000000000009', slug: 'new', name: 'New' } }),
    slugAvailable: (slug) => ({ available: slug !== 'acme' }),
    members: () => [ADA_MEMBER],
    access: () => ({ memberId: ADA_MEMBER.id, role: 'member', roleLabel: 'Member', permissions: ['records.export'] }),
    attributes: () => [TITLE],
    addAttribute: notServed,
    attributeWrite: notServed,
    count: () => 3,
    query: (position, limit) =>
      Array.from({ length: Math.max(0, Math.min(limit, 3 - position)) }, (_, at) => personRow(position + at)),
    setValues: notServed,
    get: () => [],
    search: () => [],
    head: () => 0,
    catchUp: () => ({ head: behaviour.head(), reset: false, events: [] }),
    jobsList: () => ({ jobs: [] }),
    jobGet: notServed,
    jobCancel: notServed,
    jobStartTest: notServed,
    deleteAccount: notServed,
    objectWrite: notServed,
    usage: () => ({ attributes: { [PEOPLE.id]: { used: 20, limit: 250 } }, optionsPerAttribute: 500 }),
    activity: notServed,
    trashed: notServed,
    auditList: notServed,
    workspaceSecurityGet: notServed,
    optionWrite: notServed,
    relationshipWrite: notServed,
    viewsList: notServed,
    viewGet: notServed,
    viewSave: notServed,
    viewLayout: notServed,
    deleteMany: notServed,
    restoreBatch: notServed,
    updateMany: notServed,
    trashQuery: () => ({ items: [] }),
    trashCount: () => ({ count: 0, atLeast: false }),
    trashRestore: notServed,
    globalSearch: () => ({ records: [], views: [] }),
    recents: () => [],
    bookingPagesGet: notServed,
    bookingPagesUpdate: notServed,
    bookingsCalendar: notServed,
    ...overrides,
  };
  const calls: string[] = [];
  // What each option write and each one record write sent, as the server got it.
  const sent: unknown[] = [];
  // Each write's mutation id, as sent.
  const mutationIds: string[] = [];
  const os = implement(contract);
  const router = os.router({
    system: {
      status: os.system.status.handler(() => ({
        environment: 'local' as const,
        database: { serverVersion: '18.0', latencyMs: 1 },
        providers: { google: false },
        calendarSync: false,
        checkedAt: '2026-10-03T09:00:00.000Z',
      })),
      testFault: os.system.testFault.handler(notServed),
    },
    me: {
      get: os.me.get.handler(() => behaviour.me()),
      setLastWorkspace: os.me.setLastWorkspace.handler(({ input }) => {
        calls.push(`me.setLastWorkspace:${input.workspace}`);
      }),
    },
    workspaces: {
      create: os.workspaces.create.handler(() => behaviour.create()),
      slugAvailable: os.workspaces.slugAvailable.handler(({ input }) => behaviour.slugAvailable(input.slug)),
    },
    objects: {
      list: os.objects.list.handler(({ input }) => behaviour.objects(input.workspace)),
      create: os.objects.create.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        return behaviour.objectWrite();
      }),
      update: os.objects.update.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        return behaviour.objectWrite();
      }),
      reorder: os.objects.reorder.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        return [behaviour.objectWrite()];
      }),
      archive: os.objects.archive.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        return behaviour.objectWrite();
      }),
      restore: os.objects.restore.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        return behaviour.objectWrite();
      }),
    },
    usage: { get: os.usage.get.handler(() => behaviour.usage()) },
    views: {
      list: os.views.list.handler(({ input }) => behaviour.viewsList(input.objectId)),
      get: os.views.get.handler(({ input }) => behaviour.viewGet(input.viewId)),
      saveQuery: os.views.saveQuery.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        sent.push(input);
        return behaviour.viewSave(input);
      }),
      create: os.views.create.handler(() => notServed()),
      update: os.views.update.handler(() => notServed()),
      setLayout: os.views.setLayout.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        sent.push(input);
        return behaviour.viewLayout(input);
      }),
      move: os.views.move.handler(() => notServed()),
      setLocked: os.views.setLocked.handler(() => notServed()),
      setDefault: os.views.setDefault.handler(() => notServed()),
      delete: os.views.delete.handler(() => notServed()),
      markOpened: os.views.markOpened.handler(({ input }) => {
        sent.push(input);
      }),
    },
    attributes: {
      list: os.attributes.list.handler(() => behaviour.attributes()),
      create: os.attributes.create.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        return behaviour.addAttribute();
      }),
      update: os.attributes.update.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        const [first] = behaviour.attributeWrite();
        if (first === undefined) throw new Error('The fake answered no attribute.');
        return first;
      }),
      reorder: os.attributes.reorder.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        return behaviour.attributeWrite();
      }),
      archive: os.attributes.archive.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        return behaviour.attributeWrite();
      }),
      restore: os.attributes.restore.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        return behaviour.attributeWrite();
      }),
    },
    links: {
      add: os.links.add.handler(notServed),
      remove: os.links.remove.handler(notServed),
      page: os.links.page.handler(notServed),
    },
    relationships: {
      create: os.relationships.create.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        sent.push(input);
        return behaviour.relationshipWrite();
      }),
      update: os.relationships.update.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        sent.push(input);
        return behaviour.relationshipWrite();
      }),
    },
    options: {
      create: os.options.create.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        sent.push(input);
        return behaviour.optionWrite();
      }),
      update: os.options.update.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        sent.push(input);
        return behaviour.optionWrite();
      }),
      reorder: os.options.reorder.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        sent.push(input);
        return [behaviour.optionWrite()];
      }),
      archive: os.options.archive.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        sent.push(input);
        return behaviour.optionWrite();
      }),
      restore: os.options.restore.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        sent.push(input);
        return behaviour.optionWrite();
      }),
    },
    records: {
      query: os.records.query.handler(({ input }) => ({
        records: behaviour.query(input.position ?? 0, input.limit ?? 50),
      })),
      count: os.records.count.handler(() => ({ count: behaviour.count(), atLeast: false })),
      objectCounts: os.records.objectCounts.handler(notServed),
      groups: os.records.groups.handler(notServed),
      get: os.records.get.handler(({ input }) => behaviour.get(input.ids)),
      create: os.records.create.handler(notServed),
      setValues: os.records.setValues.handler(async ({ input }) => {
        mutationIds.push(input.mutationId);
        sent.push(input.values);
        const row = await behaviour.setValues();
        const written = Object.fromEntries(
          Object.keys(input.values).flatMap((id) => (row.versions[id] === undefined ? [] : [[id, row.versions[id]]])),
        );
        return { ...row, echoes: 1, written };
      }),
      setValuesBatch: os.records.setValuesBatch.handler(notServed),
      activity: os.records.activity.handler(({ input }) => behaviour.activity(input.recordId, input.cursor)),
      getTrashed: os.records.getTrashed.handler(({ input }) => behaviour.trashed(input.recordId)),
      stageSince: os.records.stageSince.handler(() => ({})),
      search: os.records.search.handler(({ input }) => {
        sent.push(input);
        return { results: behaviour.search(input.query) };
      }),
      deleteMany: os.records.deleteMany.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        sent.push(input);
        return { results: behaviour.deleteMany(input.recordIds), echoes: 1 };
      }),
      restoreBatch: os.records.restoreBatch.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        sent.push(input);
        return { mode: 'inline' as const, results: behaviour.restoreBatch(input.batchId), echoes: 1 };
      }),
      startBulk: os.records.startBulk.handler(() => notServed()),
      updateMany: os.records.updateMany.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        sent.push(input);
        return { results: behaviour.updateMany(input.recordIds), echoes: 1 };
      }),
    },
    trash: {
      query: os.trash.query.handler(() => behaviour.trashQuery()),
      count: os.trash.count.handler(() => behaviour.trashCount()),
      restore: os.trash.restore.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        return { results: behaviour.trashRestore(input.recordIds), echoes: 1 };
      }),
      deleteForever: os.trash.deleteForever.handler(() => notServed()),
    },
    members: {
      list: os.members.list.handler(() => {
        const listed = behaviour.members();
        return { members: listed, total: listed.length };
      }),
      setRole: os.members.setRole.handler(notServed),
      removalPreview: os.members.removalPreview.handler(notServed),
      remove: os.members.remove.handler(notServed),
      leave: os.members.leave.handler(notServed),
      transferOwnership: os.members.transferOwnership.handler(notServed),
      visible: os.members.visible.handler(notServed),
    },
    workspaceSecurity: {
      get: os.workspaceSecurity.get.handler(() => behaviour.workspaceSecurityGet()),
      set: os.workspaceSecurity.set.handler(notServed),
      signOutEveryone: os.workspaceSecurity.signOutEveryone.handler(notServed),
    },
    invitations: {
      create: os.invitations.create.handler(notServed),
      list: os.invitations.list.handler(notServed),
      resend: os.invitations.resend.handler(notServed),
      revoke: os.invitations.revoke.handler(notServed),
      peek: os.invitations.peek.handler(notServed),
      accept: os.invitations.accept.handler(notServed),
      link: os.invitations.link.handler(notServed),
      setLink: os.invitations.setLink.handler(notServed),
    },
    join: {
      list: os.join.list.handler(notServed),
      request: os.join.request.handler(notServed),
    },
    workspace: {
      get: os.workspace.get.handler(notServed),
      update: os.workspace.update.handler(notServed),
      delete: os.workspace.delete.handler(notServed),
    },
    deletedWorkspace: {
      deleted: os.deletedWorkspace.deleted.handler(notServed),
      restore: os.deletedWorkspace.restore.handler(notServed),
    },
    profile: {
      get: os.profile.get.handler(notServed),
      update: os.profile.update.handler(notServed),
      items: os.profile.items.handler(notServed),
      counts: os.profile.counts.handler(notServed),
      pageChoices: os.profile.pageChoices.handler(notServed),
      formChoices: os.profile.formChoices.handler(notServed),
      saveTheme: os.profile.saveTheme.handler(notServed),
      setIndexable: os.profile.setIndexable.handler(notServed),
      setShareImage: os.profile.setShareImage.handler(notServed),
      walletLink: os.profile.walletLink.handler(notServed),
      show: os.profile.show.handler(notServed),
      importLinks: os.profile.importLinks.handler(notServed),
      saveItem: os.profile.saveItem.handler(notServed),
      orderItems: os.profile.orderItems.handler(notServed),
      archiveItem: os.profile.archiveItem.handler(notServed),
      deleteItem: os.profile.deleteItem.handler(notServed),
    },
    joinRequests: {
      domains: os.joinRequests.domains.handler(notServed),
      setDomains: os.joinRequests.setDomains.handler(notServed),
      list: os.joinRequests.list.handler(notServed),
      decide: os.joinRequests.decide.handler(notServed),
    },
    search: { query: os.search.query.handler(({ input }) => behaviour.globalSearch(input.query)) },
    recents: {
      list: os.recents.list.handler(() => ({ items: behaviour.recents() })),
      visit: os.recents.visit.handler(({ input }) => {
        sent.push(input);
      }),
    },
    preferences: {
      get: os.preferences.get.handler(notServed),
      update: os.preferences.update.handler(notServed),
    },
    access: { mine: os.access.mine.handler(() => behaviour.access()) },
    roles: { list: os.roles.list.handler(notServed) },
    scheduling: {
      delegations: {
        list: os.scheduling.delegations.list.handler(notServed),
        grant: os.scheduling.delegations.grant.handler(notServed),
        revoke: os.scheduling.delegations.revoke.handler(notServed),
      },
    },
    timeOff: {
      list: os.timeOff.list.handler(notServed),
      create: os.timeOff.create.handler(notServed),
      update: os.timeOff.update.handler(notServed),
      delete: os.timeOff.delete.handler(notServed),
    },
    realtime: {
      connectionToken: os.realtime.connectionToken.handler(() => ({ token: 'connection-token' })),
      subscriptionToken: os.realtime.subscriptionToken.handler(({ input }) => ({
        channel: `workspace:${input.workspace}`,
        token: 'subscription-token',
        head: behaviour.head(),
      })),
      catchUp: os.realtime.catchUp.handler(({ input }) => behaviour.catchUp(input.after)),
    },
    jobs: {
      list: os.jobs.list.handler(({ input }) => behaviour.jobsList(input.cursor)),
      get: os.jobs.get.handler(({ input }) => behaviour.jobGet(input.jobId)),
      cancel: os.jobs.cancel.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        return behaviour.jobCancel(input.jobId);
      }),
      confirm: os.jobs.confirm.handler(notServed),
      startTest: os.jobs.startTest.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        return behaviour.jobStartTest(input.id);
      }),
    },
    // Tasks (spec 0019) are driven against their own fake in `tasks/store.test.ts`.
    tasks: {
      create: os.tasks.create.handler(notServed),
      update: os.tasks.update.handler(notServed),
      get: os.tasks.get.handler(notServed),
      list: os.tasks.list.handler(notServed),
      due: os.tasks.due.handler(notServed),
      delete: os.tasks.delete.handler(notServed),
      restore: os.tasks.restore.handler(notServed),
    },
    // Notes (spec 0019) are driven against their own fake in `notes/store.test.ts`.
    notes: {
      save: os.notes.save.handler(notServed),
      get: os.notes.get.handler(notServed),
      list: os.notes.list.handler(notServed),
      delete: os.notes.delete.handler(notServed),
      restore: os.notes.restore.handler(notServed),
    },
    comments: {
      list: os.comments.list.handler(notServed),
      get: os.comments.get.handler(notServed),
      create: os.comments.create.handler(notServed),
      update: os.comments.update.handler(notServed),
      delete: os.comments.delete.handler(notServed),
      resolve: os.comments.resolve.handler(notServed),
      react: os.comments.react.handler(notServed),
      versions: os.comments.versions.handler(notServed),
    },
    notifications: {
      list: os.notifications.list.handler(notServed),
      count: os.notifications.count.handler(notServed),
      mark: os.notifications.mark.handler(notServed),
      markAllRead: os.notifications.markAllRead.handler(notServed),
      settings: os.notifications.settings.handler(notServed),
      setSettings: os.notifications.setSettings.handler(notServed),
    },
    // The operator console (spec 0047) is read through to the api as is; its gate and reads are the api's tests.
    operator: {
      overview: os.operator.overview.handler(notServed),
      users: os.operator.users.handler(notServed),
      user: os.operator.user.handler(notServed),
      pages: os.operator.pages.handler(notServed),
      page: os.operator.page.handler(notServed),
      site: os.operator.site.handler(notServed),
    },
    // Account sessions (spec 0033) are driven against their own fake in `account/sessions.test.ts`.
    account: {
      sessions: {
        list: os.account.sessions.list.handler(notServed),
        revoke: os.account.sessions.revoke.handler(notServed),
        revokeOthers: os.account.sessions.revokeOthers.handler(notServed),
      },
      security: { get: os.account.security.get.handler(notServed) },
      activity: { list: os.account.activity.list.handler(notServed) },
      stepUp: {
        start: os.account.stepUp.start.handler(notServed),
        verify: os.account.stepUp.verify.handler(notServed),
      },
      deletion: {
        check: os.account.deletion.check.handler(notServed),
        confirm: os.account.deletion.confirm.handler(() => behaviour.deleteAccount()),
      },
    },
    calendar: {
      connections: {
        list: os.calendar.connections.list.handler(() => ({
          enabled: false,
          providers: [],
          connections: [],
          max: 3,
        })),
        update: os.calendar.connections.update.handler(notServed),
        remove: os.calendar.connections.remove.handler(notServed),
        syncNow: os.calendar.connections.syncNow.handler(notServed),
        refresh: os.calendar.connections.refresh.handler(notServed),
      },
      calendars: {
        list: os.calendar.calendars.list.handler(notServed),
        update: os.calendar.calendars.update.handler(notServed),
      },
      destination: {
        set: os.calendar.destination.set.handler(notServed),
        dismissNotice: os.calendar.destination.dismissNotice.handler(notServed),
      },
      pageDestination: {
        get: os.calendar.pageDestination.get.handler(notServed),
        set: os.calendar.pageDestination.set.handler(notServed),
      },
      health: os.calendar.health.handler(notServed),
      meetings: {
        forRecord: os.calendar.meetings.forRecord.handler(() => ({ items: [] })),
        addAttendee: os.calendar.meetings.addAttendee.handler(notServed),
      },
      settings: {
        get: os.calendar.settings.get.handler(() => ({ createUnknownPeople: false, canManage: false })),
        update: os.calendar.settings.update.handler(notServed),
      },
    },
    forms: {
      list: os.forms.list.handler(notServed),
      get: os.forms.get.handler(notServed),
      attributes: os.forms.attributes.handler(notServed),
      preview: os.forms.preview.handler(notServed),
      create: os.forms.create.handler(notServed),
      saveDraft: os.forms.saveDraft.handler(notServed),
      publish: os.forms.publish.handler(notServed),
      setStatus: os.forms.setStatus.handler(notServed),
      slugAvailable: os.forms.slugAvailable.handler(notServed),
      updateSettings: os.forms.updateSettings.handler(notServed),
      rotateSecret: os.forms.rotateSecret.handler(notServed),
      setTarget: os.forms.setTarget.handler(notServed),
      duplicate: os.forms.duplicate.handler(notServed),
      delete: os.forms.delete.handler(notServed),
      syncPreview: os.forms.syncPreview.handler(notServed),
      syncStart: os.forms.syncStart.handler(notServed),
    },
    submissions: {
      list: os.submissions.list.handler(notServed),
      get: os.submissions.get.handler(notServed),
      release: os.submissions.release.handler(notServed),
      markSpam: os.submissions.markSpam.handler(notServed),
      resolve: os.submissions.resolve.handler(notServed),
      retry: os.submissions.retry.handler(notServed),
      delete: os.submissions.delete.handler(notServed),
      addToCrm: os.submissions.addToCrm.handler(notServed),
      export: os.submissions.export.handler(notServed),
      getExport: os.submissions.getExport.handler(notServed),
    },
    imports: {
      create: os.imports.create.handler(notServed),
      stage: os.imports.stage.handler(notServed),
      start: os.imports.start.handler(notServed),
      get: os.imports.get.handler(notServed),
      rows: os.imports.rows.handler(notServed),
      undo: os.imports.undo.handler(notServed),
      links: os.imports.links.handler(notServed),
      matches: os.imports.matches.handler(notServed),
    },
    exports: {
      start: os.exports.start.handler(notServed),
      get: os.exports.get.handler(notServed),
    },
    bookingPages: {
      list: os.bookingPages.list.handler(notServed),
      get: os.bookingPages.get.handler(({ input }) => behaviour.bookingPagesGet(input.pageId)),
      create: os.bookingPages.create.handler(notServed),
      update: os.bookingPages.update.handler(({ input }) => {
        mutationIds.push(input.mutationId);
        return behaviour.bookingPagesUpdate(input);
      }),
      delete: os.bookingPages.delete.handler(notServed),
      reorderProfile: os.bookingPages.reorderProfile.handler(notServed),
      attributes: os.bookingPages.attributes.handler(notServed),
    },
    home: {
      teamToday: os.home.teamToday.handler(notServed),
      metrics: os.home.metrics.handler(notServed),
    },
    bookings: {
      list: os.bookings.list.handler(notServed),
      listAll: os.bookings.listAll.handler(notServed),
      meetings: os.bookings.meetings.handler(notServed),
      calendar: os.bookings.calendar.handler(() => behaviour.bookingsCalendar()),
      hours: os.bookings.hours.handler(notServed),
      setHours: os.bookings.setHours.handler(notServed),
      bookAsHost: os.bookings.bookAsHost.handler(notServed),
      cancel: os.bookings.cancel.handler(notServed),
      move: os.bookings.move.handler(notServed),
      moveSlots: os.bookings.moveSlots.handler(notServed),
      guestLink: os.bookings.guestLink.handler(notServed),
      assignments: os.bookings.assignments.handler(notServed),
      reassign: os.bookings.reassign.handler(notServed),
      markNoShow: os.bookings.markNoShow.handler(notServed),
      link: os.bookings.link.handler(notServed),
      blocks: {
        create: os.bookings.blocks.create.handler(notServed),
        remove: os.bookings.blocks.remove.handler(notServed),
      },
    },
    schedules: {
      members: os.schedules.members.handler(notServed),
      list: os.schedules.list.handler(notServed),
      get: os.schedules.get.handler(notServed),
      create: os.schedules.create.handler(notServed),
      update: os.schedules.update.handler(notServed),
      setDefault: os.schedules.setDefault.handler(notServed),
      duplicate: os.schedules.duplicate.handler(notServed),
      delete: os.schedules.delete.handler(notServed),
    },
    rotations: {
      list: os.rotations.list.handler(notServed),
      create: os.rotations.create.handler(notServed),
      update: os.rotations.update.handler(notServed),
      distribution: os.rotations.distribution.handler(notServed),
      adjust: os.rotations.adjust.handler(notServed),
      undoAdjustment: os.rotations.undoAdjustment.handler(notServed),
      reassignUpcoming: os.rotations.reassignUpcoming.handler(notServed),
      delete: os.rotations.delete.handler(notServed),
    },
    nav: {
      get: os.nav.get.handler(notServed),
      change: os.nav.change.handler(notServed),
    },
    routing: {
      report: os.routing.report.handler(notServed),
    },
    audit: {
      list: os.audit.list.handler(({ input }) => {
        calls.push(`audit.list ${input.cursor ?? 'first'}`);
        return behaviour.auditList(input);
      }),
    },
  });
  const handler = new RPCHandler(router);
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const { pathname } = new URL(request.url);
    calls.push(pathname);
    if (pathname.startsWith('/api/rpc')) {
      const { response } = await handler.handle(request, { prefix: '/api/rpc', context: {} });
      return response ?? new Response('Not found', { status: 404 });
    }
    if (pathname.startsWith('/api/auth')) {
      const text = await request.text();
      return auth(pathname.slice('/api/auth'.length), text === '' ? undefined : JSON.parse(text));
    }
    return new Response('Not found', { status: 404 });
  };
  return { fetch, calls, mutationIds, sent };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function okAuth(path: string): Response {
  if (path === '/get-session') return json(null);
  return json({ status: true });
}

/** A data layer on a fake API, with its notices and sign outs recorded. */
function layer(
  api: Pick<ReturnType<typeof fakeApi>, 'fetch'>,
  path = '/w/acme/objects/people?view=all',
  more: Partial<Parameters<typeof createDataLayer>[0]> = {},
) {
  const notices: Notice[] = [];
  const signedOut: string[] = [];
  const endings: boolean[] = [];
  // Sign outs and session changes, in the order they ran.
  const events: string[] = [];
  // What the layer handed monitoring.
  const faults: DataFault[] = [];
  const data = createDataLayer({
    origin: ORIGIN,
    notify: (notice) => notices.push(notice),
    mintId: createIdMinter({ now: () => 1_759_482_000_000, fill: (bytes) => bytes.fill(171) }),
    onSignedOut: (redirectTo, ending) => {
      signedOut.push(redirectTo);
      endings.push(ending.unsaved);
      events.push('signed out');
    },
    onSessionChange: () => events.push('session changed'),
    currentPath: () => path,
    fetch: api.fetch,
    report: (fault) => faults.push(fault),
    ...more,
  });
  return { data, notices, signedOut, endings, events, faults };
}

async function failure(promise: Promise<unknown>): Promise<DataError> {
  try {
    await promise;
  } catch (error) {
    if (isDataError(error)) return error;
    throw error;
  }
  throw new Error('The call succeeded.');
}

const count = (calls: readonly string[], path: string) => calls.filter((call) => call === path).length;

describe('me.get', () => {
  it('asks once per app load and answers from the cache after that', async () => {
    const api = fakeApi();
    const { data } = layer(api);
    expect(await data.me.get()).toEqual(ME);
    expect(await data.me.get()).toEqual(ME);
    expect(count(api.calls, '/api/rpc/me/get')).toBe(1);
  });

  it('answers undefined when nobody is signed in, without signing anyone out', async () => {
    const api = fakeApi({
      me: () => {
        throw unauthenticated();
      },
    });
    const { data, signedOut, notices } = layer(api);
    expect(await data.me.get()).toBeUndefined();
    expect(signedOut).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('forgets a failed answer, so the next call asks again', async () => {
    let fail = true;
    const api = fakeApi({
      me: () => {
        if (fail) throw new ORPCError('INTERNAL', { status: 500, message: 'Database exploded at row 7' });
        return ME;
      },
    });
    const { data } = layer(api);
    expect(await failure(data.me.get())).toMatchObject({
      code: 'INTERNAL',
      message: 'Something went wrong. Try again in a moment.',
    });
    fail = false;
    expect(await data.me.get()).toEqual(ME);
  });

  it('says whether anyone is signed in, each time it knows for certain', async () => {
    const known: boolean[] = [];
    const api = fakeApi();
    const { data } = layer(api, undefined, { onSessionKnown: (isSignedIn) => known.push(isSignedIn) });
    await data.me.get();
    // The cached answer is the same knowledge, not new knowledge.
    await data.me.get();
    expect(known).toEqual([true]);
  });

  it('says nobody is signed in when it hears so', async () => {
    const known: boolean[] = [];
    const api = fakeApi({
      me: () => {
        throw unauthenticated();
      },
    });
    const { data } = layer(api, undefined, { onSessionKnown: (isSignedIn) => known.push(isSignedIn) });
    expect(await data.me.get()).toBeUndefined();
    expect(known).toEqual([false]);
  });

  it('says nobody is signed in when a session ends under the person', async () => {
    const known: boolean[] = [];
    let session = true;
    const api = fakeApi({
      me: () => {
        if (!session) throw unauthenticated();
        return ME;
      },
      objects: () => {
        throw unauthenticated();
      },
    });
    const { data } = layer(api, undefined, { onSessionKnown: (isSignedIn) => known.push(isSignedIn) });
    await data.me.get();
    session = false;
    await failure(data.objects.list('acme'));
    expect(known).toEqual([true, false]);
  });

  it('knows a session again after a sign in, and never on a failed answer', async () => {
    const known: boolean[] = [];
    let fail = true;
    const api = fakeApi({
      me: () => {
        if (fail) throw new ORPCError('INTERNAL', { status: 500, message: 'Database exploded at row 7' });
        return ME;
      },
    });
    const { data } = layer(api, undefined, { onSessionKnown: (isSignedIn) => known.push(isSignedIn) });
    await failure(data.me.get());
    expect(known).toEqual([]);
    fail = false;
    expect(await data.me.get()).toEqual(ME);
    expect(known).toEqual([true]);
  });
});

describe('objects.list', () => {
  it("answers the workspace's objects, cached per workspace", async () => {
    const api = fakeApi();
    const { data } = layer(api);
    expect(await data.objects.list('acme')).toEqual([PEOPLE]);
    await data.objects.list('acme');
    await data.objects.list('other');
    expect(count(api.calls, '/api/rpc/objects/list')).toBe(2);
  });

  it('rejects NOT_FOUND in the shared shape, and tries again on the next call', async () => {
    let missing = true;
    const api = fakeApi({
      objects: () => {
        if (missing) {
          throw new ORPCError('NOT_FOUND', {
            status: 404,
            message: "That workspace doesn't exist, or you're not a member of it.",
          });
        }
        return [PEOPLE];
      },
    });
    const { data, signedOut } = layer(api);
    const error = await failure(data.objects.list('acme'));
    expect(error).toMatchObject({
      name: 'DataError',
      code: 'NOT_FOUND',
      message: "That workspace doesn't exist, or you're not a member of it.",
    });
    expect(signedOut).toEqual([]);
    missing = false;
    expect(await data.objects.list('acme')).toEqual([PEOPLE]);
  });

  it('signs out once on a 401, back to the page the person was on, and forgets who was signed in', async () => {
    let session = true;
    const api = fakeApi({
      me: () => {
        if (!session) throw unauthenticated();
        return ME;
      },
      objects: () => {
        throw unauthenticated();
      },
    });
    const { data, signedOut, endings, notices } = layer(api);
    await data.me.get();
    session = false;
    const [first, second] = await Promise.all([failure(data.objects.list('acme')), failure(data.objects.list('beta'))]);
    expect(first.code).toBe('UNAUTHENTICATED');
    expect(second.code).toBe('UNAUTHENTICATED');
    expect(signedOut).toEqual(['/w/acme/objects/people?view=all']);
    // Nothing was being written: sign in says only that the session ended, and the layer raises no toast.
    expect(endings).toEqual([false]);
    expect(notices).toEqual([]);
    expect(await data.me.get()).toBeUndefined();
  });

  it('ends no session on a 401 while nobody is signed in, even one that answers before who is', async () => {
    const api = fakeApi({
      me: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw unauthenticated();
      },
      objects: () => {
        throw unauthenticated();
      },
    });
    const { data, signedOut, events } = layer(api);
    // A visit before sign in: the workspace's first read and the question of who is signed in go out together,
    // and the read's 401 answers first. The route takes the visitor to sign in, keeping their address.
    const asked = data.me.get();
    expect((await failure(data.objects.list('acme'))).code).toBe('UNAUTHENTICATED');
    expect(await asked).toBeUndefined();
    expect(signedOut).toEqual([]);
    expect(events).toEqual([]);
  });

  it('still signs a person out when the held me was dropped and asked again after their session ended', async () => {
    let session = true;
    const api = fakeApi({
      me: () => {
        if (!session) throw unauthenticated();
        return ME;
      },
      objects: () => {
        if (!session) throw unauthenticated();
        throw new ORPCError('NOT_FOUND', { status: 404, message: 'Not here.' });
      },
    });
    const { data, signedOut } = layer(api);
    expect(await data.me.get()).toEqual(ME);
    // A NOT_FOUND drops the held me; the session ends; a preload asks again and hears nobody.
    await failure(data.objects.list('acme'));
    session = false;
    expect(await data.me.get()).toBeUndefined();
    // The screens still showing get 401s: the person was signed in, so they go to sign in, once.
    await failure(data.objects.list('acme'));
    await failure(data.objects.list('beta'));
    expect(signedOut).toHaveLength(1);
  });

  it('goes to sign in first, then says the session changed, so the app drops the last person’s pages', async () => {
    const api = fakeApi({
      objects: () => {
        throw unauthenticated();
      },
    });
    const { data, events } = layer(api);
    await failure(data.objects.list('acme'));
    expect(events).toEqual(['signed out', 'session changed']);
  });

  it('signs out again on a later 401 once someone is signed in again', async () => {
    let session = true;
    const api = fakeApi({
      me: () => {
        if (!session) throw unauthenticated();
        return ME;
      },
      objects: () => {
        throw unauthenticated();
      },
    });
    const { data, signedOut } = layer(api);
    await failure(data.objects.list('acme'));
    // Signed in again (another tab): me.get answers a person, so the next 401 is a new ending.
    session = true;
    expect(await data.me.get()).toEqual(ME);
    await failure(data.objects.list('acme'));
    expect(signedOut).toHaveLength(2);
  });

  it('signs nobody out on a 401 while the account is being deleted, or after it', async () => {
    let session = true;
    let answer: (deleted: { deleted: true }) => void = () => undefined;
    let asked: () => void = () => undefined;
    const confirmAsked = new Promise<void>((resolve) => {
      asked = resolve;
    });
    const api = fakeApi({
      me: () => {
        if (!session) throw unauthenticated();
        return ME;
      },
      objects: () => {
        if (!session) throw unauthenticated();
        return [PEOPLE];
      },
      deleteAccount: () =>
        new Promise((resolve) => {
          answer = resolve;
          asked();
        }),
    });
    const { data, signedOut, events } = layer(api);
    await data.me.get();
    const deleting = data.account.deletion.confirm(ME.user.email);
    await confirmAsked;
    // The server ends the session before it answers: the live connection asking again hears 401 meanwhile.
    session = false;
    expect((await failure(data.objects.list('acme'))).code).toBe('UNAUTHENTICATED');
    expect(signedOut).toEqual([]);
    answer({ deleted: true });
    await deleting;
    // A call still out answers 401 afterwards: sign in already says the account was deleted.
    expect((await failure(data.objects.list('beta'))).code).toBe('UNAUTHENTICATED');
    expect(signedOut).toEqual([]);
    expect(events).toEqual(['session changed']);
    expect(await data.me.get()).toBeUndefined();
  });

  it('ends the session as usual when the deletion itself answers 401, or fails after a 401 was held back', async () => {
    const api = fakeApi({
      deleteAccount: () => {
        throw unauthenticated();
      },
    });
    const { data, signedOut, events } = layer(api);
    await data.me.get();
    // Another tab signed out first: the deletion is the call that finds the session gone.
    expect((await failure(data.account.deletion.confirm(ME.user.email))).code).toBe('UNAUTHENTICATED');
    expect(signedOut).toEqual(['/w/acme/objects/people?view=all']);
    expect(events).toEqual(['signed out', 'session changed']);

    let session = true;
    let fail: (error: unknown) => void = () => undefined;
    let asked: () => void = () => undefined;
    const confirmAsked = new Promise<void>((resolve) => {
      asked = resolve;
    });
    const second = fakeApi({
      me: () => {
        if (!session) throw unauthenticated();
        return ME;
      },
      objects: () => {
        if (!session) throw unauthenticated();
        return [PEOPLE];
      },
      deleteAccount: () =>
        new Promise((_resolve, reject) => {
          fail = reject;
          asked();
        }),
    });
    const after = layer(second);
    await after.data.me.get();
    const deleting = after.data.account.deletion.confirm(ME.user.email);
    await confirmAsked;
    session = false;
    await failure(after.data.objects.list('acme'));
    expect(after.signedOut).toEqual([]);
    // The deletion then fails (the server timed out after ending the session): the held 401 ends it after all.
    fail(new ORPCError('INTERNAL', { status: 500, message: 'Timed out.' }));
    expect((await failure(deleting)).code).toBe('INTERNAL');
    expect(after.signedOut).toEqual(['/w/acme/objects/people?view=all']);
  });

  it('asks who is signed in again after a NOT_FOUND, since the person may have left the workspace', async () => {
    const api = fakeApi({
      objects: () => {
        throw new ORPCError('NOT_FOUND', { status: 404, message: 'Not here.' });
      },
    });
    const { data } = layer(api);
    await data.me.get();
    await failure(data.objects.list('gone'));
    await data.me.get();
    expect(count(api.calls, '/api/rpc/me/get')).toBe(2);
  });

  it('carries the answer’s Retry-After on a refusal', async () => {
    const api = fakeApi({
      objects: () => {
        throw new ORPCError('RATE_LIMITED', { status: 429, message: 'Too many tries.' });
      },
    });
    const { data } = layer({
      fetch: async (input, init) => {
        const response = await api.fetch(input, init);
        const headers = new Headers(response.headers);
        if (response.status === 429) headers.set('retry-after', '90');
        return new Response(response.body, { status: response.status, headers });
      },
    });
    expect(await failure(data.objects.list('acme'))).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 90 });
  });
});

describe('access', () => {
  it('reads the person’s own role and permissions once per workspace', async () => {
    const api = fakeApi();
    const { data } = layer(api);
    expect(await data.access.mine('acme')).toEqual({
      memberId: ADA_MEMBER.id,
      role: 'member',
      roleLabel: 'Member',
      permissions: ['records.export'],
    });
    await data.access.mine('acme');
    expect(count(api.calls, '/api/rpc/access/mine')).toBe(1);
    await data.access.mine('other');
    expect(count(api.calls, '/api/rpc/access/mine')).toBe(2);
  });
});

describe('members and attributes', () => {
  it('reads a workspace’s members once', async () => {
    const api = fakeApi();
    const { data } = layer(api);
    expect(await data.members.list('acme')).toEqual([ADA_MEMBER]);
    await data.members.list('acme');
    expect(count(api.calls, '/api/rpc/members/list')).toBe(1);
  });

  it('reads an object’s attributes once, and again after one is added', async () => {
    const added = { ...TITLE, id: '0199a6f2-0000-7000-8000-000000000007', apiSlug: 'nickname', title: 'Nickname' };
    const api = fakeApi({ addAttribute: () => added });
    const { data } = layer(api);
    await data.attributes.list('acme', PEOPLE.id);
    await data.attributes.list('acme', PEOPLE.id);
    expect(count(api.calls, '/api/rpc/attributes/list')).toBe(1);
    const id = data.attributes.newId();
    expect(await data.attributes.create('acme', { id, objectId: PEOPLE.id, title: 'Nickname', type: 'text' })).toEqual(
      added,
    );
    await data.attributes.list('acme', PEOPLE.id);
    expect(count(api.calls, '/api/rpc/attributes/list')).toBe(2);
  });

  it('refuses a taken API name on its field', async () => {
    const api = fakeApi({
      addAttribute: () => {
        throw new ORPCError('SLUG_TAKEN', {
          status: 409,
          message: 'An attribute here already uses this API name.',
          data: {
            refusals: [
              { code: 'SLUG_TAKEN', message: 'An attribute here already uses this API name.', field: 'apiSlug' },
            ],
          },
        });
      },
    });
    const { data } = layer(api);
    const error = await failure(
      data.attributes.create('acme', { id: data.attributes.newId(), objectId: PEOPLE.id, title: 'Name', type: 'text' }),
    );
    expect(error).toMatchObject({ code: 'SLUG_TAKEN', data: { refusals: [{ field: 'apiSlug' }] } });
  });

  it('reads settings’ list (archived ones too) apart from the tables’, and keeps a move’s answer (spec 0012)', async () => {
    const archived = { ...TITLE, id: '0199a6f2-0000-7000-8000-000000000008', isArchived: true };
    const api = fakeApi({ attributes: () => [TITLE, archived], attributeWrite: () => [archived, TITLE] });
    const reloads: string[] = [];
    const { data } = layer(api, undefined, { onDefinitionsChange: () => reloads.push('reload') });
    await data.attributes.all('acme', PEOPLE.id);
    await data.attributes.all('acme', PEOPLE.id);
    await data.attributes.list('acme', PEOPLE.id);
    expect(count(api.calls, '/api/rpc/attributes/list')).toBe(2);
    // A move answers the whole settings list in its new order: kept, and the page reloads with no read.
    const order = await data.attributes.reorder('acme', archived.id, 0);
    expect(order.map((each) => each.id)).toEqual([archived.id, TITLE.id]);
    expect(await data.attributes.all('acme', PEOPLE.id)).toEqual(order);
    expect(count(api.calls, '/api/rpc/attributes/list')).toBe(2);
    expect(reloads).toEqual(['reload']);
    // The tables' list is read again next time.
    await data.attributes.list('acme', PEOPLE.id);
    expect(count(api.calls, '/api/rpc/attributes/list')).toBe(3);
  });
  const COMPANIES_ID = '0199a6f2-0000-7000-8000-000000000012';

  it('drops both ends’ objects after an archive or restore, waits for the server, and sends one mutation id', async () => {
    const team = { ...TITLE, id: '0199a6f2-0000-7000-8000-000000000010', objectId: COMPANIES_ID, title: 'Team' };
    const company = { ...TITLE, id: '0199a6f2-0000-7000-8000-000000000011', title: 'Company' };
    const api = fakeApi({ attributeWrite: () => [company, team] });
    const { data } = layer(api);
    await data.attributes.list('acme', PEOPLE.id);
    await data.attributes.list('acme', COMPANIES_ID);
    const ends = await data.attributes.archive('acme', company.id);
    expect(ends.map((each) => each.objectId)).toEqual([PEOPLE.id, COMPANIES_ID]);
    expect(api.mutationIds).toHaveLength(1);
    await data.attributes.list('acme', PEOPLE.id);
    await data.attributes.list('acme', COMPANIES_ID);
    expect(count(api.calls, '/api/rpc/attributes/list')).toBe(4);
    await data.attributes.restore('acme', company.id);
    const edited = await data.attributes.update('acme', company.id, { title: 'Employer', defaultValue: null });
    expect(edited.id).toBe(company.id);
    expect(api.mutationIds).toHaveLength(3);
  });

  it('creates a relationship with the dialog’s id, drops both objects’ lists, and renames only what changed (spec 0014)', async () => {
    const team = { ...TITLE, id: '0199a6f2-0000-7000-8000-000000000010', objectId: COMPANIES_ID, title: 'Team' };
    const company = { ...TITLE, id: '0199a6f2-0000-7000-8000-000000000011', title: 'Company' };
    const answer = {
      relationshipId: '0199a6f2-0000-7000-8000-000000000013',
      cardinality: 'many_to_one' as const,
      from: company,
      to: team,
    };
    const api = fakeApi({ relationshipWrite: () => answer });
    const reloads: string[] = [];
    const { data } = layer(api, undefined, { onDefinitionsChange: () => reloads.push('reload') });
    await data.attributes.list('acme', PEOPLE.id);
    await data.attributes.list('acme', COMPANIES_ID);
    const id = data.relationships.newId();
    const made = await data.relationships.create('acme', {
      id,
      cardinality: 'many_to_one',
      from: { objectId: PEOPLE.id, title: 'Company' },
      to: { objectId: COMPANIES_ID, title: 'Team' },
    });
    expect(made).toEqual(answer);
    expect(api.sent.at(-1)).toMatchObject({ id, cardinality: 'many_to_one', from: { title: 'Company' } });
    expect(reloads).toEqual(['reload']);
    // Both objects' columns are read again.
    await data.attributes.list('acme', PEOPLE.id);
    await data.attributes.list('acme', COMPANIES_ID);
    expect(count(api.calls, '/api/rpc/attributes/list')).toBe(4);
    await data.relationships.update('acme', answer.relationshipId, { to: 'Staff' });
    expect(api.sent.at(-1)).toEqual({
      workspace: 'acme',
      relationshipId: answer.relationshipId,
      to: { title: 'Staff' },
      mutationId: api.mutationIds.at(-1),
    });
    // Both objects' lists go: each side carries its pair's name.
    await data.attributes.list('acme', PEOPLE.id);
    await data.attributes.list('acme', COMPANIES_ID);
    expect(count(api.calls, '/api/rpc/attributes/list')).toBe(6);
  });

  it('maps an attribute to the field set’s, members editable and unlinkable references read only', () => {
    expect(toFieldAttribute(TITLE)).toEqual({
      id: TITLE.id,
      name: 'Job title',
      // Its API name, from which a standard attribute takes its own icon.
      apiSlug: TITLE.apiSlug,
      type: 'text',
      allowMultiple: false,
      isRequired: false,
      isUnique: false,
      isReadOnly: false,
    });
    const owner = { ...TITLE, type: 'actor_reference' as const, title: 'Owner' };
    // A member (Owner) edits through the member picker everywhere, a create form and a bulk edit too.
    expect(toFieldAttribute(owner, 'Set on the record page')).toMatchObject({ isReadOnly: false });
    expect(toFieldAttribute(owner, 'Set on the record page')).not.toHaveProperty('readOnlyReason');
    expect(isEditableHere(owner)).toBe(true);
    // The server's own reason still makes it read only (spec 0009, AC-142).
    expect(toFieldAttribute({ ...owner, readOnly: { reason: "Your role can't change Owner." } })).toMatchObject({
      isReadOnly: true,
      readOnlyReason: "Your role can't change Owner.",
    });
    const company = { ...TITLE, type: 'record_reference' as const, isMulti: true };
    // A side with no relationship the person can see (one way, or its far object hidden) can't link from here.
    expect(toFieldAttribute(company)).toMatchObject({ isReadOnly: true, cardinality: 'many', allowMultiple: true });
    const linked = {
      ...company,
      relationship: {
        id: TITLE.id,
        cardinality: 'many_to_many' as const,
        side: 'from' as const,
        targetObjectIds: [COMPANIES_ID],
        farHoldsOne: false,
      },
    };
    expect(toFieldAttribute(linked)).toMatchObject({ isReadOnly: false, cardinality: 'many' });
    expect(isEditableHere(linked)).toBe(false);
    // The create form asks for a reference that can link (sent with the create), never one that can't.
    expect(isAskedOnCreate(linked)).toBe(true);
    expect(isAskedOnCreate(company)).toBe(false);
    expect(isAskedOnCreate({ ...linked, isSystem: true })).toBe(false);
    expect(isAskedOnCreate(owner)).toBe(true);
    const createdAt = { ...TITLE, type: 'timestamp' as const, isSystem: true };
    expect(toFieldAttribute(createdAt, 'unused')).toMatchObject({ isReadOnly: true });
    expect(toFieldAttribute(createdAt, 'unused').readOnlyReason).toBeUndefined();
  });

  it('offers members by name or email, ignoring case, Me pinned by the picker while empty and first once matched', () => {
    const members = toActorDisplays([
      { id: '0192a000-0000-7000-8000-000000000001', name: 'Ada Lovelace', email: 'ada@acme.test' },
      { id: '0192a000-0000-7000-8000-000000000002', name: 'Grace Hopper', email: 'grace@navy.test' },
      { id: '0192a000-0000-7000-8000-000000000003', name: 'Alan Turing', email: 'alan@acme.test' },
    ]);
    const names = (query: string, meId?: string) => searchMembers(members, query, meId).map((each) => each.name);
    expect(names('')).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing']);
    expect(names('  HOPPER ')).toEqual(['Grace Hopper']);
    expect(names('acme.test')).toEqual(['Ada Lovelace', 'Alan Turing']);
    const me = '0192a000-0000-7000-8000-000000000003';
    // Nothing typed: Me is left out, since the picker pins Me first.
    expect(names('', me)).toEqual(['Ada Lovelace', 'Grace Hopper']);
    // Typed: the picker pins nothing, so Me leads the matches when it matches, and is absent when it doesn't.
    expect(names('a', me)).toEqual(['Alan Turing', 'Ada Lovelace', 'Grace Hopper']);
    expect(names('grace', me)).toEqual(['Grace Hopper']);
    expect(names('zzz')).toEqual([]);
  });

  it('makes a field the server says the person may only read read only, with the server’s reason (AC-142)', () => {
    const ruled = { ...TITLE, readOnly: { reason: "Your role can't change Job title." } };
    expect(toFieldAttribute(ruled)).toMatchObject({
      isReadOnly: true,
      readOnlyReason: "Your role can't change Job title.",
    });
    expect(isEditableHere(ruled)).toBe(false);
    expect(isEditableHere(TITLE)).toBe(true);
    // On a reference, the server's reason wins over the screen's.
    const company = { ...ruled, type: 'record_reference' as const };
    expect(toFieldAttribute(company, 'Set on the record page').readOnlyReason).toBe(
      "Your role can't change Job title.",
    );
    // A system attribute keeps the field set's own reason.
    const createdAt = { ...TITLE, isSystem: true, readOnly: { reason: 'Created at is set by the system.' } };
    expect(toFieldAttribute(createdAt).readOnlyReason).toBeUndefined();
  });
});

describe('records', () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 40));

  it('opens a view with its count and first block, reading the first 100 rows by position', async () => {
    const positions: number[] = [];
    const api = fakeApi({
      query: (position, limit) => {
        positions.push(position, limit);
        return [personRow(0), personRow(1), personRow(2)];
      },
    });
    const { data } = layer(api);
    const view = await data.records.view('acme', PEOPLE.id);
    const state = view.getSnapshot();
    expect(state.status).toBe('ready');
    expect(state.source.count).toBe(3);
    expect(state.source.getItem(1)?.values[TITLE.id]).toBe('Engineer');
    expect(positions).toEqual([0, 100]);
    expect(await data.records.view('acme', PEOPLE.id)).toBe(view);
  });

  it('opens a view without waiting for it to settle, so a slow load can show the table loading in place', async () => {
    const api = fakeApi({ query: () => [personRow(0)] });
    const { data } = layer(api);
    // No grace: answered before its first rows are in, still loading.
    const view = await data.records.open('acme', PEOPLE.id);
    expect(view.getSnapshot().status).toBe('loading');
    await view.ready();
    expect(view.getSnapshot().status).toBe('ready');
    // The same view as `view` answers, settled; and a grace a quick load fits in answers it settled.
    expect(await data.records.view('acme', PEOPLE.id)).toBe(view);
    expect((await data.records.open('acme', PEOPLE.id, {}, [], 1_000)).getSnapshot().status).toBe('ready');
  });

  it('waits the answer’s Retry-After when the workspace has too many reads in flight, then reads again', async () => {
    let busy = true;
    const api = fakeApi({
      count: () => {
        if (busy) {
          busy = false;
          throw new ORPCError('TOO_MANY_REQUESTS', { status: 429, message: 'Busy.' });
        }
        return 3;
      },
    });
    const { data } = layer({
      fetch: async (input, init) => {
        const response = await api.fetch(input, init);
        const headers = new Headers(response.headers);
        if (response.status === 429) headers.set('retry-after', '0');
        return new Response(response.body, { status: response.status, headers });
      },
    });
    const view = await data.records.view('acme', PEOPLE.id);
    expect(view.getSnapshot().status).toBe('ready');
    expect(count(api.calls, '/api/rpc/records/count')).toBe(2);
  });

  it('drops a pending edit with every record when the session ended, and goes to sign in', async () => {
    const api = fakeApi({
      setValues: () => {
        throw unauthenticated();
      },
    });
    const { data, signedOut, endings, notices } = layer(api);
    const view = await data.records.view('acme', PEOPLE.id);
    const row = view.getSnapshot().source.getItem(0);
    data.records.setValue('acme', { rowId: row?.id ?? '', columnId: TITLE.id, value: 'Lead' });
    await settled();
    // The last person's records leave the browser with their session; nothing shows the edit.
    expect(view.getSnapshot().source.getItem(0)).toBeUndefined();
    expect(signedOut).toEqual(['/w/acme/objects/people?view=all']);
    // The edit was on its way, so sign in is told it wasn't saved; no toast besides.
    expect(endings).toEqual([true]);
    expect(notices).toEqual([]);
  });

  it('tells sign in a new column wasn’t saved when the session ended while it was on its way', async () => {
    const api = fakeApi({
      addAttribute: () => {
        throw unauthenticated();
      },
    });
    const { data, signedOut, endings, notices } = layer(api);
    await failure(
      data.attributes.create('acme', {
        id: data.attributes.newId(),
        objectId: PEOPLE.id,
        title: 'Nickname',
        type: 'text',
      }),
    );
    expect(signedOut).toHaveLength(1);
    expect(endings).toEqual([true]);
    expect(notices).toEqual([]);
  });
});

describe('live updates', () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 40));

  /** A realtime client that records what it was asked to listen to. */
  function fakeTransport() {
    const channels: LiveChannel[] = [];
    let closed = 0;
    const transport: LiveTransport = {
      listen: (channel) => {
        channels.push(channel);
        return () => undefined;
      },
      onTrouble: () => () => undefined,
      close: () => {
        closed += 1;
      },
    };
    const channel = () => {
      const [first] = channels;
      if (first === undefined) throw new Error('Nothing is listened to.');
      return first;
    };
    return { transport, channels, channel, closed: () => closed };
  }

  const AT = '2026-10-08T09:00:00.000Z';
  const changed = (seq: number, recordIds: readonly string[], mutationId?: string): ChangeEvent => ({
    seq,
    at: AT,
    kind: 'records',
    objectId: PEOPLE.id,
    recordIds: [...recordIds],
    attributeIds: [TITLE.id],
    ...(mutationId === undefined ? {} : { mutationId }),
  });
  const definitions = (seq: number): ChangeEvent => ({ seq, at: AT, kind: 'definitions', objectId: PEOPLE.id });

  /** The layer with live updates on a fake client, its view of People open and subscribed. */
  async function liveLayer(
    overrides: Partial<Behaviour> = {},
    more: Partial<Parameters<typeof createDataLayer>[0]> = {},
  ) {
    const api = fakeApi(overrides);
    const client = fakeTransport();
    let definitionChanges = 0;
    const { data } = layer(api, '/w/acme/objects/people', {
      ...more,
      realtimeUrl: 'ws://centrifugo.test/connection/websocket',
      // No spread before a reread: the tests wait on real time.
      random: () => 0,
      onDefinitionsChange: () => {
        definitionChanges += 1;
      },
      loadLive: () =>
        Promise.resolve({
          // No spread before a resync or catch up: the tests wait on real time.
          createLive: (options) =>
            createLive({ ...options, open: () => Promise.resolve(client.transport), random: () => 0 }),
        }),
    });
    // The People screen shows the job title column (spec 0006, AC-55: only shown attributes are read and refetched).
    const view = await data.records.view('acme', PEOPLE.id, {}, [TITLE.id]);
    // Shown by a screen: a view nobody shows keeps its changes until one does.
    view.retain([TITLE.id]);
    await settled();
    client.channel().onSubscribed({ wasRecovering: false, recovered: false });
    await settled();
    return { api, client, data, view, definitionChanges: () => definitionChanges };
  }

  it("listens to the workspace's channel with the API's tokens, and fetches a change from elsewhere in place", async () => {
    const edited = { ...personRow(0, 'CEO'), versions: { [TITLE.id]: '0199a6f2-0002-7000-8000-000000000000' } };
    const { api, client, view } = await liveLayer({ get: (ids) => (ids.includes(edited.id) ? [edited] : []) });
    expect(client.channel()).toMatchObject({ name: 'workspace:acme', token: 'subscription-token' });
    expect(await client.channel().renew()).toBe('subscription-token');
    const gets = count(api.calls, '/api/rpc/records/get');
    client.channel().onPublication(changed(1, [edited.id]));
    await settled();
    expect(count(api.calls, '/api/rpc/records/get')).toBe(gets + 1);
    expect(view.getSnapshot().source.getItem(0)?.values[TITLE.id]).toBe('CEO');
  });

  it("skips this tab's own write when it comes back", async () => {
    const { api, client, data, view } = await liveLayer({ setValues: () => personRow(1, 'Lead') });
    data.records.setValue('acme', { rowId: personRow(1).id, columnId: TITLE.id, value: 'Lead' });
    await settled();
    const [mutationId] = api.mutationIds;
    const gets = count(api.calls, '/api/rpc/records/get');
    client.channel().onPublication(changed(1, [personRow(1).id], mutationId));
    await settled();
    expect(count(api.calls, '/api/rpc/records/get')).toBe(gets);
    expect(view.getSnapshot().source.getItem(1)?.values[TITLE.id]).toBe('Lead');
  });

  it('tells this tab, by name, when another member replaced a value it saved (spec 0006, AC-46)', async () => {
    const BEA: MemberView = {
      id: '0199a6f2-0000-7000-8000-0000000000b0',
      name: 'Bea',
      email: 'bea@example.com',
      role: 'member',
      joinedAt: '2026-10-02T09:00:00.000Z',
    };
    const MINE = '0199a6f2-0003-7000-8000-000000000000';
    const replaced: ReplacedValue[] = [];
    let memberReads = 0;
    const saved = { ...personRow(1, 'Lead'), revision: 1, versions: { [TITLE.id]: MINE } };
    const { client, data } = await liveLayer(
      // Bea joined after the member list was first read: the notice reads it once more to name her.
      { setValues: () => saved, members: () => (memberReads++ === 0 ? [ADA_MEMBER] : [ADA_MEMBER, BEA]) },
      { onReplaced: (notice) => replaced.push(notice) },
    );
    data.records.setValue('acme', { rowId: saved.id, columnId: TITLE.id, value: 'Lead' });
    await settled();
    const by = (member: MemberView) => ({
      ...changed(1, [saved.id]),
      replaced: {
        by: { type: 'member' as const, id: member.id },
        cells: [{ recordId: saved.id, attributeId: TITLE.id, versionId: MINE }],
      },
    });
    // Saved by this person elsewhere (another tab): nothing.
    client.channel().onPublication(by(ADA_MEMBER));
    await settled();
    expect(replaced).toEqual([]);
    client.channel().onPublication({ ...by(BEA), seq: 2 });
    await settled();
    expect(replaced).toMatchObject([
      {
        workspace: 'acme',
        recordId: saved.id,
        recordName: 'P1',
        attributeTitle: 'Job title',
        others: 0,
        by: { kind: 'member', name: 'Bea' },
      },
    ]);
  });

  it('undoes the last change, naming the attribute, and finds nothing more to undo (spec 0006, AC-48)', async () => {
    const before = personRow(1, 'Engineer');
    const saved = {
      ...personRow(1, 'Lead'),
      revision: 1,
      versions: { [TITLE.id]: '0199a6f2-0003-7000-8000-000000000000' },
    };
    const answers = [
      saved,
      { ...before, revision: 2, versions: { [TITLE.id]: '0199a6f2-0004-7000-8000-000000000000' } },
    ];
    const { data, view } = await liveLayer({ setValues: () => answers.shift() ?? saved });
    await data.records.setValues('acme', [{ rowId: saved.id, columnId: TITLE.id, value: 'Lead' }]);
    const undone = await data.undo.run('acme');
    expect(undone).toMatchObject({ kind: 'undone', action: 'cell', undone: 1, kept: 0, attributeTitle: 'Job title' });
    expect(view.getSnapshot().source.getItem(1)?.values[TITLE.id]).toBe('Engineer');
    expect(await data.undo.run('acme')).toEqual({ kind: 'nothing' });
  });

  it('deletes records as one undoable action, and undoes it by its batch with the object named (spec 0022)', async () => {
    const { data, api } = await liveLayer({
      deleteMany: (recordIds) => recordIds.map((recordId) => ({ recordId, state: 'deleted' as const })),
      restoreBatch: () => [{ recordId: personRow(1).id, state: 'restored' as const }],
    });
    const outcome = await data.records.deleteMany('acme', PEOPLE.id, [personRow(1).id]);
    expect(outcome).toMatchObject({ kind: 'done', deleted: 1, refused: 0, recordName: 'P1' });
    const deleted = api.sent.find(
      (input): input is { batchId: string } => typeof input === 'object' && input !== null && 'batchId' in input,
    );
    const undone = await data.undo.run('acme', outcome.kind === 'done' ? outcome.undoId : undefined);
    expect(undone).toMatchObject({ kind: 'restored', restored: 1, kept: 0, pluralName: 'People', recordName: 'P1' });
    expect(api.sent).toContainEqual(expect.objectContaining({ batchId: deleted?.batchId }));
  });

  it('lists the trash and restores from it, through the trash procedures (spec 0022)', async () => {
    const item = {
      recordId: personRow(4).id,
      objectId: PEOPLE.id,
      display: personRow(4).display,
      deletedAt: '2026-10-15T09:00:00.000Z',
      deletedBy: { type: 'member' as const, id: ADA_MEMBER.id },
      expiresAt: '2026-11-14T09:00:00.000Z',
    };
    const api = fakeApi({
      trashQuery: () => ({ items: [item] }),
      trashCount: () => ({ count: 1, atLeast: false }),
      trashRestore: (recordIds) =>
        recordIds.map((recordId) => ({ recordId, state: 'restored' as const, objectId: PEOPLE.id })),
    });
    const { data } = layer(api);
    const view = await data.trash.view('acme');
    const release = view.retain();
    await view.ready();
    expect(view.getSnapshot()).toMatchObject({ status: 'ready', count: { count: 1, atLeast: false } });
    expect(await data.trash.restore('acme', [item.recordId])).toEqual({
      kind: 'done',
      restored: 1,
      refused: 0,
      refusedIds: [],
      reasons: [],
      objectIds: [PEOPLE.id],
    });
    expect(count(api.calls, '/api/rpc/trash/restore')).toBe(1);
    release();
  });

  it("reads an object's attributes again on a definitions change, and reloads the app's pages only when they changed", async () => {
    const NICKNAME: AttributeDefinition = { ...TITLE, id: '0199a6f2-0000-7000-8000-000000000015', apiSlug: 'nickname' };
    let lists = 0;
    const { api, client, data, definitionChanges } = await liveLayer({
      attributes: () => {
        lists += 1;
        return lists >= 3 ? [TITLE, NICKNAME] : [TITLE];
      },
    });
    await data.attributes.list('acme', PEOPLE.id);
    // Read again, the same: nothing to reload.
    client.channel().onPublication(definitions(1));
    await settled();
    expect(definitionChanges()).toBe(0);
    // Read again, with a new column: the app's pages load again, and find it cached.
    client.channel().onPublication(definitions(2));
    await settled();
    expect(definitionChanges()).toBe(1);
    expect(await data.attributes.list('acme', PEOPLE.id)).toEqual([TITLE, NICKNAME]);
    expect(count(api.calls, '/api/rpc/attributes/list')).toBe(3);
  });

  it('drops a held settings list on an attribute change and reloads the pages, which read it again (spec 0012)', async () => {
    const { api, client, data, definitionChanges } = await liveLayer({});
    await data.attributes.all('acme', PEOPLE.id);
    const lists = () => count(api.calls, '/api/rpc/attributes/list');
    const before = lists();
    client
      .channel()
      .onPublication({ seq: 1, at: AT, kind: 'definitions', objectId: PEOPLE.id, attributeIds: [TITLE.id] });
    await settled();
    // The table's live list is read again now; the settings list is dropped, the pages reload, and their next
    // load reads it.
    expect(lists()).toBe(before + 1);
    expect(definitionChanges()).toBe(1);
    await data.attributes.all('acme', PEOPLE.id);
    expect(lists()).toBe(before + 2);
  });

  it('reads every held attribute list again only when an object was archived or restored (spec 0012)', async () => {
    const COMPANIES: ObjectSummary = {
      ...PEOPLE,
      id: '0199a6f2-0000-7000-8000-0000000000d1',
      apiSlug: 'companies',
      singularName: 'Company',
      pluralName: 'Companies',
      standardKey: 'companies',
      position: 1,
    };
    let reads = 0;
    const { api, client, data } = await liveLayer({
      objects: () => {
        reads += 1;
        if (reads === 1) return [PEOPLE, COMPANIES];
        if (reads === 2) return [PEOPLE, { ...COMPANIES, hue: 'red' }];
        return [PEOPLE, { ...COMPANIES, hue: 'red', isArchived: true }];
      },
    });
    await data.objects.list('acme');
    await data.attributes.list('acme', PEOPLE.id);
    const lists = () => count(api.calls, '/api/rpc/attributes/list');
    const before = lists();
    // Companies restyled: the objects are read again, People's attributes aren't.
    client.channel().onPublication({ seq: 1, at: AT, kind: 'definitions', objectId: COMPANIES.id });
    await settled();
    expect(lists()).toBe(before);
    // Companies archived: People's Company reference is archived too, so People's attributes are read again.
    client.channel().onPublication({ seq: 2, at: AT, kind: 'definitions', objectId: COMPANIES.id });
    await settled();
    expect(lists()).toBe(before + 1);
  });

  it('reads the objects again when an object itself changed, and nothing for a list (spec 0007, AC-81)', async () => {
    let reads = 0;
    const { api, client, data, definitionChanges } = await liveLayer({
      objects: () => {
        reads += 1;
        return reads >= 2 ? [{ ...PEOPLE, pluralName: 'Contacts' }] : [PEOPLE];
      },
    });
    await data.objects.list('acme');
    const before = count(api.calls, '/api/rpc/objects/list');
    // A list's own definitions: no screen holds lists, nothing is read.
    client.channel().onPublication({ seq: 1, at: AT, kind: 'definitions', listId: TITLE.id, objectId: PEOPLE.id });
    await settled();
    expect(count(api.calls, '/api/rpc/objects/list')).toBe(before);
    // People renamed: an event naming the object and no attributes reads the objects again, and they differ.
    client.channel().onPublication({ seq: 2, at: AT, kind: 'definitions', objectId: PEOPLE.id });
    await settled();
    expect(count(api.calls, '/api/rpc/objects/list')).toBe(before + 1);
    expect(definitionChanges()).toBe(1);
    expect((await data.objects.list('acme'))[0]?.pluralName).toBe('Contacts');
  });

  it('reads the members again on a members change, and the person’s own access when it names them (AC-82)', async () => {
    const BEA: MemberView = {
      id: '0199a6f2-0000-7000-8000-0000000000b0',
      name: 'Bea',
      email: 'bea@example.com',
      role: 'member',
      joinedAt: '2026-10-02T09:00:00.000Z',
    };
    let memberReads = 0;
    const { api, client, data, definitionChanges } = await liveLayer({
      members: () => (memberReads++ === 0 ? [ADA_MEMBER] : [ADA_MEMBER, BEA]),
    });
    await data.members.list('acme');
    await data.access.mine('acme');
    const accessReads = count(api.calls, '/api/rpc/access/mine');
    // Bea joined: the list is read again and differs; the event doesn't name the person, so access stays.
    client.channel().onPublication({ seq: 1, at: AT, kind: 'members', memberIds: [BEA.id] });
    await settled();
    expect(await data.members.list('acme')).toEqual([ADA_MEMBER, BEA]);
    expect(definitionChanges()).toBe(1);
    expect(count(api.calls, '/api/rpc/access/mine')).toBe(accessReads);
    // The person's own role changed: their access is read again.
    client.channel().onPublication({ seq: 2, at: AT, kind: 'members', memberIds: [ADA_MEMBER.id] });
    await settled();
    expect(count(api.calls, '/api/rpc/access/mine')).toBe(accessReads + 1);
  });

  it('reads everything held again on an access change naming the person, and nothing for someone else’s', async () => {
    const { api, client, data } = await liveLayer();
    await data.access.mine('acme');
    const counts = () => count(api.calls, '/api/rpc/records/count');
    const before = counts();
    client
      .channel()
      .onPublication({ seq: 1, at: AT, kind: 'access', memberIds: ['0199a6f2-0000-7000-8000-0000000000b0'] });
    await settled();
    expect(counts()).toBe(before);
    client.channel().onPublication({ seq: 2, at: AT, kind: 'access', memberIds: [ADA_MEMBER.id] });
    await settled();
    expect(counts()).toBeGreaterThan(before);
  });

  it('says paused while the subscription is down, and stops listening on sign out', async () => {
    const { client, data } = await liveLayer();
    const heard: string[] = [];
    data.live.subscribe(() => heard.push(data.live.status()));
    expect(data.live.status()).toBe('live');
    client.channel().onDown('resubscribing');
    expect(data.live.status()).toBe('paused');
    client.channel().onSubscribed({ wasRecovering: true, recovered: true });
    expect(heard).toEqual(['paused', 'live']);
    await data.auth.signOut();
    await settled();
    expect(client.closed()).toBe(1);
  });

  it('is off without a realtime address, and asks for no token', async () => {
    const api = fakeApi();
    const { data } = layer(api);
    data.live.prepare('acme');
    await data.records.view('acme', PEOPLE.id);
    await settled();
    expect(data.live.status()).toBe('off');
    expect(count(api.calls, '/api/rpc/realtime/subscriptionToken')).toBe(0);
    expect(count(api.calls, '/api/rpc/realtime/catchUp')).toBe(0);
  });

  it('reads the head before the first read, and reuses that token to listen (spec 0007, AC-74)', async () => {
    const { api } = await liveLayer({ head: () => 7 });
    const first = api.calls.findIndex((path) => path.startsWith('/api/rpc/realtime/subscriptionToken'));
    const reads = ['/api/rpc/records/count', '/api/rpc/records/query'].map((path) => api.calls.indexOf(path));
    expect(first).toBeGreaterThanOrEqual(0);
    for (const read of reads) expect(read).toBeGreaterThan(first);
    expect(count(api.calls, '/api/rpc/realtime/subscriptionToken')).toBe(1);
  });

  it('catches up from the head on subscribing, and a write made during the first load shows (AC-74)', async () => {
    const edited = { ...personRow(0, 'CEO'), versions: { [TITLE.id]: '0199a6f2-0002-7000-8000-000000000000' } };
    const afters: number[] = [];
    const { api, view } = await liveLayer({
      head: () => 4,
      catchUp: (after) => {
        afters.push(after);
        return { head: 5, reset: false, events: [changed(5, [edited.id])] };
      },
      get: (ids) => (ids.includes(edited.id) ? [edited] : []),
    });
    expect(afters).toEqual([4]);
    // The caught up ids are fetched a frame later, which a slow CI runner can push past the setup's settle.
    await expect.poll(() => count(api.calls, '/api/rpc/records/get')).toBe(1);
    await expect.poll(() => view.getSnapshot().source.getItem(0)?.values[TITLE.id]).toBe('CEO');
  });

  it('resyncs and starts from the live token when the head could not be read before the first reads (AC-74)', async () => {
    let tokens = 0;
    const afters: number[] = [];
    const { api } = await liveLayer({
      head: () => {
        tokens += 1;
        if (tokens === 1) throw new ORPCError('INTERNAL', { status: 500, message: 'Something went wrong.' });
        return 7;
      },
      catchUp: (after) => {
        afters.push(after);
        return { head: after, reset: false, events: [] };
      },
    });
    await settled();
    // The reads went ahead without a head; the live client's own token gives it, and what was read is read again.
    expect(afters).toEqual([7]);
    expect(count(api.calls, '/api/rpc/records/count')).toBe(2);
  });

  it('fills a gap through catch up rather than refetching everything held', async () => {
    const afters: number[] = [];
    const { api, client } = await liveLayer({
      catchUp: (after) => {
        afters.push(after);
        return after === 0 ? { head: 0, reset: false, events: [] } : { head: 3, reset: false, events: [] };
      },
    });
    const queries = count(api.calls, '/api/rpc/records/query');
    client.channel().onPublication(changed(1, []));
    client.channel().onPublication(changed(3, []));
    await settled();
    expect(afters).toEqual([0, 1]);
    expect(count(api.calls, '/api/rpc/records/query')).toBe(queries);
  });

  it('resyncs every store when catch up answers reset, with no reload of the page (AC-73)', async () => {
    let resets = 0;
    const { api, client } = await liveLayer({
      catchUp: () => {
        resets += 1;
        return { head: 9_000, reset: true, events: [] };
      },
    });
    await settled();
    expect(resets).toBe(1);
    // The view's count and the blocks on screen again, once; the next event counts on from the new head.
    expect(count(api.calls, '/api/rpc/records/count')).toBe(2);
    const counts = count(api.calls, '/api/rpc/records/count');
    client.channel().onPublication(changed(9_001, []));
    await settled();
    expect(resets).toBe(1);
    expect(count(api.calls, '/api/rpc/records/count')).toBe(counts);
  });
});

describe('workspaces.create', () => {
  const input = { id: '0199a6f2-0000-7000-8000-000000000010', name: 'Acme', slug: 'acme', memberName: 'Ada' };

  it('carries a refusal on its field, in the shared shape', async () => {
    const api = fakeApi({
      create: () => {
        throw new ORPCError('SLUG_TAKEN', {
          status: 409,
          message: 'That workspace address is taken. Pick another.',
          data: {
            refusals: [
              { code: 'SLUG_TAKEN', message: 'That workspace address is taken. Pick another.', field: 'slug' },
            ],
          },
        });
      },
    });
    const { data } = layer(api);
    expect(await failure(data.workspaces.create(input))).toMatchObject({
      code: 'SLUG_TAKEN',
      message: 'That workspace address is taken. Pick another.',
      data: { refusals: [{ code: 'SLUG_TAKEN', field: 'slug' }] },
    });
  });

  it('asks who is signed in again after making one, so the new workspace is listed', async () => {
    const api = fakeApi();
    const { data } = layer(api);
    await data.me.get();
    await data.workspaces.create(input);
    await data.me.get();
    expect(count(api.calls, '/api/rpc/me/get')).toBe(2);
  });

  it('asks whether an address is free each time, never from a cache (spec 0036)', async () => {
    const api = fakeApi();
    const { data } = layer(api);
    expect(await data.workspaces.slugAvailable('acme')).toBe(false);
    expect(await data.workspaces.slugAvailable('halcyon')).toBe(true);
    expect(await data.workspaces.slugAvailable('halcyon')).toBe(true);
    expect(count(api.calls, '/api/rpc/workspaces/slugAvailable')).toBe(3);
  });

  it('carries a refused check as a DataError, with its wait', async () => {
    const api = fakeApi({
      slugAvailable: () => {
        throw new ORPCError('RATE_LIMITED', { status: 429, message: 'Too many address checks. Wait a moment.' });
      },
    });
    const { data } = layer(api);
    expect(await failure(data.workspaces.slugAvailable('acme'))).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('mints UUID v7 ids from the clock and the random source', () => {
    const { data } = layer(fakeApi());
    const id = data.workspaces.newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(1_759_482_000_000);
  });
});

describe('failures that never reached the API', () => {
  it('answers API_UNAVAILABLE when the network fails', async () => {
    const { data } = layer({
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    expect(await failure(data.system.status())).toMatchObject({
      code: 'API_UNAVAILABLE',
      message: 'Can’t reach Timefix. Check your connection, then try again.',
    });
  });

  it("answers API_UNAVAILABLE for a proxy's 503 page, in the layer's own words", async () => {
    const { data } = layer({
      fetch: () => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 503 })),
    });
    expect(await failure(data.system.status())).toMatchObject({ code: 'API_UNAVAILABLE' });
  });
});

describe('reporting faults the server never saw (spec 0010, AC-163)', () => {
  const proxyPage = (status: number) =>
    new Response('<html>Bad gateway</html>', { status, headers: { 'x-request-id': 'req-from-the-edge' } });

  it("reports a proxy's page, with the answer's request id and the procedure, once", async () => {
    const { data, faults } = layer({ fetch: () => Promise.resolve(proxyPage(502)) });
    expect(await failure(data.system.status())).toMatchObject({ code: 'API_UNAVAILABLE' });
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ requestId: 'req-from-the-edge', procedure: 'system.status' });
  });

  it('treats a TypeError that is not fetch failing as a bug, never as being offline', async () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'map')");
    const { data, faults } = layer({ fetch: () => Promise.reject(bug) });
    expect(await failure(data.system.status())).toMatchObject({ code: 'INTERNAL' });
    expect(faults).toEqual([{ error: bug }]);
  });

  it('reports an error thrown inside the layer, which no answer carried', async () => {
    const bug = new RangeError('a bug on the way out');
    const { data, faults } = layer({ fetch: () => Promise.reject(bug) });
    expect(await failure(data.system.status())).toMatchObject({ code: 'INTERNAL' });
    expect(faults).toEqual([{ error: bug }]);
  });

  it('never reports being offline, a refusal, or a fault the server reported itself', async () => {
    const offline = layer({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
    await failure(offline.data.system.status());
    const refused = layer(
      fakeApi({
        objects: () => {
          throw new ORPCError('NOT_FOUND', { status: 404, message: 'There is no workspace at this address.' });
        },
      }),
    );
    await failure(refused.data.objects.list('acme'));
    const internal = layer(
      fakeApi({
        objects: () => {
          throw new ORPCError('INTERNAL', { status: 500, message: 'Something went wrong. Try again.' });
        },
      }),
    );
    await failure(internal.data.objects.list('acme'));
    expect([...offline.faults, ...refused.faults, ...internal.faults]).toEqual([]);
  });

  it('still rejects with the DataError when monitoring itself throws', async () => {
    const data = createDataLayer({
      origin: ORIGIN,
      notify: () => undefined,
      mintId: () => 'id',
      onSignedOut: () => undefined,
      currentPath: () => '/',
      fetch: () => Promise.resolve(proxyPage(502)),
      report: () => {
        throw new Error('monitoring is broken');
      },
    });
    expect(await failure(data.system.status())).toMatchObject({ code: 'API_UNAVAILABLE' });
  });

  it('reports a sign in step answered by a proxy, and not a refused code', async () => {
    const proxied = layer({ fetch: () => Promise.resolve(proxyPage(502)) });
    await failure(proxied.data.auth.sendCode('ada@example.com'));
    expect(proxied.faults).toHaveLength(1);
    expect(proxied.faults[0]).toMatchObject({ requestId: 'req-from-the-edge', procedure: 'auth.sendCode' });

    const refused = layer(
      fakeApi({}, () => json({ code: 'INVALID_OTP', message: 'That code isn’t right.', status: 400 }, 400)),
    );
    await failure(refused.data.auth.verify('ada@example.com', '000000'));
    expect(refused.faults).toEqual([]);
  });

  it('counts a cancelled call as nothing that failed', () => {
    expect(isUnseenFault(new DOMException('The operation was aborted.', 'AbortError'))).toBe(false);
    expect(isUnseenFault(new Error('a bug inside the layer'))).toBe(true);
    expect(isUnseenFault(dataError('INTERNAL', 'Something went wrong.'))).toBe(false);
  });
});

describe('auth', () => {
  it('sends a sign in code to the address, by Better Auth’s email code route', async () => {
    const bodies: unknown[] = [];
    const api = fakeApi({}, (path, body) => {
      bodies.push({ path, body });
      return json({ success: true });
    });
    const { data } = layer(api);
    await data.auth.sendCode('ada@example.com');
    expect(bodies).toEqual([
      { path: '/email-otp/send-verification-otp', body: { email: 'ada@example.com', type: 'sign-in' } },
    ]);
  });

  it('sends Google back to the deep link, and a refused Google sign in to /sign-in that still holds it', async () => {
    const sent: { readonly path: string; readonly callbackURL: unknown; readonly errorCallbackURL: unknown }[] = [];
    const api = fakeApi({}, (path, body) => {
      const { callbackURL, errorCallbackURL } = (body ?? {}) as Record<string, unknown>;
      sent.push({ path, callbackURL, errorCallbackURL });
      return json({ url: 'https://accounts.google.com/o/oauth2/auth', redirect: false });
    });
    const { data } = layer(api);
    await data.auth.signInWithGoogle('/w/acme/objects/people');
    await data.auth.signInWithGoogle('/');
    expect(sent).toEqual([
      {
        path: '/sign-in/social',
        callbackURL: `${ORIGIN}/w/acme/objects/people`,
        errorCallbackURL: `${ORIGIN}/sign-in?redirect=%2Fw%2Facme%2Fobjects%2Fpeople`,
      },
      { path: '/sign-in/social', callbackURL: `${ORIGIN}/`, errorCallbackURL: `${ORIGIN}/sign-in` },
    ]);
  });

  it('rejects a closed sign up and a wrong code with their codes and messages', async () => {
    const api = fakeApi({}, (path) =>
      path === '/sign-in/email-otp'
        ? json({ code: 'INVALID_OTP', message: 'That code isn’t right. Try again, or send a new one.' }, 400)
        : json({ code: 'SIGNUP_CLOSED', message: "Sign up isn't open yet." }, 403),
    );
    const { data, signedOut } = layer(api);
    expect(await failure(data.auth.sendCode('new@example.com'))).toMatchObject({
      code: 'SIGNUP_CLOSED',
      message: "Sign up isn't open yet.",
    });
    expect(await failure(data.auth.verify('ada@example.com', '123456'))).toMatchObject({
      code: 'INVALID_OTP',
      message: 'That code isn’t right. Try again, or send a new one.',
    });
    expect(signedOut).toEqual([]);
  });

  it('forgets who was signed in after signing in and after signing out', async () => {
    const api = fakeApi({}, (path) =>
      path === '/sign-in/email-otp' ? json({ token: 't', user: ME.user }) : json({ success: true }),
    );
    const { data } = layer(api);
    await data.me.get();
    await data.auth.verify('ada@example.com', '123456');
    await data.me.get();
    await data.auth.signOut();
    await data.me.get();
    expect(count(api.calls, '/api/rpc/me/get')).toBe(3);
    expect(api.calls).toContain('/api/auth/sign-out');
  });

  it('says the session changed after signing in and after signing out, never on a refused code', async () => {
    let refuse = true;
    const api = fakeApi({}, (path) => {
      if (path !== '/sign-in/email-otp') return json({ success: true });
      return refuse
        ? json({ code: 'INVALID_OTP', message: "That code isn't right." }, 400)
        : json({ token: 't', user: ME.user });
    });
    const { data, events } = layer(api);
    await failure(data.auth.verify('ada@example.com', '000000'));
    expect(events).toEqual([]);
    refuse = false;
    await data.auth.verify('ada@example.com', '123456');
    await data.auth.signOut();
    expect(events).toEqual(['session changed', 'session changed']);
  });

  it('answers the session, or undefined when there is none', async () => {
    const signedIn = layer(
      fakeApi({}, () =>
        json({
          session: { id: 's', userId: ME.user.id, token: 't', expiresAt: '2026-11-02T00:00:00.000Z' },
          user: { ...ME.user, emailVerified: true },
        }),
      ),
    );
    expect(await signedIn.data.auth.session()).toEqual(ME.user);
    expect(await layer(fakeApi()).data.auth.session()).toBeUndefined();
  });

  it('turns a rate limit without a body into RATE_LIMITED', async () => {
    const { data } = layer(fakeApi({}, () => new Response('', { status: 429 })));
    const error = await failure(data.auth.sendCode('ada@example.com'));
    expect(error).toMatchObject({ code: 'RATE_LIMITED' });
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it('carries the wait from Retry-After on a rate limited code send', async () => {
    const { data } = layer(
      fakeApi(
        {},
        () =>
          new Response(JSON.stringify({ code: 'RATE_LIMITED', message: 'Too many codes were sent to this email.' }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '600' },
          }),
      ),
    );
    expect(await failure(data.auth.sendCode('ada@example.com'))).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many codes were sent to this email.',
      retryAfterSeconds: 600,
    });
  });
});

describe('refusal wording', () => {
  const taken = dataError('UNIQUE_CONFLICT', 'Not saved.', {
    refusals: [
      { code: 'UNIQUE_CONFLICT', message: 'Another record already has this value for Email.', attributeId: 'a1' },
    ],
  });

  it('gives a field, a cell and a toast the same sentence', () => {
    expect(refusalFor(taken, 'a1')).toBe('Another record already has this value for Email.');
    expect(refusalSummary(taken)).toBe('Another record already has this value for Email.');
  });

  it('gives other attributes nothing, and a refusal about nothing in particular to every one', () => {
    expect(refusalFor(taken, 'a2')).toBeUndefined();
    const whole = dataError('LIMIT_REACHED', 'This object is full.');
    expect(refusalFor(whole, 'a2')).toBe('This object is full.');
    expect(refusalSummary(whole)).toBe('This object is full.');
  });

  it('shows the safety net’s words on their field only: a toast says the answer’s sentence', () => {
    const missing = dataError('INPUT_INVALID', 'Some of what you entered isn’t valid.', {
      issues: [{ path: ['values', 'a1'], message: 'Add this.' }],
    });
    expect(refusalFor(missing, 'a1')).toBe('Add this.');
    expect(refusalSummary(missing)).toBe('Some of what you entered isn’t valid.');
    const tooLong = dataError('INPUT_INVALID', 'Some of what you entered isn’t valid.', {
      issues: [{ path: ['values', 'a1'], message: 'Use 2,000 characters or fewer.' }],
    });
    expect(refusalSummary(tooLong)).toBe('Some of what you entered isn’t valid.');
    // A schema's own words name their field, so they still lead.
    const named = dataError('INPUT_INVALID', 'Some of what you entered isn’t valid.', {
      issues: [{ path: ['title'], message: 'Give the task a title.' }],
    });
    expect(refusalSummary(named)).toBe('Give the task a title.');
  });
});

describe('parseRetryAfter', () => {
  it('reads delay seconds and HTTP dates, and nothing else', () => {
    const now = Date.parse('2026-10-03T09:00:00.000Z');
    expect(parseRetryAfter('120', now)).toBe(120);
    expect(parseRetryAfter(' 0 ', now)).toBe(0);
    expect(parseRetryAfter('Sat, 03 Oct 2026 09:10:00 GMT', now)).toBe(600);
    expect(parseRetryAfter('Sat, 03 Oct 2026 08:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter('-5', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});

describe('the layer has no state at module level', () => {
  it('keeps two layers apart', async () => {
    const one = fakeApi();
    const two = fakeApi();
    await layer(one).data.me.get();
    await layer(two).data.me.get();
    expect(count(one.calls, '/api/rpc/me/get')).toBe(1);
    expect(count(two.calls, '/api/rpc/me/get')).toBe(1);
  });
});

describe('audit (spec 0046)', () => {
  const entry = (n: number) => ({
    id: `0199f0a0-0000-7000-8000-${String(n).padStart(12, '0')}`,
    at: '2026-10-23T06:52:11.123456Z',
    actor: { kind: 'system' as const },
    action: 'workspace.restored' as const,
    target: { type: 'workspace' as const },
    params: {},
    changes: [],
  });

  it('opens a workspace’s log through audit.list, then reads on with the cursor', async () => {
    const api = fakeApi({
      auditList: (input) =>
        input.cursor === undefined ? { entries: [entry(1)], nextCursor: 'next-1' } : { entries: [entry(2)] },
    });
    const { data } = layer(api);
    const log = await data.audit.openLog('acme');
    await expect.poll(() => log.getSnapshot().status).toBe('ready');
    expect(log.getSnapshot()).toMatchObject({ entries: [entry(1)], hasMore: true });
    log.more();
    await expect.poll(() => log.getSnapshot().entries).toEqual([entry(1), entry(2)]);
    expect(log.getSnapshot().hasMore).toBe(false);
    expect(api.calls.filter((each) => each.startsWith('audit.list'))).toEqual([
      'audit.list first',
      'audit.list next-1',
    ]);
  });

  it('hands back the log a screen holds, so a reload of the page keeps its rows, and opens afresh once let go', async () => {
    const api = fakeApi({
      auditList: (input) =>
        input.cursor === undefined ? { entries: [entry(1)], nextCursor: 'next-1' } : { entries: [entry(2)] },
    });
    const { data } = layer(api);
    const reads = () => api.calls.filter((each) => each.startsWith('audit.list')).length;
    const log = await data.audit.openLog('acme');
    const release = log.retain();
    await expect.poll(() => log.getSnapshot().status).toBe('ready');
    log.more();
    await expect.poll(() => log.getSnapshot().entries).toHaveLength(2);
    // The router reloads the route (a live attribute change): the same log, the same rows, nothing read again.
    expect(await data.audit.openLog('acme')).toBe(log);
    expect(reads()).toBe(2);
    // Another workspace's log is its own.
    const other = await data.audit.openLog('globex');
    expect(other).not.toBe(log);
    other.dispose();
    release();
    log.dispose();
    const fresh = await data.audit.openLog('acme');
    expect(fresh).not.toBe(log);
    await expect.poll(() => fresh.getSnapshot().status).toBe('ready');
    expect(fresh.getSnapshot().entries).toEqual([entry(1)]);
    fresh.dispose();
  });

  it('answers a refused read as forbidden, with the server’s words', async () => {
    const api = fakeApi({
      auditList: () => {
        throw new ORPCError('FORBIDDEN', {
          status: 403,
          message: 'Only workspace owners and admins can see workspace changes.',
        });
      },
    });
    const { data } = layer(api);
    await data.access.mine('acme');
    const log = await data.audit.openLog('acme');
    await expect.poll(() => log.getSnapshot().status).toBe('forbidden');
    expect(log.getSnapshot().message).toBe('Only workspace owners and admins can see workspace changes.');
    log.dispose();
    // Their held access was stale: it is read again, so History's next visit opens the sign ins (AC-4618).
    const asked = () => api.calls.filter((each) => each.endsWith('/access/mine')).length;
    expect(asked()).toBe(1);
    await data.access.mine('acme');
    expect(asked()).toBe(2);
  });
});

describe('workspace security', () => {
  it('drops held access when the read is refused, so the next visit asks again', async () => {
    const api = fakeApi({
      workspaceSecurityGet: () => {
        throw new ORPCError('FORBIDDEN', { status: 403, message: 'Only workspace owners and admins can do this.' });
      },
    });
    const { data } = layer(api);
    await data.access.mine('acme');
    await expect(data.workspaceSecurity.get('acme')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const asked = () => api.calls.filter((each) => each.endsWith('/access/mine')).length;
    expect(asked()).toBe(1);
    await data.access.mine('acme');
    expect(asked()).toBe(2);
  });
});

describe('jobs', () => {
  const job = (status: JobView['status'], done = 0): JobView => ({
    id: '0199a6f2-0000-7000-8000-0000000000aa',
    kind: 'dev.simulate',
    label: 'Test job',
    status,
    total: 10,
    done,
    refused: 0,
    skipped: 0,
    startedBy: { type: 'member', memberId: ADA_MEMBER.id },
    createdAt: '2026-10-12T09:00:00.000Z',
    cancellable: status === 'queued' || status === 'running',
  });

  it('starts a test job with one id per try, and shows it in the workspace’s list', async () => {
    const api = fakeApi({ jobStartTest: () => job('queued'), jobsList: () => ({ jobs: [] }) });
    const { data } = layer(api);
    const view = data.jobs.view('acme', 'mine');
    await view.ready();
    expect(view.getSnapshot()).toMatchObject({ status: 'ready', jobs: [] });
    const id = data.jobs.newId();
    await data.jobs.startTest('acme', id, { items: 10 });
    await expect.poll(() => view.getSnapshot().jobs.map((each) => each.id)).toEqual([job('queued').id]);
    expect(api.mutationIds).toHaveLength(1);
  });

  it('cancels at once on screen, and puts the job back with a toast when refused', async () => {
    const running = job('running', 4);
    const refused = fakeApi({
      jobsList: () => ({ jobs: [running] }),
      jobCancel: () => {
        throw new ORPCError('JOB_FINISHED', { status: 409, message: 'That job has already finished.' });
      },
      jobGet: () => job('succeeded', 10),
    });
    const { data, notices } = layer(refused);
    const view = data.jobs.view('acme', 'all');
    await view.ready();
    const cancelling = data.jobs.cancel('acme', running.id);
    // Shown at once, before the answer.
    expect(view.getSnapshot().jobs[0]?.status).toBe('cancelling');
    expect(await cancelling).toBe(false);
    expect(notices.at(-1)).toEqual({ tone: 'danger', message: 'That job has already finished.' });
    // Read again: it had finished meanwhile.
    await expect.poll(() => view.getSnapshot().jobs[0]?.status).toBe('succeeded');

    const accepted = fakeApi({ jobsList: () => ({ jobs: [running] }), jobCancel: () => job('cancelling', 4) });
    const second = layer(accepted).data;
    const other = second.jobs.view('acme', 'all');
    await other.ready();
    expect(await second.jobs.cancel('acme', running.id)).toBe(true);
    expect(other.getSnapshot().jobs[0]?.status).toBe('cancelling');
  });

  it('says why the first page failed, and reads it again on reload', async () => {
    let fail = true;
    const api = fakeApi({
      jobsList: () => {
        if (fail) throw new ORPCError('FORBIDDEN', { status: 403, message: 'Only owners and admins.' });
        return { jobs: [job('queued')] };
      },
    });
    const view = layer(api).data.jobs.view('acme', 'all');
    await view.ready();
    expect(view.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'FORBIDDEN' } });
    fail = false;
    await view.reload();
    expect(view.getSnapshot()).toMatchObject({ status: 'ready', jobs: [{ status: 'queued' }] });
  });
});

describe('objects in settings (spec 0012)', () => {
  const PROJECTS: ObjectSummary = {
    id: '0199a6f2-0000-7000-8000-0000000000c1',
    apiSlug: 'projects',
    singularName: 'Project',
    pluralName: 'Projects',
    icon: 'folder',
    hue: 'blue',
    access: 'write',
    position: 1,
    isStandard: false,
    isArchived: true,
  };

  it('lists the live objects for the sidebar and every object for settings, from one read', async () => {
    const api = fakeApi({ objects: () => [PEOPLE, PROJECTS] });
    const { data } = layer(api);
    expect((await data.objects.list('acme')).map((object) => object.apiSlug)).toEqual(['people']);
    expect((await data.objects.all('acme')).map((object) => object.apiSlug)).toEqual(['people', 'projects']);
    expect(count(api.calls, '/api/rpc/objects/list')).toBe(1);
  });

  it('waits for an object write, then reads the objects and usage again and reloads the pages once', async () => {
    let reads = 0;
    let changes = 0;
    const api = fakeApi({
      objects: () => (reads++ === 0 ? [PEOPLE] : [PEOPLE, { ...PROJECTS, isArchived: false }]),
      objectWrite: () => ({ ...PROJECTS, isArchived: false }),
    });
    const { data } = layer(api, '/w/acme/settings/objects', {
      onDefinitionsChange: () => {
        changes += 1;
      },
    });
    await data.objects.list('acme');
    await data.usage.get('acme');
    const made = await data.objects.create('acme', {
      id: data.objects.newId(),
      singularName: 'Project',
      pluralName: 'Projects',
      icon: 'folder',
      hue: 'blue',
    });
    expect(made.apiSlug).toBe('projects');
    expect(changes).toBe(1);
    expect(api.mutationIds).toHaveLength(1);
    expect((await data.objects.list('acme')).map((object) => object.apiSlug)).toEqual(['people', 'projects']);
    await data.usage.get('acme');
    expect(count(api.calls, '/api/rpc/usage/get')).toBe(2);
  });

  it('rejects a refused object write with its refusals, and reloads nothing', async () => {
    let changes = 0;
    const api = fakeApi({
      objectWrite: () => {
        throw new ORPCError('NAME_TAKEN', {
          status: 409,
          message: 'An object called Projects already exists.',
          data: {
            refusals: [
              { code: 'NAME_TAKEN', message: 'An object called Projects already exists.', field: 'pluralName' },
            ],
          },
        });
      },
    });
    const { data } = layer(api, '/w/acme/settings/objects', {
      onDefinitionsChange: () => {
        changes += 1;
      },
    });
    const error = await failure(data.objects.update('acme', PEOPLE.id, { pluralName: 'Projects' }));
    expect(error.code).toBe('NAME_TAKEN');
    expect(error.data?.refusals?.[0]?.field).toBe('pluralName');
    expect(changes).toBe(0);
  });

  it('counts an object’s records for the archive confirm', async () => {
    const { data } = layer(fakeApi({ count: () => 1240 }));
    expect(await data.records.count('acme', PEOPLE.id)).toEqual({ count: 1240, atLeast: false });
  });
});

describe('the record page (spec 0017)', () => {
  const RECORD = personRow(0).id;
  const createdBy = (actor: RecordView['createdBy']) => ({
    entries: [
      {
        id: `created:${RECORD}`,
        key: `2026-10-08T09:00:00.000123Z|9|created:${RECORD}`,
        at: '2026-10-08T09:00:00.000Z',
        actor,
        kind: 'created' as const,
      },
    ],
  });

  it('reads the first page once for the Activity tab and Recent activity, naming who made the record', async () => {
    const asked: string[] = [];
    const api = fakeApi({
      activity: (recordId) => {
        asked.push(recordId);
        return createdBy({ type: 'member', id: ADA_MEMBER.id });
      },
    });
    const { data } = layer(api);
    const feed = await data.activity.forRecord('acme', RECORD);
    const recent = await data.activity.recent('acme', RECORD);
    await Promise.all([feed.ready(), recent.ready()]);
    expect(asked).toEqual([RECORD]);
    const state = feed.getSnapshot();
    expect(state.status).toBe('ready');
    expect(state.hasMore).toBe(false);
    expect(state.entries).toEqual([
      {
        id: `created:${RECORD}`,
        at: '2026-10-08T09:00:00.000Z',
        kind: 'created',
        actor: { type: 'member', id: ADA_MEMBER.id, name: 'Ada', email: 'ada@example.com' },
      },
    ]);
    expect(state.source.count).toBe(1);
    expect(recent.getSnapshot().entries).toEqual(state.entries);
  });

  it('names a member no longer listed "Former member", after reading the members once more, and the system "System"', async () => {
    let memberReads = 0;
    const api = fakeApi({
      members: () => {
        memberReads += 1;
        return [ADA_MEMBER];
      },
      activity: (recordId) =>
        recordId === RECORD
          ? createdBy({ type: 'member', id: '0199a6f2-0000-7000-8000-0000000000ff' })
          : createdBy({ type: 'system', id: null }),
    });
    const { data } = layer(api);
    const gone = await data.activity.forRecord('acme', RECORD);
    await gone.ready();
    expect(gone.getSnapshot().entries[0]?.actor.name).toBe('Former member');
    expect(memberReads).toBe(2);
    const seeded = await data.activity.forRecord('acme', personRow(1).id);
    await seeded.ready();
    expect(seeded.getSnapshot().entries[0]?.actor).toEqual({ type: 'system', id: null, name: 'System' });
  });

  it('says a missing or hidden record is unavailable, and a failure is an error with Retry', async () => {
    let fails = true;
    const api = fakeApi({
      activity: (recordId) => {
        if (recordId === RECORD)
          throw new ORPCError('NOT_FOUND', { status: 404, message: 'That record does not exist.' });
        if (fails) throw new ORPCError('INTERNAL', { status: 500, message: 'Something went wrong.' });
        return createdBy({ type: 'system', id: null });
      },
    });
    const { data } = layer(api);
    const missing = await data.activity.forRecord('acme', RECORD);
    await missing.ready();
    expect(missing.getSnapshot().status).toBe('unavailable');
    const flaky = await data.activity.forRecord('acme', personRow(1).id);
    await flaky.ready();
    expect(flaky.getSnapshot().status).toBe('error');
    fails = false;
    flaky.retry();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(flaky.getSnapshot().status).toBe('ready');
  });

  it('subscribes to one record through the records layer, and looks a missing one up in the trash', async () => {
    const api = fakeApi({
      get: (ids) => ids.filter((id) => id === personRow(1).id).map(() => personRow(1)),
      trashed: (recordId) => {
        if (recordId !== RECORD)
          throw new ORPCError('NOT_FOUND', { status: 404, message: 'That record does not exist.' });
        return {
          record: personRow(0),
          deletedAt: '2026-10-09T09:00:00.000Z',
          deletedBy: { type: 'member', id: ADA_MEMBER.id },
        };
      },
    });
    const { data } = layer(api);
    const live = await data.records.one('acme', personRow(1).id, [TITLE.id]);
    await live.ready();
    expect(live.getSnapshot().record?.values[TITLE.id]).toBe('Engineer');
    const gone = await data.records.one('acme', RECORD, [TITLE.id]);
    await gone.ready();
    expect(gone.getSnapshot()).toMatchObject({ status: 'deleted', isLost: false });
    const trashed = data.records.trashed('acme', RECORD);
    // Asked on its first subscriber, and the same source for every screen.
    expect(trashed.getSnapshot()).toEqual({ status: 'checking' });
    trashed.subscribe(() => undefined);
    await trashed.ready();
    expect(trashed.getSnapshot()).toMatchObject({
      status: 'trashed',
      record: { id: RECORD },
      deletedBy: { type: 'member', id: ADA_MEMBER.id },
    });
    expect(data.records.trashed('acme', RECORD)).toBe(trashed);
    const missing = data.records.trashed('acme', personRow(2).id);
    await missing.ready();
    expect(missing.getSnapshot()).toEqual({ status: 'unavailable' });
  });
});

describe('options (spec 0012, milestone 3)', () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 40));
  const SILVER: AttributeOption = {
    id: '0199a6f2-0000-7000-8000-000000000020',
    label: 'Silver',
    hue: 'gray',
    position: 0,
    isArchived: false,
  };
  const TIER: AttributeDefinition = {
    ...TITLE,
    id: '0199a6f2-0000-7000-8000-000000000021',
    apiSlug: 'tier',
    title: 'Tier',
    type: 'select',
    options: [SILVER],
  };

  it('writes an option and waits for the server, sending a target as P<N>D and reading the object again', async () => {
    const api = fakeApi({ attributes: () => [TITLE, TIER], optionWrite: () => SILVER });
    const reloads: string[] = [];
    const { data } = layer(api, undefined, { onDefinitionsChange: () => reloads.push('reload') });
    await data.attributes.list('acme', PEOPLE.id);
    await data.options.update('acme', PEOPLE.id, SILVER.id, { label: 'Steel', targetDays: 7 });
    await data.options.update('acme', PEOPLE.id, SILVER.id, { targetDays: null });
    await data.options.create('acme', PEOPLE.id, TIER.id, { id: data.attributes.newId(), label: 'Gold' });
    await data.options.reorder('acme', PEOPLE.id, SILVER.id, 1);
    await data.options.archive('acme', PEOPLE.id, SILVER.id);
    await data.options.restore('acme', PEOPLE.id, SILVER.id);
    expect(api.sent[0]).toMatchObject({ optionId: SILVER.id, label: 'Steel', targetTimeInStage: 'P7D' });
    expect(api.sent[1]).toMatchObject({ targetTimeInStage: null });
    expect(api.sent[2]).not.toHaveProperty('hue');
    expect(api.mutationIds).toHaveLength(6);
    expect(reloads).toHaveLength(6);
    // The object's list is read again after the writes.
    await data.attributes.list('acme', PEOPLE.id);
    expect(count(api.calls, '/api/rpc/attributes/list')).toBe(2);
  });

  it('makes an option from a cell as one optimistic write: the label at once, newOption sent, then read again', async () => {
    const created: { id?: string } = {};
    // The server answers once the test has seen the cell's optimistic state.
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const api = fakeApi({
      attributes: () => [
        TITLE,
        created.id === undefined
          ? TIER
          : {
              ...TIER,
              options: [SILVER, { id: created.id, label: 'Gold', hue: 'red', position: 1, isArchived: false }],
            },
      ],
      setValues: async () => {
        await answered;
        return { ...personRow(0), values: { ...personRow(0).values, [TIER.id]: created.id ?? null } };
      },
    });
    const reloads: string[] = [];
    const { data } = layer(api, undefined, { onDefinitionsChange: () => reloads.push('reload') });
    const view = await data.records.view('acme', PEOPLE.id, {}, [TIER.id]);
    const row = view.getSnapshot().source.getItem(0);
    const making = data.records.createOption('acme', {
      objectId: PEOPLE.id,
      recordId: row?.id ?? '',
      attributeId: TIER.id,
      label: ' Gold ',
    });
    await settled();
    // Shown at once: the minted id in the cell, its label and next hue pending.
    const [pending] = data.options.pending.getSnapshot().get(`acme/${TIER.id}`) ?? [];
    expect(pending).toMatchObject({ label: 'Gold', hue: 'red' });
    created.id = pending?.id;
    expect(view.getSnapshot().source.getItem(0)?.values[TIER.id]).toBe(pending?.id);
    answer();
    const outcome = await making;
    expect(outcome).toMatchObject({ kind: 'done', landed: 1 });
    expect(api.sent.at(-1)).toEqual({
      [TIER.id]: { value: { newOption: { id: pending?.id, label: 'Gold' } } },
    });
    await settled();
    // Its own definitions echo is skipped, so the object's attributes are read again here, and the pages reload.
    expect(count(api.calls, '/api/rpc/attributes/list')).toBe(2);
    expect(reloads).toEqual(['reload']);
  });

  it('rolls a refused cell option back, with the reason on the cell, and leaves no pending option', async () => {
    const api = fakeApi({
      attributes: () => [TITLE, TIER],
      setValues: () => {
        throw new ORPCError('FORBIDDEN', {
          status: 403,
          message: 'Only workspace owners and admins can change objects and attributes.',
        });
      },
    });
    const { data } = layer(api);
    const view = await data.records.view('acme', PEOPLE.id, {}, [TIER.id]);
    const row = view.getSnapshot().source.getItem(0);
    const outcome = await data.records.createOption('acme', {
      objectId: PEOPLE.id,
      recordId: row?.id ?? '',
      attributeId: TIER.id,
      label: 'Gold',
    });
    await settled();
    expect(outcome).toMatchObject({ kind: 'done', landed: 0 });
    expect(view.getSnapshot().source.getItem(0)?.values[TIER.id]).toBeUndefined();
    expect(data.options.pending.getSnapshot().size).toBe(0);
    expect(view.getSnapshot().cellErrors.get(`${row?.id ?? ''}:${TIER.id}`)).toBe(
      'Only workspace owners and admins can change objects and attributes.',
    );
  });

  it('reads a number shown as a percent from its settings', () => {
    expect(toFieldAttribute({ ...TITLE, type: 'number', config: { display: 'percent' } }).isPercent).toBe(true);
    expect(toFieldAttribute({ ...TITLE, type: 'number', config: { display: 'plain' } })).not.toHaveProperty(
      'isPercent',
    );
  });

  it('keeps the label through a Retry after a passing failure, and reads the attributes once it lands', async () => {
    let tries = 0;
    const api = fakeApi({
      attributes: () => [TITLE, TIER],
      setValues: () => {
        tries += 1;
        if (tries === 1) throw new ORPCError('INTERNAL', { status: 500, message: 'Something went wrong.' });
        return personRow(0);
      },
    });
    const { data, notices } = layer(api);
    const view = await data.records.view('acme', PEOPLE.id, {}, [TIER.id]);
    const row = view.getSnapshot().source.getItem(0);
    const first = await data.records.createOption('acme', {
      objectId: PEOPLE.id,
      recordId: row?.id ?? '',
      attributeId: TIER.id,
      label: 'Gold',
    });
    expect(first).toMatchObject({ landed: 0 });
    await settled();
    // Rolled back, its label gone with it; the toast offers Retry.
    expect(data.options.pending.getSnapshot().size).toBe(0);
    const retry = notices.at(-1)?.action;
    expect(retry?.label).toBe('Retry');
    const before = count(api.calls, '/api/rpc/attributes/list');
    retry?.onAction();
    await settled();
    // The same new option went again, and once it landed the object's attributes were read again.
    expect(api.sent.at(-1)).toMatchObject({ [TIER.id]: { value: { newOption: { label: 'Gold' } } } });
    expect(count(api.calls, '/api/rpc/attributes/list')).toBe(before + 1);
    expect(
      data.options.pending
        .getSnapshot()
        .get(`acme/${TIER.id}`)
        ?.map((each) => each.label),
    ).toEqual(['Gold']);
  });

  it('follows the option the server set when it reused a live one with that label: no phantom option', async () => {
    const api = fakeApi({
      attributes: () => [TITLE, TIER],
      // Someone made "Silver" meanwhile, ignoring case: the server set it rather than making another.
      setValues: () => ({ ...personRow(0), values: { ...personRow(0).values, [TIER.id]: SILVER.id } }),
    });
    const { data } = layer(api);
    const view = await data.records.view('acme', PEOPLE.id, {}, [TIER.id]);
    const row = view.getSnapshot().source.getItem(0);
    await data.records.createOption('acme', {
      objectId: PEOPLE.id,
      recordId: row?.id ?? '',
      attributeId: TIER.id,
      label: 'silver',
    });
    await settled();
    expect(view.getSnapshot().source.getItem(0)?.values[TIER.id]).toBe(SILVER.id);
    // The label sits under the id the server set, which the attribute already lists: nothing extra in the column.
    const field = toFieldAttribute(TIER);
    expect(withPendingOptions(field, 'acme', data.options.pending.getSnapshot()).options).toHaveLength(1);
  });

  it('waits for a new option before another row sets it, and sends the id the server set', async () => {
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const made: { id?: string } = {};
    const api = fakeApi({
      attributes: () => [TITLE, TIER],
      setValues: async () => {
        if (made.id === undefined) {
          await answered;
          return { ...personRow(0), values: { ...personRow(0).values, [TIER.id]: SILVER.id } };
        }
        return personRow(1);
      },
    });
    const { data } = layer(api);
    const view = await data.records.view('acme', PEOPLE.id, {}, [TIER.id]);
    const [first, second] = [view.getSnapshot().source.getItem(0), view.getSnapshot().source.getItem(1)];
    const making = data.records.createOption('acme', {
      objectId: PEOPLE.id,
      recordId: first?.id ?? '',
      attributeId: TIER.id,
      label: 'silver',
    });
    await settled();
    const [pending] = data.options.pending.getSnapshot().get(`acme/${TIER.id}`) ?? [];
    // Chosen on the second row while it is being made: held back until the first answers.
    const setting = data.records.setValues('acme', [
      { rowId: second?.id ?? '', columnId: TIER.id, value: pending?.id },
    ]);
    await settled();
    expect(api.sent).toHaveLength(1);
    made.id = 'answered';
    answer();
    await making;
    await setting;
    // It went with the id the server set (the reused Silver), not the minted one.
    expect(api.sent.at(-1)).toMatchObject({ [TIER.id]: { value: SILVER.id } });
  });

  it('adds a cell made option to its column until the attribute lists it', () => {
    const field = toFieldAttribute(TIER);
    const pending = new Map([
      [`acme/${TIER.id}`, [{ attributeId: TIER.id, id: 'new', label: 'Gold', hue: 'red' as const }]],
    ]);
    expect(withPendingOptions(field, 'acme', pending).options?.map((option) => option.label)).toEqual([
      'Silver',
      'Gold',
    ]);
    expect(withPendingOptions(field, 'other', pending)).toBe(field);
    const listed = {
      ...field,
      options: [...(field.options ?? []), { id: 'new', label: 'Gold', hue: 'red' as const, archived: false }],
    };
    expect(withPendingOptions(listed, 'acme', pending)).toBe(listed);
  });
});

describe('views (spec 0020)', () => {
  const VIEW_ID = '0199a6f2-0000-7000-8000-0000000000c1';
  const savedView = (queryVersion: number, sorts: View['config']['sorts'] = []): View => ({
    id: VIEW_ID,
    objectId: PEOPLE.id,
    name: 'All people',
    kind: 'table',
    visibility: 'workspace',
    position: 0,
    isDefault: true,
    isLocked: false,
    version: queryVersion,
    config: { columns: [], showNewAttributes: true, pinnedCount: 1, sorts },
    queryVersion,
  });

  it('lists an object’s views and reads one, then saves a query with one mutation id and reads the list again', async () => {
    let lists = 0;
    const api = fakeApi({
      viewsList: () => {
        lists += 1;
        return { views: [savedView(lists)], defaultViewId: VIEW_ID };
      },
      viewGet: () => savedView(1),
      viewSave: (input) => savedView(input.baseQueryVersion + 1, [{ attributeId: TITLE.id, direction: 'ascending' }]),
    });
    const { data } = layer(api);
    const list = data.views.list('acme', PEOPLE.id);
    list.retain();
    await list.ready();
    expect(list.getSnapshot()).toMatchObject({ status: 'ready', defaultViewId: VIEW_ID, views: [{ id: VIEW_ID }] });
    const body = data.views.get('acme', VIEW_ID);
    await body.ready();
    expect(body.getSnapshot()).toMatchObject({ status: 'ready', view: { queryVersion: 1 } });
    const saved = await data.views.saveQuery('acme', VIEW_ID, {
      sorts: [{ attributeId: TITLE.id, direction: 'ascending' }],
      baseQueryVersion: 1,
    });
    expect(saved.queryVersion).toBe(2);
    expect(body.getSnapshot().view?.queryVersion).toBe(2);
    expect(api.mutationIds).toHaveLength(1);
    await expect.poll(() => lists).toBe(2);
  });

  it('hands a refused save back as a DataError, and reads an unknown view as not found', async () => {
    const api = fakeApi({
      viewGet: () => {
        throw new ORPCError('NOT_FOUND', { status: 404, message: "This view doesn't exist or isn't shared with you." });
      },
      viewSave: () => {
        throw new ORPCError('VIEW_CHANGED', {
          status: 409,
          message: 'Bea changed this view’s filters since you started.',
        });
      },
    });
    const { data } = layer(api);
    await expect(data.views.saveQuery('acme', VIEW_ID, { sorts: [], baseQueryVersion: 1 })).rejects.toMatchObject({
      code: 'VIEW_CHANGED',
      message: 'Bea changed this view’s filters since you started.',
    });
    const body = data.views.get('acme', VIEW_ID);
    await body.ready();
    expect(body.getSnapshot().status).toBe('not-found');
  });

  it('writes a draft for the URL and reads it back, refusing a link that isn’t one', async () => {
    const { data } = layer(fakeApi());
    const query = {
      filter: { conjunction: 'and' as const, conditions: [{ attributeId: TITLE.id, operator: 'is_empty' as const }] },
      sorts: [{ attributeId: TITLE.id, direction: 'descending' as const }],
    };
    const text = data.views.draftParam(query) ?? '';
    expect(await data.views.readDraft(text)).toEqual(query);
    expect(await data.views.readDraft('bm90IGEgcXVlcnk')).toBeUndefined();
    expect(await data.views.readDraft('%%%')).toBeUndefined();
    expect(data.views.isSameQuery({ sorts: [] }, { filter: { conjunction: 'or', conditions: [] }, sorts: [] })).toBe(
      true,
    );
    const long = {
      filter: {
        conjunction: 'and' as const,
        conditions: Array.from({ length: 60 }, (_, at) => ({
          attributeId: TITLE.id,
          operator: 'contains' as const,
          value: `a longer phrase to search for, number ${String(at)}`,
        })),
      },
      sorts: [],
    };
    expect(data.views.draftParam(long)).toBeUndefined();
  });
});

describe('search (spec 0039)', () => {
  it('searches through search.query once the pause is over, and reads recent items fresh each time', async () => {
    const api = fakeApi({
      globalSearch: (query) => ({
        records: [
          { ref: { objectId: PEOPLE.id, recordId: ADA_MEMBER.id, name: query, kind: 'person' }, match: 'prefix' },
        ],
        views: [],
      }),
      recents: () => [],
    });
    const { data } = layer(api);
    const search = await data.search.open('acme');
    const settled = new Promise<void>((resolve) => {
      const stop = search.subscribe(() => {
        if (search.getSnapshot().status !== 'ready') return;
        stop();
        resolve();
      });
    });
    search.ask('ada');
    await settled;
    expect(search.getSnapshot().records.map((hit) => hit.ref.name)).toEqual(['ada']);
    expect(count(api.calls, '/api/rpc/search/query')).toBe(1);
    expect(await data.search.recents('acme')).toEqual([]);
    expect(await data.search.recents('acme')).toEqual([]);
    expect(count(api.calls, '/api/rpc/recents/list')).toBe(2);
    search.dispose();
  });

  it('sends a visit once per item per 10 seconds, and stays silent when it fails', async () => {
    const api = fakeApi();
    const { data, notices } = layer(api);
    const recordId = '0199a6f2-0000-7000-8000-0000000000a1';
    data.search.visit('acme', 'record', recordId);
    data.search.visit('acme', 'record', recordId);
    data.search.visit('acme', 'view', recordId);
    await vi.waitFor(() => {
      expect(count(api.calls, '/api/rpc/recents/visit')).toBe(2);
    });
    expect(api.sent).toEqual([
      { workspace: 'acme', kind: 'record', id: recordId },
      { workspace: 'acme', kind: 'view', id: recordId },
    ]);
    data.search.visit('acme', 'record', 'not an id');
    await vi.waitFor(() => {
      expect(count(api.calls, '/api/rpc/recents/visit')).toBe(3);
    });
    expect(notices).toEqual([]);
  });
});

describe('a team page’s routing rules (spec 0043, AC-1608)', () => {
  const rule = (id: string): RoutingRule => ({
    id,
    when: { join: 'all', rules: [{ key: 'budget', op: 'is_any_of', value: ['Large', 'Huge'] }] },
    then: { kind: 'hosts', hosts: [ADA_MEMBER.id] },
  });
  const teamPage = (rules: readonly RoutingRule[]): BookingPageView => ({
    id: '0199a6f2-0000-7000-8000-0000000000b1',
    title: 'Demo',
    description: '',
    slug: 'demo',
    durations: [30],
    location: { type: 'video' },
    bufferBefore: 0,
    bufferAfter: 0,
    minNoticeMinutes: 0,
    windowDays: 30,
    dailyLimit: null,
    slotStep: null,
    status: 'live',
    scheduleId: null,
    rescheduleHost: 'same',
    isPrivate: false,
    showSocials: true,
    questions: [],
    fileToCrm: true,
    answersObjectId: null,
    defaultView: 'month',
    profileSection: null,
    profilePosition: 0,
    publicKey: 'demo-key',
    kind: 'round_robin',
    ownerMemberId: ADA_MEMBER.id,
    availability: defaultAvailability('UTC'),
    scheduleName: 'Working hours',
    routing: { rules: [...rules] },
    bookingsThisMonth: 0,
    canChange: true,
    createdAt: '2026-10-22T09:00:00.000Z',
    updatedAt: '2026-10-22T09:00:00.000Z',
  });

  it('holds the rules the page’s read brought: a change shows at once, the answer lands, a refusal puts them back', async () => {
    const page = teamPage([rule('large')]);
    const answers: { settle: (outcome: 'ok' | 'refuse') => void }[] = [];
    const api = fakeApi({
      bookingPagesGet: () => page,
      bookingPagesUpdate: (input) =>
        new Promise((resolve, reject) => {
          answers.push({
            settle: (outcome) => {
              if (outcome === 'ok') resolve({ ...page, routing: { rules: [...(input.routing?.rules ?? [])] } });
              else
                reject(new ORPCError('CONFIG_INVALID', { status: 400, message: 'Rule 2 needs people to pick from.' }));
            },
          });
        }),
    });
    const { data } = layer(api);
    const held = data.routing.pageRules('acme', page.id);
    // One read per page, so a card's subscription holds across renders.
    expect(data.routing.pageRules('acme', page.id)).toBe(held);
    expect(held.getSnapshot()).toBeUndefined();
    const release = held.retain();
    // The editor's loader reads the page; its rules are held from that answer, with no page list read.
    await data.bookingPages.get('acme', page.id);
    expect(held.getSnapshot()?.map((each) => each.id)).toEqual(['large']);
    expect(count(api.calls, '/api/rpc/bookingPages/list')).toBe(0);

    const added = data.bookingPages.update('acme', page.id, {}, { routing: { rules: [rule('large'), rule('huge')] } });
    expect(held.getSnapshot()?.map((each) => each.id)).toEqual(['large', 'huge']);
    await vi.waitFor(() => {
      expect(answers).toHaveLength(1);
    });
    answers[0]?.settle('ok');
    await added;
    expect(held.getSnapshot()?.map((each) => each.id)).toEqual(['large', 'huge']);

    const cleared = data.bookingPages.update('acme', page.id, {}, { routing: { rules: [] } });
    expect(held.getSnapshot()).toEqual([]);
    await vi.waitFor(() => {
      expect(answers).toHaveLength(2);
    });
    answers[1]?.settle('refuse');
    expect((await failure(cleared)).code).toBe('CONFIG_INVALID');
    expect(held.getSnapshot()?.map((each) => each.id)).toEqual(['large', 'huge']);
    release();
  });

  it('forgets the rules when the session ends, so the next one reads its own', async () => {
    const page = teamPage([rule('large')]);
    let signedIn = true;
    const api = fakeApi({
      bookingPagesGet: () => {
        if (!signedIn) throw unauthenticated();
        return page;
      },
    });
    const { data, signedOut } = layer(api);
    await data.me.get();
    await data.bookingPages.get('acme', page.id);
    const held = data.routing.pageRules('acme', page.id);
    expect(held.getSnapshot()?.map((each) => each.id)).toEqual(['large']);
    signedIn = false;
    await failure(data.bookingPages.get('acme', page.id));
    expect(signedOut).toHaveLength(1);
    const after = data.routing.pageRules('acme', page.id);
    expect(after).not.toBe(held);
    expect(after.getSnapshot()).toBeUndefined();
  });
});

describe('Bookings kept current (owner ask A115)', () => {
  it('reads a held week again every minute while live updates are off, and stops once no screen holds it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let reads = 0;
      const api = fakeApi({
        bookingsCalendar: () => {
          reads += 1;
          return { bookings: [], events: [], busy: [], blocks: [] };
        },
      });
      const { data } = layer(api, '/w/acme/bookings/calendar', { random: () => 0.5 });
      expect(data.live.status()).toBe('off');
      const week = data.bookings.calendar('acme', '2026-11-02T00:00:00.000Z', '2026-11-09T00:00:00.000Z');
      const release = week.retain();
      await vi.advanceTimersByTimeAsync(0);
      expect(reads).toBe(1);
      expect(week.getSnapshot()).toMatchObject({ status: 'ready' });
      await vi.advanceTimersByTimeAsync(59_000);
      expect(reads).toBe(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(reads).toBe(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(reads).toBe(3);
      release();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(reads).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
