// The Menu app (spec 0065, H1, AC-6520 to AC-6533): menus, their sections, items placed in sections, sizes, shared
// option groups, a draft saved as you go and Publish (one snapshot per place), Sold out live over the snapshot, and the
// guest menu's public answer. Every procedure is inside a workspace, behind the member door: `hospitality.manage`
// edits and publishes, Sold out also takes `hospitality.service`; each refuses `APP_NOT_INSTALLED` while Menu isn't
// installed. The closed lists and pure rules are in `menu-model.ts`, shared with the guest page without Zod.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { WEEK_DAYS } from './hospitality-model.ts';
import { PlaceHours, TimeOfDay } from './hospitality.ts';
import { ALLERGEN_LEVELS, DIET_MARKS, EU_ALLERGENS, MENU_LIMITS, OPTION_RULES, SECTION_LAYOUTS } from './menu-model.ts';
import { Timestamp } from './values/attribute-values.ts';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

export * from './menu-model.ts';

const M = MENU_LIMITS;

const Text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${String(max)} characters or fewer.`);
const Name = (max: number, missing: string) => Text(max).min(1, missing);

/** A price in minor units of the workspace currency (AC-6532): a whole number, never a float. */
export const PriceMinor = z
  .number()
  .int('Use a price such as 9.50.')
  .min(0, 'A price can’t be below zero.')
  .max(M.priceMax, 'That price is too large.');
/** A price in minor units. */
export type PriceMinor = z.infer<typeof PriceMinor>;

/** A price difference in minor units (an option may take some off). */
export const PriceDeltaMinor = z.number().int().min(-M.priceMax).max(M.priceMax);
/** A price difference in minor units. */
export type PriceDeltaMinor = z.infer<typeof PriceDeltaMinor>;

/** A serving time (AC-6520): the days, and one range of hours that may cross midnight. */
export const MenuServing = z
  .strictObject({
    days: z
      .array(z.enum(WEEK_DAYS))
      .min(1, 'Pick at least one day.')
      .max(7)
      .refine((days) => new Set(days).size === days.length, { error: 'Pick each day once.' }),
    from: TimeOfDay,
    to: TimeOfDay,
  })
  .refine((serving) => serving.from !== serving.to, { error: 'Give the serving time a start and a different end.' });
/** A serving time. */
export type MenuServing = z.infer<typeof MenuServing>;

/** A dietary mark. */
export const DietMarkName = z.enum(DIET_MARKS);
/** One allergen as an item holds it. */
export const ItemAllergen = z.strictObject({ code: z.enum(EU_ALLERGENS), level: z.enum(ALLERGEN_LEVELS) });
/** One allergen as an item holds it. */
export type ItemAllergen = z.infer<typeof ItemAllergen>;

/** A photo as the editor and the guest page name it: its id and the version its paths carry. */
export const MenuPhotoRef = z.object({ id: Uuid, version: z.string().regex(/^[0-9a-f]{12}$/) });
/** A photo reference. */
export type MenuPhotoRef = z.infer<typeof MenuPhotoRef>;

/** One size of an item (AC-6523): a name and its own price. */
export const ItemSize = z.object({ id: Uuid, name: z.string(), priceMinor: PriceMinor });
/** One size of an item. */
export type ItemSize = z.infer<typeof ItemSize>;

/** One option of a group: a name and a price difference. */
export const MenuOption = z.object({ id: Uuid, name: z.string(), priceDeltaMinor: PriceDeltaMinor });
/** One option of a group. */
export type MenuOption = z.infer<typeof MenuOption>;

/** An option group, shared between items (AC-6523): choose one, up to `max`, or any. */
export const OptionGroup = z.object({
  id: Uuid,
  name: z.string(),
  rule: z.enum(OPTION_RULES),
  /** The fewest a guest must pick: 1 or more makes the group required (from checklabs). */
  min: z.number().int().optional(),
  max: z.number().int().optional(),
  options: z.array(MenuOption),
});
/** An option group. */
export type OptionGroup = z.infer<typeof OptionGroup>;

/** An item as the editor holds it (AC-6522): one thing, placed in any number of sections (AC-6524). */
export const MenuItem = z.object({
  id: Uuid,
  name: z.string(),
  description: z.string().optional(),
  priceMinor: PriceMinor.optional(),
  priceNote: z.string().optional(),
  photo: MenuPhotoRef.optional(),
  diet: z.array(DietMarkName),
  allergens: z.array(ItemAllergen),
  kcal: z.number().int().optional(),
  featured: z.boolean(),
  soldOut: z.boolean(),
  sizes: z.array(ItemSize),
  groupIds: z.array(Uuid),
});
/** An item as the editor holds it. */
export type MenuItem = z.infer<typeof MenuItem>;

/** A section as the editor holds it (AC-6521): a top level one, or one level under another. */
export const MenuSection = z.object({
  id: Uuid,
  menuId: Uuid,
  parentId: Uuid.optional(),
  name: z.string(),
  description: z.string().optional(),
  layout: z.enum(SECTION_LAYOUTS),
  serving: MenuServing.optional(),
  position: z.number().int(),
  /** The items placed here, in order. */
  itemIds: z.array(Uuid),
});
/** A section as the editor holds it. */
export type MenuSection = z.infer<typeof MenuSection>;

/** A menu as the editor holds it (AC-6520). */
export const Menu = z.object({
  id: Uuid,
  name: z.string(),
  note: z.string().optional(),
  serving: MenuServing.optional(),
  placeIds: z.array(Uuid),
  position: z.number().int(),
});
/** A menu as the editor holds it. */
export type Menu = z.infer<typeof Menu>;

/** A place as the Menus screen names it: where a menu shows, and its guest address. */
export const MenuPlace = z.object({
  id: Uuid,
  name: z.string(),
  menuKey: z.string(),
  timeZone: z.string(),
  locale: z.string(),
});
/** A place as the Menus screen names it. */
export type MenuPlace = z.infer<typeof MenuPlace>;

/**
 * The Menus screen's whole draft (AC-6525): every menu, section, item and option group, the places, and how many
 * changes wait for Publish. Every write answers it whole, so the screen's copy is the server's.
 */
export const MenuDraft = z.object({
  currency: z.string(),
  places: z.array(MenuPlace),
  menus: z.array(Menu),
  sections: z.array(MenuSection),
  items: z.array(MenuItem),
  groups: z.array(OptionGroup),
  changes: z.number().int().nonnegative(),
  publishedAt: Timestamp.optional(),
  photos: z.number().int().nonnegative(),
  /** Whether this reader edits and publishes (`hospitality.manage`); otherwise they only flip Sold out. */
  canEdit: z.boolean(),
});
/** The Menus screen's whole draft. */
export type MenuDraft = z.infer<typeof MenuDraft>;

const Write = { mutationId: Uuid };

/** Adds or changes a menu (`id` is the client's own, so a retry makes one). */
export const SaveMenuInput = WorkspaceScoped.extend({
  id: Uuid,
  name: Name(M.menuNameMax, 'Name the menu, such as Dinner.'),
  note: Text(M.menuNoteMax).optional(),
  placeIds: z.array(Uuid).max(20),
  /** Null clears it. */
  serving: MenuServing.nullable().optional(),
  ...Write,
});
/** Adds or changes a menu. */
export type SaveMenuInput = z.infer<typeof SaveMenuInput>;

/** Names one menu. */
export const MenuIdInput = WorkspaceScoped.extend({ menuId: Uuid, ...Write });
/** Names one menu. */
export type MenuIdInput = z.infer<typeof MenuIdInput>;

/** Adds or changes a section (AC-6521). A sub section names its parent, which must be a top level one. */
export const SaveSectionInput = WorkspaceScoped.extend({
  id: Uuid,
  menuId: Uuid,
  parentId: Uuid.optional(),
  name: Name(M.sectionNameMax, 'Name the section, such as Starters.'),
  description: Text(M.sectionDescriptionMax).optional(),
  layout: z.enum(SECTION_LAYOUTS).default('list'),
  serving: MenuServing.nullable().optional(),
  ...Write,
});
/** Adds or changes a section. */
export type SaveSectionInput = z.infer<typeof SaveSectionInput>;

/** Names one section. */
export const SectionIdInput = WorkspaceScoped.extend({ sectionId: Uuid, ...Write });
/** Names one section. */
export type SectionIdInput = z.infer<typeof SectionIdInput>;

/** One size as saved: an id to keep it, else a new one. */
export const ItemSizeFields = z.object({
  id: Uuid.optional(),
  name: Name(M.sizeNameMax, 'Name the size, such as Glass.'),
  priceMinor: PriceMinor,
});

/** An item's fields as saved, whole (AC-6522, AC-6523). */
export const ItemFields = z
  .object({
    name: Name(M.itemNameMax, 'Name the dish.'),
    description: Text(M.itemDescriptionMax).optional(),
    priceMinor: PriceMinor.nullable(),
    priceNote: Text(M.priceNoteMax).optional(),
    diet: z
      .array(DietMarkName)
      .max(DIET_MARKS.length)
      .refine((marks) => new Set(marks).size === marks.length, { error: 'Pick each mark once.' })
      .refine((marks) => marks.filter((mark) => mark.startsWith('spicy_')).length <= 1, {
        error: 'Pick one spice level.',
      }),
    allergens: z
      .array(ItemAllergen)
      .max(EU_ALLERGENS.length)
      .refine((list) => new Set(list.map((each) => each.code)).size === list.length, {
        error: 'Mark each allergen once.',
      }),
    kcal: z.number().int().min(0).max(M.kcalMax).nullable(),
    featured: z.boolean(),
    sizes: z.array(ItemSizeFields).max(M.sizesPerItem, `An item takes up to ${String(M.sizesPerItem)} sizes.`),
    groupIds: z
      .array(Uuid)
      .max(M.groupsPerItem, `An item takes up to ${String(M.groupsPerItem)} option groups.`)
      .refine((ids) => new Set(ids).size === ids.length, { error: 'Add each group once.' }),
  })
  .refine((item) => !(item.sizes.length > 0 && item.priceMinor !== null), {
    error: 'An item with sizes prices each size instead.',
    path: ['priceMinor'],
  });
/** An item's fields as saved. */
export type ItemFields = z.infer<typeof ItemFields>;

/** Adds or changes an item; a new one is placed at the end of `sectionId`. */
export const SaveItemInput = WorkspaceScoped.extend({
  id: Uuid,
  sectionId: Uuid.optional(),
  item: ItemFields,
  ...Write,
});
/** Adds or changes an item. */
export type SaveItemInput = z.infer<typeof SaveItemInput>;

/** Names one item. */
export const ItemIdInput = WorkspaceScoped.extend({ itemId: Uuid, ...Write });
/** Names one item. */
export type ItemIdInput = z.infer<typeof ItemIdInput>;

/** Places an item in a section, or takes it out (AC-6524). An item left in no section stays in the library. */
export const PlaceItemInput = WorkspaceScoped.extend({
  itemId: Uuid,
  sectionId: Uuid,
  placed: z.boolean(),
  ...Write,
});
/** Places an item in a section, or takes it out. */
export type PlaceItemInput = z.infer<typeof PlaceItemInput>;

/** Moves a menu, a section among its siblings, or an item within its section, to `toIndex`. */
export const MoveMenuPartInput = WorkspaceScoped.extend({
  part: z.enum(['menu', 'section', 'placement']),
  id: Uuid,
  /** The section a placement moves in. */
  sectionId: Uuid.optional(),
  toIndex: z.number().int().min(0).max(10_000),
  ...Write,
});
/** Moves a menu, a section or an item. */
export type MoveMenuPartInput = z.infer<typeof MoveMenuPartInput>;

/** One option as saved. */
export const MenuOptionFields = z.object({
  id: Uuid.optional(),
  name: Name(M.optionNameMax, 'Name the option, such as Oat milk.'),
  priceDeltaMinor: PriceDeltaMinor,
});

/** Adds or changes an option group, whole (AC-6523). */
export const SaveGroupInput = WorkspaceScoped.extend({
  id: Uuid,
  name: Name(M.groupNameMax, 'Name the group, such as Milk.'),
  rule: z.enum(OPTION_RULES),
  min: z.number().int().min(0).max(M.optionsPerGroup).default(0),
  max: z.number().int().min(1).max(M.optionsPerGroup).optional(),
  options: z
    .array(MenuOptionFields)
    .min(1, 'Add at least one option.')
    .max(M.optionsPerGroup, `A group takes up to ${String(M.optionsPerGroup)} options.`),
  ...Write,
})
  .refine((group) => group.rule !== 'up_to' || group.max !== undefined, {
    error: 'Say how many a guest may pick.',
    path: ['max'],
  })
  .refine(
    (group) =>
      group.min <= (group.rule === 'one' ? 1 : group.rule === 'up_to' ? (group.max ?? 1) : group.options.length),
    { error: 'A guest can’t be asked to pick more than they may, or than there are.', path: ['min'] },
  );
/** Adds or changes an option group. */
export type SaveGroupInput = z.infer<typeof SaveGroupInput>;

/** Names one option group. */
export const GroupIdInput = WorkspaceScoped.extend({ groupId: Uuid, ...Write });
/** Names one option group. */
export type GroupIdInput = z.infer<typeof GroupIdInput>;

/** Sold out on or off (AC-6526): live at once, no Publish. */
export const SoldOutInput = WorkspaceScoped.extend({ itemId: Uuid, soldOut: z.boolean(), ...Write });
/** Sold out on or off. */
export type SoldOutInput = z.infer<typeof SoldOutInput>;

/** Publish or Discard (AC-6525). */
export const MenuDraftWrite = WorkspaceScoped.extend(Write);
/** Publish or Discard. */
export type MenuDraftWrite = z.infer<typeof MenuDraftWrite>;

// --- The published snapshot and the guest page's answer (AC-6525, AC-6528, AC-6531) ---

/** An item as guests see it: what the snapshot froze at Publish. */
export const SnapshotItem = z.object({
  id: Uuid,
  name: z.string(),
  description: z.string().optional(),
  priceMinor: z.number().int().optional(),
  priceNote: z.string().optional(),
  photo: MenuPhotoRef.optional(),
  diet: z.array(DietMarkName),
  allergens: z.array(ItemAllergen),
  kcal: z.number().int().optional(),
  featured: z.boolean(),
  sizes: z.array(z.object({ name: z.string(), priceMinor: z.number().int() })),
  groupIds: z.array(Uuid),
});
/** An item as guests see it. */
export type SnapshotItem = z.infer<typeof SnapshotItem>;

/** A sub section as guests see it. */
export const SnapshotSubsection = z.object({
  id: Uuid,
  name: z.string(),
  description: z.string().optional(),
  layout: z.enum(SECTION_LAYOUTS),
  serving: MenuServing.optional(),
  itemIds: z.array(Uuid),
});
/** A sub section as guests see it. */
export type SnapshotSubsection = z.infer<typeof SnapshotSubsection>;

/** A section as guests see it, with its sub sections. */
export const SnapshotSection = SnapshotSubsection.extend({ sections: z.array(SnapshotSubsection) });
/** A section as guests see it. */
export type SnapshotSection = z.infer<typeof SnapshotSection>;

/** A menu as guests see it. */
export const SnapshotMenu = z.object({
  id: Uuid,
  name: z.string(),
  note: z.string().optional(),
  serving: MenuServing.optional(),
  sections: z.array(SnapshotSection),
});
/** A menu as guests see it. */
export type SnapshotMenu = z.infer<typeof SnapshotMenu>;

/**
 * One place's published menus (the spec's `MenuSnapshot`): its menus in order, every item placed in them once (an
 * item in two sections is one entry), the option groups they use, and the currency they price in.
 */
export const MenuSnapshot = z.object({
  currency: z.string(),
  menus: z.array(SnapshotMenu),
  items: z.record(z.string(), SnapshotItem),
  groups: z.record(z.string(), OptionGroup),
});
/** One place's published menus. */
export type MenuSnapshot = z.infer<typeof MenuSnapshot>;

/** The business and place a guest menu's header shows (AC-6529). */
export const PublicMenuPlace = z.object({
  name: z.string(),
  addressLine: z.string().optional(),
  city: z.string().optional(),
  postcode: z.string().optional(),
  phone: z.string().optional(),
  timeZone: z.string(),
  locale: z.string(),
  hours: PlaceHours,
});
/** The place a guest menu's header shows. */
export type PublicMenuPlace = z.infer<typeof PublicMenuPlace>;

/**
 * `GET /api/public/menu/:key` (AC-6528, AC-6531): the place's latest snapshot (never the draft), the items sold out
 * now, and the header. No member, guest or draft data, and nothing of another place.
 */
export const PublicMenu = z.object({
  /** The place and workspace it is, so the HTML shell files its answer under the same cache tags. */
  placeId: Uuid,
  workspaceId: Uuid,
  version: z.number().int(),
  business: z.object({
    name: z.string(),
    description: z.string().optional(),
    website: z.string().optional(),
  }),
  place: PublicMenuPlace,
  /** The versions the look and the logo are served at, when there are any. */
  look: z.string().optional(),
  logo: z.string().optional(),
  menu: MenuSnapshot,
  soldOut: z.array(Uuid),
});
/** The guest menu's answer. */
export type PublicMenu = z.infer<typeof PublicMenu>;

/** The Menu app's procedures (AC-6520 to AC-6527). */
export const menuContract = {
  draft: oc.input(WorkspaceScoped).output(MenuDraft),
  saveMenu: oc.input(SaveMenuInput).output(MenuDraft),
  deleteMenu: oc.input(MenuIdInput).output(MenuDraft),
  saveSection: oc.input(SaveSectionInput).output(MenuDraft),
  deleteSection: oc.input(SectionIdInput).output(MenuDraft),
  saveItem: oc.input(SaveItemInput).output(MenuDraft),
  deleteItem: oc.input(ItemIdInput).output(MenuDraft),
  removePhoto: oc.input(ItemIdInput).output(MenuDraft),
  placeItem: oc.input(PlaceItemInput).output(MenuDraft),
  move: oc.input(MoveMenuPartInput).output(MenuDraft),
  saveGroup: oc.input(SaveGroupInput).output(MenuDraft),
  deleteGroup: oc.input(GroupIdInput).output(MenuDraft),
  setSoldOut: oc.input(SoldOutInput).output(MenuDraft),
  publish: oc.input(MenuDraftWrite).output(MenuDraft),
  discard: oc.input(MenuDraftWrite).output(MenuDraft),
};
