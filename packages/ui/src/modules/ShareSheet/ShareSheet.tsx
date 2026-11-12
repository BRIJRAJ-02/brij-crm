import type { ReactNode } from 'react';
import { Button, ButtonGroup } from '../../atoms/Button/Button.tsx';
import { downloadQr, type QrFileKind } from '../../atoms/QrCode/qr-file.ts';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { useToasts } from '../../provider/context.ts';
import { ReadyPanel } from '../ReadyPanel/ReadyPanel.tsx';
import { shareableUrl } from './share-url.ts';
import { strings } from './strings.ts';

/** Props for ShareSheet. */
export interface ShareSheetProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** The heading and the dialog's name: "Share Discovery call", or after a first publish "Discovery call is live". */
  readonly title: string;
  /** One quiet line under the title, only where the title alone doesn't say what the link opens. */
  readonly description?: string;
  /**
   * The public address, scheme and all ("https://timefix.com/priya/discovery-call"). It passes `shareableUrl`
   * (`safeHref`, and only `http:` or `https:`) before anything is drawn, copied, shared or encoded; anything else
   * draws one line saying it can't be shared (spec 0073, AC-7318).
   */
  readonly url: string;
  /** What is shared: the email's subject, the device share sheet's title, the QR code's name and its file's. */
  readonly name: string;
  /** Words before the link in Email and WhatsApp ("Pick a time that suits you:"). */
  readonly invite?: string;
  /**
   * Where "Put it on your site" goes, for a thing that embeds (a form, a booking page, the link page, a menu): a
   * path in the app. Following it closes the sheet. Left out, the row isn't drawn.
   */
  readonly embedHref?: string;
  /** This thing's own ways, as Buttons (Offer specific times, One-time link, Add to link page), in one row. */
  readonly extra?: ReactNode;
  /** One quiet line at the foot, beside Done: "Answers go to People · Change". */
  readonly footer?: ReactNode;
}

/**
 * The one share dialog (spec 0073, batch 2): every Share button opens it, and so does a first publish. The QR code
 * and the link with Copy link (the one primary), one row of Email, WhatsApp and More (the device's share sheet,
 * where there is one), Download (PNG or SVG) under the code, "Put it on your site" where the thing embeds, the
 * thing's own ways, and a quiet footer line beside Done. It draws through ReadyPanel's `share` column inside a Modal,
 * so a share looks the same everywhere, and it makes no request: the caller passes the address it already has.
 */
export function ShareSheet({
  isOpen,
  onOpenChange,
  title,
  description,
  url,
  name,
  invite,
  embedHref,
  extra,
  footer,
}: ShareSheetProps) {
  const toasts = useToasts();
  const link = shareableUrl(url);
  const close = () => {
    onOpenChange(false);
  };
  const saveQr = (kind: QrFileKind, code: SVGSVGElement) =>
    downloadQr(code, name, kind).catch(() => {
      toasts.toast({ tone: 'danger', message: strings.qrSaveFailed });
    });
  return (
    <Modal
      title={title}
      variant="form"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      {...(description === undefined ? {} : { description })}
      {...(footer === undefined || link === undefined ? {} : { hint: footer })}
      actions={
        // Copy link is the sheet's one primary; Done only closes it. Focus starts on Done, so Enter and Esc both
        // close the sheet, and the sheet is said with its name (the forms' live dialog, which this replaces).
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        <Button slot="close" autoFocus>
          {strings.done}
        </Button>
      }
    >
      {link === undefined ? (
        <Callout tone="danger">{strings.refused}</Callout>
      ) : (
        <ReadyPanel
          variant="share"
          link={link}
          shareTitle={name}
          qrLabel={strings.qrLabel(name)}
          onDownloadQr={saveQr}
          {...(invite === undefined ? {} : { invite })}
          {...(embedHref === undefined
            ? {}
            : { onward: { label: strings.putOnSite, href: embedHref, icon: 'code', onPress: close } })}
        >
          {extra === undefined ? undefined : (
            <ButtonGroup label={strings.moreWays} layout="row">
              {extra}
            </ButtonGroup>
          )}
        </ReadyPanel>
      )}
    </Modal>
  );
}
