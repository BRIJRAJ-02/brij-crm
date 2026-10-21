// Brief
// Purpose: star a view or a record from its header (spec 0034, AC-934), so it sits in the sidebar's Favourites.
// Main task: add to or remove from favourites in one press, shown at once; a refusal (50 already, no access) rolls back
// with the layer's toast.
// Leaves out: the favourites' order (the sidebar's grips), starring from a table row or the command menu (cmdk lane).
import type { DataLayer } from '@crm/data';
import { useNav } from '@crm/data/react';
import { ToggleButton } from '@crm/ui';
import { universeOf } from './sidebar.ts';
import { strings } from './strings.ts';

/** Props for FavouriteButton. */
export interface FavouriteButtonProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly kind: 'view' | 'record';
  readonly id: string;
}

/** A star toggle, pressed while the view or record is a favourite (`aria-pressed`); left out until the sidebar is known. */
export function FavouriteButton({ data, slug, kind, id }: FavouriteButtonProps) {
  const snapshot = useNav(data.nav.source(slug));
  if (snapshot.status !== 'ready') return null;
  const { nav } = snapshot;
  const isStarred = nav.items.some((item) => item.kind === kind && item.id === id && item.pinned === true);
  return (
    <ToggleButton
      variant="ghost"
      icon="star"
      label={isStarred ? strings.removeFavourite : strings.addFavourite}
      isSelected={isStarred}
      onChange={(star) => {
        // A star or unstar reads only the favourites from the universe (their cap), never the objects.
        void data.nav.change(slug, { op: star ? 'star' : 'unstar', kind, id }, universeOf(undefined, nav));
      }}
    />
  );
}
