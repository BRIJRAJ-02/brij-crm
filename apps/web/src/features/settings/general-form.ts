// Settings › Workspace › General's name rule: the field saves on its own when it
// is left or Enter is pressed (the owner's save rule, 21 October 2026), so this
// says what leaving it does. The address is changed in its own dialog, which
// checks it as typed. Pure, tested on its own.

/** What leaving the name field does: nothing, refuse an empty name, or rename to the trimmed name. */
export type NameCommit =
  { readonly kind: 'same' } | { readonly kind: 'missing' } | { readonly kind: 'rename'; readonly name: string };

/**
 * The commit for a typed name against the saved one: spaces round it don't count, an empty name is refused (and
 * nothing is saved), and only a real change renames.
 */
export function nameCommit(saved: string, typed: string): NameCommit {
  const name = typed.trim();
  if (name === '') return { kind: 'missing' };
  return name === saved ? { kind: 'same' } : { kind: 'rename', name };
}
