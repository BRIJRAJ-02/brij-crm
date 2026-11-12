/** PresenceGroup's built in copy (spec 0073, AC-7308). */
export const presenceStrings = {
  /** What a person is doing when the screen says nothing more. */
  hereNow: 'Here now',
  away: 'Away',
  /** One avatar's tooltip: the person and what they are doing. */
  tooltip: (name: string, activity: string) => `${name} · ${activity}`,
  /** "+n" for the people past the avatars drawn. */
  more: (count: number) => `+${String(count)}`,
  /**
   * The group's name: how many are here, and at most the first few by name, then how many others, so the name never
   * grows with the crowd ("3 here: Maya, Jo and Ana", "1,000 here: Maya, Jo, Ana, Raj and 996 others").
   */
  group: (total: number, names: readonly string[], others: number) => {
    const count = new Intl.NumberFormat('en').format(total);
    const named = others > 0 ? [...names, `${new Intl.NumberFormat('en').format(others)} others`] : names;
    return `${count} here: ${new Intl.ListFormat('en', { type: 'conjunction' }).format(named)}`;
  },
} as const;
