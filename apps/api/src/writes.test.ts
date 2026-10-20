// The one write path (spec 0005, AC-39), in the style of door.test.ts: every
// procedure in the contract is either a read or a write named here; every
// write goes through `commitWrite`, so it pokes the relay once its write
// commits (and not when refused); and each stores exactly one outbox row per
// object it touched, with its mutation id. A new write procedure fails here
// until it is added to WRITES, which proves it pokes.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contract } from '@crm/contracts';
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { signInApp, testConnections } from '../test/sign-in.ts';
import { failure, memberWithWorkspace } from '../test/workspace.ts';

const { ownerUrl } = inject('testDatabase');

/** The procedures that change nothing. Every other procedure is a write, and must be in WRITES below. */
const READS: ReadonlySet<string> = new Set([
  'system.status',
  // Fails on purpose when switched on (spec 0010); it writes nothing either way.
  'system.testFault',
  'me.get',
  'objects.list',
  'attributes.list',
  'members.list',
  'access.mine',
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
  'usage.get',
  'views.list',
  'views.get',
  // The one view write with no outbox row (spec 0020, AC-488): the member's own last opened view.
  'views.markOpened',
  'trash.query',
  'trash.count',
  'tasks.get',
  'tasks.list',
  'notes.get',
  'notes.list',
  'calendar.connections.list',
  'calendar.meetings.forRecord',
  'calendar.settings.get',
  'forms.list',
  'forms.get',
  'forms.attributes',
  'forms.preview',
  'forms.slugAvailable',
  'submissions.list',
  'submissions.get',
  // Booking pages (spec 0025).
  'bookingPages.list',
  'bookingPages.get',
  'bookings.list',
  'bookings.listAll',
  'bookings.calendar',
  'bookings.hours',
]);

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
let pokes = 0;

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }, {}, { wakeRelay: () => (pokes += 1) }));
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
  'bookings.setHours': async (m, mutationId) => {
    const { availability } = await m.client.bookings.hours({ workspace: m.slug, timeZone: 'UTC' });
    await m.client.bookings.setHours({ workspace: m.slug, availability, mutationId });
    return [];
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

/** How many writes (each one poke) a case in WRITES makes before and with its own. */
const WRITES_MADE: Readonly<Record<string, number>> = {
  'views.update': 2,
  'views.move': 3,
  'views.setLocked': 2,
  'views.setDefault': 2,
  'views.delete': 2,
  'records.setValues': 2,
  'records.setValuesBatch': 3,
  'records.deleteMany': 2,
  'records.restoreBatch': 3,
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
  'calendar.connections.update': 2,
  'calendar.connections.remove': 2,
  'calendar.connections.syncNow': 2,
  'calendar.meetings.addAttendee': 2,
  'bookingPages.update': 2,
  'bookingPages.delete': 2,
  'bookings.blocks.remove': 2,
  'bookings.bookAsHost': 2,
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
  'forms.setTarget': 2,
  'forms.duplicate': 2,
  'forms.delete': 2,
  'submissions.release': 3,
  'submissions.markSpam': 3,
  'submissions.resolve': 3,
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
