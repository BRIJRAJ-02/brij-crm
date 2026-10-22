// Relation columns in an import (spec 0040, owner decision 7): a column
// matched to a relationship attribute holds names, and each name links an
// existing record of the far object, found by the far object's unique
// attributes (a domain, an email) and then by its exact name, ignoring case.
// Only records the member can read are found; a name that matches nothing,
// or several records, is left out and said on the row. With the column's
// `createMissing`, a name that matches nothing makes a far record instead.
// Names are resolved a batch at a time, never a row at a time.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { visibleRecords } from '../access/visibility.ts';
import type { EngineScope } from '../engine/scope.ts';
import { isArchivedNow, type AttributeDef } from '../engine/values.ts';
import { parseAttributeInput } from '../engine/parse-value.ts';

/** The far objects of a relationship attribute, with each one's unique attributes and its name attribute. */
export interface FarObject {
  readonly objectId: string;
  readonly uniqueIds: readonly string[];
  readonly nameAttributeId: string | undefined;
}

/** The objects at the far end of a relationship attribute, each with what a name is matched against. */
export async function farObjects(tx: WorkspaceTx, attribute: AttributeDef): Promise<readonly FarObject[]> {
  if (attribute.relationshipId === null) return [];
  const ends = await tx.execute<{ far: string | null; targets: string[] | null }>(sql`
    select (case when rel.from_attribute_id = ${attribute.id}::uuid then ta.object_id else fa.object_id end)::text as far,
      rel.target_object_ids::text[] as targets
    from relationships rel
    left join attributes ta on ta.workspace_id = rel.workspace_id and ta.id = rel.to_attribute_id
    left join attributes fa on fa.workspace_id = rel.workspace_id and fa.id = rel.from_attribute_id
    where rel.id = ${attribute.relationshipId}::uuid
  `);
  const [end] = ends.rows;
  if (end === undefined) return [];
  const objectIds = end.far !== null ? [end.far] : (end.targets ?? []);
  if (objectIds.length === 0) return [];
  const rows = await tx.execute<{ object_id: string; unique_ids: string[] | null; name_id: string | null }>(sql`
    select o.id::text as object_id, o.primary_attribute_id::text as name_id,
      (select array_agg(a.id::text) from attributes a
        where a.workspace_id = o.workspace_id and a.object_id = o.id and a.is_unique and a.archived_at is null) as unique_ids
    from objects o
    where o.id = any(array(select jsonb_array_elements_text(${JSON.stringify(objectIds)}::jsonb))::uuid[])
      and o.archived_at is null
  `);
  return rows.rows.map((row) => ({
    objectId: row.object_id,
    uniqueIds: row.unique_ids ?? [],
    nameAttributeId: row.name_id ?? undefined,
  }));
}

/** The keys a written name might be held under: as typed (lower case), and as a bare domain. */
function keysOf(name: string): readonly string[] {
  const lower = name.trim().toLowerCase();
  const domain = lower
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');
  return [...new Set([lower, domain].filter((key) => key !== ''))];
}

/** How one name resolved: the record it links, or why it links none (`missing` for no record at all). */
export type Resolved =
  | { readonly ok: true; readonly objectId: string; readonly recordId: string }
  | { readonly ok: false; readonly missing: boolean; readonly reason: string };

/** A name as a cell holds it: trimmed, at most 500 characters. */
export const nameKey = (name: string): string => name.trim().slice(0, 500);

/**
 * What two names share when they mean one record: a domain however it is
 * written ("https://www.acme.com/", "Acme.com"), anything else ignoring
 * case. Resolution answers by it, so a file's names make one record each.
 */
export const foldName = (name: string): string => domainOf(name) ?? nameKey(name).toLowerCase();

/** One candidate a lookup found for a name. */
interface Candidate {
  readonly name: string;
  readonly objectId: string;
  readonly recordId: string;
}

/** Turns a JS array into the SQL array the lookups read, through jsonb so any size stays one parameter. */
const textArray = (items: readonly string[]) =>
  sql`array(select jsonb_array_elements_text(${JSON.stringify(items)}::jsonb))`;

/**
 * Resolves many names at once (the scale check: no round trip a row): one
 * query over the far objects' unique keys (a domain, an email), one over
 * their names for the names no key found, each an index probe, then one
 * visibility check over every candidate. A name links the one live record
 * the member can read that it names; none is `missing`, several leave it
 * out. Answers by `foldName`.
 */
export async function resolveNames(
  tx: WorkspaceTx,
  scope: EngineScope,
  far: readonly FarObject[],
  names: readonly string[],
): Promise<ReadonlyMap<string, Resolved>> {
  const firsts = new Map<string, string>();
  for (const name of names.map(nameKey))
    if (name !== '' && !firsts.has(foldName(name))) firsts.set(foldName(name), name);
  const wanted = [...firsts.values()];
  const answer = new Map<string, Resolved>();
  if (wanted.length === 0) return answer;
  const uniqueIds = far.flatMap((each) => each.uniqueIds);
  const objectIds = far.map((each) => each.objectId);
  const nameIds = far.flatMap((each) => (each.nameAttributeId === undefined ? [] : [each.nameAttributeId]));

  const byKey: Candidate[] = [];
  if (uniqueIds.length > 0) {
    const namesOfKey = new Map<string, string[]>();
    for (const name of wanted) {
      for (const key of keysOf(name)) namesOfKey.set(key, [...(namesOfKey.get(key) ?? []), name]);
    }
    const found = await tx.execute<{ key: string; object_id: string; record_id: string }>(sql`
      select distinct v.unique_key as key, r.object_id::text as object_id, r.id::text as record_id from "values" v
      join records r on r.workspace_id = v.workspace_id and r.id = v.record_id
      where v.workspace_id = ${scope.workspaceId}
        and v.attribute_id = any(${textArray(uniqueIds)}::uuid[])
        and v.unique_key = any(${textArray([...namesOfKey.keys()])})
        and v.active_until is null and r.deleted_at is null
    `);
    for (const row of found.rows) {
      for (const name of namesOfKey.get(row.key) ?? []) {
        byKey.push({ name, objectId: row.object_id, recordId: row.record_id });
      }
    }
  }
  // Only a key held by a readable record settles a name; one held by a record the member can't read falls to the name.
  const keySeen = await visibleRecords(
    tx,
    scope.access,
    byKey.map((each) => ({ objectId: each.objectId, recordId: each.recordId })),
  );
  const keyed = new Set(byKey.filter((each) => keySeen.has(each.recordId)).map((each) => each.name));
  const byName: Candidate[] = [];
  const unkeyed = wanted.filter((name) => !keyed.has(name));
  if (nameIds.length > 0 && unkeyed.length > 0) {
    // The text index's own expression, so each name is an index probe at a million records; five a name at most.
    const found = await tx.execute<{ name: string; object_id: string; record_id: string }>(sql`
      select n.name, c.object_id, c.record_id
      from unnest(${textArray(unkeyed)}) as n(name)
      cross join lateral (
        select distinct r.object_id::text as object_id, r.id::text as record_id from "values" v
        join records r on r.workspace_id = v.workspace_id and r.id = v.record_id
        where v.workspace_id = ${scope.workspaceId}
          and v.attribute_id = any(${textArray(nameIds)}::uuid[])
          and (lower(left(v.text_value, 256)) collate "und-x-icu") = (lower(left(n.name, 256)) collate "und-x-icu")
          and v.active_until is null and not v.is_cleared and v.text_value is not null and r.deleted_at is null
          and r.object_id = any(${textArray(objectIds)}::uuid[])
        limit 5
      ) c
    `);
    for (const row of found.rows) byName.push({ name: row.name, objectId: row.object_id, recordId: row.record_id });
  }
  const nameSeen = await visibleRecords(
    tx,
    scope.access,
    byName.map((each) => ({ objectId: each.objectId, recordId: each.recordId })),
  );
  const seen = new Set([...keySeen, ...nameSeen]);
  for (const name of wanted) {
    const readable = (list: readonly Candidate[]) => [
      ...new Map(
        list.filter((each) => each.name === name && seen.has(each.recordId)).map((each) => [each.recordId, each]),
      ).values(),
    ];
    const keys = readable(byKey);
    const found = keys.length > 0 ? keys : readable(byName);
    const [only] = found;
    const fold = foldName(name);
    if (only === undefined)
      answer.set(fold, { ok: false, missing: true, reason: `No record called “${name}” to link.` });
    else if (found.length > 1)
      answer.set(fold, {
        ok: false,
        missing: false,
        reason: `Several records are called “${name}”, so none was linked.`,
      });
    else answer.set(fold, { ok: true, objectId: only.objectId, recordId: only.recordId });
  }
  return answer;
}

/** A staged relation cell: `{ names }`, or undefined for anything else. */
export function namesOf(value: unknown): readonly string[] | undefined {
  if (typeof value !== 'object' || value === null || !('names' in value)) return undefined;
  const { names } = value;
  if (!Array.isArray(names)) return undefined;
  return names
    .filter((name): name is string => typeof name === 'string' && name.trim() !== '')
    .map(nameKey)
    .slice(0, 50);
}

/** The names of a relation cell the attribute takes: every one for a list of links, the first for one link. */
export const namesTaken = (attribute: Pick<AttributeDef, 'isMulti'>, names: readonly string[]): readonly string[] =>
  attribute.isMulti ? names : names.slice(0, 1);

/**
 * A relation cell's names as the attribute's value (the links found, one or
 * several by its cardinality), from names resolved for the whole batch, with
 * a note for each name left out. Pure.
 */
export function linkValue(
  attribute: Pick<AttributeDef, 'isMulti'>,
  names: readonly string[],
  resolved: ReadonlyMap<string, Resolved>,
): { readonly value: unknown; readonly notes: readonly string[] } {
  const links: { objectId: string; recordId: string }[] = [];
  const notes: string[] = [];
  for (const name of namesTaken(attribute, names)) {
    const each = resolved.get(foldName(name)) ?? {
      ok: false,
      missing: true,
      reason: `No record called “${name}” to link.`,
    };
    if (!each.ok) {
      notes.push(each.reason);
      continue;
    }
    if (!links.some((link) => link.recordId === each.recordId)) {
      links.push({ objectId: each.objectId, recordId: each.recordId });
    }
  }
  if (links.length === 0) return { value: undefined, notes };
  return { value: attribute.isMulti ? links : links[0], notes };
}

/** A name as a bare domain when it reads as one ("acme.com", "https://www.acme.com/about"), else undefined. */
export function domainOf(name: string): string | undefined {
  const domain = name
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain) ? domain : undefined;
}

/**
 * The values a record made for a name that linked to none starts with
 * (`createMissing`): an email address goes to the far object's unique email
 * attribute, a domain to its unique domain attribute (and the name as
 * typed to its name), anything else to its name. Each value is checked by
 * its type; undefined when nothing fits.
 */
export function madeValues(
  attributes: ReadonlyMap<string, AttributeDef>,
  nameAttributeId: string | undefined,
  name: string,
): Record<string, unknown> | undefined {
  const live = [...attributes.values()].filter((each) => !isArchivedNow(each));
  const uniqueOf = (type: AttributeDef['type']) => live.find((each) => each.isUnique && each.type === type);
  const values: Record<string, unknown> = {};
  const put = (attribute: AttributeDef | undefined, raw: unknown) => {
    if (attribute === undefined) return;
    const input = attribute.isMulti && !Array.isArray(raw) ? [raw] : raw;
    const parsed = parseAttributeInput(attribute, input);
    if (parsed.ok) values[attribute.id] = parsed.value;
  };
  const nameAttribute = nameAttributeId === undefined ? undefined : attributes.get(nameAttributeId);
  const putName = (text: string) => {
    if (nameAttribute?.type === 'personal_name') {
      const space = text.lastIndexOf(' ');
      put(
        nameAttribute,
        space <= 0 ? { firstName: text } : { firstName: text.slice(0, space).trim(), lastName: text.slice(space + 1) },
      );
    } else if (nameAttribute?.type === 'text') put(nameAttribute, text);
  };
  const email = uniqueOf('email');
  const domain = domainOf(name);
  const domainAttribute = uniqueOf('domain');
  if (email !== undefined && name.includes('@')) put(email, name);
  else if (domainAttribute !== undefined && domain !== undefined) {
    put(domainAttribute, domain);
    putName(name);
  } else putName(name);
  return Object.keys(values).length === 0 ? undefined : values;
}
