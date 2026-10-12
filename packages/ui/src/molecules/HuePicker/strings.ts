/** HuePicker's built in copy: the hues' names, and the compact swatch's name. */
export const strings = {
  gray: 'Gray',
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  lime: 'Lime',
  green: 'Green',
  sky: 'Sky',
  blue: 'Blue',
  purple: 'Purple',
  /** The compact picker's swatch: what it is for and the hue chosen ("Gold colour: Yellow"). */
  chosen: (label: string, hue: string) => `${label}: ${hue}`,
} as const;
