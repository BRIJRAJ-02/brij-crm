// Brief
// Purpose: a booking page's own Bookings and Insights, as tabs of its editor (the bookings area, 5 November 2026), the
//   way a form's editor has Submissions and Analytics: what this page brought in, without leaving it.
// Main task: see this page's upcoming and past bookings, and how many came and booked over a period; go on to the full
//   Bookings list or Insights, filtered to this page, for anything more.
// Leaves out: acting on a booking (the Bookings list's drawer), the sessions table and sharing (Insights itself), and
//   live updates (a booking or a visit sends no change event here; each tab reads when it opens).
import { isDataError, type BookingView, type DataLayer, type InsightRange } from '@crm/data';
import { useInsightRead } from '@crm/data/react';
import {
  BookingList,
  ButtonLink,
  EmptyState,
  SectionBar,
  SegmentedControl,
  SettingsStack,
  Skeleton,
  Stats,
  useFormatSettings,
  type BookingListGroup,
  type BookingListRow,
} from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { InsightsBody } from '../insights/InsightsBody.tsx';
import { insightsHref } from '../insights/search.ts';
import { strings as insightStrings } from '../insights/strings.ts';
import { activityStrings as strings } from './activity-strings.ts';

/** The Bookings list (`/bookings/list`), filtered to one page. */
const pageBookingsHref = (slug: string, pageId: string, when: 'upcoming' | 'past') =>
  `/w/${slug}/bookings/list?link=${encodeURIComponent(pageId)}${when === 'past' ? '&tab=past' : ''}`;

/** Props for both tabs. */
export interface PageActivityProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly pageId: string;
}

/** What a read of the page's bookings stands at. */
type BookingsRead =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly items: readonly BookingView[] };

/**
 * The page's bookings: Upcoming (soonest first) or Past (latest first), at most 100 (the API's page), grouped by day
 * in the BookingList the Bookings tab draws; a row goes on to the Bookings list, filtered to this page.
 */
export function PageBookingsTab({ data, slug, pageId }: PageActivityProps) {
  const navigate = useNavigate();
  const { locale, timeZone } = useFormatSettings();
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const [attempt, setAttempt] = useState(0);
  // An answer is kept with the read it answers, so a new read shows loading without being set in the effect.
  const key = `${pageId}|${when}|${String(attempt)}`;
  const [answer, setAnswer] = useState<{ readonly key: string; readonly read: BookingsRead } | undefined>(undefined);
  const read = useMemo((): BookingsRead => (answer?.key === key ? answer.read : { status: 'loading' }), [answer, key]);
  useEffect(() => {
    let isCurrent = true;
    data.bookings.list(slug, pageId, when).then(
      (items) => {
        if (isCurrent) setAnswer({ key, read: { status: 'ready', items } });
      },
      (error: unknown) => {
        if (isCurrent) {
          setAnswer({
            key,
            read: { status: 'error', message: isDataError(error) ? error.message : strings.bookingsFailed },
          });
        }
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, pageId, when, key]);
  const groups = useMemo((): readonly BookingListGroup[] => {
    if (read.status !== 'ready') return [];
    const day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone });
    const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
    const byDay = new Map<string, BookingListRow[]>();
    for (const booking of read.items) {
      const start = new Date(booking.startsAt);
      const label = day.format(start);
      const rows = byDay.get(label) ?? [];
      rows.push({
        id: booking.id,
        date: label,
        time: `${time.format(start)} – ${time.format(new Date(booking.endsAt))}`,
        title: booking.visitorName,
        note: booking.visitorEmail,
        ...(booking.status === 'cancelled' ? { badge: strings.cancelled, badgeTone: 'neutral' as const } : {}),
      });
      byDay.set(label, rows);
    }
    return [...byDay].map(([label, rows]) => ({ id: label, label, rows }));
  }, [read, locale, timeZone]);
  return (
    <SettingsStack>
      <SectionBar
        start={
          <SegmentedControl
            label={strings.when}
            size="compact"
            segments={[
              { value: 'upcoming', label: strings.upcoming },
              { value: 'past', label: strings.past },
            ]}
            value={when}
            onChange={(value) => {
              if (value === 'upcoming' || value === 'past') setWhen(value);
            }}
          />
        }
      />
      {read.status === 'loading' ? (
        <Skeleton lines={4} />
      ) : read.status === 'error' ? (
        <EmptyState tone="error" title={strings.bookingsFailed} onRetry={() => setAttempt((count) => count + 1)}>
          {read.message}
        </EmptyState>
      ) : (
        <BookingList
          label={when === 'upcoming' ? strings.upcoming : strings.past}
          groups={groups}
          placement="card"
          onOpen={() => {
            void navigate({ href: pageBookingsHref(slug, pageId, when) });
          }}
          emptyState={
            <EmptyState
              icon="calendar-check"
              title={when === 'upcoming' ? strings.noUpcoming : strings.noPast}
              actions={
                <ButtonLink href={pageBookingsHref(slug, pageId, when)} icon="arrow-right">
                  {strings.allBookings}
                </ButtonLink>
              }
            />
          }
        />
      )}
      {read.status === 'ready' && read.items.length > 0 && (
        <SectionBar
          start={
            <ButtonLink href={pageBookingsHref(slug, pageId, when)} variant="ghost" icon="arrow-right">
              {strings.allBookings}
            </ButtonLink>
          }
        />
      )}
    </SettingsStack>
  );
}

/** The periods the tab offers: the short ones, as a form's Analytics does; the rest are on Insights itself. */
const RANGES = ['7', '30', '90'] as const;

/** The page's Insights (spec 0067): visits, bookings, sources and where people stop, for this page alone. */
export function PageInsightsTab({ data, slug, pageId }: PageActivityProps) {
  const [range, setRange] = useState<InsightRange>('30');
  const view = useMemo(
    () => data.insights.numbers(slug, { range }, { kind: 'booking', pageId }),
    [data, slug, range, pageId],
  );
  const state = useInsightRead(view);
  const fullHref = insightsHref(slug, { kind: 'booking', page: pageId });
  return (
    <SettingsStack>
      <SectionBar
        start={
          <SegmentedControl
            label={strings.period}
            size="compact"
            segments={RANGES.map((each) => ({ value: each, label: insightStrings.ranges[each] }))}
            value={range}
            onChange={(value) => {
              if (value === '7' || value === '30' || value === '90') setRange(value);
            }}
          />
        }
      />
      {state.status === 'loading' ? (
        <>
          <Stats label={insightStrings.summary} items={[]} isLoading />
          <Skeleton shape="fill" />
        </>
      ) : state.status === 'error' ? (
        <EmptyState tone="error" title={insightStrings.failedTitle} onRetry={() => view.reload()}>
          {state.message}
        </EmptyState>
      ) : state.insights.totals.visits === 0 && (state.insights.previous?.visits ?? 0) === 0 ? (
        <EmptyState
          icon="chart-line"
          title={insightStrings.noneInPeriod}
          actions={
            <ButtonLink href={fullHref} icon="arrow-right">
              {strings.allInsights}
            </ButtonLink>
          }
        />
      ) : (
        <>
          <InsightsBody numbers={state.insights} isRefreshing={state.isRefreshing} />
          <SectionBar
            start={
              <ButtonLink href={fullHref} variant="ghost" icon="arrow-right">
                {strings.allInsights}
              </ButtonLink>
            }
          />
        </>
      )}
    </SettingsStack>
  );
}
