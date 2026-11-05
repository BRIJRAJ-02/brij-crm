// Brief
// Purpose: a guest reserves a table at one place (spec 0066 B7 lite; 0065 AC-6551), at timefix.com/r/<key>.
// Main task: on one page, as checklabs' booking form: the party, a day (a strip of days on a phone, with the full
//   calendar a press away; the month on a wider screen), a time, then Your details, and "Confirm {day} at {time}".
// Leaves out: deposits, areas, waitlist and "notify me" (later slices). Built on the booking page's own modules:
//   BookingFrame, DayStrip, MonthTiles, SlotList and BookingDetails (with no Back: there is no step), the party as
//   ChoiceChips. Times are the restaurant's clock.
import {
  BookingDetails,
  BookingFrame,
  BookingMessage,
  Button,
  Callout,
  ChoiceChips,
  DayStrip,
  MonthTiles,
  SlotList,
  type BookingDetailsOutcome,
  type BookingDetailsValues,
  type BookingFact,
} from '@crm/ui/public-booking';
import { isDataError, type PublicTablePage, type TableClient, type TableRefusal } from '@crm/data/tables';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { openDays, rangesOn, services, shortDay, timeLabel, type ServiceHeading } from './days.ts';
import { strings } from './strings.ts';

/** What a reservation made hands the page: the manage link's token and the code. */
export interface Reserved {
  readonly token: string | undefined;
  readonly lookupCode: string;
}

/** The place's facts in the rail: where it is and its phone. */
export function placeFacts(page: PublicTablePage): readonly BookingFact[] {
  const address = [page.place.addressLine, page.place.city, page.place.postcode].filter((part) => part !== undefined);
  return [
    ...(address.length === 0 ? [] : [{ id: 'where', icon: 'map-pin' as const, children: address.join(', ') }]),
    ...(page.place.phone === undefined ? [] : [{ id: 'phone', icon: 'phone' as const, children: page.place.phone }]),
  ];
}

/** The rail's head: the business, and the place as the page's title (said once when the two names are the same). */
export function frameHead(page: PublicTablePage): { readonly host: { readonly name: string }; readonly title: string } {
  return { host: { name: page.business.name }, title: page.place.name };
}

/** The occasions, by key, in the order the chips show them. */
const OCCASION_KEYS = ['birthday', 'anniversary', 'date', 'business', 'other'] as const;

/** Days on the phone's strip (checklabs shows three weeks). */
const STRIP_DAYS = 21;

/** Wide enough for the month beside the times; narrower, the strip of days. */
const WIDE = '(min-width: 40rem)';

/** Whether the page is wide enough for the month, following the window as it changes. */
function useWide(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const list = globalThis.matchMedia(WIDE);
      list.addEventListener('change', changed);
      return () => {
        list.removeEventListener('change', changed);
      };
    },
    () => globalThis.matchMedia(WIDE).matches,
    () => true,
  );
}

/** The first of the month of a date. */
const monthOf = (date: string) => date.slice(0, 7);

/** The times of one day for a party: loading, the times, or the failure's words. */
type Times =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly times: readonly string[] }
  | { readonly status: 'error'; readonly message: string };

/** The page: pick, then details; `onReserved` moves on to the reservation (the manage view). */
export function ReservePage({
  client,
  page,
  locale,
  isEmbedded,
  onReserved,
}: {
  readonly client: TableClient;
  readonly page: PublicTablePage;
  readonly locale: string;
  readonly isEmbedded: boolean;
  readonly onReserved: (reserved: Reserved) => void;
}) {
  const zone = page.place.timeZone;
  const days = useMemo(() => openDays(page), [page]);
  const open = useMemo(() => new Set(days), [days]);
  const [party, setParty] = useState(Math.min(Math.max(2, page.partyMin), page.partyMax));
  const [day, setDay] = useState<string | undefined>(days[0]);
  const [month, setMonth] = useState(monthOf(days[0] ?? page.today));
  const [time, setTime] = useState<string | undefined>();
  const isWide = useWide();
  const [isFullCalendar, setFullCalendar] = useState(false);
  const [attempt, setAttempt] = useState(() => crypto.randomUUID());
  // The answer for one party and day: a different pair is loading until its own answer lands.
  const [answer, setAnswer] = useState<{ readonly key: string; readonly times: Times } | undefined>();
  const timesKey = `${String(party)}|${day ?? ''}`;
  const times: Times = answer?.key === timesKey ? answer.times : { status: 'loading' };
  const [notice, setNotice] = useState<{ readonly text: string; readonly next: readonly string[] } | undefined>();
  const [occasion, setOccasion] = useState<readonly string[]>([]);
  const [startedAt] = useState(() => Date.now());
  // Bumped to read the day's times again (a time was just taken and nothing else was offered with the refusal).
  const [reload, setReload] = useState(0);
  const timesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (day === undefined) return;
    const controller = new AbortController();
    const key = `${String(party)}|${day}`;
    client.times(page.key, { party, date: day }, controller.signal).then(
      (read) => {
        setAnswer({ key, times: { status: 'ready', times: read.times } });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setAnswer({ key, times: { status: 'error', message: isDataError(error) ? error.message : strings.offline } });
      },
    );
    return () => {
      controller.abort();
    };
  }, [client, page.key, party, day, reload]);

  const frame = {
    // The rail heads with the business, as a booking page heads with its host; the place is the page's title.
    ...frameHead(page),
    description: strings.goodToKnow(Math.round(page.cancelCutoffMinutes / 60)),
    facts: placeFacts(page),
    isEmbedded,
  };

  if (!page.taking || days.length === 0) {
    // Not taking reservations, or no day in the window opens at all: say so with the phone, never a spinner.
    const why = page.taking ? strings.noOpenDays : strings.closedNow;
    return (
      <BookingMessage title={page.place.name} page="booking_page">
        {page.place.phone === undefined ? why : `${why} ${strings.callUs(page.place.phone)}`}
      </BookingMessage>
    );
  }

  const label = (instant: string) => timeLabel(instant, zone, locale);
  const pickTime = (instant: string) => {
    setTime(instant);
    setNotice(undefined);
  };

  const reserve = async (values: BookingDetailsValues): Promise<BookingDetailsOutcome> => {
    // No time yet: the first free one takes focus, and the line says what is missing (checklabs' "Pick a time slot").
    if (time === undefined) {
      timesRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
      return { kind: 'failed', message: strings.pickTime };
    }
    const picked = OCCASION_KEYS.find((key) => key === occasion[0]);
    try {
      const made = await client.reserve(page.key, {
        idempotencyKey: attempt,
        party,
        start: time,
        name: values.name,
        email: values.email,
        phone: values.phone,
        ...(values.note.trim() === '' ? {} : { note: values.note }),
        ...(picked === undefined ? {} : { occasion: picked }),
        marketing: values.answers.marketing === true,
        timeZone: zone,
        company_url: values.trap,
        startedAt,
      });
      return {
        kind: 'done',
        next: () => {
          onReserved({ token: made.manageToken, lookupCode: made.visit.lookupCode });
        },
      };
    } catch (error) {
      if (!isDataError(error)) return { kind: 'failed', message: strings.offline };
      if (error.code === 'SLOT_TAKEN') {
        // Back to the times, with the next free ones offered at once (checklabs only said it was gone); with none
        // offered, the day's times read again, so the taken one is never offered twice.
        const next = (error as TableRefusal).next ?? [];
        setNotice({ text: next.length === 0 ? strings.takenNone : strings.taken, next });
        if (next.length === 0) {
          setAnswer(undefined);
          setReload((count) => count + 1);
        }
        setTime(undefined);
        setAttempt(crypto.randomUUID());
        return { kind: 'failed', message: error.message };
      }
      const fields = Object.fromEntries(
        (error.data?.issues ?? []).map((issue) => [String(issue.path.at(-1) ?? ''), issue.message]),
      );
      return Object.keys(fields).length > 0
        ? { kind: 'invalid', fields, message: error.message }
        : { kind: 'failed', message: error.message };
    }
  };
  const partyChoices = Array.from({ length: page.partyMax - page.partyMin + 1 }, (_, index) => {
    const size = String(page.partyMin + index);
    return { id: size, label: size };
  });
  const offered =
    notice !== undefined && notice.next.length > 0 ? notice.next : times.status === 'ready' ? times.times : [];
  const groups = services(offered, zone, day === undefined ? [] : rangesOn(page.hours, day));
  const headingOf = (heading: ServiceHeading) =>
    heading.kind === 'named'
      ? heading.text
      : heading.kind === 'lunch'
        ? strings.lunch
        : heading.kind === 'dinner'
          ? strings.dinner
          : strings.times;
  const slotsOf = (list: readonly string[]) =>
    list.map((instant) => ({
      id: instant,
      label: label(instant),
      name: `${label(instant)}, ${shortDay(day ?? '', locale)}`,
    }));
  const aside =
    times.status === 'error' ? (
      <Callout tone="danger" isAnnounced>
        {times.message}
      </Callout>
    ) : groups.length === 0 && times.status === 'ready' ? (
      <SlotList
        heading={strings.times}
        layout="grid"
        slots={[]}
        value={undefined}
        onChange={pickTime}
        empty={strings.noTimes}
      />
    ) : times.status === 'loading' && !(notice !== undefined && notice.next.length > 0) ? (
      <SlotList heading={strings.times} layout="grid" slots={[]} value={undefined} onChange={pickTime} isLoading />
    ) : (
      groups.map((group) => (
        <SlotList
          key={group.key}
          heading={headingOf(group.heading)}
          layout="grid"
          slots={slotsOf(group.times)}
          value={time}
          onChange={pickTime}
          drawKey={`${day ?? ''}|${String(party)}|${group.key}`}
        />
      ))
    );
  return (
    <BookingFrame
      {...frame}
      heading={strings.reserveYourTable}
      view="month"
      // The times' own wrapper, so Choose a time can move focus to the first one.
      aside={<div ref={timesRef}>{aside}</div>}
      footer={
        // Your details under the day and its times, on the same page (checklabs' one page form).
        <BookingDetails
          needsPhone
          maxGuests={0}
          labels={{
            heading: strings.yourDetails,
            confirm:
              time === undefined || day === undefined
                ? strings.chooseToContinue
                : strings.confirmAt(shortDay(day, locale), label(time)),
            confirming: strings.detailsConfirming,
            done: strings.detailsDone,
            note: strings.detailsNote,
          }}
          extra={
            <ChoiceChips
              label={strings.occasion}
              labelAside={strings.optional}
              tone="strong"
              isSingle
              choices={OCCASION_KEYS.map((key) => ({ id: key, label: strings.occasions[key] }))}
              selected={occasion}
              onChange={setOccasion}
            />
          }
          questions={[
            {
              id: 'marketing',
              key: 'marketing',
              label: strings.marketing(page.business.name),
              answerType: 'checkbox',
              required: false,
            },
          ]}
          onSubmit={reserve}
        />
      }
    >
      {notice !== undefined && (
        <Callout tone="warning" isAnnounced>
          {notice.text}
        </Callout>
      )}
      <ChoiceChips
        label={strings.guests}
        choices={partyChoices}
        selected={[String(party)]}
        isSingle
        onChange={(next) => {
          const size = Number(next[0]);
          if (Number.isInteger(size) && size > 0) {
            setParty(size);
            setTime(undefined);
            setNotice(undefined);
          }
        }}
        tone="strong"
        labelAside={strings.largerPartyShort(page.partyMax)}
      />
      {!isWide && !isFullCalendar ? (
        <DayStrip
          days={days.slice(0, STRIP_DAYS)}
          value={day}
          onChange={(next) => {
            setDay(next);
            setMonth(monthOf(next));
            setTime(undefined);
            setNotice(undefined);
          }}
        />
      ) : (
        <MonthTiles
          month={month}
          today={page.today}
          openDays={open}
          value={day}
          onChange={(next) => {
            setDay(next);
            setTime(undefined);
            setNotice(undefined);
          }}
          onMonthChange={setMonth}
          canPrevious={month > monthOf(page.today)}
          canNext={month < monthOf(days.at(-1) ?? page.today)}
        />
      )}
      {!isWide && (
        <Button variant="ghost" size="sm" icon="calendar" onPress={() => setFullCalendar((shown) => !shown)}>
          {isFullCalendar ? strings.fewerDays : strings.fullCalendar}
        </Button>
      )}
    </BookingFrame>
  );
}
