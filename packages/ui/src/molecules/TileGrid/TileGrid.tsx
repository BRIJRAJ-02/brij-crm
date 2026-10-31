import type { ReactNode } from 'react';
import { ChoiceTiles, type ChoiceTilesProps } from './ChoiceTiles.tsx';
import styles from './TileGrid.module.css';

export type { ChoiceActionProps, ChoiceSelectProps, ChoiceTile } from './ChoiceTiles.tsx';

/** Props for TileGrid's card layout (the default variant). */
export interface CardTileGridProps {
  /** `cards` (the default) lays out the Cards you pass; `choice` is the picker below. */
  readonly variant?: 'cards';
  /** The tiles, usually Cards. A tile that renders nothing leaves no gap: the rest close up. */
  readonly children: ReactNode;
  /**
   * `fit` (the default) shares the width among the tiles there are, so two tiles fill a wide page (Home).
   * `fill` keeps empty tracks, so every tile is the same width however many there are (SettingsGrid: one card
   * per calendar).
   */
  readonly fill?: 'fit' | 'fill';
  /**
   * `auto` (the default) fits as many columns as the width holds. `two` holds at most two, each at least the
   * panel's width: two on a wide page, one on a phone or a narrow window (Home's sections).
   */
  readonly columns?: 'auto' | 'two';
  /**
   * Eases each tile in when the grid mounts: a fade and a short rise, one tile a moment after the other, for a
   * moment worth marking (first run's Done, spec 0058 AC-21). Transform and opacity only, a fade alone under reduced
   * motion, and the tiles take input at once. Leave it off for grids that load or refresh, where motion is noise.
   */
  readonly isEntering?: boolean;
}

/**
 * Props for TileGrid: the card layout, or with `variant="choice"` equal size tiles to pick from by sight (`tiles`,
 * each a Lucide mark or a thumbnail over a short name; `mode="select"` keeps one chosen with a ring and a tick,
 * `mode="action"` makes each tile a button).
 */
export type TileGridProps = CardTileGridProps | ChoiceTilesProps;

/**
 * Cards side by side that wrap (Home's Today, Tasks due and Team today): as many columns as fit at
 * the panel's width or more, one column on a phone, each tile as tall as its own content.
 */
export function TileGrid(props: TileGridProps) {
  if (props.variant === 'choice') return <ChoiceTiles {...props} />;
  const { children, fill = 'fit', columns = 'auto', isEntering = false } = props;
  return (
    <div
      className={styles.root}
      data-fill={fill === 'fill' ? fill : undefined}
      data-columns={columns === 'two' ? columns : undefined}
      data-entering={isEntering || undefined}
    >
      {children}
    </div>
  );
}
