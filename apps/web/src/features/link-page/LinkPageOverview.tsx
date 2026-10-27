// Brief
// Purpose: what the Link page opens on (the owner's design, 27 October 2026): the page as something to hand out,
// not a builder. Its address to copy, its code to scan, and the page itself beside them.
// Main task: share the page in a message or across a table; Edit page is the one way into the editor.
// Leaves out: the blocks, the look and sharing settings, which Edit page opens; and the figures (phase 3).
import type { DataLayer } from '@crm/data';
import { Badge, Button, ButtonLink, Card, Field, QrCode } from '@crm/ui';
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
}

/** Share online and Share in person, or the private page's one way out of being private. */
export function LinkPageOverview({ data, slug, handle, address, isPublic, onPublic }: LinkPageOverviewProps) {
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
        actions={<Badge text={homeStrings.private} dot="gray" />}
      >
        <PrivatePage data={data} slug={slug} address={address} onPublic={onPublic} />
      </Card>
    );
  }
  return (
    <>
      <Card
        title={strings.shareOnline}
        description={strings.promise}
        footerNote={strings.pasteItAnywhere}
        footer={
          <ButtonLink href={address} isExternal icon="arrow-up-right">
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
      </Card>
      <Card
        title={strings.shareInPerson}
        description={strings.scanIt}
        footer={
          <>
            <Button icon="download" isPending={isSaving} onPress={download}>
              {strings.downloadCode}
            </Button>
            {wallet !== undefined && (
              <ButtonLink href={wallet} isExternal icon="wallet">
                {homeStrings.addToWallet}
              </ButtonLink>
            )}
          </>
        }
      >
        <QrCode ref={codeRef} value={address} label={shareStrings.qrLabel} size="sm">
          <p>
            <strong>{shown}</strong>
          </p>
        </QrCode>
      </Card>
    </>
  );
}
