// "What can Priya do" (spec 0037, AC-1243) as plain functions: a member's scheduling reach in a few words, where it
// comes from, and who may manage their scheduling, from their role and the delegations the data layer holds. No
// React, so a test reads them directly.
import type { DelegationView, RoleDefinition } from '@crm/data';
import { reachOf, type Reach } from './roles.ts';

/** A member's name by id, or undefined for someone no longer here. */
export type NameOf = (memberId: string) => string | undefined;

/** Copy the lines are built from (the dialog passes its strings, so this file holds no words of its own). */
export interface CapabilityWords {
  readonly reach: Readonly<Record<Reach, string>>;
  readonly and: (a: string, b: string) => string;
  readonly ownersAndAdmins: string;
  /** "Everyone with Receptionist". */
  readonly holdersOf: (role: string) => string;
  /** "Sales lead in their teams". */
  readonly teamHoldersOf: (role: string) => string;
  readonly everyoneGrant: (name: string) => string;
}

/** The role's own reach over other people's scheduling: owners and admins reach everyone. */
export function roleReach(role: RoleDefinition): { readonly see: Reach; readonly manage: Reach } {
  if (role.builtIn === 'owner' || role.builtIn === 'admin') return { see: 'everyone', manage: 'everyone' };
  return reachOf(role.permissions);
}

/**
 * Whom a member sees or manages (`level`), in a few words: their role's reach, then the people their delegations
 * add ("Their teams and Bea Rao"); Everyone wins over names.
 */
export function reachLine(
  role: RoleDefinition,
  held: readonly DelegationView[],
  level: 'view' | 'manage',
  nameOf: NameOf,
  words: CapabilityWords,
): string {
  const own = roleReach(role)[level === 'view' ? 'see' : 'manage'];
  const counts = held.filter((each) => (level === 'view' ? true : each.level === 'manage'));
  if (own === 'everyone' || counts.some((each) => each.target.type === 'everyone')) return words.reach.everyone;
  const names = counts.flatMap((each) => {
    if (each.target.type !== 'member') return [];
    const name = nameOf(each.target.memberId);
    return name === undefined ? [] : [name];
  });
  const people = [...new Set(names)].join(', ');
  if (own === 'team') return people === '' ? words.reach.team : words.and(words.reach.team, people);
  return people === '' ? words.reach.self : people;
}

/**
 * Who may manage a member's scheduling (AC-1243): owners and admins, the custom roles that manage everyone or their
 * teams (decision 7: never over an owner or admin), and the delegates given Manage over them or over everyone.
 */
export function managedBy(
  member: { readonly id: string; readonly role: string },
  roles: readonly RoleDefinition[],
  delegations: readonly DelegationView[],
  nameOf: NameOf,
  words: CapabilityWords,
): readonly string[] {
  const protectedRole = member.role === 'owner' || member.role === 'admin';
  const byRole = protectedRole
    ? []
    : roles
        .filter((role) => role.builtIn === undefined)
        .flatMap((role) => {
          const reach = reachOf(role.permissions).manage;
          if (reach === 'everyone') return [words.holdersOf(role.label)];
          if (reach === 'team') return [words.teamHoldersOf(role.label)];
          return [];
        });
  const byGrant = delegations
    .filter((each) => each.level === 'manage' && each.delegateMemberId !== member.id)
    .flatMap((each) => {
      const name = nameOf(each.delegateMemberId);
      if (name === undefined) return [];
      if (each.target.type === 'member' && each.target.memberId === member.id) return [name];
      if (each.target.type === 'everyone' && !protectedRole) return [words.everyoneGrant(name)];
      return [];
    });
  return [words.ownersAndAdmins, ...byRole, ...new Set(byGrant)];
}
