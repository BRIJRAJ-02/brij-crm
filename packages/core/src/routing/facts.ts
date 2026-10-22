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
import { sql } from 'drizzle-orm';
import { RECORD_FACT } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';

/** At most this many record fields one decision reads. */
export const RECORD_FACTS_MAX = 10;

/** The record facts read, and the keys that can't be (an archived field, or one not on People or Companies). */
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

/**
 * The values of `keys` (`person.<attributeId>`, `company.<attributeId>`) for
 * the live person holding `email` and their company. Select and status values
 * read as option ids; text, numbers, dates and booleans as themselves; a field
 * holding several values as a list. No person, no company: no facts (empty,
 * so a rule over them doesn't match), never unreadable. A company field is
 * unreadable when People's Company field is archived or gone.
 */
export async function recordFacts(
  tx: WorkspaceTx,
  objects: RecordFactObjects,
  email: string,
  keys: readonly string[],
): Promise<RecordFacts> {
  const wanted = keys.slice(0, RECORD_FACTS_MAX).flatMap((key) => {
    const match = RECORD_FACT.exec(key);
    const [, side, attributeId] = match ?? [];
    return side === 'person' || side === 'company' ? [{ key, side, attributeId: attributeId ?? '' }] : [];
  });
  const unreadable = new Set(keys.slice(RECORD_FACTS_MAX));
  if (wanted.length === 0) return { facts: {}, unreadable };
  const ids = wanted.map((each) => each.attributeId);
  const live = await tx.execute<{ id: string; object_id: string }>(sql`
    select id::text, object_id::text from attributes
    where id = any(${`{${ids.join(',')}}`}::uuid[]) and archived_at is null
  `);
  const objectOf = new Map(live.rows.map((row) => [row.id, row.object_id]));
  const onObject = wanted.filter((each) => {
    const ok = objectOf.get(each.attributeId) === (each.side === 'person' ? objects.people : objects.companies);
    if (!ok) unreadable.add(each.key);
    return ok;
  });
  const path = onObject.some((each) => each.side === 'company') ? await companyPath(tx, objects) : undefined;
  const readable = onObject.filter((each) => {
    const ok = each.side === 'person' || path !== undefined;
    if (!ok) unreadable.add(each.key);
    return ok;
  });
  if (readable.length === 0 || email === '') return { facts: {}, unreadable };
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
  if (records === undefined) return { facts: {}, unreadable };
  const recordIds = [records.person_id, ...(records.company_id === null ? [] : [records.company_id])];
  const values = await tx.execute<{ record_id: string; attribute_id: string; value: string | null }>(sql`
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
  const facts: Record<string, string[]> = {};
  for (const each of readable) {
    const recordId = each.side === 'person' ? records.person_id : records.company_id;
    if (recordId === null) continue;
    const held = values.rows
      .filter((row) => row.record_id === recordId && row.attribute_id === each.attributeId && row.value !== null)
      .map((row) => row.value ?? '');
    if (held.length > 0) facts[each.key] = held;
  }
  return { facts, unreadable };
}
