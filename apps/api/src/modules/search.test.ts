// search.query, recents.list and recents.visit (spec 0039, milestone 1)
// through the real app: a member finds a person by name and by email and a
// view by name, keeps what they open as recent, and a non member gets the
// same NOT_FOUND as an unknown workspace. A real session against a real
// Postgres.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { holdTableLock, testQuery } from '@crm/db/testing';
import { signInApp, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace, NOT_A_MEMBER, refusal } from '../../test/workspace.ts';

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

async function person(m: Member, firstName: string, email: string): Promise<string> {
  const created = await m.client.records.create({
    workspace: m.slug,
    objectId: m.people.id,
    id: newId(),
    values: { [m.attribute('name')]: { firstName }, [m.attribute('email_addresses')]: [email] },
    mutationId: newId(),
  });
  return created.id;
}

describe('search.query', () => {
  it('finds a person by name and by email, and the default view by name', async () => {
    const m = await memberWithWorkspace(app);
    const grace = await person(m, 'Grace', 'grace@navy.mil');
    const byName = await m.client.search.query({ workspace: m.slug, query: 'grace' });
    expect(byName.records).toHaveLength(1);
    expect(byName.records[0]).toMatchObject({
      ref: { recordId: grace, name: 'Grace' },
      detail: 'grace@navy.mil',
      match: 'prefix',
    });
    const byEmail = await m.client.search.query({ workspace: m.slug, query: 'navy.mil' });
    expect(byEmail.records.map((hit) => hit.ref.recordId)).toEqual([grace]);
    const views = await m.client.search.query({ workspace: m.slug, query: 'all people' });
    expect(views.views).toEqual([expect.objectContaining({ name: 'All People', isDefault: true })]);
    expect(await m.client.search.query({ workspace: m.slug, query: '' })).toEqual({ records: [], views: [] });
  });

  it('refuses a query past 200 characters, and a non member as an unknown workspace', async () => {
    const m = await memberWithWorkspace(app);
    expect(await refusal(() => m.client.search.query({ workspace: m.slug, query: 'x'.repeat(201) }))).toMatchObject({
      code: 'INPUT_INVALID',
      status: 400,
    });
    const other = await memberWithWorkspace(app);
    expect(await refusal(() => other.client.search.query({ workspace: m.slug, query: 'grace' }))).toEqual(NOT_A_MEMBER);
  });
});

describe('recents', () => {
  it('keeps what a member opened, newest first, and only for them', async () => {
    const m = await memberWithWorkspace(app);
    const grace = await person(m, 'Grace', 'grace@navy.mil');
    const [view] = (await m.client.views.list({ workspace: m.slug, objectId: m.people.id })).views;
    const viewId = view?.id ?? '';
    await m.client.recents.visit({ workspace: m.slug, kind: 'view', id: viewId });
    await m.client.recents.visit({ workspace: m.slug, kind: 'record', id: grace });
    const { items } = await m.client.recents.list({ workspace: m.slug });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'record', ref: { recordId: grace } });
    expect(items[1]).toMatchObject({ kind: 'view', view: { id: viewId, name: 'All People' } });
    // An id that names nothing answers as a success, and keeps nothing.
    await expect(m.client.recents.visit({ workspace: m.slug, kind: 'record', id: newId() })).resolves.toBeUndefined();
    expect((await m.client.recents.list({ workspace: m.slug })).items).toHaveLength(2);
    const other = await memberWithWorkspace(app);
    expect(await refusal(() => other.client.recents.list({ workspace: m.slug }))).toEqual(NOT_A_MEMBER);
    expect(await refusal(() => other.client.recents.visit({ workspace: m.slug, kind: 'record', id: grace }))).toEqual(
      NOT_A_MEMBER,
    );
  });
});

/** The search and query statements running now, by the tag each read sets on its connection. */
async function taggedStatements(): Promise<readonly string[]> {
  const rows = await testQuery<{ name: string }>(
    appUrl,
    `select application_name as name from pg_stat_activity
     where datname = current_database() and application_name like 'crm-query:%'`,
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

describe('the read gate', () => {
  it('holds searches to the workspace’s 6 places shared with records.query, answers 429 past them, and frees them on abort', async () => {
    const m = await memberWithWorkspace(app);
    await person(m, 'Grace', 'grace@example.com');
    const lock = await holdTableLock(ownerUrl, 'records');
    const controllers: AbortController[] = [];
    const pending: Promise<unknown>[] = [];
    try {
      for (let index = 0; index < 6; index += 1) {
        const controller = new AbortController();
        controllers.push(controller);
        pending.push(
          m.client.search
            .query({ workspace: m.slug, query: 'grace' }, { signal: controller.signal })
            .catch((error: unknown) => error),
        );
      }
      await eventually(async () => (await taggedStatements()).length === 6);
      expect(await refusal(() => m.client.search.query({ workspace: m.slug, query: 'grace' }))).toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        status: 429,
      });
      expect(await refusal(() => m.client.records.query({ workspace: m.slug, objectId: m.people.id }))).toMatchObject({
        code: 'TOO_MANY_REQUESTS',
      });
      expect(await refusal(() => m.client.recents.list({ workspace: m.slug }))).toMatchObject({
        code: 'TOO_MANY_REQUESTS',
      });
      for (const controller of controllers) controller.abort();
      await Promise.all(pending);
    } finally {
      await lock.release();
    }
    await eventually(async () => {
      const found = await Promise.allSettled(
        Array.from({ length: 6 }, () => m.client.search.query({ workspace: m.slug, query: 'grace' })),
      );
      return found.every((read) => read.status === 'fulfilled');
    });
  });
});
