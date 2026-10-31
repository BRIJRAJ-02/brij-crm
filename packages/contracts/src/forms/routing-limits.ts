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
