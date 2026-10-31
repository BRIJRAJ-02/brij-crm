// Likely duplicates (spec 0049, AC-4901 to AC-4903, AC-4908, AC-4920) against
// a real Postgres: the rules per object with their reasons, the one
// normalisation, a dismissed pair gone for everyone and back on Undo, trashed
// and hidden records never suggested, a reader who can't see an attribute
// getting no pair by it, the paged list, and the check and pair reads finding
// keys through `values_match` under row level security.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { defineAttribute } from './definitions.ts';
import { deleteRecord } from './deletion.ts';
import { checkDuplicates, dismissPair, listDuplicatePairs, listDuplicates, restorePair } from './duplicates.ts';
import { newId } from './ids.ts';
import { isRefusal } from './refusals.ts';
import { removeDependents } from './purge-dependents.ts';
import { createRecord, setRecordValues } from './records.ts';
import type { EngineScope } from './scope.ts';
import { createWorkspace } from './workspaces.ts';
import { createAttribute } from '../attributes/attributes.ts';
import { createObject, editObject } from '../objects/objects.ts';
import { checkImportDuplicates } from '../imports/service.ts';
import { rescope, testScope } from '../testing.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-duplicates-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Dupes',
    slug: `dupes-${String(count)}-${String(Date.now())}`,
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
  const people = created.objects.people ?? '';
  const companies = created.objects.companies ?? '';
  const bea = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${bea}, 'Bea', 'bea@example.com', 'member', 'system', 'system')`,
    ),
  );
  const asBea = rescope(scope, { actor: { type: 'member', id: bea }, role: 'member' });
  const company = async (name: string, domains: readonly string[] = []) =>
    (
      await createRecord(scope, {
        objectId: companies,
        values: {
          [id('companies.name')]: name,
          ...(domains.length === 0 ? {} : { [id('companies.domains')]: [...domains] }),
        },
      })
    ).recordId;
  /** A person; emails at example.com, which never file a company (spec 0059). */
  const person = async (first: string, last: string, extra: { companyId?: string; emails?: readonly string[] } = {}) =>
    (
      await createRecord(scope, {
        objectId: people,
        values: {
          [id('people.name')]: { firstName: first, lastName: last },
          ...(extra.emails === undefined ? {} : { [id('people.email_addresses')]: [...extra.emails] }),
          ...(extra.companyId === undefined
            ? {}
            : { [id('people.company')]: { objectId: companies, recordId: extra.companyId } }),
        },
      })
    ).recordId;
  return { scope, asBea, bea, ada: created.memberId, id, people, companies, company, person };
}

/** Each pair as `a:b:reason`, for one object, reading every page. */
async function allPairs(scope: EngineScope, objectId: string, recordId?: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const answer = await listDuplicates(scope, {
      objectId,
      ...(recordId === undefined ? {} : { recordId }),
      ...(cursor === undefined ? {} : { cursor }),
    });
    out.push(...answer.pairs.map((pair) => `${pair.a.recordId}:${pair.b.recordId}:${pair.reason}`));
    cursor = answer.cursor;
    if (cursor === undefined) break;
  }
  return out;
}

describe('the rules (AC-4901, AC-4902)', () => {
  it('pairs people by name and Company, or by a shared email, newest record first', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const globex = await w.company('Globex');
    const jane = await w.person('Jane', 'Doe', { companyId: acme });
    const janeAgain = await w.person('jane', ' DOE. ', { companyId: acme });
    // Same name at another company, or with none: no pair by name.
    await w.person('Jane', 'Doe', { companyId: globex });
    await w.person('Jane', 'Doe');
    const ann = await w.person('Ann', 'Lee', { emails: ['ann@example.com'] });
    expect(await allPairs(w.scope, w.people)).toEqual([`${janeAgain}:${jane}:name_company`]);

    const check = await checkDuplicates(w.scope, {
      objectId: w.people,
      values: {
        [w.id('people.name')]: { fullName: 'Jane Doe' },
        [w.id('people.company')]: { objectId: w.companies, recordId: acme },
      },
      excludeRecordId: jane,
    });
    expect(check.map((match) => [match.record.recordId, match.reason])).toEqual([[janeAgain, 'name_company']]);
    expect(check[0]?.record.name).toBe('jane DOE.');
    // A half typed address checks nothing, and an email alone finds its holder.
    expect(
      await checkDuplicates(w.scope, { objectId: w.people, values: { [w.id('people.email_addresses')]: ['ann@'] } }),
    ).toEqual([]);
    const byEmail = await checkDuplicates(w.scope, {
      objectId: w.people,
      values: { [w.id('people.email_addresses')]: ['ANN@example.com'] },
    });
    // Email addresses is unique on People, so its holder is the one match (AC-4905's hint).
    expect(byEmail.map((match) => [match.record.recordId, match.reason])).toEqual([[ann, 'email']]);
  });

  it('pairs companies by name with a legal suffix dropped', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const acmeInc = await w.company('ACME, Inc.');
    await w.company('Acme Labs');
    expect(await allPairs(w.scope, w.companies)).toEqual([`${acmeInc}:${acme}:name`]);
    // Domains is unique on Companies: the holder is the one match.
    const initech = await w.company('Initech', ['initech.test']);
    const check = await checkDuplicates(w.scope, {
      objectId: w.companies,
      values: { [w.id('companies.domains')]: ['INITECH.test'] },
    });
    expect(check.map((match) => [match.record.recordId, match.reason])).toEqual([[initech, 'domain']]);
  });

  it('pairs a custom object by its name, and follows a new name attribute', async () => {
    const w = await workspace();
    const objectId = (
      await createObject(w.scope, {
        id: newId(),
        singularName: 'Ticket',
        pluralName: 'Tickets',
        icon: 'box',
        hue: 'gray',
      })
    ).id;
    const code = await createAttribute(w.scope, { objectId, id: newId(), title: 'Code', type: 'text' });
    const site = {
      id: (await defineAttribute(w.scope, { objectId, apiSlug: 'site', title: 'Site', type: 'domain' })).attributeId,
    };
    const mail = await createAttribute(w.scope, { objectId, id: newId(), title: 'Mail', type: 'email' });
    const primary = await db.withWorkspace(w.scope.workspaceId, async (tx) => {
      const found = await tx.execute<{ id: string }>(
        sql`select primary_attribute_id::text as id from objects where id = ${objectId}::uuid`,
      );
      return found.rows[0]?.id ?? '';
    });
    const one = (await createRecord(w.scope, { objectId, values: { [primary]: 'Printer jam', [code.id]: 'A1' } }))
      .recordId;
    const two = (await createRecord(w.scope, { objectId, values: { [primary]: 'printer  JAM!', [code.id]: 'B2' } }))
      .recordId;
    const three = (await createRecord(w.scope, { objectId, values: { [primary]: 'Other', [code.id]: 'a1' } })).recordId;
    expect(await allPairs(w.scope, objectId)).toEqual([`${two}:${one}:name`]);
    // Named by Code instead: Printer jam's pair goes, A1 and a1 pair.
    await editObject(w.scope, { objectId, primaryAttributeId: code.id });
    expect(await allPairs(w.scope, objectId)).toEqual([`${three}:${one}:name`]);
    // A shared email or domain pairs too, the strongest reason kept.
    const four = (await createRecord(w.scope, { objectId, values: { [code.id]: 'C3', [site.id]: 'Acme.test' } }))
      .recordId;
    const five = (await createRecord(w.scope, { objectId, values: { [code.id]: 'D4', [site.id]: 'acme.test' } }))
      .recordId;
    const six = (await createRecord(w.scope, { objectId, values: { [code.id]: 'E5', [mail.id]: 'x@example.com' } }))
      .recordId;
    const seven = (await createRecord(w.scope, { objectId, values: { [code.id]: 'F6', [mail.id]: 'X@example.com' } }))
      .recordId;
    expect(await allPairs(w.scope, objectId)).toEqual([
      `${seven}:${six}:email`,
      `${five}:${four}:domain`,
      `${three}:${one}:name`,
    ]);
  });
});

describe('what is never suggested (AC-4903, AC-4920)', () => {
  it('leaves out trashed records and a record outside the reader’s record rule', async () => {
    const w = await workspace();
    const a = await w.company('Hooli');
    const b = await w.company('Hooli');
    const c = await w.company('Hooli');
    await deleteRecord(w.scope, { recordId: c });
    expect(await allPairs(w.scope, w.companies)).toEqual([`${b}:${a}:name`]);
    // Only companies Ada owns: b has no owner, so its pair is absent, never shown as locked.
    await setRecordValues(w.scope, { recordId: b, values: { [w.id('companies.owner')]: { value: null } } });
    await setRecordValues(w.scope, {
      recordId: a,
      values: { [w.id('companies.owner')]: { value: { type: 'member', id: w.ada } } },
    });
    const ruled = rescope(w.scope, {
      rules: {
        levels: [],
        records: [
          {
            subject: { type: 'role', role: 'owner' },
            objectId: w.companies,
            kind: 'own',
            attributeId: w.id('companies.owner'),
          },
        ],
      },
    });
    expect(await allPairs(ruled, w.companies)).toEqual([]);
    expect(
      (await checkDuplicates(ruled, { objectId: w.companies, values: { [w.id('companies.name')]: 'Hooli' } })).map(
        (match) => match.record.recordId,
      ),
    ).toEqual([a]);
    await expect(listDuplicates(ruled, { objectId: w.companies, recordId: b })).rejects.toMatchObject({
      refusal: { code: 'NOT_FOUND' },
    });
  });

  it('gives no pair by an attribute the reader can’t see, and nothing on an object they can’t see', async () => {
    const w = await workspace();
    await w.company('One');
    await w.company('One');
    const hidden = rescope(w.asBea, {
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'attribute', objectId: w.companies, attributeId: w.id('companies.name') },
            level: 'hidden',
          },
        ],
        records: [],
      },
    });
    expect(await allPairs(w.scope, w.companies)).toHaveLength(1);
    expect(await allPairs(hidden, w.companies)).toEqual([]);
    expect(
      await checkDuplicates(hidden, { objectId: w.companies, values: { [w.id('companies.name')]: 'One' } }),
    ).toEqual([]);
    const none = rescope(w.asBea, {
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'object', objectId: w.companies },
            level: 'none',
          },
        ],
        records: [],
      },
    });
    await expect(listDuplicates(none, { objectId: w.companies })).rejects.toMatchObject({
      refusal: { code: 'NOT_FOUND' },
    });
  });
});

describe('Not a duplicate (AC-4908)', () => {
  it('hides the pair for everyone, writes the audit log, and Undo brings it back', async () => {
    const w = await workspace();
    const a = await w.company('Pied Piper');
    const b = await w.company('Pied Piper');
    await dismissPair(w.asBea, { objectId: w.companies, recordIds: [b, a] });
    // Twice is a no op.
    await dismissPair(w.asBea, { objectId: w.companies, recordIds: [a, b] });
    expect(await allPairs(w.scope, w.companies)).toEqual([]);
    expect(await allPairs(w.scope, w.companies, a)).toEqual([]);
    expect(
      await checkDuplicates(w.scope, {
        objectId: w.companies,
        values: { [w.id('companies.name')]: 'pied piper' },
        excludeRecordId: a,
      }),
    ).toEqual([]);
    const audit = await db.withWorkspace(w.scope.workspaceId, (tx) =>
      tx.execute<{ action: string; actor: string }>(
        sql`select action, actor_member_id::text as actor from audit_events where action like 'record.duplicate%' order by at`,
      ),
    );
    expect(audit.rows).toEqual([{ action: 'record.duplicate_dismissed', actor: w.bea }]);
    await restorePair(w.scope, { objectId: w.companies, recordIds: [a, b] });
    expect(await allPairs(w.asBea, w.companies)).toEqual([`${b}:${a}:name`]);
    // A purge takes the dismissal with the record.
    await dismissPair(w.scope, { objectId: w.companies, recordIds: [a, b] });
    const removed = await db.withWorkspace(w.scope.workspaceId, (tx) => removeDependents(tx, [b]));
    expect(removed['duplicate_dismissals']).toBe(1);
  });

  it('refuses a reader who may only read the object, and a pair it can’t see, alike', async () => {
    const w = await workspace();
    const a = await w.company('Vandelay');
    const b = await w.company('Vandelay');
    const readOnly = rescope(w.asBea, {
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'object', objectId: w.companies },
            level: 'read',
          },
        ],
        records: [],
      },
    });
    expect(await allPairs(readOnly, w.companies)).toHaveLength(1);
    await expect(dismissPair(readOnly, { objectId: w.companies, recordIds: [a, b] })).rejects.toMatchObject({
      refusal: { code: 'FORBIDDEN' },
    });
    await expect(dismissPair(w.scope, { objectId: w.companies, recordIds: [a, a] })).rejects.toMatchObject({
      refusal: { code: 'NOT_FOUND' },
    });
    await expect(dismissPair(w.scope, { objectId: w.people, recordIds: [a, b] })).rejects.toMatchObject({
      refusal: { code: 'NOT_FOUND' },
    });
  });
});

describe('a taken email (AC-4905)', () => {
  it('names the holder only to a writer who can see it', async () => {
    const w = await workspace();
    const jane = await w.person('Jane', 'Doe', { emails: ['jane@example.com'] });
    const refused = await createRecord(w.scope, {
      objectId: w.people,
      values: { [w.id('people.name')]: { firstName: 'J' }, [w.id('people.email_addresses')]: ['Jane@example.com'] },
    }).catch((error: unknown) => error);
    expect(refused).toMatchObject({
      refusal: {
        code: 'UNIQUE_CONFLICT',
        message: 'jane@example.com belongs to Jane Doe.',
        holder: { recordId: jane, objectId: w.people, name: 'Jane Doe' },
      },
    });
    // Outside the writer's record rule: the refusal stays, naming nothing.
    await setRecordValues(w.scope, { recordId: jane, values: { [w.id('people.owner')]: { value: null } } });
    const ruled = rescope(w.scope, {
      rules: {
        levels: [],
        records: [
          {
            subject: { type: 'role', role: 'owner' },
            objectId: w.people,
            kind: 'own',
            attributeId: w.id('people.owner'),
          },
        ],
      },
    });
    const hidden = await createRecord(ruled, {
      objectId: w.people,
      values: { [w.id('people.name')]: { firstName: 'J' }, [w.id('people.email_addresses')]: ['jane@example.com'] },
    }).catch((error: unknown) => error);
    expect(hidden).toMatchObject({ refusal: { code: 'UNIQUE_CONFLICT' } });
    expect(isRefusal(hidden) ? hidden.refusal.holder : 'not a refusal').toBeUndefined();
    expect(JSON.stringify(hidden)).not.toContain('Jane Doe');
  });
});

describe('an import’s preview (AC-4918)', () => {
  it('names the record a create row looks like by the name rules, and nothing else', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const jane = await w.person('Jane', 'Doe', { companyId: acme });
    await w.company('Globex');
    const people = await checkImportDuplicates(w.scope, {
      objectId: w.people,
      rows: [
        { name: { fullName: 'jane doe' }, company: 'acme' },
        { name: { fullName: 'Jane Doe' }, company: 'Globex' },
        { name: { fullName: 'Jane Doe' } },
        { name: { fullName: 'Someone Else' }, company: 'Acme' },
      ],
    });
    expect(people.map((match) => match?.recordId)).toEqual([jane, undefined, undefined, undefined]);
    expect(people[0]?.name).toBe('Jane Doe');
    const companies = await checkImportDuplicates(w.scope, {
      objectId: w.companies,
      rows: [{ name: 'ACME LLC' }, { name: 'Initech' }],
    });
    expect(companies.map((match) => match?.recordId)).toEqual([acme, undefined]);
  });
});

describe('paging (AC-4907)', () => {
  it('pages by cursor with no pair twice, and a record in several pairs shows in each', async () => {
    const w = await workspace();
    const made: string[] = [];
    for (let index = 0; index < 4; index += 1) made.push(await w.company('Soylent'));
    const pairs = await allPairs(w.scope, w.companies);
    expect(pairs).toHaveLength(6);
    expect(new Set(pairs).size).toBe(6);
    expect(pairs[0]?.startsWith(made[3] ?? '-')).toBe(true);
    const one = await allPairs(w.scope, w.companies, made[0]);
    expect(one).toHaveLength(3);
    await expect(listDuplicates(w.scope, { objectId: w.companies, cursor: 'nope' })).rejects.toMatchObject({
      inputProblem: { field: 'cursor' },
    });
  });
});

describe('the scale budget', () => {
  it('finds keys through values_match, never a scan of every value, as the app role', async () => {
    const w = await workspace();
    await w.company('Umbrella');
    await w.company('Umbrella');
    const plan = await db.withWorkspace(w.scope.workspaceId, async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      await listDuplicatePairs(tx, w.scope, { objectId: w.companies });
      const explained = await tx.execute<{ 'QUERY PLAN': string }>(sql`
        explain select v.owner_id from "values" v
        where v.attribute_id = ${w.id('companies.name')}::uuid and v.active_until is null
          and v.match_key = ${'umbrella'}
      `);
      return explained.rows.map((row) => row['QUERY PLAN']).join('\n');
    });
    expect(plan).toContain('values_match');
    expect(plan).not.toContain('Seq Scan');
  });
});
