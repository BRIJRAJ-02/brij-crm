// The record procedures (spec 0005, AC-34 to AC-36): windows by position and
// cursor, the count, reads by id that leave out unknown and trashed ids,
// creates with a browser minted id and their replay, and value edits that
// answer the fresh record, each refusing with the right status; and
// members.list, which names the Owner column. Real session, real Postgres.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Database, IdentityStore } from '@crm/db';
import { holdTableLock, testQuery } from '@crm/db/testing';
import { deleteRecord, enterWorkspace, newId } from '@crm/core';
import { rpcClient, signInApp, testConnections } from '../../test/sign-in.ts';
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

/** Creates a person named `first` with `email`, through the real procedure. */
function createPerson(m: Member, first: string, email?: string, id = newId()) {
  return m.client.records.create({
    workspace: m.slug,
    objectId: m.people.id,
    id,
    values: {
      [m.attribute('name')]: { firstName: first, lastName: 'Lovelace' },
      ...(email === undefined ? {} : { [m.attribute('email_addresses')]: [email] }),
    },
    mutationId: newId(),
  });
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
      { code: 'UNIQUE_CONFLICT', attributeId: m.attribute('email_addresses') },
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
    expect(read).toEqual(view);
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
