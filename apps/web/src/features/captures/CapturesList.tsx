// Brief
// Purpose: the one shape both Captures tabs draw (Links' booking pages, Forms' forms), so they read as one kind of thing.
// Main task: a grid of link cards across the whole view, each opening its editor, with Copy link, Open and the menu in its footer; the search and New at the end of the tabs strip; or, with none, the empty state centred in the view.
// Leaves out: what a card says and does (each tab builds its cards), and the tabs header (the Captures layout).
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
  /** New booking page, New form; left out without the permission to make one. */
  readonly newAction?: ReactNode;
  /** With no cards: the empty state's words and icon. */
  readonly empty: { readonly title: string; readonly text: string; readonly icon: IconName };
  /** A list that didn't load: its title, and Try again. */
  readonly errorTitle: string;
  readonly onRetry: () => void;
  /** The tab's dialogs (New, Delete), drawn in every state. */
  readonly dialogs?: ReactNode;
}

/**
 * A Captures tab's list: LinkGrid's cards across the whole view under the strip (the grid carries the page's
 * gutter itself), its search and New at the strip's end; or the empty state centred in the view.
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
  if (status === 'ready' && cards.length === 0) {
    return (
      <PageColumn align="center">
        <EmptyState title={empty.title} icon={empty.icon} {...(newAction === undefined ? {} : { actions: newAction })}>
          {empty.text}
        </EmptyState>
        {dialogs}
      </PageColumn>
    );
  }
  const isBusy = status !== 'ready';
  return (
    <>
      {slot !== null &&
        createPortal(
          <LinkListToolbar
            searchLabel={searchLabel}
            query={query}
            onQueryChange={setQuery}
            size="sm"
            isSearchDisabled={isBusy}
            // New stays while the rows load, so the strip keeps its shape when they land.
            {...(newAction === undefined ? {} : { actions: newAction })}
          />,
          slot,
        )}
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
