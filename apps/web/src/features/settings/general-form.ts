// Settings › Workspace › General's name, saved on its own once an edit ends (Enter, or leaving the field): what the
// edit does. The address has its own dialog and check (ChangeAddressDialog). Pure, tested on its own.

/** What a finished edit of the name does: nothing, a save of the trimmed name, or a refusal said on the field. */
export type NameEdit =
  { readonly kind: 'same' } | { readonly kind: 'save'; readonly name: string } | { readonly kind: 'missing' };

/** The edit `typed` makes to the `saved` name: trimmed, unchanged when it matches, missing when nothing is left. */
export function nameEdit(saved: string, typed: string): NameEdit {
  const trimmed = typed.trim();
  if (trimmed === '') return { kind: 'missing' };
  return trimmed === saved ? { kind: 'same' } : { kind: 'save', name: trimmed };
}
