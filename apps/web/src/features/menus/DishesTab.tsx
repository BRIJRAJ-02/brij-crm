// Brief
// Purpose: every item in one table (after checklabs' Items tab): its photo and name, the section it sits in, its
// price and whether it is available, in the order the menus read, narrowed by the tab bar's search.
// Main task: find an item and change it, or switch it off for tonight.
// Leaves out: where an item sits and in what order (Structure), and option groups (Options).
import type { MenuDraft, MenuItem as Dish, MenuSection, MenuStore } from '@crm/data';
import { formatPrice } from '@crm/data/menu';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Menu,
  MenuItem,
  MenuTrigger,
  Switch,
  Table,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useMemo } from 'react';
import type { Open } from './MenusScreen.tsx';
import { useIsNarrow } from './narrow.ts';
import { strings } from './strings.ts';
import { DishThumb, flipSoldOut } from './StructureTab.tsx';

/** The table's columns, after checklabs' Item, Category / Sub-category, Price and Visible. */
const COLUMNS: readonly TableColumn[] = [
  { id: 'item', label: strings.columnItem, isRowHeader: true, isInline: true, size: 'fill' },
  { id: 'section', label: strings.columnSection, size: 'fit' },
  { id: 'price', label: strings.columnPrice, align: 'end', size: 'fit' },
  { id: 'available', label: strings.columnAvailable, size: 'fit' },
  { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
];

/** At a phone's width the section gives its room to the name. */
const NARROW_COLUMNS = COLUMNS.filter((column) => column.id !== 'section');

/** Someone who can't change items (Run service) has no ⋯: the row opens the item to read. */
const READ_COLUMNS = COLUMNS.filter((column) => column.id !== 'actions');
const NARROW_READ_COLUMNS = NARROW_COLUMNS.filter((column) => column.id !== 'actions');

/** An item's price in one short cell: its price, its sizes' range (£14.00–£26.00), its note, or No price. */
function priceCell(item: Dish, currency: string, locale: string): string {
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
  return (
    <Card
      title={strings.allItems}
      description={strings.allItemsLine}
      actions={
        <>
          <Badge text={strings.availableCount(available)} />
          {newItem}
        </>
      }
    >
      <Table
        label={strings.allItems}
        columns={draft.canEdit ? (isNarrow ? NARROW_COLUMNS : COLUMNS) : isNarrow ? NARROW_READ_COLUMNS : READ_COLUMNS}
        rows={rows}
        getRowId={(row) => row.item.id}
        onRowAction={(id) => {
          const item = draft.items.find((each) => each.id === id);
          // Run service opens it read only (UX review should-fix 14).
          if (item !== undefined) onOpen({ kind: 'item', item });
        }}
        renderCell={(row, column) => {
          const { item } = row;
          if (column === 'item')
            return (
              <>
                <DishThumb slug={slug} item={item} size="xs" />
                {item.name}
              </>
            );
          if (column === 'section')
            return row.path === undefined
              ? strings.notOnMenu
              : row.more === 0
                ? row.path
                : strings.alsoIn(row.path, row.more);
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
          return (
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
        }}
        emptyState={
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
          )
        }
      />
    </Card>
  );
}
