// Brief
// Purpose: the one shape both Captures tabs draw (Links' booking pages, Forms' forms), so they read as one kind of thing.
// Main task: a grid of link cards across the whole view, each opening its editor, with Copy link, Open and the menu in its footer; the search at the end of the tabs bar; or, with none, the empty state centred in the view, with New.
// Leaves out: what a card says and does (each tab builds its cards), and the tabs header (the Captures layout).
import {
  EmptyState,
  LinkGrid,
  LinkListToolbar,
  PageColumn,
  type IconName,
  type LinkGridCard,
  type LinkGridGroup,
} from '@crm/ui';
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
  /** The cards in titled groups (Links: the workspace's own links apart from members' pages); one grid without. */
  readonly groups?: readonly LinkGridGroup[];
  /** With no cards: the empty state's New booking page or New form; left out without the permission to make one. */
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
 * A Captures tab's list: LinkGrid's cards across the whole view under the bar (the grid carries the page's
 * gutter itself), its search at the bar's end (New is the TopBar's); or the empty state centred in the view.
 */
export function CapturesList({
  label,
  searchLabel,
  status,
  cards,
  groups,
  newAction,
  empty,
  errorTitle,
  onRetry,
  dialogs,
}: CapturesListProps) {
  const slot = useCapturesToolbarSlot();
  const [query, setQuery] = useState('');
  const isBusy = status !== 'ready';
  return (
    <>
      {status === 'ready' && cards.length === 0 ? (
        <PageColumn align="center">
          <EmptyState
            title={empty.title}
            icon={empty.icon}
            {...(newAction === undefined ? {} : { actions: newAction })}
          >
            {empty.text}
          </EmptyState>
        </PageColumn>
      ) : (
        <>
          {slot !== null &&
            createPortal(
              <LinkListToolbar
                searchLabel={searchLabel}
                query={query}
                onQueryChange={setQuery}
                size="sm"
                isSearchDisabled={isBusy}
              />,
              slot,
            )}
          <LinkGrid
            label={label}
            cards={cards}
            {...(groups === undefined ? {} : { groups })}
            query={query}
            onQueryChange={setQuery}
            status={status}
            errorTitle={errorTitle}
            onRetry={onRetry}
          />
        </>
      )}
      {/* In one place whichever way the list draws, so a confirm open over the last card (it leaves at once, and
          comes back on a refusal) keeps its state. */}
      {dialogs}
    </>
  );
}
