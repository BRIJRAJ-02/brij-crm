// The `crm` seed profile (spec 0011, AC-194): one workspace (slug `load`) of
// People, Companies and Deals, linked to each other, with one hub company
// whose Team holds a quarter of the people, every template attribute filled at
// `FILL_RATES`, 1% of each object in the trash, and its members, each with a
// verified user and the directory rows a signed in person has.
//
// The workspace, its template and its definitions go through the engine's
// services (the owner through `startWorkspace`, as `workspaces.create` does);
// the rows themselves are written in bulk SQL, 50,000 records at a time, inside
// withWorkspace(), each statement naming the workspace itself (the owner login
// bypasses row level security, as on Neon). Record ids are UUID v7s made from
// the record's seed number (a time from before the seed, so every later create
// sorts after them), which lets any chunk name any other record without a
// lookup: links are written beside their records. Which records get a value is
// a fixed stride over the seed numbers, so each fill rate holds to the record,
// not just on average. Seeds never run in production: `load-seed.ts` refuses
// any host but localhost before calling this.
import { sql, type SQL } from 'drizzle-orm';
import type { Database, IdentityStore, WorkspaceTx } from '@crm/db';
import { defineOption, newId, startWorkspace } from '../src/index.ts';
import { systemScope } from '../src/system.ts';
import type { LoadManifest, LoadUser, SeedProfileName } from './load-files.ts';
import { loadRefusal } from './load-local.ts';

/** How many records, members and hub links each profile makes. */
export interface SeedProfile {
  readonly people: number;
  readonly companies: number;
  readonly deals: number;
  readonly users: number;
  /** The people linked to the hub company (the first ones by seed number). */
  readonly hubTeam: number;
}

/**
 * The seed profiles: `crm` is the million record workspace the budget is
 * about, `smoke` (50,000 records, 50 users) is the weekly CI run's, and
 * `test` (2,000 records, 5 users) is the Vitest suite's. Smaller profiles keep
 * `crm`'s proportions.
 */
export const SEED_PROFILES: Readonly<Record<SeedProfileName, SeedProfile>> = {
  crm: { people: 600_000, companies: 150_000, deals: 250_000, users: 1_000, hubTeam: 150_000 },
  smoke: { people: 30_000, companies: 7_500, deals: 12_500, users: 50, hubTeam: 7_500 },
  test: { people: 1_200, companies: 300, deals: 500, users: 5, hubTeam: 300 },
};

/**
 * The share of records with a value, per object and attribute (by API slug),
 * which every seed reads (spec 0011, the fill rates table; Deals' rates are
 * the ones `seed-scale.ts` has always used). A record reference counts as
 * filled when it holds a link. An email opt out is filled on every person,
 * though only `true` is stored (`FILL_DETAILS.emailOptOutTrue`).
 */
export const FILL_RATES = {
  people: {
    name: 1,
    email_addresses: 0.95,
    phone_numbers: 0.6,
    job_title: 0.8,
    description: 0.2,
    primary_location: 0.5,
    avatar: 0.3,
    linkedin: 0.25,
    twitter: 0.25,
    facebook: 0.25,
    instagram: 0.25,
    angellist: 0.25,
    owner: 0.7,
    timezone: 0.5,
    email_opt_out: 1,
    company: 0.9,
  },
  companies: {
    name: 1,
    domains: 0.95,
    description: 0.4,
    logo: 0.5,
    categories: 0.7,
    primary_location: 0.6,
    phone: 0.4,
    employee_range: 0.8,
    estimated_arr: 0.6,
    annual_revenue: 0.3,
    funding_raised: 0.2,
    foundation_date: 0.5,
    owner: 0.7,
    parent_company: 0.05,
    linkedin: 0.25,
    twitter: 0.25,
    facebook: 0.25,
    instagram: 0.25,
    angellist: 0.25,
  },
  deals: {
    name: 1,
    stage: 1,
    owner: 1,
    value: 0.85,
    close_date: 0.9,
    probability: 1,
    source: 1,
    deal_type: 1,
    next_step: 0.5,
    lost_reason: 0,
    description: 0,
    associated_company: 0.9,
    associated_people: 1,
  },
} as const;

/** How filled values look, beyond whether they are there. */
export const FILL_DETAILS = {
  /** People with an email who have a second one. */
  secondEmail: 0.1,
  /** People whose email opt out is checked. */
  emailOptOutTrue: 0.05,
  /** How many industries a company with categories has, at most (1 to this many). */
  maxCategories: 3,
  /** The industry options added to Companies' categories (the template has none). */
  industries: 20,
  /** Deals linked to a second person. */
  secondPerson: 0.5,
  /** Deals with a past stage (Lead, for ten days) before the current one. */
  pastStage: 0.75,
} as const;

/** Records written per transaction. */
const CHUNK = 50_000;
/** How many live ids per object the manifest keeps for `spread`. */
const SAMPLES = 10_000;
/** The seeded workspace's address. */
export const LOAD_SLUG = 'load';

/** A seeded user's email address. */
export const loadUserEmail = (n: number): string => `load-user-${String(n)}@example.com`;

// Made up values, all on example.com (AC-210).
const FIRST_NAMES = [
  'Ada',
  'Grace',
  'Alan',
  'Linus',
  'Margaret',
  'Barbara',
  'Ken',
  'Dennis',
  'Radia',
  'Frances',
  'Edsger',
  'Donald',
  'Hedy',
  'Katherine',
  'John',
  'Mary',
  'Tim',
  'Sophie',
  'Yukihiro',
  'Guido',
  'Bjarne',
  'Anders',
  'Brendan',
  'James',
  'Rasmus',
  'Larry',
  'Annie',
  'Evelyn',
  'Jean',
  'Karen',
];
const LAST_NAMES = [
  'Lovelace',
  'Hopper',
  'Turing',
  'Torvalds',
  'Hamilton',
  'Liskov',
  'Thompson',
  'Ritchie',
  'Perlman',
  'Allen',
  'Dijkstra',
  'Knuth',
  'Lamarr',
  'Johnson',
  'McCarthy',
  'Jackson',
  'Berners-Lee',
  'Wilson',
  'Matsumoto',
  'Rossum',
  'Stroustrup',
  'Hejlsberg',
  'Eich',
  'Gosling',
  'Lerdorf',
  'Wall',
  'Easley',
  'Boyd',
  'Bartik',
  'Jones',
  'Clarke',
  'Okafor',
  'Silva',
  'Novak',
  'Haddad',
  'Kowalski',
  'Nakamura',
  'Fischer',
  'Moreau',
  'Rossi',
];
const JOB_TITLES = [
  'Account Manager',
  'Sales Manager',
  'Product Manager',
  'Software Engineer',
  'Data Engineer',
  'Engineering Manager',
  'Marketing Director',
  'Head of Sales',
  'Chief Executive Officer',
  'Chief Technology Officer',
  'Operations Manager',
  'Customer Success Manager',
  'Designer',
  'Recruiter',
  'Finance Director',
  'Founder',
];
const CITIES = [
  'London',
  'Manchester',
  'New York',
  'San Francisco',
  'Austin',
  'Berlin',
  'Paris',
  'Amsterdam',
  'Singapore',
  'Sydney',
  'Toronto',
  'Bangalore',
  'Tokyo',
  'Dublin',
  'Stockholm',
];
const COUNTRIES = ['GB', 'GB', 'US', 'US', 'US', 'DE', 'FR', 'NL', 'SG', 'AU', 'CA', 'IN', 'JP', 'IE', 'SE'];
const TIME_ZONES = [
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/Berlin',
  'Asia/Singapore',
  'Australia/Sydney',
  'Asia/Kolkata',
  'Asia/Tokyo',
];
const PERSON_NOTES = [
  'Met at a conference.',
  'Introduced by a customer.',
  'Prefers email to calls.',
  'Decision maker for the renewal.',
  'Champion on the buying committee.',
];
const COMPANY_NOTES = [
  'Mid market software company.',
  'Enterprise retailer with a global footprint.',
  'Fast growing fintech.',
  'Family owned manufacturer.',
  'Public sector supplier.',
];
const SOCIALS = ['linkedin', 'twitter', 'facebook', 'instagram', 'angellist'] as const;
const DEAL_FIRST = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Stark', 'Wayne', 'Wonka', 'Tyrell', 'Cyberdyne'];
const DEAL_SECOND = ['renewal', 'expansion', 'pilot', 'upgrade', 'migration', 'rollout', 'support', 'licence'];
const NEXT_STEPS = ['Call back', 'Send proposal', 'Book demo', 'Chase legal', 'Intro to CFO'];

/** A Postgres array literal as one parameter. */
const uuids = (ids: readonly string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`;
const texts = (items: readonly string[]) => sql`${`{${items.map((item) => `"${item}"`).join(',')}}`}::text[]`;
/** One of `items`, chosen by `index` (any integer expression), as SQL. */
const oneOf = (items: readonly string[], index: string) =>
  sql`(${texts(items)})[1 + ((${sql.raw(index)}) % ${sql.raw(String(items.length))})]`;

/** Strides coprime to 100 (and so to 10,000), one per selection, so each attribute's records differ from the next one's. */
const STRIDES = [51, 71, 19, 53, 23, 97, 81, 13, 7, 29, 37, 41, 43, 47, 59, 61, 67, 73, 79, 83];

/**
 * Whether seed number `n` gets a value, for a `share` of the records. Within
 * each block of numbers (100, or 10,000 for a share finer than a whole
 * percent) a stride visits every place once, so the share holds exactly in
 * every block, not just on average; the pattern shifts from block to block,
 * and `slot` picks the stride, so attributes don't pick the same records.
 */
function picked(share: number, slot: number): SQL {
  if (share >= 1) return sql`true`;
  if (share <= 0) return sql`false`;
  const block = Number.isInteger(Math.round(share * 1e6) / 1e4) ? 100 : 10_000;
  const stride = STRIDES[slot % STRIDES.length] ?? 51;
  const salt = (slot * 37) % block;
  const shift = 31 + slot * 2;
  return sql.raw(
    `((n::bigint * ${String(stride)} + ${String(salt)} + (n::bigint / ${String(block)}) * ${String(shift)}) % ${String(block)}) < ${String(Math.round(share * block))}`,
  );
}

/**
 * A record's id from its seed number: a UUID v7 whose time is `base`
 * milliseconds plus `n` (so ids sort by seed number and never meet another
 * object's), its other bits from a hash of the object and number.
 */
function seedId(base: number, tag: string, n: SQL): SQL {
  const hash = sql`md5(${tag}::text || (${n})::text)`;
  return sql`(lpad(to_hex(${base}::bigint + (${n})), 12, '0') || '7' || substr(${hash}, 1, 3) || '8' || substr(${hash}, 4, 15))::uuid`;
}

/** The value columns a seeded row may fill. */
type ValueColumn =
  | 'text_value'
  | 'number_value'
  | 'date_value'
  | 'bool_value'
  | 'option_id'
  | 'actor_type'
  | 'actor_id'
  | 'actor_member_id'
  | 'json_value'
  | 'unique_key';

/** One attribute's value rows for the records of the chunk that pass `where`. */
interface ValueRows {
  readonly attributeId: string;
  readonly columns: Partial<Record<ValueColumn, SQL>>;
  readonly where: SQL;
  readonly position?: number;
}

/**
 * Inserts one attribute's value rows for the records of `seed_chunk` (seed
 * number `n`, `id`, when it was `made`, and the `member` who made it) that
 * pass `where`.
 */
async function insertValues(tx: WorkspaceTx, workspaceId: string, rows: ValueRows): Promise<void> {
  const entries = Object.entries(rows.columns);
  const names = sql.raw(entries.map(([name]) => name).join(', '));
  const expressions = sql.join(
    entries.map(([, expression]) => expression),
    sql`, `,
  );
  await tx.execute(sql`
    insert into "values" (workspace_id, version_id, attribute_id, record_id, owner_id, position, ${names},
      active_from, set_by_type, set_by_id, set_by_member_id)
    select ${workspaceId}::uuid, uuidv7(), ${rows.attributeId}::uuid, id, id, ${rows.position ?? 0}::smallint, ${expressions},
      made, 'member', member, member
    from seed_chunk where ${rows.where}
  `);
}

/** Links from the chunk's records that pass `where`, to the record numbered `to` (ids by `seedId`). */
interface LinkRows {
  readonly relationshipId: string;
  readonly to: SQL;
  readonly position: number;
  readonly toPosition: SQL;
  readonly fromSingle: boolean;
  readonly toSingle: boolean;
  readonly where: SQL;
}

async function insertLinks(tx: WorkspaceTx, workspaceId: string, rows: LinkRows): Promise<void> {
  await tx.execute(sql`
    insert into record_links (workspace_id, version_id, relationship_id, from_record_id, to_record_id, position,
      to_position, from_single, to_single, active_from, set_by_type, set_by_id, set_by_member_id)
    select ${workspaceId}::uuid, uuidv7(), ${rows.relationshipId}::uuid, id, ${rows.to}, ${rows.position}::int,
      ${rows.toPosition}, ${rows.fromSingle}::boolean, ${rows.toSingle}::boolean, made, 'member', member, member
    from seed_chunk where ${rows.where}
  `);
}

/** What seeding needs: the owner login's database, an identity store on it, and a progress line writer. */
export interface SeedDeps {
  readonly db: Database;
  readonly identity: Pick<IdentityStore, 'setUserNameIfEmpty'>;
  readonly log: (message: string) => void;
}

/** Which profile to seed, and the chunk size (tests use a smaller one to cross chunk boundaries). */
export interface SeedInput {
  readonly profile: SeedProfileName;
  readonly chunk?: number;
}

/** Refuses (exit 3) when the database already holds a `load` workspace, or once did (a slug is never reused). */
async function refuseSeeded(db: Database, probeId: string): Promise<void> {
  const taken = await db.withWorkspace(probeId, async (tx) => {
    const result = await tx.execute<{ taken: boolean }>(sql`
      select exists (select 1 from workspaces where slug = ${LOAD_SLUG})
        or exists (select 1 from auth.workspace_directory where slug = ${LOAD_SLUG}) as taken
    `);
    return result.rows[0]?.taken === true;
  });
  if (taken) {
    throw loadRefusal(
      'The load database already holds a `load` workspace. Run `pnpm load:stack:wipe` to start again, then `pnpm load:seed`.',
    );
  }
}

/**
 * Seeds `profile` into the database `deps.db` connects to, as its owner
 * login: the users and members, the workspace and its records, links, trash,
 * sort keys and statistics. Returns the manifest (AC-194). Refuses (exit 3)
 * when a `load` workspace is already there. Sessions are minted separately
 * (`load-sessions.ts`).
 */
export async function seedCrm(deps: SeedDeps, input: SeedInput): Promise<LoadManifest> {
  const { db, log } = deps;
  const profile = SEED_PROFILES[input.profile];
  const chunk = input.chunk ?? CHUNK;
  const workspaceId = newId();
  await refuseSeeded(db, workspaceId);
  const run = <T>(work: (tx: WorkspaceTx) => Promise<T>) => db.withWorkspace(workspaceId, work);

  // Users: verified, named, made up. User 1 makes the workspace as a signed in person does.
  const users = await run(async (tx) => {
    const result = await tx.execute<{ id: string; n: number }>(sql`
      insert into auth."user" (email, name, email_verified)
      select 'load-user-' || g || '@example.com', 'Load User ' || g, true
      from generate_series(1, ${profile.users}::int) g
      returning id::text, split_part(split_part(email, '@', 1), '-', 3)::int as n
    `);
    return [...result.rows].sort((a, b) => a.n - b.n);
  });
  const owner = users[0];
  if (owner === undefined) throw new Error('A profile needs at least one user.');
  await startWorkspace(
    deps,
    { id: owner.id, name: 'Load User 1', email: loadUserEmail(1) },
    { id: workspaceId, name: 'Load', slug: LOAD_SLUG, memberName: 'Load User 1' },
  );
  // Users 2 to N: an active member each, with the membership row a person's workspace list reads.
  const members = await run(async (tx) => {
    await tx.execute(sql`
      insert into members (workspace_id, user_id, name, email, created_by_type, updated_by_type)
      select ${workspaceId}::uuid, u.id, u.name, u.email, 'system', 'system'
      from auth."user" u where u.id = any(${uuids(users.slice(1).map((user) => user.id))})
    `);
    await tx.execute(sql`
      insert into auth.workspace_membership (user_id, workspace_id, member_id)
      select m.user_id, m.workspace_id, m.id from members m
      where m.workspace_id = ${workspaceId} and m.user_id = any(${uuids(users.slice(1).map((user) => user.id))})
    `);
    const result = await tx.execute<{ id: string; user_id: string }>(
      sql`select id::text, user_id::text from members where workspace_id = ${workspaceId}`,
    );
    return new Map(result.rows.map((row) => [row.user_id, row.id]));
  });
  const loadUsers: LoadUser[] = users.map((user) => {
    const memberId = members.get(user.id);
    if (memberId === undefined) throw new Error(`User ${String(user.n)} has no member row.`);
    return { n: user.n, email: loadUserEmail(user.n), userId: user.id, memberId };
  });
  const memberIds = loadUsers.map((user) => user.memberId);
  const memberCount = sql.raw(String(memberIds.length));
  log(`workspace ${workspaceId}, ${String(loadUsers.length)} members`);

  // The definitions the rows need: objects, attributes by `<object>.<slug>`, options, relationships.
  const definitions = await run(async (tx) => {
    const objects = await tx.execute<{ id: string; key: string }>(
      sql`select id::text, standard_key as key from objects where workspace_id = ${workspaceId} and standard_key is not null`,
    );
    const attributes = await tx.execute<{ id: string; key: string; relationship_id: string | null }>(sql`
      select a.id::text, o.standard_key || '.' || a.api_slug as key, a.relationship_id::text
      from attributes a join objects o on o.workspace_id = a.workspace_id and o.id = a.object_id
      where a.workspace_id = ${workspaceId} and o.standard_key is not null
    `);
    return {
      objects: Object.fromEntries(objects.rows.map((row) => [row.key, row.id])),
      attributes: Object.fromEntries(attributes.rows.map((row) => [row.key, row.id])),
      relationships: Object.fromEntries(
        attributes.rows.flatMap((row) => (row.relationship_id === null ? [] : [[row.key, row.relationship_id]])),
      ),
    };
  });
  const lookup = (map: Readonly<Record<string, string>>, key: string, what: string): string => {
    const value = map[key];
    if (value === undefined) throw new Error(`The template has no ${what} ${key}.`);
    return value;
  };
  const objectId = (key: string) => lookup(definitions.objects, key, 'object');
  const attr = (key: string) => lookup(definitions.attributes, key, 'attribute');
  const relationship = (key: string) => lookup(definitions.relationships, key, 'relationship at');
  const optionsOf = (attributeId: string) =>
    run(async (tx) => {
      const result = await tx.execute<{ id: string }>(
        sql`select id::text from attribute_options where attribute_id = ${attributeId} order by position`,
      );
      return result.rows.map((row) => row.id);
    });
  const scope = systemScope(db, workspaceId);
  const industries: string[] = [];
  for (let index = 1; index <= FILL_DETAILS.industries; index += 1) {
    const option = await defineOption(scope, {
      attributeId: attr('companies.categories'),
      label: `Industry ${String(index)}`,
      hue: 'blue',
    });
    industries.push(option.optionId);
  }
  const employeeRanges = await optionsOf(attr('companies.employee_range'));
  const arrBands = await optionsOf(attr('companies.estimated_arr'));
  const stages = await optionsOf(attr('deals.stage'));
  const sources = await optionsOf(attr('deals.source'));
  const dealTypes = await optionsOf(attr('deals.deal_type'));

  // Every id is made from its seed number, at a time before the seed: People, then Companies, then Deals.
  const started = Date.now();
  const base = { people: started - 3 * 3_600_000, companies: started - 2 * 3_600_000, deals: started - 3_600_000 };
  const personId = (n: SQL) => seedId(base.people, 'person', n);
  const companyId = (n: SQL) => seedId(base.companies, 'company', n);
  const dealId = (n: SQL) => seedId(base.deals, 'deal', n);
  const { people, companies, deals, hubTeam } = profile;

  /** Writes `count` records of one object, `chunk` at a time, then `fill` adds their values and links. */
  const writeRecords = async (
    key: 'people' | 'companies' | 'deals',
    count: number,
    idOf: (n: SQL) => SQL,
    fill: (tx: WorkspaceTx) => Promise<void>,
  ) => {
    for (let start = 1; start <= count; start += chunk) {
      const end = Math.min(start + chunk - 1, count);
      await run(async (tx) => {
        await tx.execute(sql`
          create temp table seed_chunk on commit drop as
          select g as n, ${idOf(sql`g`)} as id,
            now() - (interval '20 days' + random() * interval '730 days') as made,
            (${uuids(memberIds)})[1 + g % ${memberCount}] as member
          from generate_series(${start}::int, ${end}::int) g
        `);
        await tx.execute(sql`
          insert into records (workspace_id, id, object_id, created_at, updated_at, created_by_type, created_by_id,
            created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
          select ${workspaceId}::uuid, id, ${objectId(key)}::uuid, made, made, 'member', member, member, 'member', member, member
          from seed_chunk
        `);
        await fill(tx);
      });
      log(`${key} ${end.toLocaleString('en')} of ${count.toLocaleString('en')}`);
    }
  };
  const values = (tx: WorkspaceTx, rows: ValueRows) => insertValues(tx, workspaceId, rows);
  const links = (tx: WorkspaceTx, rows: LinkRows) => insertLinks(tx, workspaceId, rows);
  const actor = (index: string) => ({
    actor_type: sql`'member'::actor_type`,
    actor_id: sql`(${uuids(memberIds)})[1 + (${sql.raw(index)}) % ${memberCount}]`,
    actor_member_id: sql`(${uuids(memberIds)})[1 + (${sql.raw(index)}) % ${memberCount}]`,
  });
  const location = {
    text_value: oneOf(COUNTRIES, 'n * 7'),
    json_value: sql`jsonb_build_object('locality', ${oneOf(CITIES, 'n * 7')}, 'countryCode', ${oneOf(COUNTRIES, 'n * 7')})`,
  };
  const socials = async (tx: WorkspaceTx, object: 'people' | 'companies', slug: string, firstSlot: number) => {
    for (const [index, social] of SOCIALS.entries()) {
      await values(tx, {
        attributeId: attr(`${object}.${social}`),
        columns: { text_value: sql`${`https://${social}.example.com/`}::text || ${slug}::text || n` },
        where: picked(FILL_RATES[object][social], firstSlot + index),
      });
    }
  };
  const currency = (scale: number) => ({
    number_value: sql`round((random() * ${scale})::numeric, 2)`,
    text_value: sql`'USD'`,
  });

  // Companies first, so every link from People and Deals finds its company. Company 1 is the hub.
  const rates = FILL_RATES.companies;
  await writeRecords('companies', companies, companyId, async (tx) => {
    await values(tx, {
      attributeId: attr('companies.name'),
      columns: { text_value: sql`case when n = 1 then 'Hub Company' else 'Company ' || n end` },
      where: sql`true`,
    });
    const domain = sql`'company' || n || '.load.example.com'`;
    await values(tx, {
      attributeId: attr('companies.domains'),
      columns: { text_value: domain, unique_key: domain },
      where: picked(rates.domains, 0),
    });
    await values(tx, {
      attributeId: attr('companies.description'),
      columns: { text_value: oneOf(COMPANY_NOTES, 'n') },
      where: picked(rates.description, 1),
    });
    await values(tx, {
      attributeId: attr('companies.logo'),
      columns: { text_value: sql`'https://logos.load.example.com/company' || n || '.png'` },
      where: picked(rates.logo, 2),
    });
    for (let position = 0; position < FILL_DETAILS.maxCategories; position += 1) {
      await values(tx, {
        attributeId: attr('companies.categories'),
        columns: {
          option_id: sql`(${uuids(industries)})[1 + (n + ${sql.raw(String(position * 7))}) % ${sql.raw(String(industries.length))}]`,
        },
        where: sql`${picked(rates.categories, 3)} and n % ${sql.raw(String(FILL_DETAILS.maxCategories))} >= ${sql.raw(String(position))}`,
        position,
      });
    }
    await values(tx, {
      attributeId: attr('companies.primary_location'),
      columns: location,
      where: picked(rates.primary_location, 4),
    });
    await values(tx, {
      attributeId: attr('companies.phone'),
      columns: { text_value: sql`'+4420' || lpad(n::text, 8, '0')`, json_value: sql`'{"country":"GB"}'::jsonb` },
      where: picked(rates.phone, 5),
    });
    await values(tx, {
      attributeId: attr('companies.employee_range'),
      columns: { option_id: sql`(${uuids(employeeRanges)})[1 + (n * 3) % ${sql.raw(String(employeeRanges.length))}]` },
      where: picked(rates.employee_range, 6),
    });
    await values(tx, {
      attributeId: attr('companies.estimated_arr'),
      columns: { option_id: sql`(${uuids(arrBands)})[1 + (n * 5) % ${sql.raw(String(arrBands.length))}]` },
      where: picked(rates.estimated_arr, 7),
    });
    await values(tx, {
      attributeId: attr('companies.annual_revenue'),
      columns: currency(500_000_000),
      where: picked(rates.annual_revenue, 8),
    });
    await values(tx, {
      attributeId: attr('companies.funding_raised'),
      columns: currency(100_000_000),
      where: picked(rates.funding_raised, 9),
    });
    await values(tx, {
      attributeId: attr('companies.foundation_date'),
      columns: { date_value: sql`date '1950-01-01' + ((n * 7919) % 27000)::int` },
      where: picked(rates.foundation_date, 10),
    });
    await values(tx, {
      attributeId: attr('companies.owner'),
      columns: actor('n * 31'),
      where: picked(rates.owner, 11),
    });
    await socials(tx, 'companies', 'company', 12);
    // Every 20th company (5%) has the one before it as its parent, so no company is its own ancestor.
    await links(tx, {
      relationshipId: relationship('companies.parent_company'),
      to: companyId(sql`n - 1`),
      position: 0,
      toPosition: sql`0`,
      fromSingle: true,
      toSingle: false,
      where: sql`n % 20 = 0`,
    });
  });

  // People: the first `hubTeam` work at the hub; of the rest, enough work elsewhere for 90% in all.
  const peopleRates = FILL_RATES.people;
  const otherShare = (peopleRates.company * people - hubTeam) / (people - hubTeam);
  const others = sql.raw(String(companies - 1));
  const hub = sql.raw(String(hubTeam));
  await writeRecords('people', people, personId, async (tx) => {
    const first = oneOf(FIRST_NAMES, 'n');
    const last = oneOf(LAST_NAMES, `n / ${String(FIRST_NAMES.length)}`);
    await values(tx, {
      attributeId: attr('people.name'),
      columns: {
        text_value: sql`${first} || ' ' || ${last}`,
        json_value: sql`jsonb_build_object('firstName', ${first}, 'lastName', ${last})`,
      },
      where: sql`true`,
    });
    const email = sql`'person' || n || '@load.example.com'`;
    await values(tx, {
      attributeId: attr('people.email_addresses'),
      columns: { text_value: email, unique_key: email },
      where: picked(peopleRates.email_addresses, 0),
    });
    const second = sql`'person' || n || '.2@load.example.com'`;
    await values(tx, {
      attributeId: attr('people.email_addresses'),
      columns: { text_value: second, unique_key: second },
      where: sql`${picked(peopleRates.email_addresses, 0)} and ${picked(FILL_DETAILS.secondEmail, 1)}`,
      position: 1,
    });
    await values(tx, {
      attributeId: attr('people.phone_numbers'),
      columns: { text_value: sql`'+1555' || lpad(n::text, 7, '0')`, json_value: sql`'{"country":"US"}'::jsonb` },
      where: picked(peopleRates.phone_numbers, 2),
    });
    await values(tx, {
      attributeId: attr('people.job_title'),
      columns: { text_value: oneOf(JOB_TITLES, 'n * 3') },
      where: picked(peopleRates.job_title, 3),
    });
    await values(tx, {
      attributeId: attr('people.description'),
      columns: { text_value: oneOf(PERSON_NOTES, 'n') },
      where: picked(peopleRates.description, 4),
    });
    await values(tx, {
      attributeId: attr('people.primary_location'),
      columns: location,
      where: picked(peopleRates.primary_location, 5),
    });
    await values(tx, {
      attributeId: attr('people.avatar'),
      columns: { text_value: sql`'https://avatars.load.example.com/person' || n || '.png'` },
      where: picked(peopleRates.avatar, 6),
    });
    await socials(tx, 'people', 'person', 7);
    await values(tx, {
      attributeId: attr('people.owner'),
      columns: actor('n * 31'),
      where: picked(peopleRates.owner, 12),
    });
    await values(tx, {
      attributeId: attr('people.timezone'),
      columns: { text_value: oneOf(TIME_ZONES, 'n * 5') },
      where: picked(peopleRates.timezone, 13),
    });
    // A checkbox stores only true: the other 95% read as unchecked.
    await values(tx, {
      attributeId: attr('people.email_opt_out'),
      columns: { bool_value: sql`true` },
      where: picked(FILL_DETAILS.emailOptOutTrue, 14),
    });
    await links(tx, {
      relationshipId: relationship('people.company'),
      to: companyId(sql`case when n <= ${hub} then 1 else 2 + (n - ${hub} - 1) % ${others} end`),
      position: 0,
      toPosition: sql`case when n <= ${hub} then n - 1 else (n - ${hub} - 1) / ${others} end`,
      fromSingle: true,
      toSingle: false,
      where: sql`n <= ${hub} or ${picked(otherShare, 15)}`,
    });
  });

  // Deals: the rates seed-scale.ts has always used, a company on 90%, and one or two people each.
  const dealRates = FILL_RATES.deals;
  const rareWords = sql`case when n % 1000 = 7 then ' zephyr' when n % 250 = 3 then ' quokka' else '' end`;
  const half = sql.raw(String(Math.floor(people / 2)));
  const peopleCount = sql.raw(String(people));
  const companyCount = sql.raw(String(companies));
  await writeRecords('deals', deals, dealId, async (tx) => {
    await values(tx, {
      attributeId: attr('deals.name'),
      columns: {
        text_value: sql`${oneOf(DEAL_FIRST, 'n')} || ' ' || ${oneOf(DEAL_SECOND, 'n / 10')} || ' ' || n || ${rareWords}`,
      },
      where: sql`true`,
    });
    // A past stage (Lead, for ten days) on 75%, then the current one: Lead on a quarter, any later stage otherwise.
    const lead = sql`(${uuids(stages)})[1]`;
    const pastStage = picked(FILL_DETAILS.pastStage, 0);
    await tx.execute(sql`
      insert into "values" (workspace_id, version_id, attribute_id, record_id, owner_id, option_id, active_from,
        active_until, set_by_type, set_by_id, set_by_member_id)
      select ${workspaceId}::uuid, uuidv7(), ${attr('deals.stage')}::uuid, id, id, ${lead}, made, made + interval '10 days',
        'member', member, member
      from seed_chunk where ${pastStage}
    `);
    await tx.execute(sql`
      insert into "values" (workspace_id, version_id, attribute_id, record_id, owner_id, option_id, active_from,
        set_by_type, set_by_id, set_by_member_id)
      select ${workspaceId}::uuid, uuidv7(), ${attr('deals.stage')}::uuid, id, id,
        case when ${pastStage} then (${uuids(stages)})[2 + n % ${sql.raw(String(stages.length - 1))}] else ${lead} end,
        case when ${pastStage} then made + interval '10 days' else made end, 'member', member, member
      from seed_chunk
    `);
    await values(tx, { attributeId: attr('deals.owner'), columns: actor('n'), where: picked(dealRates.owner, 1) });
    await values(tx, {
      attributeId: attr('deals.value'),
      columns: currency(250_000),
      where: picked(dealRates.value, 2),
    });
    await values(tx, {
      attributeId: attr('deals.close_date'),
      columns: { date_value: sql`(made + ((n * 7919) % 200) * interval '1 day')::date` },
      where: picked(dealRates.close_date, 3),
    });
    await values(tx, {
      attributeId: attr('deals.probability'),
      columns: { number_value: sql`(n * 37) % 101` },
      where: picked(dealRates.probability, 4),
    });
    await values(tx, {
      attributeId: attr('deals.source'),
      columns: { option_id: sql`(${uuids(sources)})[1 + (n * 3) % ${sql.raw(String(sources.length))}]` },
      where: picked(dealRates.source, 5),
    });
    await values(tx, {
      attributeId: attr('deals.deal_type'),
      columns: { option_id: sql`(${uuids(dealTypes)})[1 + n % ${sql.raw(String(dealTypes.length))}]` },
      where: picked(dealRates.deal_type, 6),
    });
    await values(tx, {
      attributeId: attr('deals.next_step'),
      columns: { text_value: sql`${oneOf(NEXT_STEPS, 'n')} || ' (' || n || ')'` },
      where: picked(dealRates.next_step, 7),
    });
    await links(tx, {
      relationshipId: relationship('deals.associated_company'),
      to: companyId(sql`1 + (n - 1) % ${companyCount}`),
      position: 0,
      toPosition: sql`(n - 1) / ${companyCount}`,
      fromSingle: true,
      toSingle: false,
      where: picked(dealRates.associated_company, 8),
    });
    // Each person's deals take even places as a first person and odd ones as a second, so none collide.
    await links(tx, {
      relationshipId: relationship('deals.associated_people'),
      to: personId(sql`1 + (n - 1) % ${peopleCount}`),
      position: 0,
      toPosition: sql`2 * ((n - 1) / ${peopleCount})`,
      fromSingle: false,
      toSingle: false,
      where: sql`true`,
    });
    await links(tx, {
      relationshipId: relationship('deals.associated_people'),
      to: personId(sql`1 + (n - 1 + ${half}) % ${peopleCount}`),
      position: 1,
      toPosition: sql`2 * ((n - 1 + ${half}) / ${peopleCount}) + 1`,
      fromSingle: false,
      toSingle: false,
      where: picked(FILL_DETAILS.secondPerson, 9),
    });
  });

  // 1% of each object to the trash, as the engine's delete leaves it (spec 0004's pick). The hub stays live.
  const hubCompanyId = await run(async (tx) => {
    const hubId = await tx.execute<{ id: string }>(sql`select ${companyId(sql`1`)}::text as id`);
    const id = hubId.rows[0]?.id;
    if (id === undefined) throw new Error('The hub company has no id.');
    await tx.execute(sql`
      update records set deleted_at = now(), deleted_by_type = 'system'
      where workspace_id = ${workspaceId} and deleted_at is null and abs(hashtext(id::text)) % 100 = 0 and id <> ${id}
    `);
    await tx.execute(sql`
      update "values" v set held_unique_key = v.unique_key, unique_key = null
      from records r
      where r.workspace_id = ${workspaceId} and r.deleted_at is not null
        and v.workspace_id = r.workspace_id and v.record_id = r.id and v.active_until is null and v.unique_key is not null
    `);
    await tx.execute(sql`
      update workspace_counters set live_records = (
        select count(*) from records where workspace_id = ${workspaceId} and deleted_at is null
      ) where workspace_id = ${workspaceId}
    `);
    return id;
  });
  log('trash');
  // Fresh statistics first: planned on the empty tables' estimates, the sort key view's join is many times slower.
  await db.vacuumAnalyze(['records', 'values', 'record_links']);
  log('vacuum and analyse');
  // The bulk rows skipped the save path, so their stored sort keys come from the view that defines them.
  await run(async (tx) => {
    await tx.execute(sql`delete from sort_keys where workspace_id = ${workspaceId}`);
    await tx.execute(sql`
      insert into sort_keys (workspace_id, owner_id, attribute_id, record_id, entry_id, live, text_key, number_key,
        code_key, date_key, time_key, option_id, bool_key)
      select workspace_id, owner_id, attribute_id, record_id, entry_id, live, text_key, number_key, code_key, date_key,
        time_key, option_id, bool_key
      from sort_key_sources where workspace_id = ${workspaceId}
    `);
  });
  await db.vacuumAnalyze(['sort_keys']);
  log('sort keys');

  const facts = await run(async (tx) => {
    const counts = await tx.execute<{ id: string; stored: number; live: number }>(sql`
      select object_id::text as id, count(*)::int as stored, (count(*) filter (where deleted_at is null))::int as live
      from records where workspace_id = ${workspaceId} group by object_id
    `);
    const samples = await tx.execute<{ id: string; ids: string[] }>(sql`
      select o.id::text, array(
        select r.id::text from records r
        where r.workspace_id = o.workspace_id and r.object_id = o.id and r.deleted_at is null
        order by hashtext(r.id::text), r.id limit ${SAMPLES}
      ) as ids
      from objects o where o.workspace_id = ${workspaceId} and o.standard_key is not null
    `);
    const clock = await tx.execute<{ at: string }>(
      sql`select to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at`,
    );
    return { counts: counts.rows, samples: samples.rows, seededAt: clock.rows[0]?.at ?? new Date().toISOString() };
  });
  const keyOf = new Map(Object.entries(definitions.objects).map(([key, id]) => [id, key]));
  /** Rows keyed by their object's standard key, each turned into `value`. */
  const byKey = <Row extends { readonly id: string }, T>(rows: readonly Row[], value: (row: Row) => T) =>
    Object.fromEntries(
      rows.flatMap((row): [string, T][] => {
        const key = keyOf.get(row.id);
        return key === undefined ? [] : [[key, value(row)]];
      }),
    );
  return {
    profile: input.profile,
    workspaceId,
    slug: LOAD_SLUG,
    seededAt: facts.seededAt,
    objects: definitions.objects,
    attributes: definitions.attributes,
    hubCompanyId,
    hubTeamAttributeId: attr('companies.team'),
    counts: byKey(facts.counts, (row) => ({ stored: row.stored, live: row.live })),
    users: loadUsers,
    samples: byKey(facts.samples, (row) => row.ids),
  };
}
