// Brief
// Purpose: how a visitor sees the form (spec 0063, AC-6302): Classic, Steps or One at a time.
// Main task: pick a layout and watch the preview take it.
// Leaves out: the steps themselves (Add a step lives among the questions), the look (Colour and Corners).
import type { FormLayout } from '@crm/data/forms';
import { SegmentedControl } from '@crm/ui';
import { strings } from './strings.ts';

/** The three layouts, in the order Tally and Typeform offer them. */
const LAYOUTS: readonly { readonly value: FormLayout; readonly label: string }[] = [
  { value: 'classic', label: strings.layoutClassic },
  { value: 'steps', label: strings.layoutSteps },
  { value: 'conversational', label: strings.layoutOneAtATime },
];

/** Props for the Layout control. */
export interface LayoutCardProps {
  readonly layout: FormLayout;
  readonly isReadOnly: boolean;
  readonly onChange: (layout: FormLayout) => void;
}

/**
 * Layout as one segmented control (T17, 4 November 2026: the three big thumbnail cards went; the preview beside it
 * shows what each one does). The draft keeps it, and it goes live with the next publish.
 */
export function LayoutCard({ layout, isReadOnly, onChange }: LayoutCardProps) {
  return (
    <SegmentedControl
      label={strings.layoutTitle}
      isLabelVisible
      isFitted
      segments={LAYOUTS}
      value={layout}
      isReadOnly={isReadOnly}
      onChange={(value) => {
        const picked = LAYOUTS.find((each) => each.value === value);
        if (picked !== undefined && !isReadOnly) onChange(picked.value);
      }}
    />
  );
}
