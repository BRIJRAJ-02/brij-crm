// Who a route's hosts are (spec 0043, AC-1604, AC-1608; spec 0037, AC-1356): named members as they are, or the
// members of the page's rotations holding every required skill, read when the route is taken. Nobody holding them
// means nobody narrowed: the whole rotation picks, which is the route's one "If none of them is free".
import { namedHosts, requiredSkills, type RouteHosts } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { pageHostPool } from './check.ts';
import { membersWithSkills } from './skills.ts';

/**
 * The member ids `hosts` narrows `pageId` to, or undefined for none (no hosts, or skills nobody in its rotations
 * holds). Named members aren't checked against the rotations here: the booking passes over one who left.
 */
export async function routeHostIds(
  tx: WorkspaceTx,
  pageId: string,
  hosts: RouteHosts | undefined,
): Promise<readonly string[] | undefined> {
  const named = namedHosts(hosts);
  if (named !== undefined) return named.length === 0 ? undefined : named;
  const skills = requiredSkills(hosts);
  if (skills === undefined) return undefined;
  const pool = await pageHostPool(tx, pageId);
  if (pool === undefined) return undefined;
  const found = await membersWithSkills(tx, [...pool.members], skills);
  return found.length === 0 ? undefined : found;
}
