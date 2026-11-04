// Brief
// Purpose: the one way a form's link is shared, the same in the live dialog and on the Share tab (T44, b10, S4): the
//   link as a pill with Copy and Open, then a small row of ways to pass it on: the QR code (PNG or SVG), Email,
//   WhatsApp and the device's own share sheet.
// Main task: copy the link.
// Leaves out: embeds (the Share tab's second row, and "Put it on your site" in the dialog), tracking links, and any
//   styling of the QR code (the link page's QR has its own style dialog).
import { Button, ButtonGroup, ButtonLink, QrCode, ReadyPanel } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useRef, useState, type ReactNode } from 'react';
import { qrPng, qrSvg, saveFile } from '../link-page/qr-png.ts';
import { strings } from './strings.ts';

/** Props for ShareBlock. */
export interface ShareBlockProps {
  /** The form's name: the email's subject, the saved code's file name and the share sheet's title. */
  readonly name: string;
  /** The form's public address. */
  readonly link: string;
  /** More under the share row: the dialog's "Put it on your site". */
  readonly children?: ReactNode;
}

/** A file name from the form's name: "lead-qualification-qr". */
function fileNameOf(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base === '' ? 'form' : base}-qr`;
}

/**
 * The link as a pill with Copy (the one primary) and a quiet Open, and under it the QR code with its two downloads
 * beside the ways to send the link. ReadyPanel's `pill` and QrCode's column, as the link page's QR dialog draws them.
 */
export function ShareBlock({ name, link, children }: ShareBlockProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const codeRef = useRef<SVGSVGElement>(null);
  const [downloading, setDownloading] = useState<'png' | 'svg' | undefined>(undefined);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const download = (kind: 'png' | 'svg') => {
    const svg = codeRef.current;
    if (svg === null || downloading !== undefined) return;
    setDownloading(kind);
    (kind === 'png' ? qrPng(svg) : qrSvg(svg))
      .then((file) => {
        saveFile(file, `${fileNameOf(name)}.${kind}`);
      })
      .catch(() => toasts.toast({ tone: 'danger', message: strings.qrDownloadFailed }))
      .finally(() => {
        setDownloading(undefined);
      });
  };
  return (
    <ReadyPanel
      variant="pill"
      link={link}
      shareTitle={name}
      onOpen={() => {
        window.open(link, '_blank', 'noopener');
      }}
    >
      <QrCode ref={codeRef} value={link} label={strings.qrLabel} size="sm">
        <ButtonGroup label={strings.sendLink} layout="row">
          <ButtonLink
            icon="mail"
            href={`mailto:?subject=${encodeURIComponent(name)}&body=${encodeURIComponent(link)}`}
            isExternal
          >
            {strings.sendEmail}
          </ButtonLink>
          <ButtonLink icon="message-square" href={`https://wa.me/?text=${encodeURIComponent(link)}`} isExternal>
            {strings.sendWhatsapp}
          </ButtonLink>
          {canShare && (
            <Button
              icon="share"
              onPress={() => {
                // A closed share sheet rejects; that is the person's choice, not a failure.
                navigator.share({ title: name, url: link }).catch(() => undefined);
              }}
            >
              {strings.sendMore}
            </Button>
          )}
        </ButtonGroup>
        <ButtonGroup label={strings.qrDownload} layout="row">
          <Button
            icon="download"
            variant="ghost"
            isPending={downloading === 'png'}
            isDisabled={downloading === 'svg'}
            onPress={() => {
              download('png');
            }}
          >
            {strings.qrPng}
          </Button>
          <Button
            icon="download"
            variant="ghost"
            isPending={downloading === 'svg'}
            isDisabled={downloading === 'png'}
            onPress={() => {
              download('svg');
            }}
          >
            {strings.qrSvg}
          </Button>
        </ButtonGroup>
      </QrCode>
      {children}
    </ReadyPanel>
  );
}
