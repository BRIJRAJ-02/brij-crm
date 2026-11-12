import type { ReactNode } from 'react';
import { SearchX } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Button } from '../Button/Button.tsx';
import './EmptyState.css';

/** Props for EmptyState. */
export interface EmptyStateProps {
  /** A Lucide icon at 20px, drawn in a raised round well. */
  readonly icon: ReactNode;
  /** What will appear here ("No bookings yet"). */
  readonly title: string;
  /** One sentence on how it fills or why it helps. */
  readonly description?: ReactNode;
  /** The one action that fills it (a primary Button), or Clear filters. */
  readonly action?: ReactNode;
  /** `sm` for a panel or a card; `md` for a page or a table. */
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/** What a list, table or panel shows when it has nothing yet: an icon well, a title, one sentence and one action. The lines reveal in a 40ms stagger (12px rise, 500ms). */
export function EmptyState({ icon, title, description, action, size = 'md', className }: EmptyStateProps) {
  return (
    <div className={cx('tf-empty', `tf-empty--${size}`, className)}>
      <span className="tf-empty__well tf-empty__line" aria-hidden="true">{icon}</span>
      <h3 className="tf-empty__title tf-empty__line">{title}</h3>
      {description !== undefined && <p className="tf-empty__desc tf-empty__line">{description}</p>}
      {action !== undefined && <div className="tf-empty__actions tf-empty__line">{action}</div>}
    </div>
  );
}

/** Props for NoResults. */
export interface NoResultsProps {
  /** What was searched; leave it off when filters alone emptied the list. */
  readonly query?: string;
  /** The plural thing being listed ("companies"). */
  readonly noun?: string;
  readonly onClearFilters: () => void;
  readonly size?: 'sm' | 'md';
}

/** The empty state of a search or filter that matched nothing, with Clear filters as its one action. */
export function NoResults({ query, noun = 'records', onClearFilters, size }: NoResultsProps) {
  return (
    <EmptyState size={size} icon={<SearchX size={20} strokeWidth={1.75} />}
      title={query ? `No ${noun} match “${query}”` : `No ${noun} match these filters`}
      description="Try another word, or clear the filters to see everything."
      action={<Button variant="secondary" onPress={onClearFilters}>Clear filters</Button>} />
  );
}
