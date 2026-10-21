// Relation columns in an import (spec 0040, owner decision 7): a column
// matched to a relationship attribute holds names, and each name links an
// existing record of the far object, found by the far object's unique
// attributes (a domain, an email) and then by its exact name, ignoring case.
// Only records the member can read are found; a name that matches nothing,
// or several records, is left out and said on the row. Nothing is created.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { visibleRecords } from '../access/visibility.ts';
import type { EngineScope } from '../engine/scope.ts';
import type { AttributeDef } from '../engine/values.ts';

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

/** How one name resolved: the record it links, or why it links none. */
type Resolved =
  | { readonly ok: true; readonly objectId: string; readonly recordId: string }
  | { readonly ok: false; readonly reason: string };

/** Finds one readable live record for a name, through the unique keys first, then the name. */
async function resolveOne(
  tx: WorkspaceTx,
  scope: EngineScope,
  far: readonly FarObject[],
  name: string,
): Promise<Resolved> {
  const keys = keysOf(name);
  const uniqueIds = far.flatMap((each) => each.uniqueIds);
  const objectIds = far.map((each) => each.objectId);
  const candidates: { object_id: string; record_id: string }[] = [];
  if (uniqueIds.length > 0) {
    const byKey = await tx.execute<{ object_id: string; record_id: string }>(sql`
      select distinct r.object_id::text as object_id, r.id::text as record_id from "values" v
      join records r on r.workspace_id = v.workspace_id and r.id = v.record_id
      where v.workspace_id = ${scope.workspaceId}
        and v.attribute_id = any(array(select jsonb_array_elements_text(${JSON.stringify(uniqueIds)}::jsonb))::uuid[])
        and v.unique_key = any(array(select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)))
        and v.active_until is null and r.deleted_at is null
      limit 3
    `);
    candidates.push(...byKey.rows);
  }
  if (candidates.length === 0) {
    const nameIds = far.flatMap((each) => (each.nameAttributeId === undefined ? [] : [each.nameAttributeId]));
    if (nameIds.length > 0) {
      // The text index's own expression, so the lookup is an index probe at a million records.
      const byName = await tx.execute<{ object_id: string; record_id: string }>(sql`
        select distinct r.object_id::text as object_id, r.id::text as record_id from "values" v
        join records r on r.workspace_id = v.workspace_id and r.id = v.record_id
        where v.workspace_id = ${scope.workspaceId}
          and v.attribute_id = any(array(select jsonb_array_elements_text(${JSON.stringify(nameIds)}::jsonb))::uuid[])
          and (lower(left(v.text_value, 256)) collate "und-x-icu") = (lower(left(${name.trim()}, 256)) collate "und-x-icu")
          and v.active_until is null and v.text_value is not null and r.deleted_at is null
          and r.object_id = any(array(select jsonb_array_elements_text(${JSON.stringify(objectIds)}::jsonb))::uuid[])
        limit 3
      `);
      candidates.push(...byName.rows);
    }
  }
  const seen = await visibleRecords(
    tx,
    scope.access,
    candidates.map((each) => ({ objectId: each.object_id, recordId: each.record_id })),
  );
  const readable = candidates.filter((each) => seen.has(each.record_id));
  const [only] = readable;
  if (only === undefined) return { ok: false, reason: `No record called “${name.trim()}” to link.` };
  if (readable.length > 1)
    return { ok: false, reason: `Several records are called “${name.trim()}”, so none was linked.` };
  return { ok: true, objectId: only.object_id, recordId: only.record_id };
}

/** A staged relation cell: `{ names }`, or undefined for anything else. */
export function namesOf(value: unknown): readonly string[] | undefined {
  if (typeof value !== 'object' || value === null || !('names' in value)) return undefined;
  const { names } = value;
  if (!Array.isArray(names)) return undefined;
  return names.filter((name): name is string => typeof name === 'string' && name.trim() !== '').slice(0, 50);
}

/**
 * A relation cell's names as the attribute's value (the links found, one or
 * several by its cardinality), with a note for each name left out. A single
 * link takes the first name found.
 */
export async function resolveLinks(
  tx: WorkspaceTx,
  scope: EngineScope,
  attribute: AttributeDef,
  far: readonly FarObject[],
  names: readonly string[],
): Promise<{ readonly value: unknown; readonly notes: readonly string[] }> {
  const links: { objectId: string; recordId: string }[] = [];
  const notes: string[] = [];
  for (const name of attribute.isMulti ? names : names.slice(0, 1)) {
    const resolved = await resolveOne(tx, scope, far, name);
    if (!resolved.ok) {
      notes.push(resolved.reason);
      continue;
    }
    if (!links.some((link) => link.recordId === resolved.recordId)) {
      links.push({ objectId: resolved.objectId, recordId: resolved.recordId });
    }
  }
  if (links.length === 0) return { value: undefined, notes };
  return { value: attribute.isMulti ? links : links[0], notes };
}
