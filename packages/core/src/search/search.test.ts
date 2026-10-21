// The command menu's search and recent items (spec 0039) against a real
// Postgres: what each length of query finds and in what order, typo matches,
// views, and that hidden means absent (an object at none, a hidden field, a
// record outside a rule, a trashed record, another member's private view, a
// second workspace with the same names).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { AccessRules } from '../access/policy.ts';
import { newId } from '../engine/ids.ts';
import { deleteRecord } from '../engine/deletion.ts';
import { createRecord } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { removeMember } from '../members/members.ts';
import { rescope, testScope } from '../testing.ts';
import { createView, deleteView } from '../views/manage.ts';
import { listRecents, RECENTS_KEPT, visitRecent } from './recents.ts';
import { globalSearchMode, searchWorkspace, wantsSimilar } from './search.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-search-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
/** A workspace with Acme Inc, Ada at acme.com, a shared "Acme deals" view, and a second member, Bea. */
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Search',
    slug: `search-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Owen', email: 'owen@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const rows = await db.withWorkspace(owner.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  const ids = Object.fromEntries(rows.rows.map((row) => [row.slug, row.id]));
  const attribute = (slug: string): string => ids[slug] ?? '';
  const bea = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${bea}, 'Bea', 'bea@example.com', 'member', 'system', 'system')`,
    ),
  );
  const people = created.objects.people ?? '';
  const companies = created.objects.companies ?? '';
  const deals = created.objects.deals ?? '';
  const person = async (firstName: string, emails: readonly string[] = []) =>
    (
      await createRecord(owner, {
        objectId: people,
        values: {
          [attribute('people.name')]: { firstName },
          ...(emails.length === 0 ? {} : { [attribute('people.email_addresses')]: [...emails] }),
        },
      })
    ).recordId;
  const company = async (name: string, domains: readonly string[] = []) =>
    (
      await createRecord(owner, {
        objectId: companies,
        values: {
          [attribute('companies.name')]: name,
          ...(domains.length === 0 ? {} : { [attribute('companies.domains')]: [...domains] }),
        },
      })
    ).recordId;
  const view = async (name: string, objectId: string, visibility: 'workspace' | 'private', as = owner) =>
    (
      await createView(as, {
        id: newId(),
        objectId,
        name,
        kind: 'table',
        visibility,
        config: { columns: [], showNewAttributes: false, pinnedCount: 1, sorts: [] },
      })
    ).id;
  const as = (memberId: string, rules?: AccessRules) =>
    rescope(owner, { actor: { type: 'member', id: memberId }, role: 'member', ...(rules ? { rules } : {}) });
  const acme = await company('Acme Inc', ['acmecorp.io']);
  const ada = await person('Ada', ['ada@acme.com']);
  const acmeDeals = await view('Acme deals', deals, 'workspace');
  return {
    ...created,
    owner,
    bea,
    as,
    attribute,
    people,
    companies,
    deals,
    person,
    company,
    view,
    acme,
    ada,
    acmeDeals,
  };
}

const recordIds = (found: Awaited<ReturnType<typeof searchWorkspace>>) => found.records.map((hit) => hit.ref.recordId);

describe('which search runs (AC-1078)', () => {
  it('is none when blank, a prefix for 1 or 2 characters, else contains', () => {
    expect(globalSearchMode('  ')).toBe('none');
    expect(globalSearchMode('a')).toBe('prefix');
    expect(globalSearchMode(' ac ')).toBe('prefix');
    expect(globalSearchMode('acm')).toBe('contains');
  });

  it('looks for close names from 4 characters with a trigram in them, only when fewer than the limit matched', () => {
    expect(wantsSimilar('acm', 0)).toBe(false);
    expect(wantsSimilar('acme', 0)).toBe(true);
    expect(wantsSimilar('a.b.', 0)).toBe(false);
    expect(wantsSimilar('acme', 19)).toBe(true);
    expect(wantsSimilar('acme', 20)).toBe(false);
    expect(wantsSimilar('acme', 4, 5)).toBe(true);
  });
});

describe('searching (AC-1078 to AC-1081, AC-1084)', () => {
  it('finds a company by name, a person by email and a view by name, with each record’s second line', async () => {
    const w = await world();
    const found = await searchWorkspace(w.owner, { query: 'acme' });
    expect(recordIds(found)).toEqual([w.acme, w.ada]);
    expect(found.records[0]).toMatchObject({ match: 'prefix', detail: 'acmecorp.io', ref: { name: 'Acme Inc' } });
    expect(found.records[1]).toMatchObject({ match: 'contains', detail: 'ada@acme.com', ref: { name: 'Ada' } });
    expect(found.views).toEqual([
      { id: w.acmeDeals, objectId: w.deals, name: 'Acme deals', kind: 'table', isDefault: false },
    ]);
  });

  it('answers nothing for a blank query', async () => {
    const w = await world();
    expect(await searchWorkspace(w.owner, { query: '   ' })).toEqual({ records: [], views: [] });
  });

  it('matches names starting with 1 or 2 characters only, across objects, by name', async () => {
    const w = await world();
    const acorn = await w.person('Acorn');
    await w.company('Tacos');
    const found = await searchWorkspace(w.owner, { query: 'ac' });
    expect(recordIds(found)).toEqual([w.acme, acorn]);
    expect(found.records.every((hit) => hit.match === 'prefix')).toBe(true);
  });

  it('ranks names starting with the text, then a word starting with it, then the rest, each by name', async () => {
    const w = await world();
    const word = await w.company('Big Acme');
    const inside = await w.company('Tacme Labs');
    const found = await searchWorkspace(w.owner, { query: 'acme' });
    expect(recordIds(found)).toEqual([w.acme, word, w.ada, inside]);
    expect(found.records.map((hit) => hit.match)).toEqual(['prefix', 'word', 'contains', 'contains']);
  });

  it('adds close names after the exact ones (a typo), from 4 characters', async () => {
    const w = await world();
    const found = await searchWorkspace(w.owner, { query: 'acmee' });
    expect(recordIds(found)).toContain(w.acme);
    expect(found.records.find((hit) => hit.ref.recordId === w.acme)?.match).toBe('similar');
    // Three characters never look for close names.
    expect(recordIds(await searchWorkspace(w.owner, { query: 'acx' }))).toEqual([]);
  });

  it('keeps to the limit, and finds a record renamed a moment ago', async () => {
    const w = await world();
    for (const n of [1, 2, 3]) await w.company(`Acme ${String(n)}`);
    expect((await searchWorkspace(w.owner, { query: 'acme', limit: 2 })).records).toHaveLength(2);
    const fresh = await w.company('Zephyr');
    expect(recordIds(await searchWorkspace(w.owner, { query: 'zeph' }))).toEqual([fresh]);
  });

  it('puts an object’s default view first among views', async () => {
    const w = await world();
    const found = await searchWorkspace(w.owner, { query: 'all' });
    const defaults = found.views.filter((view) => view.isDefault);
    expect(defaults.length).toBeGreaterThan(0);
    expect(found.views.slice(0, defaults.length).every((view) => view.isDefault)).toBe(true);
  });
});

describe('hidden means absent (AC-1089, AC-1090)', () => {
  it('leaves out an object at none, a hidden email field, records outside a rule, and the trash', async () => {
    const w = await world();
    const gone = await w.company('Acme Gone');
    await deleteRecord(w.owner, { recordId: gone });
    const rules: AccessRules = {
      levels: [
        { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: w.deals }, level: 'none' },
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'attribute', objectId: w.people, attributeId: w.attribute('people.email_addresses') },
          level: 'hidden',
        },
      ],
      records: [
        {
          subject: { type: 'role', role: 'member' },
          objectId: w.companies,
          kind: 'own',
          attributeId: w.attribute('companies.owner'),
        },
      ],
    };
    const bea = w.as(w.bea, rules);
    const asBea = await searchWorkspace(bea, { query: 'acme' });
    // Acme Inc is the owner's (outside Bea's rule), Ada matched on a hidden email, the view is on Deals (none).
    expect(asBea).toEqual({ records: [], views: [] });
    expect(await searchWorkspace(bea, { query: 'acme.com' })).toEqual({ records: [], views: [] });
    // An exact hidden name answers just as nothing does.
    expect(await searchWorkspace(bea, { query: 'Acme Inc' })).toEqual(
      await searchWorkspace(bea, { query: 'Qqqqq Zzzz' }),
    );
    // The owner sees everything but the trash.
    expect(recordIds(await searchWorkspace(w.owner, { query: 'acme' }))).not.toContain(gone);
    // Ada is still found by name when her email is hidden, with no second line.
    const byName = await searchWorkspace(bea, { query: 'ada' });
    expect(recordIds(byName)).toEqual([w.ada]);
    expect(byName.records[0]?.detail).toBeUndefined();
  });

  it('shows a member their own private views and never another’s', async () => {
    const w = await world();
    const bea = w.as(w.bea);
    const mine = await w.view('Acme private', w.deals, 'private', bea);
    const theirs = await w.view('Acme secret', w.deals, 'private');
    const seen = (await searchWorkspace(bea, { query: 'acme' })).views.map((view) => view.id);
    expect(seen).toContain(mine);
    expect(seen).not.toContain(theirs);
  });

  it('never searches a hidden name: no prefix, contains or typo match on it, and the domain still finds it unnamed', async () => {
    const w = await world();
    const bea = w.as(w.bea, {
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'attribute', objectId: w.companies, attributeId: w.attribute('companies.name') },
          level: 'hidden',
        },
      ],
      records: [],
    });
    // The domain (acmecorp.io) still contains “acme”, so these reach the name alone.
    for (const query of ['ac', 'acmee', 'Acme Inc']) {
      expect(recordIds(await searchWorkspace(bea, { query })), query).not.toContain(w.acme);
    }
    const byDomain = await searchWorkspace(bea, { query: 'acmecorp' });
    expect(recordIds(byDomain)).toEqual([w.acme]);
    expect(byDomain.records[0]?.ref.name).toBe('Unnamed company');
  });

  it('keeps a member’s own match when many records outside their rule match too', async () => {
    const w = await world();
    for (let n = 0; n < 30; n += 1) await w.company(`Acme ${String(n)}`);
    const bea = w.as(w.bea, {
      levels: [],
      records: [
        {
          subject: { type: 'role', role: 'member' },
          objectId: w.companies,
          kind: 'own',
          attributeId: w.attribute('companies.owner'),
        },
      ],
    });
    const hers = (
      await createRecord(bea, {
        objectId: w.companies,
        values: {
          [w.attribute('companies.name')]: 'Acme Bea',
          [w.attribute('companies.owner')]: { type: 'member', id: w.bea },
        },
      })
    ).recordId;
    expect(recordIds(await searchWorkspace(bea, { query: 'acme' }))).toEqual([hers, w.ada]);
  });

  it('never finds another workspace’s records or views, with the same names', async () => {
    const one = await world();
    const two = await world();
    const found = await searchWorkspace(one.owner, { query: 'acme' });
    expect(recordIds(found)).toEqual([one.acme, one.ada]);
    expect(found.views.map((view) => view.id)).toEqual([one.acmeDeals]);
    expect(recordIds(await searchWorkspace(two.owner, { query: 'acmee' }))).toEqual([two.acme]);
    // The typo function itself, in one workspace, answers nothing for the other's name attribute.
    const across = await db.withWorkspace(one.workspaceId, (tx) =>
      tx.execute(sql`select * from crm_search_similar(array[${two.attribute('companies.name')}::uuid], 'acmee', 10)`),
    );
    expect(across.rows).toEqual([]);
  });
});

describe('recent items (AC-1076, AC-1088, AC-1091, AC-1092)', () => {
  it('lists what was opened, newest first, and a revisit moves it to the top', async () => {
    const w = await world();
    await visitRecent(w.owner, { kind: 'record', id: w.acme });
    await visitRecent(w.owner, { kind: 'view', id: w.acmeDeals });
    await visitRecent(w.owner, { kind: 'record', id: w.ada });
    await visitRecent(w.owner, { kind: 'record', id: w.acme });
    const items = await listRecents(w.owner);
    expect(items.map((item) => (item.kind === 'record' ? item.ref.recordId : item.view.id))).toEqual([
      w.acme,
      w.ada,
      w.acmeDeals,
    ]);
    // Each member's own: Bea has none.
    expect(await listRecents(w.as(w.bea))).toEqual([]);
  });

  it('keeps at most 20 per member', async () => {
    const w = await world();
    for (let n = 0; n < RECENTS_KEPT + 2; n += 1) {
      await visitRecent(w.owner, { kind: 'record', id: await w.company(`Firm ${String(n)}`) });
    }
    const count = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from member_recents where member_id = ${w.memberId}`),
    );
    expect(count.rows[0]?.n).toBe(RECENTS_KEPT);
  });

  it('quietly keeps nothing the caller can’t see, nor a malformed or unknown id', async () => {
    const w = await world();
    const rules: AccessRules = {
      levels: [
        { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: w.deals }, level: 'none' },
      ],
      records: [
        {
          subject: { type: 'role', role: 'member' },
          objectId: w.companies,
          kind: 'own',
          attributeId: w.attribute('companies.owner'),
        },
      ],
    };
    const bea = w.as(w.bea, rules);
    await expect(visitRecent(bea, { kind: 'record', id: w.acme })).resolves.toBeUndefined();
    await expect(visitRecent(bea, { kind: 'view', id: w.acmeDeals })).resolves.toBeUndefined();
    await expect(visitRecent(bea, { kind: 'record', id: newId() })).resolves.toBeUndefined();
    await expect(visitRecent(bea, { kind: 'record', id: 'not an id' })).resolves.toBeUndefined();
    const theirs = await w.view('Owner only', w.people, 'private');
    await expect(visitRecent(bea, { kind: 'view', id: theirs })).resolves.toBeUndefined();
    expect(await listRecents(w.as(w.bea))).toEqual([]);
  });

  it('drops an item the member can no longer see, a trashed record, and a deleted view', async () => {
    const w = await world();
    const bea = w.as(w.bea);
    const doomed = await w.view('Doomed', w.people, 'workspace');
    await visitRecent(bea, { kind: 'record', id: w.acme });
    await visitRecent(bea, { kind: 'record', id: w.ada });
    await visitRecent(bea, { kind: 'view', id: doomed });
    await visitRecent(bea, { kind: 'view', id: w.acmeDeals });
    await deleteRecord(w.owner, { recordId: w.ada });
    await deleteView(w.owner, { viewId: doomed });
    const hidden = w.as(w.bea, {
      levels: [
        { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: w.deals }, level: 'none' },
      ],
      records: [],
    });
    const items = await listRecents(hidden);
    expect(items.map((item) => (item.kind === 'record' ? item.ref.recordId : item.view.id))).toEqual([w.acme]);
    const left = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ id: string }>(sql`select target_id::text as id from member_recents where target_id = ${doomed}`),
    );
    expect(left.rows).toEqual([]);
  });

  it('goes with a removed member', async () => {
    const w = await world();
    await visitRecent(w.as(w.bea), { kind: 'record', id: w.acme });
    await removeMember(w.owner, { memberId: w.bea });
    const left = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from member_recents where member_id = ${w.bea}`),
    );
    expect(left.rows[0]?.n).toBe(0);
  });

  it('keeps nothing for an API key, and lists none', async () => {
    const w = await world();
    const key = rescope(w.owner, { actor: { type: 'api_key', id: newId() } });
    await visitRecent(key, { kind: 'record', id: w.acme });
    expect(await listRecents(key)).toEqual([]);
  });
});
