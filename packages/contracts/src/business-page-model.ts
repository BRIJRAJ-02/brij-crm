// The business page (spec 0066, B4 lite; owner priority R1 in spec 0068): the closed lists, limits, shapes and pure
// rules the editor, the API, the handle shell and the public page share. Plain TypeScript with no Zod, so the public
// bundle and the shell stay small (`@crm/contracts/business-page`); the RPC's schemas are in `business-page.ts`.
import { type BusinessKind, type PlaceHoursShape, type WeekDay, WEEK_DAYS, spanOf } from './hospitality-model.ts';

/** How much a business page holds. */
export const BUSINESS_PAGE_LIMITS = {
  /** Pictures in the gallery (AC-6641). */
  photos: 20,
  /** Pictures kept for a business at once, gallery or not: room for a draft to swap all 20. */
  photosStored: 60,
  /** The About text. */
  aboutMax: 1000,
  /** A picture's description for people who can't see it. */
  altMax: 120,
  /** Handles a business holds, its old ones included (migration 0179). */
  handles: 20,
  /** A place's slug. */
  slugMax: 60,
} as const;

/** The amenities a page can list (AC-6641: a closed list). */
export const BUSINESS_AMENITIES = [
  'wifi',
  'parking',
  'wheelchair',
  'cards',
  'kids',
  'outdoor',
  'pets',
  'air_conditioning',
  'vegetarian',
  'private_dining',
] as const;
/** One amenity. */
export type BusinessAmenity = (typeof BUSINESS_AMENITIES)[number];

/** Each amenity in plain words, as the page and the editor say it. */
export const AMENITY_LABELS: Readonly<Record<BusinessAmenity, string>> = {
  wifi: 'Wi‑Fi',
  parking: 'Parking',
  wheelchair: 'Wheelchair access',
  cards: 'Card payments',
  kids: 'Kids friendly',
  outdoor: 'Outdoor seating',
  pets: 'Pets welcome',
  air_conditioning: 'Air conditioning',
  vegetarian: 'Vegetarian options',
  private_dining: 'Private dining',
};

/**
 * Words a business's second segment never takes (0066, Rules settled: Handles): the business's own addresses
 * (`/<handle>/book`, `/reserve`, …), so no place slug can shadow one.
 */
export const BUSINESS_SECOND_SEGMENTS = [
  'book',
  'reserve',
  'visit',
  'menu',
  'e',
  'events',
  'team',
  'reviews',
  'services',
] as const;

/** A place slug's shape: lowercase letters, digits and single hyphens, 1 to 60 characters. */
export const PLACE_SLUG_PATTERN = /^(?=.{1,60}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Why `slug` can't be a place's slug, in plain words, or undefined when it can. */
export function placeSlugProblem(slug: string): string | undefined {
  if (slug.length === 0) return 'Add a short address for this place.';
  if (slug.length > BUSINESS_PAGE_LIMITS.slugMax) return 'Use at most 60 characters.';
  if (!PLACE_SLUG_PATTERN.test(slug)) return 'Use lowercase letters, numbers and single hyphens.';
  if ((BUSINESS_SECOND_SEGMENTS as readonly string[]).includes(slug))
    return 'That word is kept for the page. Pick another.';
  return undefined;
}

/** A place's first slug, from its name ("Indiranagar Studio" → `indiranagar-studio`), never a reserved word. */
export function placeSlugFromName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, BUSINESS_PAGE_LIMITS.slugMax)
    .replace(/-+$/g, '');
  const slug = base === '' ? 'place' : base;
  return (BUSINESS_SECOND_SEGMENTS as readonly string[]).includes(slug) ? `${slug}-place` : slug;
}

/**
 * The handles a business's name suggests for its first address, best first (the Foolproof rule: the field starts
 * filled): the name as a handle ("Somewhere Nowhere" reads `somewhere-nowhere`), then the same with `-2` to `-5`.
 * Only handle shaped ones (3 to 40 characters); the caller drops reserved words and any somebody holds. None for a
 * name with fewer than three letters or digits.
 */
export function handleCandidatesFromName(name: string): readonly string[] {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  if (base.length < 3) return [];
  const numbered = [2, 3, 4, 5].map((n) => `${base.slice(0, 40 - 2).replace(/-+$/g, '')}-${String(n)}`);
  return [base, ...numbered].filter((handle) => /^(?=.{3,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle));
}

/** One picture of the gallery, as the draft and the snapshot keep it. */
export interface BusinessPhotoShape {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly alt?: string | undefined;
}

/** What the editor drafts and Publish freezes (spec 0068's draft and snapshot): the page's own content. */
export interface BusinessPageContentShape {
  readonly gallery: readonly BusinessPhotoShape[];
  readonly amenities: readonly BusinessAmenity[];
  readonly about?: string | undefined;
  /** Places search engines are told not to list (AC-6644): `noindex`, and out of the sitemap. */
  readonly hiddenPlaces: readonly string[];
}

/** A page nobody has drafted anything on yet. */
export const EMPTY_BUSINESS_PAGE: BusinessPageContentShape = { gallery: [], amenities: [], hiddenPlaces: [] };

/**
 * One section of a published menu (0065 H1), as the business page shows it. Named apart from the guest menu's own
 * `PublicMenu` (`menu.ts`), which is the whole snapshot `/m/<key>` reads.
 */
export interface BusinessPageMenuSection {
  readonly name: string;
  readonly items: readonly {
    readonly name: string;
    readonly description?: string | undefined;
    /** Formatted in the place's locale and the workspace's currency ("₹450"), or absent. */
    readonly price?: string | undefined;
    /** The dish's list photo on the guest menu's own route (`/api/public/menu/<key>/photos/<id>/small?v=`), if any. */
    readonly photo?: string | undefined;
  }[];
}

/** A place's published menu, or nothing until the Menu app (H1) publishes one. */
export interface BusinessPageMenu {
  readonly sections: readonly BusinessPageMenuSection[];
  /** The whole guest menu's address on the public host (`/m/<menu key>`), with photos, options and Your picks. */
  readonly path?: string | undefined;
}

/** One place as the public page shows it. */
export interface PublicBusinessPlace {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly addressLine?: string | undefined;
  readonly city?: string | undefined;
  readonly postcode?: string | undefined;
  readonly country: string;
  readonly phone?: string | undefined;
  readonly timeZone: string;
  readonly hours: PlaceHoursShape;
  /** Hidden from search engines (AC-6644). */
  readonly seoHidden: boolean;
}

/** What `GET /api/public/business/:handle[/:place]` answers: the published page and the place asked for. */
export interface PublicBusinessPage {
  /** The business's current handle: an old one's address shows this one. */
  readonly handle: string;
  readonly name: string;
  readonly kind: BusinessKind;
  readonly description?: string | undefined;
  readonly about?: string | undefined;
  readonly phone?: string | undefined;
  readonly website?: string | undefined;
  readonly gallery: readonly (BusinessPhotoShape & {
    /** The picture's address on our own origin, versioned. */
    readonly src: string;
  })[];
  readonly amenities: readonly BusinessAmenity[];
  readonly places: readonly PublicBusinessPlace[];
  /** The place this address shows: the one its slug names, else the first. */
  readonly placeId: string;
  /** The place's published menu (when the Menu app is installed and has published one). */
  readonly menu?: BusinessPageMenu | undefined;
  /** Reserve a table: `soon` while the reservation flow isn't open yet, `open` once it is; absent without the app. */
  readonly reserve?: 'soon' | 'open' | undefined;
  /**
   * Where Reserve goes while `reserve` is `open`: the place's reservation page on the public host (`/r/<public key>`,
   * Table seating, spec 0066 B7).
   */
  readonly reservePath?: string | undefined;
  /** The workspace's brand kit versions: its accent stylesheet's and its logo's (`/brand.css?v=`, `/logo?v=`). */
  readonly brand?: { readonly version?: string | undefined; readonly logo?: string | undefined } | undefined;
  /**
   * The guest look's version (5 November 2026): the guest menu's look stylesheet with the brand's accent in it, at
   * `/api/public/business/<handle>/look/menu.css?v=<look>`, which the page wears in place of the brand's own.
   */
  readonly look?: string | undefined;
  /** Whether search engines may list this address (AC-6644: a place can be hidden). */
  readonly indexable: boolean;
  /** When the page was last published. */
  readonly publishedAt: string;
  /** The edge cache tags this answer is filed under (`business:<opaque id>`, `place:<id>`), never a workspace id. */
  readonly tags: readonly string[];
}

/** What Publish needs fixed first, in one line, and where to fix it (spec 0068: Publish refuses a broken page). */
export interface BusinessPageProblem {
  readonly message: string;
  readonly fix: 'handle' | 'profile' | 'place' | 'hours' | 'address';
  /** The place to fix, when the problem is one place's. */
  readonly placeId?: string | undefined;
}

/** The facts Publish checks. */
export interface PublishFacts {
  readonly handle?: string | undefined;
  readonly name?: string | undefined;
  readonly places: readonly {
    readonly id: string;
    readonly name: string;
    readonly addressLine?: string | undefined;
    readonly city?: string | undefined;
    readonly hours: PlaceHoursShape;
  }[];
}

/** Whether `hours` opens at least once a week. */
export function hasWeeklyHours(hours: PlaceHoursShape): boolean {
  return WEEK_DAYS.some((day) => (hours.weekly[day] ?? []).some((range) => spanOf(range) !== undefined));
}

/**
 * The first thing that would leave the page broken (AC-6641; spec 0068, Foolproof): no address to put it at, no
 * name, no place, a place with no address or no hours. Undefined when the page can go live.
 */
export function businessPublishProblem(facts: PublishFacts): BusinessPageProblem | undefined {
  if (facts.handle === undefined || facts.handle === '') {
    return { message: 'Choose the page’s address first.', fix: 'handle' };
  }
  if (facts.name === undefined || facts.name.trim() === '') {
    return { message: 'Name the business first.', fix: 'profile' };
  }
  const first = facts.places[0];
  if (first === undefined) return { message: 'Add a place first.', fix: 'place' };
  for (const place of facts.places) {
    if ((place.addressLine ?? '').trim() === '' || (place.city ?? '').trim() === '') {
      return { message: `Add ${place.name}’s street and city first.`, fix: 'address', placeId: place.id };
    }
    if (!hasWeeklyHours(place.hours)) {
      return { message: `Set ${place.name}’s opening hours first.`, fix: 'hours', placeId: place.id };
    }
  }
  return undefined;
}

/** A place's address on one line ("12 MG Road, Bengaluru 560001"), or undefined with nothing to show. */
export function placeAddressLine(
  place: Pick<PublicBusinessPlace, 'addressLine' | 'city' | 'postcode'>,
): string | undefined {
  const city = [place.city, place.postcode].filter((part) => part !== undefined && part !== '').join(' ');
  const line = [place.addressLine, city].filter((part) => part !== undefined && part !== '').join(', ');
  return line === '' ? undefined : line;
}

/** The two map apps' Directions addresses for a place (AC-6645): no embedded map, the visitor's own app. */
export function directionsLinks(
  place: Pick<PublicBusinessPlace, 'name' | 'addressLine' | 'city' | 'postcode' | 'country'>,
): { readonly google: string; readonly apple: string } | undefined {
  const line = placeAddressLine(place);
  if (line === undefined) return undefined;
  const query = `${place.name}, ${line}, ${place.country}`;
  return {
    google: `https://www.google.com/maps/dir/?${new URLSearchParams({ api: '1', destination: query }).toString()}`,
    apple: `https://maps.apple.com/?${new URLSearchParams({ daddr: query }).toString()}`,
  };
}

/** The schema.org type of each kind of business (AC-6644). */
export const SCHEMA_TYPES: Readonly<Record<BusinessKind, string>> = {
  restaurant: 'Restaurant',
  cafe: 'CafeOrCoffeeShop',
  bar: 'BarOrPub',
  bakery: 'Bakery',
  salon: 'BeautySalon',
  spa: 'DaySpa',
  barber: 'HairSalon',
  clinic: 'MedicalClinic',
  fitness: 'HealthClub',
  other: 'LocalBusiness',
};

const SCHEMA_DAYS: Readonly<Record<WeekDay, string>> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

/** A place's weekly hours as schema.org `OpeningHoursSpecification`s, one per range (a range past midnight ends at its `to`). */
export function openingHoursSpecification(hours: PlaceHoursShape): readonly Record<string, string>[] {
  return WEEK_DAYS.flatMap((day) =>
    (hours.weekly[day] ?? []).flatMap((range) =>
      spanOf(range) === undefined
        ? []
        : [
            {
              '@type': 'OpeningHoursSpecification',
              dayOfWeek: `https://schema.org/${SCHEMA_DAYS[day]}`,
              opens: range.from,
              closes: range.to,
            },
          ],
    ),
  );
}

/**
 * The page's structured data (AC-6644): the place as its schema.org business type, with its address, opening hours,
 * telephone, pictures and links, and `hasMenu` or `acceptsReservations` where the page has them. Nothing a visitor
 * typed; every value comes from the published page.
 */
export function businessJsonLd(page: PublicBusinessPage, origin: string): Record<string, unknown> {
  const place = page.places.find((each) => each.id === page.placeId) ?? page.places[0];
  const url =
    place === undefined || page.places.length <= 1
      ? `${origin}/${page.handle}`
      : `${origin}/${page.handle}/${place.slug}`;
  const images = page.gallery.slice(0, 6).map((photo) => `${origin}${photo.src}`);
  const telephone = place?.phone ?? page.phone;
  const hours = place === undefined ? [] : openingHoursSpecification(place.hours);
  return {
    '@context': 'https://schema.org',
    '@type': SCHEMA_TYPES[page.kind],
    '@id': `${url}#business`,
    name: page.places.length > 1 && place !== undefined ? `${page.name} ${place.name}` : page.name,
    url,
    ...(page.description === undefined ? {} : { description: page.description }),
    ...(images.length === 0 ? {} : { image: images }),
    ...(telephone === undefined ? {} : { telephone }),
    ...(place === undefined
      ? {}
      : {
          address: {
            '@type': 'PostalAddress',
            ...(place.addressLine === undefined ? {} : { streetAddress: place.addressLine }),
            ...(place.city === undefined ? {} : { addressLocality: place.city }),
            ...(place.postcode === undefined ? {} : { postalCode: place.postcode }),
            addressCountry: place.country,
          },
        }),
    ...(hours.length === 0 ? {} : { openingHoursSpecification: hours }),
    ...(page.menu === undefined ? {} : { hasMenu: `${url}#menu` }),
    ...(page.reserve === 'open' ? { acceptsReservations: 'True' } : {}),
    ...(page.amenities.length === 0
      ? {}
      : {
          amenityFeature: page.amenities.map((amenity) => ({
            '@type': 'LocationFeatureSpecification',
            name: AMENITY_LABELS[amenity],
            value: true,
          })),
        }),
    ...(page.website === undefined ? {} : { sameAs: [page.website] }),
  };
}

/** The page's content read leniently: anything malformed reads as empty, so an old draft never breaks a read. */
export function businessContentOf(value: unknown): BusinessPageContentShape {
  if (typeof value !== 'object' || value === null) return EMPTY_BUSINESS_PAGE;
  const given = value as Record<string, unknown>;
  const gallery = Array.isArray(given.gallery)
    ? (given.gallery as unknown[]).flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null) return [];
        const { id, width, height, alt } = entry as Record<string, unknown>;
        if (typeof id !== 'string' || typeof width !== 'number' || typeof height !== 'number') return [];
        return [{ id, width, height, ...(typeof alt === 'string' && alt !== '' ? { alt } : {}) }];
      })
    : [];
  const amenities = Array.isArray(given.amenities)
    ? (given.amenities as unknown[]).filter((each): each is BusinessAmenity =>
        (BUSINESS_AMENITIES as readonly unknown[]).includes(each),
      )
    : [];
  const hiddenPlaces = Array.isArray(given.hiddenPlaces)
    ? (given.hiddenPlaces as unknown[]).filter((each): each is string => typeof each === 'string')
    : [];
  return {
    gallery: gallery.slice(0, BUSINESS_PAGE_LIMITS.photos),
    amenities,
    ...(typeof given.about === 'string' && given.about !== '' ? { about: given.about } : {}),
    hiddenPlaces,
  };
}

/** A count in words: "1 photo", "3 photos". */
const counted = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * What a draft changes from the published page, as plain sentences for the editor's Changes list (spec 0068,
 * AC-6811). Empty when nothing differs. With nothing published, every part is new.
 */
export function businessPageChanges(
  published: BusinessPageContentShape | undefined,
  draft: BusinessPageContentShape,
  placeName: (id: string) => string = (id) => id,
): readonly string[] {
  const before = published ?? EMPTY_BUSINESS_PAGE;
  const changes: string[] = [];
  const beforeIds = new Set(before.gallery.map((photo) => photo.id));
  const draftIds = new Set(draft.gallery.map((photo) => photo.id));
  const added = draft.gallery.filter((photo) => !beforeIds.has(photo.id)).length;
  const removed = before.gallery.filter((photo) => !draftIds.has(photo.id)).length;
  if (added > 0) changes.push(`Gallery: ${counted(added, 'photo', 'photos')} added`);
  if (removed > 0) changes.push(`Gallery: ${counted(removed, 'photo', 'photos')} removed`);
  const kept = draft.gallery.filter((photo) => beforeIds.has(photo.id)).map((photo) => photo.id);
  const keptBefore = before.gallery.filter((photo) => draftIds.has(photo.id)).map((photo) => photo.id);
  if (kept.join() !== keptBefore.join()) changes.push('Gallery: photos reordered');
  const altBefore = new Map(before.gallery.map((photo) => [photo.id, photo.alt ?? '']));
  if (draft.gallery.some((photo) => altBefore.has(photo.id) && altBefore.get(photo.id) !== (photo.alt ?? ''))) {
    changes.push('Gallery: descriptions changed');
  }
  for (const each of draft.amenities.filter((amenity) => !before.amenities.includes(amenity))) {
    changes.push(`Amenities: ${AMENITY_LABELS[each]} added`);
  }
  for (const each of before.amenities.filter((amenity) => !draft.amenities.includes(amenity))) {
    changes.push(`Amenities: ${AMENITY_LABELS[each]} removed`);
  }
  if ((before.about ?? '') !== (draft.about ?? '')) changes.push('About text changed');
  for (const id of draft.hiddenPlaces.filter((each) => !before.hiddenPlaces.includes(each))) {
    changes.push(`${placeName(id)}: hidden from search engines`);
  }
  for (const id of before.hiddenPlaces.filter((each) => !draft.hiddenPlaces.includes(each))) {
    changes.push(`${placeName(id)}: shown to search engines`);
  }
  return changes;
}
