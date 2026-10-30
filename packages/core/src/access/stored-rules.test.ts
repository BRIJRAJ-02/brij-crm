// The production rule source (spec 0031, AC-825; spec 0032, AC-841), against a real Postgres as the app role: the door
// gives a member their teams, and the members of those teams, in the statement it already makes; a team of another
// workspace is never theirs; and the audiences the relay reads group members by what their rules and teams give them.
import { sql } from 'drizzle-orm';
import type { Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { newId } from '../engine/ids.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { createTeam } from '../teams/teams.ts';
import { testScope } from '../testing.ts';
import { audiences } from './audiences.ts';
import { enterAsActor, systemScope } from './door.ts';
import { storedRules } from './stored-rules.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-stored-rules-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
/** A workspace: Olga the owner, and a way to add members. */
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Rules',
    slug: `stored-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Olga Owner', email: 'olga@example.com' },
  });
  const owner = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    role: 'owner',
  });
  const add = async (name: string, role: Role = 'member') => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${id}@example.com`}, ${role}, 'system', 'system')`,
      ),
    );
    return id;
  };
  const enter = (memberId: string) =>
    enterAsActor(
      { db, rules: storedRules },
      { workspaceId: created.workspaceId, actor: { type: 'member', id: memberId } },
    );
  return { ...created, owner, add, enter };
}

describe('the door (AC-825)', () => {
  it('gives a member their teams and the members of those teams', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const grace = await w.add('Grace');
    const max = await w.add('Max');
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [ada, grace] });
    const support = await createTeam(w.owner, { name: 'Support', memberIds: [ada, max] });
    const { principal } = (await w.enter(ada)).access;
    if (principal.kind !== 'member') throw new Error('A member is a member.');
    expect([...principal.teamIds].sort()).toEqual([sales.id, support.id].sort());
    expect([...(principal.teamMemberIds ?? [])].sort()).toEqual([ada, grace, max].sort());
    // Someone in no team has none, and is their own team mate.
    const loner = await w.add('Loner');
    expect((await w.enter(loner)).access.principal).toMatchObject({ teamIds: [], teamMemberIds: [loner] });
  });

  it('never gives a member a team of another workspace', async () => {
    const mine = await world();
    const theirs = await world();
    const ada = await mine.add('Ada');
    const bea = await theirs.add('Bea');
    await createTeam(theirs.owner, { name: 'Sales', memberIds: [bea] });
    expect((await mine.enter(ada)).access.principal).toMatchObject({ teamIds: [] });
  });
});

describe('the audiences', () => {
  it('put members who share a team and no rule in one audience, as before', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const grace = await w.add('Grace');
    await createTeam(w.owner, { name: 'Sales', memberIds: [ada] });
    const scope = systemScope(db, w.workspaceId);
    const groups = await audiences(scope);
    expect(groups.map((group) => group.key)).toEqual(['open']);
    expect(groups[0]?.members.map((each) => each.memberId).sort()).toEqual([w.memberId, ada, grace].sort());
  });
});
