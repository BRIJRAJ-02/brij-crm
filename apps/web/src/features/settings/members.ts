// The Members page's rules as plain functions (spec 0031): which roles a
// person may give whom or invite as, and reading a pasted list of addresses.
// No React or library imports, so tests and the route's loader can use them.
import type { Role } from '@crm/data';

/**
 * The roles `actor` may give `target` on the Members page (spec 0009, AC-137;
 * spec 0031, AC-811): an owner any; an admin moves people between admin,
 * member and guest and never touches an owner; a member or guest none. Empty means the role
 * shows as text, not a control. The server checks again under lock.
 */
export function grantableRoles(actor: Role | undefined, target: Role): readonly Role[] {
  if (actor === 'owner') return ['owner', 'admin', 'member', 'guest'];
  if (actor === 'admin' && target !== 'owner') return ['admin', 'member', 'guest'];
  return [];
}

/** Each role's power, for telling a change that takes access away (it asks first) from one that gives more. */
const RANK: Readonly<Record<Role, number>> = { owner: 3, admin: 2, member: 1, guest: 0 };

/** Whether moving someone from `from` to `to` takes access away from them, so the page asks first. */
export const takesAccess = (from: Role, to: Role): boolean => RANK[to] < RANK[from];

/** Whether `actor` may remove someone holding `target` (the same rules as changing their role), never themself. */
export const canRemove = (actor: Role | undefined, target: Role, isSelf: boolean): boolean =>
  !isSelf && grantableRoles(actor, target).length > 0;

/** The roles an invite may name (AC-803): an owner any, an admin admin, member or guest, anyone else none. */
export function invitableRoles(actor: Role | undefined): readonly Role[] {
  if (actor === 'owner') return ['owner', 'admin', 'member', 'guest'];
  if (actor === 'admin') return ['admin', 'member', 'guest'];
  return [];
}

/** A loose email shape: the server checks each address properly. */
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** Whether `text` looks like one email address (the invite dialog's per row check; the server checks properly). */
export const isEmail = (text: string): boolean => EMAIL.test(text.trim());

/**
 * The addresses in pasted text (commas, semicolons, spaces or new lines
 * between them, `Name <address>` allowed), lowercased and without repeats,
 * and the pieces that aren't addresses.
 */
export function parseEmails(text: string): { readonly emails: readonly string[]; readonly invalid: readonly string[] } {
  // "Ada Lovelace <ada@example.com>" as a mail client copies it: the address alone.
  const bare = text.replace(/[^,;\n<>]*<([^<>]*)>/g, ' $1 ');
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const piece of bare.split(/[\s,;]+/).filter((each) => each !== '')) {
    if (!EMAIL.test(piece)) {
      invalid.push(piece);
      continue;
    }
    const email = piece.toLowerCase();
    if (!emails.includes(email)) emails.push(email);
  }
  return { emails, invalid };
}
