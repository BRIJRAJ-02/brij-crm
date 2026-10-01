/** Avatar's built in copy. */
export const strings = {
  /** Empty on purpose: the avatar itself is named after the person, so the picture inside adds nothing. */
  pictureAlt: '',
  more: (count: number) => `+${String(count)}`,
  /** The stack's name: everyone in it, so screen readers hear who even past "+N". */
  people: (names: readonly string[]) => new Intl.ListFormat('en', { type: 'conjunction' }).format(names),
} as const;
