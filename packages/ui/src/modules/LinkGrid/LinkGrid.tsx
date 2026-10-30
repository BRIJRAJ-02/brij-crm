import type { ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { LoadStatus } from '../../lib/load-status.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { SectionBar } from '../../molecules/SectionBar/SectionBar.tsx';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import { LinkCard, LinkCardSkeleton, type LinkCardProps } from '../LinkCard/LinkCard.tsx';
import styles from './LinkGrid.module.css';
import { strings } from './strings.ts';

/** One card in the grid: a LinkCard's props and its id. */
export interface LinkGridCard extends LinkCardProps {
  readonly id: string;
  /** The `groups` entry it sits under, when the grid is grouped. */
  readonly groupId?: string;
}

/** A titled group of cards (Captures › Links' Workspace and Members' pages): its id, heading and quiet line. */
export interface LinkGridGroup {
  readonly id: string;
  /** The group's heading, an h2. */
  readonly label: string;
  /** One quiet line after the heading. */
  readonly description?: string;
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
  /**
   * Draws the cards in these groups, in this order, each under its heading with its own grid; each card names its
   * group by `groupId`. A group the search empties is left out. Without it, one grid with no headings.
   */
  readonly groups?: readonly LinkGridGroup[];
}

/** How many skeleton cards stand in while the grid loads. */
const SKELETON_CARDS = 6;

/** Whether a card matches the search, by title or link, ignoring case. */
function matches(card: LinkGridCard, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') return true;
  return (
    card.title.toLocaleLowerCase().includes(needle) || (card.address?.toLocaleLowerCase().includes(needle) ?? false)
  );
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
  groups,
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
  if (groups !== undefined) {
    const known = new Set(groups.map((group) => group.id));
    const loose = shown.filter((card) => card.groupId === undefined || !known.has(card.groupId));
    return (
      <div className={styles.groups}>
        {groups.map((group) => {
          const inGroup = shown.filter((card) => card.groupId === group.id);
          if (inGroup.length === 0) return null;
          return (
            // Headed by its h2; the list inside carries the group's name.
            <section key={group.id} className={styles.group}>
              <div className={styles.groupBar}>
                <SectionBar
                  title={group.label}
                  {...(group.description === undefined ? {} : { description: group.description })}
                />
              </div>
              {/* Under the group's h2, each card's title is an h3. */}
              <CardList label={group.label} cards={inGroup} titleLevel={3} />
            </section>
          );
        })}
        {/* A card naming no group the grid knows still shows, after the groups, never lost. */}
        {loose.length > 0 && <CardList label={label} cards={loose} titleLevel={3} />}
      </div>
    );
  }
  // On a page the grid's cards are its sections, under the TopBar's h1.
  return <CardList label={label} cards={shown} titleLevel={2} />;
}

/** One grid of cards, as a list named `label`. */
function CardList({
  label,
  cards,
  titleLevel,
}: {
  readonly label: string;
  readonly cards: readonly LinkGridCard[];
  readonly titleLevel: 2 | 3;
}) {
  return (
    <ul className={styles.grid} aria-label={label}>
      {cards.map(({ id, groupId: _group, ...card }) => (
        <li key={id} className={styles.item}>
          <LinkCard titleLevel={titleLevel} {...card} />
        </li>
      ))}
    </ul>
  );
}
