// Brief
// Purpose: what the first publish ends on (spec 0058, AC-6, AC-21): the form is live, here is its link. The publish
// itself is one click with nothing asked first (the owner, 5 November 2026, after Tally): the name it has, a link made
// from it, and answers matched to fields automatically; all of it changes later in Settings.
// Main task: copy the link, or pick how it goes on a site, then Done.
// Leaves out: the name, the link and where answers go (Settings), and later publishes (a toast is enough).
import type { FormView } from '@crm/data';
import { Button, Field, Modal, ReadyPanel, TileGrid } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { EMBED_TILES } from './InstallTab.tsx';
import { embedSnippet, type EmbedMode } from './snippets.ts';
import { strings } from './strings.ts';

/** Props for the Ready dialog. */
export interface ReadyDialogProps {
  /** The form just put live; undefined while the dialog is closed. */
  readonly form: FormView | undefined;
  readonly onClose: () => void;
}

/** "Your form is live": its name, the link with Copy and a QR, the three ways onto a site, and Done. */
export function ReadyDialog({ form, onClose }: ReadyDialogProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const [embed, setEmbed] = useState<EmbedMode | null>(null);
  // The last form stays while the Modal plays its exit.
  const [last, setLast] = useState(form);
  if (form !== undefined && form !== last) {
    setLast(form);
    setEmbed(null);
  }
  const live = form ?? last;
  if (live === undefined) return null;
  const shown = live.live ?? live.draft;
  return (
    <Modal
      // Said as the dialog's name once Done takes focus: the success is heard, not only seen.
      title={strings.liveTitle}
      variant="form"
      isOpen={form !== undefined}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      actions={
        // Focus lands on Done, the dialog's one primary, so Enter or Esc closes it.
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        <Button key="done" variant="primary" slot="close" autoFocus>
          {strings.done}
        </Button>
      }
    >
      <ReadyPanel
        /* The Modal's own title says it is live, so the panel's lead is the form's name and nothing else: the
           title, the name and "Share the link, or put it on your site." were three goes at one sentence
           (owner, 1 November 2026). */
        message={live.name}
        link={data.forms.hostedUrl(live.publicKey)}
        shareTitle={live.name}
        // Done is the dialog's one primary; Copy steps down beside the link.
        copyVariant="secondary"
      >
        <TileGrid
          variant="choice"
          label={strings.embedTiles}
          // The three placements are read, not recognised: each says what it does on the tile itself.
          showsDescription
          tiles={EMBED_TILES}
          value={embed}
          onChange={(id) => {
            const tile = EMBED_TILES.find((each) => each.id === id);
            if (tile !== undefined) setEmbed(tile.id);
          }}
        />
        {/* No code until a way is picked (AC-6): the tiles say how it shows, and the snippet follows the pick. */}
        {embed !== null && (
          <Field
            label={strings.embedSnippet}
            variant="copy"
            isMultiline
            copyLabel={strings.copyEmbed}
            {...(embed === 'floating' ? { hint: strings.embedFloatingWords } : {})}
            value={embedSnippet(
              data.forms.embedUrl(),
              {
                kind: 'form',
                publicKey: live.publicKey,
                title: shown.headline,
                theme: shown.look.colour,
                // A button on a site's page reads as an invitation, not as the form's own Submit, as on Install.
                buttonText: strings.embedButtonText,
              },
              embed,
            )}
          />
        )}
      </ReadyPanel>
    </Modal>
  );
}
