import type { ReactNode } from 'react';
import styles from './Card.module.css';

/** Props for Card. */
export interface CardProps {
  /** Its heading. */
  readonly title?: string;
  /** A line under the title. */
  readonly description?: string;
  readonly children?: ReactNode;
  /** Buttons at the end of the header. */
  readonly actions?: ReactNode;
  /** A footer under a hairline: a settings card's Save, a tile's link. */
  readonly footer?: ReactNode;
  /** `default` on the raised surface; `sunken` for a quieter group inside a page. */
  readonly tone?: 'default' | 'sunken';
}

/** A framed group with a header: a settings section, a dashboard tile, a template. Use it to group, not to decorate. */
export function Card({ title, description, children, actions, footer, tone = 'default' }: CardProps) {
  return (
    <section className={styles.root} data-tone={tone}>
      {(title !== undefined || actions !== undefined) && (
        <header className={styles.head}>
          <span className={styles.heading}>
            {title !== undefined && <h3 className={styles.title}>{title}</h3>}
            {description !== undefined && <span className={styles.description}>{description}</span>}
          </span>
          {actions !== undefined && <span className={styles.actions}>{actions}</span>}
        </header>
      )}
      {children !== undefined && <div className={styles.body}>{children}</div>}
      {footer !== undefined && <footer className={styles.foot}>{footer}</footer>}
    </section>
  );
}
