// Likely duplicates (spec 0049, AC-4901 to AC-4909, AC-4920): the check of a
// draft while a member types, the paged pairs of the Duplicates page and the
// record banner, and "Not a duplicate" with its Undo.
//
// Two live records of one object are a likely pair when a rule holds (AC-4901):
// People by the same name and the same Company, or a shared email; Companies by
// the same name or a shared domain; any other object by the same name, or a
// shared value in one of its email or domain attributes. Matching is equality on
// `values.match_key` (AC-4902, written with each value by `crm_match_key`), a
// leakproof comparison, so `values_match` answers it under row level security.
//
// Access is applied inside each statement (AC-4920): the object's level first,
// a rule only when the reader may see every attribute it reads, and the record
// rule on both records of a pair as SQL. Nothing is filtered after a query, so
// a pair whose other record is hidden is simply absent.
import { sql, type SQL } from 'drizzle-orm';
import type { DuplicateReason } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { encodeValue } from './columns.ts';
import { canonicalId, isUuid, uuidList } from './ids.ts';
import { parseAttributeInput } from './parse-value.ts';
import { readRecords } from './records.ts';
import { inputInvalid, postgresError, refuse } from './refusals.ts';
import { endOf, relationshipOf } from './relationships.ts';
import type { EngineScope } from './scope.ts';
import { isArchivedNow, loadAttributes, type AttributeDef } from './values.ts';
import { runWrite, type AfterWrite } from './write.ts';
import { isAborted, withCancel } from './query/cancel.ts';
import { attributeVisible, checkObject, recordRuleSql, UNKNOWN_OBJECT, UNKNOWN_RECORD } from '../access/visibility.ts';
import type { RecordRefDisplay } from '@crm/contracts/values';
import { writeAudit } from '../members/audit.ts';

/** The most matches one check answers (AC-4904). */
export const MATCHES_MAX = 3;
/** Pairs per page (AC-4907). */
export const PAIRS_PAGE = 50;
/** The most records one page reads newest first while looking for pairs: what keeps a page bounded at a million. */
export const PAIRS_SCAN = 2_000;
/** How long one duplicates read may run. */
const TIMEOUT = '3s';

/** The order the rules are tried in, which also picks a pair's reason when several hold. */
const RANK: Readonly<Record<DuplicateReason, number>> = { name_company: 0, name: 1, email: 2, domain: 3 };
const REASON_AT: readonly DuplicateReason[] = ['name_company', 'name', 'email', 'domain'];

/** A person's Company as the name rule reads it: the attribute, its relationship, and which link column is the person. */
interface CompanySide {
  readonly attribute: AttributeDef;
  readonly relationshipId: string;
  readonly isFrom: boolean;
}

/** The rules one object's pairs are found by, for one reader: only rules over attributes they may see. */
export interface DuplicateRules {
  readonly objectId: string;
  /** The name rule: the name attribute, its key kind, and on People the Company it must share. */
  readonly name?: {
    readonly attribute: AttributeDef;
    readonly kind: 'name' | 'company_name';
    readonly company?: CompanySide;
  };
  readonly emails: readonly AttributeDef[];
  readonly domains: readonly AttributeDef[];
}

/** A live attribute the reader may see. */
const usable = (scope: EngineScope, attribute: AttributeDef | undefined): attribute is AttributeDef =>
  attribute !== undefined && !isArchivedNow(attribute) && attributeVisible(scope.access, attribute);

/**
 * The rules for `objectId` the reader may use (AC-4901, AC-4903): `NOT_FOUND` for an object they can't see or one
 * that is archived. A person's name rule needs the Company too; a rule over a hidden attribute is left out.
 */
export async function duplicateRules(tx: WorkspaceTx, scope: EngineScope, objectId: string): Promise<DuplicateRules> {
  await checkObject(tx, scope.access, objectId, 'read');
  const found = await tx.execute<{
    standard_key: string | null;
    primary_attribute_id: string | null;
    archived: boolean;
  }>(
    sql`select standard_key, primary_attribute_id::text, archived_at is not null as archived from objects
      where id = ${objectId}::uuid`,
  );
  const [object] = found.rows;
  if (object === undefined) throw refuse('NOT_FOUND', UNKNOWN_OBJECT);
  if (object.archived) throw refuse('NOT_FOUND', 'That object is archived. Restore it first.');
  const attributes = await loadAttributes(tx, objectId);
  const live = [...attributes.values()].filter((attribute) => usable(scope, attribute) && !attribute.isSystem);
  const people = object.standard_key === 'people';
  const companies = object.standard_key === 'companies';
  const emails = companies ? [] : live.filter((attribute) => attribute.type === 'email');
  const domains = people ? [] : live.filter((attribute) => attribute.type === 'domain');
  const primary = object.primary_attribute_id === null ? undefined : attributes.get(object.primary_attribute_id);
  const named = usable(scope, primary) && primary.type !== 'email' && primary.type !== 'domain' ? primary : undefined;
  if (named === undefined) return { objectId, emails, domains };
  if (!people)
    return { objectId, name: { attribute: named, kind: companies ? 'company_name' : 'name' }, emails, domains };
  const company = live.find((attribute) => attribute.apiSlug === 'company' && attribute.type === 'record_reference');
  if (company === undefined || company.relationshipId === null) return { objectId, emails, domains };
  const relationship = await relationshipOf(tx, company);
  const side = { attribute: company, relationshipId: relationship.id, isFrom: endOf(relationship, company.id).isFrom };
  return { objectId, name: { attribute: named, kind: 'name', company: side }, emails, domains };
}

/** The link columns of a person's Company: the person's end, and the company's. */
function companyColumns(side: CompanySide, alias: string): { readonly mine: SQL; readonly far: SQL } {
  return side.isFrom
    ? { mine: sql.raw(`${alias}.from_record_id`), far: sql.raw(`${alias}.to_record_id`) }
    : { mine: sql.raw(`${alias}.to_record_id`), far: sql.raw(`${alias}.from_record_id`) };
}

/** The record rule on alias `alias`, as ` and <rule>`, or nothing when the object has none. */
function ruled(scope: EngineScope, objectId: string, alias: string): SQL {
  const rule = recordRuleSql(scope.access, objectId, alias);
  return rule === undefined ? sql`` : sql` and ${rule}`;
}

/** The text items a draft value holds for an attribute, or none when it doesn't parse (a half typed address). */
function draftTexts(attribute: AttributeDef, value: unknown): readonly string[] {
  const parsed = parseAttributeInput(attribute, value);
  if (!parsed.ok) return [];
  return encodeValue(attribute.type, parsed.value).flatMap((item) => (item.textValue === null ? [] : [item.textValue]));
}

/** The record ids a draft record reference holds. */
function draftRecordIds(attribute: AttributeDef, value: unknown): readonly string[] {
  const parsed = parseAttributeInput(attribute, value);
  if (!parsed.ok || parsed.value === null) return [];
  const items: readonly unknown[] = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
  return items.flatMap((item) =>
    typeof item === 'object' &&
    item !== null &&
    'recordId' in item &&
    typeof item.recordId === 'string' &&
    isUuid(item.recordId)
      ? [canonicalId(item.recordId)]
      : [],
  );
}

/** Each text's match key in one statement, in order, through the migration's `crm_match_key`. */
async function matchKeys(
  tx: WorkspaceTx,
  items: readonly { readonly kind: string; readonly text: string }[],
): Promise<readonly (string | null)[]> {
  if (items.length === 0) return [];
  const rows = await tx.execute<{ key: string | null }>(sql`
    select crm_match_key(x.kind, x.text) as key
    from rows from (jsonb_to_recordset(${JSON.stringify(items.map(({ kind, text }) => ({ kind, text })))}::jsonb)
      as (kind text, text text)) with ordinality as x(kind, text, n)
    order by x.n
  `);
  return rows.rows.map((row) => row.key);
}

/** What `findDuplicates` checks: the object, the draft values by attribute id, and the record being edited. */
export interface FindDuplicatesInput {
  readonly objectId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly excludeRecordId?: string;
}

/** One likely match: the record as a chip shows it, and why. */
export interface DuplicateMatchView {
  readonly record: RecordRefDisplay;
  readonly reason: DuplicateReason;
}

/**
 * Up to 3 live records the draft looks like (AC-4904), the strongest rule first, then the newest: the reader's
 * visible records only (AC-4920), never the record being edited, nor one it was marked "Not a duplicate" with
 * (AC-4903). Each rule branch stops at 4 rows, so a common name costs index lookups, never a scan.
 */
export async function findDuplicates(
  tx: WorkspaceTx,
  scope: EngineScope,
  input: FindDuplicatesInput,
): Promise<readonly DuplicateMatchView[]> {
  const rules = await duplicateRules(tx, scope, input.objectId);
  const objectId = rules.objectId;
  const exclude =
    input.excludeRecordId !== undefined && isUuid(input.excludeRecordId)
      ? canonicalId(input.excludeRecordId)
      : undefined;
  const asked: {
    readonly rank: number;
    readonly attribute: AttributeDef;
    readonly kind: string;
    readonly text: string;
  }[] = [];
  const name = rules.name;
  const companyIds =
    name?.company === undefined ? [] : draftRecordIds(name.company.attribute, input.values[name.company.attribute.id]);
  if (name !== undefined && (name.company === undefined || companyIds.length > 0)) {
    const rank = name.company === undefined ? RANK.name : RANK.name_company;
    for (const text of draftTexts(name.attribute, input.values[name.attribute.id]).slice(0, 1)) {
      asked.push({ rank, attribute: name.attribute, kind: name.kind, text });
    }
  }
  for (const [rank, kind, list] of [
    [RANK.email, 'email', rules.emails],
    [RANK.domain, 'domain', rules.domains],
  ] as const) {
    for (const attribute of list) {
      for (const text of draftTexts(attribute, input.values[attribute.id]).slice(0, 10)) {
        asked.push({ rank, attribute, kind, text });
      }
    }
  }
  if (asked.length === 0) return [];
  const keys = await matchKeys(tx, asked);
  const branches = asked.flatMap((item, index): SQL[] => {
    const key = keys[index];
    if (key === null || key === undefined) return [];
    const company =
      item.rank === RANK.name_company && name?.company !== undefined
        ? (() => {
            const { mine, far } = companyColumns(name.company, 'k');
            return sql` and exists (select 1 from record_links k where k.relationship_id = ${name.company.relationshipId}::uuid
              and k.active_until is null and ${mine} = v.owner_id and ${far} = any(${uuidList(companyIds)}))`;
          })()
        : sql``;
    const notSelf = exclude === undefined ? sql`` : sql` and r.id <> ${exclude}::uuid`;
    const notDismissed =
      exclude === undefined
        ? sql``
        : sql` and not exists (select 1 from record_duplicate_dismissals d
            where (d.low_record_id = r.id and d.high_record_id = ${exclude}::uuid)
               or (d.low_record_id = ${exclude}::uuid and d.high_record_id = r.id))`;
    return [
      sql`(select r.id, ${item.rank}::int as rank, r.created_at from "values" v
        join records r on r.workspace_id = v.workspace_id and r.id = v.owner_id and r.object_id = ${objectId}::uuid
          and r.deleted_at is null${ruled(scope, objectId, 'r')}
        where v.attribute_id = ${item.attribute.id}::uuid and v.active_until is null and v.match_key = ${key}
          ${company}${notSelf}${notDismissed}
        limit ${MATCHES_MAX + 1})`,
    ];
  });
  if (branches.length === 0) return [];
  const found = await tx.execute<{ id: string; rank: number }>(sql`
    select m.id::text as id, min(m.rank)::int as rank from (${sql.join(branches, sql` union all `)}) m
    group by m.id order by min(m.rank), max(m.created_at) desc, m.id desc
    limit ${MATCHES_MAX}
  `);
  const ids = found.rows.map((row) => row.id);
  const display = await displays(tx, scope, ids);
  return found.rows.flatMap((row): DuplicateMatchView[] => {
    const record = display.get(row.id);
    const reason = REASON_AT[row.rank];
    return record === undefined || reason === undefined ? [] : [{ record, reason }];
  });
}

/** Each record's chip, read through the engine's read (whose ids came from statements that applied the door). */
async function displays(
  tx: WorkspaceTx,
  scope: EngineScope,
  ids: readonly string[],
): Promise<ReadonlyMap<string, RecordRefDisplay>> {
  if (ids.length === 0) return new Map();
  const views = await readRecords(tx, scope.access, [...new Set(ids)], { attributeIds: [], visibleAlready: true });
  return new Map(views.map((view) => [view.id, view.display]));
}

/** Where a page of pairs goes on: after this pair (`b` set), or after every pair of record `a` (`b` absent). */
interface PairCursor {
  readonly at: string;
  readonly a: string;
  readonly b?: string;
}

const AT = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:\d{2})?|Z)$/;

/** A cursor as the page answers it: base64url JSON, opaque to the browser. */
function encodeCursor(cursor: PairCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** A cursor back, or `INPUT_INVALID` on `cursor` for anything this file never wrote. */
function decodeCursor(text: string): PairCursor {
  const bad = () => inputInvalid('cursor', 'That page cursor is not valid. Start again from the top.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  if (typeof parsed !== 'object' || parsed === null) throw bad();
  const { at, a, b } = parsed as Record<string, unknown>;
  if (typeof at !== 'string' || !AT.test(at) || typeof a !== 'string' || !isUuid(a)) throw bad();
  if (b !== undefined && (typeof b !== 'string' || !isUuid(b))) throw bad();
  return { at, a: canonicalId(a), ...(typeof b === 'string' ? { b: canonicalId(b) } : {}) };
}

/**
 * The partners of the record aliased `a` (its `id`), each with the rank of the rule that found it, as one
 * `union all` of index lookups: the record's own current keys, then the other current values holding each key.
 * Undefined when the reader may use no rule.
 */
function partnersSql(rules: DuplicateRules): SQL | undefined {
  const parts: SQL[] = [];
  const name = rules.name;
  if (name !== undefined) {
    const company =
      name.company === undefined
        ? sql``
        : (() => {
            const ka = companyColumns(name.company, 'ka');
            const kb = companyColumns(name.company, 'kb');
            return sql` and exists (select 1 from record_links ka
              join record_links kb on kb.workspace_id = ka.workspace_id and kb.relationship_id = ka.relationship_id
                and kb.active_until is null and ${kb.far} = ${ka.far} and ${kb.mine} = vb.owner_id
              where ka.relationship_id = ${name.company.relationshipId}::uuid and ka.active_until is null
                and ${ka.mine} = va.owner_id)`;
          })();
    const rank = name.company === undefined ? RANK.name : RANK.name_company;
    parts.push(sql`select vb.owner_id as id, ${rank}::int as rank from "values" va
      join "values" vb on vb.workspace_id = va.workspace_id and vb.attribute_id = va.attribute_id
        and vb.match_key = va.match_key and vb.active_until is null and vb.owner_id <> va.owner_id
      where va.owner_id = a.id and va.attribute_id = ${name.attribute.id}::uuid and va.active_until is null
        and va.match_key is not null${company}`);
  }
  for (const [rank, list] of [
    [RANK.email, rules.emails],
    [RANK.domain, rules.domains],
  ] as const) {
    if (list.length === 0) continue;
    parts.push(sql`select vb.owner_id as id, ${rank}::int as rank from "values" va
      join "values" vb on vb.workspace_id = va.workspace_id and vb.attribute_id = va.attribute_id
        and vb.match_key = va.match_key and vb.active_until is null and vb.owner_id <> va.owner_id
      where va.owner_id = a.id and va.attribute_id = any(${uuidList(list.map((attribute) => attribute.id))})
        and va.active_until is null and va.match_key is not null`);
  }
  return parts.length === 0 ? undefined : sql.join(parts, sql` union all `);
}

/** The pair of `a` and `b` someone marked "Not a duplicate", as a `not exists` on aliases `a` and `b`. */
const NOT_DISMISSED = sql`not exists (select 1 from record_duplicate_dismissals d
  where (d.low_record_id = a.id and d.high_record_id = b.id) or (d.low_record_id = b.id and d.high_record_id = a.id))`;

/** What a page of pairs asks: the object, optionally one record's pairs only, and where to go on from. */
export interface ListDuplicatePairsInput {
  readonly objectId: string;
  readonly recordId?: string;
  readonly cursor?: string;
}

/** One likely pair: the newer record, the older one, and why. */
export interface DuplicatePairView {
  readonly a: RecordRefDisplay;
  readonly b: RecordRefDisplay;
  readonly reason: DuplicateReason;
}

/** A page of pairs, and the cursor to go on with while there may be more. */
export interface DuplicatePairPage {
  readonly pairs: readonly DuplicatePairView[];
  readonly cursor?: string;
}

/**
 * A page of the object's likely pairs (AC-4907), newest record first: each pair once, under its newer record, a
 * record in several pairs in each. A page reads at most `PAIRS_SCAN` records newest first, so it can hold fewer
 * than 50 pairs, or none, and still answer a cursor. With `recordId`, that record's pairs only (the banner and the
 * page filtered to it, AC-4906), up to 50, its partners newest first; `NOT_FOUND` when the reader can't see it.
 */
export async function listDuplicatePairs(
  tx: WorkspaceTx,
  scope: EngineScope,
  input: ListDuplicatePairsInput,
): Promise<DuplicatePairPage> {
  const rules = await duplicateRules(tx, scope, input.objectId);
  const objectId = rules.objectId;
  const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  const partners = partnersSql(rules);
  if (partners === undefined) return { pairs: [] };
  if (input.recordId !== undefined) return recordPairs(tx, scope, rules, partners, input.recordId, cursor);

  const from =
    cursor === undefined
      ? sql``
      : cursor.b === undefined
        ? sql` and (r.created_at, r.id) < (${cursor.at}::timestamptz, ${cursor.a}::uuid)`
        : sql` and (r.created_at, r.id) <= (${cursor.at}::timestamptz, ${cursor.a}::uuid)`;
  const window = sql`select r.id, r.created_at from records r
    where r.object_id = ${objectId}::uuid and r.deleted_at is null${ruled(scope, objectId, 'r')}${from}
    order by r.created_at desc, r.id desc limit ${PAIRS_SCAN}`;
  const within =
    cursor?.b === undefined
      ? sql``
      : sql` and (a.created_at, a.id, b.id) < (${cursor.at}::timestamptz, ${cursor.a}::uuid, ${cursor.b}::uuid)`;
  const found = await tx.execute<{ a: string; at: string; b: string; rank: number }>(sql`
    with a as materialized (${window})
    select a.id::text as a, a.created_at::text as at, b.id::text as b, min(m.rank)::int as rank
    from a
    cross join lateral (${partners}) m
    join records b on b.workspace_id = ${scope.workspaceId}::uuid and b.id = m.id and b.object_id = ${objectId}::uuid
      and b.deleted_at is null and (b.created_at, b.id) < (a.created_at, a.id)${ruled(scope, objectId, 'b')}
    where ${NOT_DISMISSED}${within}
    group by a.id, a.created_at, b.id
    order by a.created_at desc, a.id desc, b.id desc
    limit ${PAIRS_PAGE + 1}
  `);
  const rows = found.rows.slice(0, PAIRS_PAGE);
  let next: PairCursor | undefined;
  const last = rows.at(-1);
  if (found.rows.length > PAIRS_PAGE && last !== undefined) next = { at: last.at, a: last.a, b: last.b };
  else {
    // Every pair of the window is on this page: go on after the window's oldest record when the window was full.
    const edge = await tx.execute<{ n: number; at: string | null; id: string | null }>(sql`
      select count(*)::int as n, (array_agg(w.created_at::text order by w.created_at, w.id))[1] as at,
        (array_agg(w.id::text order by w.created_at, w.id))[1] as id
      from (${window}) w
    `);
    const [scan] = edge.rows;
    if (scan !== undefined && scan.n >= PAIRS_SCAN && scan.at !== null && scan.id !== null) {
      next = { at: scan.at, a: scan.id };
    }
  }
  const display = await displays(
    tx,
    scope,
    rows.flatMap((row) => [row.a, row.b]),
  );
  const pairs = rows.flatMap((row): DuplicatePairView[] => {
    const a = display.get(row.a);
    const b = display.get(row.b);
    const reason = REASON_AT[row.rank];
    return a === undefined || b === undefined || reason === undefined ? [] : [{ a, b, reason }];
  });
  return { pairs, ...(next === undefined ? {} : { cursor: encodeCursor(next) }) };
}

/** One record's pairs (AC-4906): its partners newest first, each pair newer record first. */
async function recordPairs(
  tx: WorkspaceTx,
  scope: EngineScope,
  rules: DuplicateRules,
  partners: SQL,
  recordId: string,
  cursor: PairCursor | undefined,
): Promise<DuplicatePairPage> {
  if (!isUuid(recordId)) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
  const id = canonicalId(recordId);
  const { objectId } = rules;
  const from =
    cursor === undefined ? sql`` : sql` and (b.created_at, b.id) < (${cursor.at}::timestamptz, ${cursor.a}::uuid)`;
  const found = await tx.execute<{ a_ok: boolean; b: string; at: string; newer: boolean; rank: number }>(sql`
    with a as (
      select r.id, r.created_at from records r
      where r.id = ${id}::uuid and r.object_id = ${objectId}::uuid and r.deleted_at is null${ruled(scope, objectId, 'r')}
    )
    select true as a_ok, b.id::text as b, b.created_at::text as at,
      (b.created_at, b.id) > (a.created_at, a.id) as newer, min(m.rank)::int as rank
    from a
    cross join lateral (${partners}) m
    join records b on b.workspace_id = ${scope.workspaceId}::uuid and b.id = m.id and b.object_id = ${objectId}::uuid
      and b.deleted_at is null${ruled(scope, objectId, 'b')}
    where ${NOT_DISMISSED}${from}
    group by a.id, a.created_at, b.id, b.created_at
    order by b.created_at desc, b.id desc
    limit ${PAIRS_PAGE + 1}
  `);
  if (found.rows.length === 0) {
    // No pairs, or a record the reader can't see: the same answer would say whether it exists.
    const seen = await tx.execute(sql`
      select 1 from records r where r.id = ${id}::uuid and r.object_id = ${objectId}::uuid and r.deleted_at is null
        ${ruled(scope, objectId, 'r')}
    `);
    if (seen.rows.length === 0) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
    return { pairs: [] };
  }
  const rows = found.rows.slice(0, PAIRS_PAGE);
  const last = rows.at(-1);
  const next = found.rows.length > PAIRS_PAGE && last !== undefined ? { at: last.at, a: last.b } : undefined;
  const display = await displays(tx, scope, [id, ...rows.map((row) => row.b)]);
  const self = display.get(id);
  const pairs = rows.flatMap((row): DuplicatePairView[] => {
    const other = display.get(row.b);
    const reason = REASON_AT[row.rank];
    if (self === undefined || other === undefined || reason === undefined) return [];
    return [row.newer ? { a: other, b: self, reason } : { a: self, b: other, reason }];
  });
  return { pairs, ...(next === undefined ? {} : { cursor: encodeCursor(next) }) };
}

/** Runs a duplicates read in its own cancellable transaction, under the reads' time limit. */
async function reading<T>(
  scope: EngineScope,
  signal: AbortSignal | undefined,
  work: (tx: WorkspaceTx) => Promise<T>,
): Promise<T> {
  const cancelled = () => refuse('QUERY_CANCELLED', 'Finding duplicates took too long or was cancelled. Try again.');
  try {
    return await withCancel(scope, 'query', signal, cancelled, async (tx) => {
      await tx.execute(sql`set local statement_timeout = ${sql.raw(`'${TIMEOUT}'`)}`);
      return work(tx);
    });
  } catch (error) {
    if (postgresError(error)?.code === '57014')
      throw isAborted(signal) ? cancelled() : refuse('QUERY_CANCELLED', 'Finding duplicates took too long. Try again.');
    throw error;
  }
}

/** `findDuplicates` in its own read (the API's `records.duplicates.check`). */
export function checkDuplicates(
  scope: EngineScope,
  input: FindDuplicatesInput,
  signal?: AbortSignal,
): Promise<readonly DuplicateMatchView[]> {
  if (!isUuid(input.objectId)) return Promise.reject(refuse('NOT_FOUND', UNKNOWN_OBJECT));
  return reading(scope, signal, (tx) => findDuplicates(tx, scope, { ...input, objectId: canonicalId(input.objectId) }));
}

/** `listDuplicatePairs` in its own read (the API's `records.duplicates.list`). */
export function listDuplicates(
  scope: EngineScope,
  input: ListDuplicatePairsInput,
  signal?: AbortSignal,
): Promise<DuplicatePairPage> {
  if (!isUuid(input.objectId)) return Promise.reject(refuse('NOT_FOUND', UNKNOWN_OBJECT));
  return reading(scope, signal, (tx) =>
    listDuplicatePairs(tx, scope, { ...input, objectId: canonicalId(input.objectId) }),
  );
}

/** A pair to dismiss or restore: the object and its two records, in either order. */
export interface PairInput {
  readonly objectId: string;
  readonly recordIds: readonly [string, string];
}

/**
 * The pair's two records, ordered low then high, once the reader may change the object and see both live records
 * of it: `FORBIDDEN` for a reader who may only read it, and one `NOT_FOUND` for anything else (an unknown or
 * hidden record, a trashed one, one of another object, the same record twice), saying nothing of which.
 */
async function checkPair(
  tx: WorkspaceTx,
  scope: EngineScope,
  input: PairInput,
): Promise<{ readonly objectId: string; readonly low: string; readonly high: string }> {
  if (scope.actor.type !== 'member' || scope.actor.id === null) {
    throw refuse('FORBIDDEN', 'Only a member can mark records as not duplicates.');
  }
  if (!isUuid(input.objectId)) throw refuse('NOT_FOUND', UNKNOWN_OBJECT);
  const objectId = canonicalId(input.objectId);
  await checkObject(tx, scope.access, objectId, 'write');
  const [first, second] = input.recordIds;
  if (!isUuid(first) || !isUuid(second)) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
  const ids = [canonicalId(first), canonicalId(second)].sort();
  const [low, high] = ids;
  if (low === undefined || high === undefined || low === high) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
  const seen = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from records r
    where r.id = any(${uuidList([low, high])}) and r.object_id = ${objectId}::uuid and r.deleted_at is null
      ${ruled(scope, objectId, 'r')}
  `);
  if (seen.rows[0]?.n !== 2) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
  return { objectId, low, high };
}

/**
 * "Not a duplicate" (AC-4908): the pair is kept once, for everyone in the workspace, and never suggested again by
 * any rule (AC-4903), with an audit row naming both records and the member. Dismissing a dismissed pair is a no op.
 */
export async function dismissPair(
  scope: EngineScope,
  input: PairInput,
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly dismissed: true }> {
  await runWrite(
    scope,
    async ({ tx, scope: writing }) => {
      const pair = await checkPair(tx, writing, input);
      const made = await tx.execute(sql`
        insert into record_duplicate_dismissals (workspace_id, object_id, low_record_id, high_record_id, created_by_member_id)
        values (${writing.workspaceId}::uuid, ${pair.objectId}::uuid, ${pair.low}::uuid, ${pair.high}::uuid, ${writing.actor.id}::uuid)
        on conflict do nothing
      `);
      if ((made.rowCount ?? 0) > 0) {
        await writeAudit(tx, writing.workspaceId, writing.actor, {
          action: 'record.duplicate_dismissed',
          targetType: 'record',
          targetId: pair.high,
          after: { objectId: pair.objectId, recordIds: [pair.low, pair.high] },
        });
      }
    },
    hooks,
  );
  return { dismissed: true };
}

/** Undo of "Not a duplicate" (AC-4908): the pair can be suggested again, with its audit row. */
export async function restorePair(
  scope: EngineScope,
  input: PairInput,
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly restored: true }> {
  await runWrite(
    scope,
    async ({ tx, scope: writing }) => {
      const pair = await checkPair(tx, writing, input);
      const gone = await tx.execute(sql`
        delete from record_duplicate_dismissals
        where low_record_id = ${pair.low}::uuid and high_record_id = ${pair.high}::uuid
      `);
      if ((gone.rowCount ?? 0) > 0) {
        await writeAudit(tx, writing.workspaceId, writing.actor, {
          action: 'record.duplicate_restored',
          targetType: 'record',
          targetId: pair.high,
          before: { objectId: pair.objectId, recordIds: [pair.low, pair.high] },
        });
      }
    },
    hooks,
  );
  return { restored: true };
}

/** One staged create row as AC-4918's name rules read it: its name value, and on People its Company cell. */
export interface ImportDuplicateRow {
  readonly name: unknown;
  /** The record ids the row's Company cell resolves to, when the object is People. */
  readonly companyIds?: readonly string[];
}

/** The most candidates one import check reads, across every row. */
const IMPORT_CANDIDATES = 5_000;

/**
 * For each staged create row, the live record it looks like by AC-4901's name rules (AC-4918), or undefined: the
 * same name (and on People the same Company), visible to the importer, in one statement for every row. Nothing is
 * merged or skipped: the preview only says so.
 */
export async function findImportDuplicates(
  tx: WorkspaceTx,
  scope: EngineScope,
  objectId: string,
  rows: readonly ImportDuplicateRow[],
): Promise<readonly (RecordRefDisplay | undefined)[]> {
  const rules = await duplicateRules(tx, scope, objectId);
  const name = rules.name;
  if (name === undefined) return rows.map(() => undefined);
  const texts = rows.map((row) => draftTexts(name.attribute, row.name)[0]);
  const asked = texts.flatMap((text, index) => (text === undefined ? [] : [{ index, kind: name.kind, text }]));
  const keys = await matchKeys(tx, asked);
  const keyOf = new Map<number, string>();
  asked.forEach((item, at) => {
    const key = keys[at];
    if (key !== null && key !== undefined) keyOf.set(item.index, key);
  });
  if (keyOf.size === 0) return rows.map(() => undefined);
  const company = name.company === undefined ? undefined : companyColumns(name.company, 'k');
  const companySql =
    name.company === undefined || company === undefined
      ? sql`null::text`
      : sql`(select string_agg(${company.far}::text, ',') from record_links k
          where k.relationship_id = ${name.company.relationshipId}::uuid and k.active_until is null and ${company.mine} = r.id)`;
  const found = await tx.execute<{ key: string; id: string; companies: string | null }>(sql`
    select v.match_key as key, r.id::text as id, ${companySql} as companies from "values" v
    join records r on r.workspace_id = v.workspace_id and r.id = v.owner_id and r.object_id = ${objectId}::uuid
      and r.deleted_at is null${ruled(scope, objectId, 'r')}
    where v.attribute_id = ${name.attribute.id}::uuid and v.active_until is null
      and v.match_key = any(array(select jsonb_array_elements_text(${JSON.stringify([...new Set(keyOf.values())])}::jsonb)))
    order by r.created_at, r.id
    limit ${IMPORT_CANDIDATES}
  `);
  const byKey = new Map<string, { readonly id: string; readonly companies: ReadonlySet<string> }[]>();
  for (const row of found.rows) {
    const list = byKey.get(row.key) ?? [];
    list.push({ id: row.id, companies: new Set((row.companies ?? '').split(',').filter((each) => each !== '')) });
    byKey.set(row.key, list);
  }
  const matched = rows.map((row, index): string | undefined => {
    const key = keyOf.get(index);
    if (key === undefined) return undefined;
    const candidates = byKey.get(key) ?? [];
    if (name.company === undefined) return candidates[0]?.id;
    const wanted = row.companyIds ?? [];
    return candidates.find((candidate) => wanted.some((id) => candidate.companies.has(id)))?.id;
  });
  const display = await displays(
    tx,
    scope,
    matched.flatMap((id) => (id === undefined ? [] : [id])),
  );
  return matched.map((id) => (id === undefined ? undefined : display.get(id)));
}
