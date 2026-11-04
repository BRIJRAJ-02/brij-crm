// Brief
// Purpose: one menu's Structure (after checklabs' Structure tab): its sections in order, each with its sub sections and
// its dishes in order, every one moved by its grip or the keyboard.
// Main task: put dishes in sections and order them as the menu reads.
// Leaves out: a dish's own fields (the dish drawer), the menu's settings (Settings) and Sold out across menus (Dishes).
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

/** One menu's sections and their dishes. */
export function StructureTab({
  store,
  slug,
  draft,
  menuId,
  onOpen,
  said,
  toasts,
}: {
  readonly store: MenuStore;
  readonly slug: string;
  readonly draft: MenuDraft;
  readonly menuId: string;
  readonly onOpen: (open: Open) => void;
  readonly said: Said;
  readonly toasts: Toasts;
}) {
  const sections = useMemo(
    () => draft.sections.filter((each) => each.menuId === menuId).sort((a, b) => a.position - b.position),
    [draft.sections, menuId],
  );
  const top = sections.filter((each) => each.parentId === undefined);
  // A section's head, after checklabs' category card: its grip, its name, how many items it holds, the List or Grid
  // switch, then its ⋯ (Edit, Add sub section, Move, Delete). No numbers.
  const count = (section: MenuSection) =>
    section.itemIds.length +
    sections.filter((each) => each.parentId === section.id).reduce((sum, sub) => sum + sub.itemIds.length, 0);
  const card = (section: MenuSection, index: number, siblings: readonly MenuSection[]) => ({
    id: section.id,
    title: section.name,
    description: strings.itemCount(count(section)),
    actions: draft.canEdit ? (
      <>
        <LayoutSwitch store={store} slug={slug} section={section} said={said} />
        <SectionMenu
          section={section}
          index={index}
          count={siblings.length}
          onAction={(key) => {
            if (key === 'edit') onOpen({ kind: 'section', menuId, sectionId: section.id });
            else if (key === 'sub') onOpen({ kind: 'section', menuId, parentId: section.id });
            else if (key === 'up') void store.move(slug, 'section', section.id, index - 1).then(said);
            else if (key === 'down') void store.move(slug, 'section', section.id, index + 1).then(said);
            else if (key === 'delete') onOpen({ kind: 'deleteSection', sectionId: section.id, name: section.name });
          }}
        />
      </>
    ) : undefined,
    content: (
      <SectionBody
        store={store}
        slug={slug}
        draft={draft}
        section={section}
        subsections={sections.filter((each) => each.parentId === section.id)}
        onOpen={onOpen}
        said={said}
        toasts={toasts}
      />
    ),
  });
  return (
    <>
      <SectionList
        label={strings.sectionsLabel}
        sections={top.map((section, index) => card(section, index, top))}
        {...(draft.canEdit
          ? { onMove: (id: string, toIndex: number) => void store.move(slug, 'section', id, toIndex).then(said) }
          : {})}
        emptyState={
          <EmptyState
            icon="list"
            title={strings.noSections}
            actions={
              draft.canEdit ? (
                <Button variant="primary" icon="plus" onPress={() => onOpen({ kind: 'section', menuId })}>
                  {strings.newSection}
                </Button>
              ) : undefined
            }
          />
        }
      />
      {draft.canEdit && top.length > 0 ? (
        <Button variant="dashed" icon="plus" isFullWidth onPress={() => onOpen({ kind: 'section', menuId })}>
          {strings.newSection}
        </Button>
      ) : null}
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

/** A section's menu: edit, add a sub section, move (for a pointer that can't drag), delete. */
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

/** A section's layout, Add dishes, its dishes in order and its sub sections. */
function SectionBody({
  store,
  slug,
  draft,
  section,
  subsections,
  onOpen,
  said,
  toasts,
}: {
  readonly store: MenuStore;
  readonly slug: string;
  readonly draft: MenuDraft;
  readonly section: MenuSection;
  readonly subsections: readonly MenuSection[];
  readonly onOpen: (open: Open) => void;
  readonly said: Said;
  readonly toasts: Toasts;
}) {
  const items = new Map(draft.items.map((item) => [item.id, item]));
  const locale = draft.places[0]?.locale ?? 'en-GB';
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
  const placed = section.itemIds.map((id) => items.get(id)).filter((item): item is Dish => item !== undefined);
  const rows = placed.map((item, index): LinkRow => ({
    id: item.id,
    title: item.name,
    address: priceLine(item, draft.currency, locale),
    chips: [
      ...item.diet.slice(0, 2).map((mark) => strings.diets[mark]),
      ...(menuNames(item.id).length === 0 ? [] : [strings.alsoOn(menuNames(item.id).join(', '))]),
    ],
    // The dish's photo, or a quiet photo mark where it has none (checklabs' empty photo slot): never a letter tile.
    leading: <DishThumb slug={slug} item={item} />,
    ...(item.soldOut
      ? { badge: strings.soldOutBadge, isOff: true }
      : isUnpriced(item)
        ? { badge: strings.noPriceBadge }
        : {}),
    ...(draft.canEdit
      ? {
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
        }
      : {}),
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
        {...(draft.canEdit
          ? {
              rowOrder: LinkListRowOrder,
              onMove: (id: string, toIndex: number) =>
                void store.move(slug, 'placement', id, toIndex, section.id).then(said),
            }
          : {})}
        emptyState={<EmptyState title={strings.emptySection} layout="row" />}
      />
      {draft.canEdit ? (
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
                    <>
                      <LayoutSwitch store={store} slug={slug} section={sub} said={said} />
                      <SectionMenu
                        section={sub}
                        index={index}
                        count={subsections.length}
                        onAction={(key) => {
                          if (key === 'edit') onOpen({ kind: 'section', menuId: sub.menuId, sectionId: sub.id });
                          else if (key === 'up') void store.move(slug, 'section', sub.id, index - 1).then(said);
                          else if (key === 'down') void store.move(slug, 'section', sub.id, index + 1).then(said);
                          else if (key === 'delete')
                            onOpen({ kind: 'deleteSection', sectionId: sub.id, name: sub.name });
                        }}
                      />
                    </>
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
                onOpen={onOpen}
                said={said}
                toasts={toasts}
              />
            ),
          }))}
          {...(draft.canEdit
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
  // The field takes focus as it replaces the button that opened it.
  useEffect(() => {
    if (isAdding) anchor.current?.focus();
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
  if (!isAdding)
    return (
      <Button variant="ghost" icon="plus" onPress={() => setAdding(true)}>
        {strings.addDishButton}
      </Button>
    );
  return (
    <>
      <Field
        ref={anchor}
        onBlur={() => {
          if (query.trim() === '') setAdding(false);
        }}
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
                  leading: <Avatar name={choice.item.name} id={choice.item.id} size="xs" isDecorative />,
                  label: choice.item.name,
                  detail: priceLine(choice.item, draft.currency, draft.places[0]?.locale ?? 'en-GB'),
                }
              : {
                  key: 'create',
                  leading: <Avatar name={typed} id="create" size="xs" isDecorative />,
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
export function DishThumb({ slug, item }: { readonly slug: string; readonly item: Dish }) {
  return (
    <Avatar
      name={item.name}
      id={item.id}
      size="sm"
      shape="square"
      hue="gray"
      isDecorative
      mark={<Icon name="image" size="xs" />}
      {...(item.photo === undefined ? {} : { src: draftPhotoHref(slug, item.photo.id, 'small', item.photo.version) })}
    />
  );
}
