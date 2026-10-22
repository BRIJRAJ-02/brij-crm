// Settings › Account › Preferences, against a real Postgres as the app role:
// the defaults, a change of one field keeping the rest, the audit row, each
// member reading only their own, the refusals (not a member, a landing object
// hidden or in another workspace), and the database's own guard.
import { sql } from 'drizzle-orm';
import { DEFAULT_PREFERENCES } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { PREFERENCES_MEMBERS_ONLY, readMyPreferences, updateMyPreferences } from './preferences.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-preferences-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
/** A workspace with its owner and one plain member. */
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Prefs',
    slug: `prefs-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const member = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${member}, 'Grace', ${`${member}@example.com`}, 'member', 'system', 'system')`,
    ),
  );
  const people = created.objects.people ?? '';
  return {
    ...created,
    people,
    owner: testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } }),
    member: testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: member }, role: 'member' }),
    memberId: member,
  };
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

describe('a member’s preferences', () => {
  it('reads the defaults until a change, then changes only the fields named', async () => {
    const w = await workspace();
    expect(await readMyPreferences(w.member)).toEqual(DEFAULT_PREFERENCES);
    await updateMyPreferences(w.member, { timeZone: 'Asia/Kolkata', weekStart: 'sunday' });
    expect(
      await updateMyPreferences(w.member, { dateFormat: 'ymd', landing: { kind: 'object', objectId: w.people } }),
    ).toEqual({
      timeZone: 'Asia/Kolkata',
      dateFormat: 'ymd',
      weekStart: 'sunday',
      landing: { kind: 'object', objectId: w.people },
    });
    // Null goes back to the browser's zone.
    expect(await updateMyPreferences(w.member, { timeZone: null })).not.toHaveProperty('timeZone');
    expect(await readMyPreferences(w.member)).toMatchObject({ dateFormat: 'ymd', weekStart: 'sunday' });
  });

  it('writes one audit row a change, with only the changed fields, and none for no change', async () => {
    const w = await workspace();
    await updateMyPreferences(w.member, { landing: { kind: 'tasks' } }, { requestId: 'r1' });
    await updateMyPreferences(w.member, { landing: { kind: 'tasks' } });
    const rows = await testQuery<{ action: string; target_id: string; before: unknown; after: unknown }>(
      ownerUrl,
      'select action, target_id::text, before, after from audit_events where workspace_id = $1',
      [w.workspaceId],
    );
    expect(rows).toEqual([
      {
        action: 'member.preferences_changed',
        target_id: w.memberId,
        before: { landing: { kind: 'home' } },
        after: { landing: { kind: 'tasks' } },
      },
    ]);
  });

  it('keeps each member to their own', async () => {
    const w = await workspace();
    await updateMyPreferences(w.member, { weekStart: 'saturday' });
    expect(await readMyPreferences(w.owner)).toEqual(DEFAULT_PREFERENCES);
    expect(await readMyPreferences(w.member)).toMatchObject({ weekStart: 'saturday' });
  });

  it('keeps the Home sections a member put away, theirs alone, and an empty list shows them all again', async () => {
    const w = await workspace();
    expect(await updateMyPreferences(w.member, { homeHidden: ['setup'] })).toMatchObject({ homeHidden: ['setup'] });
    expect(await readMyPreferences(w.member)).toMatchObject({ homeHidden: ['setup'], landing: { kind: 'home' } });
    // Another member's Home is untouched, and an API key can't put one away for anybody.
    expect(await readMyPreferences(w.owner)).toEqual(DEFAULT_PREFERENCES);
    const key = testScope({ db, workspaceId: w.workspaceId, actor: { type: 'api_key', id: newId() } });
    expect(await refusalOf(updateMyPreferences(key, { homeHidden: ['setup'] }))).toEqual({
      code: 'FORBIDDEN',
      message: PREFERENCES_MEMBERS_ONLY,
    });
    expect(await updateMyPreferences(w.member, { homeHidden: [] })).not.toHaveProperty('homeHidden');
    expect(await readMyPreferences(w.member)).toEqual(DEFAULT_PREFERENCES);
  });

  it('refuses a principal that isn’t a member', async () => {
    const w = await workspace();
    const key = testScope({ db, workspaceId: w.workspaceId, actor: { type: 'api_key', id: newId() } });
    const forbidden = { code: 'FORBIDDEN', message: PREFERENCES_MEMBERS_ONLY };
    expect(await refusalOf(readMyPreferences(key))).toEqual(forbidden);
    expect(await refusalOf(updateMyPreferences(key, { weekStart: 'monday' }))).toEqual(forbidden);
  });

  it('refuses a landing object the member can’t see, or one in another workspace, as unknown', async () => {
    const w = await workspace();
    const other = await workspace();
    const hidden = testScope({
      db,
      workspaceId: w.workspaceId,
      actor: { type: 'member', id: w.memberId },
      role: 'member',
      rules: {
        levels: [
          { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: w.people }, level: 'none' },
        ],
        records: [],
      },
    });
    expect(
      await refusalOf(updateMyPreferences(hidden, { landing: { kind: 'object', objectId: w.people } })),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await refusalOf(updateMyPreferences(w.member, { landing: { kind: 'object', objectId: other.people } })),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect(await readMyPreferences(w.member)).toEqual(DEFAULT_PREFERENCES);
  });

  it('never reads another workspace’s rows, and refuses a row naming its member (the database’s guard)', async () => {
    const a = await workspace();
    const b = await workspace();
    await updateMyPreferences(b.member, { dateFormat: 'mdy' });
    const fromA = await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute<{ member_id: string }>(sql`select member_id from member_preferences`),
    );
    expect(fromA.rows).toEqual([]);
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into member_preferences (workspace_id, member_id) values (${a.workspaceId}, ${b.memberId})`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'member_preferences_member' } });
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into member_preferences (workspace_id, member_id, landing) values (${a.workspaceId}, ${a.memberId}, 'object')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'member_preferences_landing' } });
  });
});
