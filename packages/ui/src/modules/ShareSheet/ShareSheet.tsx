import type { ReactNode } from 'react';
import { Button, ButtonGroup } from '../../atoms/Button/Button.tsx';
import { downloadQr, type QrFileKind } from '../../atoms/QrCode/qr-file.ts';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { useToasts } from '../../provider/context.ts';
import { ReadyPanel, type ReadyPanelQrStyle } from '../ReadyPanel/ReadyPanel.tsx';
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
  /**
   * The code in a saved style (spec 0061, AC-6124: the link page's colour, centre picture and frame label), on screen
   * and in the saved PNG or SVG (spec 0074, AC-7403). Left out, the plain code.
   */
  readonly qrStyle?: ReadyPanelQrStyle;
}

/** Props for ShareColumn: ShareSheet's ways to share, without its dialog. */
export interface ShareColumnProps {
  /** The public address, scheme and all; it passes `shareableUrl` before anything is drawn (AC-7318). */
  readonly url: string;
  /** What is shared: the email's subject, the device share sheet's title, the QR code's name and its file's. */
  readonly name: string;
  /** Words before the link in Email and WhatsApp. */
  readonly invite?: string;
  /** Where "Put it on your site" goes; left out, the row isn't drawn. */
  readonly embedHref?: string;
  /** Called as "Put it on your site" is followed (the sheet closes itself). */
  readonly onEmbed?: () => void;
  /** This thing's own ways, as Buttons, in one row. */
  readonly extra?: ReactNode;
  /** The code in a saved style (spec 0074, AC-7403). */
  readonly qrStyle?: ReadyPanelQrStyle;
}

/**
 * ShareSheet's column on a page of its own (spec 0074, AC-7402): a Share tab (a form's, a booking page's) draws the
 * same ways to share as the sheet, in its card, so the two can never drift. The same address gate, the same
 * download (PNG or SVG through `downloadQr`, a toast if the browser refuses), the same words.
 */
export function ShareColumn({ url, name, invite, embedHref, onEmbed, extra, qrStyle }: ShareColumnProps) {
  const toasts = useToasts();
  const link = shareableUrl(url);
  if (link === undefined) return <Callout tone="danger">{strings.refused}</Callout>;
  const saveQr = (kind: QrFileKind, code: SVGSVGElement) =>
    downloadQr(code, name, kind).catch(() => {
      toasts.toast({ tone: 'danger', message: strings.qrSaveFailed });
    });
  return (
    <ReadyPanel
      variant="share"
      link={link}
      shareTitle={name}
      qrLabel={strings.qrLabel(name)}
      onDownloadQr={saveQr}
      {...(invite === undefined ? {} : { invite })}
      {...(qrStyle === undefined ? {} : { qrStyle })}
      {...(embedHref === undefined
        ? {}
        : {
            onward: {
              label: strings.putOnSite,
              href: embedHref,
              icon: 'code',
              ...(onEmbed === undefined ? {} : { onPress: onEmbed }),
            },
          })}
    >
      {extra === undefined ? undefined : (
        <ButtonGroup label={strings.moreWays} layout="row">
          {extra}
        </ButtonGroup>
      )}
    </ReadyPanel>
  );
}

/**
 * The one share dialog (spec 0073, batch 2): every Share button opens it, and so does a first publish. The QR code
 * and the link with Copy link (the one primary), one row of Email, WhatsApp and More (the device's share sheet,
 * where there is one), Download (PNG or SVG) under the code, "Put it on your site" where the thing embeds, the
 * thing's own ways, and a quiet footer line beside Done. It draws ShareColumn (ReadyPanel's `share` column) inside a
 * Modal, so a share looks the same everywhere, and it makes no request: the caller passes the address it already has.
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
  qrStyle,
}: ShareSheetProps) {
  const isShareable = shareableUrl(url) !== undefined;
  return (
    <Modal
      title={title}
      variant="form"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      {...(description === undefined ? {} : { description })}
      {...(footer === undefined || !isShareable ? {} : { hint: footer })}
      actions={
        // Copy link is the sheet's one primary; Done only closes it. Focus starts on Done, so Enter and Esc both
        // close the sheet, and the sheet is said with its name (the forms' live dialog, which this replaces).
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        <Button slot="close" autoFocus>
          {strings.done}
        </Button>
      }
    >
      <ShareColumn
        url={url}
        name={name}
        onEmbed={() => {
          onOpenChange(false);
        }}
        {...(invite === undefined ? {} : { invite })}
        {...(embedHref === undefined ? {} : { embedHref })}
        {...(extra === undefined ? {} : { extra })}
        {...(qrStyle === undefined ? {} : { qrStyle })}
      />
    </Modal>
  );
}
