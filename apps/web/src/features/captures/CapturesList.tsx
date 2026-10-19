// Brief
// Purpose: the one shape both Captures tabs draw (Links' booking pages, Forms' forms), so they read as one kind of thing.
// Main task: a search and New above the rows across the view; or, with none, the empty state centred in the view.
// Leaves out: what a row says and does (each tab builds its rows), and the tabs header (the Captures layout).
import { EmptyState, LinkList, PageColumn, type IconName, type LinkRow } from '@crm/ui';
import type { ReactNode } from 'react';

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

/** A Captures tab's list: search and New, then full width rows; or the empty state centred in the view. */
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
  return (
    <PageColumn width="full">
      <LinkList
        label={label}
        searchLabel={searchLabel}
        rows={rows}
        onOpen={onOpen}
        status={status}
        errorTitle={errorTitle}
        onRetry={onRetry}
        {...(newAction === undefined ? {} : { actions: newAction })}
      />
      {dialogs}
    </PageColumn>
  );
}
