// Brief
// Purpose: what the Link page opens on (the owner's design, 27 October 2026): the page as something to hand out,
// not a builder. Its address to copy, its code to scan, and the page itself beside them.
// Main task: share the page in a message or across a table; Edit page is the one way into the editor.
// Leaves out: the blocks, the look and sharing settings, which Edit page opens; and the figures (phase 3).
import type { DataLayer } from '@crm/data';
import { Badge, Button, ButtonLink, Card, DescriptionList, Field, FieldGroup, QrCode, Separator } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { homeStrings } from './home-strings.ts';
import { qrPng, saveFile } from './qr-png.ts';
import { shareStrings } from './share-strings.ts';
import { PrivatePage, useWalletLink } from './private-page.tsx';
import { strings } from './strings.ts';

/** Props for the overview. */
export interface LinkPageOverviewProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The person's handle, which names the saved code's file. */
  readonly handle: string;
  /** The page's whole address, scheme and all. */
  readonly address: string;
  /** Whether anyone but its owner can open it; a private page shows no code to scan. */
  readonly isPublic: boolean;
  /** The page went public here, so the screen holding this knows without reading the profile again. */
  readonly onPublic: () => void;
  /** The page holds nothing yet, so it is still worth saying what a link page is for. */
  readonly isEmpty: boolean;
  /** Opens the builder: the one way in, in the card's own header, as the design draws it. */
  readonly onEdit: () => void;
}

/** Share online and Share in person, or the private page's one way out of being private. */
export function LinkPageOverview({
  data,
  slug,
  handle,
  address,
  isPublic,
  onPublic,
  isEmpty,
  onEdit,
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
  if (!isPublic) {
    return (
      <Card
        title={strings.yourPage}
        description={strings.promise}
        actions={
          <>
            <Badge text={homeStrings.private} dot="gray" />
            <Button variant="primary" icon="pencil" onPress={onEdit}>
              {strings.editPageAction}
            </Button>
          </>
        }
      >
        <PrivatePage data={data} slug={slug} address={address} onPublic={onPublic} />
      </Card>
    );
  }
  // One framed card holding both ways to share, as the owner's artboard draws it: the page is one thing to hand
  // out, not a column of settings. Each way is a titled section inside it, with a rule between them.
  return (
    <>
      <Card
        title={strings.yourPage}
        description={strings.promise}
        actions={
          <>
            <Badge text={homeStrings.live} dot="green" />
            <Button variant="primary" icon="pencil" onPress={onEdit}>
              {strings.editPageAction}
            </Button>
          </>
        }
      >
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
      {isEmpty && (
        <Card title={strings.whyTitle}>
          <DescriptionList layout="stacked" items={[...strings.whyPoints]} />
        </Card>
      )}
    </>
  );
}
