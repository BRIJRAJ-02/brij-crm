// Brief
// Purpose: Settings › Workspace › History (spec 0046): every audited change in this workspace, for owners and admins, one plain sentence a row, a day at a time.
// Main task: scan who changed what and when, newest first, and read further back with Show more.
// Leaves out: filters and a row's details panel (milestone 2), each member's own sign ins (Sign in and security), IP addresses and request ids.
import type { AuditLog } from '@crm/data';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  formatDay,
  memoIntl,
  RelativeTime,
  SettingsSection,
  SettingsStack,
  Table,
  useFormatSettings,
  VisuallyHidden,
  type TableColumn,
} from '@crm/ui';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { byDay, collapseRuns, whoOf, type HistoryFormat, type HistoryRow } from './history-lines.ts';
import { strings } from './history-strings.ts';

/**
 * Who, Change, then When. Who fits its widest name, an avatar before it, and never wraps (critic A, 5 November
 * 2026: names broke over two lines); Change is the row header, so a row is named by its sentence (AC-4604), and
 * takes the room left and wraps; When keeps to its widest time.
 */
const COLUMNS: readonly TableColumn[] = [
  { id: 'who', label: strings.who, isInline: true, size: 'fit', phone: 'meta' },
  { id: 'change', label: strings.change, isRowHeader: true, size: 'fill', phone: 'title' },
  { id: 'when', label: strings.when, size: 'fit', phone: 'meta' },
];

/** A day's table's name: "Workspace changes, Today". */
const tableLabel = (day: string) => `${strings.table}, ${day}`;

/** The first day's table, to take focus back when the button that held it goes (the last page came, or a retry). */
const changesTable = () =>
  document.querySelector<HTMLElement>(`[role="grid"][aria-label^=${JSON.stringify(strings.table)}]`);

/** The reader's clock. */
const clock = () => new Date().toISOString();

/** Props for Workspace changes. */
export interface WorkspaceChangesTabProps {
  /** The log the route's loader opened; held while the page shows it, and let go when it leaves. */
  readonly log: AuditLog;
  /** The reader's clock, for Today and Yesterday; the tests pass a fixed one. */
  readonly now?: () => string;
}

/** Workspace changes: the days, their tables and their states (AC-4603 to AC-4607, AC-4615 to AC-4618). */
export function WorkspaceChangesTab({ log, now = clock }: WorkspaceChangesTabProps) {
  useEffect(() => log.retain(), [log]);
  const state = useSyncExternalStore(log.subscribe, log.getSnapshot, log.getSnapshot);
  const format = useHistoryFormat();
  // Set when one of this page's buttons is pressed. If that button then goes (the last page came, or a failed
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
  // The rows a day at a time, runs collapsed: worked out once per page of entries, not per render.
  const days = useMemo(
    () =>
      state.status === 'forbidden' || state.status === 'failed'
        ? []
        : byDay(collapseRuns(state.entries, format), format, now()),
    [state, format, now],
  );

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
  if (state.status === 'loading' && days.length === 0) return <WorkspaceChangesPending />;
  if (days.length === 0) return <EmptyState icon="clock" title={strings.emptyTitle} />;

  const renderCell = (row: HistoryRow, column: string) => {
    if (column === 'when') return <RelativeTime value={row.entry.at} />;
    if (column === 'who') {
      const who = whoOf(row.entry.actor);
      const id = row.entry.actor.kind === 'member' ? row.entry.actor.memberId : undefined;
      return (
        <>
          <Avatar name={who.name} size="xs" isDecorative {...(id === undefined ? {} : { id })} />
          {who.name}
          {who.badge !== undefined && <Badge text={who.badge} />}
        </>
      );
    }
    // Read aloud as the whole sentence, actor first; shown from the word after the actor, since Who says it.
    return (
      <>
        <VisuallyHidden>{row.sentence.full}</VisuallyHidden>
        <span aria-hidden="true">{row.sentence.change}</span>
      </>
    );
  };

  return (
    <SettingsStack>
      {days.map((day, index) => (
        <SettingsSection key={day.key} title={day.label}>
          <Table
            label={tableLabel(day.label)}
            columns={COLUMNS}
            rows={day.rows}
            getRowId={(row) => row.id}
            renderCell={renderCell}
            // The column labels head the first day alone; the days under it continue the same table.
            isHeaderHidden={index > 0}
            // On a phone each change is two lines, the sentence over who and when, never squeezed into a column.
            phoneLayout="rows"
          />
        </SettingsSection>
      ))}
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
    </SettingsStack>
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
    // en-CA writes a day as YYYY-MM-DD: the key days group by, in the reader's zone.
    const key = memoIntl(
      `history-day-key:${timeZone}`,
      () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }),
    );
    return {
      day: (at) => formatDay(at, locale, timeZone, dateFormat),
      dayTime: (at) => `${formatDay(at, locale, timeZone, dateFormat)}, ${time.format(new Date(at))}`,
      dayKey: (at) => key.format(new Date(at)),
    };
  }, [locale, timeZone, dateFormat]);
}

/** Workspace changes while its route loads: the table's skeleton rows, in the loaded layout (AC-4615). */
export function WorkspaceChangesPending() {
  return (
    <Table label={strings.table} columns={COLUMNS} rows={[]} getRowId={() => ''} renderCell={() => null} isLoading />
  );
}
