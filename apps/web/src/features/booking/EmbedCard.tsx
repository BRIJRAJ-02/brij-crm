// Brief
// Purpose: the snippet that puts a booking page on someone else's site (spec 0062, L3): how it opens, where it
//   opens, and what the button looks like.
// Main task: pick a way, copy the snippet. Nothing else has to be touched for it to work, and changing the page
//   here never changes the snippet.
// Leaves out: the view beacon and the embed's own stats (L3's other halves), and forms, which have their own tab.
import { AccentPicker, Card, Field, InfoTip, SegmentedControl, Select, TileGrid, type AccentQuickPick } from '@crm/ui';
import { useState } from 'react';
import {
  EMBED_ICONS,
  EMBED_PANELS,
  embedSnippet,
  hexAccent,
  type EmbedIcon,
  type EmbedMode,
  type EmbedPanel,
} from '../forms/snippets.ts';
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
}

const MODE_TILES = [
  { id: 'inline', name: strings.modes.inline.name, icon: 'monitor', description: strings.modes.inline.description },
  { id: 'popup', name: strings.modes.popup.name, icon: 'square', description: strings.modes.popup.description },
  {
    id: 'floating',
    name: strings.modes.floating.name,
    icon: 'message-square',
    description: strings.modes.floating.description,
  },
] as const;

/**
 * The embed, built from the same `embedSnippet` the form's Install tab uses, so a booking page and a form are
 * pasted the same way and a change to the script reaches both. The choices are local: nothing here is saved,
 * because the snippet is the only thing that leaves, and the site holds it from then on.
 */
export function EmbedCard({ script, publicKey, title, isLive, quickPicks }: EmbedCardProps) {
  const [mode, setMode] = useState<EmbedMode>('popup');
  const [panel, setPanel] = useState<EmbedPanel>('centre');
  const [words, setWords] = useState<string>(strings.wordsPlaceholder);
  const [accent, setAccent] = useState<string | undefined>(undefined);
  const [icon, setIcon] = useState<EmbedIcon>('calendar');

  const opens = mode !== 'inline';
  const corner = mode === 'floating';
  const snippet = embedSnippet(
    script,
    {
      kind: 'booking',
      publicKey,
      title,
      theme: 'light',
      buttonText: words.trim() === '' ? strings.wordsPlaceholder : words,
      panel,
      ...(accent === undefined ? {} : { accent }),
      icon,
    },
    mode,
  );

  return (
    <Card title={strings.title} actions={<InfoTip label={strings.title}>{strings.tip}</InfoTip>}>
      <TileGrid
        variant="choice"
        label={strings.mode}
        showsDescription
        tiles={MODE_TILES}
        value={mode}
        onChange={(id) => {
          const tile = MODE_TILES.find((each) => each.id === id);
          if (tile !== undefined) setMode(tile.id);
        }}
      />
      {opens && (
        <SegmentedControl
          label={strings.panel}
          isLabelVisible
          segments={EMBED_PANELS.map((each) => ({ value: each, label: strings.panels[each] }))}
          value={panel}
          onChange={(value) => setPanel(value === 'side' ? 'side' : 'centre')}
        />
      )}
      {opens && (
        <Field
          label={strings.words}
          value={words}
          placeholder={strings.wordsPlaceholder}
          maxLength={40}
          {...(panel === 'side' ? { hint: strings.panelHint } : {})}
          onChange={setWords}
        />
      )}
      {corner && (
        <AccentPicker
          label={strings.colour}
          defaultName={strings.colourDefault}
          quickPicks={quickPicks}
          value={accent}
          onChange={setAccent}
        />
      )}
      {corner && (
        <Select
          label={strings.icon}
          items={EMBED_ICONS.map((each) => ({ id: each, label: strings.icons[each] }))}
          value={icon}
          onChange={(value) =>
            setIcon(
              value !== null && (EMBED_ICONS as readonly string[]).includes(value) ? (value as EmbedIcon) : 'none',
            )
          }
        />
      )}
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
