// A record at a glance (owner, 31 Oct): its few key facts on one quiet line
// under its name, in the record panel and on the record page's header.
import type { ReactNode } from 'react';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import styles from './RecordFacts.module.css';
import { strings } from './strings.ts';

/** One fact: what it is (said to screen readers) and its value, drawn by the screen. */
export interface RecordFact {
  readonly id: string;
  /** The attribute's name: "Job title", "Company". Heard before the value; never drawn. */
  readonly label: string;
  /** Its type's icon, muted before the value. Leave it out for a value that carries its own (a chip). */
  readonly icon?: IconName;
  /** The value through its field's one display (`AttributeDisplay`): a LinkChip for an email, a RecordChip. */
  readonly content: ReactNode;
}

/** Props for RecordFacts. */
export interface RecordFactsProps {
  /** What the line sums up, for screen readers ("About Ada Lovelace"). */
  readonly label: string;
  readonly facts: readonly RecordFact[];
  /** The record is still coming: two short skeletons hold the line. */
  readonly isLoading?: boolean;
}

/**
 * A record's key facts on one wrapping line: each a muted icon and its value,
 * space-12 apart. No facts draw nothing, so a sparse record never gets an
 * empty row.
 */
export function RecordFacts({ label, facts, isLoading = false }: RecordFactsProps) {
  if (isLoading) {
    return (
      <div className={styles.root} aria-busy="true">
        <span className={styles.fact}>
          <Skeleton width="short" />
        </span>
        <span className={styles.fact}>
          <Skeleton width="medium" />
        </span>
        <VisuallyHidden>{strings.loading}</VisuallyHidden>
      </div>
    );
  }
  if (facts.length === 0) return null;
  return (
    <ul className={styles.root} aria-label={label}>
      {facts.map((fact) => (
        <li key={fact.id} className={styles.fact}>
          {fact.icon !== undefined && <Icon name={fact.icon} size="sm" tone="muted" />}
          <VisuallyHidden>{fact.label}</VisuallyHidden>
          <span className={styles.value}>{fact.content}</span>
        </li>
      ))}
    </ul>
  );
}
