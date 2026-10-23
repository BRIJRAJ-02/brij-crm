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
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { entrySentence, whoOf, type HistoryFormat } from './history-lines.ts';
import { strings } from './history-strings.ts';

/** When, Who, then Change: the row header, so a row is named by its sentence (AC-4604). */
const COLUMNS: readonly TableColumn[] = [
  { id: 'when', label: strings.when },
  { id: 'who', label: strings.who, isInline: true },
  { id: 'change', label: strings.change, isRowHeader: true, size: 'fill' },
];

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

  if (state.status === 'forbidden') {
    // The reader lost `audit.read` while here (AC-4618): the permission's own sentence, in place of the table.
    return <EmptyState tone="locked" title={strings.forbidden} />;
  }
  if (state.status === 'failed') {
    return (
      <EmptyState tone="error" title={strings.failedTitle} onRetry={log.retry}>
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
        isScrollable
        isLoading={state.status === 'loading'}
        emptyState={
          <EmptyState icon="clock" title={strings.emptyTitle}>
            {strings.emptyText}
          </EmptyState>
        }
      />
      {state.status === 'more-failed' ? (
        // The rows stay; only the next page failed.
        <EmptyState layout="row" tone="error" title={strings.failedMore} onRetry={log.retry}>
          {state.message}
        </EmptyState>
      ) : (
        state.hasMore && (
          <Button onPress={log.more} isPending={state.status === 'more'}>
            {strings.showMore}
          </Button>
        )
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
    <Table
      label={strings.table}
      columns={COLUMNS}
      rows={[]}
      getRowId={() => ''}
      renderCell={() => null}
      isScrollable
      isLoading
    />
  );
}
