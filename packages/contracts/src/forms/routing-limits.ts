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
