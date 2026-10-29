/** RolePowers' built in copy. */
export const strings = {
  /** An area's standing beside its title, so the icon never carries it alone. */
  standing: { all: 'All', some: 'Some', none: 'None' },
  /** The standing as the row's button reads it, before its title: "Some, Forms and booking". */
  standingSpoken: (standing: string) => `${standing}, `,
  /** Read before a power the role doesn't hold, which is drawn quieter. */
  cannot: 'Can’t: ',
  loading: 'Loading what the role can do',
} as const;
