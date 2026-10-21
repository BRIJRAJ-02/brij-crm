// Brief
// Purpose: Account › Security › Recent activity (spec 0033, AC-898): what happened to this account lately.
// Main task: scan the last 90 days of sign ins and sign in changes, newest first, and read further back on demand.
// Leaves out: IP addresses (never shown), other people's activity, and anything older than 90 days.
import { isDataError, type ActivityPage, type DataLayer, type SecurityActivity } from '@crm/data';
import { Button, EmptyState, RelativeTime, SettingsSection, Table, type TableColumn } from '@crm/ui';
import { useState } from 'react';
import { strings } from './security-strings.ts';

const copy = strings.activity;

const COLUMNS: readonly TableColumn[] = [
  { id: 'what', label: copy.columns.what, isRowHeader: true },
  { id: 'device', label: copy.columns.device },
  { id: 'place', label: copy.columns.place },
  { id: 'when', label: copy.columns.when, align: 'end' },
];

/** What happened, in words: the kind, and for a sign in how. */
export function activityLine(event: SecurityActivity): string {
  const what = copy.kinds[event.kind];
  return event.kind === 'sign_in' && event.method !== undefined ? `${what} ${copy.methods[event.method]}` : what;
}

/** Roughly where, "Berlin, DE", or nothing. */
const placeOf = (event: SecurityActivity): string =>
  [event.city, event.country].filter((part): part is string => part !== undefined).join(', ');

/** Props for Recent activity. */
export interface RecentActivitySectionProps {
  readonly data: DataLayer;
  /** The first page, as the route's loader read it; undefined when that read failed. */
  readonly first: ActivityPage | undefined;
  /** Reads the page again (the route's loader), after a failure. */
  readonly onRetry: () => void;
}

/** Recent activity: a table of the account's security events, with Show more for older ones. */
export function RecentActivitySection({ data, first, onRetry }: RecentActivitySectionProps) {
  const [more, setMore] = useState<{ readonly items?: readonly SecurityActivity[]; readonly cursor?: string }>({});
  const [isLoading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const items = [...(first?.items ?? []), ...(more.items ?? [])];
  const cursor = more.items === undefined ? first?.nextCursor : more.cursor;

  const showMore = async () => {
    if (cursor === undefined) return;
    setLoading(true);
    setFailure(undefined);
    try {
      const page = await data.account.activity(cursor);
      setMore((was) => ({
        items: [...(was.items ?? []), ...page.items],
        ...(page.nextCursor === undefined ? {} : { cursor: page.nextCursor }),
      }));
    } catch (error) {
      setFailure(isDataError(error) ? error.message : copy.failedTitle);
    } finally {
      setLoading(false);
    }
  };

  const renderCell = (event: SecurityActivity, column: string) => {
    if (column === 'what') return activityLine(event);
    if (column === 'device') return event.deviceLabel ?? '';
    if (column === 'place') return placeOf(event);
    return <RelativeTime value={event.at} />;
  };

  return (
    <SettingsSection title={copy.section} description={copy.description}>
      {first === undefined ? (
        <EmptyState tone="error" title={copy.failedTitle} onRetry={onRetry} />
      ) : (
        <>
          <Table
            label={copy.section}
            columns={COLUMNS}
            rows={items}
            getRowId={(event) => event.id}
            renderCell={renderCell}
            emptyState={<EmptyState icon="shield-check" title={copy.empty} />}
          />
          {failure !== undefined && <EmptyState tone="error" title={failure} onRetry={() => void showMore()} />}
          {cursor !== undefined && failure === undefined && (
            <Button isPending={isLoading} onPress={() => void showMore()}>
              {copy.showMore}
            </Button>
          )}
        </>
      )}
    </SettingsSection>
  );
}
