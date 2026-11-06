// The item sheet's form as plain data (ItemDialog draws it): what an item reads as in the form, what the form reads
// as when saved, and the rules that keep it from contradicting itself. An item has one price, sizes or a price text;
// an allergen is contained or may be, never both; one spice level at most.
import type { ItemAllergen, ItemFields, MenuDraft, MenuItem } from '@crm/data';
import { DIET_MARKS, EU_ALLERGENS, MENU_LIMITS, minorToDecimal, parsePrice } from '@crm/data/menu';
import { strings } from './strings.ts';

/** The three ways an item can be priced; only the one chosen is saved. */
export type PriceKind = 'price' | 'sizes' | 'text';

/** One size being edited. An untouched row (no name, no price) is left out on save. */
export interface SizeRow {
  readonly key: string;
  readonly id?: string;
  readonly name: string;
  readonly price: string;
}

/** What the sheet holds while someone edits it. */
export interface ItemForm {
  readonly name: string;
  readonly description: string;
  readonly priceKind: PriceKind;
  readonly price: string;
  readonly priceText: string;
  readonly sizes: readonly SizeRow[];
  readonly contains: readonly string[];
  readonly may: readonly string[];
  /** The marks, without the spice level. */
  readonly diet: readonly string[];
  /** One spice level, or `NO_SPICE`. */
  readonly spice: string;
  readonly groupIds: readonly string[];
  readonly kcal: string;
  readonly featured: boolean;
  readonly isAvailable: boolean;
}

/** The spice choice that means none. */
export const NO_SPICE = 'none';

/** The spice levels, mildest first: at most one on an item, as the server insists. */
export const SPICE_MARKS: readonly string[] = DIET_MARKS.filter((mark) => mark.startsWith('spicy_'));

/** The marks that aren't a spice level. */
export const PLAIN_DIET_MARKS: readonly string[] = DIET_MARKS.filter((mark) => !mark.startsWith('spicy_'));

/** Keeps `chosen` in `order`'s order, so the same choices always compare and save the same. */
const inOrder = (order: readonly string[], chosen: readonly string[]): readonly string[] =>
  order.filter((each) => chosen.includes(each));

/**
 * An item (or a new one, named `newName`) as the form holds it. Which price it opens on is what guests are shown:
 * sizes over a price over a price text.
 */
export function itemForm(item: MenuItem | undefined, newName: string | undefined, currency: string): ItemForm {
  const sizes = item?.sizes ?? [];
  const price = item?.priceMinor;
  return {
    name: item?.name ?? newName ?? '',
    description: item?.description ?? '',
    priceKind: sizes.length > 0 ? 'sizes' : price === undefined && (item?.priceNote ?? '') !== '' ? 'text' : 'price',
    price: price === undefined ? '' : minorToDecimal(price, currency),
    priceText: item?.priceNote ?? '',
    sizes: sizes.map((size) => ({
      key: size.id,
      id: size.id,
      name: size.name,
      price: minorToDecimal(size.priceMinor, currency),
    })),
    contains: inOrder(
      EU_ALLERGENS,
      item?.allergens.filter((each) => each.level === 'contains').map((each) => each.code) ?? [],
    ),
    may: inOrder(EU_ALLERGENS, item?.allergens.filter((each) => each.level === 'may').map((each) => each.code) ?? []),
    diet: inOrder(PLAIN_DIET_MARKS, item?.diet ?? []),
    spice: item?.diet.find((mark) => mark.startsWith('spicy_')) ?? NO_SPICE,
    groupIds: item?.groupIds ?? [],
    kcal: item?.kcal === undefined ? '' : String(item.kcal),
    featured: item?.featured ?? false,
    isAvailable: !(item?.soldOut ?? false),
  };
}

/**
 * The form with another price kind chosen. Nothing typed is lost: the first size takes the price typed so far, and
 * coming back the price takes the first size's, so changing your mind costs nothing. `newKey` keys new rows.
 */
export function withPriceKind(form: ItemForm, kind: PriceKind, newKey: () => string): ItemForm {
  if (kind === form.priceKind) return form;
  if (kind === 'sizes' && form.sizes.length === 0) {
    return {
      ...form,
      priceKind: kind,
      sizes: [
        { key: newKey(), name: '', price: form.price },
        { key: newKey(), name: '', price: '' },
      ],
    };
  }
  if (kind === 'price' && form.price.trim() === '') {
    return { ...form, priceKind: kind, price: form.sizes.find((size) => size.price.trim() !== '')?.price ?? '' };
  }
  return { ...form, priceKind: kind };
}

/** Contains chosen; an allergen now contained stops being a may contain, so it can never be both. */
export const withContains = (form: ItemForm, contains: readonly string[]): ItemForm => ({
  ...form,
  contains,
  may: form.may.filter((code) => !contains.includes(code)),
});

const isBlankRow = (size: SizeRow): boolean => size.name.trim() === '' && size.price.trim() === '';

/** Only what would be saved: what a kind not chosen holds never counts as a change. */
const saved = (form: ItemForm) => ({
  name: form.name.trim(),
  description: form.description.trim(),
  price: form.priceKind === 'price' ? form.price.trim() : '',
  priceText: form.priceKind === 'text' ? form.priceText.trim() : '',
  sizes:
    form.priceKind === 'sizes'
      ? form.sizes.filter((size) => !isBlankRow(size)).map((size) => [size.name.trim(), size.price.trim()])
      : [],
  contains: form.contains,
  may: form.may,
  diet: form.diet,
  spice: form.spice,
  groupIds: form.groupIds,
  kcal: form.kcal.trim(),
  featured: form.featured,
  isAvailable: form.isAvailable,
});

/** Whether saving `form` would change anything from `was`. */
export const hasChanged = (form: ItemForm, was: ItemForm): boolean =>
  JSON.stringify(saved(form)) !== JSON.stringify(saved(was));

/** What the form says is wrong, by field: `name`, `price`, `kcal`, `size-<key>-name` and `-price`. Empty when it can be saved. */
export function itemProblems(form: ItemForm, currency: string): Readonly<Record<string, string>> {
  const kcal = Number(form.kcal.trim());
  return {
    ...(form.name.trim() === '' ? { name: strings.nameMissing } : {}),
    ...(form.priceKind === 'price' && form.price.trim() !== '' && parsePrice(form.price, currency) === undefined
      ? { price: strings.priceInvalid }
      : {}),
    ...(form.kcal.trim() !== '' && (!Number.isInteger(kcal) || kcal < 0 || kcal > MENU_LIMITS.kcalMax)
      ? { kcal: strings.kcalInvalid }
      : {}),
    ...(form.priceKind === 'sizes'
      ? Object.fromEntries(
          form.sizes
            .filter((size) => !isBlankRow(size))
            .flatMap((size): (readonly [string, string])[] => [
              ...(size.name.trim() === '' ? ([[`size-${size.key}-name`, strings.sizeNameMissing]] as const) : []),
              ...(parsePrice(size.price, currency) === undefined
                ? ([[`size-${size.key}-price`, strings.priceInvalid]] as const)
                : []),
            ]),
        )
      : {}),
  };
}

/** The form as the item it saves; only the price kind chosen goes with it. Check `itemProblems` first. */
export function itemFields(form: ItemForm, currency: string): ItemFields {
  const allergens: ItemAllergen[] = [
    ...form.contains.map((code) => ({ code, level: 'contains' }) as ItemAllergen),
    ...form.may.map((code) => ({ code, level: 'may' }) as ItemAllergen),
  ];
  const text = form.priceText.trim();
  const description = form.description.trim();
  const sizes = form.priceKind === 'sizes' ? form.sizes.filter((size) => !isBlankRow(size)) : [];
  return {
    name: form.name.trim(),
    ...(description === '' ? {} : { description }),
    priceMinor:
      form.priceKind === 'price' && form.price.trim() !== '' ? (parsePrice(form.price, currency) ?? null) : null,
    ...(form.priceKind === 'text' && text !== '' ? { priceNote: text } : {}),
    diet: [...form.diet, ...(form.spice === NO_SPICE ? [] : [form.spice])] as ItemFields['diet'],
    allergens,
    kcal: form.kcal.trim() === '' ? null : Number(form.kcal),
    featured: form.featured,
    sizes: sizes.map((size) => ({
      ...(size.id === undefined ? {} : { id: size.id }),
      name: size.name.trim(),
      priceMinor: parsePrice(size.price, currency) ?? 0,
    })),
    groupIds: [...form.groupIds],
  };
}

/** What each mark rules out among the allergens an item contains. */
const RULED_OUT: Readonly<Record<string, readonly string[]>> = {
  vegan: ['milk', 'eggs', 'fish', 'crustaceans', 'molluscs'],
  vegetarian: ['fish', 'crustaceans', 'molluscs'],
  gluten_free: ['gluten'],
  dairy_free: ['milk'],
};

const allergenWord = (code: string): string => strings.allergens[code as keyof typeof strings.allergens].toLowerCase();

/**
 * Quiet lines under Dietary, for a mark the allergens contradict (Vegan with Milk contained, Gluten free with Gluten
 * possible) or leave unsaid: guests' allergens come from the allergen fields, so "Contains nuts" alone doesn't reach
 * them. A warning, not a refusal: the person may know something this doesn't.
 */
export const dietNotes = (form: ItemForm): readonly string[] => [
  ...form.diet.flatMap((mark) => {
    const ruledOut = RULED_OUT[mark] ?? [];
    const label = strings.diets[mark as keyof typeof strings.diets];
    return [
      ...ruledOut
        .filter((code) => form.contains.includes(code))
        .map((code) => strings.dietClash(label, allergenWord(code))),
      ...ruledOut
        .filter((code) => form.may.includes(code))
        .map((code) => strings.dietMayClash(label, allergenWord(code))),
    ];
  }),
  ...(form.diet.includes('contains_nuts') && !form.contains.some((code) => code === 'nuts' || code === 'peanuts')
    ? [strings.nutsUnsaid]
    : []),
];

/** The everyday words people search an allergen by, beyond its name. */
const ALSO_KNOWN_AS: Readonly<Record<string, readonly string[]>> = {
  celery: ['celeriac'],
  gluten: ['wheat', 'barley', 'rye', 'oats', 'flour'],
  crustaceans: ['shellfish', 'prawn', 'shrimp', 'crab', 'lobster'],
  eggs: ['egg'],
  milk: ['dairy', 'lactose', 'cream', 'butter', 'cheese'],
  molluscs: ['shellfish', 'mussel', 'oyster', 'squid', 'clam'],
  nuts: ['nut', 'almond', 'walnut', 'cashew', 'hazelnut', 'pistachio'],
  peanuts: ['nut', 'groundnut'],
  sesame: ['tahini'],
  soya: ['soy', 'tofu'],
  sulphites: ['sulfite', 'wine'],
};

/** Whether a search finds this allergen, by its name or an everyday word for it ("dairy" finds Milk). */
export const findsAllergen = (item: { readonly id: string; readonly label: string }, query: string): boolean => {
  const typed = query.trim().toLowerCase();
  return [item.label.toLowerCase(), ...(ALSO_KNOWN_AS[item.id] ?? [])].some((word) => word.includes(typed));
};

/**
 * Where a new item made outside any section can go: each section, its sub sections after it, under its menu's name
 * when there are several menus.
 */
export const placeChoices = (
  draft: Pick<MenuDraft, 'menus' | 'sections'>,
): readonly { readonly id: string; readonly label: string; readonly group?: string }[] =>
  [...draft.menus]
    .sort((a, b) => a.position - b.position)
    .flatMap((menu) => {
      const own = draft.sections.filter((section) => section.menuId === menu.id);
      const group = draft.menus.length > 1 ? { group: menu.name } : {};
      return own
        .filter((section) => section.parentId === undefined)
        .sort((a, b) => a.position - b.position)
        .flatMap((top) => [
          { id: top.id, label: top.name, ...group },
          ...own
            .filter((section) => section.parentId === top.id)
            .sort((a, b) => a.position - b.position)
            .map((sub) => ({ id: sub.id, label: strings.sectionPath(top.name, sub.name), ...group })),
        ]);
    });
