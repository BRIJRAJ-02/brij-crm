// Brief
// Purpose: one menu's Structure (after checklabs' Structure tab): its sections in order, each folding by its title with
// "N sub sections · N items" beside it, its sub sections and its items in order (a photo you can recognise, the name
// with allergens quiet under it, the price on its own right edge, Sold out by the name), every one moved by its grip or
// the keyboard, narrowed by the tab bar's search. Grips and quick actions wait for the pointer or focus; ⋯ holds them all.
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
  Skeleton,
  SuggestionList,
  suggestionOptionId,
  Tooltip,
  type LinkRow,
  type Toasts,
} from '@crm/ui';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Open } from './MenusScreen.tsx';
import { useIsNarrow } from './narrow.ts';
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

/** An item's price in one short cell: its price, its sizes' range (£14.00–£26.00), its note, or No price. */
export function priceCell(item: Dish, currency: string, locale: string): string {
  if (item.priceMinor !== undefined) return formatPrice(item.priceMinor, currency, locale);
  const prices = item.sizes.map((size) => size.priceMinor);
  if (prices.length > 0) {
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    return low === high
      ? formatPrice(low, currency, locale)
      : strings.priceRange(formatPrice(low, currency, locale), formatPrice(high, currency, locale));
  }
  return item.priceNote ?? strings.noPrice;
}

/** The tile a dish row's photo stands in while the list loads: the row's photo tile, at its size. */
export const dishLeadingLoading = <Skeleton shape="tile" size="title" />;

/**
 * Sold out on or off from a dish's row (AC-6526): live for guests at once, so the toast says so, with Undo (UX review
 * should-fix 9).
 */
export function flipSoldOut(
  store: MenuStore,
  slug: string,
  item: Pick<Dish, 'id' | 'name'>,
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
  const isNarrow = useIsNarrow();
  const kept = searchStructure(draft, sections, query);
  const all = sections.filter((each) => each.parentId === undefined);
  const top = kept === undefined ? all : all.filter((each) => kept.has(each.id));
  const subsOf = (section: MenuSection) =>
    sections.filter((each) => each.parentId === section.id && (kept === undefined || kept.has(each.id)));
  // A section's head, after checklabs' category card: its chevron and name, which fold it, "N sub sections · N items",
  // then its ⋯ (Edit, List or Grid, Add sub section, Move, Delete); its grip and Edit wait for the pointer or focus.
  const card = (section: MenuSection, index: number, siblings: readonly MenuSection[]) => {
    const subs = sections.filter((each) => each.parentId === section.id);
    const items = section.itemIds.length + subs.reduce((sum, sub) => sum + sub.itemIds.length, 0);
    return {
      id: section.id,
      title: section.name,
      description: strings.sectionCount(subs.length, items, section.layout === 'grid'),
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
      ...(draft.canEdit
        ? sectionActions({ store, slug, section, index, count: siblings.length, isNarrow, onOpen, said })
        : {}),
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
          isNarrow={isNarrow}
        />
      ),
    };
  };
  if (kept !== undefined && top.length === 0) {
    return (
      <EmptyState layout="block" icon="search" title={strings.noSearchMatches}>
        {strings.noSearchLine(query.trim())}
      </EmptyState>
    );
  }
  return (
    <>
      <SectionList
        label={strings.sectionsLabel}
        isTitleInset
        sections={top.map((section, index) => card(section, index, top))}
        // Moving waits for the whole menu: a search shows only part of it.
        {...(draft.canEdit && kept === undefined
          ? { onMove: (id: string, toIndex: number) => void store.move(slug, 'section', id, toIndex).then(said) }
          : {})}
        emptyState={
          <EmptyState
            layout="block"
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

/**
 * A section's head actions: Edit waits with the grip for the pointer or focus, and ⋯ is always there. At a phone's
 * width Edit is only in ⋯, so the head keeps its name on one line.
 */
function sectionActions({
  store,
  slug,
  section,
  index,
  count,
  isNarrow,
  onOpen,
  said,
}: {
  readonly store: MenuStore;
  readonly slug: string;
  readonly section: MenuSection;
  readonly index: number;
  readonly count: number;
  readonly isNarrow: boolean;
  readonly onOpen: (open: Open) => void;
  readonly said: Said;
}) {
  const edit = () => onOpen({ kind: 'section', menuId: section.menuId, sectionId: section.id });
  return {
    ...(isNarrow
      ? {}
      : {
          quietActions: (
            <Tooltip content={strings.editSection}>
              <Button variant="ghost" icon="pencil" label={strings.editNamed(section.name)} onPress={edit} />
            </Tooltip>
          ),
        }),
    actions: (
      <SectionMenu
        section={section}
        index={index}
        count={count}
        onAction={(key) => {
          if (key === 'edit') edit();
          else if (key === 'layout')
            void store
              .saveSection(slug, { ...sectionInput(section), layout: section.layout === 'grid' ? 'list' : 'grid' })
              .then(said);
          else if (key === 'sub') onOpen({ kind: 'section', menuId: section.menuId, parentId: section.id });
          else if (key === 'up') void store.move(slug, 'section', section.id, index - 1).then(said);
          else if (key === 'down') void store.move(slug, 'section', section.id, index + 1).then(said);
          else if (key === 'delete') onOpen({ kind: 'deleteSection', sectionId: section.id, name: section.name });
        }}
      />
    ),
  };
}

/** A section's menu: everything its head can do, for a finger and a keyboard: edit, list or grid, add a sub section, move, delete. */
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
        <MenuItem id="edit" icon="pencil">
          {strings.editSection}
        </MenuItem>
        <MenuItem id="layout" icon={section.layout === 'grid' ? 'list' : 'layout-grid'}>
          {section.layout === 'grid' ? strings.showAsList : strings.showAsGrid}
        </MenuItem>
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
 * An item row's quiet line, as words: how many sizes it comes in (the row's price column gives their range), what it
 * contains, and where else it sits. The price itself is the row's own column.
 */
export function itemFacts(item: Dish, alsoOn: readonly string[]): readonly string[] {
  return [
    ...(item.sizes.length === 0 ? [] : [strings.sizesCount(item.sizes.length)]),
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
  isNarrow,
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
  readonly isNarrow: boolean;
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
    address: '',
    chips: itemFacts(item, menuNames(item.id)),
    leading: <DishThumb slug={slug} item={item} size="title" />,
    // The price on one right edge down the list: a note reads quieter than a figure, and No price (Publish refuses it)
    // stands where the price should be.
    amount: {
      text: priceCell(item, draft.currency, locale),
      tone: isUnpriced(item) ? 'alert' : item.priceMinor === undefined && item.sizes.length === 0 ? 'quiet' : 'default',
    },
    // Sold out reads by the name, the row stepping back with it; the switch for it waits at the end of the row.
    ...(item.soldOut ? { titleBadge: strings.soldOutBadge, titleBadgeTone: 'strong' as const, isOff: true } : {}),
    ...(isNarrow
      ? {}
      : {
          quickAction: (
            <Tooltip content={item.soldOut ? strings.markAvailable : strings.markSoldOut}>
              <Button
                variant="ghost"
                icon={item.soldOut ? 'circle-check' : 'circle-slash'}
                label={item.soldOut ? strings.markAvailableNamed(item.name) : strings.markSoldOutNamed(item.name)}
                onPress={() => flipSoldOut(store, slug, item, !item.soldOut, toasts, said)}
              />
            </Tooltip>
          ),
        }),
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
        density="media"
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
        // Someone who can add sees Add item alone, the count saying the rest; a reader is told it is empty.
        {...(draft.canEdit && !isSearching
          ? {}
          : { emptyState: <EmptyState title={strings.emptySection} layout="row" /> })}
        footer={
          draft.canEdit && !isSearching ? (
            <AddDishes store={store} slug={slug} draft={draft} section={section} onOpen={onOpen} said={said} />
          ) : undefined
        }
      />
      {subsections.length === 0 ? null : (
        <SectionList
          label={strings.subsectionsLabel(section.name)}
          variant="groups"
          isTitleInset
          sections={subsections.map((sub, index) => ({
            id: sub.id,
            title: sub.name,
            description: strings.sectionCount(0, sub.itemIds.length, sub.layout === 'grid'),
            ...(draft.canEdit
              ? sectionActions({ store, slug, section: sub, index, count: subsections.length, isNarrow, onOpen, said })
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
                isNarrow={isNarrow}
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
  // A quiet last line of the list, on the tiles' edge (Linear's, Notion's), opening the search or create in place.
  if (!isAdding)
    return (
      <Button ref={addButton} variant="ghost" icon="plus" onPress={() => setAdding(true)}>
        {strings.addDishButton}
      </Button>
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

/** A dish row's leading tile: its photo, or a quiet photo mark in its place (the row opens the drawer that adds one). */
export function DishThumb({
  slug,
  item,
  size = 'sm',
}: {
  readonly slug: string;
  readonly item: Dish;
  readonly size?: 'xs' | 'md' | 'sm' | 'title';
}) {
  return (
    <Avatar
      name={item.name}
      id={item.id}
      size={size}
      shape="square"
      hue="gray"
      isDecorative
      mark={<Icon name="image" size={size === 'title' ? 'md' : 'xs'} tone="muted" />}
      {...(item.photo === undefined ? {} : { src: draftPhotoHref(slug, item.photo.id, 'small', item.photo.version) })}
    />
  );
}
