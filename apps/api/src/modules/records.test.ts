// The record procedures (spec 0005, AC-34 to AC-36): windows by position and
// cursor, the count, reads by id that leave out unknown and trashed ids,
// creates with a browser minted id and their replay, and value edits that
// answer the fresh record, each refusing with the right status; and
// members.list, which names the Owner column. Real session, real Postgres.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Database, IdentityStore } from '@crm/db';
import { holdTableLock, testQuery } from '@crm/db/testing';
import type { FilterGroup } from '@crm/contracts/values';
import { deleteRecord, enterWorkspace, newId } from '@crm/core';
import { rpcClient, rpcPost, signInApp, testConnections } from '../../test/sign-in.ts';
import { failure, memberWithWorkspace, NOT_A_MEMBER, refusal, refusalsOf } from '../../test/workspace.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

type Member = Awaited<ReturnType<typeof memberWithWorkspace>>;

/** What a create with an id from a device whose clock is off answers. */
const CLOCK_WRONG =
  "This record couldn't be saved because this device's clock looks wrong. Check its time, then try again.";

/**
 * Creates a person named `first` with `email`, through the real procedure,
 * answering the record as reads give it (without the write's `echoes`).
 */
async function createPerson(m: Member, first: string, email?: string, id = newId()) {
  const {
    echoes: _echoes,
    written: _written,
    ...record
  } = await m.client.records.create({
    workspace: m.slug,
    objectId: m.people.id,
    id,
    values: {
      [m.attribute('name')]: { firstName: first, lastName: 'Lovelace' },
      ...(email === undefined ? {} : { [m.attribute('email_addresses')]: [email] }),
    },
    mutationId: newId(),
  });
  return record;
}

/** The member id the door made this person's actor. */
async function memberIdOf(m: Member): Promise<string> {
  const [row] = await testQuery<{ id: string }>(
    ownerUrl,
    `select id from members where workspace_id = $1 and status = 'active'`,
    [m.workspace.id],
  );
  if (row === undefined) throw new Error('No member row.');
  return row.id;
}

/** Moves a record to the trash through the engine, as the member (no procedure deletes yet). */
async function trash(m: Member, recordId: string): Promise<void> {
  const [row] = await testQuery<{ user_id: string }>(
    ownerUrl,
    `select user_id from members where workspace_id = $1 and status = 'active'`,
    [m.workspace.id],
  );
  if (row === undefined) throw new Error('No member row.');
  await deleteRecord(await enterWorkspace({ db, identity }, { userId: row.user_id, slug: m.slug }), { recordId });
}

describe('records.create', () => {
  it('creates a record with the given id and answers it fresh: values by attribute id, display, who and when', async () => {
    const m = await memberWithWorkspace(app);
    const id = newId();
    const view = await createPerson(m, 'Ada', 'Ada@Example.com', id);
    const memberId = await memberIdOf(m);
    expect(view).toMatchObject({
      id,
      objectId: m.people.id,
      createdBy: { type: 'member', id: memberId },
      updatedBy: { type: 'member', id: memberId },
      display: { objectId: m.people.id, recordId: id, name: 'Ada Lovelace', kind: 'person' },
    });
    expect(view.values[m.attribute('name')]).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      fullName: 'Ada Lovelace',
    });
    expect(view.values[m.attribute('email_addresses')]).toEqual(['ada@example.com']);
    expect(view.values[m.attribute('record_id')]).toBe(id);
    expect(view.values[m.attribute('job_title')]).toBeNull();
    expect(view.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('answers a retry with the same id (a lost response) with the record already made, and makes nothing twice', async () => {
    const m = await memberWithWorkspace(app);
    const id = newId();
    const first = await createPerson(m, 'Ada', 'ada@example.com', id);
    const again = await createPerson(m, 'Ada', 'ada@example.com', id);
    expect(again).toEqual(first);
    expect(await m.client.records.count({ workspace: m.slug, objectId: m.people.id })).toEqual({
      count: 1,
      atLeast: false,
    });
  });

  it("refuses an id another object's record holds with ID_TAKEN on the id field, and a trashed one RECORD_DELETED", async () => {
    const m = await memberWithWorkspace(app);
    const id = newId();
    await createPerson(m, 'Ada', undefined, id);
    const taken = await failure(() =>
      m.client.records.create({ workspace: m.slug, objectId: m.companies.id, id, mutationId: newId() }),
    );
    expect({ code: taken.code, status: taken.status }).toEqual({ code: 'ID_TAKEN', status: 409 });
    expect(refusalsOf(taken)).toMatchObject([{ code: 'ID_TAKEN', field: 'id' }]);

    await trash(m, id);
    expect(await refusal(() => createPerson(m, 'Ada', undefined, id))).toMatchObject({
      code: 'RECORD_DELETED',
      status: 409,
    });
  });

  it("refuses an id minted more than 10 minutes from the server's clock on the id field, and writes nothing", async () => {
    const m = await memberWithWorkspace(app);
    const minutes = 60_000;
    const create = (id: string) =>
      m.client.records.create({ workspace: m.slug, objectId: m.people.id, id, mutationId: newId() });
    for (const skew of [-11 * minutes, 11 * minutes]) {
      const error = await failure(() => create(newId(Date.now() + skew)));
      expect({ code: error.code, status: error.status, message: error.message }).toEqual({
        code: 'INPUT_INVALID',
        status: 400,
        message: CLOCK_WRONG,
      });
      expect(error.data).toEqual({ issues: [{ path: ['id'], message: CLOCK_WRONG }] });
    }
    expect((await m.client.records.count({ workspace: m.slug, objectId: m.people.id })).count).toBe(0);
    // Inside the window is fine, either way.
    await create(newId(Date.now() - 9 * minutes));
    await create(newId(Date.now() + 9 * minutes));
    expect((await m.client.records.count({ workspace: m.slug, objectId: m.people.id })).count).toBe(2);
  });

  it("replays a late retry of the member's own record whatever its id's time, and refuses another member's id ID_TAKEN", async () => {
    const m = await memberWithWorkspace(app);
    const memberId = await memberIdOf(m);
    const [other] = await testQuery<{ id: string }>(
      ownerUrl,
      `insert into members (workspace_id, name, email, status, created_by_type, updated_by_type)
       values ($1, 'Grace', 'grace@example.com', 'active', 'system', 'system') returning id`,
      [m.workspace.id],
    );
    /** A person made an hour ago (by its id's time) by `madeBy`, written straight to the table. */
    const madeEarlier = async (madeBy: string) => {
      const id = newId(Date.now() - 60 * 60_000);
      await testQuery(
        ownerUrl,
        `insert into records (workspace_id, id, object_id, created_by_type, created_by_id, created_by_member_id,
           updated_by_type, updated_by_id, updated_by_member_id)
         values ($1, $2, $3, 'member', $4, $4, 'member', $4, $4)`,
        [m.workspace.id, id, m.people.id, madeBy],
      );
      return id;
    };
    const create = (id: string) =>
      m.client.records.create({ workspace: m.slug, objectId: m.people.id, id, mutationId: newId() });

    const mine = await madeEarlier(memberId);
    const replayed = await create(mine);
    expect(replayed).toMatchObject({ id: mine, createdBy: { type: 'member', id: memberId } });

    const theirs = await madeEarlier(other?.id ?? '');
    const taken = await failure(() => create(theirs));
    expect({ code: taken.code, status: taken.status }).toEqual({ code: 'ID_TAKEN', status: 409 });
    expect(refusalsOf(taken)).toMatchObject([{ code: 'ID_TAKEN', field: 'id' }]);
    // Fresh ids take the ordinary path to the same answers.
    const fresh = newId();
    await testQuery(
      ownerUrl,
      `insert into records (workspace_id, id, object_id, created_by_type, created_by_id, created_by_member_id,
         updated_by_type, updated_by_id, updated_by_member_id)
       values ($1, $2, $3, 'member', $4, $4, 'member', $4, $4)`,
      [m.workspace.id, fresh, m.people.id, other?.id],
    );
    expect(await refusal(() => create(fresh))).toMatchObject({ code: 'ID_TAKEN', status: 409 });
  });

  it('refuses bad values per attribute: an invalid email 422, a taken unique email 409, and writes nothing', async () => {
    const m = await memberWithWorkspace(app);
    await createPerson(m, 'Ada', 'ada@example.com');
    const invalid = await failure(() => createPerson(m, 'Grace', 'not an email'));
    expect({ code: invalid.code, status: invalid.status }).toEqual({ code: 'ATTRIBUTE_VALUE_INVALID', status: 422 });
    expect(refusalsOf(invalid)).toMatchObject([
      { code: 'ATTRIBUTE_VALUE_INVALID', attributeId: m.attribute('email_addresses') },
    ]);
    const conflict = await failure(() => createPerson(m, 'Grace', 'ADA@example.com'));
    expect({ code: conflict.code, status: conflict.status }).toEqual({ code: 'UNIQUE_CONFLICT', status: 409 });
    expect(refusalsOf(conflict)).toMatchObject([
      {
        code: 'UNIQUE_CONFLICT',
        message: 'Another record already has this value for Email addresses.',
        attributeId: m.attribute('email_addresses'),
      },
    ]);
    expect((await m.client.records.count({ workspace: m.slug, objectId: m.people.id })).count).toBe(1);
  });

  it('refuses bad input: an id that is not a uuid v7, an attribute key that is not an id; and an unknown object 404', async () => {
    const m = await memberWithWorkspace(app);
    const base = { workspace: m.slug, objectId: m.people.id, mutationId: newId() };
    expect(
      await refusal(() => m.client.records.create({ ...base, id: '00000000-0000-4000-8000-000000000000' })),
    ).toMatchObject({ code: 'INPUT_INVALID', status: 400 });
    expect(
      await refusal(() => m.client.records.create({ ...base, id: newId(), values: { name: 'Ada' } })),
    ).toMatchObject({ code: 'INPUT_INVALID', status: 400 });
    expect(await refusal(() => m.client.records.create({ ...base, objectId: newId(), id: newId() }))).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});

describe('records.setValues', () => {
  it('sets values and answers the fresh record', async () => {
    const m = await memberWithWorkspace(app);
    const person = await createPerson(m, 'Ada');
    const memberId = await memberIdOf(m);
    const view = await m.client.records.setValues({
      workspace: m.slug,
      recordId: person.id,
      values: {
        [m.attribute('job_title')]: { value: 'Analyst' },
        [m.attribute('owner')]: { value: { type: 'member', id: memberId } },
      },
      mutationId: newId(),
    });
    expect(view.values[m.attribute('job_title')]).toBe('Analyst');
    expect(view.values[m.attribute('owner')]).toEqual({ type: 'member', id: memberId });
    expect(view.updatedAt >= person.updatedAt).toBe(true);
    const [read] = await m.client.records.get({ workspace: m.slug, ids: [person.id] });
    // The write's answer is the record as any read gives it, plus how many events carry the write (spec 0006).
    const { echoes, written, ...record } = view;
    expect(read).toEqual(record);
    expect(echoes).toBe(1);
    expect(Object.keys(written).sort()).toEqual([m.attribute('job_title'), m.attribute('owner')].sort());
  });

  it("answers each cell's version: newer for a later write, kept by a clear, and a reference's from its link", async () => {
    const m = await memberWithWorkspace(app);
    const person = await createPerson(m, 'Ada', 'ada@example.com');
    const [name, email, title, company] = ['name', 'email_addresses', 'job_title', 'company'].map(m.attribute);
    if (name === undefined || email === undefined || title === undefined || company === undefined) throw new Error();
    // Set by the create, each with its own version; never set, and system attributes: none.
    expect(person.versions[name]).toEqual(expect.any(String));
    expect(person.versions[email]).toEqual(expect.any(String));
    expect(Object.keys(person.versions).sort()).toEqual([name, email].sort());
    const set = (values: Record<string, unknown>) =>
      m.client.records.setValues({
        workspace: m.slug,
        recordId: person.id,
        values: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value }])),
        mutationId: newId(),
      });
    const titled = await set({ [title]: 'Analyst' });
    expect((titled.versions[title] ?? '') > (person.versions[email] ?? '')).toBe(true);
    expect(titled.versions[name]).toBe(person.versions[name]);
    const cleared = await set({ [title]: null });
    expect(cleared.values[title]).toBeNull();
    expect((cleared.versions[title] ?? '') > (titled.versions[title] ?? '')).toBe(true);
    // A reference cell's version is its link's, the same from both ends.
    const acme = await m.client.records.create({
      workspace: m.slug,
      objectId: m.companies.id,
      id: newId(),
      mutationId: newId(),
    });
    const linked = await set({ [company]: { objectId: m.companies.id, recordId: acme.id } });
    expect((linked.versions[company] ?? '') > (cleared.versions[title] ?? '')).toBe(true);
    const companyAttributes = await m.client.attributes.list({ workspace: m.slug, objectId: m.companies.id });
    const team = companyAttributes.find((each) => each.apiSlug === 'team')?.id ?? '';
    const [acmeNow] = await m.client.records.get({ workspace: m.slug, ids: [acme.id] });
    expect(acmeNow?.versions[team]).toBe(linked.versions[company]);
    expect(acmeNow?.linkTotals).toEqual({});
  });

  it('refuses all or none: one bad value refuses the edit with 422 and keeps every value', async () => {
    const m = await memberWithWorkspace(app);
    const person = await createPerson(m, 'Ada');
    const error = await failure(() =>
      m.client.records.setValues({
        workspace: m.slug,
        recordId: person.id,
        values: {
          [m.attribute('job_title')]: { value: 'Analyst' },
          [m.attribute('avatar')]: { value: 'ftp://nope' },
        },
        mutationId: newId(),
      }),
    );
    expect({ code: error.code, status: error.status }).toEqual({ code: 'ATTRIBUTE_VALUE_INVALID', status: 422 });
    expect(refusalsOf(error)).toMatchObject([{ attributeId: m.attribute('avatar') }]);
    const [read] = await m.client.records.get({ workspace: m.slug, ids: [person.id] });
    expect(read?.values[m.attribute('job_title')]).toBeNull();
  });

  it('refuses a trashed record RECORD_DELETED, an unknown one NOT_FOUND, and a system attribute as read only', async () => {
    const m = await memberWithWorkspace(app);
    const person = await createPerson(m, 'Ada');
    const set = (recordId: string, attributeId: string, value: unknown) =>
      m.client.records.setValues({
        workspace: m.slug,
        recordId,
        values: { [attributeId]: { value } },
        mutationId: newId(),
      });
    expect(await refusal(() => set(person.id, m.attribute('created_at'), '2026-01-01T00:00:00.000Z'))).toMatchObject({
      code: 'ATTRIBUTE_READ_ONLY',
      status: 422,
    });
    expect(await refusal(() => set(newId(), m.attribute('job_title'), 'Analyst'))).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    await trash(m, person.id);
    expect(await refusal(() => set(person.id, m.attribute('job_title'), 'Analyst'))).toMatchObject({
      code: 'RECORD_DELETED',
      status: 409,
    });
  });
});

describe('records.query and records.count', () => {
  it('answers windows in creation order, by position or cursor, and the exact count', async () => {
    const m = await memberWithWorkspace(app);
    const made = [];
    for (const first of ['Ada', 'Grace', 'Alan']) made.push(await createPerson(m, first));
    const ids = made.map((each) => each.id);
    const scope = { workspace: m.slug, objectId: m.people.id };

    const firstTwo = await m.client.records.query({ ...scope, position: 0, limit: 2 });
    expect(firstTwo.records.map((each) => each.id)).toEqual(ids.slice(0, 2));
    expect(firstTwo.nextCursor).toEqual(expect.any(String));
    const rest = await m.client.records.query({ ...scope, cursor: firstTwo.nextCursor ?? '', limit: 2 });
    expect(rest.records.map((each) => each.id)).toEqual(ids.slice(2));
    expect(rest.nextCursor).toBeUndefined();
    const jumped = await m.client.records.query({ ...scope, position: 1, limit: 100 });
    expect(jumped.records.map((each) => each.id)).toEqual(ids.slice(1));
    expect(jumped.records[0]).toEqual(made[1]);

    expect(await m.client.records.count(scope)).toEqual({ count: 3, atLeast: false });
  });

  it('reads only the attributes asked for, plus the primary, and resolves relative dates on the window clock (spec 0006)', async () => {
    const m = await memberWithWorkspace(app);
    const made = await createPerson(m, 'Ada', 'ada@example.com');
    const scope = { workspace: m.slug, objectId: m.people.id };
    const name = m.attribute('name');
    const email = m.attribute('email_addresses');
    // Another object's attribute is ignored, not refused, so it reveals nothing.
    const companyAttributes = await m.client.attributes.list({ workspace: m.slug, objectId: m.companies.id });
    const attributeIds = [email, ...companyAttributes.slice(0, 2).map((each) => each.id)];
    const page = await m.client.records.query({ ...scope, position: 0, limit: 10, attributeIds });
    expect(Object.keys(page.records[0]?.values ?? {}).sort()).toEqual([email, name].sort());
    expect(Object.keys(page.records[0]?.versions ?? {}).every((key) => key === email || key === name)).toBe(true);
    const [read] = await m.client.records.get({ workspace: m.slug, ids: [made.id], attributeIds: [email] });
    expect(Object.keys(read?.values ?? {}).sort()).toEqual([email, name].sort());
    // Without attributeIds, every attribute, as before.
    const whole = await m.client.records.query({ ...scope, position: 0, limit: 10 });
    expect(Object.keys(whole.records[0]?.values ?? {}).length).toBeGreaterThan(2);

    // "Created in the last day", against a clock a year on: nothing matches; against today: Ada.
    const filter: FilterGroup = {
      conjunction: 'and',
      conditions: [
        { attributeId: m.attribute('created_at'), operator: 'within_last', range: { amount: 1, unit: 'day' } },
      ],
    };
    const later = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const clock = { now: later, timeZone: 'Europe/London' };
    expect(await m.client.records.count({ ...scope, filter, ...clock })).toEqual({ count: 0, atLeast: false });
    expect((await m.client.records.query({ ...scope, filter, ...clock })).records).toEqual([]);
    const today = { now: new Date().toISOString(), timeZone: 'Europe/London' };
    expect(await m.client.records.count({ ...scope, filter, ...today })).toEqual({ count: 1, atLeast: false });
    // An unknown zone is refused, so the clock really reaches the engine.
    const unknownZone = await failure(() =>
      m.client.records.count({ ...scope, filter, now: today.now, timeZone: 'Mars/Olympus' }),
    );
    expect(unknownZone.code).toBe('FILTER_INVALID');
  });

  it('refuses a position on a view sorted by a member, and allows it sorted newest first (canJump)', async () => {
    const m = await memberWithWorkspace(app);
    for (const first of ['Ada', 'Grace']) await createPerson(m, first);
    const scope = { workspace: m.slug, objectId: m.people.id };
    const newest = await m.client.records.query({
      ...scope,
      position: 0,
      sorts: [{ attributeId: m.attribute('created_at'), direction: 'descending' }],
    });
    expect(newest.records.map((each) => each.display.name)).toEqual(['Grace Lovelace', 'Ada Lovelace']);
    const byMember = await failure(() =>
      m.client.records.query({
        ...scope,
        position: 1,
        sorts: [{ attributeId: m.attribute('created_by'), direction: 'ascending' }],
      }),
    );
    expect(byMember.code).toBe('FILTER_INVALID');
  });

  it('refuses a cursor sent with another object, filter or sort on the cursor field, and takes it back for its own view', async () => {
    const m = await memberWithWorkspace(app);
    for (const first of ['Ada', 'Grace', 'Alan']) await createPerson(m, first);
    const scope = { workspace: m.slug, objectId: m.people.id };
    const name = m.attribute('name');
    const filter = {
      conjunction: 'and' as const,
      conditions: [{ attributeId: name, operator: 'is_not_empty' as const }],
    };
    const sorts = [{ attributeId: name, direction: 'ascending' as const }];

    const plain = await m.client.records.query({ ...scope, limit: 1 });
    const cursor = plain.nextCursor ?? '';
    const otherView = 'This page link belongs to another view. Start again from the top.';
    for (const elsewhere of [
      { ...scope, objectId: m.companies.id },
      { ...scope, filter },
      { ...scope, sorts },
    ]) {
      const error = await failure(() => m.client.records.query({ ...elsewhere, cursor, limit: 1 }));
      expect({ code: error.code, status: error.status, message: error.message }).toEqual({
        code: 'INPUT_INVALID',
        status: 400,
        message: otherView,
      });
      expect(error.data).toEqual({ issues: [{ path: ['cursor'], message: otherView }] });
    }
    // Its own view, however it is spelled: an empty filter or sort list is none, and an id in upper case the same.
    const again = await m.client.records.query({
      ...scope,
      objectId: m.people.id.toUpperCase(),
      filter: { conjunction: 'and', conditions: [] },
      sorts: [],
      cursor,
      limit: 1,
    });
    expect(again.records).toHaveLength(1);
    // A filtered and sorted view's cursor pages that view only.
    const sorted = await m.client.records.query({ ...scope, filter, sorts, limit: 1 });
    const next = await m.client.records.query({ ...scope, filter, sorts, cursor: sorted.nextCursor ?? '', limit: 1 });
    expect(next.records).toHaveLength(1);
    expect(
      await refusal(() => m.client.records.query({ ...scope, sorts, cursor: sorted.nextCursor ?? '' })),
    ).toMatchObject({
      code: 'INPUT_INVALID',
      message: otherView,
    });
  });

  it('refuses a filter nested a thousand deep with 400 INPUT_INVALID, not a 500', async () => {
    const m = await memberWithWorkspace(app);
    let filter: FilterGroup = { conjunction: 'and', conditions: [] };
    for (let level = 0; level < 1_000; level += 1) filter = { conjunction: 'and', conditions: [filter] };
    const scope = { workspace: m.slug, objectId: m.people.id, filter };
    for (const call of [() => m.client.records.query(scope), () => m.client.records.count(scope)]) {
      expect(await refusal(call)).toMatchObject({ code: 'INPUT_INVALID', status: 400 });
    }
  });

  it('refuses a group that also carries a through chain 2,000 deep with 400 INPUT_INVALID, not a 500', async () => {
    const m = await memberWithWorkspace(app);
    let chain: unknown = { attributeId: m.attribute('job_title'), operator: 'is_empty' };
    for (let level = 0; level < 2_000; level += 1) chain = { operator: 'through', path: ['x'], condition: chain };
    const filter = { conjunction: 'and', conditions: [], operator: 'through', path: ['x'], condition: chain };
    const scope = { workspace: m.slug, objectId: m.people.id, filter: filter as unknown as FilterGroup };
    for (const call of [() => m.client.records.query(scope), () => m.client.records.count(scope)]) {
      expect(await refusal(call)).toMatchObject({ code: 'INPUT_INVALID', status: 400 });
    }
  });

  it('refuses a value nested 3,000 deep sent with a cursor with 400 INPUT_INVALID, not a 500', async () => {
    const m = await memberWithWorkspace(app);
    for (const first of ['Ada', 'Grace']) await createPerson(m, first);
    const { nextCursor } = await m.client.records.query({ workspace: m.slug, objectId: m.people.id, limit: 1 });
    // Written by hand: the typed client's own serializer can't nest this deep.
    const deep = `${'['.repeat(3_000)}"x"${']'.repeat(3_000)}`;
    const input = `{"workspace":${JSON.stringify(m.slug)},"objectId":${JSON.stringify(m.people.id)},"cursor":${JSON.stringify(
      nextCursor,
    )},"filter":{"conjunction":"and","conditions":[{"attributeId":${JSON.stringify(
      m.attribute('job_title'),
    )},"operator":"is","value":${deep}}]}}`;
    const response = await rpcPost(app, m.cookie, 'records/query', input);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ json: { code: 'INPUT_INVALID' } });
  });

  it('refuses a limit over 200, a position with a cursor, a bad cursor, and an unknown object', async () => {
    const m = await memberWithWorkspace(app);
    const scope = { workspace: m.slug, objectId: m.people.id };
    expect(await refusal(() => m.client.records.query({ ...scope, limit: 201 }))).toMatchObject({
      code: 'INPUT_INVALID',
      status: 400,
    });
    expect(await refusal(() => m.client.records.query({ ...scope, position: 0, cursor: 'abc' }))).toMatchObject({
      code: 'INPUT_INVALID',
      status: 400,
    });
    expect(await refusal(() => m.client.records.query({ ...scope, cursor: 'not-a-cursor' }))).toMatchObject({
      code: 'FILTER_INVALID',
      status: 422,
    });
    expect(await refusal(() => m.client.records.query({ ...scope, objectId: newId() }))).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    expect(await refusal(() => m.client.records.count({ ...scope, objectId: newId() }))).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});

/** The statements running under a cancellable read's tag (`crm-query:…`, `crm-count:…`), as the app login sees them. */
async function taggedStatements(): Promise<readonly string[]> {
  const rows = await testQuery<{ name: string }>(
    appUrl,
    `select application_name as name from pg_stat_activity
     where datname = current_database() and (application_name like 'crm-query:%' or application_name like 'crm-count:%')`,
  );
  return rows.map((row) => row.name);
}

/** Polls `check` every 50 ms until it holds, failing after `ms`. */
async function eventually(check: () => Promise<boolean>, ms = 3_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error(`Still not so after ${String(ms)} ms.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('cancelling a read', () => {
  it('stops a slow query and a slow count in Postgres when their request is aborted', async () => {
    const m = await memberWithWorkspace(app);
    await createPerson(m, 'Ada');
    const scope = { workspace: m.slug, objectId: m.people.id };
    const reads = [
      (signal: AbortSignal) => m.client.records.query(scope, { signal }),
      (signal: AbortSignal) => m.client.records.count(scope, { signal }),
    ];
    // Held by another transaction, so each read waits on the records table until it is cancelled.
    const lock = await holdTableLock(ownerUrl, 'records');
    try {
      for (const read of reads) {
        const controller = new AbortController();
        const pending = read(controller.signal).catch((error: unknown) => error);
        await eventually(async () => (await taggedStatements()).length === 1);
        controller.abort();
        await pending;
        await eventually(async () => (await taggedStatements()).length === 0, 1_000);
      }
    } finally {
      await lock.release();
    }
  });
});

describe('the read gate', () => {
  it('runs at most 6 queries and counts at once per workspace, answers the seventh 429, and frees places on abort', async () => {
    const m = await memberWithWorkspace(app);
    const other = await memberWithWorkspace(app);
    const scope = { workspace: m.slug, objectId: m.people.id };
    const lock = await holdTableLock(ownerUrl, 'records');
    const controllers: AbortController[] = [];
    const pending: Promise<unknown>[] = [];
    /** Starts a read that waits on the lock until aborted. */
    const start = (read: (signal: AbortSignal) => Promise<unknown>) => {
      const controller = new AbortController();
      controllers.push(controller);
      pending.push(read(controller.signal).catch((error: unknown) => error));
    };
    try {
      for (let index = 0; index < 3; index += 1) {
        start((signal) => m.client.records.query(scope, { signal }));
        start((signal) => m.client.records.count(scope, { signal }));
      }
      await eventually(async () => (await taggedStatements()).length === 6);
      expect(await refusal(() => m.client.records.count(scope))).toEqual({
        code: 'TOO_MANY_REQUESTS',
        status: 429,
        message: 'Too many requests at once. Try again in a moment.',
      });
      expect(await refusal(() => m.client.records.query(scope))).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
      // Another workspace has places of its own.
      start((signal) => other.client.records.count({ workspace: other.slug, objectId: other.people.id }, { signal }));
      await eventually(async () => (await taggedStatements()).length === 7);
      for (const controller of controllers) controller.abort();
      await Promise.all(pending);
    } finally {
      await lock.release();
    }
    // Every aborted read gives its place back once its statement is cancelled: six at once fit again.
    await eventually(async () => {
      const reads = await Promise.allSettled(Array.from({ length: 6 }, () => m.client.records.count(scope)));
      return reads.every((read) => read.status === 'fulfilled');
    });
  });
});

describe('records.get', () => {
  it('answers live records in the order asked, leaving out unknown and trashed ids', async () => {
    const m = await memberWithWorkspace(app);
    const ada = await createPerson(m, 'Ada');
    const grace = await createPerson(m, 'Grace');
    const alan = await createPerson(m, 'Alan');
    await trash(m, alan.id);
    const read = await m.client.records.get({ workspace: m.slug, ids: [grace.id, newId(), alan.id, ada.id] });
    expect(read).toEqual([grace, ada]);
    expect(await m.client.records.get({ workspace: m.slug, ids: [] })).toEqual([]);
  });

  it("leaves out another workspace's records, and refuses more than 500 ids", async () => {
    const a = await memberWithWorkspace(app);
    const b = await memberWithWorkspace(app);
    const theirs = await createPerson(a, 'Ada');
    expect(await b.client.records.get({ workspace: b.slug, ids: [theirs.id] })).toEqual([]);
    const tooMany = Array.from({ length: 501 }, () => newId());
    expect(await refusal(() => a.client.records.get({ workspace: a.slug, ids: tooMany }))).toMatchObject({
      code: 'INPUT_INVALID',
      status: 400,
    });
  });
});

describe('the door on every record procedure', () => {
  it('answers a non member the same NOT_FOUND as an unknown address, and no session 401', async () => {
    const a = await memberWithWorkspace(app);
    const b = await memberWithWorkspace(app);
    const person = await createPerson(a, 'Ada');
    const calls = (client: Member['client']) => [
      () => client.records.query({ workspace: a.slug, objectId: a.people.id }),
      () => client.records.count({ workspace: a.slug, objectId: a.people.id }),
      () => client.records.get({ workspace: a.slug, ids: [person.id] }),
      () => client.records.create({ workspace: a.slug, objectId: a.people.id, id: newId(), mutationId: newId() }),
      () =>
        client.records.setValues({
          workspace: a.slug,
          recordId: person.id,
          values: { [a.attribute('job_title')]: { value: 'Mole' } },
          mutationId: newId(),
        }),
      () => client.members.list({ workspace: a.slug }),
    ];
    for (const call of calls(b.client)) expect(await refusal(call)).toEqual(NOT_A_MEMBER);
    for (const call of calls(rpcClient(app))) {
      expect(await refusal(call)).toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    }
    expect(await a.client.records.count({ workspace: a.slug, objectId: a.people.id })).toEqual({
      count: 1,
      atLeast: false,
    });
    const [read] = await a.client.records.get({ workspace: a.slug, ids: [person.id] });
    expect(read).toEqual(person);
  });
});

describe("another workspace's ids, sent from inside your own", () => {
  it("refuses every one NOT_FOUND or ATTRIBUTE_VALUE_INVALID, and leaves the other workspace's data as it was", async () => {
    const a = await memberWithWorkspace(app);
    const b = await memberWithWorkspace(app);
    const theirs = await createPerson(a, 'Ada', 'ada@example.com');
    const theirCompany = await a.client.records.create({
      workspace: a.slug,
      objectId: a.companies.id,
      id: newId(),
      mutationId: newId(),
    });
    const theirMember = await memberIdOf(a);
    const mine = await createPerson(b, 'Bea');
    const before = {
      attributes: await a.client.attributes.list({ workspace: a.slug, objectId: a.people.id }),
      records: await a.client.records.get({ workspace: a.slug, ids: [theirs.id, theirCompany.id] }),
    };
    const own = { workspace: b.slug };
    const setMine = (values: Record<string, unknown>) =>
      b.client.records.setValues({
        ...own,
        recordId: mine.id,
        values: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value }])),
        mutationId: newId(),
      });
    const cases: readonly { readonly name: string; readonly call: () => Promise<unknown>; readonly code: string }[] = [
      {
        name: "attributes.list on A's object",
        call: () => b.client.attributes.list({ ...own, objectId: a.people.id }),
        code: 'NOT_FOUND',
      },
      {
        name: "attributes.create on A's object",
        call: () =>
          b.client.attributes.create({
            ...own,
            objectId: a.people.id,
            title: 'Mole',
            type: 'text',
            mutationId: newId(),
          }),
        code: 'NOT_FOUND',
      },
      {
        name: "records.query on A's object",
        call: () => b.client.records.query({ ...own, objectId: a.people.id }),
        code: 'NOT_FOUND',
      },
      {
        name: "records.count on A's object",
        call: () => b.client.records.count({ ...own, objectId: a.people.id }),
        code: 'NOT_FOUND',
      },
      {
        name: "records.create on A's object",
        call: () => b.client.records.create({ ...own, objectId: a.people.id, id: newId(), mutationId: newId() }),
        code: 'NOT_FOUND',
      },
      {
        name: "records.setValues on A's record",
        call: () =>
          b.client.records.setValues({
            ...own,
            recordId: theirs.id,
            values: { [b.attribute('job_title')]: { value: 'Mole' } },
            mutationId: newId(),
          }),
        code: 'NOT_FOUND',
      },
      {
        name: "records.setValues keyed by A's attribute",
        call: () => setMine({ [a.attribute('job_title')]: 'Mole' }),
        // An attribute of another workspace is no attribute here, as an unknown id is.
        code: 'NOT_FOUND',
      },
      {
        name: "records.create keyed by A's attribute",
        call: () =>
          b.client.records.create({
            ...own,
            objectId: b.people.id,
            id: newId(),
            values: { [a.attribute('job_title')]: 'Mole' },
            mutationId: newId(),
          }),
        // An attribute of another workspace is no attribute here, as an unknown id is.
        code: 'NOT_FOUND',
      },
      {
        name: "A's member as an owner",
        call: () => setMine({ [b.attribute('owner')]: { type: 'member', id: theirMember } }),
        code: 'ATTRIBUTE_VALUE_INVALID',
      },
      {
        name: "A's company as a reference",
        call: () => setMine({ [b.attribute('company')]: { objectId: a.companies.id, recordId: theirCompany.id } }),
        code: 'ATTRIBUTE_VALUE_INVALID',
      },
    ];
    const answers = [];
    for (const each of cases) answers.push({ name: each.name, code: (await failure(each.call)).code });
    expect(answers).toEqual(cases.map((each) => ({ name: each.name, code: each.code })));

    expect(await a.client.attributes.list({ workspace: a.slug, objectId: a.people.id })).toEqual(before.attributes);
    expect(await a.client.records.get({ workspace: a.slug, ids: [theirs.id, theirCompany.id] })).toEqual(
      before.records,
    );
    expect(await a.client.records.count({ workspace: a.slug, objectId: a.people.id })).toEqual({
      count: 1,
      atLeast: false,
    });
    const [mineNow] = await b.client.records.get({ ...own, ids: [mine.id] });
    expect(mineNow).toEqual(mine);
  });
});

describe('members.list', () => {
  it('answers the active members by name, with their emails, leaving out removed ones', async () => {
    const m = await memberWithWorkspace(app);
    await testQuery(
      ownerUrl,
      `insert into members (workspace_id, name, email, status, created_by_type, updated_by_type)
       values ($1, 'Gone', 'gone@example.com', 'removed', 'system', 'system')`,
      [m.workspace.id],
    );
    expect(await m.client.members.list({ workspace: m.slug })).toEqual([
      { id: await memberIdOf(m), name: 'Ada', email: m.email },
    ]);
  });
});
