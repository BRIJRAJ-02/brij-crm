// The Menu app's editor (spec 0065, H1): one held copy of a workspace's whole menu draft (`MenuDraft`), loaded on
// first use (`data.menu.load()`), never in the first load. Every edit shows at once on the copy, goes out in order,
// and the server's answer (the whole draft) replaces it; refused, the copy goes back and the refusal comes back to the
// screen. Publish, Discard and Sold out wait for nothing either: Sold out flips at once (it is live for guests, AC-6526),
// Publish shows "0 changes" when the server answers. Only managers edit, one at a time, so no change event carries
// the draft: another tab sees a change when it holds the draft again. Each business has its own draft (spec 0065 H7):
// the store holds one copy per workspace and business, and every call names the business chosen on this device.
import type {
  ItemFields,
  MenuDraft,
  MenuItem,
  MenuLook,
  MenuLookCover,
  MenuServing,
  SectionLayout,
} from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import { holder, type HospitalityHeld } from '../hospitality/store.ts';

type Options = { signal?: AbortSignal };
/** Which business a call works in (spec 0065 H7): left out, the workspace's first. */
type InProperty = { property?: string };
type Scoped = { workspace: string; mutationId: string } & InProperty;

/** The menu procedures the store calls, as the data layer's client answers them. */
export interface MenuProcedures {
  readonly draft: (input: { workspace: string } & InProperty, options: Options) => Promise<MenuDraft>;
  readonly saveMenu: (
    input: Scoped & {
      id: string;
      name: string;
      note?: string;
      placeIds: string[];
      serving?: MenuServing | null;
      taxRate?: number;
      serviceRate?: number;
    },
    options: Options,
  ) => Promise<MenuDraft>;
  readonly deleteMenu: (input: Scoped & { menuId: string }, options: Options) => Promise<MenuDraft>;
  readonly saveSection: (
    input: Scoped & {
      id: string;
      menuId: string;
      parentId?: string;
      name: string;
      description?: string;
      layout: SectionLayout;
      serving?: MenuServing | null;
    },
    options: Options,
  ) => Promise<MenuDraft>;
  readonly deleteSection: (input: Scoped & { sectionId: string }, options: Options) => Promise<MenuDraft>;
  readonly saveItem: (
    input: Scoped & { id: string; sectionId?: string; item: ItemFields },
    options: Options,
  ) => Promise<MenuDraft>;
  readonly deleteItem: (input: Scoped & { itemId: string }, options: Options) => Promise<MenuDraft>;
  readonly removePhoto: (input: Scoped & { itemId: string }, options: Options) => Promise<MenuDraft>;
  readonly placeItem: (
    input: Scoped & { itemId: string; sectionId: string; placed: boolean },
    options: Options,
  ) => Promise<MenuDraft>;
  readonly move: (
    input: Scoped & { part: 'menu' | 'section' | 'placement'; id: string; sectionId?: string; toIndex: number },
    options: Options,
  ) => Promise<MenuDraft>;
  readonly saveGroup: (
    input: Scoped & {
      id: string;
      name: string;
      rule: 'one' | 'up_to' | 'any';
      min?: number;
      max?: number;
      options: { id?: string; name: string; priceDeltaMinor: number }[];
    },
    options: Options,
  ) => Promise<MenuDraft>;
  readonly deleteGroup: (input: Scoped & { groupId: string }, options: Options) => Promise<MenuDraft>;
  readonly setSoldOut: (input: Scoped & { itemId: string; soldOut: boolean }, options: Options) => Promise<MenuDraft>;
  readonly setHidden: (input: Scoped & { hidden: boolean }, options: Options) => Promise<MenuDraft>;
  readonly saveLook: (input: Scoped & { look: MenuLook }, options: Options) => Promise<MenuDraft>;
  readonly publish: (input: Scoped, options: Options) => Promise<MenuDraft>;
  readonly discard: (input: Scoped, options: Options) => Promise<MenuDraft>;
  readonly duplicate: (
    input: Scoped & { menuId: string; to: string; id: string },
    options: Options,
  ) => Promise<MenuDraft>;
}

/** A photo drawn again by the screen at both widths (AC-6527). */
export interface MenuPhotoBlobs {
  readonly large: Blob;
  readonly small: Blob;
}

/**
 * Sends a photo to the api's own upload route for the business named (none is the first), answering its draft or
 * rejecting with a DataError.
 */
export type SendMenuPhoto = (
  workspace: string,
  property: string | undefined,
  itemId: string,
  photo: MenuPhotoBlobs,
) => Promise<MenuDraft>;

/**
 * Sends a cover to the api's own upload route for the business named (none is the first), answering what the look
 * will name, or rejecting with a DataError.
 */
export type SendMenuCover = (
  workspace: string,
  property: string | undefined,
  photo: MenuPhotoBlobs,
) => Promise<MenuLookCover>;

/** One more change counted on the copy, as the server will count it. */
const counted = (draft: MenuDraft): MenuDraft => ({ ...draft, changes: draft.changes + 1 });

/** `list` with `id` moved to `toIndex`. */
function moved<Value>(list: readonly Value[], idOf: (value: Value) => string, id: string, toIndex: number): Value[] {
  const moving = list.find((value) => idOf(value) === id);
  if (moving === undefined) return [...list];
  const rest = list.filter((value) => idOf(value) !== id);
  rest.splice(Math.min(Math.max(toIndex, 0), rest.length), 0, moving);
  return rest;
}

/** The store, made once by the data layer the first time a screen asks (`data.menu.load()`). */
export function openMenus(given: {
  readonly api: MenuProcedures;
  readonly call: <T>(run: (options: Options) => Promise<T>) => Promise<T>;
  readonly mintId: () => string;
  readonly sendPhoto: SendMenuPhoto;
  readonly sendCover: SendMenuCover;
  readonly now?: () => number;
  /**
   * The business each workspace works in on this device (spec 0065 H7, AC-6517: the hospitality store's choice);
   * undefined is the first, which no call names. Left out, every call works in the first.
   */
  readonly propertyOf?: (workspace: string) => string | undefined;
}) {
  const { api, call, mintId } = given;
  const now = given.now ?? Date.now;
  const drafts = new Map<string, ReturnType<typeof holder<MenuDraft>>>();
  /**
   * The store's calls, each in the business `propertyOf` names. The store itself follows the device's choice; a screen
   * holds `at(property)`, bound to the business it shows, so a press made while a switch is on its way still lands on
   * the business on screen (spec 0065 H7).
   */
  const bind = (propertyOf: (workspace: string) => string | undefined) => {
    /** The business's draft: one held copy per workspace and business, so a switch shows the other's at once. */
    const draftOf = (workspace: string, property = propertyOf(workspace)) => {
      const key = `${workspace}:${property ?? ''}`;
      let found = drafts.get(key);
      if (found === undefined) {
        const at: InProperty = property === undefined ? {} : { property };
        found = holder(() => call((options) => api.draft({ workspace, ...at }, options)), now);
        drafts.set(key, found);
      }
      return found;
    };
    /** One edit to the business chosen now: shown at once by `show`, then the server's whole draft. */
    const edit = (
      workspace: string,
      show: (draft: MenuDraft) => MenuDraft,
      send: (mutationId: string, options: Options, at: InProperty) => Promise<MenuDraft>,
    ): Promise<DataError | undefined> => {
      const property = propertyOf(workspace);
      const at: InProperty = property === undefined ? {} : { property };
      return draftOf(workspace, property).change(show, () => call((options) => send(mintId(), options, at)));
    };

    return {
      /** A new id for a menu, section, item or group the screen makes, so a retry makes one. */
      newId: mintId,
      /** The business the draft is of now (spec 0065 H7): undefined is the first. */
      property: (workspace: string): string | undefined => propertyOf(workspace),
      /** The chosen business's whole draft (AC-6525), read when first held. */
      draft: (workspace: string): HospitalityHeld<MenuDraft> => draftOf(workspace).held,
      /** Reads the draft now (the route's loader); rejects with the refusal. */
      readDraft: (workspace: string): Promise<MenuDraft> => draftOf(workspace).read(),

      /** Adds a menu under `id`, or changes one (AC-6520). */
      saveMenu: (
        workspace: string,
        menu: {
          readonly id: string;
          readonly name: string;
          readonly note?: string;
          readonly placeIds: readonly string[];
          readonly serving?: MenuServing | null;
          /** Basis points (1250 is 12.5%); left out keeps what is there. */
          readonly taxRate?: number;
          readonly serviceRate?: number;
        },
      ): Promise<DataError | undefined> =>
        edit(
          workspace,
          (draft) => {
            const was = draft.menus.find((each) => each.id === menu.id);
            const {
              serving: _serving,
              note: _note,
              ...rest
            } = was ?? {
              position: draft.menus.length,
              taxRate: 0,
              serviceRate: 0,
            };
            const next = {
              ...rest,
              id: menu.id,
              name: menu.name,
              placeIds: [...menu.placeIds],
              ...(menu.taxRate === undefined ? {} : { taxRate: menu.taxRate }),
              ...(menu.serviceRate === undefined ? {} : { serviceRate: menu.serviceRate }),
              ...(menu.note === undefined || menu.note === '' ? {} : { note: menu.note }),
              ...(menu.serving === null
                ? {}
                : menu.serving === undefined
                  ? was?.serving === undefined
                    ? {}
                    : { serving: was.serving }
                  : { serving: menu.serving }),
            };
            return counted({
              ...draft,
              menus:
                was === undefined
                  ? [...draft.menus, next]
                  : draft.menus.map((each) => (each.id === menu.id ? next : each)),
            });
          },
          (mutationId, options, at) =>
            api.saveMenu(
              {
                workspace,
                ...at,
                id: menu.id,
                name: menu.name,
                placeIds: [...menu.placeIds],
                ...(menu.note === undefined ? {} : { note: menu.note }),
                ...(menu.serving === undefined ? {} : { serving: menu.serving }),
                ...(menu.taxRate === undefined ? {} : { taxRate: menu.taxRate }),
                ...(menu.serviceRate === undefined ? {} : { serviceRate: menu.serviceRate }),
                mutationId,
              },
              options,
            ),
        ),
      /** Deletes a menu with its sections (the screen asks first); its items stay. */
      deleteMenu: (workspace: string, menuId: string): Promise<DataError | undefined> =>
        edit(
          workspace,
          (draft) =>
            counted({
              ...draft,
              menus: draft.menus.filter((each) => each.id !== menuId),
              sections: draft.sections.filter((each) => each.menuId !== menuId),
            }),
          (mutationId, options, at) => api.deleteMenu({ workspace, ...at, menuId, mutationId }, options),
        ),
      /** Adds a section under `id`, or changes one (AC-6521). */
      saveSection: (
        workspace: string,
        section: {
          readonly id: string;
          readonly menuId: string;
          readonly parentId?: string;
          readonly name: string;
          readonly description?: string;
          readonly layout: SectionLayout;
          readonly serving?: MenuServing | null;
        },
      ): Promise<DataError | undefined> =>
        edit(
          workspace,
          (draft) => {
            const was = draft.sections.find((each) => each.id === section.id);
            const siblings = draft.sections.filter(
              (each) => each.menuId === section.menuId && each.parentId === section.parentId,
            ).length;
            const next = {
              id: section.id,
              menuId: section.menuId,
              ...(section.parentId === undefined ? {} : { parentId: section.parentId }),
              name: section.name,
              ...(section.description === undefined || section.description === ''
                ? {}
                : { description: section.description }),
              layout: section.layout,
              ...(section.serving === null || section.serving === undefined
                ? was?.serving === undefined || section.serving === null
                  ? {}
                  : { serving: was.serving }
                : { serving: section.serving }),
              position: was?.position ?? siblings,
              itemIds: was?.itemIds ?? [],
            };
            return counted({
              ...draft,
              sections:
                was === undefined
                  ? [...draft.sections, next]
                  : draft.sections.map((each) => (each.id === section.id ? next : each)),
            });
          },
          (mutationId, options, at) =>
            api.saveSection(
              {
                workspace,
                ...at,
                id: section.id,
                menuId: section.menuId,
                name: section.name,
                layout: section.layout,
                ...(section.parentId === undefined ? {} : { parentId: section.parentId }),
                ...(section.description === undefined ? {} : { description: section.description }),
                ...(section.serving === undefined ? {} : { serving: section.serving }),
                mutationId,
              },
              options,
            ),
        ),
      /** Deletes a section with its sub sections; their items stay. */
      deleteSection: (workspace: string, sectionId: string): Promise<DataError | undefined> =>
        edit(
          workspace,
          (draft) =>
            counted({
              ...draft,
              sections: draft.sections.filter((each) => each.id !== sectionId && each.parentId !== sectionId),
            }),
          (mutationId, options, at) => api.deleteSection({ workspace, ...at, sectionId, mutationId }, options),
        ),
      /** Adds an item under `id` (placed at the end of `sectionId`), or changes one, whole (AC-6522, AC-6523). */
      saveItem: (workspace: string, id: string, item: ItemFields, sectionId?: string): Promise<DataError | undefined> =>
        edit(
          workspace,
          (draft) => {
            const was = draft.items.find((each) => each.id === id);
            const next: MenuItem = {
              id,
              name: item.name,
              ...(item.description === undefined || item.description === '' ? {} : { description: item.description }),
              ...(item.priceMinor === null || item.sizes.length > 0 ? {} : { priceMinor: item.priceMinor }),
              ...(item.priceNote === undefined || item.priceNote === '' ? {} : { priceNote: item.priceNote }),
              ...(was?.photo === undefined ? {} : { photo: was.photo }),
              diet: [...item.diet],
              allergens: [...item.allergens],
              ...(item.kcal === null ? {} : { kcal: item.kcal }),
              featured: item.featured,
              soldOut: was?.soldOut ?? false,
              sizes: item.sizes.map((size, index) => ({
                id: size.id ?? was?.sizes[index]?.id ?? `pending-${String(index)}`,
                name: size.name,
                priceMinor: size.priceMinor,
              })),
              groupIds: [...item.groupIds],
            };
            return counted({
              ...draft,
              items:
                was === undefined ? [...draft.items, next] : draft.items.map((each) => (each.id === id ? next : each)),
              sections:
                was === undefined && sectionId !== undefined
                  ? draft.sections.map((each) =>
                      each.id === sectionId ? { ...each, itemIds: [...each.itemIds, id] } : each,
                    )
                  : draft.sections,
            });
          },
          (mutationId, options, at) =>
            api.saveItem(
              { workspace, ...at, id, item, ...(sectionId === undefined ? {} : { sectionId }), mutationId },
              options,
            ),
        ),
      /** Deletes an item from every section and menu (the screen asks first). */
      deleteItem: (workspace: string, itemId: string): Promise<DataError | undefined> =>
        edit(
          workspace,
          (draft) =>
            counted({
              ...draft,
              items: draft.items.filter((each) => each.id !== itemId),
              sections: draft.sections.map((each) =>
                each.itemIds.includes(itemId) ? { ...each, itemIds: each.itemIds.filter((id) => id !== itemId) } : each,
              ),
            }),
          (mutationId, options, at) => api.deleteItem({ workspace, ...at, itemId, mutationId }, options),
        ),
      /** Places an item in another section too (AC-6524), or takes it out of one. */
      placeItem: (
        workspace: string,
        itemId: string,
        sectionId: string,
        placed: boolean,
      ): Promise<DataError | undefined> =>
        edit(
          workspace,
          (draft) =>
            counted({
              ...draft,
              sections: draft.sections.map((each) => {
                if (each.id !== sectionId) return each;
                const without = each.itemIds.filter((id) => id !== itemId);
                return { ...each, itemIds: placed ? [...without, itemId] : without };
              }),
            }),
          (mutationId, options, at) =>
            api.placeItem({ workspace, ...at, itemId, sectionId, placed, mutationId }, options),
        ),
      /** Moves a menu, a section among its siblings, or an item within a section (drag to reorder). */
      move: (
        workspace: string,
        part: 'menu' | 'section' | 'placement',
        id: string,
        toIndex: number,
        sectionId?: string,
      ): Promise<DataError | undefined> =>
        edit(
          workspace,
          (draft) => {
            if (part === 'menu') {
              return counted({
                ...draft,
                menus: moved(draft.menus, (each) => each.id, id, toIndex).map((each, position) => ({
                  ...each,
                  position,
                })),
              });
            }
            if (part === 'placement') {
              return counted({
                ...draft,
                sections: draft.sections.map((each) =>
                  each.id === sectionId
                    ? { ...each, itemIds: moved(each.itemIds, (value) => value, id, toIndex) }
                    : each,
                ),
              });
            }
            const moving = draft.sections.find((each) => each.id === id);
            if (moving === undefined) return draft;
            const siblings = draft.sections
              .filter((each) => each.menuId === moving.menuId && each.parentId === moving.parentId)
              .sort((a, b) => a.position - b.position);
            const order = new Map(
              moved(siblings, (each) => each.id, id, toIndex).map((each, index) => [each.id, index]),
            );
            return counted({
              ...draft,
              sections: draft.sections.map((each) => {
                const position = order.get(each.id);
                return position === undefined ? each : { ...each, position };
              }),
            });
          },
          (mutationId, options, at) =>
            api.move(
              { workspace, ...at, part, id, toIndex, ...(sectionId === undefined ? {} : { sectionId }), mutationId },
              options,
            ),
        ),
      /** Adds an option group under `id`, or changes one, whole (AC-6523). */
      saveGroup: (
        workspace: string,
        group: {
          readonly id: string;
          readonly name: string;
          readonly rule: 'one' | 'up_to' | 'any';
          readonly min?: number;
          readonly max?: number;
          readonly options: readonly {
            readonly id?: string;
            readonly name: string;
            readonly priceDeltaMinor: number;
          }[];
        },
      ): Promise<DataError | undefined> =>
        edit(
          workspace,
          (draft) => {
            const next = {
              id: group.id,
              name: group.name,
              rule: group.rule,
              ...(group.min === undefined || group.min === 0 ? {} : { min: group.min }),
              ...(group.rule === 'up_to' && group.max !== undefined ? { max: group.max } : {}),
              options: group.options.map((option, index) => ({
                id: option.id ?? `pending-${String(index)}`,
                name: option.name,
                priceDeltaMinor: option.priceDeltaMinor,
              })),
            };
            const was = draft.groups.some((each) => each.id === group.id);
            return counted({
              ...draft,
              groups: was ? draft.groups.map((each) => (each.id === group.id ? next : each)) : [...draft.groups, next],
            });
          },
          (mutationId, options, at) =>
            api.saveGroup(
              {
                workspace,
                ...at,
                id: group.id,
                name: group.name,
                rule: group.rule,
                options: group.options.map((option) => ({ ...option })),
                ...(group.max === undefined ? {} : { max: group.max }),
                ...(group.min === undefined ? {} : { min: group.min }),
                mutationId,
              },
              options,
            ),
        ),
      /** Deletes an option group from every item that offers it. */
      deleteGroup: (workspace: string, groupId: string): Promise<DataError | undefined> =>
        edit(
          workspace,
          (draft) =>
            counted({
              ...draft,
              groups: draft.groups.filter((each) => each.id !== groupId),
              items: draft.items.map((each) =>
                each.groupIds.includes(groupId)
                  ? { ...each, groupIds: each.groupIds.filter((id) => id !== groupId) }
                  : each,
              ),
            }),
          (mutationId, options, at) => api.deleteGroup({ workspace, ...at, groupId, mutationId }, options),
        ),
      /** Sold out on or off (AC-6526): live for guests at once, never a draft change. */
      setSoldOut: (workspace: string, itemId: string, soldOut: boolean): Promise<DataError | undefined> =>
        edit(
          workspace,
          (draft) => ({
            ...draft,
            items: draft.items.map((each) => (each.id === itemId ? { ...each, soldOut } : each)),
          }),
          (mutationId, options, at) => api.setSoldOut({ workspace, ...at, itemId, soldOut, mutationId }, options),
        ),
      /** Live or Hidden: hides every guest menu for now, or shows it again. Never a draft change. */
      setHidden: (workspace: string, hidden: boolean): Promise<DataError | undefined> =>
        edit(
          workspace,
          (draft) => ({ ...draft, hidden }),
          (mutationId, options, at) => api.setHidden({ workspace, ...at, hidden, mutationId }, options),
        ),
      /** Publish (AC-6525): guests see the draft from now on. */
      publish: (workspace: string): Promise<DataError | undefined> =>
        edit(
          workspace,
          (draft) => draft,
          (mutationId, options, at) => api.publish({ workspace, ...at, mutationId }, options),
        ),
      /**
       * Duplicate to another business (spec 0065 H7, AC-6591): a copy of the menu in `to`'s draft, waiting for the
       * server; this business's draft is untouched. The other business's held copy reads again when next held.
       */
      duplicate: async (workspace: string, menuId: string, to: string): Promise<DataError | undefined> => {
        const property = propertyOf(workspace);
        try {
          await call((options) =>
            api.duplicate(
              {
                workspace,
                ...(property === undefined ? {} : { property }),
                menuId,
                to,
                id: mintId(),
                mutationId: mintId(),
              },
              options,
            ),
          );
        } catch (error) {
          return toDataError(error);
        }
        for (const key of [...drafts.keys()]) {
          if (key.startsWith(`${workspace}:`) && key !== `${workspace}:${property ?? ''}`) drafts.delete(key);
        }
        return undefined;
      },
      /** Discard (AC-6525): back to what guests see. */
      discard: (workspace: string): Promise<DataError | undefined> =>
        edit(
          workspace,
          (draft) => draft,
          (mutationId, options, at) => api.discard({ workspace, ...at, mutationId }, options),
        ),
      /**
       * Saves the guest look (AC-6570 as amended): shows at once on the copy, and the copy goes back if it's refused. No
       * change is counted: a look is live as it saves, with no Publish.
       */
      saveLook: (workspace: string, look: MenuLook): Promise<DataError | undefined> =>
        edit(
          workspace,
          (draft) => ({ ...draft, look }),
          (mutationId, options, at) => api.saveLook({ workspace, ...at, look, mutationId }, options),
        ),
      /** Keeps a new cover drawn at both widths, answering what the look will name; a refusal comes back as a DataError. */
      uploadCover: async (workspace: string, photo: MenuPhotoBlobs): Promise<MenuLookCover | DataError> => {
        try {
          return await given.sendCover(workspace, propertyOf(workspace), photo);
        } catch (error) {
          return toDataError(error);
        }
      },
      /** Gives an item a photo drawn at both widths (AC-6527); shows once the server kept it. */
      uploadPhoto: (workspace: string, itemId: string, photo: MenuPhotoBlobs): Promise<DataError | undefined> => {
        const property = propertyOf(workspace);
        return draftOf(workspace, property).change(
          (draft) => draft,
          async () => {
            try {
              return await given.sendPhoto(workspace, property, itemId, photo);
            } catch (error) {
              throw toDataError(error);
            }
          },
        );
      },
      /** Takes an item's photo off. */
      removePhoto: (workspace: string, itemId: string): Promise<DataError | undefined> =>
        edit(
          workspace,
          (draft) =>
            counted({
              ...draft,
              items: draft.items.map((each) => {
                if (each.id !== itemId) return each;
                const { photo: _photo, ...rest } = each;
                return rest;
              }),
            }),
          (mutationId, options, at) => api.removePhoto({ workspace, ...at, itemId, mutationId }, options),
        ),

      /** Signed out: forgets every copy. */
      clear: (): void => {
        drafts.clear();
      },
    };
  };
  const following = bind((workspace) => given.propertyOf?.(workspace));
  return {
    ...following,
    /** The same store bound to one business (undefined is the first), for the screen that shows it. */
    at: (property: string | undefined): typeof following => bind(() => property),
  };
}

/** The Menu store, as `data.menu.load()` answers it: it follows the device's choice of business, and `at` binds it. */
export type MenuStoreRoot = ReturnType<typeof openMenus>;

/** The Menu store a screen holds: bound to the business on screen (or following the choice, the root). */
export type MenuStore = ReturnType<MenuStoreRoot['at']>;
