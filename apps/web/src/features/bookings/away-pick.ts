// Who Host away's Reassign hands the seat to (spec 0037, AC-1284): the time off's stand in, else the next in the
// rotation. Pure, so the dialog says exactly what it sends.
import type { RotationView } from '@crm/data';

/** Who takes the seat, as the dialog says it and sends it. */
export type AwayPick =
  | { readonly kind: 'standin'; readonly memberId: string; readonly name?: string }
  | { readonly kind: 'next'; readonly standinOutside: boolean };

/**
 * The stand in when their time off names one who is switched on in the seat's rotation; with the rotation's members
 * unread, the stand in still (the server checks they are in it and free); else the next in the rotation.
 */
export function awayPick(
  standinId: string | undefined,
  rotation: RotationView | undefined,
  hasMembers: boolean,
): AwayPick {
  if (standinId === undefined) return { kind: 'next', standinOutside: false };
  if (!hasMembers) return { kind: 'standin', memberId: standinId };
  const member = rotation?.members.find((each) => each.memberId === standinId && each.isOn);
  return member === undefined
    ? { kind: 'next', standinOutside: true }
    : { kind: 'standin', memberId: member.memberId, name: member.name };
}
