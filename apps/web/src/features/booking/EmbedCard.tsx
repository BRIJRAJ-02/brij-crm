// Brief
// Purpose: the snippet that puts a booking page on someone else's site (spec 0062, L3): how it opens, and what
//   the button looks like.
// Main task: pick how it opens, copy the snippet. Nothing else has to be touched for it to work, and changing
//   the page here never changes the snippet.
// Leaves out: the view beacon and the embed's own stats (L3's other halves), and forms, which have their own tab.
//
// It was built as four ready made setups above a fold holding the same two choices again, which read as the same
// question asked twice and filled the card with empty tiles (the owner, 2 November 2026: "it looks low UXed").
// There is one question now, three answers, and a switch for the only thing the answer leaves open. Everything
// else on the card is a property of the button we draw, so it appears only when we are drawing one.
import {
  AccentPicker,
  Card,
  Field,
  InfoTip,
  Select,
  Switch,
  TileGrid,
  type AccentQuickPick,
  type IconName,
} from '@crm/ui';
import { useState } from 'react';
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
}

/**
 * The one question: who opens it. The three answers are what a site actually does, and each name says what the
 * visitor sees rather than what we call it inside. Where it opens is the switch below, because it is only ever a
 * second question about the same answer.
 */
const MODE_TILES = [
  { id: 'floating', name: strings.modes.floating, icon: 'message-square' },
  { id: 'popup', name: strings.modes.popup, icon: 'mouse-pointer-2' },
  { id: 'inline', name: strings.modes.inline, icon: 'monitor' },
] as const satisfies readonly { readonly id: EmbedMode; readonly name: string; readonly icon: IconName }[];

/**
 * The embed, built from the same `embedSnippet` the form's Install tab uses, so a booking page and a form are
 * pasted the same way and a change to the script reaches both. The choices are local: nothing here is saved,
 * because the snippet is the only thing that leaves, and the site holds it from then on.
 */
export function EmbedCard({ script, publicKey, title, isLive, quickPicks }: EmbedCardProps) {
  // The corner button first: it is the only one that needs nothing on the site but the snippet.
  const [mode, setMode] = useState<EmbedMode>('floating');
  const [isSide, setSide] = useState(false);
  const [words, setWords] = useState<string>(strings.wordsPlaceholder);
  const [accent, setAccent] = useState<string | undefined>(undefined);
  const [icon, setIcon] = useState<EmbedIcon>('calendar');

  // In the page is the one answer with nothing to open and no button of ours, so it has neither of the rest.
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
      panel: isSide ? 'side' : 'centre',
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
        tiles={MODE_TILES.map(({ id, name, icon: tileIcon }) => ({ id, name, icon: tileIcon }))}
        value={mode}
        onChange={(id) => {
          const tile = MODE_TILES.find((each) => each.id === id);
          if (tile !== undefined) setMode(tile.id);
        }}
      />
      {opens && <Switch label={strings.side} description={strings.sideHint} isSelected={isSide} onChange={setSide} />}
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
        <Field
          label={strings.snippet}
          variant="copy"
          isMultiline
          copyLabel={strings.copy}
          hint={`${strings.modeHints[mode]} ${strings.paste}`}
          value={snippet}
        />
      ) : (
        <Field label={strings.snippet} variant="copy" isMultiline isReadOnly value="" hint={strings.liveFirst} />
      )}
    </Card>
  );
}

/** The accent a snippet would carry, for a preview that has to draw the same colour. */
export const embedAccentOf = hexAccent;
