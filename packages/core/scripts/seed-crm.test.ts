// The load seed's `test` profile against a real Postgres (spec 0011, AC-194,
// AC-212): exact counts, the fill rates, unique emails and domains, the hub's
// Team, the trash, members with their directory rows, sort keys, and values
// the engine reads back in shapes the contract accepts.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { parseAttributeValue, type AttributeType } from '@crm/contracts/values';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { readRecordsById } from '../src/index.ts';
import { testScope } from '../src/testing.ts';
import { LoadManifest } from './load-files.ts';
import { isLoadRefusal } from './load-local.ts';
import { FILL_DETAILS, FILL_RATES, SEED_PROFILES, seedCrm } from './seed-crm.ts';

const { ownerUrl, appUrl } = inject('testDatabase');
const profile = SEED_PROFILES.test;
let db: Database;
let identity: IdentityStore;
let manifest: LoadManifest;

/** One row of numbers from the owner login (which sees every workspace). */
async function one(text: string, params: readonly unknown[] = []): Promise<Record<string, number>> {
  const [row] = await testQuery<Record<string, string | number>>(ownerUrl, text, params);
  return Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [key, Number(value)]));
}

beforeAll(async () => {
  db = createDatabase({ url: ownerUrl, applicationName: 'crm-seed-crm-tests' });
  identity = createIdentityStore({ url: ownerUrl, applicationName: 'crm-seed-crm-tests' });
  // A small chunk, so every object crosses chunk boundaries (and links reach records of earlier chunks).
  manifest = await seedCrm({ db, identity, log: () => undefined }, { profile: 'test', chunk: 250 });
}, 120_000);

afterAll(async () => {
  await identity.close();
  await db.close();
});

/** The share of an object's live (or every stored) record that holds a current value of the attribute. */
async function shareWithValue(object: string, slug: string, live: boolean): Promise<number> {
  const attributeId = manifest.attributes[`${object}.${slug}`];
  const { share } = await one(
    `select avg((exists (select 1 from "values" v where v.workspace_id = r.workspace_id and v.record_id = r.id
       and v.attribute_id = $2 and v.active_until is null and not v.is_cleared))::int)::float as share
     from records r where r.workspace_id = $1 and r.object_id = $3 and ($4 = false or r.deleted_at is null)`,
    [manifest.workspaceId, attributeId, manifest.objects[object], live],
  );
  return share ?? Number.NaN;
}

/** The share of an object's records holding a current link through the relationship behind `object.slug`. */
async function shareWithLink(object: string, slug: string, live: boolean): Promise<number> {
  const { share } = await one(
    `select avg((exists (select 1 from record_links l where l.workspace_id = r.workspace_id
       and l.relationship_id = a.relationship_id and l.from_record_id = r.id and l.active_until is null))::int)::float as share
     from records r join attributes a on a.workspace_id = r.workspace_id and a.id = $2
     where r.workspace_id = $1 and r.object_id = $3 and ($4 = false or r.deleted_at is null)`,
    [manifest.workspaceId, manifest.attributes[`${object}.${slug}`], manifest.objects[object], live],
  );
  return share ?? Number.NaN;
}

const LINKS = new Set([
  'people.company',
  'companies.parent_company',
  'deals.associated_company',
  'deals.associated_people',
]);

describe('the test profile', () => {
  it('writes a manifest the harness can read', () => {
    expect(LoadManifest.parse(manifest)).toEqual(manifest);
    expect(manifest.slug).toBe('load');
    expect(manifest.users.map((user) => user.email)).toEqual(
      Array.from({ length: profile.users }, (_, index) => `load-user-${String(index + 1)}@example.com`),
    );
  });

  it('makes exactly the profile’s records, with 1% of each object in the trash by the hash rule', async () => {
    const total = profile.people + profile.companies + profile.deals;
    expect(manifest.counts.people?.stored).toBe(profile.people);
    expect(manifest.counts.companies?.stored).toBe(profile.companies);
    expect(manifest.counts.deals?.stored).toBe(profile.deals);
    const { trashed, wrong, counter } = await one(
      `select count(*) filter (where deleted_at is not null) as trashed,
         count(*) filter (where (deleted_at is not null) <> (abs(hashtext(id::text)) % 100 = 0 and id <> $2)) as wrong,
         (select live_records from workspace_counters where workspace_id = $1) as counter
       from records where workspace_id = $1`,
      [manifest.workspaceId, manifest.hubCompanyId],
    );
    expect(wrong).toBe(0);
    expect(trashed).toBeGreaterThan(total * 0.0025);
    expect(trashed).toBeLessThan(total * 0.025);
    const live = Object.values(manifest.counts).reduce((sum, count) => sum + count.live, 0);
    expect(live).toBe(total - (trashed ?? 0));
    expect(counter).toBe(live);
  });

  it('fills every template attribute at its rate, within 1 point (2 on live records, after the trash)', async () => {
    for (const [object, rates] of Object.entries(FILL_RATES)) {
      for (const [slug, rate] of Object.entries(rates)) {
        const key = `${object}.${slug}`;
        // Only `true` is stored for a checkbox: every person is filled, with 5% checked.
        const expected = key === 'people.email_opt_out' ? FILL_DETAILS.emailOptOutTrue : rate;
        const read = LINKS.has(key) ? shareWithLink : shareWithValue;
        expect.soft(Math.abs((await read(object, slug, false)) - expected), `${key} stored`).toBeLessThanOrEqual(0.01);
        expect.soft(Math.abs((await read(object, slug, true)) - expected), `${key} live`).toBeLessThanOrEqual(0.02);
      }
    }
  });

  it('gives a second email to about a tenth of the people with one', async () => {
    const { second, first } = await one(
      `select count(*) filter (where position = 1) as second, count(*) filter (where position = 0) as first
       from "values" where workspace_id = $1 and attribute_id = $2 and active_until is null`,
      [manifest.workspaceId, manifest.attributes['people.email_addresses']],
    );
    expect(Math.abs((second ?? 0) / (first ?? 1) - FILL_DETAILS.secondEmail)).toBeLessThanOrEqual(0.02);
  });

  it('keeps emails and domains unique, with the trash’s keys held', async () => {
    const { rows, distinct, keyed, held, misplaced } = await one(
      `select count(*) as rows, count(distinct v.text_value) as distinct,
         count(*) filter (where v.unique_key = v.text_value) as keyed,
         count(*) filter (where v.held_unique_key = v.text_value) as held,
         count(*) filter (where (r.deleted_at is null) <> (v.unique_key is not null)) as misplaced
       from "values" v join records r on r.workspace_id = v.workspace_id and r.id = v.record_id
       where v.workspace_id = $1 and v.attribute_id in ($2, $3) and v.active_until is null`,
      [manifest.workspaceId, manifest.attributes['people.email_addresses'], manifest.attributes['companies.domains']],
    );
    expect(distinct).toBe(rows);
    expect((keyed ?? 0) + (held ?? 0)).toBe(rows);
    expect(held).toBeGreaterThan(0);
    expect(misplaced).toBe(0);
  });

  it('puts the first people in the hub company’s Team, and keeps the hub live', async () => {
    const { team, live, named } = await one(
      `select count(*) as team,
         (select count(*) from records where workspace_id = $1 and id = $2 and deleted_at is null) as live,
         (select count(*) from "values" where workspace_id = $1 and record_id = $2 and text_value = 'Hub Company') as named
       from record_links l join attributes a on a.workspace_id = l.workspace_id and a.relationship_id = l.relationship_id
       where l.workspace_id = $1 and a.id = $3 and l.to_record_id = $2 and l.active_until is null`,
      [manifest.workspaceId, manifest.hubCompanyId, manifest.hubTeamAttributeId],
    );
    expect(team).toBe(profile.hubTeam);
    expect(live).toBe(1);
    expect(named).toBe(1);
  });

  it('links every deal to one or two people, each person’s far places distinct', async () => {
    const { outside, clashes } = await one(
      `select
         (select count(*) from (
            select r.id, count(l.id) as people from records r
            left join record_links l on l.workspace_id = r.workspace_id and l.from_record_id = r.id
              and l.relationship_id = $3 and l.active_until is null
            where r.workspace_id = $1 and r.object_id = $2 group by r.id
          ) d where people not in (1, 2)) as outside,
         (select count(*) from (
            select to_record_id, relationship_id, to_position from record_links
            where workspace_id = $1 and active_until is null
            group by 1, 2, 3 having count(*) > 1
          ) c) as clashes`,
      [
        manifest.workspaceId,
        manifest.objects.deals,
        (
          await testQuery<{ id: string }>(
            ownerUrl,
            'select relationship_id::text as id from attributes where id = $1',
            [manifest.attributes['deals.associated_people']],
          )
        )[0]?.id,
      ],
    );
    expect(outside).toBe(0);
    expect(clashes).toBe(0);
  });

  it('makes every user a verified, active member with its directory rows', async () => {
    const { users, verified, members, active, memberships, directory } = await one(
      `select
         (select count(*) from auth."user" where email like 'load-user-%@example.com') as users,
         (select count(*) from auth."user" where email like 'load-user-%@example.com' and email_verified) as verified,
         (select count(*) from members where workspace_id = $1) as members,
         (select count(*) from members m join auth."user" u on u.id = m.user_id
           where m.workspace_id = $1 and m.status = 'active' and m.email = u.email) as active,
         (select count(*) from auth.workspace_membership where workspace_id = $1) as memberships,
         (select count(*) from auth.workspace_directory where workspace_id = $1 and slug = 'load') as directory`,
      [manifest.workspaceId],
    );
    expect({ users, verified, members, active, memberships, directory }).toEqual({
      users: profile.users,
      verified: profile.users,
      members: profile.users,
      active: profile.users,
      memberships: profile.users,
      directory: 1,
    });
  });

  it('fills the stored sort keys from their defining view', async () => {
    const { stored, defined, hidden } = await one(
      `select (select count(*) from sort_keys where workspace_id = $1) as stored,
         (select count(*) from sort_key_sources where workspace_id = $1) as defined,
         (select count(*) from sort_keys where workspace_id = $1 and not live) as hidden`,
      [manifest.workspaceId],
    );
    expect(stored).toBe(defined);
    expect(stored).toBeGreaterThan(profile.people);
    expect(hidden).toBeGreaterThan(0);
  });

  it('stores values the engine reads back in the contract’s own shapes', async () => {
    const attributes = await testQuery<{ id: string; type: AttributeType; is_multi: boolean }>(
      ownerUrl,
      `select id::text, type, is_multi from attributes
       where workspace_id = $1 and system_column is null and type <> 'record_reference'`,
      [manifest.workspaceId],
    );
    const app = createDatabase({ url: appUrl, applicationName: 'crm-seed-crm-tests' });
    try {
      const owner = manifest.users[0]?.memberId ?? '';
      const scope = testScope({ db: app, workspaceId: manifest.workspaceId, actor: { type: 'member', id: owner } });
      const ids = Object.values(manifest.samples).flatMap((sample) => sample.slice(0, 40));
      const records = await readRecordsById(scope, ids);
      expect(records).toHaveLength(ids.length);
      for (const record of records) {
        for (const attribute of attributes) {
          if (!(attribute.id in record.values)) continue;
          const parsed = parseAttributeValue(attribute.type, record.values[attribute.id], {
            allowMultiple: attribute.is_multi,
          });
          expect.soft(parsed.ok, `${attribute.type} ${JSON.stringify(record.values[attribute.id])}`).toBe(true);
        }
      }
    } finally {
      await app.close();
    }
  });

  it('refuses to seed a database that already holds a load workspace', async () => {
    const refused = await seedCrm({ db, identity, log: () => undefined }, { profile: 'test' }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(isLoadRefusal(refused) && refused.exitCode === 3).toBe(true);
    expect(String(refused)).toContain('pnpm load:stack:wipe');
  });
});
