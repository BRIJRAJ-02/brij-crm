import { useId, useRef, useState, type ReactNode } from 'react';
import { Link as AriaLink } from 'react-aria-components';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { CopyButton } from '../../atoms/Button/CopyButton.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { QrCode, type QrCodeProps } from '../../atoms/QrCode/QrCode.tsx';
import { safeHref } from '../../lib/safe-href.ts';
import styles from './ReadyPanel.module.css';
import { strings } from './strings.ts';

/** Props for ReadyPanel. */
export interface ReadyPanelProps {
  /**
   * The one heading, what now exists: "Your booking page is ready". Left out inside a Modal whose own title says it,
   * so the dialog keeps one heading; the mark then sits beside `message`.
   */
  readonly title?: string;
  /** One short line under it, if it helps ("Anyone with the link can book"). */
  readonly message?: string;
  /** The public address: shown, copied, shared and drawn as the QR code. */
  readonly link: string;
  /** The link field's name for screen readers. */
  readonly linkLabel?: string;
  /** The QR code's name for screen readers. */
  readonly qrLabel?: string;
  /** A small live look at the visitor's page (a PreviewLayout phone or a mini frame); decoration for screen readers. */
  readonly preview?: ReactNode;
  /** The preview's name for screen readers. */
  readonly previewLabel?: string;
  /**
   * `actual` (the default) draws the preview at its own size. `shrunk` lays it out at twice the slot and draws it at
   * half (`scale-shrunk`) from its top, so a whole page's head (a booking page's name and title) fits the glimpse.
   */
  readonly previewScale?: 'actual' | 'shrunk';
  /**
   * Share. Left out, the panel uses the browser's share sheet when it has one and shows no Share where it doesn't;
   * pass it to share some other way (the link page's Share modal).
   */
  readonly onShare?: () => void;
  /** What the browser's share sheet titles the link with. Default: `title`, then the link. */
  readonly shareTitle?: string;
  /** More below the link and QR, one row: the three embed tiles after a form's first publish. */
  readonly children?: ReactNode;
  /** The panel's own buttons at the end, usually one "Done" (the panel can be dismissed in one action). */
  readonly actions?: ReactNode;
  /**
   * Copy's emphasis. `primary` (the default) when Copy is the one thing to do; `secondary` inside a Modal whose
   * footer already has the primary button (Done), so the dialog keeps one primary.
   */
  readonly copyVariant?: 'primary' | 'secondary';
  /**
   * `panel` (the default): the link under its label in a box, Copy and Share, and the QR code in its own band.
   * `share`: one narrow centred column, as a share dialog is drawn (Calendly's, Tally's): the QR code first, then
   * the address with Copy link beside it (the one primary), then one row of equal buttons, Email, WhatsApp, More
   * (the device's share sheet, where there is one) and QR code (download as PNG or SVG), then `onward` as a row. A
   * form's live dialog and its Share tab draw it (the owner, 5 November 2026).
   */
  readonly variant?: 'panel' | 'share';
  /**
   * `share`: saves the code as an image, handed the code's own SVG. While it runs the QR code button is busy; a
   * rejection is the caller's to say (a toast). Left out, the panel offers no download.
   */
  readonly onDownloadQr?: (kind: ReadyPanelQrKind, code: SVGSVGElement) => Promise<void>;
  /** `share`: one more place to go, a row with a chevron under the buttons ("Put it on your site"). */
  readonly onward?: ReadyPanelOnward;
  /**
   * `share`: words written before the link in Email and WhatsApp ("Pick a time that suits you:"), so the message
   * says what the link is for (ShareSheet's `invite`, spec 0073).
   */
  readonly invite?: string;
  /**
   * `share`: the code in a saved style (spec 0061, AC-6124: the module colour, a centre picture, a framed label), on
   * screen and in what Download saves (ShareSheet's `qrStyle`, spec 0074). Left out, the plain code.
   */
  readonly qrStyle?: ReadyPanelQrStyle;
  /**
   * `share`: the code's size. `sm` (the default) is a small code on its tile beside the ways; `lg` is `size-menu`
   * wide, under the ways at every width, for a code scanned from a screen across a table (the link page's Share,
   * spec 0074, AC-7427).
   */
  readonly qrSize?: ReadyPanelQrSize;
}

/** How big `share`'s code is drawn: small beside the ways, or large under them. */
export type ReadyPanelQrSize = 'sm' | 'lg';

/** A QR code's saved style, as QrCode draws it: the modules' colour, a centre picture and a frame's label. */
export type ReadyPanelQrStyle = Pick<QrCodeProps, 'colour' | 'picture' | 'frameLabel'>;

/** The two images the QR code saves as. */
export type ReadyPanelQrKind = 'png' | 'svg';

/** ReadyPanel's `onward` row: where it goes, and what it does on the way (close the dialog it sits in). */
export interface ReadyPanelOnward {
  readonly label: string;
  /** A path in the app (routed) or a link out. */
  readonly href: string;
  readonly icon?: IconName;
  readonly onPress?: () => void;
}

/**
 * The "done, here is your link" moment after something is created (spec 0058): a success mark and one heading,
 * the link in a read only field with Copy (a quick Copied tick) and Share beside it, the link's QR code and a
 * preview slot side by side, then anything more (`children`) and the panel's buttons (`actions`). Everything
 * shares one left edge and one right edge and the token spacing scale. It eases in on opacity and a small rise
 * (a fade alone under reduced motion). It makes no request: the caller passes the address it already has.
 */
export function ReadyPanel({
  title,
  message,
  link,
  linkLabel = strings.linkLabel,
  qrLabel = strings.qrLabel,
  preview,
  previewLabel = strings.preview,
  previewScale = 'actual',
  onShare,
  shareTitle,
  children,
  actions,
  copyVariant = 'primary',
  variant = 'panel',
  onDownloadQr,
  onward,
  invite,
  qrStyle,
  qrSize = 'sm',
}: ReadyPanelProps) {
  const isShare = variant === 'share';
  const titleId = useId();
  const linkId = useId();
  const linkRef = useRef<HTMLSpanElement>(null);
  const codeRef = useRef<SVGSVGElement>(null);
  const [saving, setSaving] = useState<ReadyPanelQrKind | undefined>(undefined);
  const download = (kind: ReadyPanelQrKind) => {
    const code = codeRef.current;
    if (code === null || onDownloadQr === undefined || saving !== undefined) return;
    setSaving(kind);
    onDownloadQr(kind, code)
      .catch(() => undefined)
      .finally(() => {
        setSaving(undefined);
      });
  };
  const onwardHref = onward === undefined ? undefined : safeHref(onward.href);
  const sendText = invite === undefined || invite.trim() === '' ? link : `${invite.trim()} ${link}`;
  const canShare = onShare !== undefined || (typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  const share = () => {
    if (onShare !== undefined) {
      onShare();
      return;
    }
    // A closed share sheet rejects; that is the person's choice, not a failure.
    navigator.share({ title: shareTitle ?? title ?? link, url: link }).catch(() => undefined);
  };
  // The address breaks at its last slash: the start (the host) and the end (the page) both stay in view, and only
  // the middle gives way to an ellipsis when the field is short.
  const cut = link.lastIndexOf('/', link.length - 2) + 1;
  const hasTail = cut > link.indexOf('//') + 2 && cut < link.length;
  const linkRow = (
    <div
      className={styles.link}
      role="group"
      {...(isShare ? { 'aria-label': linkLabel } : { 'aria-labelledby': linkId })}
      data-probe="edge row"
    >
      <span ref={linkRef} className={styles.address}>
        {hasTail ? (
          <>
            <span className={styles.addressStart}>{link.slice(0, cut)}</span>
            <span className={styles.addressEnd}>{link.slice(cut)}</span>
          </>
        ) : (
          <span className={styles.addressStart}>{link}</span>
        )}
      </span>
      <CopyButton
        value={link}
        label={strings.copyLink}
        announcement={strings.linkCopied}
        size="lg"
        variant={copyVariant}
        sourceRef={linkRef}
      />
      {!isShare && canShare && (
        <Button icon="share" size="lg" onPress={share}>
          {strings.share}
        </Button>
      )}
    </div>
  );
  return (
    <section
      className={styles.root}
      data-variant={variant}
      data-qr={isShare && qrSize === 'lg' ? 'lg' : undefined}
      {...(title === undefined ? {} : { 'aria-labelledby': titleId })}
    >
      {/* With neither a heading nor a line (a pill in a dialog whose title says it), there is no head to draw. */}
      {(title !== undefined || message !== undefined) && (
        <div className={styles.head} data-probe="edge" data-untitled={title === undefined || undefined}>
          <span className={styles.check} role="img" aria-label={strings.done}>
            <Icon name="check" size="sm" />
          </span>
          <div className={styles.titles}>
            {title !== undefined && (
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
            )}
            {message !== undefined && <p className={styles.message}>{message}</p>}
          </div>
        </div>
      )}
      {!isShare && (
        <span id={linkId} className={styles.linkLabel} data-probe="edge">
          {linkLabel}
        </span>
      )}
      {isShare ? (
        <div className={styles.body}>
          <div className={styles.main}>
            {linkRow}
            <div className={styles.ways} role="group" aria-label={strings.sendLink}>
              {/* The link row's height, so the card's controls are one size (the owner: "same size and shape"). */}
              <ButtonLink
                icon="mail"
                size="lg"
                href={`mailto:?subject=${encodeURIComponent(shareTitle ?? title ?? link)}&body=${encodeURIComponent(sendText)}`}
                isExternal
              >
                {strings.email}
              </ButtonLink>
              <ButtonLink
                icon="message-square"
                size="lg"
                href={`https://wa.me/?text=${encodeURIComponent(sendText)}`}
                isExternal
              >
                {strings.whatsapp}
              </ButtonLink>
              {canShare && (
                <Button icon="share" size="lg" onPress={share}>
                  {strings.more}
                </Button>
              )}
            </div>
          </div>
          {/* The code on a light tile of its own, its download right under it, so the code and its file are one thing. */}
          <div className={styles.code}>
            <div className={styles.tile} data-theme="light">
              <QrCode
                ref={codeRef}
                value={link}
                label={qrLabel}
                size={qrSize === 'lg' ? 'md' : 'sm'}
                ground="clear"
                {...qrStyle}
              />
            </div>
            {onDownloadQr !== undefined && (
              // The prototype's pair (spec 0074, AC-7428): each file in one press, under a line saying what it is for.
              <div className={styles.save}>
                <p className={styles.saveHint}>{strings.saveHint}</p>
                <div className={styles.saveButtons} role="group" aria-label={strings.downloadQr}>
                  <Button
                    icon="download"
                    size="sm"
                    variant="secondary"
                    label={strings.pngName}
                    isPending={saving === 'png'}
                    isDisabled={saving === 'svg'}
                    onPress={() => {
                      download('png');
                    }}
                  >
                    {strings.png}
                  </Button>
                  <Button
                    icon="download"
                    size="sm"
                    variant="ghost"
                    label={strings.svgName}
                    isPending={saving === 'svg'}
                    isDisabled={saving === 'png'}
                    onPress={() => {
                      download('svg');
                    }}
                  >
                    {strings.svg}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        linkRow
      )}
      {isShare && onward !== undefined && (
        <AriaLink
          className={styles.onward}
          {...(onwardHref === undefined ? {} : { href: onwardHref })}
          {...(onward.onPress === undefined ? {} : { onPress: onward.onPress })}
        >
          <Icon name={onward.icon ?? 'code'} size="sm" />
          <span className={styles.onwardLabel}>{onward.label}</span>
          <Icon name="chevron-right" size="sm" />
        </AriaLink>
      )}
      {!isShare && (
        <div className={styles.visual} data-probe="edge" data-alone={preview === undefined || undefined}>
          <div className={styles.qr}>
            <QrCode value={link} label={qrLabel} size="sm" />
          </div>
          {/* No line beside the code: a QR explains itself, and the owner asked for the telling off (1 November
            2026). */}
          {preview !== undefined && (
            <div className={styles.preview} role="group" aria-label={previewLabel} data-scale={previewScale}>
              {/* A glimpse to look at: nothing in it takes focus, a press or a scroll. */}
              <div className={styles.glimpse} inert>
                {preview}
              </div>
            </div>
          )}
        </div>
      )}
      {children !== undefined && (
        <div className={styles.more} data-probe="edge">
          {children}
        </div>
      )}
      {actions !== undefined && (
        <div className={styles.actions} data-probe="edge">
          {actions}
        </div>
      )}
    </section>
  );
}
