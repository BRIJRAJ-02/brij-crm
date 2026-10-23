import type { ReactNode } from 'react';
import styles from './LegalPage.module.css';

/** Props for LegalPage. */
export interface LegalPageProps {
  readonly title: string;
  /** When the text last changed, as written on the page ("15 August 2026"). */
  readonly updated: string;
  readonly children: ReactNode;
}

/** A legal page's column: its title, when it last changed, then its sections at a reading measure. */
export function LegalPage({ title, updated, children }: LegalPageProps) {
  return (
    <main className={styles.root}>
      <article className={styles.article}>
        <header className={styles.header}>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.updated}>Last updated {updated}</p>
        </header>
        {children}
      </article>
    </main>
  );
}

/** A section's heading inside a LegalPage. */
export function LegalHeading({ children }: { readonly children: ReactNode }) {
  return <h2 className={styles.heading}>{children}</h2>;
}

/** A paragraph inside a LegalPage. */
export function LegalParagraph({ children }: { readonly children: ReactNode }) {
  return <p className={styles.paragraph}>{children}</p>;
}

/** A bulleted list inside a LegalPage; its children are `li` elements. */
export function LegalList({ children }: { readonly children: ReactNode }) {
  return <ul className={styles.list}>{children}</ul>;
}
