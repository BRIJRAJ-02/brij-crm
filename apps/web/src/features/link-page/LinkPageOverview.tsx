// Brief
// Purpose: what the Link page opens on (the owner's design, 27 October 2026): the page as something to hand out,
// not a builder. Its address to copy, its code to scan, and the page itself beside them.
// Main task: share the page in a message or across a table; Edit page is the one way into the editor.
// Leaves out: the blocks, the look and sharing settings, which Edit page opens; the figures (phase 3); and any way to
// share while the page is Private: then one line and Turn on Live, the bar's switch in words (spec 0058, AC-23).
import type { DataLayer } from '@crm/data';
import { Button, ButtonLink, Card, EmptyState, Field, FieldGroup, QrCode, Separator, SpotIllustration } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { homeStrings } from './home-strings.ts';
import { qrPng, saveFile } from './qr-png.ts';
import { shareStrings } from './share-strings.ts';
import { useWalletLink } from './private-page.tsx';
import { strings } from './strings.ts';

/** Props for the overview. */
export interface LinkPageOverviewProps {
  readonly data: DataLayer;
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
}

/** Share online and Share in person, then, while the page holds nothing, its first empty moment. */
export function LinkPageOverview({
  data,
  slug,
  handle,
  address,
  isPublic,
  isEmpty,
  onEdit,
  onAdd,
  onGoLive,
}: LinkPageOverviewProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const codeRef = useRef<SVGSVGElement>(null);
  const [isSaving, setSaving] = useState(false);
  const wallet = useWalletLink(data, slug, isPublic);
  const shown = address.replace(/^https?:\/\//, '');
  const download = () => {
    const svg = codeRef.current;
    if (svg === null || isSaving) return;
    setSaving(true);
    qrPng(svg)
      .then((png) => saveFile(png, `${handle}-link-page.png`))
      .catch(() => toasts.toast({ tone: 'danger', message: shareStrings.downloadFailed }))
      .finally(() => setSaving(false));
  };
  // One framed card holding both ways to share, as the owner's artboard draws it: the page is one thing to hand
  // out, not a column of settings. Each way is a titled section inside it, with a rule between them. While the page
  // is Private nobody else can open it, so it offers nothing to share (spec 0058, AC-23): one line, and Turn on Live,
  // the bar's switch in words. Every way to share comes back once it is Live.
  const edit = (
    // While the page is empty the start card below holds the one primary, so this one steps back.
    <Button variant={isEmpty ? 'secondary' : 'primary'} icon="pencil" onPress={onEdit}>
      {strings.editPageAction}
    </Button>
  );
  return (
    <>
      {isPublic ? (
        <Card title={strings.yourPage} description={strings.promise} actions={edit}>
          <FieldGroup
            tone="heading"
            headingLevel={3}
            label={strings.shareOnline}
            hint={strings.pasteItAnywhere}
            action={
              <ButtonLink variant="ghost" size="sm" href={address} isExternal icon="arrow-up-right">
                {homeStrings.open}
              </ButtonLink>
            }
          >
            <Field
              label={strings.yourAddress}
              variant="copy"
              icon="link"
              value={shown}
              copyLabel={shareStrings.copy}
              isLabelHidden
            />
          </FieldGroup>
          <Separator />
          <FieldGroup tone="heading" headingLevel={3} label={strings.shareInPerson} hint={strings.scanIt}>
            <QrCode ref={codeRef} value={address} label={shareStrings.qrLabel} size="sm">
              <p>
                <strong>{shown}</strong>
              </p>
              <Button icon="download" isPending={isSaving} onPress={download}>
                {strings.downloadCode}
              </Button>
              {wallet !== undefined && (
                <ButtonLink href={wallet} isExternal icon="wallet">
                  {homeStrings.addToWallet}
                </ButtonLink>
              )}
            </QrCode>
          </FieldGroup>
        </Card>
      ) : (
        <Card title={strings.yourPage} description={strings.privateShareLine} actions={edit}>
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
    </>
  );
}
