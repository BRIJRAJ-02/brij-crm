// Brief
// Purpose: the one shape both Captures tabs draw (Links' booking pages, Forms' forms), so they read as one kind of thing.
// Main task: one line rows edge to edge across the view, as the records area draws them, with the search and New at the end of the tabs strip; or, with none, the empty state centred in the view.
// Leaves out: what a row says and does (each tab builds its rows), and the tabs header (the Captures layout).
import { EmptyState, LinkList, LinkListToolbar, PageColumn, type IconName, type LinkRow } from '@crm/ui';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useCapturesToolbarSlot } from './toolbarSlot.ts';

/** Props for CapturesList. */
export interface CapturesListProps {
  /** What the rows are ("Booking pages", "Forms"). */
  readonly label: string;
  /** The search field's name ("Search booking pages"). */
  readonly searchLabel: string;
  readonly status: 'loading' | 'error' | 'ready';
  readonly rows: readonly LinkRow[];
  readonly onOpen: (id: string) => void;
  /** New booking page, New form; left out without the permission to make one. */
  readonly newAction?: ReactNode;
  /** With no rows: the empty state's words and icon. */
  readonly empty: { readonly title: string; readonly text: string; readonly icon: IconName };
  /** A list that didn't load: its title, and Try again. */
  readonly errorTitle: string;
  readonly onRetry: () => void;
  /** The tab's dialogs (New, Delete), drawn in every state. */
  readonly dialogs?: ReactNode;
}

/**
 * A Captures tab's list: LinkList's compact rows edge to edge under the strip (no PageColumn, whose gutter the
 * rows carry themselves), its search and New at the strip's end; or the empty state centred in the view.
 */
export function CapturesList({
  label,
  searchLabel,
  status,
  rows,
  onOpen,
  newAction,
  empty,
  errorTitle,
  onRetry,
  dialogs,
}: CapturesListProps) {
  const slot = useCapturesToolbarSlot();
  const [query, setQuery] = useState('');
  if (status === 'ready' && rows.length === 0) {
    return (
      <PageColumn width="full" align="center">
        <EmptyState title={empty.title} icon={empty.icon} {...(newAction === undefined ? {} : { actions: newAction })}>
          {empty.text}
        </EmptyState>
        {dialogs}
      </PageColumn>
    );
  }
  const isBusy = status !== 'ready';
  // A list that didn't load sits centred in the view, as the empty one does.
  const Frame = status === 'error' ? CentredColumn : Bare;
  return (
    <Frame>
      {slot !== null &&
        createPortal(
          <LinkListToolbar
            searchLabel={searchLabel}
            query={query}
            onQueryChange={setQuery}
            size="sm"
            isSearchDisabled={isBusy}
            {...(newAction === undefined || status === 'loading' ? {} : { actions: newAction })}
          />,
          slot,
        )}
      <LinkList
        query={query}
        onQueryChange={setQuery}
        isToolbarHidden={slot !== null}
        label={label}
        searchLabel={searchLabel}
        rows={rows}
        onOpen={onOpen}
        status={status}
        errorTitle={errorTitle}
        onRetry={onRetry}
        density="compact"
        {...(newAction === undefined ? {} : { actions: newAction })}
      />
      {dialogs}
    </Frame>
  );
}

/** The list itself needs no frame: compact rows carry the page's gutter. */
function Bare({ children }: { readonly children: ReactNode }) {
  return <>{children}</>;
}

/** A failed list's message, centred in the view like the empty state. */
function CentredColumn({ children }: { readonly children: ReactNode }) {
  return (
    <PageColumn width="full" align="center">
      {children}
    </PageColumn>
  );
}
