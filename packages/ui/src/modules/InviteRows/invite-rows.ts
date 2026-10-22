// InviteRows' row rules, pure so they are tested on their own: a new row, a row added after another, a row
// removed, and a pasted list split into rows.

/** One person to invite: an id that stays with the row, the address as typed, and the role picked (when roles show). */
export interface InviteRow {
  readonly id: string;
  readonly email: string;
  readonly roleId?: string | undefined;
}

/** A new row, empty unless `email` is given, with `roleId` when roles show. Its id is random, so it never repeats. */
export function createInviteRow(roleId?: string, email = ''): InviteRow {
  return { id: crypto.randomUUID(), email, ...(roleId === undefined ? {} : { roleId }) };
}

/** Anything shaped like an address: a mail client's "Ada Lovelace <ada@acme.com>" gives ada@acme.com. */
const ADDRESS = /[^\s<>,;"'()]+@[^\s<>,;"'()]+/g;

/**
 * The parts of a pasted list. With an `@` in it, the addresses alone (a
 * mail client copies "Ada Lovelace <ada@acme.com>, Bob <bob@x.com>", and the
 * names are dropped); else split on commas, semicolons, spaces and line
 * breaks. Nothing else is judged (the screen decides what is an address).
 */
export function splitList(text: string): readonly string[] {
  if (text.includes('@')) return text.match(ADDRESS) ?? [];
  return text.split(/[\s,;]+/).filter((part) => part !== '');
}

/**
 * True when a change from `before` to `value` is a pasted list: several
 * characters arrived at once and they hold more than one part. A key typed
 * (a stray space, "ada l") never splits a row.
 */
export function isList(value: string, before = ''): boolean {
  return value.length - before.length > 1 && /[\s,;]/.test(value.trim()) && splitList(value).length > 1;
}

/** The rows with a new one after `afterId` (after the last when unknown), taking that row's role. */
export function addRowAfter(
  rows: readonly InviteRow[],
  afterId: string | undefined,
  make: (roleId?: string) => InviteRow = createInviteRow,
): { readonly rows: readonly InviteRow[]; readonly added: InviteRow } {
  const found = afterId === undefined ? -1 : rows.findIndex((row) => row.id === afterId);
  const at = found === -1 ? rows.length - 1 : found;
  const added = make(rows[at]?.roleId);
  return { rows: [...rows.slice(0, at + 1), added, ...rows.slice(at + 1)], added };
}

/** The rows without `id`, and the row to focus next: the one before it, else the new first. */
export function removeRow(
  rows: readonly InviteRow[],
  id: string,
): { readonly rows: readonly InviteRow[]; readonly focus: InviteRow | undefined } {
  const at = rows.findIndex((row) => row.id === id);
  const left = rows.filter((row) => row.id !== id);
  return { rows: left, focus: left[Math.max(0, at - 1)] };
}

/**
 * A pasted list into row `id`: the first part fills it, each other part gets
 * a row after it with the same role, up to `max` rows in all. `dropped` is
 * how many parts didn't fit; `last` is the last row filled.
 */
export function pasteInto(
  rows: readonly InviteRow[],
  id: string,
  value: string,
  max: number,
  make: (roleId?: string, email?: string) => InviteRow = createInviteRow,
): {
  readonly rows: readonly InviteRow[];
  readonly last: InviteRow | undefined;
  readonly kept: number;
  readonly dropped: number;
} {
  const at = rows.findIndex((row) => row.id === id);
  const row = rows[at];
  if (row === undefined) return { rows, last: undefined, kept: 0, dropped: 0 };
  const parts = splitList(value);
  const room = Math.max(1, max - rows.length + 1);
  const filled = parts
    .slice(0, room)
    .map((email, index) => (index === 0 ? { ...row, email } : make(row.roleId, email)));
  return {
    rows: [...rows.slice(0, at), ...filled, ...rows.slice(at + 1)],
    last: filled.at(-1),
    kept: filled.length,
    dropped: parts.length - filled.length,
  };
}
