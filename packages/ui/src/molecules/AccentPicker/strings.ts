/** AccentPicker's built in copy. */
export const strings = {
  /** The swatch that opens the system's own colour picker, for any colour at all. */
  anyColour: 'Any colour',
  /** The hex field's name: the colour as six digits. */
  hex: 'Hex',
  /** What the hex field shows before anything is typed. */
  hexPlaceholder: '#1f5fd6',
  /** The one sentence a colour that isn't a hex is refused with. It never repeats what was typed. */
  hexRefusal: 'Use a colour like #1f5fd6.',
  /** The guard moved the colour noticeably (spec 0060, AC-6): said once, beside the colours it draws. */
  adjusted: 'Adjusted so text stays readable.',
  /** The two drawn swatches' names. */
  drawnLight: (hex: string) => `Drawn in light as ${hex}`,
  drawnDark: (hex: string) => `Drawn in dark as ${hex}`,
  /** A quick pick's name: the hue's own. */
  pick: (name: string) => name,
} as const;
