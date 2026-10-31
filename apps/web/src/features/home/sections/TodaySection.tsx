// Brief
// Purpose: Home's Today (spec 0041): the meetings the member hosts and their own calendar's events, today's split
// into Earlier and Coming up, then the week's next ones by day, so the card always says what is next.
// Main task: see what's next and open its day in Bookings. Leaves out: booking or editing a meeting (Bookings).
import { useBookingsCalendar } from '@crm/data/react';
import { BookingList, ButtonLink, Card, EmptyState, Skeleton, useFormatSettings, type BookingListGroup } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useMemo, type ReactNode } from 'react';
import { providerOf } from '../../bookings/provider.ts';
import { useNow } from '../../bookings/useNow.ts';
import { recordLinks } from '../../records/timeline.ts';
import { useToday } from '../../tasks/day.ts';
import {
  agendaOf,
  aheadRange,
  minutesOf,
  splitAgenda,
  todayAndNext,
  upcomingAfter,
  type AgendaItem,
} from '../agenda.ts';
import type { HomeSectionProps } from '../registry.ts';
import { strings } from '../strings.ts';
import { Failed, locale } from './shared.tsx';

/** "30 min", "1 hr", "1 hr 30 min". */
function lengthOf(minutes: number): string {
  return minutes < 60 ? strings.minutes(minutes) : strings.hours(Math.floor(minutes / 60), minutes % 60);
}

/** Today: today's meetings and the week's next ones; titled Next up when today holds none. */
export function TodaySection({ context }: HomeSectionProps) {
  const { slug, objects, meId } = context;
  const { data } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const { timeZone } = useFormatSettings();
  const today = useToday(timeZone);
  const range = useMemo(() => aheadRange(today), [today]);
  const state = useBookingsCalendar(
    useMemo(() => data.bookings.calendar(slug, range.from, range.to), [data, slug, range]),
  );
  const now = useNow();
  const link = useMemo(() => recordLinks(slug, objects), [slug, objects]);
  const time = useMemo(
    () => new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit', timeZone }),
    [timeZone],
  );
  const dayName = useMemo(
    () => new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone }),
    [timeZone],
  );
  const agenda = useMemo(() => (state.status === 'ready' ? agendaOf(state, meId) : []), [state, meId]);
  const bookings = (
    <ButtonLink variant="secondary" icon="calendar" href={`/w/${slug}/bookings`}>
      {strings.bookings}
    </ButtonLink>
  );
  const frame = (
    body: ReactNode,
    extra: { readonly isBusy?: boolean; readonly title?: string; readonly isEmpty?: boolean } = {},
  ) => (
    // Empty, the way to Bookings moves from the header into the empty state: one action, where the eye lands.
    <Card
      title={extra.title ?? strings.today}
      isBusy={extra.isBusy ?? false}
      {...(extra.isEmpty === true ? {} : { actions: bookings })}
    >
      {body}
    </Card>
  );
  if (state.status === 'loading') return frame(<Skeleton shape="block" />, { isBusy: true });
  if (state.status === 'error') {
    return frame(
      <Failed
        title={strings.todayFailed}
        message={state.message}
        onRetry={() => {
          data.bookings.reloadAll(slug);
        }}
      />,
    );
  }
  const { today: todays } = todayAndNext(agenda, today);
  const ahead = upcomingAfter(agenda, today, todays.length);
  // Nothing today: the card is about what comes next, and says so in its title (owner, 31 October 2026, item 4).
  const title = todays.length === 0 ? strings.nextUp : strings.today;
  if (todays.length === 0 && ahead.length === 0) {
    // Centred in the card's height (it stands beside the link page card), so the card reads as a calm state with its
    // one next step rather than a line over an empty box (owner, 31 October 2026, Home item 14).
    return frame(<EmptyState icon="calendar" title={strings.noMeetingsWeek} layout="fill" actions={bookings} />, {
      title,
      isEmpty: true,
    });
  }
  const { earlier, next } = splitAgenda(todays, now);
  const people = objects.find((object) => object.standardKey === 'people');
  const rowOf = (item: AgendaItem, isLater = false): BookingListGroup['rows'][number] => {
    const href =
      item.personRecordId === undefined || people === undefined ? undefined : link(people.id, item.personRecordId);
    const start = new Date(item.startsAt);
    return {
      id: item.id,
      date: item.allDay ? strings.allDay : time.format(start),
      time: item.allDay ? '' : lengthOf(minutesOf(item)),
      title: item.title,
      ...(item.videoUrl === undefined || isLater || Date.parse(item.endsAt) <= now.getTime()
        ? {}
        : { join: { href: item.videoUrl, provider: providerOf(item.videoUrl) } }),
      ...(item.guestName === undefined ? {} : { guestName: item.guestName }),
      ...(href === undefined ? {} : { guestHref: href }),
    };
  };
  const groups: BookingListGroup[] = [
    ...(earlier.length === 0
      ? []
      : [{ id: 'earlier', label: strings.earlier, rows: earlier.map((item) => rowOf(item)) }]),
    ...(next.length === 0 ? [] : [{ id: 'next', label: strings.comingUp, rows: next.map((item) => rowOf(item)) }]),
    ...laterDays(ahead, (item) => dayName.format(new Date(item.startsAt))).map((day) => ({
      id: `later-${day.label}`,
      label: day.label,
      rows: day.items.map((item) => rowOf(item, true)),
    })),
  ];
  const openDay = (id: string) => {
    const item = agenda.find((each) => each.id === id);
    const day =
      item === undefined ? today : new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(item.startsAt));
    void navigate({ to: '/w/$slug/bookings/calendar', params: { slug }, search: { d: day } });
  };
  return frame(<BookingList label={title} placement="agenda" groups={groups} onOpen={openDay} />, { title });
}

/** The meetings after today in runs by day, keeping their order: one band per day. */
function laterDays(
  items: readonly AgendaItem[],
  labelOf: (item: AgendaItem) => string,
): readonly { readonly label: string; readonly items: readonly AgendaItem[] }[] {
  return items.reduce<readonly { readonly label: string; readonly items: readonly AgendaItem[] }[]>((days, item) => {
    const label = labelOf(item);
    const last = days.at(-1);
    return last?.label === label
      ? [...days.slice(0, -1), { label, items: [...last.items, item] }]
      : [...days, { label, items: [item] }];
  }, []);
}
