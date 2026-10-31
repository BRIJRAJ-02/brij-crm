// A company's logo (spec 0059, AC-5901, AC-5902, AC-5906, AC-5907). The address: only a public host name, written
// one way, ever has one. The display, against a real Postgres as the app role: a company's picture names its first
// domain, for a full read and one that asked for no attributes alike, follows a change of that domain, is absent
// for a reader a field rule hides Domains from, and costs no statement of its own.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { recordStatements } from '@crm/db/testing';
import type { AccessRules } from '../access/policy.ts';
import type { EngineScope } from '../access/mint.ts';
import { testScope } from '../testing.ts';
import { archiveAttribute, restoreAttribute } from './definitions.ts';
import { newId } from './ids.ts';
import { companyLogoPath, isLogoDomain, LOGO_PATH } from './logos.ts';
import { createRecord, getRecords, setValues } from './records.ts';
import { createWorkspace } from './workspaces.ts';

describe('isLogoDomain', () => {
  it('takes a public host name, an international one as xn--, and a deep one', () => {
    for (const domain of [
      'acme.com',
      'eu.acme.co.uk',
      'big-corp.io',
      'xn--bcher-kva.de',
      'a.b.c.d.example-shop.store',
    ]) {
      expect(isLogoDomain(domain), domain).toBe(true);
    }
  });

  it('refuses anything that is not one public host name, written as the display writes it', () => {
    for (const domain of [
      '',
      'localhost',
      'acme',
      'Acme.com',
      'acme.com.',
      '.acme.com',
      'acme..com',
      '-acme.com',
      'acme-.com',
      'acme.com:443',
      'user@acme.com',
      'acme.com/path',
      'acme.com?x=1',
      'acme_corp.com',
      '10.0.0.1',
      '127.0.0.1',
      '[::1]',
      '::1',
      '1.2.3.4.5',
      'acme.c',
      'acme.123',
      `${'a'.repeat(64)}.com`,
      `${'a.'.repeat(126)}com`,
    ]) {
      expect(isLogoDomain(domain), domain).toBe(false);
    }
  });

  it('refuses the names kept for private and special use', () => {
    for (const domain of [
      'printer.local',
      'db.internal',
      'app.localhost',
      'shop.test',
      'nas.home',
      'x.example',
      'y.onion',
    ]) {
      expect(isLogoDomain(domain), domain).toBe(false);
    }
  });
});

describe('companyLogoPath', () => {
  it('names the domain, so another first domain is another picture', () => {
    expect(companyLogoPath('acme.com')).toBe(`${LOGO_PATH}acme.com`);
    expect(companyLogoPath('acme.io')).toBe('/api/logos/acme.io');
    // Stored domains are lowercase already; one that isn't still reads as the same path.
    expect(companyLogoPath(' ACME.com ')).toBe('/api/logos/acme.com');
  });

  it('gives nothing for a domain that can have no logo', () => {
    expect(companyLogoPath('10.0.0.1')).toBeUndefined();
    expect(companyLogoPath('intranet.local')).toBeUndefined();
  });
});

const { appUrl } = inject('testDatabase');
let db: Database;
/** The owner, on the open policy. */
let owner: EngineScope;
/** A member a field rule hides Companies › Domains from. */
let hidden: EngineScope;
const ids: Record<string, string> = {};
const id = (key: string): string => {
  const value = ids[key];
  if (value === undefined) throw new Error(`No ${key}.`);
  return value;
};

/** A company named `name` holding `domains`, made by the owner. */
async function company(name: string, domains: readonly string[]): Promise<string> {
  const values = {
    [id('companies.name')]: name,
    ...(domains.length === 0 ? {} : { [id('companies.domains')]: [...domains] }),
  };
  return (await createRecord(owner, { objectId: id('companies'), values })).recordId;
}

/** The display a reader gets for `recordId`, from a full read and from one asking for no attributes. */
async function displays(scope: EngineScope, recordId: string) {
  const [full] = await getRecords(scope, { ids: [recordId] });
  const [bare] = await getRecords(scope, { ids: [recordId], attributeIds: [] });
  return { full: full?.display, bare: bare?.display, values: full?.values };
}

beforeAll(async () => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-logo-tests' });
  const created = await createWorkspace(db, {
    name: 'Logos',
    slug: `logos-${String(Date.now())}`,
    firstMember: { name: 'Olive', email: 'olive@example.com' },
  });
  owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  for (const key of ['people', 'companies']) ids[key] = created.objects[key] ?? '';
  const slugs = await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  for (const row of slugs.rows) ids[row.slug] = row.id;
  const memberId = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${memberId}, 'Mo', 'mo@example.com', 'member', 'system', 'system')`,
    ),
  );
  const rules: AccessRules = {
    levels: [
      {
        subject: { type: 'role', role: 'member' },
        target: { type: 'attribute', objectId: id('companies'), attributeId: id('companies.domains') },
        level: 'hidden',
      },
    ],
    records: [],
  };
  hidden = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: memberId },
    role: 'member',
    rules,
  });
});

afterAll(async () => {
  await db.close();
});

describe('a company’s display', () => {
  it('names its first domain’s logo, for a full read and one that asked for no attributes (AC-5901, AC-5902)', async () => {
    const acme = await company('Acme', ['acme.com', 'acme.io']);
    const { full, bare } = await displays(owner, acme);
    expect(full).toMatchObject({ kind: 'company', name: 'Acme', imageSrc: '/api/logos/acme.com' });
    expect(bare).toEqual(full);
  });

  it('follows a change of the first domain on the next read (AC-5902)', async () => {
    const globex = await company('Globex', ['globex.com', 'globex.io']);
    await setValues(owner, {
      recordId: globex,
      values: { [id('companies.domains')]: { value: ['globex.io', 'globex.com'] } },
    });
    expect((await displays(owner, globex)).bare?.imageSrc).toBe('/api/logos/globex.io');
    await setValues(owner, { recordId: globex, values: { [id('companies.domains')]: { value: null } } });
    expect((await displays(owner, globex)).bare).not.toHaveProperty('imageSrc');
  });

  it('keeps its initial with no domain, or one that can have no logo (AC-5901)', async () => {
    const none = await company('Initech', []);
    const inside = await company('Intranet', ['10.0.0.1']);
    for (const recordId of [none, inside]) {
      const { full, bare } = await displays(owner, recordId);
      expect(full?.kind).toBe('company');
      expect(full).not.toHaveProperty('imageSrc');
      expect(bare).not.toHaveProperty('imageSrc');
    }
  });

  it('carries no picture address for a reader Domains is hidden from (AC-5907)', async () => {
    const umbrella = await company('Umbrella', ['umbrella.com']);
    const { full, bare, values } = await displays(hidden, umbrella);
    expect(full).toMatchObject({ kind: 'company', name: 'Umbrella' });
    expect(full).not.toHaveProperty('imageSrc');
    expect(bare).not.toHaveProperty('imageSrc');
    expect(values).not.toHaveProperty(id('companies.domains'));
    expect(JSON.stringify(full)).not.toContain('umbrella.com');
    // The owner, who may see Domains, gets it.
    expect((await displays(owner, umbrella)).bare?.imageSrc).toBe('/api/logos/umbrella.com');
  });

  it('gives a person no logo, whatever their email', async () => {
    const ada = (
      await createRecord(owner, {
        objectId: id('people'),
        values: {
          [id('people.name')]: { firstName: 'Ada', lastName: 'L', fullName: 'Ada L' },
          [id('people.email_addresses')]: ['ada@acme-people.com'],
        },
      })
    ).recordId;
    expect((await displays(owner, ada)).full).not.toHaveProperty('imageSrc');
  });

  it('costs no statement of its own, however many companies a read holds', async () => {
    const one = [await company('Solo', ['solo.com'])];
    const many: string[] = [];
    for (let index = 0; index < 20; index += 1)
      many.push(await company(`Many ${String(index)}`, [`many-${String(index)}.com`]));
    const plain = [await company('Plain', [])];
    const count = async (recordIds: readonly string[]) =>
      (await recordStatements(() => getRecords(owner, { ids: recordIds, attributeIds: [] }))).length;
    const solo = await count(one);
    expect(await count(many)).toBe(solo);
    expect(await count(plain)).toBe(solo);
    const read = await getRecords(owner, { ids: many, attributeIds: [] });
    expect(read.map((view) => view.display.imageSrc)).toEqual(
      many.map((_, index) => `/api/logos/many-${String(index)}.com`),
    );
  });

  it('has no logo while Domains is archived, and its logo again once restored', async () => {
    const hooli = await company('Hooli', ['hooli.xyz']);
    await archiveAttribute(owner, id('companies.domains'));
    try {
      expect((await displays(owner, hooli)).bare).not.toHaveProperty('imageSrc');
    } finally {
      await restoreAttribute(owner, id('companies.domains'));
    }
    expect((await displays(owner, hooli)).bare?.imageSrc).toBe('/api/logos/hooli.xyz');
  });
});
