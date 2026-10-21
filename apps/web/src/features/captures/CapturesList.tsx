// Brief
// Purpose: the one shape Booking pages and Forms both draw, so they read as one kind of thing.
// Main task: a grid of link cards across the whole view, each opening its editor, with Copy link, Open and the menu in its footer; the search at the end of the bar under the TopBar; or, with none, the empty state centred in the view, with New.
// Leaves out: what a card says and does (each page builds its cards), and the TopBar and the bar (the page's layout).
import { EmptyState, LinkGrid, LinkListToolbar, PageColumn, type IconName, type LinkGridCard } from '@crm/ui';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useCapturesToolbarSlot } from './toolbarSlot.ts';

/** Props for CapturesList. */
export interface CapturesListProps {
  /** What the cards are ("Booking pages", "Forms"). */
  readonly label: string;
  /** The search field's name ("Search booking pages"). */
  readonly searchLabel: string;
  readonly status: 'loading' | 'error' | 'ready';
  readonly cards: readonly LinkGridCard[];
  /** With no cards: the empty state's New booking page or New form; left out without the permission to make one. */
  readonly newAction?: ReactNode;
  /** With no cards: the empty state's words and icon. */
  readonly empty: { readonly title: string; readonly text: string; readonly icon: IconName };
  /** A list that didn't load: its title, and Try again. */
  readonly errorTitle: string;
  readonly onRetry: () => void;
  /** The page's dialogs (New, Delete), drawn in every state. */
  readonly dialogs?: ReactNode;
}

/**
 * A list page's list: LinkGrid's cards across the whole view under the bar (the grid carries the page's gutter
 * itself), its search at the bar's end (New is the TopBar's); or the empty state centred in the view.
 */
export function CapturesList({
  label,
  searchLabel,
  status,
  cards,
  newAction,
  empty,
  errorTitle,
  onRetry,
  dialogs,
}: CapturesListProps) {
  const slot = useCapturesToolbarSlot();
  const [query, setQuery] = useState('');
  const isEmpty = status === 'ready' && cards.length === 0;
  // The search stands in the bar in every state, so the bar never empties: waiting while the list loads or failed,
  // and while there is nothing to search yet.
  const search =
    slot === null
      ? null
      : createPortal(
          <LinkListToolbar
            searchLabel={searchLabel}
            query={query}
            onQueryChange={setQuery}
            size="sm"
            isSearchDisabled={status !== 'ready' || isEmpty}
          />,
          slot,
        );
  if (isEmpty) {
    return (
      <PageColumn align="center">
        {search}
        <EmptyState title={empty.title} icon={empty.icon} {...(newAction === undefined ? {} : { actions: newAction })}>
          {empty.text}
        </EmptyState>
        {dialogs}
      </PageColumn>
    );
  }
  return (
    <>
      {search}
      <LinkGrid
        label={label}
        cards={cards}
        query={query}
        onQueryChange={setQuery}
        status={status}
        errorTitle={errorTitle}
        onRetry={onRetry}
      />
      {dialogs}
    </>
  );
}
