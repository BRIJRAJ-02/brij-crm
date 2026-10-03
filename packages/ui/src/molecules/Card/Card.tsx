import type { ReactNode } from 'react';
import styles from './Card.module.css';

interface CardBase {
  /** A line under the title. */
  readonly description?: string;
  readonly children?: ReactNode;
  /** Buttons, or a status, at the end of the header. */
  readonly actions?: ReactNode;
  /** A footer under a hairline: a settings card's Save, a tile's link. */
  readonly footer?: ReactNode;
  /** `default` on the raised surface; `sunken` for a quieter group inside a page. */
  readonly tone?: 'default' | 'sunken';
  /** While a Skeleton stands in for its content: marks the card busy, so assistive tech waits for it. */
  readonly isBusy?: boolean;
}

/**
 * Props for Card. `placement="page"` is a page of its own outside the app
 * shell (the status page, not found, and later AuthLayout): a narrow centred
 * card that is the page's `main`, so it always has a title, its `h1`.
 * `inline` (the default) fills its slot, with an `h3`.
 */
export type CardProps = CardBase &
  (
    | { readonly placement?: 'inline'; /** Its heading. */ readonly title?: string }
    | { readonly placement: 'page'; /** Its heading, the page's `h1`. */ readonly title: string }
  );

/** A framed group with a header: a settings section, a dashboard tile, a template. Use it to group, not to decorate. */
export function Card({
  title,
  description,
  children,
  actions,
  footer,
  tone = 'default',
  placement = 'inline',
  isBusy = false,
}: CardProps) {
  const Root = placement === 'page' ? 'main' : 'section';
  const Title = placement === 'page' ? 'h1' : 'h3';
  return (
    <Root className={styles.root} data-tone={tone} data-placement={placement} aria-busy={isBusy || undefined}>
      {(title !== undefined || actions !== undefined) && (
        <header className={styles.head}>
          <span className={styles.heading}>
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
          {actions !== undefined && <span className={styles.actions}>{actions}</span>}
        </header>
      )}
      {children !== undefined && <div className={styles.body}>{children}</div>}
      {footer !== undefined && <footer className={styles.foot}>{footer}</footer>}
    </Root>
  );
}
