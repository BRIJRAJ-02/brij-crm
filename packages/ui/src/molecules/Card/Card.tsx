import { createContext, useContext, type ReactNode } from 'react';
import { PageEdge } from '../../lib/page-edge.ts';
import styles from './Card.module.css';

/**
 * The level an inline card's title takes: 3 by default, under a page's h2;
 * 2 where the page's own title is the h1 above it (a settings page beside the
 * settings sidebar, spec 0026); one under a SettingsSection's heading (3, or 4
 * under a TopBar), so headings never skip a level or flatten.
 */
export const CardTitleLevel = createContext<2 | 3 | 4>(3);

interface CardBase {
  /** A line under the title. */
  readonly description?: string;
  /** A line above the title, in the header: where a flow stands (first run's Back and "Step 2 of 3"). */
  readonly eyebrow?: ReactNode;
  readonly children?: ReactNode;
  /** Buttons, or a status, at the end of the header. */
  readonly actions?: ReactNode;
  /** A footer under a hairline: a settings card's Save, a tile's link. */
  readonly footer?: ReactNode;
  /**
   * `default` on the raised surface; `sunken` for a quieter group inside a
   * page; `bare` with no frame at all (no hairline, corners, shadow or
   * surface), for a page card that a full screen layout already frames
   * (AuthLayout's split screen): its heading, body and states stay the card's.
   */
  readonly tone?: 'default' | 'sunken' | 'bare';
  /** While a Skeleton stands in for its content: marks the card busy, so assistive tech waits for it. */
  readonly isBusy?: boolean;
}

/**
 * How wide a page card is: `md` (the default) `size-page-card`, for a page
 * with a few lines to read (the status page); `sm` `size-panel`, for the
 * pages before the app whose task is one short form (sign in, the code).
 */
export type CardPageSize = 'sm' | 'md';

/**
 * Props for Card. `placement="page"` is a page of its own outside the app
 * shell (the status page, not found, and AuthLayout): a narrow centred
 * card that is the page's `main`, so it always has a title, its `h1`.
 * `inline` (the default) fills its slot, with an `h3`.
 */
export type CardProps = CardBase &
  (
    | {
        readonly placement?: 'inline';
        /** Its heading. */
        readonly title?: string;
        readonly size?: never;
        readonly preview?: never;
      }
    | {
        readonly placement: 'page';
        /** Its heading, the page's `h1`. */
        readonly title: string;
        /** How wide the page card is: `md` (the default) or `sm`. */
        readonly size?: CardPageSize;
        /**
         * A live preview beside the card's content, from `bp-page-compact` up
         * (first run's workspace sketch): the card widens to hold both, the
         * content keeps `size-panel`, and the preview fills the rest on
         * `surface-subtle`. Narrower, the preview is left out. It is
         * decoration: hidden from assistive technology, and inert.
         */
        readonly preview?: ReactNode;
      }
  );

/** A framed group with a header: a settings section, a dashboard tile, a template. Use it to group, not to decorate. */
export function Card({
  title,
  description,
  eyebrow,
  children,
  actions,
  footer,
  tone = 'default',
  placement = 'inline',
  size,
  preview,
  isBusy = false,
}: CardProps) {
  const level = useContext(CardTitleLevel);
  const Root = placement === 'page' ? 'main' : 'section';
  const Title = placement === 'page' ? 'h1' : level === 2 ? 'h2' : level === 4 ? 'h4' : 'h3';
  const content = (
    <>
      {(title !== undefined || actions !== undefined || eyebrow !== undefined) && (
        <header className={styles.head}>
          <span className={styles.heading}>
            {eyebrow !== undefined && <span className={styles.eyebrow}>{eyebrow}</span>}
            {title !== undefined &&
              (placement === 'page' ? (
                // The page's heading: the app moves focus here after a route
                // change, so it takes focus by script but never joins the tab order.
                <Title className={styles.title} tabIndex={-1}>
                  {title}
                </Title>
              ) : (
                <Title className={styles.title}>{title}</Title>
              ))}
            {description !== undefined && <span className={styles.description}>{description}</span>}
          </span>
          {actions !== undefined && (
            <span className={styles.actions}>
              {/* The actions' own type: their box takes the title's line height only to stand on it. */}
              <span className={styles.actionsType}>{actions}</span>
            </span>
          )}
        </header>
      )}
      {children !== undefined && (
        // A card frames its own content: a Table in it keeps to the card, never the page's edges.
        <div className={styles.body}>
          <PageEdge value={false}>{children}</PageEdge>
        </div>
      )}
      {footer !== undefined && <footer className={styles.foot}>{footer}</footer>}
    </>
  );
  return (
    <Root
      className={styles.root}
      data-tone={tone}
      data-placement={placement}
      data-size={placement === 'page' ? (size ?? 'md') : undefined}
      data-preview={preview === undefined ? undefined : ''}
      aria-busy={isBusy || undefined}
    >
      {preview === undefined ? (
        content
      ) : (
        <>
          <div className={styles.column}>{content}</div>
          <div className={styles.preview} aria-hidden="true" inert>
            {preview}
          </div>
        </>
      )}
    </Root>
  );
}
