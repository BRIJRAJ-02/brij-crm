// Brief
// Purpose: History › Workspace changes (spec 0046): every audited change in this workspace, for owners and admins, one plain sentence a row.
// Main task: scan who changed what and when, newest first, and read further back with Show more.
// Leaves out: filters and a row's details panel (milestone 2), a member's own display preferences, IP addresses and request ids.
import type { AuditEntryView, AuditLog } from '@crm/data';
import {
  Badge,
  Button,
  EmptyState,
  formatDay,
  memoIntl,
  RelativeTime,
  Table,
  useFormatSettings,
  VisuallyHidden,
  type TableColumn,
} from '@crm/ui';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { entrySentence, whoOf, type HistoryFormat } from './history-lines.ts';
import { strings } from './history-strings.ts';

/**
 * Who, Change, then When, as Background jobs and Submissions run. Change is the row header, so a row is named by its
 * sentence (AC-4604), and it takes the room left and wraps, so the table fits a phone without scrolling sideways;
 * When keeps to its widest time.
 */
const COLUMNS: readonly TableColumn[] = [
  { id: 'who', label: strings.who, isInline: true },
  { id: 'change', label: strings.change, isRowHeader: true, size: 'fill' },
  { id: 'when', label: strings.when, size: 'fit' },
];

/** The table, to take focus back when the button that held it goes (the last page came, or the first one is read again). */
const changesTable = () =>
  document.querySelector<HTMLElement>(`[role="grid"][aria-label=${JSON.stringify(strings.table)}]`);

/** Props for Workspace changes. */
export interface WorkspaceChangesTabProps {
  /** The log the route's loader opened; held while the tab shows it, and let go when it leaves. */
  readonly log: AuditLog;
}

/** Workspace changes: the table and its states (AC-4603 to AC-4607, AC-4615 to AC-4618). */
export function WorkspaceChangesTab({ log }: WorkspaceChangesTabProps) {
  useEffect(() => log.retain(), [log]);
  const state = useSyncExternalStore(log.subscribe, log.getSnapshot, log.getSnapshot);
  const format = useHistoryFormat();
  // Set when one of this tab's buttons is pressed. If that button then goes (the last page came, or a failed
  // first page is read again) and focus fell to the page, it goes to the table instead of being lost.
  const pressed = useRef(false);
  useEffect(() => {
    if (!pressed.current || state.status === 'loading' || state.status === 'more') return;
    pressed.current = false;
    const focused = document.activeElement;
    if (focused === null || focused === document.body) changesTable()?.focus();
  }, [state.status, state.hasMore]);
  const press = (action: () => void) => () => {
    pressed.current = true;
    action();
  };

  if (state.status === 'forbidden') {
    // The reader lost `audit.read` while here (AC-4618): the permission's own sentence, in place of the table.
    return <EmptyState tone="locked" title={strings.forbidden} />;
  }
  if (state.status === 'failed') {
    return (
      <EmptyState tone="error" title={strings.failedTitle} onRetry={press(log.retry)}>
        {state.message}
      </EmptyState>
    );
  }

  const renderCell = (entry: AuditEntryView, column: string) => {
    if (column === 'when') return <RelativeTime value={entry.at} />;
    if (column === 'who') {
      const who = whoOf(entry.actor);
      return (
        <>
          {who.name}
          {who.badge !== undefined && <Badge text={who.badge} />}
        </>
      );
    }
    const sentence = entrySentence(entry, format);
    // Read aloud as the whole sentence, actor first; shown from the word after the actor, since Who says it.
    return (
      <>
        <VisuallyHidden>{sentence.full}</VisuallyHidden>
        <span aria-hidden="true">{sentence.change}</span>
      </>
    );
  };

  return (
    <>
      <Table
        label={strings.table}
        columns={COLUMNS}
        rows={state.entries}
        getRowId={(entry) => entry.id}
        renderCell={renderCell}
        isLoading={state.status === 'loading'}
        emptyState={
          <EmptyState icon="clock" title={strings.emptyTitle}>
            {strings.emptyText}
          </EmptyState>
        }
      />
      {state.status === 'more-failed' && (
        // The rows stay; only the next page failed. The one button below turns into Try again, so focus stays on it.
        <EmptyState layout="row" tone="error" title={strings.failedMore}>
          {state.message}
        </EmptyState>
      )}
      {state.hasMore && (
        <Button
          onPress={press(state.status === 'more-failed' ? log.retry : log.more)}
          isPending={state.status === 'more'}
        >
          {state.status === 'more-failed' ? strings.tryAgain : strings.showMore}
        </Button>
      )}
    </>
  );
}

/** Dates as the reader reads them: their language, their zone, their date format (Preferences). */
function useHistoryFormat(): HistoryFormat {
  const { locale, timeZone, dateFormat } = useFormatSettings();
  return useMemo(() => {
    const time = memoIntl(
      `history-time:${locale}:${timeZone}`,
      () => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }),
    );
    return {
      day: (at) => formatDay(at, locale, timeZone, dateFormat),
      dayTime: (at) => `${formatDay(at, locale, timeZone, dateFormat)}, ${time.format(new Date(at))}`,
    };
  }, [locale, timeZone, dateFormat]);
}

/** Workspace changes while its route loads: the table's skeleton rows, in the loaded layout (AC-4615). */
export function WorkspaceChangesPending() {
  return (
    <Table label={strings.table} columns={COLUMNS} rows={[]} getRowId={() => ''} renderCell={() => null} isLoading />
  );
}
