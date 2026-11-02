// Routing's shared numbers and host helpers (spec 0037, L7), with no Zod at run time, so the builder and the
// Routing tab share them through `@crm/contracts/forms` without loading the schema library.
import type { RouteHosts } from './routing.ts';

/** At most this many skills a host route requires (spec 0037, AC-1356). */
export const REQUIRED_SKILLS_MAX = 3;

/** At most this many skills in one workspace (spec 0037's Numbers): past it, 409 `SKILL_LIMIT`. */
export const SKILLS_MAX = 100;
/** A skill's name, 1 to 40 characters. */
export const SKILL_NAME_MAX = 40;

/** The groups skills sit in, in the order Skills shows them. */
export const SKILL_GROUPS = ['language', 'region', 'segment', 'product', 'other'] as const;

/** The named members of a route's hosts, or undefined when it names skills (or nobody). */
export function namedHosts(hosts: RouteHosts | undefined): readonly string[] | undefined {
  return Array.isArray(hosts) ? hosts : undefined;
}

/** The skills a route's hosts require, or undefined when it names people (or nobody). */
export function requiredSkills(hosts: RouteHosts | undefined): readonly string[] | undefined {
  return hosts === undefined || Array.isArray(hosts) ? undefined : hosts.requireSkillIds;
}

/** The smart ranking's modes (spec 0037, AC-1361): Off is plain fairness, Fit the lead's skills, Learn adds the track record. */
export const SMART_MODES = ['off', 'fit', 'learn'] as const;
/** One smart mode, by value (the Zod schema and its type live in `routing-shared.ts`). */
type Mode = (typeof SMART_MODES)[number];

/** What an unknown stored mode reads as (AC-1223: fail closed toward plain fairness). */
export const SMART_MODE_FALLBACK: Mode = 'off';
/** The mode a workspace that never set one runs (spec 0037's Numbers: lift only in warm cells, so nothing changes yet). */
export const SMART_MODE_DEFAULT: Mode = 'learn';

/** The fairness allowance, 0 to 50 percent (spec 0037's Numbers). */
export const TILT_PERCENT_MAX = 50;
/** The fairness allowance a workspace that never set one runs. */
export const TILT_PERCENT_DEFAULT = 20;
/** The least slack a seat ever has: one meeting at weight 100 (AC-1363). */
export const SLACK_FLOOR = 1;

/** At most this many fit links in one workspace (spec 0037's Numbers). */
export const FIT_LINKS_MAX = 100;

/**
 * The smart mode a stored value means: an unknown one, or none, is `off` and `learn` respectively (AC-1223). A
 * workspace with no settings row runs `SMART_MODE_DEFAULT`; a row holding something the code doesn't know runs
 * `SMART_MODE_FALLBACK`, so nothing unknown ever tilts a pick.
 */
export function smartModeOf(stored: unknown): Mode {
  if (stored === null || stored === undefined) return SMART_MODE_DEFAULT;
  return SMART_MODES.find((mode) => mode === stored) ?? SMART_MODE_FALLBACK;
}

/** The holdout, 0 to 20 percent of ranked decisions (spec 0037, AC-1389). */
export const HOLDOUT_PERCENT_MAX = 20;
/** The holdout a workspace that never set one runs: a tenth of ranked decisions pick plain fair. */
export const HOLDOUT_PERCENT_DEFAULT = 10;

/** At most this many segment attributes (AC-1370): two, so a cell never splinters past counting. */
export const SEGMENT_ATTRIBUTES_MAX = 2;
/** A segment attribute's options, at most (AC-1370): past it the cells are too thin to warm. */
export const SEGMENT_OPTIONS_MAX = 6;

/** The segment key of a decision learning never splits by: the page's all segments cell. */
export const ALL_SEGMENTS = '*';
/** The segment key of a lead missing one of the segment attributes (AC-1370): never warm, always the all segments cell. */
export const UNKNOWN_SEGMENT = '?';

/** What a team page learns toward (AC-1354): a deal created, a deal won, or the meeting held. */
export const OBJECTIVES = ['deal', 'won', 'held'] as const;
/** One learning objective, by value. */
type Objective = (typeof OBJECTIVES)[number];

/** The objective a page that never set one learns toward: Deals created. */
export const OBJECTIVE_DEFAULT: Objective = 'deal';

/**
 * The objective a stored value means (AC-1223): null, or anything the code doesn't know, is Deals created, so an
 * unknown outcome never decides anything.
 */
export function objectiveOf(stored: unknown): Objective {
  return OBJECTIVES.find((each) => each === stored) ?? OBJECTIVE_DEFAULT;
}

/** How many finished trials a cell needs before its lift is read (AC-1369). */
export const WARM_TRIALS = 100;
/** The prior the smoothed rate pulls toward the team's, in trials (AC-1369). */
export const RATE_SMOOTHING = 20;
/** The gap in rate that is worth a full lift of 1 (AC-1369): ten percentage points. */
export const LIFT_SPAN = 0.1;
/** Below this gap in rate a candidate gets no lift at all (AC-1369): two percentage points. */
export const LIFT_FLOOR = 0.02;

/** The learning window, in days (spec 0037's Learning): the bookings a run counts. */
export const LEARN_WINDOW_DAYS = 180;
/** Deals won looks back further, by its own outcome window (90 days). */
export const WON_WINDOW_DAYS = 90;
/** A deal counts when it was created between the booking and this many days after the meeting (AC-1366). */
export const DEAL_WINDOW_DAYS = 30;
/** Held is decided this many days after the meeting, so a late No show mark still lands first (AC-1366). */
export const HELD_WINDOW_DAYS = 7;

/** How many days back one run of an objective reads (spec 0037's Learning): Deals won adds its outcome window. */
export function learnWindowDays(objective: unknown): number {
  return objectiveOf(objective) === 'won' ? LEARN_WINDOW_DAYS + WON_WINDOW_DAYS : LEARN_WINDOW_DAYS;
}

/** How many days after the meeting an objective's outcome is settled (AC-1366). */
export function outcomeWindowDays(objective: unknown): number {
  const each = objectiveOf(objective);
  return each === 'held' ? HELD_WINDOW_DAYS : each === 'deal' ? DEAL_WINDOW_DAYS : WON_WINDOW_DAYS;
}

/**
 * The canonical segment key of a lead's values for the segment attributes, in the order the attributes are set
 * (AC-1370): `attribute=option;attribute=option`. A value missing for any of them makes `UNKNOWN_SEGMENT`; no
 * segment attributes at all makes `ALL_SEGMENTS`, the only cell such a workspace has.
 */
export function segmentKeyOf(
  attributeIds: readonly string[],
  optionOf: (attributeId: string) => string | undefined,
): string {
  if (attributeIds.length === 0) return ALL_SEGMENTS;
  const parts: string[] = [];
  for (const attributeId of attributeIds) {
    const optionId = optionOf(attributeId);
    if (optionId === undefined) return UNKNOWN_SEGMENT;
    parts.push(`${attributeId}=${optionId}`);
  }
  return parts.join(';');
}

/**
 * Whether a decision is drawn into the holdout (AC-1389): a stable hash of its id below the share, so a replay of
 * the same booking agrees and the draw can never be steered by who is free. A share of 0 draws nothing.
 */
export function isHoldout(decisionId: string, holdoutPercent: number): boolean {
  const share = Math.min(HOLDOUT_PERCENT_MAX, Math.max(0, Math.trunc(holdoutPercent)));
  if (share <= 0) return false;
  // FNV-1a over the id, kept in 32 bits: the same answer in Postgres is never needed, only the same answer twice here.
  let hash = 0x811c9dc5;
  for (let index = 0; index < decisionId.length; index += 1) {
    hash ^= decisionId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100 < share;
}
