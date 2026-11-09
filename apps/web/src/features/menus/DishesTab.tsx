// Brief
// Purpose: every item in one table (after checklabs' Items tab): its photo and name, the section it sits in, its
// price and whether it is available, in the order the menus read, narrowed by the tab bar's search.
// Main task: find an item and change it, or switch it off for tonight.
// Leaves out: where an item sits and in what order (Structure), and add-ons (their own tab).
import type { MenuDraft, MenuItem as Dish, MenuSection, MenuStore } from '@crm/data';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LinkList,
  Menu,
  MenuItem,
  MenuTrigger,
  Switch,
  Table,
  type LinkRow,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useMemo } from 'react';
import type { Open } from './MenusScreen.tsx';
import { useIsNarrow } from './narrow.ts';
import { strings } from './strings.ts';
import { DishThumb, flipSoldOut, priceCell } from './StructureTab.tsx';

/** The table's columns, after checklabs' Item, Category / Sub-category, Price and Visible. */
const COLUMNS: readonly TableColumn[] = [
  { id: 'item', label: strings.columnItem, isRowHeader: true, isInline: true, size: 'fill' },
  { id: 'section', label: strings.columnSection, size: 'fit' },
  { id: 'price', label: strings.columnPrice, align: 'end', size: 'fit' },
  { id: 'available', label: strings.columnAvailable, size: 'fit' },
  { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
];

/** Someone who can't change items (Run service) has no ⋯: the row opens the item to read. */
const READ_COLUMNS = COLUMNS.filter((column) => column.id !== 'actions');

/** One row: the item, where it first sits ("Mains · Grill"), and how many more places it sits in. */
interface ItemRow {
  readonly item: Dish;
  readonly path?: string;
  readonly more: number;
}

/**
 * Every item once, in the order the menus read (the menu shown first, then the others in order; each section's
 * items, then its sub sections'), where it first sits, then the items on no menu, A to Z.
 */
export function itemsInOrder(draft: MenuDraft, menuId: string): readonly ItemRow[] {
  const byPosition = (a: { readonly position: number }, b: { readonly position: number }) => a.position - b.position;
  const menus = [...draft.menus].sort((a, b) => (a.id === menuId ? -1 : b.id === menuId ? 1 : a.position - b.position));
  const names = new Map(draft.sections.map((section) => [section.id, section.name]));
  const order: { readonly itemId: string; readonly path: string }[] = [];
  for (const menu of menus) {
    const sections = draft.sections.filter((section) => section.menuId === menu.id).sort(byPosition);
    const place = (section: MenuSection) => {
      const parent = section.parentId === undefined ? undefined : names.get(section.parentId);
      const path = parent === undefined ? section.name : strings.sectionPath(parent, section.name);
      for (const itemId of section.itemIds) order.push({ itemId, path });
    };
    for (const top of sections.filter((section) => section.parentId === undefined)) {
      place(top);
      for (const sub of sections.filter((section) => section.parentId === top.id)) place(sub);
    }
  }
  const items = new Map(draft.items.map((item) => [item.id, item]));
  const seen = new Map<string, { path: string; more: number }>();
  for (const { itemId, path } of order) {
    const was = seen.get(itemId);
    if (was === undefined) seen.set(itemId, { path, more: 0 });
    else seen.set(itemId, { ...was, more: was.more + 1 });
  }
  const placed = [...seen.entries()].flatMap(([itemId, at]): ItemRow[] => {
    const item = items.get(itemId);
    return item === undefined ? [] : [{ item, path: at.path, more: at.more }];
  });
  const loose = draft.items
    .filter((item) => !seen.has(item.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item): ItemRow => ({ item, more: 0 }));
  return [...placed, ...loose];
}

/** All the workspace's items. */
export function DishesTab({
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
  /** The menu shown, whose order leads. */
  readonly menuId: string;
  /** The tab bar's search: an item, or the section it sits in. */
  readonly query: string;
  readonly onOpen: (open: Open) => void;
  readonly said: (refused: { readonly message: string } | undefined) => void;
  readonly toasts: Toasts;
}) {
  const isNarrow = useIsNarrow();
  const locale = draft.places[0]?.locale ?? 'en-GB';
  const all = useMemo(() => itemsInOrder(draft, menuId), [draft, menuId]);
  const typed = query.trim().toLowerCase();
  const rows =
    typed === ''
      ? all
      : all.filter(
          (row) => row.item.name.toLowerCase().includes(typed) || (row.path ?? '').toLowerCase().includes(typed),
        );
  const available = draft.items.filter((item) => !item.soldOut).length;
  const newItem = draft.canEdit ? (
    <Button icon="plus" onPress={() => onOpen({ kind: 'item' })}>
      {strings.newDish}
    </Button>
  ) : undefined;
  const place = (row: ItemRow) =>
    row.path === undefined ? strings.notOnMenu : row.more === 0 ? row.path : strings.alsoIn(row.path, row.more);
  const opened = (id: string) => {
    const item = draft.items.find((each) => each.id === id);
    // Run service opens it read only (UX review should-fix 14).
    if (item !== undefined) onOpen({ kind: 'item', item });
  };
  const more = (item: Dish) => (
    <MenuTrigger>
      <Button variant="ghost" icon="ellipsis" label={strings.moreFor(item.name)} />
      <Menu
        label={strings.moreFor(item.name)}
        onAction={(key) => {
          if (key === 'edit') onOpen({ kind: 'item', item });
          else if (key === 'delete') onOpen({ kind: 'deleteItem', item });
        }}
      >
        <MenuItem id="edit" icon="pencil">
          {strings.editDish}
        </MenuItem>
        {draft.canEdit ? (
          <MenuItem id="delete" icon="trash" isDanger>
            {strings.deleteDish}
          </MenuItem>
        ) : null}
      </Menu>
    </MenuTrigger>
  );
  const emptyState =
    draft.items.length === 0 ? (
      <EmptyState
        icon="utensils"
        title={strings.noDishes}
        actions={
          draft.canEdit ? (
            <Button variant="primary" icon="plus" onPress={() => onOpen({ kind: 'item' })}>
              {strings.newDish}
            </Button>
          ) : undefined
        }
      >
        {strings.noDishesLine}
      </EmptyState>
    ) : (
      <EmptyState title={strings.noMatches} layout="row" />
    );
  // A phone's width has no room for a table's columns: the same rows as Structure's, the switch at the end of each.
  const narrowRows = rows.map((row): LinkRow => ({
    id: row.item.id,
    title: row.item.name,
    address: '',
    chips: [place(row)],
    leading: <DishThumb slug={slug} item={row.item} size="title" />,
    amount: { text: priceCell(row.item, draft.currency, locale) },
    ...(row.item.soldOut ? { isOff: true } : {}),
    toggle: {
      label: strings.available(row.item.name),
      isSelected: !row.item.soldOut,
      onChange: (isAvailable) => flipSoldOut(store, slug, row.item, !isAvailable, toasts, said),
    },
    ...(draft.canEdit ? { actions: more(row.item) } : {}),
  }));
  return (
    <Card
      title={strings.allItems}
      {...(isNarrow ? {} : { description: strings.allItemsLine })}
      actions={
        <>
          <Badge text={strings.availableCount(available)} />
          {newItem}
        </>
      }
    >
      {isNarrow ? (
        <LinkList
          label={strings.allItems}
          density="media"
          rows={narrowRows}
          onOpen={opened}
          searchLabel={strings.allItems}
          isToolbarHidden
          emptyState={emptyState}
        />
      ) : (
        <Table
          label={strings.allItems}
          columns={draft.canEdit ? COLUMNS : READ_COLUMNS}
          rows={rows}
          getRowId={(row) => row.item.id}
          onRowAction={opened}
          renderCell={(row, column) => {
            const { item } = row;
            if (column === 'item')
              return (
                <>
                  <DishThumb slug={slug} item={item} />
                  {item.name}
                </>
              );
            if (column === 'section') return place(row);
            if (column === 'price') return priceCell(item, draft.currency, locale);
            if (column === 'available')
              return (
                <Switch
                  label={strings.available(item.name)}
                  isLabelHidden
                  isSelected={!item.soldOut}
                  onChange={(isAvailable) => flipSoldOut(store, slug, item, !isAvailable, toasts, said)}
                />
              );
            return more(item);
          }}
          emptyState={emptyState}
        />
      )}
    </Card>
  );
}
