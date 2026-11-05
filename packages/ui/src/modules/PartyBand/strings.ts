/** PartyBand's built in copy. */
export const strings = {
  partySize: 'Party size',
  upTo: (max: number) => (max === 1 ? 'Up to 1 guest' : `Up to ${String(max)} guests`),
  /** The fewest is more than one: both ends ("2 to 4 guests"). */
  range: (min: number, max: number) => `${String(min)} to ${String(max)} guests`,
  /** At the most the page takes online: the way to book a bigger table. */
  moreThan: (max: number) => `More than ${String(max)}?`,
  call: (phone: string) => `Call ${phone}`,
  callRestaurant: 'Call the restaurant.',
  fewer: 'One fewer guest',
  more: 'One more guest',
} as const;
