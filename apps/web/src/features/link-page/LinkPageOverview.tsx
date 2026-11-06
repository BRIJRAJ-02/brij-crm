// Brief
// Purpose: what the Link page opens on (the owner's design, 27 October 2026; made calm 5 November 2026, "lack of
// hierarchy, too many buttons"): the page beside its phone, one way into the editor, its code, and how it does.
// Main task: Edit page, the one primary. Sharing (copy, Share, the code's style, Wallet) lives once, in the bar.
// Leaves out: the address field, Share links and Open, which the bar's pill and Share hold; the tagline; and any way
// to share while the page is Private: then one line and Turn on Live (spec 0058, AC-23). Insights (spec 0061) sit
// under the card once the page holds something.
import type { LinkPageStore, ProfileItem } from '@crm/data';
import { Button, ButtonGroup, Card, EmptyState, QrCode, SpotIllustration } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { Insights } from './Insights.tsx';
import { drawnQrStyle, useQrStyle } from './ShareTools.tsx';
import { qrPng, saveFile } from './qr-png.ts';
import { shareStrings } from './share-strings.ts';
import { strings } from './strings.ts';
import { teamStrings } from './team-strings.ts';

/** Props for the overview. */
export interface LinkPageOverviewProps {
  readonly slug: string;
  /** The person's handle, which names the saved code's file. */
  readonly handle: string;
  /** The page's whole address, scheme and all. */
  readonly address: string;
  /** Whether anyone but its owner can open it: the card's line says so, and a private page offers no wallet pass. */
  readonly isPublic: boolean;
  /** The page holds nothing yet: its first empty moment shows under the card, with the one way in. */
  readonly isEmpty: boolean;
  /** Opens the builder: the one way in, in the card's own header, as the design draws it. */
  readonly onEdit: () => void;
  /** Opens the builder with Add already open: the empty page's one primary, so it adds rather than shows more empty. */
  readonly onAdd: () => void;
  /** Turns the page Live: the same switch as the bar's, offered here while it is Private. */
  readonly onGoLive: () => void;
  /** The link page's store: Insights, the code's style and the pictures (spec 0061). */
  readonly linkPage: LinkPageStore;
  /** The live and archived blocks, to name each block's clicks in Insights. */
  readonly items: readonly ProfileItem[];
  /** The person's own picture, when it shows on their pages: a choice for the code's middle. */
  readonly personImage?: string | undefined;
  /** The page card's title: "Your page", or for someone else's page (spec 0070) what fits it. */
  readonly title?: string;
  /** Who last changed this page when it wasn't its owner (spec 0070, AC-7004): a quiet line on Your page. */
  readonly editedBy?: { readonly name: string } | undefined;
}

/** Your page (Edit page and the code), then, while the page holds nothing, its first empty moment, else Insights. */
export function LinkPageOverview({
  slug,
  handle,
  address,
  isPublic,
  isEmpty,
  onEdit,
  onAdd,
  onGoLive,
  linkPage,
  items,
  personImage,
  editedBy,
  title = strings.yourPage,
}: LinkPageOverviewProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  // The code in the owner's saved style (AC-6124), here and in what Download saves.
  const qrStyle = drawnQrStyle(useQrStyle(linkPage, slug), linkPage, slug, personImage);
  const codeRef = useRef<SVGSVGElement>(null);
  const [isSaving, setSaving] = useState(false);
  const download = () => {
    const svg = codeRef.current;
    if (svg === null || isSaving) return;
    setSaving(true);
    qrPng(svg)
      .then((png) => saveFile(png, `${handle}-link-page.png`))
      .catch(() => toasts.toast({ tone: 'danger', message: shareStrings.downloadFailed }))
      .finally(() => setSaving(false));
  };
  const edit = (
    // While the page is empty the start card below holds the one primary, so this one steps back.
    <Button variant={isEmpty ? 'secondary' : 'primary'} icon="pencil" onPress={onEdit}>
      {strings.editPageAction}
    </Button>
  );
  // "Edited by Ana": the page stays theirs, and they see who else changed it last (spec 0070, AC-7004).
  const edited = editedBy === undefined ? undefined : teamStrings.editedBy(editedBy.name);
  return (
    <>
      {isPublic ? (
        <Card title={title} actions={edit} {...(edited === undefined ? {} : { description: edited })}>
          {/* The code to print or show across a table, and the one thing to do with it here: Share holds the rest. */}
          <QrCode ref={codeRef} value={address} label={shareStrings.qrLabel} size="sm" {...qrStyle}>
            <ButtonGroup label={strings.shareInPerson} layout="row">
              <Button icon="download" isPending={isSaving} onPress={download}>
                {shareStrings.download}
              </Button>
            </ButtonGroup>
          </QrCode>
        </Card>
      ) : (
        <Card
          title={title}
          description={edited === undefined ? strings.privateShareLine : `${strings.privateShareLine} ${edited}.`}
          actions={edit}
        >
          <div>
            <Button icon="globe" onPress={onGoLive}>
              {strings.goLive}
            </Button>
          </div>
        </Card>
      )}
      {isEmpty && (
        <Card>
          <EmptyState
            layout="block"
            illustration={<SpotIllustration kind="link-page" />}
            title={strings.startTitle}
            actions={
              <Button variant="primary" icon="plus" onPress={onAdd}>
                {strings.startAction}
              </Button>
            }
          >
            {strings.startText}
          </EmptyState>
        </Card>
      )}
      {!isEmpty && <Insights linkPage={linkPage} slug={slug} items={items} />}
    </>
  );
}
