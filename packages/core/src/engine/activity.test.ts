// Spec 0017, milestone 1, step 2, against a real Postgres as the app role:
// the timeline's creation source, its cursor (a tampered one is refused on
// `cursor`), the record check (missing and hidden answer the same, a trashed
// record is answered), and the trashed read behind the record page.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { decodeActivityCursor, encodeActivityCursor, getActivity } from './activity.ts';
import { setObjectArchived } from './definitions.ts';
import { deleteRecord } from './deletion.ts';
import { newId } from './ids.ts';
import { createRecord } from './records.ts';
import { isInputError, isRefusal } from './refusals.ts';
import { createWorkspace } from './workspaces.ts';
import { readTrashedRecord } from '../records/records.ts';
import { rescope, testScope } from '../testing.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-activity-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Activity',
    slug: `activity-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const rows = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  const ids = Object.fromEntries(rows.rows.map((row) => [row.slug, row.id]));
  const id = (slug: string): string => {
    const value = ids[slug];
    if (value === undefined) throw new Error(`No ${slug}.`);
    return value;
  };
  // A second member, for scopes with injected rules.
  const memberId = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${memberId}, 'Bea', 'bea@example.com', 'member', 'system', 'system')`,
    ),
  );
  return {
    scope,
    ownerId: created.memberId,
    memberId,
    companies: created.objects.companies ?? '',
    people: created.objects.people ?? '',
    id,
  };
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    if (isInputError(error)) return { code: 'INPUT_INVALID', ...error.inputProblem };
    throw error;
  }
  throw new Error('It was let through.');
}

describe('the creation entry (spec 0017, AC-378)', () => {
  it('reads one entry for a new record: who created it and when, keyed with microseconds', async () => {
    const world = await workspace();
    const { recordId } = await createRecord(world.scope, {
      objectId: world.companies,
      values: { [world.id('companies.name')]: 'Acme', [world.id('companies.description')]: 'Rockets' },
    });
    const page = await getActivity(world.scope, { recordId });
    expect(page.nextCursor).toBeUndefined();
    expect(page.entries).toHaveLength(1);
    const [entry] = page.entries;
    expect(entry).toMatchObject({
      id: `created:${recordId}`,
      kind: 'created',
      actor: { type: 'member', id: world.ownerId },
    });
    expect(entry?.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(entry?.key).toMatch(
      new RegExp(`^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{6}Z\\|9\\|created:${recordId}$`),
    );
    expect(entry?.key.startsWith(entry.at.slice(0, 23))).toBe(true);
  });

  it('pages by cursor: past the creation there is nothing, and before it the creation comes', async () => {
    const world = await workspace();
    const { recordId } = await createRecord(world.scope, {
      objectId: world.people,
      values: { [world.id('people.name')]: { firstName: 'Jane' } },
    });
    const [entry] = (await getActivity(world.scope, { recordId, limit: 1 })).entries;
    const at = entry?.key.split('|')[0] ?? '';
    const pastIt = encodeActivityCursor({ at, rank: 9, id: `created:${recordId}` });
    expect((await getActivity(world.scope, { recordId, cursor: pastIt })).entries).toEqual([]);
    const later = encodeActivityCursor({ at: '2999-01-01T00:00:00.000000Z', rank: 1, id: 'links:x' });
    expect((await getActivity(world.scope, { recordId, cursor: later })).entries.map((each) => each.id)).toEqual([
      `created:${recordId}`,
    ]);
    // The same moment and rank, a smaller id: the creation still comes after it.
    const sameMoment = encodeActivityCursor({ at, rank: 9, id: 'created:' });
    expect((await getActivity(world.scope, { recordId, cursor: sameMoment })).entries).toHaveLength(1);
  });

  it('refuses a tampered cursor on `cursor`, and a limit out of range on `limit`', async () => {
    const world = await workspace();
    const { recordId } = await createRecord(world.scope, {
      objectId: world.people,
      values: { [world.id('people.name')]: { firstName: 'Jane' } },
    });
    const tampered = [
      'not base64 json',
      Buffer.from('{"at":"2026-10-08T10:00:00Z","rank":9,"id":"x"}').toString('base64url'),
      Buffer.from('{"at":"2026-10-08T10:00:00.000000Z","rank":11,"id":"x"}').toString('base64url'),
      Buffer.from('{"at":"2026-10-08T10:00:00.000000Z","rank":1,"id":"x","sql":"drop"}').toString('base64url'),
    ];
    for (const cursor of tampered) {
      expect(await refusalOf(getActivity(world.scope, { recordId, cursor }))).toMatchObject({
        code: 'INPUT_INVALID',
        field: 'cursor',
      });
    }
    expect(() => decodeActivityCursor(tampered[1] ?? '')).toThrow();
    expect(await refusalOf(getActivity(world.scope, { recordId, limit: 51 }))).toMatchObject({ field: 'limit' });
  });
});

describe('the record check (spec 0017, AC-376, AC-382, AC-387)', () => {
  it('answers a missing record, a malformed id and a hidden one the same: NOT_FOUND', async () => {
    const world = await workspace();
    const { recordId } = await createRecord(world.scope, {
      objectId: world.companies,
      values: { [world.id('companies.name')]: 'Hidden Co' },
    });
    const missing = await refusalOf(getActivity(world.scope, { recordId: newId() }));
    const malformed = await refusalOf(getActivity(world.scope, { recordId: 'nope' }));
    const objectHidden = rescope(world.scope, {
      actor: { type: 'member', id: world.memberId },
      role: 'member',
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'object', objectId: world.companies },
            level: 'none',
          },
        ],
        records: [],
      },
    });
    // A record rule on Owner: the member owns nothing, so they see no company.
    const ruled = rescope(world.scope, {
      actor: { type: 'member', id: world.memberId },
      role: 'member',
      rules: {
        levels: [],
        records: [
          {
            subject: { type: 'role', role: 'member' },
            objectId: world.companies,
            kind: 'own',
            attributeId: world.id('companies.owner'),
          },
        ],
      },
    });
    const hiddenObject = await refusalOf(getActivity(objectHidden, { recordId }));
    const outsideRule = await refusalOf(getActivity(ruled, { recordId }));
    const expected = { code: 'NOT_FOUND', message: 'That record does not exist.' };
    expect(missing).toEqual(expected);
    expect(malformed).toEqual(expected);
    expect(hiddenObject).toEqual(expected);
    expect(outsideRule).toEqual(expected);
    // The owner, under the open policy, reads it.
    expect((await getActivity(world.scope, { recordId })).entries).toHaveLength(1);
  });

  it('answers a record in the trash, and a record on an archived object as missing', async () => {
    const world = await workspace();
    const { recordId } = await createRecord(world.scope, {
      objectId: world.people,
      values: { [world.id('people.name')]: { firstName: 'Gone' } },
    });
    await deleteRecord(world.scope, { recordId });
    expect((await getActivity(world.scope, { recordId })).entries.map((each) => each.kind)).toEqual(['created']);
    const { recordId: deal } = await createRecord(world.scope, {
      objectId: world.people,
      values: { [world.id('people.name')]: { firstName: 'Archived' } },
    });
    await setObjectArchived(world.scope, { objectId: world.people, archived: true });
    expect(await refusalOf(getActivity(world.scope, { recordId: deal }))).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('a record in the trash (spec 0017, AC-376)', () => {
  it('reads its values, no links, and who deleted it and when', async () => {
    const world = await workspace();
    const { recordId: acme } = await createRecord(world.scope, {
      objectId: world.companies,
      values: { [world.id('companies.name')]: 'Acme' },
    });
    const { recordId } = await createRecord(world.scope, {
      objectId: world.people,
      values: {
        [world.id('people.name')]: { firstName: 'Jane', lastName: 'Doe' },
        [world.id('people.job_title')]: 'CTO',
        [world.id('people.company')]: { objectId: world.companies, recordId: acme },
      },
    });
    expect(await refusalOf(readTrashedRecord(world.scope, recordId))).toMatchObject({ code: 'NOT_FOUND' });
    await deleteRecord(world.scope, { recordId });
    const trashed = await readTrashedRecord(world.scope, recordId);
    expect(trashed.record.id).toBe(recordId);
    expect(trashed.record.display.name).toBe('Jane Doe');
    expect(trashed.record.values[world.id('people.job_title')]).toBe('CTO');
    expect(trashed.record.values[world.id('people.company')]).toBeNull();
    expect(trashed.deletedBy).toEqual({ type: 'member', id: world.ownerId });
    expect(Date.parse(trashed.deletedAt)).not.toBeNaN();
    const hidden = rescope(world.scope, {
      actor: { type: 'member', id: world.memberId },
      role: 'member',
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'object', objectId: world.people },
            level: 'none',
          },
        ],
        records: [],
      },
    });
    expect(await refusalOf(readTrashedRecord(hidden, recordId))).toEqual({
      code: 'NOT_FOUND',
      message: 'That record does not exist.',
    });
    expect(await refusalOf(readTrashedRecord(world.scope, newId()))).toMatchObject({ code: 'NOT_FOUND' });
  });
});
