// Brief
// Purpose: a guest reserves a table at one place (spec 0066 B7 lite; 0065 AC-6551), at timefix.com/r/<key>.
// Main task: party, then a day and a time (Lunch and Dinner), then name, email and phone, then reserved.
// Leaves out: deposits, areas, waitlist and "notify me" (later slices). Laid out as checklabs' guest page (the date
//   and its times beside each other, the details after) and built on the booking page's own modules: BookingFrame,
//   MonthTiles, SlotList and BookingDetails, the party as ChoiceChips. Times are the restaurant's clock.
import {
  BookingDetails,
  BookingFrame,
  BookingMessage,
  Button,
  Callout,
  ChoiceChips,
  MonthTiles,
  SlotList,
  type BookingDetailsOutcome,
  type BookingDetailsValues,
  type BookingFact,
} from '@crm/ui/public-booking';
import { isDataError, type PublicTablePage, type TableClient, type TableRefusal } from '@crm/data/tables';
import { useEffect, useMemo, useRef, useState } from 'react';
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

/** The rail's head: the business, and the place as the title only when it is a name of its own (never "Somewhere / Somewhere"). */
export function frameHead(page: PublicTablePage): {
  readonly host: { readonly name: string };
  readonly title?: string;
} {
  return page.place.name.trim().toLowerCase() === page.business.name.trim().toLowerCase()
    ? { host: { name: page.business.name } }
    : { host: { name: page.business.name }, title: page.place.name };
}

/** The occasions, by key, in the order the chips show them. */
const OCCASION_KEYS = ['birthday', 'anniversary', 'date', 'business', 'other'] as const;

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
  const [isDetails, setDetails] = useState(false);
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

  if (isDetails && time !== undefined) {
    const reserve = async (values: BookingDetailsValues): Promise<BookingDetailsOutcome> => {
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
          setDetails(false);
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
    return (
      <BookingFrame
        {...frame}
        heading={strings.reserveAt(shortDay(day ?? page.today, locale), label(time), party)}
        view="details"
        enter="forward"
      >
        <BookingDetails
          needsPhone
          maxGuests={0}
          labels={{
            confirm: strings.detailsConfirm,
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
          onBack={() => {
            setDetails(false);
          }}
          onSubmit={reserve}
        />
      </BookingFrame>
    );
  }

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
      heading={strings.reserveTable}
      view="month"
      // The times' own wrapper, so Choose a time can move focus to the first one.
      aside={<div ref={timesRef}>{aside}</div>}
      footer={
        <Button
          variant="primary"
          size="lg"
          isFullWidth="center"
          onPress={() => {
            // Never a dead button: with no time yet it says so and takes the visitor to the first one.
            if (time === undefined) {
              timesRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
              return;
            }
            setDetails(true);
          }}
        >
          {time === undefined || day === undefined
            ? strings.chooseTime
            : strings.reserveAt(shortDay(day, locale), label(time), party)}
        </Button>
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
    </BookingFrame>
  );
}
