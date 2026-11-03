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
import { useEffect, useMemo, useState } from 'react';
import { openDays, services, shortDay, timeLabel } from './days.ts';
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

/** The first of the month of a date. */
const monthOf = (date: string) => `${date.slice(0, 7)}-01`;

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
  const [startedAt] = useState(() => Date.now());

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
  }, [client, page.key, party, day]);

  const frame = {
    title: page.place.name,
    description: strings.goodToKnow(Math.round(page.cancelCutoffMinutes / 60)),
    facts: placeFacts(page),
    isEmbedded,
  };

  if (!page.taking) {
    return (
      <BookingMessage title={page.place.name} page="booking_page">
        {page.place.phone === undefined
          ? strings.closedNow
          : `${strings.closedNow} ${strings.callUs(page.place.phone)}`}
      </BookingMessage>
    );
  }

  const label = (instant: string) => timeLabel(instant, zone, locale);
  const pickTime = (instant: string) => {
    setTime(instant);
    setNotice(undefined);
  };

  if (isDetails && time !== undefined) {
    const occasionKeys = ['birthday', 'anniversary', 'date', 'business', 'other'] as const;
    const reserve = async (values: BookingDetailsValues): Promise<BookingDetailsOutcome> => {
      const picked = strings.occasions.indexOf(values.answers.occasion as (typeof strings.occasions)[number]);
      try {
        const made = await client.reserve(page.key, {
          idempotencyKey: attempt,
          party,
          start: time,
          name: values.name,
          email: values.email,
          phone: values.phone,
          ...(values.note.trim() === '' ? {} : { note: values.note }),
          ...(picked < 0 ? {} : { occasion: occasionKeys[picked] ?? 'other' }),
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
          // Back to the times, with the next free ones offered at once (checklabs only said it was gone).
          const next = (error as TableRefusal).next ?? [];
          setNotice({ text: next.length === 0 ? strings.takenNone : strings.taken, next });
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
          questions={[
            {
              id: 'occasion',
              key: 'occasion',
              label: strings.occasion,
              answerType: 'choice',
              choices: [...strings.occasions],
              required: false,
            },
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
  const groups = services(offered, zone);
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
    ) : groups.length === 0 && times.status === 'ready' && notice === undefined ? (
      <SlotList heading={strings.times} slots={[]} value={undefined} onChange={pickTime} empty={strings.noTimes} />
    ) : times.status === 'loading' && notice === undefined ? (
      <SlotList heading={strings.times} slots={[]} value={undefined} onChange={pickTime} isLoading />
    ) : (
      groups.map((group) => (
        <SlotList
          key={group.name}
          heading={group.name === 'lunch' ? strings.lunch : strings.dinner}
          slots={slotsOf(group.times)}
          value={time}
          onChange={pickTime}
          drawKey={`${day ?? ''}|${String(party)}|${group.name}`}
        />
      ))
    );
  return (
    <BookingFrame
      {...frame}
      heading={strings.reserveTable}
      view="month"
      aside={<>{aside}</>}
      footer={
        <Button
          variant="primary"
          size="lg"
          isFullWidth="center"
          isDisabled={time === undefined}
          onPress={() => {
            setDetails(true);
          }}
        >
          {time === undefined || day === undefined
            ? strings.reserve
            : strings.reserveAt(shortDay(day, locale), label(time), party)}
        </Button>
      }
    >
      {notice !== undefined && (
        <Callout tone="danger" isAnnounced>
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
        labelAside={strings.largerParty(page.partyMax, page.place.phone)}
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
