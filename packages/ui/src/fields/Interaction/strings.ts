/** The interaction field's built in copy. */
export const strings = {
  email: 'Email',
  meeting: 'Meeting',
  by: (name: string) => `by ${name}`,
  /** No email or meeting yet, as Attio's table says it. */
  none: 'No contact',
} as const;
