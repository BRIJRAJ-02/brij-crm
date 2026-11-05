// Brief
// Purpose: Account › Sign in and security › Recent activity (spec 0033, AC-898): what happened to this account lately, the one place each member's sign ins show (History's copy went on 5 November 2026).
// Main task: scan the latest sign ins and sign in changes, newest first, five at a time, and read further back on demand.
// Leaves out: IP addresses (never shown), other people's activity, and anything older than 90 days.
import { isDataError, type ActivityPage, type DataLayer, type SecurityActivity } from '@crm/data';
import { Button, Card, EmptyState, RelativeTime, SettingsRow, SettingsSection, Skeleton } from '@crm/ui';
import { Suspense, use, useDeferredValue, useState } from 'react';
import { devicePlace } from './security-lines.ts';
import { strings } from './security-strings.ts';

const copy = strings.activity;

/** What happened, in words: the kind, and for a sign in how. */
export function activityLine(event: SecurityActivity): string {
  const what = copy.kinds[event.kind];
  return event.kind === 'sign_in' && event.method !== undefined ? `${what} ${copy.methods[event.method]}` : what;
}

/** How many events show before "Show more" (critic A #12: a long list of one Mac's sign ins). */
const SHOWN = 5;

/** The section's heading. */
export interface RecentActivityHeading {
  /** The section's heading; "Recent activity". No line under it: the empty state says how far back it reads. */
  readonly title?: string;
}

/** Props for Recent activity. */
export interface RecentActivitySectionProps extends RecentActivityHeading {
  readonly data: DataLayer;
  /** The first page as the route's loader started it; undefined once read when that read failed. */
  readonly first: Promise<ActivityPage | undefined>;
  /** Reads the first page again (this route's loader alone), after a failure. */
  readonly onRetry: () => void;
}

/** Three loading rows in the list's card, while the first page arrives. */
function LoadingRows() {
  return (
    <Card isBusy>
      {[0, 1, 2].map((index) => (
        <SettingsRow key={index} title="" description={<Skeleton width="medium" />} />
      ))}
    </Card>
  );
}

/**
 * Recent activity while its page is still loading: the same heading and line as the loaded section, over the same
 * loading rows it shows itself. For a route's pending screen (History's "Your sign ins"), so nothing moves or
 * renames when the list arrives.
 */
export function RecentActivityPending({ title = copy.section }: RecentActivityHeading) {
  return (
    <SettingsSection title={title}>
      <LoadingRows />
    </SettingsSection>
  );
}

/**
 * Recent activity: its own loading rows while the first page arrives, then the table. A new first page (a retry, or
 * a read after a change on the page) keeps what shows until it arrives, marked busy, so the rows never flash away.
 */
export function RecentActivitySection({ data, first, onRetry, title = copy.section }: RecentActivitySectionProps) {
  // The page shown while a newer one is on its way: the first read has none, so it shows the loading rows.
  const shown = useDeferredValue(first);
  return (
    <SettingsSection title={title}>
      <Suspense fallback={<LoadingRows />}>
        <ActivityTable data={data} first={shown} onRetry={onRetry} isStale={shown !== first} />
      </Suspense>
    </SettingsSection>
  );
}

function ActivityTable({
  data,
  first,
  onRetry,
  isStale,
}: Pick<RecentActivitySectionProps, 'data' | 'first' | 'onRetry'> & { readonly isStale: boolean }) {
  // Always called, on every render, with the promise the loader made: never a new one made here.
  const page = use(first);
  if (page === undefined) {
    // While it reads again, screen readers hear that it is loading, not the failure.
    return (
      <EmptyState
        tone="error"
        title={isStale ? copy.loading : copy.failedTitle}
        onRetry={onRetry}
        isLoading={isStale}
      />
    );
  }
  // A new first page (a retry) starts the older pages over.
  return <ActivityRows key={page.items[0]?.id ?? 'none'} data={data} page={page} isStale={isStale} />;
}

function ActivityRows({
  data,
  page,
  isStale,
}: {
  readonly data: DataLayer;
  readonly page: ActivityPage;
  readonly isStale: boolean;
}) {
  const [more, setMore] = useState<{ readonly items: readonly SecurityActivity[]; readonly cursor?: string }>({
    items: [],
    ...(page.nextCursor === undefined ? {} : { cursor: page.nextCursor }),
  });
  const [isLoading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  // Five first; Show more shows the rest of what is read, then reads further back.
  const [isOpen, setOpen] = useState(false);
  const items = [...page.items, ...more.items];
  const shownItems = isOpen ? items : items.slice(0, SHOWN);
  const hasMore = (!isOpen && items.length > SHOWN) || more.cursor !== undefined;

  const showMore = async () => {
    if (!isOpen) {
      setOpen(true);
      return;
    }
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

  // One row per event, as the devices list them: what happened, then where from and when. A device or a place
  // the edge didn't know is left out rather than said as "Unknown".
  const eventRow = (event: SecurityActivity) => {
    const from = [event.deviceLabel ?? '', devicePlace(event) ?? ''].filter((part) => part.trim() !== '');
    return (
      <SettingsRow
        key={event.id}
        title={activityLine(event)}
        description={
          <>
            {from.length === 0 ? '' : `${from.join(', ')} · `}
            <RelativeTime value={event.at} />
          </>
        }
      />
    );
  };

  return (
    <>
      <Card isBusy={isStale}>
        {items.length === 0 ? <EmptyState icon="shield-check" title={copy.empty} /> : shownItems.map(eventRow)}
      </Card>
      {failure !== undefined && (
        <EmptyState tone="error" title={copy.failedMore} onRetry={() => void showMore()}>
          {failure}
        </EmptyState>
      )}
      {hasMore && failure === undefined && (
        <Button variant="ghost" isPending={isLoading} onPress={() => void showMore()}>
          {copy.showMore}
        </Button>
      )}
    </>
  );
}
