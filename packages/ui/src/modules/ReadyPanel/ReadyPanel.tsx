import { useId, useRef, type ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { CopyButton } from '../../atoms/Button/CopyButton.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { QrCode } from '../../atoms/QrCode/QrCode.tsx';
import styles from './ReadyPanel.module.css';
import { strings } from './strings.ts';

/** Props for ReadyPanel. */
export interface ReadyPanelProps {
  /** The one heading, what now exists: "Your booking page is ready". */
  readonly title: string;
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
   * Share. Left out, the panel uses the browser's share sheet when it has one and shows no Share where it doesn't;
   * pass it to share some other way (the link page's Share modal).
   */
  readonly onShare?: () => void;
  /** What the browser's share sheet titles the link with. Default: `title`. */
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
  onShare,
  shareTitle,
  children,
  actions,
  copyVariant = 'primary',
}: ReadyPanelProps) {
  const titleId = useId();
  const linkId = useId();
  const linkRef = useRef<HTMLSpanElement>(null);
  const canShare = onShare !== undefined || (typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  const share = () => {
    if (onShare !== undefined) {
      onShare();
      return;
    }
    // A closed share sheet rejects; that is the person's choice, not a failure.
    navigator.share({ title: shareTitle ?? title, url: link }).catch(() => undefined);
  };
  return (
    <section className={styles.root} aria-labelledby={titleId}>
      <div className={styles.head} data-probe="edge">
        <span className={styles.check} role="img" aria-label={strings.done}>
          <Icon name="check" size="md" />
        </span>
        <div className={styles.titles}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {message !== undefined && <p className={styles.message}>{message}</p>}
        </div>
      </div>
      <span id={linkId} className={styles.linkLabel} data-probe="edge">
        {linkLabel}
      </span>
      <div className={styles.link} role="group" aria-labelledby={linkId} data-probe="edge row">
        <span ref={linkRef} className={styles.address}>
          {link}
        </span>
        <CopyButton
          value={link}
          label={strings.copyLink}
          announcement={strings.linkCopied}
          size="lg"
          variant={copyVariant}
          sourceRef={linkRef}
        />
        {canShare && (
          <Button icon="share" size="lg" onPress={share}>
            {strings.share}
          </Button>
        )}
      </div>
      <div className={styles.visual} data-probe="edge">
        <div className={styles.qr}>
          <QrCode value={link} label={qrLabel} size="sm" />
        </div>
        {preview !== undefined && (
          <div className={styles.preview} role="group" aria-label={previewLabel}>
            {preview}
          </div>
        )}
      </div>
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
