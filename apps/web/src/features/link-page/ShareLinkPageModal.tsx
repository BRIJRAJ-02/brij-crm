// Brief
// Purpose: the one Share modal for a person's link page (spec 0051, AC-5122; the owner's Share design, 25 October
// 2026): the QR code large enough to scan across a table, the address to copy, and the two ways to go on.
// Main task: hand the page to somebody standing in front of you, or save the code to print on a badge or a card.
// Leaves out: the figures footer (this month's views and clicks, "See all clicks"), which waits for the editor's
// own figures surface. Loaded with the chunk that opens it, so neither it nor the QR library is in the first load.
import { Button, ButtonLink, Field, Modal, QrCode } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { qrPng, saveFile } from './qr-png.ts';
import { shareStrings as strings } from './share-strings.ts';

/** Props for the Share modal. */
export interface ShareLinkPageModalProps {
  /** The page's whole address, scheme and all: what the code carries and the field copies. */
  readonly address: string;
  /** The person's handle, which names the saved file. */
  readonly handle: string;
  /** Kept mounted while it closes, so the Modal's own exit plays. */
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

/** Share your link page: the QR code, the address to copy, Download QR code and Open page. */
export function ShareLinkPageModal({ address, handle, isOpen, onClose }: ShareLinkPageModalProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const codeRef = useRef<SVGSVGElement>(null);
  const [isSaving, setSaving] = useState(false);
  const shown = address.replace(/^https?:\/\//, '');
  const download = () => {
    const svg = codeRef.current;
    if (svg === null || isSaving) return;
    setSaving(true);
    qrPng(svg)
      .then((png) => saveFile(png, `${handle}-link-page.png`))
      .catch(() => toasts.toast({ tone: 'danger', message: strings.downloadFailed }))
      .finally(() => setSaving(false));
  };
  return (
    <Modal
      title={strings.title}
      isOpen={isOpen}
      isBusy={isSaving}
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose();
      }}
      actions={
        <>
          <ButtonLink href={address} isExternal icon="external-link">
            {strings.open}
          </ButtonLink>
          <Button variant="primary" icon="download" isPending={isSaving} onPress={download}>
            {strings.download}
          </Button>
        </>
      }
    >
      <QrCode ref={codeRef} value={address} label={strings.qrLabel} size="fill" />
      <p>{strings.scan}</p>
      <Field label={strings.address} isLabelHidden variant="copy" icon="link" value={shown} copyLabel={strings.copy} />
    </Modal>
  );
}
