// Brief
// Purpose: how a visitor sees the form (spec 0063, AC-6302): Classic, Steps or One at a time, picked by sight.
// Main task: pick a layout and watch the preview take it.
// Leaves out: the steps themselves (New step dividers live among the questions), the look (Colour and Corners).
import type { FormLayout } from '@crm/data/forms';
import { Card, FormLayoutThumbnail, TileGrid, type ChoiceTile } from '@crm/ui';
import { strings } from './strings.ts';

/** The three layouts as picture tiles, each with what a visitor gets in its tooltip. */
const LAYOUT_TILES: readonly (ChoiceTile & { readonly id: FormLayout })[] = [
  {
    id: 'classic',
    name: strings.layoutClassic,
    thumbnail: <FormLayoutThumbnail layout="classic" />,
    description: strings.layoutClassicHint,
  },
  {
    id: 'steps',
    name: strings.layoutSteps,
    thumbnail: <FormLayoutThumbnail layout="steps" />,
    description: strings.layoutStepsHint,
  },
  {
    id: 'conversational',
    name: strings.layoutOneAtATime,
    thumbnail: <FormLayoutThumbnail layout="conversational" />,
    description: strings.layoutOneAtATimeHint,
  },
];

/** Props for the Layout card. */
export interface LayoutCardProps {
  readonly layout: FormLayout;
  /** Whether the form has New step dividers: Steps without any says where to add one. */
  readonly hasSteps: boolean;
  readonly isReadOnly: boolean;
  readonly onChange: (layout: FormLayout) => void;
}

/** Layout: three picture tiles. The draft keeps it, and it goes live with the next publish. */
export function LayoutCard({ layout, hasSteps, isReadOnly, onChange }: LayoutCardProps) {
  return (
    <Card
      title={strings.layoutTitle}
      {...(layout === 'steps' && !hasSteps ? { description: strings.layoutAddStep } : {})}
    >
      <TileGrid
        variant="choice"
        label={strings.layoutTitle}
        tiles={isReadOnly ? LAYOUT_TILES.map((tile) => ({ ...tile, isDisabled: tile.id !== layout })) : LAYOUT_TILES}
        value={layout}
        onChange={(id) => {
          const tile = LAYOUT_TILES.find((each) => each.id === id);
          if (tile !== undefined && !isReadOnly) onChange(tile.id);
        }}
      />
    </Card>
  );
}
