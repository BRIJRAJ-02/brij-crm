/** MeetingCard's built in copy. */
export const strings = {
  /** The people row's name for screen readers, when the screen gives none. */
  people: 'Guests',
  /** A copy button's name, after what it copies. */
  copy: (value: string) => `Copy ${value}`,
} as const;
