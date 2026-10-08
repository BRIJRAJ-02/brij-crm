// Spec 0006, milestone 1, at the API: every read and write answers the
// record's `revision` (AC-44), every write its `echoes` (AC-60), a save from an
// older version lands and its change event names what it replaced and who
// (AC-46), `ifVersionId` refuses 409 `VERSION_CHANGED` (AC-49), and
// `records.setValuesBatch` lands what it can in one write with one outbox row
// per object (AC-50). `access.mine` names the caller's member id, which the
// browser matches `replaced` against. Real session, real Postgres.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { rpcClient, signIn, signInApp, testConnections } from '../../test/sign-in.ts';
import { failure, memberWithWorkspace, refusal, refusalsOf } from '../../test/workspace.ts';

const { ownerUrl } = inject('testDatabase');
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

/** Someone else, signed in, added to the workspace as a member (as #23's invites will), and their client. */
async function joined(m: Member) {
  const { cookie, email } = await signIn(app);
  const [user] = await testQuery<{ id: string }>(ownerUrl, 'select id from auth."user" where email = $1', [email]);
  const memberId = newId();
  await testQuery(
    ownerUrl,
    `insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type)
     values ($1, $2, $3, 'Bea', $4, 'member', 'system', 'system')`,
    [m.workspace.id, memberId, user?.id, email],
  );
  return { client: rpcClient(app, cookie), memberId };
}

interface Row extends Record<string, unknown> {
  readonly kind: string;
  readonly record_ids: string[];
  readonly mutation_id: string | null;
  readonly replaced: unknown;
}

async function outboxOf(workspaceId: string): Promise<Row[]> {
  return testQuery<Row>(
    ownerUrl,
    'select kind, record_ids, mutation_id, replaced from outbox where workspace_id = $1 order by seq',
    [workspaceId],
  );
}

const createPerson = (m: Member, first: string) =>
  m.client.records.create({
    workspace: m.slug,
    objectId: m.people.id,
    id: newId(),
    values: { [m.attribute('name')]: { firstName: first, lastName: 'Lovelace' } },
    mutationId: newId(),
  });

describe('revision and echoes (spec 0006, AC-44, AC-60)', () => {
  it('answers the revision on every read and write, and how many events carry the write', async () => {
    const m = await memberWithWorkspace(app);
    const id = newId();
    const create = {
      workspace: m.slug,
      objectId: m.people.id,
      id,
      values: { [m.attribute('name')]: { firstName: 'Ada', lastName: 'Lovelace' } },
      mutationId: newId(),
    };
    const made = await m.client.records.create(create);
    expect({ revision: made.revision, echoes: made.echoes }).toEqual({ revision: 0, echoes: 1 });
    // A retry after a lost answer writes nothing, so nothing echoes.
    expect((await m.client.records.create(create)).echoes).toBe(0);

    const set = (value: string) =>
      m.client.records.setValues({
        workspace: m.slug,
        recordId: id,
        values: { [m.attribute('job_title')]: { value } },
        mutationId: newId(),
      });
    const titled = await set('Analyst');
    expect({ revision: titled.revision, echoes: titled.echoes }).toEqual({ revision: 1, echoes: 1 });
    // The version the write itself made: what the tab may call its own.
    expect(titled.written).toEqual({ [m.attribute('job_title')]: titled.versions[m.attribute('job_title')] });
    // Unchanged: nothing written, nothing published, the revision stays.
    const again = await set('Analyst');
    expect({ revision: again.revision, echoes: again.echoes }).toEqual({ revision: 1, echoes: 0 });
    expect(again.written).toEqual({});
    const [read] = await m.client.records.get({ workspace: m.slug, ids: [id] });
    expect(read?.revision).toBe(1);
    const page = await m.client.records.query({ workspace: m.slug, objectId: m.people.id, position: 0, limit: 10 });
    expect(page.records.find((record) => record.id === id)?.revision).toBe(1);
  });
});

describe('a save over a value its author never saw (spec 0006, AC-45, AC-46)', () => {
  it('lands the later save and names the replaced version and the member who replaced it on the event', async () => {
    const m = await memberWithWorkspace(app);
    const bea = await joined(m);
    const ada = await m.client.access.mine({ workspace: m.slug });
    expect(ada.memberId).toEqual(expect.any(String));
    expect((await bea.client.access.mine({ workspace: m.slug })).memberId).toBe(bea.memberId);

    const person = await createPerson(m, 'Ada');
    const title = m.attribute('job_title');
    // Both start from the same state: the title never set.
    const adas = await m.client.records.setValues({
      workspace: m.slug,
      recordId: person.id,
      values: { [title]: { value: 'Analyst', baseVersionId: null } },
      mutationId: newId(),
    });
    const mutationId = newId();
    const beas = await bea.client.records.setValues({
      workspace: m.slug,
      recordId: person.id,
      values: { [title]: { value: 'Engineer', baseVersionId: null } },
      mutationId,
    });
    expect(beas.values[title]).toBe('Engineer');
    const rows = await outboxOf(m.workspace.id);
    expect(rows.at(-1)).toEqual({
      kind: 'records',
      record_ids: [person.id],
      mutation_id: mutationId,
      replaced: [
        {
          recordId: person.id,
          attributeId: title,
          versionId: adas.versions[title],
          by: { type: 'member', id: bea.memberId },
        },
      ],
    });
    // Ada's first save replaced nothing (the cell was never set), and a save from the current version names nothing.
    await m.client.records.setValues({
      workspace: m.slug,
      recordId: person.id,
      values: { [title]: { value: 'Analyst', baseVersionId: beas.versions[title] ?? null } },
      mutationId: newId(),
    });
    const after = await outboxOf(m.workspace.id);
    expect(after.filter((row) => row.replaced !== null)).toHaveLength(1);
  });
});

describe('the exact version precondition (spec 0006, AC-49)', () => {
  it('lands an undo while the cell holds the version written, and answers 409 VERSION_CHANGED after a change', async () => {
    const m = await memberWithWorkspace(app);
    const bea = await joined(m);
    const person = await createPerson(m, 'Ada');
    const title = m.attribute('job_title');
    const written = await m.client.records.setValues({
      workspace: m.slug,
      recordId: person.id,
      values: { [title]: { value: 'Analyst' } },
      mutationId: newId(),
    });
    const undo = (versionId: string) =>
      m.client.records.setValues({
        workspace: m.slug,
        recordId: person.id,
        values: { [title]: { value: null, ifVersionId: versionId } },
        mutationId: newId(),
      });
    const undone = await undo(written.versions[title] ?? '');
    expect(undone.values[title]).toBeNull();

    const again = await m.client.records.setValues({
      workspace: m.slug,
      recordId: person.id,
      values: { [title]: { value: 'Director' } },
      mutationId: newId(),
    });
    // Someone else changes it: the undo is refused, naming the cell, and their value stays.
    await bea.client.records.setValues({
      workspace: m.slug,
      recordId: person.id,
      values: { [title]: { value: 'Engineer' } },
      mutationId: newId(),
    });
    const error = await failure(() => undo(again.versions[title] ?? ''));
    expect({ code: error.code, status: error.status }).toEqual({ code: 'VERSION_CHANGED', status: 409 });
    expect(refusalsOf(error)).toEqual([
      { code: 'VERSION_CHANGED', message: 'Job title was changed since, so it was kept.', attributeId: title },
    ]);
    const [read] = await m.client.records.get({ workspace: m.slug, ids: [person.id] });
    expect(read?.values[title]).toBe('Engineer');
  });
});

describe('records.setValuesBatch (spec 0006, AC-50)', () => {
  it('lands each record it can in one write, one outbox row per object, and answers the rest with their refusals', async () => {
    const m = await memberWithWorkspace(app);
    const ada = await createPerson(m, 'Ada');
    const bea = await createPerson(m, 'Bea');
    const unknown = newId();
    const title = m.attribute('job_title');
    const avatar = m.attribute('avatar');
    const before = (await outboxOf(m.workspace.id)).length;
    const mutationId = newId();
    const answer = await m.client.records.setValuesBatch({
      workspace: m.slug,
      items: [
        { recordId: ada.id, values: { [title]: { value: 'Analyst' } } },
        { recordId: bea.id, values: { [title]: { value: 'Engineer' }, [avatar]: { value: 'ftp://nope' } } },
        { recordId: unknown, values: { [title]: { value: 'Ghost' } } },
      ],
      mutationId,
    });
    expect(answer.echoes).toBe(1);
    expect(answer.results.map((result) => result.recordId)).toEqual([ada.id, bea.id, unknown]);
    expect(answer.results[0]?.record?.values[title]).toBe('Analyst');
    expect(answer.results[0]?.record?.revision).toBe(1);
    expect(answer.results[1]).toEqual({
      recordId: bea.id,
      refusals: [expect.objectContaining({ code: 'ATTRIBUTE_VALUE_INVALID', attributeId: avatar })],
    });
    expect(answer.results[2]).toMatchObject({ recordId: unknown, refusals: [{ code: 'NOT_FOUND' }] });
    const rows = (await outboxOf(m.workspace.id)).slice(before);
    expect(rows).toEqual([{ kind: 'records', record_ids: [ada.id], mutation_id: mutationId, replaced: null }]);
    // A retry of the same batch writes nothing twice: nothing changed, so nothing is published.
    const retried = await m.client.records.setValuesBatch({
      workspace: m.slug,
      items: [{ recordId: ada.id, values: { [title]: { value: 'Analyst' } } }],
      mutationId,
    });
    expect(retried.echoes).toBe(0);
    expect(retried.results[0]?.record?.revision).toBe(1);
  });

  it("refuses another workspace's record in a batch as unknown, and leaves it as it was", async () => {
    const a = await memberWithWorkspace(app);
    const b = await memberWithWorkspace(app);
    const theirs = await createPerson(a, 'Ada');
    const mine = await createPerson(b, 'Bea');
    const title = b.attribute('job_title');
    const answer = await b.client.records.setValuesBatch({
      workspace: b.slug,
      items: [
        { recordId: theirs.id, values: { [title]: { value: 'Mole' } } },
        { recordId: mine.id, values: { [title]: { value: 'Analyst' } } },
      ],
      mutationId: newId(),
    });
    expect(answer.results[0]).toEqual({
      recordId: theirs.id,
      refusals: [{ code: 'NOT_FOUND', message: 'That record does not exist.' }],
    });
    expect(answer.results[1]?.written).toEqual({ [title]: answer.results[1]?.record?.versions[title] });
    const [untouched] = await a.client.records.get({ workspace: a.slug, ids: [theirs.id] });
    expect(untouched?.revision).toBe(0);
  });

  it('refuses more than 500 records whole with 422 CONFIG_INVALID, and writes nothing', async () => {
    const m = await memberWithWorkspace(app);
    const before = (await outboxOf(m.workspace.id)).length;
    const items = Array.from({ length: 501 }, () => ({
      recordId: newId(),
      values: { [m.attribute('job_title')]: { value: 'Analyst' } },
    }));
    expect(
      await refusal(() => m.client.records.setValuesBatch({ workspace: m.slug, items, mutationId: newId() })),
    ).toMatchObject({ code: 'CONFIG_INVALID', status: 422 });
    expect(await outboxOf(m.workspace.id)).toHaveLength(before);
  });
});
