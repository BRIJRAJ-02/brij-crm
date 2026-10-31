// Brief
// Purpose: the link page's look (spec 0054), picked in a few presses and seen at once.
// Main task: choose a starting point by its picture (spec 0058, AC-10), then change the ground, hue, light or dark,
// buttons and typeface.
// Leaves out: any colour, size or font of its own; every pick is a name from a closed set, and the stylesheet in
// `packages/ui` is the only place a value lives.
import { DEFAULT_PAGE_THEME, PAGE_THEME_PRESETS, sameTheme, type DataError, type PageTheme } from '@crm/data';
import { Button, Card, ChoiceChips, HuePicker, LinkPageThumbnail, TileGrid, type Hue } from '@crm/ui';
import { strings } from './strings.ts';

/** What each starting point is called. The list's order is the contracts' own, so the two can't fall apart. */
const PRESET_NAMES: Record<(typeof PAGE_THEME_PRESETS)[number]['id'], string> = {
  plain: strings.presetPlain,
  paper: strings.presetPaper,
  bold: strings.presetBold,
  ink: strings.presetInk,
  quiet: strings.presetQuiet,
};

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
  // The starting point a person is standing on, or none once they have changed a key under it. Worked out from
  // the six keys rather than remembered, since the name is never stored (AC-5420).
  const standing = PAGE_THEME_PRESETS.find((preset) => sameTheme(preset.theme, theme));
  return (
    <Card
      title={strings.appearance}
      description={strings.appearanceText}
      actions={<Button onPress={() => pick(DEFAULT_PAGE_THEME)}>{strings.reset}</Button>}
      {...(refusal === undefined ? {} : { footerNote: refusal.message })}
    >
      {/* Each starting point as a picture of the page in that look, its name under it: picked by sight, and the
          chosen one ringed and ticked, so nobody reads a word to see where they stand. None is ticked once a
          control below changes a key under it. */}
      <TileGrid
        variant="choice"
        label={strings.startingPoint}
        value={standing?.id ?? null}
        tiles={PAGE_THEME_PRESETS.map((preset) => ({
          id: preset.id,
          name: PRESET_NAMES[preset.id],
          thumbnail: <LinkPageThumbnail theme={preset.theme} />,
        }))}
        onChange={(picked) => {
          const found = PAGE_THEME_PRESETS.find((preset) => preset.id === picked);
          if (found !== undefined) pick(found.theme);
        }}
      />
      {chips(strings.ground, 'ground', GROUNDS)}
      {/* The colour is the Colour background's alone: under any other it would change nothing, so it waits
          until that background is chosen (flow walks, 29 October 2026: L1). */}
      {theme.ground === 'tint' && (
        <HuePicker
          isLabelShown
          label={strings.hue}
          value={theme.hue}
          onChange={(hue: Hue) => {
            pick({ ...theme, hue });
          }}
        />
      )}
      {chips(strings.mode, 'mode', MODES)}
      {chips(strings.shape, 'shape', SHAPES)}
      {chips(strings.fill, 'fill', FILLS)}
      {chips(strings.font, 'font', FONTS)}
    </Card>
  );
}
