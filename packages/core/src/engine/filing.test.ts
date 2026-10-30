// Company from email domain (spec 0059, AC-5911 to AC-5919) against a real
// Postgres: a person written with a work email and no Company is linked to
// the company holding the domain, or a company made from it, in the person's
// own write; free mail never files, a Company set is never replaced, two
// writes for one new domain make one company, and an actor who can't link or
// create files nothing while their write still lands.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { companyNameOf, filingDomains, registrableDomain } from './filing.ts';
import { newId } from './ids.ts';
import { createRecord, setRecordValues, setValuesBatch } from './records.ts';
import type { Change } from './write.ts';
import { createWorkspace } from './workspaces.ts';
import { rescope, testScope } from '../testing.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-filing-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Filing',
    slug: `filing-${String(count)}-${String(Date.now())}`,
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
  const memberId = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${memberId}, 'Bea', 'bea@example.com', 'member', 'system', 'system')`,
    ),
  );

  /** A person with these emails (and any other values); the create's answer. */
  const person = (emails: readonly string[], values: Readonly<Record<string, unknown>> = {}, as = scope) =>
    createRecord(as, {
      objectId: people,
      values: {
        [id('people.name')]: { firstName: 'Jane' },
        ...(emails.length === 0 ? {} : { [id('people.email_addresses')]: [...emails] }),
        ...values,
      },
    });
  /** A company holding these domains. */
  const company = async (name: string, domains: readonly string[]) =>
    (
      await createRecord(scope, {
        objectId: companies,
        values: { [id('companies.name')]: name, [id('companies.domains')]: [...domains] },
      })
    ).recordId;
  /** The live companies holding `domain`, with their names and owners. */
  const holders = (domain: string) =>
    db.withWorkspace(scope.workspaceId, async (tx) => {
      const found = await tx.execute<{ id: string; name: string | null; owner: string | null }>(sql`
        select r.id::text,
          (select text_value from "values" n where n.owner_id = r.id and n.attribute_id = ${id('companies.name')}::uuid
            and n.active_until is null) as name,
          (select actor_id::text from "values" o where o.owner_id = r.id and o.attribute_id = ${id('companies.owner')}::uuid
            and o.active_until is null) as owner
        from records r join "values" d on d.record_id = r.id
        where r.object_id = ${companies}::uuid and r.deleted_at is null and d.attribute_id = ${id('companies.domains')}::uuid
          and d.active_until is null and d.text_value = ${domain}
      `);
      return found.rows;
    });
  /** The company a person links now, if any. */
  const linked = (personId: string) =>
    db.withWorkspace(scope.workspaceId, async (tx) => {
      const found = await tx.execute<{ far: string }>(sql`
        select (case when l.from_record_id = ${personId}::uuid then l.to_record_id else l.from_record_id end)::text as far
        from record_links l join attributes a on a.relationship_id = l.relationship_id
        where a.id = ${id('people.company')}::uuid and l.active_until is null
          and (l.from_record_id = ${personId}::uuid or l.to_record_id = ${personId}::uuid)
      `);
      return found.rows.map((row) => row.far);
    });
  const companiesCount = () =>
    db.withWorkspace(scope.workspaceId, async (tx) => {
      const found = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from records where object_id = ${companies}::uuid and deleted_at is null`,
      );
      return found.rows[0]?.n ?? 0;
    });
  return {
    scope,
    ownerId: created.memberId,
    memberId,
    people,
    companies,
    id,
    person,
    company,
    holders,
    linked,
    companiesCount,
  };
}

describe('the domain an email files by (AC-5912 to AC-5914)', () => {
  it('reads the registrable domain from a host', () => {
    expect(registrableDomain('acme.com')).toBe('acme.com');
    expect(registrableDomain('eu.acme.com')).toBe('acme.com');
    expect(registrableDomain('mail.big-corp.co.uk')).toBe('big-corp.co.uk');
    expect(registrableDomain('shop.acme.com.au')).toBe('acme.com.au');
    // A second level under a long suffix is just a subdomain.
    expect(registrableDomain('co.acme.io')).toBe('acme.io');
  });

  it('names a company from its domain', () => {
    expect(companyNameOf('acme.com')).toBe('Acme');
    expect(companyNameOf('big-corp.co.uk')).toBe('Big Corp');
    expect(companyNameOf('north_wind.io')).toBe('North Wind');
  });

  it('skips free mail by the workspace domain list, country domains included', () => {
    expect(filingDomains('sam@gmail.com')).toBeUndefined();
    expect(filingDomains('lea@hotmail.se')).toBeUndefined();
    expect(filingDomains('ana@yahoo.com.mx')).toBeUndefined();
    expect(filingDomains('not an email')).toBeUndefined();
    expect(filingDomains('bob@eu.acme.com')).toEqual({ host: 'eu.acme.com', registrable: 'acme.com' });
  });
});

describe('filing a person under their company (AC-5911, AC-5913)', () => {
  it('makes the company when none holds the domain, names it, owns it and links it in the same write', async () => {
    const w = await workspace();
    const changes: Change[] = [];
    const made = await createRecord(
      w.scope,
      {
        objectId: w.people,
        values: { [w.id('people.name')]: { firstName: 'Jane' }, [w.id('people.email_addresses')]: ['jane@acme.com'] },
      },
      [
        (change) => {
          changes.push(change);
          return Promise.resolve();
        },
      ],
    );
    const [acme] = await w.holders('acme.com');
    expect(acme).toEqual({ id: expect.any(String) as string, name: 'Acme', owner: w.ownerId });
    expect(made.filedCompany).toEqual({
      objectId: w.companies,
      recordId: acme?.id,
      name: 'Acme',
      made: true,
      attributeId: w.id('people.company'),
      linkVersionId: expect.any(String) as string,
    });
    expect(await w.linked(made.recordId)).toEqual([acme?.id]);
    // One write: the hooks see the person, the company and the link (AC-5918).
    expect(changes).toHaveLength(1);
    expect(changes[0]?.createdRecords.map((each) => each.objectId).sort()).toEqual([w.companies, w.people].sort());
    expect(changes[0]?.values.some((value) => value.attributeId === w.id('people.company'))).toBe(true);
  });

  it('files on an edit that gives a person a work email, and leaves the name empty when it is not text', async () => {
    const w = await workspace();
    const { recordId } = await w.person([]);
    const edited = await setRecordValues(w.scope, {
      recordId,
      values: { [w.id('people.email_addresses')]: { value: ['jo@northwind.io'] } },
    });
    expect(edited.filedCompany).toMatchObject({ name: 'Northwind', made: true });
    expect((await w.holders('northwind.io')).map((each) => each.id)).toEqual(await w.linked(recordId));
    // An edit that leaves the emails alone files nothing, even with Company cleared.
    const other = await w.person([]);
    const untouched = await setRecordValues(w.scope, {
      recordId: other.recordId,
      values: { [w.id('people.name')]: { value: { firstName: 'Kim' } } },
    });
    expect(untouched.filedCompany).toBeUndefined();
  });

  it('files each record of a batch on its own', async () => {
    const w = await workspace();
    const a = await w.person([]);
    const b = await w.person([]);
    const outcomes = await setValuesBatch(w.scope, {
      items: [
        { recordId: a.recordId, values: { [w.id('people.email_addresses')]: { value: ['a@initech.com'] } } },
        { recordId: b.recordId, values: { [w.id('people.email_addresses')]: { value: ['b@initech.com'] } } },
      ],
    });
    const [initech] = await w.holders('initech.com');
    expect(outcomes.map((each) => (each.ok ? each.filedCompany?.made : undefined))).toEqual([true, false]);
    expect(await w.linked(a.recordId)).toEqual([initech?.id]);
    expect(await w.linked(b.recordId)).toEqual([initech?.id]);
  });
});

describe('matching an existing company (AC-5912)', () => {
  it('tries the host first, then the registrable domain, and makes nothing', async () => {
    const w = await workspace();
    const acme = await w.company('Acme', ['acme.com']);
    const europe = await w.company('Acme Europe', ['eu.acme.com']);
    const bob = await w.person(['bob@eu.acme.com']);
    const ann = await w.person(['ann@us.acme.com']);
    expect(bob.filedCompany).toMatchObject({ recordId: europe, name: 'Acme Europe', made: false });
    expect(ann.filedCompany).toMatchObject({ recordId: acme, made: false });
    expect(await w.companiesCount()).toBe(2);
  });

  it('makes a company holding the registrable domain, which the next subdomain matches', async () => {
    const w = await workspace();
    const first = await w.person(['ops@eu.globex.co.uk']);
    const [globex] = await w.holders('globex.co.uk');
    expect(first.filedCompany).toMatchObject({ recordId: globex?.id, name: 'Globex', made: true });
    const second = await w.person(['hr@us.globex.co.uk']);
    expect(second.filedCompany).toMatchObject({ recordId: globex?.id, made: false });
  });
});

describe('what never files (AC-5914, AC-5915)', () => {
  it('skips free mail and takes the first work address', async () => {
    const w = await workspace();
    const sam = await w.person(['sam@gmail.com']);
    const lea = await w.person(['lea@hotmail.se']);
    expect(sam.filedCompany).toBeUndefined();
    expect(lea.filedCompany).toBeUndefined();
    expect(await w.companiesCount()).toBe(0);
    const both = await w.person(['kim@gmail.com', 'kim@umbrella.com']);
    expect(both.filedCompany).toMatchObject({ name: 'Umbrella', made: true });
  });

  it('never replaces a Company someone set, and never unlinks on an email change', async () => {
    const w = await workspace();
    const initech = await w.company('Initech', ['initech.com']);
    const kept = await w.person(['pat@acme.com'], {
      [w.id('people.company')]: { objectId: w.companies, recordId: initech },
    });
    expect(kept.filedCompany).toBeUndefined();
    expect(await w.linked(kept.recordId)).toEqual([initech]);
    expect(await w.holders('acme.com')).toEqual([]);

    const filed = await w.person(['lou@hooli.com']);
    const hooli = filed.filedCompany?.recordId;
    await setRecordValues(w.scope, {
      recordId: filed.recordId,
      values: { [w.id('people.email_addresses')]: { value: ['lou@gmail.com'] } },
    });
    expect(await w.linked(filed.recordId)).toEqual([hooli]);
  });
});

describe('two writes for one new domain (AC-5917)', () => {
  it('make one company and link both people to it', async () => {
    const w = await workspace();
    const second = rescope(w.scope, { actor: { type: 'member', id: w.memberId }, role: 'member' });
    const [a, b] = await Promise.all([w.person(['a@newco.io']), w.person(['b@newco.io'], {}, second)]);
    const found = await w.holders('newco.io');
    expect(found).toHaveLength(1);
    expect(await w.linked(a.recordId)).toEqual([found[0]?.id]);
    expect(await w.linked(b.recordId)).toEqual([found[0]?.id]);
    expect([a.filedCompany?.made, b.filedCompany?.made].sort()).toEqual([false, true]);
  });
});

describe('filing with the actor’s own access (AC-5919)', () => {
  it('files nothing for an actor who may not create companies, and their person still lands', async () => {
    const w = await workspace();
    const reader = rescope(w.scope, {
      actor: { type: 'member', id: w.memberId },
      role: 'member',
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
    const made = await w.person(['ann@newco.io'], {}, reader);
    expect(made.filedCompany).toBeUndefined();
    expect(await w.companiesCount()).toBe(0);
    // Linking an existing company needs only read on it.
    await w.company('Newco', ['newco.io']);
    const linked = await w.person(['ben@newco.io'], {}, reader);
    expect(linked.filedCompany).toMatchObject({ name: 'Newco', made: false });
  });

  it('files nothing when the actor cannot see Companies, or cannot change Company', async () => {
    const w = await workspace();
    await w.company('Newco', ['newco.io']);
    const blind = rescope(w.scope, {
      actor: { type: 'member', id: w.memberId },
      role: 'member',
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
    const unseen = await w.person(['cal@newco.io'], {}, blind);
    expect(unseen.filedCompany).toBeUndefined();
    expect(await w.linked(unseen.recordId)).toEqual([]);

    const fixed = rescope(w.scope, {
      actor: { type: 'member', id: w.memberId },
      role: 'member',
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'attribute', objectId: w.people, attributeId: w.id('people.company') },
            level: 'read',
          },
        ],
        records: [],
      },
    });
    const readOnly = await w.person(['dee@umbrella.com'], {}, fixed);
    expect(readOnly.filedCompany).toBeUndefined();
    expect(await w.holders('umbrella.com')).toEqual([]);
  });

  it('files nothing when the company would pass the record limit, and the person still lands', async () => {
    const w = await workspace();
    const full = await db.withWorkspace(w.scope.workspaceId, async (tx) => {
      const found = await tx.execute<{ n: number }>(sql`select live_records::int as n from workspace_counters`);
      return found.rows[0]?.n ?? 0;
    });
    const tight = rescope(w.scope, { limits: { liveRecords: full + 1 } });
    const made = await w.person(['eve@soylent.com'], {}, tight);
    expect(made.filedCompany).toBeUndefined();
    expect(await w.companiesCount()).toBe(0);
  });
});
