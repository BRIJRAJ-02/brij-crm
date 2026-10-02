// `pnpm db:seed:scale`: a workspace of 1,000,000 deals for the benchmark grid
// (spec 0004, AC-15). The workspace, its template and its definitions go
// through the engine's services; the rows themselves are written in bulk SQL,
// 50,000 at a time, inside withWorkspace() so row level security still holds.
// Deals get the template's attributes filled realistically, a past stage
// version each, a company link (90%), and a list of 200,000 entries.
// Runs as the owner role, and refuses any host but localhost unless you name
// the branch's host in SEED_SCALE_ALLOW_HOST (never the production branch).
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import { createDatabase, type WorkspaceTx } from '@crm/db';
import { createWorkspace, defineAttribute, defineList, defineOption, type EngineScope } from '../src/index.ts';
import { refuseRemote } from './local-only.ts';

const env = z
  .object({
    DATABASE_URL_OWNER: z.url(),
    SEED_SCALE_RECORDS: z.coerce.number().int().min(1000).max(1_000_000).default(1_000_000),
    SEED_SCALE_ENTRIES: z.coerce.number().int().min(0).max(1_000_000).default(200_000),
    SEED_SCALE_ALLOW_HOST: z.string().min(1).optional(),
  })
  .parse(process.env);

refuseRemote(env.DATABASE_URL_OWNER, env.SEED_SCALE_ALLOW_HOST, 'the seed');

const CHUNK = 50_000;
const COMPANIES = 20_000;
const MEMBERS = 20;
const started = Date.now();
const log = (message: string) => {
  console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(7)}s  ${message}`);
};

/** A Postgres array literal as one parameter. */
const uuids = (ids: readonly string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`;
const texts = (items: readonly string[]) => sql`${`{${items.map((item) => `"${item}"`).join(',')}}`}::text[]`;

const db = createDatabase({ url: env.DATABASE_URL_OWNER, applicationName: 'crm-seed-scale' });
try {
  const created = await createWorkspace(db, {
    name: 'Scale',
    slug: `scale-${String(Date.now())}`,
    firstMember: { name: 'Scale owner', email: 'scale@example.com' },
  });
  const workspaceId = created.workspaceId;
  const scope: EngineScope = {
    db,
    workspaceId,
    actor: { type: 'member', id: created.memberId },
    limits: { liveRecords: 2_000_000 },
  };
  const run = <T>(work: (tx: WorkspaceTx) => Promise<T>) => db.withWorkspace(workspaceId, work);
  const deals = created.objects.deals ?? '';
  const companies = created.objects.companies ?? '';
  log(`workspace ${workspaceId}`);

  const memberIds = await run(async (tx) => {
    const result = await tx.execute<{ id: string }>(sql`
      insert into members (workspace_id, name, email, created_by_type, updated_by_type)
      select ${workspaceId}, 'Member ' || g, 'member' || g || '@example.com', 'system', 'system'
      from generate_series(1, ${MEMBERS - 1}::int) g returning id::text
    `);
    return [created.memberId, ...result.rows.map((row) => row.id)];
  });
  const slugs = await run(async (tx) => {
    const result = await tx.execute<{ id: string; object_id: string; api_slug: string }>(
      sql`select id::text, object_id::text, api_slug from attributes where object_id in (${deals}, ${companies})`,
    );
    return new Map(
      result.rows.map((row) => [`${row.object_id === deals ? 'deal' : 'company'}.${row.api_slug}`, row.id]),
    );
  });
  const attr = (key: string): string => {
    const value = slugs.get(key);
    if (value === undefined) throw new Error(`No attribute ${key}.`);
    return value;
  };
  const optionsOf = (attributeId: string) =>
    run(async (tx) => {
      const result = await tx.execute<{ id: string }>(
        sql`select id::text from attribute_options where attribute_id = ${attributeId} order by position`,
      );
      return result.rows.map((row) => row.id);
    });
  const industries: string[] = [];
  for (let index = 1; index <= 20; index += 1) {
    industries.push(
      (
        await defineOption(scope, {
          attributeId: attr('company.categories'),
          label: `Industry ${String(index)}`,
          hue: 'blue',
        })
      ).optionId,
    );
  }
  const stages = await optionsOf(attr('deal.stage'));
  const sources = await optionsOf(attr('deal.source'));
  const dealTypes = await optionsOf(attr('deal.deal_type'));
  const relationship = await run(async (tx) => {
    const result = await tx.execute<{ id: string }>(
      sql`select relationship_id::text as id from attributes where id = ${attr('deal.associated_company')}`,
    );
    return result.rows[0]?.id ?? '';
  });

  // Companies: a name and an industry each.
  await run(async (tx) => {
    await tx.execute(sql`
      create temp table seed_companies on commit drop as
      select uuidv7() as id, g as n from generate_series(1, ${COMPANIES}::int) g
    `);
    await tx.execute(sql`
      insert into records (workspace_id, id, object_id, created_by_type, updated_by_type)
      select ${workspaceId}, id, ${companies}, 'system', 'system' from seed_companies
    `);
    await tx.execute(sql`
      insert into "values" (workspace_id, version_id, attribute_id, record_id, owner_id, text_value, active_from, set_by_type)
      select ${workspaceId}, uuidv7(), ${attr('company.name')}, id, id, 'Company ' || n, now(), 'system' from seed_companies
    `);
    await tx.execute(sql`
      insert into "values" (workspace_id, version_id, attribute_id, record_id, owner_id, option_id, active_from, set_by_type)
      select ${workspaceId}, uuidv7(), ${attr('company.categories')}, id, id, (${uuids(industries)})[1 + n % 20], now(), 'system'
      from seed_companies
    `);
  });
  log(`${String(COMPANIES)} companies`);

  const first = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Stark', 'Wayne', 'Wonka', 'Tyrell', 'Cyberdyne'];
  const second = ['renewal', 'expansion', 'pilot', 'upgrade', 'migration', 'rollout', 'support', 'licence'];
  const steps = ['Call back', 'Send proposal', 'Book demo', 'Chase legal', 'Intro to CFO'];
  for (let start = 1; start <= env.SEED_SCALE_RECORDS; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, env.SEED_SCALE_RECORDS);
    await run(async (tx) => {
      await tx.execute(sql`
        create temp table seed_deals on commit drop as
        select uuidv7() as id, g as n, random() as r1, random() as r2, random() as r3, random() as r4,
          random() as r5, random() as r6, random() as r7, random() as r8,
          now() - (interval '20 days' + random() * interval '730 days') as made,
          (${uuids(memberIds)})[1 + g % ${MEMBERS}::int] as member
        from generate_series(${start}::int, ${end}::int) g
      `);
      await tx.execute(sql`
        insert into records (workspace_id, id, object_id, created_at, updated_at,
          created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
        select ${workspaceId}, id, ${deals}, made, made, 'member', member, member, 'member', member, member from seed_deals
      `);
      await tx.execute(sql`
        insert into "values" (workspace_id, version_id, attribute_id, record_id, owner_id, text_value, active_from, set_by_type, set_by_id, set_by_member_id)
        select ${workspaceId}, uuidv7(), ${attr('deal.name')}, id, id,
          (${texts(first)})[1 + floor(r1 * 10)::int] || ' ' || (${texts(second)})[1 + floor(r2 * 8)::int] || ' ' || n,
          made, 'member', member, member
        from seed_deals
      `);
      // A past stage (Lead for the first ten days), then the current one.
      await tx.execute(sql`
        insert into "values" (workspace_id, version_id, attribute_id, record_id, owner_id, option_id, active_from, active_until, set_by_type, set_by_id, set_by_member_id)
        select ${workspaceId}, uuidv7(), ${attr('deal.stage')}, id, id, (${uuids(stages)})[1], made, made + interval '10 days', 'member', member, member
        from seed_deals where r3 >= 0.25
      `);
      await tx.execute(sql`
        insert into "values" (workspace_id, version_id, attribute_id, record_id, owner_id, option_id, active_from, set_by_type, set_by_id, set_by_member_id)
        select ${workspaceId}, uuidv7(), ${attr('deal.stage')}, id, id,
          (${uuids(stages)})[case when r3 < 0.25 then 1 else 2 + floor((r3 - 0.25) / 0.75 * 3)::int end],
          case when r3 < 0.25 then made else made + interval '10 days' end, 'member', member, member
        from seed_deals
      `);
      await tx.execute(sql`
        insert into "values" (workspace_id, version_id, attribute_id, record_id, owner_id, actor_type, actor_id, actor_member_id, active_from, set_by_type, set_by_id, set_by_member_id)
        select ${workspaceId}, uuidv7(), ${attr('deal.owner')}, id, id, 'member', member, member, made, 'member', member, member from seed_deals
      `);
      await tx.execute(sql`
        insert into "values" (workspace_id, version_id, attribute_id, record_id, owner_id, number_value, text_value, active_from, set_by_type, set_by_id, set_by_member_id)
        select ${workspaceId}, uuidv7(), ${attr('deal.value')}, id, id, round((r4 * 250000)::numeric, 2), 'USD', made, 'member', member, member
        from seed_deals where r4 < 0.85
      `);
      await tx.execute(sql`
        insert into "values" (workspace_id, version_id, attribute_id, record_id, owner_id, date_value, active_from, set_by_type, set_by_id, set_by_member_id)
        select ${workspaceId}, uuidv7(), ${attr('deal.close_date')}, id, id, (made + r5 * interval '200 days')::date, made, 'member', member, member
        from seed_deals where r5 < 0.9
      `);
      await tx.execute(sql`
        insert into "values" (workspace_id, version_id, attribute_id, record_id, owner_id, number_value, active_from, set_by_type, set_by_id, set_by_member_id)
        select ${workspaceId}, uuidv7(), ${attr('deal.probability')}, id, id, floor(r6 * 101), made, 'member', member, member
        from seed_deals
      `);
      await tx.execute(sql`
        insert into "values" (workspace_id, version_id, attribute_id, record_id, owner_id, option_id, active_from, set_by_type, set_by_id, set_by_member_id)
        select ${workspaceId}, uuidv7(), ${attr('deal.source')}, id, id,
          (${uuids(sources)})[case when r7 < 0.2 then 1 else 2 + floor((r7 - 0.2) / 0.8 * ${sources.length - 1}::int)::int end],
          made, 'member', member, member
        from seed_deals
      `);
      await tx.execute(sql`
        insert into "values" (workspace_id, version_id, attribute_id, record_id, owner_id, option_id, active_from, set_by_type, set_by_id, set_by_member_id)
        select ${workspaceId}, uuidv7(), ${attr('deal.deal_type')}, id, id, (${uuids(dealTypes)})[case when r8 < 0.6 then 1 else 2 end],
          made, 'member', member, member
        from seed_deals
      `);
      await tx.execute(sql`
        insert into "values" (workspace_id, version_id, attribute_id, record_id, owner_id, text_value, active_from, set_by_type, set_by_id, set_by_member_id)
        select ${workspaceId}, uuidv7(), ${attr('deal.next_step')}, id, id, (${texts(steps)})[1 + floor(r1 * 5)::int] || ' (' || n || ')',
          made, 'member', member, member
        from seed_deals where r2 < 0.5
      `);
      await tx.execute(sql`
        insert into record_links (workspace_id, version_id, relationship_id, from_record_id, to_record_id, position, to_position,
          from_single, to_single, active_from, set_by_type, set_by_id, set_by_member_id)
        select ${workspaceId}, uuidv7(), ${relationship}, d.id, c.id, 0, (d.n / ${COMPANIES}::int)::int, true, false, d.made, 'member', d.member, d.member
        from seed_deals d
        join (select id, row_number() over (order by id) - 1 as k from records where object_id = ${companies}) c
          on c.k = d.n % ${COMPANIES}::int
        where d.r8 < 0.9
      `);
    });
    log(`deals ${String(end)}`);
  }

  // A pipeline list over the first deals, with an entry stage and a due date.
  const { listId } = await defineList(scope, { objectId: deals, apiSlug: 'pipeline', name: 'Pipeline' });
  const listStage = (await defineAttribute(scope, { listId, apiSlug: 'stage', title: 'Stage', type: 'status' }))
    .attributeId;
  const due = (await defineAttribute(scope, { listId, apiSlug: 'due', title: 'Due', type: 'date' })).attributeId;
  const listStages: string[] = [];
  for (const label of ['Sourced', 'Qualified', 'Committed', 'Closed']) {
    listStages.push((await defineOption(scope, { attributeId: listStage, label, hue: 'green' })).optionId);
  }
  for (let offset = 0; offset < env.SEED_SCALE_ENTRIES; offset += CHUNK) {
    await run(async (tx) => {
      await tx.execute(sql`
        create temp table seed_entries on commit drop as
        select uuidv7() as id, r.id as record_id, random() as r1, random() as r2, r.created_at as made
        from records r where r.object_id = ${deals} order by r.id offset ${offset} limit ${Math.min(CHUNK, env.SEED_SCALE_ENTRIES - offset)}
      `);
      await tx.execute(sql`
        insert into list_entries (workspace_id, id, list_id, record_id, created_at, updated_at, created_by_type, updated_by_type)
        select ${workspaceId}, id, ${listId}, record_id, made, made, 'system', 'system' from seed_entries
      `);
      await tx.execute(sql`
        insert into "values" (workspace_id, version_id, attribute_id, entry_id, owner_id, option_id, active_from, set_by_type)
        select ${workspaceId}, uuidv7(), ${listStage}, id, id, (${uuids(listStages)})[1 + floor(r1 * 4)::int], made, 'system' from seed_entries
      `);
      await tx.execute(sql`
        insert into "values" (workspace_id, version_id, attribute_id, entry_id, owner_id, date_value, active_from, set_by_type)
        select ${workspaceId}, uuidv7(), ${due}, id, id, (made + r2 * interval '90 days')::date, made, 'system' from seed_entries
        where r2 < 0.9
      `);
    });
    log(`entries ${String(Math.min(offset + CHUNK, env.SEED_SCALE_ENTRIES))}`);
  }

  await run(async (tx) => {
    await tx.execute(sql`update lists set entry_count = ${env.SEED_SCALE_ENTRIES} where id = ${listId}`);
    await tx.execute(
      sql`update workspace_counters set live_records = (select count(*) from records where workspace_id = ${workspaceId} and deleted_at is null) where workspace_id = ${workspaceId}`,
    );
  });
  await run((tx) => tx.execute(sql`analyze records; analyze "values"; analyze record_links; analyze list_entries`));
  log(`done: workspace ${workspaceId}, deals ${deals}, list ${listId}`);
} finally {
  await db.close();
}
