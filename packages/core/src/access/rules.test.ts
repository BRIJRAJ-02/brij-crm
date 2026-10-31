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
import { listObjectAttributes } from '../attributes/attributes.ts';
import { archiveAttribute, defineAttribute, listAttributes, restoreAttribute } from '../engine/definitions.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { countMatches, queryPage } from '../engine/query/page.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createRecord, getRecords, setValues } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { editRecord } from '../records/records.ts';
import { changeTeamMembers, createTeam } from '../teams/teams.ts';
import { testScope } from '../testing.ts';
import { audiences } from './audiences.ts';
import { enterAsActor, systemScope } from './door.ts';
import { objectLevel, OPEN_KEY } from './policy.ts';
import { previewAccess } from './preview.ts';
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
      {
        subject: MEMBER,
        level: 'write',
        records: 'all',
        defaultLevel: 'write',
        isDefault: true,
        fields: {},
        people: 2,
      },
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
      {
        subject: MEMBER,
        level: 'none',
        records: 'all',
        defaultLevel: 'write',
        isDefault: false,
        fields: {},
        people: 2,
      },
      {
        subject: team(sales.id),
        level: 'write',
        records: 'all',
        defaultLevel: 'none',
        isDefault: false,
        fields: {},
        people: 1,
      },
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
      {
        subject: MEMBER,
        level: 'write',
        records: 'all',
        defaultLevel: 'write',
        isDefault: true,
        fields: {},
        people: 2,
      },
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

  it('stores an access row naming nobody for a rule covering nobody, so other admins’ Access tabs read it again', async () => {
    const w = await world();
    const empty = await createTeam(w.owner, { name: 'Empty' });
    await setObjectAccess(
      w.owner,
      { objectId: w.companies, subject: { type: 'team', teamId: empty.id }, rule: { level: 'read', records: 'all' } },
      [outboxHook()],
    );
    const rows = await testQuery<{ item_ids: string[] }>(
      ownerUrl,
      `select item_ids::text[] as item_ids from outbox where workspace_id = $1 and kind = 'access' order by seq`,
      [w.workspaceId],
    );
    expect(rows).toEqual([{ item_ids: [] }]);
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

describe('a record handed to someone out of reach (AC-848)', () => {
  it('saves, and tells its maker who owns it now and that they can no longer see it', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const grace = await w.add('Grace Hopper');
    await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'write', records: 'own' },
    });
    const member = await w.enter(ada);
    const owner = w.attribute('owner');
    const mine = await createRecord(member, {
      objectId: w.companies,
      values: { [w.attribute('name')]: 'Mine' },
    }).then((made) => made.recordId);
    expect(await w.names(member)).toContain(mine);
    // Setting the Owner to a colleague works, and says so.
    const refusal = await refusalOf(
      editRecord(member, { recordId: mine, values: { [owner]: { value: { type: 'member', id: grace } } } }),
    );
    expect(refusal).toEqual({
      code: 'RECORD_OUT_OF_SCOPE',
      message: "Saved. It's owned by Grace Hopper, so you can no longer see it.",
    });
    expect(await w.names(member)).not.toContain(mine);
    expect(await w.names(w.owner)).toContain(mine);
    // A write that doesn't touch the owner of a record that is gone is not this: it is just not there.
    expect(await refusalOf(editRecord(member, { recordId: mine, values: {} }))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('says nothing of the sort to someone no rule limits', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const grace = await w.add('Grace');
    const acme = await w.company('Acme', ada);
    const written = await editRecord(await w.enter(ada), {
      recordId: acme,
      values: { [w.attribute('owner')]: { value: { type: 'member', id: grace } } },
    });
    expect(written.record.id).toBe(acme);
  });
});

describe('one field for every record rule of an object (AC-847)', () => {
  it('keeps reading the field the rules were made with when an Owner field appears later', async () => {
    const w = await world();
    // The Owner goes, another Member field takes its place, a rule reads that, and the Owner comes back.
    await archiveAttribute(w.owner, w.attribute('owner'));
    const manager = (
      await defineAttribute(w.owner, {
        objectId: w.companies,
        apiSlug: 'account_manager',
        title: 'Account manager',
        type: 'actor_reference',
      })
    ).attributeId;
    await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'write', records: 'own' },
    });
    await restoreAttribute(w.owner, w.attribute('owner'));
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [] });
    const { access } = await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: team(sales.id),
      rule: { level: 'write', records: 'team' },
    });
    // The tab names the field the rules read, and the second rule reads the same one, never the Owner that would win now.
    expect(access.ownerAttribute).toEqual({ id: manager, title: 'Account manager' });
    const rows = await testQuery<{ attribute_id: string }>(
      ownerUrl,
      `select attribute_id::text from record_rules where workspace_id = $1 and object_id = $2`,
      [w.workspaceId, w.companies],
    );
    expect(rows.map((row) => row.attribute_id)).toEqual([manager, manager]);
    // With no record rule left the next one reads the Owner again.
    await setObjectAccess(w.owner, { objectId: w.companies, subject: team(sales.id), rule: null });
    await setObjectAccess(w.owner, { objectId: w.companies, subject: MEMBER, rule: null });
    expect((await getObjectAccess(w.owner, { objectId: w.companies })).ownerAttribute?.id).toBe(w.attribute('owner'));
  });
});

describe('field rules (AC-846, AC-853, AC-854, AC-855)', () => {
  it('hides a field from the Member role everywhere the door reads, and an owner still sees it', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const description = w.attribute('description');
    const acme = await createRecord(w.owner, {
      objectId: w.companies,
      values: { [w.attribute('name')]: 'Acme', [description]: 'Secret plans' },
    }).then((made) => made.recordId);
    const { access } = await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'write', records: 'all', fields: { [description]: 'hidden' } },
    });
    expect(access.subjects[0]).toMatchObject({ isDefault: false, level: 'write', fields: { [description]: 'hidden' } });
    const member = await w.enter(ada);
    // Absent from the attribute list, the record and a write that names it; present for the owner.
    expect((await listAttributes(member, w.companies)).map((each) => each.id)).not.toContain(description);
    const [seen] = await getRecords(member, { ids: [acme] });
    expect(Object.keys(seen?.values ?? {})).not.toContain(description);
    expect(
      await refusalOf(setValues(member, { recordId: acme, values: { [description]: { value: 'x' } } })),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect((await listAttributes(w.owner, w.companies)).map((each) => each.id)).toContain(description);
    const [asOwner] = await getRecords(w.owner, { ids: [acme] });
    expect(Object.keys(asOwner?.values ?? {})).toContain(description);
  });

  it('makes a field read only with the reason, and a team can lift it', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const bea = await w.add('Bea');
    const phone = w.attribute('phone');
    const acme = await w.company('Acme', undefined);
    await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'write', records: 'all', fields: { [phone]: 'read' } },
    });
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [bea] });
    expect(
      await refusalOf(setValues(await w.enter(ada), { recordId: acme, values: { [phone]: { value: [] } } })),
    ).toMatchObject({ code: 'ATTRIBUTE_READ_ONLY', message: "Your role can't change Phone." });
    // Sales gets the object at edit with no field rule: its view is the most open, so Bea can change it again.
    await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: team(sales.id),
      rule: { level: 'write', records: 'all' },
    });
    const beaListed = await listObjectAttributes(await w.enter(bea), w.companies);
    expect(beaListed.find((each) => each.id === phone)?.readOnly).toBeUndefined();
    const adaListed = await listObjectAttributes(await w.enter(ada), w.companies);
    expect(adaListed.find((each) => each.id === phone)?.readOnly).toEqual({ reason: "Your role can't change Phone." });
  });

  it('keeps a subject’s field rules when a later change leaves them out, and clears them with the rule', async () => {
    const w = await world();
    const description = w.attribute('description');
    await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'write', records: 'all', fields: { [description]: 'hidden' } },
    });
    const { access } = await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'read', records: 'all' },
    });
    expect(access.subjects[0]).toMatchObject({ level: 'read', fields: { [description]: 'hidden' } });
    const cleared = await setObjectAccess(w.owner, { objectId: w.companies, subject: MEMBER, rule: null });
    expect(cleared.access.subjects[0]).toMatchObject({ isDefault: true, fields: {} });
    // The same rule twice writes one audit row, with the field named by its title.
    const rule = { level: 'write', records: 'all', fields: { [description]: 'read' } } as const;
    await setObjectAccess(w.owner, { objectId: w.companies, subject: MEMBER, rule });
    await setObjectAccess(w.owner, { objectId: w.companies, subject: MEMBER, rule });
    const rows = await w.audit();
    expect(rows).toHaveLength(4);
    expect(rows[3]?.after).toMatchObject({ fields: { Description: 'read' } });
  });

  it('refuses hiding the record’s name, a field of another object or workspace, and a level the code doesn’t know', async () => {
    const w = await world();
    const other = await world();
    const name = w.attribute('name');
    expect(
      await refusalOf(
        setObjectAccess(w.owner, {
          objectId: w.companies,
          subject: MEMBER,
          rule: { level: 'write', records: 'all', fields: { [name]: 'hidden' } },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', message: "A record's name can't be hidden." });
    // Read only is fine for it.
    await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'write', records: 'all', fields: { [name]: 'read' } },
    });
    for (const foreign of [other.attribute('description'), newId()]) {
      expect(
        await refusalOf(
          setObjectAccess(w.owner, {
            objectId: w.companies,
            subject: MEMBER,
            rule: { level: 'write', records: 'all', fields: { [foreign]: 'hidden' } },
          }),
        ),
      ).toMatchObject({ code: 'CONFIG_INVALID' });
    }
    await expect(
      setObjectAccess(w.owner, {
        objectId: w.companies,
        subject: MEMBER,
        rule: { level: 'write', records: 'all', fields: { [w.attribute('phone')]: 'write' as never } },
      }),
    ).rejects.toMatchObject({ inputProblem: { field: 'rule' } });
  });

  it('fails closed on a field level stored that the code doesn’t know, and shows it hidden', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const description = w.attribute('description');
    await testQuery(
      ownerUrl,
      `insert into access_rules (workspace_id, subject_type, subject_role, object_id, attribute_id, level, created_by_type, updated_by_type)
       values ($1, 'role', 'member', $2, $3, 'manage', 'system', 'system')`,
      [w.workspaceId, w.companies, description],
    );
    expect((await listAttributes(await w.enter(ada), w.companies)).map((each) => each.id)).not.toContain(description);
    const read = await getObjectAccess(w.owner, { objectId: w.companies });
    expect(read.subjects[0]?.fields).toEqual({ [description]: 'hidden' });
  });
});

describe('what a change takes away (AC-850)', () => {
  it('counts the people who lose something, and nothing for a change that only opens things up', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    await w.add('Bea');
    await w.add('Ana', 'admin');
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [ada] });
    const closing = await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'none', records: 'all' },
    });
    // Two members lose Companies (and with it its default view, which is shared); the admin is not in the role.
    expect(closing.impact).toEqual({ people: 2, views: 1, forms: 0 });
    // Sales gets it back: nobody loses anything.
    const granting = await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: team(sales.id),
      rule: { level: 'write', records: 'all' },
    });
    expect(granting.impact).toEqual({ people: 0, views: 0, forms: 0 });
    // The Member role getting it back does not cost Ada anything either.
    const reopening = await setObjectAccess(w.owner, { objectId: w.companies, subject: MEMBER, rule: null });
    expect(reopening.impact.people).toBe(0);
    // Taking away what a team grants costs only the team's people, and Ada is the only one who had it.
    await setObjectAccess(w.owner, { objectId: w.companies, subject: MEMBER, rule: { level: 'none', records: 'all' } });
    const removing = await setObjectAccess(w.owner, { objectId: w.companies, subject: team(sales.id), rule: null });
    expect(removing.impact.people).toBe(1);
  });

  it('counts a field hidden from people who could see it', async () => {
    const w = await world();
    await w.add('Ada');
    const description = w.attribute('description');
    const hide = {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'write', records: 'all', fields: { [description]: 'hidden' } },
    } as const;
    const first = await setObjectAccess(w.owner, hide);
    expect(first.impact).toEqual({ people: 1, views: 0, forms: 0 });
    // The same change again takes nothing more away.
    expect((await setObjectAccess(w.owner, hide)).impact.people).toBe(0);
    // Read only counts too: they could change it, and now can't.
    const readOnly = await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'write', records: 'all', fields: { [w.attribute('phone')]: 'read', [description]: 'hidden' } },
    });
    expect(readOnly.impact.people).toBe(1);
  });

  it('narrowing which records counts the people it narrows', async () => {
    const w = await world();
    await w.add('Ada');
    const narrowed = await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'write', records: 'own' },
    });
    expect(narrowed.impact.people).toBe(1);
  });
});

describe('Preview as (AC-858)', () => {
  it('shows an object as a member would see it, through the door, and only to those who set access', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const description = w.attribute('description');
    await w.company('Acme', ada);
    await w.company('Globex', undefined);
    await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: MEMBER,
      rule: { level: 'read', records: 'own', fields: { [description]: 'hidden' } },
    });
    const preview = await previewAccess(w.owner, { objectId: w.companies, as: { type: 'member', memberId: ada } });
    expect(preview.name).toBe('Ada');
    expect(preview.level).toBe('read');
    expect(preview).toMatchObject({ count: 1, atLeast: false });
    expect(preview.fields.map((each) => each.id)).not.toContain(description);
    expect(preview.fields.every((each) => !each.canEdit)).toBe(true);
    // The member may not ask, for themself or anyone.
    expect(
      await refusalOf(
        previewAccess(await w.enter(ada), { objectId: w.companies, as: { type: 'member', memberId: ada } }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
    // It wrote no record, and one audit row.
    const rows = await testQuery<{ n: string }>(
      ownerUrl,
      `select count(*)::text as n from audit_events where workspace_id = $1 and action = 'access.previewed'`,
      [w.workspaceId],
    );
    expect(rows[0]?.n).toBe('1');
  });

  it('previews a team as a Member in it, and refuses a person, team or object of another workspace', async () => {
    const w = await world();
    const other = await world();
    const ada = await w.add('Ada');
    const outsider = await other.add('Zed');
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [ada] });
    await w.company('Acme', ada);
    await setObjectAccess(w.owner, { objectId: w.companies, subject: MEMBER, rule: { level: 'none', records: 'all' } });
    await setObjectAccess(w.owner, {
      objectId: w.companies,
      subject: team(sales.id),
      rule: { level: 'read', records: 'team' },
    });
    const asTeam = await previewAccess(w.owner, { objectId: w.companies, as: { type: 'team', teamId: sales.id } });
    expect(asTeam).toMatchObject({ name: 'Sales', level: 'read', count: 1 });
    // A member outside the team sees nothing: the object is absent, not locked.
    const bea = await w.add('Bea');
    expect(
      await previewAccess(w.owner, { objectId: w.companies, as: { type: 'member', memberId: bea } }),
    ).toMatchObject({ level: 'none', fields: [], count: 0, atLeast: false });
    expect(
      await refusalOf(previewAccess(w.owner, { objectId: w.companies, as: { type: 'member', memberId: outsider } })),
    ).toMatchObject({ code: 'NOT_FOUND' });
    const theirTeam = await createTeam(other.owner, { name: 'Other', memberIds: [] });
    expect(
      await refusalOf(previewAccess(w.owner, { objectId: w.companies, as: { type: 'team', teamId: theirTeam.id } })),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await refusalOf(previewAccess(w.owner, { objectId: other.companies, as: { type: 'member', memberId: ada } })),
    ).toMatchObject({ code: 'NOT_FOUND' });
  });
});
