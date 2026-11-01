// Fit (spec 0037, AC-1362): how well each free rep matches the lead, read at
// the booking, before any lock, in the page's own workspace under row level
// security.
//
// A **fit link** joins one option of a select or status field on People,
// Companies or Deals to one skill ("Preferred language is Spanish" to the
// Spanish skill). A link **applies** when the lead holds that option: the
// answer of a question that files to that field (the handing form's answers
// or the page's own, which were already read for the rules), else the field's
// value on the matched person, their company, or their latest open deal, read
// exactly as a record fact is (`facts.ts`, AC-1377). A candidate's fit is the
// share of applying links whose skill they hold, 0 to 1; with no applying
// link everyone's fit is 0, so the ranking changes nothing.
//
// What it reads is kept on the decision as `facts` (AC-1362): option ids
// only, each marked `answered` or `record`, never free text. Three queries at
// most, and none at all for a workspace with no fit links.
import { and, inArray, sql } from 'drizzle-orm';
import { FitLink, FIT_LINKS_MAX } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { uuidArray } from '../engine/ids.ts';
import { recordFacts, RECORD_FACTS_MAX, type RecordFactObjects } from './facts.ts';

const { memberSkills } = schema;

/** Where a fit link's field lives, and how the lead's value for it is reached. */
const SIDES = { people: 'person', companies: 'company', deals: 'deal' } as const;

/** One fact the ranking used, as the decision keeps it (AC-1362). */
export interface RankingFact {
  /** The field the option belongs to. */
  readonly attributeId: string;
  readonly optionId: string;
  /** Where it came from: a question the lead answered, or a record the CRM holds. */
  readonly from: 'answered' | 'record';
}

/** What fit worked out: each candidate's share, the links that applied, and the facts behind them. */
export interface Fit {
  /** 0 to 1 per member; absent means 0. */
  readonly shares: ReadonlyMap<string, number>;
  /** How many links applied: 0 means fit changed nothing. */
  readonly applying: number;
  /** The skills the applying links asked for, by member, so the explanation can name a rep's matched skills. */
  readonly matched: ReadonlyMap<string, readonly string[]>;
  readonly facts: readonly RankingFact[];
}

/** Nothing applied: everyone's fit is 0. */
export const NO_FIT: Fit = { shares: new Map(), applying: 0, matched: new Map(), facts: [] };

/** A fit link list as stored, read defensively: anything that doesn't parse is dropped, and the limit holds. */
export function fitLinksOf(stored: unknown): readonly FitLink[] {
  if (!Array.isArray(stored)) return [];
  const links: FitLink[] = [];
  for (const each of stored.slice(0, FIT_LINKS_MAX)) {
    const parsed = FitLink.safeParse(each);
    if (parsed.success) links.push(parsed.data);
  }
  return links;
}

/** Each fit field, live, with where it lives and its live options by id and by lowercased label. */
async function fieldsOf(
  tx: WorkspaceTx,
  attributeIds: readonly string[],
): Promise<
  ReadonlyMap<
    string,
    {
      readonly side: (typeof SIDES)[keyof typeof SIDES];
      readonly byId: ReadonlySet<string>;
      readonly byLabel: ReadonlyMap<string, string>;
    }
  >
> {
  if (attributeIds.length === 0) return new Map();
  const rows = await tx.execute<{
    attribute_id: string;
    standard_key: 'people' | 'companies' | 'deals';
    option_id: string;
    label: string;
  }>(sql`
    select a.id::text as attribute_id, o.standard_key, p.id::text as option_id, p.label
    from attributes a
    join objects o on o.workspace_id = a.workspace_id and o.id = a.object_id
    join attribute_options p on p.workspace_id = a.workspace_id and p.attribute_id = a.id and p.archived_at is null
    where a.id = any(${uuidArray(attributeIds)}) and a.archived_at is null
      and a.type::text in ('status', 'select')
      and o.archived_at is null and o.standard_key in ('people', 'companies', 'deals')
  `);
  const found = new Map<
    string,
    { side: (typeof SIDES)[keyof typeof SIDES]; byId: Set<string>; byLabel: Map<string, string> }
  >();
  for (const row of rows.rows) {
    const held = found.get(row.attribute_id) ?? { side: SIDES[row.standard_key], byId: new Set(), byLabel: new Map() };
    held.byId.add(row.option_id);
    held.byLabel.set(row.label.trim().toLowerCase(), row.option_id);
    found.set(row.attribute_id, held);
  }
  return found;
}

/** The option ids an answer names, matched against the field's live options by id, then by label. */
function answeredOptions(value: unknown, byId: ReadonlySet<string>, byLabel: ReadonlyMap<string, string>): string[] {
  const given = (Array.isArray(value) ? value : [value]).filter((each): each is string => typeof each === 'string');
  return given.flatMap((each) => {
    if (byId.has(each)) return [each];
    const found = byLabel.get(each.trim().toLowerCase());
    return found === undefined ? [] : [found];
  });
}

/** Which of `memberIds` hold which of `skillIds`. */
async function skillsHeld(
  tx: WorkspaceTx,
  memberIds: readonly string[],
  skillIds: readonly string[],
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  if (memberIds.length === 0 || skillIds.length === 0) return new Map();
  const rows = await tx
    .select({ memberId: memberSkills.memberId, skillId: memberSkills.skillId })
    .from(memberSkills)
    .where(
      and(
        inArray(memberSkills.memberId, [...new Set(memberIds)]),
        inArray(memberSkills.skillId, [...new Set(skillIds)]),
      ),
    );
  const held = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = held.get(row.memberId) ?? new Set<string>();
    set.add(row.skillId);
    held.set(row.memberId, set);
  }
  return held;
}

/** What working out fit needs: the links, the lead, the answers already read, and who could take the booking. */
export interface FitInput {
  readonly links: readonly FitLink[];
  readonly objects: RecordFactObjects;
  /** The email the visitor typed, unchecked (`facts.ts`); empty means no record is matched. */
  readonly email: string;
  /** The answers the rules read: the handing form's and the page's own, by question key. */
  readonly answers: Readonly<Record<string, unknown>>;
  /** Which attribute each answered question files to, by question key (from the form's and the page's questions). */
  readonly filedOn: ReadonlyMap<string, string>;
  /** Everyone who could take a seat on this page. */
  readonly memberIds: readonly string[];
}

/**
 * Each candidate's fit (AC-1362). Nothing is read when the workspace has no
 * fit links, no candidate could take the booking, or no link's field is live
 * on People, Companies or Deals.
 */
export async function readFit(tx: WorkspaceTx, input: FitInput): Promise<Fit> {
  if (input.links.length === 0 || input.memberIds.length === 0) return NO_FIT;
  const attributeIds = [...new Set(input.links.map((link) => link.attributeId))];
  const fields = await fieldsOf(tx, attributeIds);
  if (fields.size === 0) return NO_FIT;

  // The lead's options for each field: an answer that files to it wins, since it was given last and by the lead.
  const answered = new Map<string, Set<string>>();
  for (const [key, attributeId] of input.filedOn) {
    const field = fields.get(attributeId);
    if (field === undefined || !Object.hasOwn(input.answers, key)) continue;
    const ids = answeredOptions(input.answers[key], field.byId, field.byLabel);
    if (ids.length === 0) continue;
    const held = answered.get(attributeId) ?? new Set<string>();
    for (const id of ids) held.add(id);
    answered.set(attributeId, held);
  }
  // The rest from the records, read exactly as a rule's record fact is (one call, its own cap).
  // Its own budget of at most `RECORD_FACTS_MAX` fields, beside the rules' (noted for /architect: AC-1377 words
  // the cap as one per decision, and sharing one read between the rules and fit is the better shape).
  const fromRecords = [...fields].filter(([attributeId]) => !answered.has(attributeId)).slice(0, RECORD_FACTS_MAX);
  const keys = fromRecords.map(([attributeId, field]) => `${field.side}.${attributeId}`);
  const read: { readonly facts: Readonly<Record<string, unknown>> } =
    keys.length === 0 || input.email === '' ? { facts: {} } : await recordFacts(tx, input.objects, input.email, keys);

  const facts: RankingFact[] = [];
  const held = new Map<string, Set<string>>();
  for (const [attributeId, ids] of answered) {
    held.set(attributeId, ids);
    for (const optionId of ids) facts.push({ attributeId, optionId, from: 'answered' });
  }
  for (const [attributeId, field] of fromRecords) {
    const value: unknown = read.facts[`${field.side}.${attributeId}`];
    const ids = answeredOptions(value, field.byId, field.byLabel);
    if (ids.length === 0) continue;
    held.set(attributeId, new Set(ids));
    for (const optionId of ids) facts.push({ attributeId, optionId, from: 'record' });
  }

  const applying = input.links.filter((link) => held.get(link.attributeId)?.has(link.optionId) === true);
  if (applying.length === 0) return { ...NO_FIT, facts };
  const wanted = [...new Set(applying.map((link) => link.skillId))];
  const skills = await skillsHeld(tx, input.memberIds, wanted);
  const shares = new Map<string, number>();
  const matched = new Map<string, readonly string[]>();
  for (const memberId of new Set(input.memberIds)) {
    const theirs = skills.get(memberId) ?? new Set<string>();
    const hit = applying.filter((link) => theirs.has(link.skillId));
    shares.set(memberId, hit.length / applying.length);
    if (hit.length > 0) matched.set(memberId, [...new Set(hit.map((link) => link.skillId))]);
  }
  return { shares, applying: applying.length, matched, facts };
}
