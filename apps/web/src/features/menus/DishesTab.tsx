// Brief
// Purpose: every dish of the workspace in one list (after checklabs' Items tab): find one, open it, flip Sold out.
// Main task: find a dish and change it, or mark it sold out for tonight.
// Leaves out: where a dish sits and in what order (Structure), and option groups (Options).
import type { MenuDraft, MenuItem as Dish, MenuStore } from '@crm/data';
import { Button, EmptyState, LinkList, type LinkRow, type Toasts } from '@crm/ui';
import { useState } from 'react';
import type { Open } from './MenusScreen.tsx';
import { useIsNarrow } from './narrow.ts';
import { strings } from './strings.ts';
import { DishThumb, dishLeadingLoading, flipSoldOut, isUnpriced, priceLine } from './StructureTab.tsx';

/** All the workspace's dishes. */
export function DishesTab({
  store,
  slug,
  draft,
  onOpen,
  said,
  toasts,
}: {
  readonly store: MenuStore;
  readonly slug: string;
  readonly draft: MenuDraft;
  readonly onOpen: (open: Open) => void;
  readonly said: (refused: { readonly message: string } | undefined) => void;
  readonly toasts: Toasts;
}) {
  const [query, setQuery] = useState('');
  // At a phone's width a sold out row says so by its off switch and quiet title, so its name keeps the room.
  const isNarrow = useIsNarrow();
  const locale = draft.places[0]?.locale ?? 'en-GB';
  const placements = (item: Dish) => draft.sections.filter((section) => section.itemIds.includes(item.id)).length;
  const typed = query.trim().toLowerCase();
  const rows = [...draft.items]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((item) => typed === '' || item.name.toLowerCase().includes(typed))
    .map((item): LinkRow => ({
      id: item.id,
      title: item.name,
      address: priceLine(item, draft.currency, locale),
      chips: [strings.inSections(placements(item))],
      leading: <DishThumb slug={slug} item={item} />,
      ...(item.soldOut
        ? { ...(isNarrow ? {} : { badge: strings.soldOutBadge }), isOff: true }
        : isUnpriced(item)
          ? { badge: strings.noPriceBadge }
          : {}),
      toggle: {
        label: strings.available(item.name),
        isSelected: !item.soldOut,
        onChange: (isAvailable) => flipSoldOut(store, slug, item, !isAvailable, toasts, said),
      },
    }));
  return (
    <LinkList
      label={strings.allDishes}
      rows={rows}
      onOpen={(id) => {
        const item = draft.items.find((each) => each.id === id);
        // Run service opens it read only (UX review should-fix 14).
        if (item !== undefined) onOpen({ kind: 'item', item });
      }}
      searchLabel={strings.searchDishes}
      leadingLoading={dishLeadingLoading}
      query={query}
      onQueryChange={setQuery}
      actions={
        draft.canEdit ? (
          <Button icon="plus" onPress={() => onOpen({ kind: 'item' })}>
            {strings.newDish}
          </Button>
        ) : undefined
      }
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
  );
}
