// Brief
// Purpose: the link page's look (spec 0054), picked in a few presses and seen at once.
// Main task: choose a starting point, then change the ground, hue, light or dark, buttons and typeface.
// Leaves out: any colour, size or font of its own; every pick is a name from a closed set, and the stylesheet in
// `packages/ui` is the only place a value lives.
import type { DataError, PageTheme } from '@crm/data';
import { Button, Card, ChoiceChips, HuePicker, type Hue } from '@crm/ui';
import { strings } from './strings.ts';

/** What the card shows for each key: the word stored, and what a person reads. */
const GROUNDS = [
  { id: 'plain', label: strings.groundPlain },
  { id: 'paper', label: strings.groundPaper },
  { id: 'tint', label: strings.groundTint },
  { id: 'ink', label: strings.groundInk },
] as const;

const MODES = [
  { id: 'light', label: strings.modeLight },
  { id: 'dark', label: strings.modeDark },
] as const;

const SHAPES = [
  { id: 'soft', label: strings.shapeSoft },
  { id: 'pill', label: strings.shapePill },
  { id: 'square', label: strings.shapeSquare },
] as const;

const FILLS = [
  { id: 'plain', label: strings.fillPlain },
  { id: 'soft', label: strings.fillSoft },
  { id: 'outline', label: strings.fillOutline },
  { id: 'solid', label: strings.fillSolid },
] as const;

const FONTS = [
  { id: 'sans', label: strings.fontSans },
  { id: 'mono', label: strings.fontMono },
] as const;

/** Props for AppearanceCard. */
export interface AppearanceCardProps {
  /** The look as the page is drawn now, with any pick still on its way already shown. */
  readonly theme: PageTheme;
  /** A pick: shown at once by the caller, then saved. A refusal puts the control back and says why. */
  readonly onChange: (theme: PageTheme) => void;
  /** Why the last pick didn't save, said on the card until the next pick. */
  readonly refusal?: DataError;
}

/**
 * Appearance (AC-5420): five named starting points, then the five controls behind them. Each pick saves at once,
 * the way a reorder does, and the preview beside the list shows it before it lands.
 */
export function AppearanceCard({ theme, onChange, refusal }: AppearanceCardProps) {
  const pick = (next: PageTheme) => {
    onChange(next);
  };
  const chips = <Kind extends keyof PageTheme>(
    label: string,
    key: Kind,
    choices: readonly { readonly id: PageTheme[Kind]; readonly label: string }[],
  ) => (
    <ChoiceChips
      isSingle
      label={label}
      choices={choices.map((choice) => ({ id: choice.id, label: choice.label }))}
      selected={[theme[key]]}
      onChange={(picked) => {
        const found = choices.find((choice) => choice.id === picked[0]);
        if (found !== undefined) pick({ ...theme, [key]: found.id });
      }}
    />
  );
  return (
    <Card
      title={strings.appearance}
      description={strings.appearanceText}
      actions={<Button onPress={() => pick(DEFAULT)}>{strings.reset}</Button>}
      {...(refusal === undefined ? {} : { footerNote: refusal.message })}
    >
      {chips(strings.ground, 'ground', GROUNDS)}
      <HuePicker
        isLabelShown
        label={strings.hue}
        value={theme.hue}
        onChange={(hue: Hue) => {
          pick({ ...theme, hue });
        }}
      />
      {chips(strings.mode, 'mode', MODES)}
      {chips(strings.shape, 'shape', SHAPES)}
      {chips(strings.fill, 'fill', FILLS)}
      {chips(strings.font, 'font', FONTS)}
    </Card>
  );
}

/** The look a Reset goes back to: the page spec 0051 ships (AC-5423). Nothing is lost that isn't a press away. */
const DEFAULT: PageTheme = {
  ground: 'plain',
  hue: 'blue',
  mode: 'light',
  shape: 'soft',
  fill: 'plain',
  font: 'sans',
};
