// Brief
// Purpose: Account › Security › Recent activity (spec 0033, AC-898): what happened to this account lately.
// Main task: scan the last 90 days of sign ins and sign in changes, newest first, and read further back on demand.
// Leaves out: IP addresses (never shown), other people's activity, and anything older than 90 days.
import { isDataError, type ActivityPage, type DataLayer, type SecurityActivity } from '@crm/data';
import { Button, EmptyState, RelativeTime, SettingsSection, Table, type TableColumn } from '@crm/ui';
import { Suspense, use, useState } from 'react';
import { deviceName, devicePlace } from './security-lines.ts';
import { strings } from './security-strings.ts';

const copy = strings.activity;

const COLUMNS: readonly TableColumn[] = [
  { id: 'what', label: copy.columns.what, isRowHeader: true },
  { id: 'device', label: copy.columns.device },
  { id: 'place', label: copy.columns.place },
  { id: 'when', label: copy.columns.when },
];

/** What happened, in words: the kind, and for a sign in how. */
export function activityLine(event: SecurityActivity): string {
  const what = copy.kinds[event.kind];
  return event.kind === 'sign_in' && event.method !== undefined ? `${what} ${copy.methods[event.method]}` : what;
}

/** Props for Recent activity. */
export interface RecentActivitySectionProps {
  readonly data: DataLayer;
  /** The first page as the route's loader started it; undefined once read when that read failed. */
  readonly first: Promise<ActivityPage | undefined>;
  /** Reads the first page again (this route's loader alone), after a failure. */
  readonly onRetry: () => void;
}

/** Recent activity: its own loading rows while the first page arrives, then the table. */
export function RecentActivitySection(props: RecentActivitySectionProps) {
  return (
    <SettingsSection title={copy.section} description={copy.description}>
      <Suspense
        fallback={
          <Table
            label={copy.section}
            columns={COLUMNS}
            rows={[]}
            getRowId={() => ''}
            renderCell={() => null}
            isLoading
          />
        }
      >
        <ActivityTable {...props} />
      </Suspense>
    </SettingsSection>
  );
}

function ActivityTable({ data, first, onRetry }: RecentActivitySectionProps) {
  const page = use(first);
  if (page === undefined) return <EmptyState tone="error" title={copy.failedTitle} onRetry={onRetry} />;
  // A new first page (a retry) starts the older pages over.
  return <ActivityRows key={page.items[0]?.id ?? 'none'} data={data} page={page} />;
}

function ActivityRows({ data, page }: { readonly data: DataLayer; readonly page: ActivityPage }) {
  const [more, setMore] = useState<{ readonly items: readonly SecurityActivity[]; readonly cursor?: string }>({
    items: [],
    ...(page.nextCursor === undefined ? {} : { cursor: page.nextCursor }),
  });
  const [isLoading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const items = [...page.items, ...more.items];

  const showMore = async () => {
    if (more.cursor === undefined) return;
    setLoading(true);
    setFailure(undefined);
    try {
      const next = await data.account.activity(more.cursor);
      setMore((was) => ({
        items: [...was.items, ...next.items],
        ...(next.nextCursor === undefined ? {} : { cursor: next.nextCursor }),
      }));
    } catch (error) {
      setFailure(isDataError(error) && error.code !== 'INTERNAL' ? error.message : '');
    } finally {
      setLoading(false);
    }
  };

  const renderCell = (event: SecurityActivity, column: string) => {
    if (column === 'what') return activityLine(event);
    if (column === 'device') return deviceName({ deviceLabel: event.deviceLabel ?? '' });
    if (column === 'place') return devicePlace(event) ?? strings.unknownPlace;
    return <RelativeTime value={event.at} />;
  };

  return (
    <>
      <Table
        label={copy.section}
        columns={COLUMNS}
        rows={items}
        getRowId={(event) => event.id}
        renderCell={renderCell}
        emptyState={<EmptyState icon="shield-check" title={copy.empty} />}
      />
      {failure !== undefined && (
        <EmptyState layout="row" tone="error" title={copy.failedMore} onRetry={() => void showMore()}>
          {failure}
        </EmptyState>
      )}
      {more.cursor !== undefined && failure === undefined && (
        <Button isPending={isLoading} onPress={() => void showMore()}>
          {copy.showMore}
        </Button>
      )}
    </>
  );
}
