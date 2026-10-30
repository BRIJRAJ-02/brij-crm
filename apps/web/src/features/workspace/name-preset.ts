// The command menu's "Create <object> named …" (the flow pass of 30 Oct
// 2026): what was typed, as the new record dialog's name, in the shape of the
// object's name attribute. Pure, so the node tests cover it.

/** The dialog's preset for a name attribute of this type, or undefined when it holds no name as text. */
export function namePreset(
  attribute: { readonly id: string; readonly type: string } | undefined,
  name: string | undefined,
): Readonly<Record<string, unknown>> | undefined {
  const text = name?.trim() ?? '';
  if (attribute === undefined || text === '') return undefined;
  if (attribute.type === 'text') return { [attribute.id]: text };
  if (attribute.type === 'personal_name') {
    // The first word is the first name, the rest the last name, as most names are typed.
    const [first = '', ...rest] = text.split(/\s+/u);
    const last = rest.join(' ');
    return { [attribute.id]: { firstName: first, ...(last === '' ? {} : { lastName: last }), fullName: text } };
  }
  return undefined;
}
