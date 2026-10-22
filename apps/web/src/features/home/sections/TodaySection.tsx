// Home's Today (spec 0041): the meetings the member hosts and their own
// calendar's events today, those that ended under Earlier and the rest under
// Coming up, then the next one after today, with a link to Bookings.
import { useBookingsCalendar } from '@crm/data/react';
import { BookingList, ButtonLink, Card, EmptyState, Skeleton, useFormatSettings, type BookingListGroup } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useMemo, type ReactNode } from 'react';
import { providerOf } from '../../bookings/provider.ts';
import { useNow } from '../../bookings/useNow.ts';
import { recordLinks } from '../../records/timeline.ts';
import { useToday } from '../../tasks/day.ts';
import { agendaOf, aheadRange, minutesOf, splitAgenda, todayAndNext, type AgendaItem } from '../agenda.ts';
import type { HomeSectionProps } from '../registry.ts';
import { strings } from '../strings.ts';
import { Failed, locale } from './shared.tsx';

/** "30 min", "1 hr", "1 hr 30 min". */
function lengthOf(minutes: number): string {
  return minutes < 60 ? strings.minutes(minutes) : strings.hours(Math.floor(minutes / 60), minutes % 60);
}

/** Today: today's meetings and the next one after today. */
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
  const agenda = useMemo(() => (state.status === 'ready' ? agendaOf(state, meId) : []), [state, meId]);
  const frame = (body: ReactNode, extra: { readonly isBusy?: boolean; readonly description?: string } = {}) => (
    <Card
      title={strings.today}
      isBusy={extra.isBusy ?? false}
      {...(extra.description === undefined ? {} : { description: extra.description })}
      actions={
        <ButtonLink variant="ghost" href={`/w/${slug}/bookings`}>
          {strings.bookings}
        </ButtonLink>
      }
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
  const { today: todays, next: after } = todayAndNext(agenda, today);
  if (todays.length === 0 && after === undefined) {
    return frame(
      <EmptyState icon="calendar" title={strings.noMeetings} layout="row">
        {strings.noMeetingsText}
      </EmptyState>,
    );
  }
  const { earlier, next } = splitAgenda(todays, now);
  const time = new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit', timeZone });
  const dayAndTime = new Intl.DateTimeFormat(locale(), {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  });
  const people = objects.find((object) => object.standardKey === 'people');
  const rowOf = (item: AgendaItem, isLater = false): BookingListGroup['rows'][number] => {
    const href =
      item.personRecordId === undefined || people === undefined ? undefined : link(people.id, item.personRecordId);
    const start = new Date(item.startsAt);
    return {
      id: item.id,
      date: item.allDay ? strings.allDay : isLater ? dayAndTime.format(start) : time.format(start),
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
    ...(after === undefined ? [] : [{ id: 'later', label: strings.later, rows: [rowOf(after, true)] }]),
  ];
  const openDay = (id: string) => {
    const item = agenda.find((each) => each.id === id);
    const day =
      item === undefined ? today : new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(item.startsAt));
    void navigate({ to: '/w/$slug/bookings/calendar', params: { slug }, search: { d: day } });
  };
  return frame(<BookingList label={strings.today} placement="card" groups={groups} onOpen={openDay} />, {
    ...(todays.length === 0 ? { description: strings.noMeetings } : {}),
  });
}
