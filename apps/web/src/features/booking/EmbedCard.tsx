// Brief
// Purpose: the snippet that puts a booking page on someone else's site (spec 0062, L3): how it opens, and what
//   the button looks like.
// Main task: pick how it opens, copy the snippet. Nothing else has to be touched for it to work, and changing
//   the page here never changes the snippet.
// Leaves out: the view beacon and the embed's own stats (L3's other halves), and forms, which have their own tab.
//
// The same card as a form's Share tab (the owner, 5 November 2026: "less text, same flow, not a different level"):
// the three ways stacked as the form's own tiles, each saying what it does, the chosen way's own choices right under
// them (Slide in from the side for both buttons; the corner button's words, colour and icon), the made up site
// showing the pick beside them (under them in this column) with the page in it as its card draws it, and one snippet
// to copy at the end.
import {
  AccentPicker,
  Card,
  EmbedPreview,
  Field,
  InfoTip,
  SegmentedControl,
  SettingsStack,
  Switch,
  TileGrid,
  type AccentQuickPick,
  type IconName,
} from '@crm/ui';
import { useState, type ReactNode } from 'react';
import { EMBED_TILES } from '../forms/embed-tiles.ts';
import { EMBED_ICONS, embedSnippet, hexAccent, type EmbedIcon, type EmbedMode } from '../forms/snippets.ts';
import { embedStrings as strings } from './embed-strings.ts';

/** Props for EmbedCard. */
export interface EmbedCardProps {
  /** Where the embed script lives: the app's own origin plus `/embed/v1.js`. */
  readonly script: string;
  /**
   * What the snippet points at: the page's public key, or `handle/slug` once it has a handle, which is the address
   * a visitor would read and the one that survives a rename of the key.
   */
  readonly publicKey: string;
  /** The page's title: the frame's name for screen readers. */
  readonly title: string;
  /** A page that isn't live yet has no address to paste, so the card says so instead of handing out a dead snippet. */
  readonly isLive: boolean;
  /** The brand kit's quick colour picks, as the link page's Design panel takes them (`data.brand.quickPicks`). */
  readonly quickPicks: readonly AccentQuickPick[];
  /** The page in miniature (`pagePicture`), as its card in Captures › Links draws it: what sits in the made up site. */
  readonly picture: ReactNode;
}

/**
 * The corner button's marks, as its choice shows them and the made up site draws them. The embed script's chat mark
 * is a round bubble the icon registry doesn't hold; its square one stands in, rather than every page's first load
 * paying for a picture.
 */
const MARK_ICONS: Readonly<Record<Exclude<EmbedIcon, 'none'>, IconName>> = {
  calendar: 'calendar',
  chat: 'message-square',
  mail: 'mail',
};

/** The mark choice's segments: none, then each mark by its picture and name. */
const MARK_SEGMENTS = EMBED_ICONS.map((each) =>
  each === 'none'
    ? { value: each, label: strings.icons[each] }
    : { value: each, label: strings.icons[each], icon: MARK_ICONS[each] },
);

/**
 * The embed, built from the same `embedSnippet` the form's Share tab uses, so a booking page and a form are
 * pasted the same way and a change to the script reaches both. The choices are local: nothing here is saved,
 * because the snippet is the only thing that leaves, and the site holds it from then on.
 */
export function EmbedCard({ script, publicKey, title, isLive, quickPicks, picture }: EmbedCardProps) {
  // The corner button first: it is the only one that needs nothing on the site but the snippet. The tiles are the
  // form's own list (`EMBED_TILES`), so the two cards name, mark and describe the ways the same.
  const [mode, setMode] = useState<EmbedMode>('floating');
  const [isSide, setSide] = useState(false);
  const [words, setWords] = useState<string>(strings.wordsPlaceholder);
  const [accent, setAccent] = useState<string | undefined>(undefined);
  const [icon, setIcon] = useState<EmbedIcon>('calendar');

  // In the page is the one way with nothing to open and no button of ours, so it has neither of the rest.
  const opens = mode !== 'inline';
  const corner = mode === 'floating';
  const buttonWords = words.trim() === '' ? strings.wordsPlaceholder : words;
  // The brand picks less blue, which the first swatch (Timefix, the product's own blue) already is, as on a form's
  // card (the owner, 5 November 2026: two near identical blues side by side).
  const picks = quickPicks.filter((pick) => pick.hue !== 'blue');
  const snippet = embedSnippet(
    script,
    {
      kind: 'booking',
      publicKey,
      title,
      theme: 'light',
      buttonText: buttonWords,
      panel: isSide ? 'side' : 'centre',
      ...(accent === undefined ? {} : { accent }),
      icon,
    },
    mode,
  );

  return (
    <Card title={strings.title} actions={<InfoTip label={strings.title}>{strings.tip}</InfoTip>}>
      {/* The ways stacked as a column with the chosen way's choices under them, the made up site beside them where
          the card is wide enough for both, and under them where it isn't (the editor's settings column). */}
      <TileGrid columns="two">
        <SettingsStack variant="flush">
          <TileGrid
            variant="choice"
            label={strings.mode}
            showsDescription
            tileWidth="full"
            tiles={EMBED_TILES}
            value={mode}
            onChange={(id) => {
              const tile = EMBED_TILES.find((each) => each.id === id);
              if (tile !== undefined) setMode(tile.id);
            }}
          />
          {opens && (
            <Switch label={strings.side} description={strings.sideHint} isSelected={isSide} onChange={setSide} />
          )}
          {opens && (
            <Field
              label={strings.words}
              value={words}
              placeholder={strings.wordsPlaceholder}
              maxLength={40}
              onChange={setWords}
            />
          )}
          {corner && (
            <AccentPicker
              label={strings.colour}
              defaultName={strings.colourDefault}
              quickPicks={picks}
              hexPlacement="inline"
              value={accent}
              onChange={setAccent}
            />
          )}
          {corner && (
            <SegmentedControl
              label={strings.icon}
              isLabelVisible
              segments={MARK_SEGMENTS}
              value={icon}
              onChange={(value) => {
                const picked = EMBED_ICONS.find((each) => each === value);
                if (picked !== undefined) setIcon(picked);
              }}
            />
          )}
        </SettingsStack>
        <EmbedPreview
          mode={mode}
          headline={title}
          content={picture}
          words={buttonWords}
          {...(accent === undefined ? {} : { colour: accent })}
          {...(corner && icon !== 'none' ? { mark: MARK_ICONS[icon] } : {})}
          label={strings.preview}
        />
      </TileGrid>
      {isLive ? (
        <Field label={strings.snippet} variant="copy" isMultiline copyLabel={strings.copy} value={snippet} />
      ) : (
        <Field label={strings.snippet} variant="copy" isMultiline isReadOnly value="" hint={strings.liveFirst} />
      )}
    </Card>
  );
}

/** The accent a snippet would carry, for a preview that has to draw the same colour. */
export const embedAccentOf = hexAccent;
