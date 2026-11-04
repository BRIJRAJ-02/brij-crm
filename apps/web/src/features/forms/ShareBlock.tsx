// Brief
// Purpose: the one way a form's link is shared, the same in the live dialog and on the Share tab (T44, b10, S4; the
//   owner, 5 November 2026, after Calendly's and Tally's share dialogs): ReadyPanel's `share` column, the QR code,
//   the link with Copy link, then one row of equal buttons: Email, WhatsApp, More and QR code (PNG or SVG).
// Main task: copy the link.
// Leaves out: embeds (the Share tab's second card, and the dialog's "Put it on your site" row), tracking links, and
//   any styling of the QR code (the link page's QR has its own style dialog).
import { ReadyPanel, type ReadyPanelOnward, type ReadyPanelQrKind } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { qrPng, qrSvg, saveFile } from '../link-page/qr-png.ts';
import { strings } from './strings.ts';

/** Props for ShareBlock. */
export interface ShareBlockProps {
  /** The form's name: the email's subject, the saved code's file name and the share sheet's title. */
  readonly name: string;
  /** The form's public address. */
  readonly link: string;
  /** One more place to go, as a row under the buttons: the dialog's "Put it on your site". */
  readonly onward?: ReadyPanelOnward;
}

/** A file name from the form's name: "lead-qualification-qr". */
function fileNameOf(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base === '' ? 'form' : base}-qr`;
}

/** The QR code first, the link with Copy link (the one primary), then Email, WhatsApp, More and QR code, equal. */
export function ShareBlock({ name, link, onward }: ShareBlockProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const download = (kind: ReadyPanelQrKind, code: SVGSVGElement) =>
    (kind === 'png' ? qrPng(code) : qrSvg(code)).then(
      (file) => {
        saveFile(file, `${fileNameOf(name)}.${kind}`);
      },
      () => {
        toasts.toast({ tone: 'danger', message: strings.qrDownloadFailed });
      },
    );
  return (
    <ReadyPanel
      variant="share"
      link={link}
      shareTitle={name}
      qrLabel={strings.qrLabel}
      onDownloadQr={download}
      {...(onward === undefined ? {} : { onward })}
    />
  );
}
