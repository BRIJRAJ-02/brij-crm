import type { ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { LoadStatus } from '../../lib/load-status.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import { LinkCard, LinkCardSkeleton, type LinkCardProps } from '../LinkCard/LinkCard.tsx';
import styles from './LinkGrid.module.css';
import { strings } from './strings.ts';

/** One card in the grid: a LinkCard's props and its id. */
export interface LinkGridCard extends LinkCardProps {
  readonly id: string;
}

/** Props for LinkGrid. */
export interface LinkGridProps {
  /** What the cards are ("Booking pages", "Forms"), read as the list's name. */
  readonly label: string;
  readonly cards: readonly LinkGridCard[];
  /** The search, held by the page (Captures draws it in its tab strip): narrows the cards by title and link. */
  readonly query?: string;
  /** Clear search, when nothing matches. */
  readonly onQueryChange?: (query: string) => void;
  /** `loading` draws skeleton cards after the loading delay; `error` the failure with Try again. */
  readonly status?: LoadStatus;
  /** For `error`: Try again. */
  readonly onRetry?: () => void;
  /** For `error`: the screen's own words ("Booking pages didn’t load"). */
  readonly errorTitle?: string;
  /** Shown with no cards at all: usually an EmptyState. */
  readonly emptyState?: ReactNode;
}

/** How many skeleton cards stand in while the grid loads. */
const SKELETON_CARDS = 6;

/** Whether a card matches the search, by title or link, ignoring case. */
function matches(card: LinkGridCard, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') return true;
  return card.title.toLocaleLowerCase().includes(needle) || card.address.toLocaleLowerCase().includes(needle);
}

/**
 * Links as a grid of cards (the owner's call, 20 October 2026, after Calendly's event types): Captures › Links'
 * booking pages and Captures › Forms' forms. The grid fills the view's width with as many columns as fit cards
 * at least size-column-wide wide, one on a phone, with the page's gutter round it. It draws the loading,
 * failed, no access, empty and nothing matches states.
 */
export function LinkGrid({
  label,
  cards,
  query = '',
  onQueryChange,
  status = 'ready',
  onRetry,
  errorTitle,
  emptyState,
}: LinkGridProps) {
  const showSkeleton = useDelayedLoading(status === 'loading');
  if (status === 'no-access') {
    return (
      <div className={styles.message}>
        <EmptyState tone="locked" title={strings.noAccess}>
          {strings.noAccessBody}
        </EmptyState>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className={styles.message}>
        <EmptyState tone="error" title={errorTitle ?? strings.failed} {...(onRetry === undefined ? {} : { onRetry })} />
      </div>
    );
  }
  if (status === 'loading') {
    return (
      <div className={styles.grid} aria-busy="true">
        {showSkeleton && Array.from({ length: SKELETON_CARDS }, (_, index) => <LinkCardSkeleton key={index} />)}
        <VisuallyHidden>{strings.loading(label)}</VisuallyHidden>
      </div>
    );
  }
  if (cards.length === 0) return <>{emptyState}</>;
  const shown = cards.filter((card) => matches(card, query));
  if (shown.length === 0) {
    return (
      <div className={styles.message}>
        <EmptyState
          icon="search"
          title={strings.noMatches(query.trim())}
          {...(onQueryChange === undefined
            ? {}
            : {
                actions: (
                  <Button
                    onPress={() => {
                      onQueryChange('');
                    }}
                  >
                    {strings.clearSearch}
                  </Button>
                ),
              })}
        >
          {strings.noMatchesBody}
        </EmptyState>
      </div>
    );
  }
  return (
    <ul className={styles.grid} aria-label={label}>
      {shown.map(({ id, ...card }) => (
        <li key={id} className={styles.item}>
          {/* On a page the grid's cards are its sections, under the TopBar's h1. */}
          <LinkCard titleLevel={2} {...card} />
        </li>
      ))}
    </ul>
  );
}
