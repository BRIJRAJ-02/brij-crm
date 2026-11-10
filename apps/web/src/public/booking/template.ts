// The look a booking page wears (the owner, 9 November 2026): Classic or Night only. Shared by the public page and
// the editor's Look, so both read a stored template the same way.

/** A stored template as a booking page wears it: Studio and Split read as Classic; nothing stored changes. */
export function bookingTemplate<T extends string>(template: T | undefined): T | 'classic' | undefined {
  return template === 'studio' || template === 'split' ? 'classic' : template;
}
