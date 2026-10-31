// Record facts for routing (spec 0043, AC-1603, AC-1610): the fields a team
// page's rules read, of the person the visitor's email names and of that
// person's company, reached through People's Company field and no other link.
// Read inside the booking's own transaction, the way a returning guest's
// owner is (spec 0029, AC-739); only ever used to choose among hosts, never
// answered to the visitor. Every read runs in the page's workspace under row
// level security, so a person or field of another workspace is never found.
// The email is the one the visitor typed, unchecked: an accepted risk (spec
// 0043 rationale, Risks), since the most it shows is which host takes the
// booking. One query for the definitions, one for People's Company field when
// a rule reads the company, one for the person and company, one for the
// values; at most 10 fields.
//
// Spec 0037 (AC-1393) adds a deal's fields and Known, under the same rule
// (AC-1377): `deal.<attributeId>` reads the most recently updated open deal
// (its stage not won or lost) linked to the person, else to their company;
// `crm.known` is New, Known person, Known company or Customer (a deal of
// either in a Won means stage). Each costs one more query, only when a rule
// reads it.
import { sql } from 'drizzle-orm';
import { KNOWN_FACT, RECORD_FACT, type KnownValue, type WonStage } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { readWonStage } from './settings.ts';

/** At most this many record fields one decision reads (Known counts as one). */
export const RECORD_FACTS_MAX = 10;

/** The record facts read, and the keys that can't be (an archived field, or one not on People, Companies or Deals). */
export interface RecordFacts {
  readonly facts: Readonly<Record<string, unknown>>;
  readonly unreadable: ReadonlySet<string>;
}

/** Where to look: the workspace's People and Companies objects. */
export interface RecordFactObjects {
  readonly people: string;
  readonly companies: string;
}

/** How a person reaches their company: the relationship behind People's Company field, and the person's end of it. */
interface CompanyPath {
  readonly relationshipId: string;
  readonly personEnd: 'from' | 'to';
}

/**
 * People's live Company field (the standard relationship to Companies, spec
 * 0014) as the path from a person to their company. Undefined when the field
 * is archived or gone, so the company's fields can't be read: a person linked
 * to a company by some other relationship (an advisor, an investor) is never
 * read as working there.
 */
async function companyPath(tx: WorkspaceTx, objects: RecordFactObjects): Promise<CompanyPath | undefined> {
  const found = await tx.execute<{ relationship_id: string; person_end: 'from' | 'to' }>(sql`
    select r.id::text as relationship_id, case when r.from_attribute_id = a.id then 'from' else 'to' end as person_end
    from attributes a
    join relationships r on r.workspace_id = a.workspace_id and r.id = a.relationship_id
    where a.object_id = ${objects.people}::uuid and a.api_slug = 'company' and a.type = 'record_reference'
      and a.archived_at is null
    limit 1
  `);
  const [row] = found.rows;
  return row === undefined ? undefined : { relationshipId: row.relationship_id, personEnd: row.person_end };
}

/** The person's first live company along `path`, by that end's own order; one indexed range of `record_links`. */
function companyOf(path: CompanyPath | undefined, objects: RecordFactObjects) {
  if (path === undefined) return sql`null::text`;
  const [personSide, companySide, order] =
    path.personEnd === 'from'
      ? [sql`l.from_record_id`, sql`l.to_record_id`, sql`l.position`]
      : [sql`l.to_record_id`, sql`l.from_record_id`, sql`l.to_position`];
  return sql`(
    select c.id::text
    from record_links l
    join records c on c.workspace_id = l.workspace_id and c.id = ${companySide} and c.deleted_at is null
      and c.object_id = ${objects.companies}::uuid
    where l.relationship_id = ${path.relationshipId}::uuid and ${personSide} = p.record_id and l.active_until is null
    order by ${order}, l.active_from
    limit 1
  )`;
}

/** One field a rule reads, by its record and attribute. */
interface Wanted {
  readonly key: string;
  readonly side: 'person' | 'company' | 'deal';
  readonly attributeId: string;
}

/** The workspace's Deals object and its live Stage field, when either a deal field or Known is read. */
async function dealsOf(tx: WorkspaceTx): Promise<{ readonly id: string; readonly stageId?: string } | undefined> {
  const found = await tx.execute<{ id: string; stage_id: string | null }>(sql`
    select o.id::text, (
      select a.id::text from attributes a
      where a.object_id = o.id and a.api_slug = 'stage' and a.archived_at is null
      limit 1
    ) as stage_id
    from objects o
    where o.standard_key = 'deals' and o.archived_at is null
    limit 1
  `);
  const [row] = found.rows;
  if (row === undefined) return undefined;
  return { id: row.id, ...(row.stage_id === null ? {} : { stageId: row.stage_id }) };
}

/** The live deals linked to `recordId` by any current link, as one indexed range of `record_links` each way. */
function dealsLinkedTo(recordId: string, side: number) {
  return sql`
    select l.to_record_id as deal_id, ${side}::int as side from record_links l
    where l.from_record_id = ${recordId}::uuid and l.active_until is null
    union all
    select l.from_record_id, ${side}::int from record_links l
    where l.to_record_id = ${recordId}::uuid and l.active_until is null
  `;
}

/**
 * The most recently updated open deal (its stage, if any, neither won nor lost) linked to the person, else to their
 * company (AC-1393); and whether any deal of either sits in a Won means stage (Known's Customer).
 */
async function dealFacts(
  tx: WorkspaceTx,
  deals: { readonly id: string; readonly stageId?: string },
  records: { readonly personId: string; readonly companyId?: string },
  wonStage: WonStage | undefined,
): Promise<{ readonly openDealId?: string; readonly isCustomer: boolean }> {
  const linked =
    records.companyId === undefined
      ? dealsLinkedTo(records.personId, 0)
      : sql`${dealsLinkedTo(records.personId, 0)} union all ${dealsLinkedTo(records.companyId, 1)}`;
  const closed =
    deals.stageId === undefined
      ? sql`false`
      : sql`exists (
          select 1 from "values" s
          join attribute_options o on o.workspace_id = s.workspace_id and o.id = s.option_id
          where s.record_id = d.id and s.attribute_id = ${deals.stageId}::uuid and s.active_until is null
            and not s.is_cleared and o.outcome in ('won', 'lost')
        )`;
  const won =
    wonStage === undefined
      ? sql`false`
      : sql`exists (
          select 1 from "values" s
          where s.record_id = d.id and s.attribute_id = ${wonStage.attributeId}::uuid and s.active_until is null
            and not s.is_cleared and s.option_id = any(${`{${wonStage.optionIds.join(',')}}`}::uuid[])
        )`;
  const found = await tx.execute<{ id: string; side: number; closed: boolean; won: boolean }>(sql`
    with linked as (${linked})
    select d.id::text, min(k.side)::int as side, ${closed} as closed, ${won} as won, d.updated_at
    from linked k
    join records d on d.id = k.deal_id and d.object_id = ${deals.id}::uuid and d.deleted_at is null
    group by d.id, d.updated_at
    order by side, d.updated_at desc, d.id
    limit 200
  `);
  const open = found.rows.find((row) => !row.closed);
  return {
    ...(open === undefined ? {} : { openDealId: open.id }),
    isCustomer: found.rows.some((row) => row.won),
  };
}

/**
 * The values of `keys` (`person.<attributeId>`, `company.<attributeId>`, `deal.<attributeId>`, `crm.known`) for the
 * live person holding `email`, their company and their latest open deal. Select and status values read as option
 * ids; text, numbers, dates and booleans as themselves; a field holding several values as a list. No person: no
 * facts but Known's `new`. A company field is unreadable when People's Company field is archived or gone; a deal
 * field when the workspace has no Deals.
 */
export async function recordFacts(
  tx: WorkspaceTx,
  objects: RecordFactObjects,
  email: string,
  keys: readonly string[],
): Promise<RecordFacts> {
  const counted = keys.slice(0, RECORD_FACTS_MAX);
  const readsKnown = counted.includes(KNOWN_FACT);
  const wanted: Wanted[] = counted.flatMap((key) => {
    const match = RECORD_FACT.exec(key);
    const [, side, attributeId] = match ?? [];
    return side === 'person' || side === 'company' || side === 'deal'
      ? [{ key, side, attributeId: attributeId ?? '' }]
      : [];
  });
  const unreadable = new Set(keys.slice(RECORD_FACTS_MAX));
  if (wanted.length === 0 && !readsKnown) return { facts: {}, unreadable };
  const readsDeals = readsKnown || wanted.some((each) => each.side === 'deal');
  const deals = readsDeals ? await dealsOf(tx) : undefined;
  const ids = wanted.map((each) => each.attributeId);
  const live =
    ids.length === 0
      ? { rows: [] }
      : await tx.execute<{ id: string; object_id: string }>(sql`
          select id::text, object_id::text from attributes
          where id = any(${`{${ids.join(',')}}`}::uuid[]) and archived_at is null
        `);
  const objectOf = new Map(live.rows.map((row) => [row.id, row.object_id]));
  const home = { person: objects.people, company: objects.companies, deal: deals?.id } as const;
  const onObject = wanted.filter((each) => {
    const ok = home[each.side] !== undefined && objectOf.get(each.attributeId) === home[each.side];
    if (!ok) unreadable.add(each.key);
    return ok;
  });
  // A deal falls back to the company's, and Known reads the company: both need the path to it.
  const needsCompany = readsKnown || onObject.some((each) => each.side !== 'person');
  const path = needsCompany ? await companyPath(tx, objects) : undefined;
  const readable = onObject.filter((each) => {
    const ok = each.side !== 'company' || path !== undefined;
    if (!ok) unreadable.add(each.key);
    return ok;
  });
  if ((readable.length === 0 && !readsKnown) || email === '') {
    return { facts: readsKnown && email !== '' ? { [KNOWN_FACT]: 'new' } : {}, unreadable };
  }
  const found = await tx.execute<{ person_id: string; company_id: string | null }>(sql`
    with person as (
      select e.record_id
      from "values" e
      join attributes ea on ea.id = e.attribute_id and ea.object_id = ${objects.people}::uuid
        and ea.api_slug = 'email_addresses'
      join records r on r.workspace_id = e.workspace_id and r.id = e.record_id and r.deleted_at is null
      where e.unique_key = ${email.trim().toLowerCase()} and e.active_until is null
      limit 1
    )
    select p.record_id::text as person_id, ${companyOf(path, objects)} as company_id
    from person p
  `);
  const [records] = found.rows;
  if (records === undefined) return { facts: readsKnown ? { [KNOWN_FACT]: 'new' } : {}, unreadable };
  const companyId = records.company_id ?? undefined;
  const readsDealRows = readsKnown || readable.some((each) => each.side === 'deal');
  const linked =
    readsDealRows && deals !== undefined
      ? await dealFacts(
          tx,
          deals,
          { personId: records.person_id, ...(companyId === undefined ? {} : { companyId }) },
          readsKnown ? await readWonStage(tx) : undefined,
        )
      : { isCustomer: false };
  const recordOf = (side: Wanted['side']) =>
    side === 'person' ? records.person_id : side === 'company' ? companyId : linked.openDealId;
  const recordIds = [...new Set(readable.flatMap((each) => recordOf(each.side) ?? []))];
  const values =
    recordIds.length === 0
      ? { rows: [] }
      : await tx.execute<{ record_id: string; attribute_id: string; value: string | null }>(sql`
          select record_id::text, attribute_id::text,
            coalesce(option_id::text, text_value, trim_scale(number_value)::text, date_value::text,
              case when bool_value is null then null when bool_value then 'yes' else 'no' end,
              case when jsonb_typeof(json_value) = 'string' then json_value #>> '{}' end) as value
          from "values"
          where record_id = any(${`{${recordIds.join(',')}}`}::uuid[])
            and attribute_id = any(${`{${readable.map((each) => each.attributeId).join(',')}}`}::uuid[])
            and active_until is null and not is_cleared
          order by position
        `);
  const facts: Record<string, unknown> = {};
  for (const each of readable) {
    const recordId = recordOf(each.side);
    if (recordId === undefined) continue;
    const held = values.rows
      .filter((row) => row.record_id === recordId && row.attribute_id === each.attributeId && row.value !== null)
      .map((row) => row.value ?? '');
    if (held.length > 0) facts[each.key] = held;
  }
  if (readsKnown) {
    const known: KnownValue = linked.isCustomer ? 'customer' : companyId !== undefined ? 'company' : 'person';
    facts[KNOWN_FACT] = known;
  }
  return { facts, unreadable };
}
