// Access rules by role and team (spec 0032, milestones 1 and 3), against a real Postgres as the app role and the
// production rule source (`storedRules`): what the Access tab reads and sets, and that what it sets is what a member
// then sees through the door. The Member role loses Companies and the Sales team gets it back; a member limited to
// their own records owns what they make and sees only that; a team scope shows teammates' records; owners and admins
// are never restricted; nothing crosses from one workspace to another, one role to another, or one team to another.
import { sql } from 'drizzle-orm';
import type { Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { archiveAttribute } from '../engine/definitions.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { countMatches, queryPage } from '../engine/query/page.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createRecord } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { changeTeamMembers, createTeam } from '../teams/teams.ts';
import { testScope } from '../testing.ts';
import { audiences } from './audiences.ts';
import { enterAsActor, systemScope } from './door.ts';
import { objectLevel, OPEN_KEY } from './policy.ts';
import { getObjectAccess, setObjectAccess } from './rules.ts';
import { storedRules } from './stored-rules.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-access-rules-tests' });
});
afterAll(async () => {
  await db.close();
});

const MEMBER = { type: 'role', role: 'member' } as const;
const team = (teamId: string) => ({ type: 'team', teamId }) as const;

let made = 0;
/** A workspace: Olga the owner, and Companies with its Name and Owner. */
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Rules',
    slug: `rules-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Olga Owner', email: 'olga@example.com' },
  });
  const companies = created.objects.companies ?? '';
  const slugs = await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, a.api_slug as slug from attributes a where a.object_id = ${companies}`,
    ),
  );
  const attribute = (slug: string): string => slugs.rows.find((row) => row.slug === slug)?.id ?? '';
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
  /** The member's scope as the door makes it, from the stored rules and their teams. */
  const enter = (memberId: string) =>
    enterAsActor(
      { db, rules: storedRules },
      { workspaceId: created.workspaceId, actor: { type: 'member', id: memberId } },
    );
  const company = (name: string, ownerId: string | undefined, as = owner) =>
    createRecord(as, {
      objectId: companies,
      values: {
        [attribute('name')]: name,
        ...(ownerId === undefined ? {} : { [attribute('owner')]: { type: 'member', id: ownerId } }),
      },
    }).then((made) => made.recordId);
  const names = async (as: Awaited<ReturnType<typeof enter>>) =>
    (await queryPage(as, { objectId: companies })).records.map((record) => record.id);
  const audit = () =>
    testQuery<{ before: Record<string, unknown> | null; after: Record<string, unknown> }>(
      ownerUrl,
      `select before, after from audit_events where workspace_id = $1 and action = 'access.rule_set' order by at, id`,
      [created.workspaceId],
    );
  return { ...created, companies, attribute, owner, add, enter, company, names, audit };
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

describe('reading an object’s access (AC-851)', () => {
  it('starts with members editing every record, the Owner field a scope would read, and how many people', async () => {
    const w = await world();
    await w.add('Ada');
    await w.add('Bea');
    await w.add('Ana', 'admin');
    const access = await getObjectAccess(w.owner, { objectId: w.companies });
    expect(access.ownerAttribute).toEqual({ id: w.attribute('owner'), title: 'Owner' });
    expect(access.subjects).toEqual([
      { subject: MEMBER, level: 'write', records: 'all', defaultLevel: 'write', isDefault: true, people: 2 },
    ]);
  });

  it('needs access.manage, and an object of another workspace is no object here', async () => {
    const w = await world();
    const other = await world();
    const ada = await w.add('Ada');
    const forbidden = { code: 'FORBIDDEN', message: 'Only workspace owners and admins can change who sees what.' };
    expect(await refusalOf(getObjectAccess(await w.enter(ada), { objectId: w.companies }))).toEqual(forbidden);
    expect(
      await refusalOf(setObjectAccess(await w.enter(ada), { objectId: w.companies, subject: MEMBER, rule: null })),
    ).toEqual(forbidden);
    expect(await refusalOf(getObjectAccess(w.owner, { objectId: other.companies }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(
      await refusalOf(
        setObjectAccess(w.owner, {
          objectId: other.companies,
          subject: MEMBER,
          rule: { level: 'none', records: 'all' },
        }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('the Member role restricts and a team grants (AC-843, AC-844)', () => {
  it('hides Companies from members outside the Sales team, and shows it to those in it, owners and admins always', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const bea = await w.add('Bea');
    const admin = await w.add('Ana', 'admin');
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [ada] });
    const acme = await w.company('Acme', undefined);
    await setObjectAccess(w.owner, { objectId: w.companies, subject: MEMBER, rule: { level: 'none', records: 'all' } });
    await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: team(sales.id),
      rule: { level: 'write', records: 'all' },
    });
    const access = await getObjectAccess(w.owner, { objectId: w.companies });
    expect(access.subjects).toEqual([
      { subject: MEMBER, level: 'none', records: 'all', defaultLevel: 'write', isDefault: false, people: 2 },
      { subject: team(sales.id), level: 'write', records: 'all', defaultLevel: 'none', isDefault: false, people: 1 },
    ]);
    // Ada, in Sales, edits; Bea, in no team, finds nothing (absent, not locked); the admin and owner see it all.
    const inSales = await w.enter(ada);
    expect(objectLevel(inSales.access, w.companies)).toBe('write');
    expect(await w.names(inSales)).toEqual([acme]);
    const outside = await w.enter(bea);
    expect(objectLevel(outside.access, w.companies)).toBe('none');
    expect(await refusalOf(queryPage(outside, { objectId: w.companies }))).toMatchObject({ code: 'NOT_FOUND' });
    for (const id of [admin, w.memberId]) {
      const open = await w.enter(id);
      expect(open.access.data.key).toBe(OPEN_KEY);
      expect(await w.names(open)).toEqual([acme]);
    }
    // Taking the team's row away takes Ada's access with it; the Member role back at its default shows all again.
    await setObjectAccess(w.owner, { objectId: w.companies, subject: team(sales.id), rule: null });
    expect(objectLevel((await w.enter(ada)).access, w.companies)).toBe('none');
    await setObjectAccess(w.owner, { objectId: w.companies, subject: MEMBER, rule: null });
    expect(await w.names(await w.enter(bea))).toEqual([acme]);
    expect((await getObjectAccess(w.owner, { objectId: w.companies })).subjects).toEqual([
      { subject: MEMBER, level: 'write', records: 'all', defaultLevel: 'write', isDefault: true, people: 2 },
    ]);
  });

  it('can’t name an owner, an admin or a role the code doesn’t know, and a team must be this workspace’s', async () => {
    const w = await world();
    const other = await world();
    const foreign = await createTeam(other.owner, { name: 'Sales' });
    for (const role of ['owner', 'admin', 'guest']) {
      expect(
        await refusalOf(
          setObjectAccess(w.owner, {
            objectId: w.companies,
            subject: { type: 'role', role } as never,
            rule: { level: 'none', records: 'all' },
          }),
        ),
      ).toMatchObject({ code: 'CONFIG_INVALID' });
    }
    expect(
      await refusalOf(
        setObjectAccess(w.owner, {
          objectId: w.companies,
          subject: team(foreign.id),
          rule: { level: 'write', records: 'all' },
        }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect((await getObjectAccess(w.owner, { objectId: w.companies })).subjects).toHaveLength(1);
  });

  it('keeps one workspace’s rules out of another’s', async () => {
    const mine = await world();
    const theirs = await world();
    const ada = await mine.add('Ada');
    const bea = await theirs.add('Bea');
    await setObjectAccess(mine.owner, {
      objectId: mine.companies,
      subject: MEMBER,
      rule: { level: 'none', records: 'all' },
    });
    expect(objectLevel((await mine.enter(ada)).access, mine.companies)).toBe('none');
    // The same role in another workspace is untouched.
    expect(objectLevel((await theirs.enter(bea)).access, theirs.companies)).toBe('write');
    expect((await theirs.enter(bea)).access.data.key).toBe(OPEN_KEY);
  });
});

describe('which records (AC-847, AC-848)', () => {
  it('limits a member to their own records, and what they make is theirs', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const bea = await w.add('Bea');
    const adas = await w.company('Ada’s', ada);
    await w.company('Bea’s', bea);
    await w.company('Nobody’s', undefined);
    await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'write', records: 'own' },
    });
    const asAda = await w.enter(ada);
    // Only the record that names them; one with no owner is not theirs (owner decision 4).
    expect(await w.names(asAda)).toEqual([adas]);
    // A record they make with no owner chosen is theirs, so it never vanishes from them.
    const made1 = await w.company('Made by Ada', undefined, asAda);
    expect(await w.names(asAda)).toEqual([adas, made1]);
    // Bea sees hers and what she makes; never Ada's.
    const asBea = await w.enter(bea);
    expect(await w.names(asBea)).toHaveLength(1);
    expect(await w.names(asBea)).not.toContain(adas);
    // The count is the same rule: Ada counts hers and what she made, never the rest.
    expect(await countMatches(asAda, { objectId: w.companies })).toEqual({ count: 2, atLeast: false });
    // The owner sees every record.
    expect(await w.names(await w.enter(w.memberId))).toHaveLength(4);
    expect(await countMatches(await w.enter(w.memberId), { objectId: w.companies })).toEqual({
      count: 4,
      atLeast: false,
    });
  });

  it('shows a team scope the records of everyone in the member’s teams', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const grace = await w.add('Grace');
    const max = await w.add('Max');
    await createTeam(w.owner, { name: 'Sales', memberIds: [ada, grace] });
    const adas = await w.company('Ada’s', ada);
    const graces = await w.company('Grace’s', grace);
    await w.company('Max’s', max);
    await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'write', records: 'team' },
    });
    expect((await w.names(await w.enter(ada))).sort()).toEqual([adas, graces].sort());
    // Max is in no team: their team is themself.
    expect(await w.names(await w.enter(max))).toHaveLength(1);
  });

  it('follows the team: a teammate who leaves takes their records out of view, and joining brings them in', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const grace = await w.add('Grace');
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [ada, grace] });
    const adas = await w.company('Ada’s', ada);
    const graces = await w.company('Grace’s', grace);
    await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'write', records: 'team' },
    });
    expect((await w.names(await w.enter(ada))).sort()).toEqual([adas, graces].sort());
    await changeTeamMembers(w.owner, { teamId: sales.id, remove: [grace] });
    expect(await w.names(await w.enter(ada))).toEqual([adas]);
    expect(await w.names(await w.enter(grace))).toEqual([graces]);
    await changeTeamMembers(w.owner, { teamId: sales.id, add: [grace] });
    expect((await w.names(await w.enter(ada))).sort()).toEqual([adas, graces].sort());
  });

  it('lets a team see more than the role: own for members, all for Sales', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const bea = await w.add('Bea');
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [ada] });
    await w.company('Bea’s', bea);
    await w.company('Ada’s', ada);
    await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'write', records: 'own' },
    });
    await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: team(sales.id),
      rule: { level: 'write', records: 'all' },
    });
    expect(await w.names(await w.enter(ada))).toHaveLength(2);
    expect(await w.names(await w.enter(bea))).toHaveLength(1);
  });

  it('refuses a scope when the object has no Member field to read, and archiving the Owner while a rule reads it', async () => {
    const w = await world();
    await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'write', records: 'own' },
    });
    const refusal = await refusalOf(archiveAttribute(w.owner, w.attribute('owner')));
    expect(refusal).toMatchObject({ code: 'IN_USE', attributeId: w.attribute('owner') });
    expect(refusal.message).toContain('Companies');
    // With the scope gone it archives, and then no scope is offered: the object has no Member field left.
    await setObjectAccess(w.owner, { objectId: w.companies, subject: MEMBER, rule: null });
    await archiveAttribute(w.owner, w.attribute('owner'));
    expect((await getObjectAccess(w.owner, { objectId: w.companies })).ownerAttribute).toBeUndefined();
    expect(
      await refusalOf(
        setObjectAccess(w.owner, { objectId: w.companies, subject: MEMBER, rule: { level: 'write', records: 'own' } }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
  });
});

describe('the change itself (AC-851, AC-852)', () => {
  it('is idempotent: the same rule twice writes one audit row, and each real change one, with its access row', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const rule = { level: 'read', records: 'all' } as const;
    await setObjectAccess(w.owner, { objectId: w.companies, subject: MEMBER, rule }, [outboxHook()]);
    await setObjectAccess(w.owner, { objectId: w.companies, subject: MEMBER, rule }, [outboxHook()]);
    expect(await w.audit()).toHaveLength(1);
    expect((await w.audit())[0]?.after).toMatchObject({ subject: 'member', level: 'read', records: 'all' });
    const rows = await testQuery<{ item_ids: string[] }>(
      ownerUrl,
      `select item_ids::text[] as item_ids from outbox where workspace_id = $1 and kind = 'access' order by seq`,
      [w.workspaceId],
    );
    // One row, naming the one member with the Member role.
    expect(rows).toEqual([{ item_ids: [ada] }]);
    await setObjectAccess(w.owner, { objectId: w.companies, subject: MEMBER, rule: null }, [outboxHook()]);
    expect(await w.audit()).toHaveLength(2);
  });

  it('puts members with equal results in one audience, and a restricted member apart from the open one', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const bea = await w.add('Bea');
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [ada] });
    await setObjectAccess(w.owner, { objectId: w.companies, subject: MEMBER, rule: { level: 'none', records: 'all' } });
    await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: team(sales.id),
      rule: { level: 'write', records: 'all' },
    });
    const groups = await audiences(systemScope(db, w.workspaceId));
    const keyOf = (id: string) => groups.find((group) => group.members.some((member) => member.memberId === id))?.key;
    // Ada's team undoes the rule, so she reads with the open audience; Bea is restricted, apart.
    expect(keyOf(ada)).toBe(OPEN_KEY);
    expect(keyOf(w.memberId)).toBe(OPEN_KEY);
    expect(keyOf(bea)).not.toBe(OPEN_KEY);
  });
});
