// Where a member may work (spec 0065 H7, AC-6594), as the member panel's Works in picker reads and writes it: one
// multiple choice Select of Every business, each business whole, and (for a business with two places or more) each of
// its places. Pure, so the rules of which choice clears which are tested without a screen.
import type { MemberReach, MemberReachView } from '@crm/data';

/** The choice that means every business. */
export const EVERY = 'all';
const business = (id: string) => `b:${id}`;
const place = (id: string) => `p:${id}`;

/** One option of the picker: the Select's item shape. */
export interface WorksInItem {
  readonly id: string;
  readonly label: string;
  readonly group?: string;
  readonly description?: string;
}

/** The words the picker uses, passed in so this file holds no copy. */
export interface WorksInWords {
  readonly every: string;
  /** The whole of a business with two places or more: named, since the closed field shows no heading. */
  readonly allOf: (business: string) => string;
}

/**
 * Whether the picker is worth showing: only once there is a choice to make, two businesses or a business with two
 * places. A workspace with one business and one place never sees it (the level shows from a second one, as the spec's
 * switcher does).
 */
export const worksInMatters = (view: MemberReachView): boolean =>
  view.businesses.length > 1 || view.businesses.some((each) => each.places.length > 1);

/** The picker's options: Every business first, then each business under its own heading, whole and by place. */
export function worksInItems(view: MemberReachView, words: WorksInWords): WorksInItem[] {
  return [
    { id: EVERY, label: words.every },
    // A business with one place is one choice, beside Every business; one with more gets a heading over its whole and
    // its places.
    ...view.businesses.flatMap((each) =>
      each.places.length > 1
        ? [
            { id: business(each.id), label: words.allOf(each.name), group: each.name },
            ...each.places.map((at) => ({ id: place(at.id), label: at.name, group: each.name })),
          ]
        : [{ id: business(each.id), label: each.name }],
    ),
  ];
}

/** The chosen options for a reach. */
export const worksInValues = (reach: MemberReach): string[] =>
  reach.all ? [EVERY] : [...reach.properties.map(business), ...reach.places.map(place)];

/**
 * The reach a new set of chosen options means, given the ones before: Every business newly chosen, or nothing left
 * chosen, is every business; a business chosen whole takes its places' own choices away, and a place chosen takes its
 * business's whole choice away, so the field never says both.
 */
export function reachFromValues(
  view: MemberReachView,
  values: readonly string[],
  before: readonly string[],
): MemberReach {
  const added = values.filter((value) => !before.includes(value));
  if (added.includes(EVERY) || values.length === 0) return { all: true, properties: [], places: [] };
  const ownerOf = new Map(view.businesses.flatMap((each) => each.places.map((at) => [at.id, each.id] as const)));
  let properties = values.filter((value) => value.startsWith('b:')).map((value) => value.slice(2));
  let places = values.filter((value) => value.startsWith('p:')).map((value) => value.slice(2));
  for (const value of added) {
    const id = value.slice(2);
    if (value.startsWith('b:')) places = places.filter((at) => ownerOf.get(at) !== id);
    if (value.startsWith('p:')) properties = properties.filter((each) => each !== ownerOf.get(id));
  }
  if (properties.length === 0 && places.length === 0) return { all: true, properties: [], places: [] };
  return { all: false, properties, places };
}
