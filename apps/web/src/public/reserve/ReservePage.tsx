// Brief
// Purpose: a guest reserves a table at one place (spec 0066 B7 lite; 0065 AC-6551), at timefix.com/r/<key>.
// Main task: in checklabs' order and words, on the booking page's own frame: the party, a date and a time ("Choose a
//   date"), Continue, then Your details on the card ("Confirm {day} at {time}"). A phone: the party, a strip of three
//   weeks with the full calendar a press away, the times three across, and the Book bar once a time is picked.
// Leaves out: deposits, a waitlist and "notify me" (later slices). Built on BookingFrame in the guest menu's look
//   (`look="menu"`, the place's tile, Manage booking), PartyBand, DayStrip, MonthTiles `plain`, one grouped SlotList
//   and BookingDetails with Back. Times are the restaurant's clock. Never a sticky form.
import {
  BookingDetails,
  BookingFrame,
  BookingMessage,
  Button,
  Callout,
  ChoiceChips,
  DayStrip,
  Link,
  MonthTiles,
  PartyBand,
  SlotList,
  type BookingDetailsDraft,
  type BookingDetailsOutcome,
  type BookingDetailsValues,
  type BookingFact,
  type SlotGroup,
} from '@crm/ui/public-booking';
import { isDataError, type PublicTablePage, type TableClient, type TableRefusal } from '@crm/data/tables';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { longDate, openDays, rangesOn, services, shortDay, timeLabel, type ServiceHeading } from './days.ts';
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

/** The guest look's stylesheet on our own api (the menu's look with the brand's accent), when the page names one. */
export function lookHref(page: Pick<PublicTablePage, 'key' | 'look'>): string | undefined {
  return page.look !== undefined && /^[0-9a-f]{12}$/.test(page.look) && /^[A-Za-z0-9_-]{16}$/.test(page.key)
    ? `/api/public/tables/${page.key}/look.css?v=${page.look}`
    : undefined;
}

/** The occasions, by key, in the order the chips show them. */
const OCCASION_KEYS = ['birthday', 'anniversary', 'date', 'business', 'other'] as const;

/** "No preference", the seating chips' first: kept apart from any area's own name. */
const NO_PREFERENCE = '';

/** Days on the phone's strip (checklabs shows three weeks). */
const STRIP_DAYS = 21;

/** Wide enough for the month (a large phone on its side and up); narrower, checklabs' strip of days. */
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

/** Whether the visitor asked for less motion. */
const prefersReducedMotion = () => globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The first of the month of a date. */
const monthOf = (date: string) => date.slice(0, 7);

/** The times of one day for a party: loading, the times, or the failure's words. */
type Times =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly times: readonly string[] }
  | { readonly status: 'error'; readonly message: string };

/** Which view the card shows: the month (a date and a time), or the details over the whole card. */
type Step = { readonly view: 'month' | 'details'; readonly back: boolean; readonly attempt: string };

/** The page: a date and a time, then Your details; `onReserved` moves on to the reservation (the manage view). */
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
  // checklabs' default party is 2, within what the page takes.
  const [party, setParty] = useState(Math.min(Math.max(2, page.partyMin), page.partyMax));
  const [day, setDay] = useState<string | undefined>(days[0]);
  const [month, setMonth] = useState(monthOf(days[0] ?? page.today));
  const [time, setTime] = useState<string | undefined>();
  const isWide = useWide();
  const [isFullCalendar, setFullCalendar] = useState(false);
  // A day picked on the phone's full calendar: the calendar closes and the strip's day takes focus.
  const [isStripFocused, setStripFocused] = useState(false);
  const [step, setStep] = useState<Step>({ view: 'month', back: false, attempt: crypto.randomUUID() });
  // The answer for one party and day: a different pair is loading until its own answer lands.
  const [answer, setAnswer] = useState<{ readonly key: string; readonly times: Times } | undefined>();
  const timesKey = `${String(party)}|${day ?? ''}`;
  const times: Times = answer?.key === timesKey ? answer.times : { status: 'loading' };
  const [notice, setNotice] = useState<{ readonly text: string; readonly next: readonly string[] } | undefined>();
  const [occasion, setOccasion] = useState<readonly string[]>([]);
  const [seating, setSeating] = useState<readonly string[]>([NO_PREFERENCE]);
  // What the guest typed, kept while the details step is away (Back to change the time, or a time taken meanwhile).
  const [draft, setDraft] = useState<BookingDetailsDraft | undefined>();
  const [startedAt] = useState(() => Date.now());
  // Bumped to read the day's times again (a time was just taken and nothing else was offered with the refusal).
  const [reload, setReload] = useState(0);
  const firstTime = useRef<HTMLButtonElement>(null);
  const bookRef = useRef<HTMLButtonElement>(null);

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

  // On a phone the Book bar arrives under the times once one is picked: it comes into view with it (never sticky).
  const isBarShown = isWide || time !== undefined;
  useEffect(() => {
    if (isWide || time === undefined) return;
    bookRef.current?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [isWide, time]);

  if (!page.taking || days.length === 0) {
    // Not taking reservations, or no day in the window opens at all: say so with the phone, never a spinner.
    const why = page.taking ? strings.noOpenDays : strings.closedNow;
    return (
      <BookingMessage title={page.place.name} page="booking_page" look="menu">
        {page.place.phone === undefined ? why : `${why} ${strings.callUs(page.place.phone)}`}
      </BookingMessage>
    );
  }

  const label = (instant: string) => timeLabel(instant, zone, locale);
  const pickTime = (instant: string) => {
    setTime(instant);
    setNotice(undefined);
  };
  const pickDay = (next: string) => {
    setDay(next);
    setMonth(monthOf(next));
    setTime(undefined);
    setNotice(undefined);
  };
  /** A day from the phone's full calendar: it closes, as checklabs' does, and the strip's day takes focus. */
  const pickFromCalendar = (next: string) => {
    pickDay(next);
    if (!isWide && isFullCalendar) {
      setFullCalendar(false);
      setStripFocused(true);
    }
  };
  /** The day's times again (after a failure, or a time just taken). */
  const readAgain = () => {
    setAnswer(undefined);
    setReload((count) => count + 1);
  };
  /** The first free time takes focus (after a render, so new times are there). */
  const focusTimes = () => globalThis.requestAnimationFrame(() => firstTime.current?.focus());

  const reserve = async (values: BookingDetailsValues): Promise<BookingDetailsOutcome> => {
    if (time === undefined) return { kind: 'failed', message: strings.pickTime };
    const picked = OCCASION_KEYS.find((key) => key === occasion[0]);
    const area = seating[0] ?? NO_PREFERENCE;
    // A seating choice goes at the head of the note, as checklabs sends it; the note keeps the server's limit.
    const note = area === NO_PREFERENCE ? values.note.trim() : strings.seatingNote(area, values.note.trim());
    try {
      const made = await client.reserve(page.key, {
        idempotencyKey: step.attempt,
        party,
        start: time,
        name: values.name,
        email: values.email,
        phone: values.phone,
        ...(note === '' ? {} : { note }),
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
        // Back to the times, with the next free ones offered at once (checklabs only said it was gone), and the day's
        // times read again behind them, so the taken one is never offered twice. What was typed is kept (the draft).
        const next = (error as TableRefusal).next ?? [];
        setNotice({ text: next.length === 0 ? strings.takenNone : strings.taken, next });
        readAgain();
        setTime(undefined);
        setStep({ view: 'month', back: true, attempt: crypto.randomUUID() });
        focusTimes();
        return { kind: 'failed', message: strings.takenShort };
      }
      const fields = Object.fromEntries(
        (error.data?.issues ?? []).map((issue) => [String(issue.path.at(-1) ?? ''), issue.message]),
      );
      return Object.keys(fields).length > 0
        ? { kind: 'invalid', fields, message: error.message }
        : { kind: 'failed', message: error.message };
    }
  };

  const offered =
    notice !== undefined && notice.next.length > 0 ? notice.next : times.status === 'ready' ? times.times : [];
  const headingOf = (heading: ServiceHeading) =>
    heading.kind === 'named'
      ? heading.text
      : heading.kind === 'lunch'
        ? strings.lunch
        : heading.kind === 'dinner'
          ? strings.dinner
          : strings.times;
  const groups: readonly SlotGroup[] = services(offered, zone, day === undefined ? [] : rangesOn(page.hours, day)).map(
    (group) => ({
      id: group.key,
      heading: headingOf(group.heading),
      slots: group.times.map((instant) => ({
        id: instant,
        label: label(instant),
        name: `${label(instant)}, ${shortDay(day ?? '', locale)}`,
      })),
    }),
  );
  const isOffering = notice !== undefined && notice.next.length > 0;
  const isLoading = times.status === 'loading' && !isOffering;
  const dayHeading = day === undefined ? '' : longDate(day, locale);
  const aside =
    times.status === 'error' && !isOffering ? (
      <Callout
        tone="danger"
        isAnnounced
        actions={
          <Button icon="refresh-cw" onPress={readAgain}>
            {strings.tryAgain}
          </Button>
        }
      >
        {times.message}
      </Callout>
    ) : (
      <>
        {/* A time just taken: why, beside the times it offers instead. */}
        {notice !== undefined && (
          <Callout tone="warning" isAnnounced>
            {notice.text}
          </Callout>
        )}
        {/* Lunch and Dinner in one list that scrolls as one, headed by the day and how many times are left. */}
        <SlotList
          heading={dayHeading}
          slots={[]}
          groups={groups}
          value={time}
          onChange={pickTime}
          isLoading={isLoading}
          empty={strings.noTimes}
          firstRef={firstTime}
          drawKey={`${day ?? ''}|${String(party)}`}
          {...(offered.length > 0 && !isLoading && !isOffering ? { badge: strings.available(offered.length) } : {})}
        />
      </>
    );

  const picked = day !== undefined && time !== undefined ? { day: shortDay(day, locale), at: label(time) } : undefined;
  const bookBar = (
    <Button
      ref={bookRef}
      variant="primary"
      size="lg"
      isFullWidth="center"
      isDisabled={picked === undefined}
      onPress={() => {
        setNotice(undefined);
        setStep({ view: 'details', back: false, attempt: crypto.randomUUID() });
      }}
    >
      {picked === undefined ? strings.pickATime : strings.continueAt(picked.day, picked.at)}
    </Button>
  );

  const areas = page.areas ?? [];
  const details = (
    <BookingDetails
      key={step.attempt}
      needsPhone
      maxGuests={0}
      fieldSize="lg"
      isPhoneFirst
      intro={strings.detailsIntro}
      confirmNote={strings.confirmNote}
      {...(draft === undefined ? {} : { draft })}
      onDraft={setDraft}
      labels={{
        heading: strings.yourDetails,
        name: strings.fullName,
        phone: strings.phone,
        note: strings.specialRequests,
        notePlaceholder: strings.specialPlaceholder,
        confirm: picked === undefined ? strings.pickATime : strings.confirmAt(picked.day, picked.at),
        confirming: strings.detailsConfirming,
        done: strings.detailsDone,
      }}
      extra={
        <>
          {/* checklabs' order: Seating (when the place has areas), then Occasion. */}
          {areas.length > 0 && (
            <ChoiceChips
              label={strings.seating}
              labelAside={strings.optional}
              tone="strong"
              isSingle
              choices={[
                { id: NO_PREFERENCE, label: strings.noPreference },
                ...areas.map((area) => ({ id: area, label: area })),
              ]}
              selected={seating}
              // A single choice set can't be emptied by its own chips: pressing the chosen one again is No preference.
              onChange={(next) => setSeating(next.length === 0 ? [NO_PREFERENCE] : next)}
            />
          )}
          <ChoiceChips
            label={strings.occasion}
            labelAside={strings.optional}
            tone="strong"
            isSingle
            choices={OCCASION_KEYS.map((key) => ({ id: key, label: strings.occasions[key] }))}
            selected={occasion}
            onChange={setOccasion}
          />
          {page.menuPath !== undefined && (
            <p>
              <Link href={page.menuPath} icon="utensils" weight="strong" opensInNewTab>
                {strings.seeMenu}
              </Link>
            </p>
          )}
        </>
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
        setStep((now) => ({ ...now, view: 'month', back: true }));
        setNotice(undefined);
      }}
      onSubmit={reserve}
    />
  );

  const isDetails = step.view === 'details' && picked !== undefined;
  const facts: readonly BookingFact[] = [
    ...placeFacts(page),
    // The pick, once there is one: the day and time, and the party (checklabs' summary, in the rail). On a phone the
    // rail stands above the card, so there only on the details step: a line arriving there as a time is tapped moved
    // the times under the finger, and the Book bar already names the pick.
    ...(picked === undefined || !(isWide || isDetails)
      ? []
      : [
          { id: 'when', icon: 'calendar' as const, children: strings.pickedAt(picked.day, picked.at) },
          { id: 'party', icon: 'users' as const, children: strings.guestsCount(party) },
        ]),
  ];
  return (
    <BookingFrame
      look="menu"
      identity="tile"
      host={{ name: page.business.name }}
      title={strings.reserveYourTable}
      description={strings.pickAt(page.place.name)}
      facts={facts}
      railLink={{ label: strings.manageBooking, href: `/r/${encodeURIComponent(page.key)}/manage` }}
      isEmbedded={isEmbedded}
      heading={strings.chooseDate}
      view={isDetails ? 'details' : 'month'}
      {...(isDetails
        ? { cover: details, coverPlace: 'card' as const, enter: 'forward' as const }
        : step.back
          ? { enter: 'back' as const }
          : {})}
      aside={aside}
      // On a phone the times run with the page: no box scrolling inside it.
      isAsideGrowing
      {...(isBarShown ? { footer: bookBar } : {})}
    >
      <PartyBand
        value={party}
        min={page.partyMin}
        max={page.partyMax}
        phone={page.place.phone}
        onChange={(size) => {
          setParty(size);
          setTime(undefined);
          setNotice(undefined);
        }}
      />
      {!isWide && !isFullCalendar ? (
        <DayStrip
          // Three weeks, and the day picked on the full calendar when it is later.
          days={
            day === undefined || days.slice(0, STRIP_DAYS).includes(day)
              ? days.slice(0, STRIP_DAYS)
              : [...days.slice(0, STRIP_DAYS), day]
          }
          value={day}
          onChange={(next) => {
            setStripFocused(false);
            pickDay(next);
          }}
          focusesValue={step.back || isStripFocused}
          today={page.today}
        />
      ) : (
        <MonthTiles
          tone="plain"
          month={month}
          today={page.today}
          openDays={open}
          value={day}
          onChange={pickFromCalendar}
          onMonthChange={setMonth}
          canPrevious={month > monthOf(page.today)}
          canNext={month < monthOf(days.at(-1) ?? page.today)}
          focusesValue={step.back}
        />
      )}
      {!isWide && (
        // One name both ways, its state said by aria-expanded (a label that flipped to Fewer days read as a second
        // control to a screen reader).
        <Button
          variant="ghost"
          icon="calendar"
          // Drawn small, pressed across 44px: a guest's thumb.
          isTouchTarget
          isExpanded={isFullCalendar}
          onPress={() => setFullCalendar((shown) => !shown)}
        >
          {strings.fullCalendar}
        </Button>
      )}
    </BookingFrame>
  );
}
