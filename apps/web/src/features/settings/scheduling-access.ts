// What the scheduling access screens say (spec 0037, AC-1266, AC-1267), as plain functions over the delegations
// the data layer holds: which rows are over the member and which they hold, each row's source, and a member's reach
// in a few words for the Members page. No React, so a test reads them directly.
import type { DelegationTarget, DelegationView, Role } from '@crm/data';
import { strings } from './scheduling-access-strings.ts';

/** A member's name by id, or undefined for someone no longer here. */
export type NameOf = (memberId: string) => string | undefined;

/** Whether a role manages everyone's scheduling through itself (decision 7: the built in Owner and Admin roles). */
export const roleManagesEveryone = (role: Role): boolean => role === 'owner' || role === 'admin';

/** The delegations over `me`: someone else's See or Manage over my scheduling, oldest first. */
export function overMe(delegations: readonly DelegationView[], me: string): readonly DelegationView[] {
  return delegations.filter((each) => each.target.type === 'member' && each.target.memberId === me);
}

/** The delegations `memberId` holds: their See or Manage over someone else's scheduling, or everyone's. */
export function heldBy(delegations: readonly DelegationView[], memberId: string): readonly DelegationView[] {
  return delegations.filter((each) => each.delegateMemberId === memberId);
}

/**
 * Where a delegation came from, for its row ("You added", "Priya added"): the grant's last granter, or the member
 * it is over when they granted it themself; an admin since gone reads "Added by an admin".
 */
export function sourceOf(delegation: DelegationView, me: string, nameOf: NameOf): string {
  const by =
    delegation.grantedBy ??
    (delegation.grantedBySelf && delegation.target.type === 'member' ? delegation.target.memberId : undefined);
  if (by === me) return strings.youAdded;
  const name = by === undefined ? undefined : nameOf(by);
  return name === undefined ? strings.addedByAdmin : strings.addedBy(name);
}

/** Whose scheduling a target names, as a possessive ("Bea’s", "everyone’s"). */
export function whoseOf(target: DelegationTarget, nameOf: NameOf): string {
  if (target.type === 'member') return strings.possessive(nameOf(target.memberId) ?? strings.formerMember);
  return strings.everyonesPossessive;
}

/** A target as a row names it ("Bea Ortiz", "Everyone"). */
export function targetName(target: DelegationTarget, nameOf: NameOf): string {
  if (target.type === 'member') return nameOf(target.memberId) ?? strings.formerMember;
  return strings.everyone;
}

/** Up to two names, then "and N more" (the Members page's cell). */
function namesList(names: readonly string[]): string {
  if (names.length <= 2) return names.join(strings.and);
  return `${names.slice(0, 2).join(', ')} ${strings.andOthers(names.length - 2)}`;
}

/**
 * A member's reach in a few words (AC-1267, the spec's Value sourcing): "Everyone" through an owner's or admin's role,
 * else the Manage reach from their delegations ("Everyone", "Sam and Bea"), with what See reaches further in
 * brackets ("Sam (sees everyone)"), and "Only their own" when there is none.
 */
export function reachWords(role: Role, held: readonly DelegationView[], nameOf: NameOf): string {
  if (roleManagesEveryone(role)) return strings.everyoneByRole;
  const words = (level: 'view' | 'manage') => {
    const ofLevel = held.filter((each) => each.level === level);
    if (ofLevel.some((each) => each.target.type === 'everyone')) return strings.everyone;
    return namesList(ofLevel.map((each) => targetName(each.target, nameOf)));
  };
  const manages = words('manage');
  const sees = manages === strings.everyone ? '' : words('view');
  if (manages === '' && sees === '') return strings.theirs;
  if (manages === '') return strings.seesOnly(sees === strings.everyone ? strings.everyoneLower : sees);
  if (sees === '') return manages;
  return `${manages} (${strings.seesToo(sees === strings.everyone ? strings.everyoneLower : sees)})`;
}
