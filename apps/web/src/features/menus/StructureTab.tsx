// Brief
// Purpose: one menu's Structure (after checklabs' Structure tab): its sections in order, each folding by its chevron
// with Edit at hand, "N sub-sections · N items", its sub sections and its items in order (price, sizes and allergens
// under each name), every one moved by its grip or the keyboard, narrowed by the tab bar's search.
// Main task: put items in sections and order them as the menu reads.
// Leaves out: an item's own fields (the item drawer), the menu's settings (Settings) and Sold out across menus (Items).
import type { MenuDraft, MenuItem as Dish, MenuSection, MenuStore } from '@crm/data';
import { formatPrice } from '@crm/data/menu';
import {
  Avatar,
  Button,
  EmptyState,
  Field,
  Icon,
  LinkList,
  LinkListRowOrder,
  Menu,
  MenuItem,
  MenuTrigger,
  SectionList,
  SegmentedControl,
  Skeleton,
  SuggestionList,
  suggestionOptionId,
  type LinkRow,
  type Toasts,
} from '@crm/ui';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Open } from './MenusScreen.tsx';
import { draftPhotoHref } from './photo.ts';
import { strings } from './strings.ts';

type Said = (refused: { readonly message: string } | undefined) => void;

/** A section's own fields, as a save sends them back. */
export const sectionInput = (section: MenuSection) => ({
  id: section.id,
  menuId: section.menuId,
  ...(section.parentId === undefined ? {} : { parentId: section.parentId }),
  name: section.name,
  ...(section.description === undefined ? {} : { description: section.description }),
  layout: section.layout,
});

/** A dish's price as the editor's rows say it: its price, its sizes, its price note, or that it has none. */
export function priceLine(item: Dish, currency: string, locale: string): string {
  if (item.priceMinor !== undefined) return formatPrice(item.priceMinor, currency, locale);
  if (item.sizes.length > 0) {
    return item.sizes.map((size) => `${size.name} ${formatPrice(size.priceMinor, currency, locale)}`).join(' · ');
  }
  return item.priceNote ?? strings.noPrice;
}

/** The tile a dish row's photo stands in while the list loads: every dish row has a leading photo or letter. */
export const dishLeadingLoading = <Skeleton shape="circle" size="sm" />;

/**
 * Sold out on or off from a dish's row (AC-6526): live for guests at once, so the toast says so, with Undo (UX review
 * should-fix 9).
 */
export function flipSoldOut(
  store: MenuStore,
  slug: string,
  item: Dish,
  soldOut: boolean,
  toasts: Toasts,
  said: Said,
): void {
  void store.setSoldOut(slug, item.id, soldOut).then((refused) => {
    if (refused !== undefined) {
      said(refused);
      return;
    }
    toasts.toast({
      tone: 'success',
      message: soldOut ? strings.soldOutToast(item.name) : strings.backOnToast(item.name),
      action: {
        label: strings.undo,
        onAction: () => void store.setSoldOut(slug, item.id, !soldOut).then(said),
      },
    });
  });
}

/** Whether a dish has no price, sizes or price note (Publish refuses it while it is on a menu). */
export const isUnpriced = (item: Dish): boolean =>
  item.priceMinor === undefined && item.priceNote === undefined && item.sizes.length === 0;

/**
 * What the tab bar's search keeps of a menu (checklabs'): a section whose name matches whole, else its sub sections
 * whose names match whole, else its items whose names match; `undefined` keeps everything.
 */
export function searchStructure(
  draft: MenuDraft,
  sections: readonly MenuSection[],
  query: string,
): ReadonlyMap<string, readonly string[] | 'all'> | undefined {
  const typed = query.trim().toLowerCase();
  if (typed === '') return undefined;
  const names = new Map(draft.items.map((item) => [item.id, item.name.toLowerCase()]));
  const kept = new Map<string, readonly string[] | 'all'>();
  const itemsOf = (section: MenuSection) => section.itemIds.filter((id) => (names.get(id) ?? '').includes(typed));
  for (const top of sections.filter((each) => each.parentId === undefined)) {
    const subs = sections.filter((each) => each.parentId === top.id);
    if (top.name.toLowerCase().includes(typed)) {
      kept.set(top.id, 'all');
      for (const sub of subs) kept.set(sub.id, 'all');
      continue;
    }
    for (const sub of subs) {
      const found = sub.name.toLowerCase().includes(typed) ? 'all' : itemsOf(sub);
      if (found === 'all' || found.length > 0) kept.set(sub.id, found);
    }
    const own = itemsOf(top);
    if (own.length > 0 || subs.some((sub) => kept.has(sub.id))) kept.set(top.id, own);
  }
  return kept;
}

/** One menu's sections and their items. */
export function StructureTab({
  store,
  slug,
  draft,
  menuId,
  query,
  onOpen,
  said,
  toasts,
}: {
  readonly store: MenuStore;
  readonly slug: string;
  readonly draft: MenuDraft;
  readonly menuId: string;
  /** The tab bar's search: a section, sub section or item by name. */
  readonly query: string;
  readonly onOpen: (open: Open) => void;
  readonly said: Said;
  readonly toasts: Toasts;
}) {
  const sections = useMemo(
    () => draft.sections.filter((each) => each.menuId === menuId).sort((a, b) => a.position - b.position),
    [draft.sections, menuId],
  );
  // Folded sections, by id (UI state): every section starts open, as checklabs' editor opens them all.
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const kept = searchStructure(draft, sections, query);
  const all = sections.filter((each) => each.parentId === undefined);
  const top = kept === undefined ? all : all.filter((each) => kept.has(each.id));
  const subsOf = (section: MenuSection) =>
    sections.filter((each) => each.parentId === section.id && (kept === undefined || kept.has(each.id)));
  // A section's head, after checklabs' category card: its grip, its name, "N sub-sections · N items", then Edit, the
  // List or Grid switch, its ⋯ (Add sub section, Move, Delete) and its chevron. No numbers.
  const card = (section: MenuSection, index: number, siblings: readonly MenuSection[]) => {
    const subs = sections.filter((each) => each.parentId === section.id);
    const items = section.itemIds.length + subs.reduce((sum, sub) => sum + sub.itemIds.length, 0);
    return {
      id: section.id,
      title: section.name,
      description: strings.structureCount(subs.length, items),
      // While searching every match shows open; the chevron comes back with the whole menu.
      ...(kept === undefined
        ? {
            isExpanded: !folded.has(section.id),
            onExpandedChange: (isExpanded: boolean) =>
              setFolded((was) => {
                const next = new Set(was);
                if (isExpanded) next.delete(section.id);
                else next.add(section.id);
                return next;
              }),
          }
        : {}),
      actions: draft.canEdit ? (
        <SectionHead
          store={store}
          slug={slug}
          section={section}
          index={index}
          count={siblings.length}
          onOpen={onOpen}
          said={said}
        />
      ) : undefined,
      content: (
        <SectionBody
          store={store}
          slug={slug}
          draft={draft}
          section={section}
          subsections={subsOf(section)}
          kept={kept}
          onOpen={onOpen}
          said={said}
          toasts={toasts}
        />
      ),
    };
  };
  if (kept !== undefined && top.length === 0) {
    return (
      <EmptyState icon="search" title={strings.noSearchMatches}>
        {strings.noSearchLine(query.trim())}
      </EmptyState>
    );
  }
  return (
    <>
      <SectionList
        label={strings.sectionsLabel}
        sections={top.map((section, index) => card(section, index, top))}
        // Moving waits for the whole menu: a search shows only part of it.
        {...(draft.canEdit && kept === undefined
          ? { onMove: (id: string, toIndex: number) => void store.move(slug, 'section', id, toIndex).then(said) }
          : {})}
        emptyState={
          <EmptyState
            icon="list"
            title={strings.setUpMenu}
            actions={
              draft.canEdit ? (
                <Button variant="primary" icon="plus" onPress={() => onOpen({ kind: 'section', menuId })}>
                  {strings.newSection}
                </Button>
              ) : undefined
            }
          >
            {strings.setUpMenuLine}
          </EmptyState>
        }
      />
      {draft.canEdit && top.length > 0 && kept === undefined ? (
        <Button variant="dashed" icon="plus" isFullWidth onPress={() => onOpen({ kind: 'section', menuId })}>
          {strings.newSection}
        </Button>
      ) : null}
    </>
  );
}

/** A section's head actions: Edit at hand (checklabs' pencil), the List or Grid switch, then its ⋯. */
function SectionHead({
  store,
  slug,
  section,
  index,
  count,
  onOpen,
  said,
}: {
  readonly store: MenuStore;
  readonly slug: string;
  readonly section: MenuSection;
  readonly index: number;
  readonly count: number;
  readonly onOpen: (open: Open) => void;
  readonly said: Said;
}) {
  return (
    <>
      <Button
        variant="ghost"
        icon="pencil"
        label={strings.editNamed(section.name)}
        onPress={() => onOpen({ kind: 'section', menuId: section.menuId, sectionId: section.id })}
      />
      <LayoutSwitch store={store} slug={slug} section={section} said={said} />
      <SectionMenu
        section={section}
        index={index}
        count={count}
        onAction={(key) => {
          if (key === 'sub') onOpen({ kind: 'section', menuId: section.menuId, parentId: section.id });
          else if (key === 'up') void store.move(slug, 'section', section.id, index - 1).then(said);
          else if (key === 'down') void store.move(slug, 'section', section.id, index + 1).then(said);
          else if (key === 'delete') onOpen({ kind: 'deleteSection', sectionId: section.id, name: section.name });
        }}
      />
    </>
  );
}

/** A section's List or Grid, as icons in its head (checklabs' place for it). */
function LayoutSwitch({
  store,
  slug,
  section,
  said,
}: {
  readonly store: MenuStore;
  readonly slug: string;
  readonly section: MenuSection;
  readonly said: Said;
}) {
  return (
    <SegmentedControl
      label={strings.layoutLabel(section.name)}
      segments={[
        { value: 'list', label: strings.layoutList, icon: 'list', isIconOnly: true },
        { value: 'grid', label: strings.layoutGrid, icon: 'layout-grid', isIconOnly: true },
      ]}
      value={section.layout}
      onChange={(layout: string) =>
        void store
          .saveSection(slug, { ...sectionInput(section), layout: layout === 'grid' ? 'grid' : 'list' })
          .then(said)
      }
    />
  );
}

/** A section's menu: add a sub section, move (for a pointer that can't drag), delete; Edit sits beside it. */
function SectionMenu({
  section,
  index,
  count,
  onAction,
}: {
  readonly section: MenuSection;
  readonly index: number;
  readonly count: number;
  readonly onAction: (key: string) => void;
}) {
  return (
    <MenuTrigger>
      <Button variant="ghost" icon="ellipsis" label={strings.moreFor(section.name)} />
      <Menu label={strings.moreFor(section.name)} onAction={(key) => onAction(String(key))}>
        {section.parentId === undefined ? (
          <MenuItem id="sub" icon="plus">
            {strings.addSubsection}
          </MenuItem>
        ) : null}
        {index > 0 ? (
          <MenuItem id="up" icon="arrow-up">
            {strings.moveUp}
          </MenuItem>
        ) : null}
        {index < count - 1 ? (
          <MenuItem id="down" icon="arrow-down">
            {strings.moveDown}
          </MenuItem>
        ) : null}
        <MenuItem id="delete" icon="trash" isDanger>
          {strings.deleteSection}
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}

/**
 * An item row's second line (checklabs' price, allergen and size chips): its price (or each size's), its price note,
 * what it contains, and where else it sits.
 */
export function itemChips(item: Dish, currency: string, locale: string, alsoOn: readonly string[]): readonly string[] {
  return [
    ...(item.priceMinor === undefined ? [] : [formatPrice(item.priceMinor, currency, locale)]),
    ...item.sizes.map((size) => `${size.name} ${formatPrice(size.priceMinor, currency, locale)}`),
    ...(item.priceMinor === undefined && item.sizes.length === 0 ? [item.priceNote ?? strings.noPrice] : []),
    ...item.allergens.filter((each) => each.level === 'contains').map((each) => strings.allergens[each.code]),
    ...(alsoOn.length === 0 ? [] : [strings.alsoOn(alsoOn.join(', '))]),
  ];
}

/** A section's items in order, Add item, and its sub sections. */
function SectionBody({
  store,
  slug,
  draft,
  section,
  subsections,
  kept,
  onOpen,
  said,
  toasts,
}: {
  readonly store: MenuStore;
  readonly slug: string;
  readonly draft: MenuDraft;
  readonly section: MenuSection;
  readonly subsections: readonly MenuSection[];
  /** What the tab bar's search keeps (`searchStructure`), or undefined for everything. */
  readonly kept: ReadonlyMap<string, readonly string[] | 'all'> | undefined;
  readonly onOpen: (open: Open) => void;
  readonly said: Said;
  readonly toasts: Toasts;
}) {
  const items = new Map(draft.items.map((item) => [item.id, item]));
  const locale = draft.places[0]?.locale ?? 'en-GB';
  const only = kept?.get(section.id);
  const isSearching = kept !== undefined;
  const menuNames = (itemId: string) =>
    draft.sections
      .filter((each) => each.id !== section.id && each.itemIds.includes(itemId))
      .map((each) => draft.menus.find((menu) => menu.id === each.menuId)?.name)
      .filter((name, index, all): name is string => name !== undefined && all.indexOf(name) === index);
  const takeOut = (item: Dish) =>
    void store.placeItem(slug, item.id, section.id, false).then((refused) => {
      if (refused !== undefined) {
        said(refused);
        return;
      }
      toasts.toast({
        tone: 'info',
        message: strings.removed(item.name),
        action: {
          label: strings.undo,
          onAction: () => void store.placeItem(slug, item.id, section.id, true).then(said),
        },
      });
    });
  const placed = section.itemIds
    .filter((id) => only === undefined || only === 'all' || only.includes(id))
    .map((id) => items.get(id))
    .filter((item): item is Dish => item !== undefined);
  const rows = placed.map((item, index): LinkRow => ({
    id: item.id,
    title: item.name,
    // The price, sizes and allergens ride the second line as chips (checklabs'), not inline after the name.
    address: '',
    chips: itemChips(item, draft.currency, locale, menuNames(item.id)),
    // The item's photo; with none, a dashed + that opens its drawer at the photo picker (checklabs' empty slot), or
    // a quiet photo mark for someone who can't change it. Never a letter tile.
    leading:
      item.photo === undefined && draft.canEdit ? (
        // A whole control's size, so it and the row's grip beside it each keep a 24px target (WCAG 2.5.8).
        <Button
          variant="dashed"
          icon="plus"
          label={strings.addPhotoFor(item.name)}
          onPress={() => onOpen({ kind: 'item', item })}
        />
      ) : (
        <DishThumb slug={slug} item={item} />
      ),
    // Sold out at the row's end; No price is the second line's own first chip.
    ...(item.soldOut ? { badge: strings.soldOutBadge, isOff: true } : {}),
    ...(!draft.canEdit
      ? {
          // Run service can still mark a dish sold out from its row (AC-6526), and nothing else.
          actions: (
            <MenuTrigger>
              <Button variant="ghost" icon="ellipsis" label={strings.moreFor(item.name)} />
              <Menu
                label={strings.moreFor(item.name)}
                onAction={() => flipSoldOut(store, slug, item, !item.soldOut, toasts, said)}
              >
                <MenuItem id="sold" icon={item.soldOut ? 'circle-check' : 'circle-slash'}>
                  {item.soldOut ? strings.markAvailable : strings.markSoldOut}
                </MenuItem>
              </Menu>
            </MenuTrigger>
          ),
        }
      : {
          actions: (
            <MenuTrigger>
              <Button variant="ghost" icon="ellipsis" label={strings.moreFor(item.name)} />
              <Menu
                label={strings.moreFor(item.name)}
                onAction={(key) => {
                  if (key === 'edit') onOpen({ kind: 'item', item });
                  else if (key === 'sold') flipSoldOut(store, slug, item, !item.soldOut, toasts, said);
                  else if (key === 'up') void store.move(slug, 'placement', item.id, index - 1, section.id).then(said);
                  else if (key === 'down')
                    void store.move(slug, 'placement', item.id, index + 1, section.id).then(said);
                  else if (key === 'remove') takeOut(item);
                  else if (key === 'delete') onOpen({ kind: 'deleteItem', item });
                }}
              >
                <MenuItem id="edit" icon="pencil">
                  {strings.editDish}
                </MenuItem>
                <MenuItem id="sold" icon={item.soldOut ? 'circle-check' : 'circle-slash'}>
                  {item.soldOut ? strings.markAvailable : strings.markSoldOut}
                </MenuItem>
                {index > 0 ? (
                  <MenuItem id="up" icon="arrow-up">
                    {strings.moveUp}
                  </MenuItem>
                ) : null}
                {index < placed.length - 1 ? (
                  <MenuItem id="down" icon="arrow-down">
                    {strings.moveDown}
                  </MenuItem>
                ) : null}
                <MenuItem id="remove" icon="x">
                  {strings.removeFromSection}
                </MenuItem>
                <MenuItem id="delete" icon="trash" isDanger>
                  {strings.deleteDish}
                </MenuItem>
              </Menu>
            </MenuTrigger>
          ),
        }),
  }));
  return (
    <>
      <LinkList
        label={strings.dishesIn(section.name)}
        rows={rows}
        onOpen={(id) => {
          const item = items.get(id);
          if (item !== undefined) onOpen({ kind: 'item', item });
        }}
        searchLabel={strings.searchDishes}
        isToolbarHidden
        leadingLoading={dishLeadingLoading}
        // Moving waits for the whole section: a search shows only part of it.
        {...(draft.canEdit && !isSearching
          ? {
              rowOrder: LinkListRowOrder,
              onMove: (id: string, toIndex: number) =>
                void store.move(slug, 'placement', id, toIndex, section.id).then(said),
            }
          : {})}
        emptyState={<EmptyState title={strings.emptySection} layout="row" />}
      />
      {draft.canEdit && !isSearching ? (
        <AddDishes store={store} slug={slug} draft={draft} section={section} onOpen={onOpen} said={said} />
      ) : null}
      {subsections.length === 0 ? null : (
        <SectionList
          label={strings.subsectionsLabel(section.name)}
          sections={subsections.map((sub, index) => ({
            id: sub.id,
            title: sub.name,
            description: strings.itemCount(sub.itemIds.length),
            ...(draft.canEdit
              ? {
                  actions: (
                    <SectionHead
                      store={store}
                      slug={slug}
                      section={sub}
                      index={index}
                      count={subsections.length}
                      onOpen={onOpen}
                      said={said}
                    />
                  ),
                }
              : {}),
            content: (
              <SectionBody
                store={store}
                slug={slug}
                draft={draft}
                section={sub}
                subsections={[]}
                kept={kept}
                onOpen={onOpen}
                said={said}
                toasts={toasts}
              />
            ),
          }))}
          {...(draft.canEdit && !isSearching
            ? { onMove: (id: string, toIndex: number) => void store.move(slug, 'section', id, toIndex).then(said) }
            : {})}
        />
      )}
    </>
  );
}

/**
 * Add dishes (after checklabs' "Search existing products to add them"): type to find a dish already made, arrows and
 * Enter to place it, or Enter on a new name to make that dish here.
 */
function AddDishes({
  store,
  slug,
  draft,
  section,
  onOpen,
  said,
}: {
  readonly store: MenuStore;
  readonly slug: string;
  readonly draft: MenuDraft;
  readonly section: MenuSection;
  readonly onOpen: (open: Open) => void;
  readonly said: Said;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  // "+ Add item" under the block (checklabs'), turning into the search or create field in place.
  const [isAdding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const wasAdding = useRef(false);
  // The field takes focus as it replaces the button that opened it, and the button takes it back when the field goes.
  useEffect(() => {
    if (isAdding) anchor.current?.focus();
    else if (wasAdding.current) addButton.current?.focus();
    wasAdding.current = isAdding;
  }, [isAdding]);
  const anchor = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const listId = useId();
  const typed = query.trim();
  const matches =
    typed === ''
      ? []
      : draft.items
          .filter((item) => !section.itemIds.includes(item.id) && item.name.toLowerCase().includes(typed.toLowerCase()))
          .slice(0, 6);
  // The last row always makes a new dish of what was typed, unless a dish has exactly that name.
  const isExact = matches.some((item) => item.name.toLowerCase() === typed.toLowerCase());
  const choices = [
    ...matches.map((item) => ({ kind: 'place' as const, item })),
    ...(typed === '' || isExact ? [] : [{ kind: 'create' as const }]),
  ];
  const isOpen = typed !== '';
  const pick = (index: number) => {
    const choice = choices[index];
    setQuery('');
    setActive(-1);
    if (choice === undefined) return;
    if (choice.kind === 'place') void store.placeItem(slug, choice.item.id, section.id, true).then(said);
    else onOpen({ kind: 'item', sectionId: section.id, newName: typed });
  };
  const keyDown = (event: KeyboardEvent) => {
    if (!isOpen) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((was) => Math.min(choices.length - 1, was + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((was) => Math.max(0, was - 1));
    } else if (event.key === 'Escape') {
      setQuery('');
      setActive(-1);
    }
  };
  const keyDownClosing = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !isOpen) {
      setAdding(false);
      return;
    }
    keyDown(event);
  };
  // A bordered button, not a quiet one (checklabs' Add item is the section's own action), opening the search or create.
  if (!isAdding)
    return (
      <span>
        <Button ref={addButton} icon="plus" onPress={() => setAdding(true)}>
          {strings.addDishButton}
        </Button>
      </span>
    );
  return (
    <>
      <Field
        ref={anchor}
        label={strings.addDish}
        icon="search"
        placeholder={strings.addDishPlaceholder}
        autoComplete="off"
        value={query}
        onChange={(next) => {
          setQuery(next);
          setActive(next.trim() === '' ? -1 : 0);
        }}
        onKeyDown={keyDownClosing}
        onSubmit={() => pick(active === -1 ? 0 : active)}
        combobox={{
          listId,
          isExpanded: isOpen,
          ...(isOpen && active !== -1 ? { activeId: suggestionOptionId(listId, active) } : {}),
        }}
      />
      {isOpen ? (
        <SuggestionList
          anchorRef={anchor}
          id={listId}
          label={strings.addDish}
          rows={choices.map((choice) =>
            choice.kind === 'place'
              ? {
                  key: choice.item.id,
                  leading: <DishThumb slug={slug} item={choice.item} size="xs" />,
                  label: choice.item.name,
                  detail: priceLine(choice.item, draft.currency, draft.places[0]?.locale ?? 'en-GB'),
                }
              : {
                  key: 'create',
                  leading: <Icon name="plus" size="sm" />,
                  label: strings.createDish(typed),
                },
          )}
          activeIndex={active}
          emptyText={strings.noMatches}
          onPick={pick}
          onHighlight={setActive}
        />
      ) : null}
    </>
  );
}

/** A dish row's leading tile: its photo, or a quiet photo mark in its place. */
export function DishThumb({
  slug,
  item,
  size = 'sm',
}: {
  readonly slug: string;
  readonly item: Dish;
  readonly size?: 'xs' | 'sm';
}) {
  return (
    <Avatar
      name={item.name}
      id={item.id}
      size={size}
      shape="square"
      hue="gray"
      isDecorative
      mark={<Icon name="image" size="xs" />}
      {...(item.photo === undefined ? {} : { src: draftPhotoHref(slug, item.photo.id, 'small', item.photo.version) })}
    />
  );
}
