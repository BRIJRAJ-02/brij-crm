// Brief
// Purpose: the visitor's booking page at /b/<publicKey> (spec 0025, 0025-experience.md): book time with a member.
// Main task: see the first open day's times at once, pick a time, press Next beside it, give a name and email, confirm.
// Leaves out: questions (milestone 2), the forms hand off's signed prefill (milestone 3, a seam), analytics and captcha.
//
// Drawn with the library (`@crm/ui/public-booking`, since 20 October 2026, as the hosted form is): one card with
// the host's rail, the month and the day's times, after the timefix booking page and calendars' scheduling pages.
// This file holds the page's state and reads; the modules draw.
import { createBookingClient, isDataError, withPreviewDraft, type PublicBookingPage } from '@crm/data/booking';
import {
  BookingDetails,
  BookingFrame,
  BookingMessage,
  Button,
  Callout,
  DayStrip,
  MonthTiles,
  SegmentedControl,
  Select,
  SlotList,
  type BookingDetailsOutcome,
  type BookingDetailsValues,
  type BookingFact,
  type SelectItem,
} from '@crm/ui/public-booking';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Prefill } from './prefill.ts';
import { saveHour12, savedHour12, savedView, saveView, type SlotView } from './prefs.ts';
import { strings } from './strings.ts';
import {
  addDays,
  dayKey,
  dayLabels,
  localeUses12h,
  monthOf,
  offsetLabel,
  rangeLabel,
  startOfDay,
  timeLabel,
  zoneDisplay,
} from './time.ts';

/** Props for the page: its key, the visitor's language and zone, the clock, a prefill, and where success goes. */
export interface BookingPageProps {
  readonly publicKey: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly now: () => number;
  readonly prefill?: Prefill;
  /** Opens the guest page once booked. */
  readonly onBooked: (manageToken: string) => void;
}

type Client = ReturnType<typeof createBookingClient>;

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly page: PublicBookingPage }
  | { readonly state: 'gone' | 'closed' | 'failed' };

/** One slots read covers 62 days (two months of the month view). */
const CHUNK_DAYS = 62;

/** Where "Claim your free page" goes. */
const CLAIM_URL = 'https://timefix.ai';

/** How the location reads in the facts: "Video call", "Phone call", or the address or words the host gave. */
const locationLabel = (location: PublicBookingPage['location']) =>
  location.type === 'video'
    ? strings.locations.video
    : location.type === 'phone'
      ? strings.locations.phone
      : location.value;

/** The page: its facts load once, then the steps; each state as the experience note writes it. */
export function BookingPage({ publicKey, locale, timeZone, now, prefill, onBooked }: BookingPageProps) {
  const client = useMemo(() => createBookingClient({ origin: globalThis.location.origin }), []);
  const [startedAt] = useState(now);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  // The last preview message, kept until the page loads to lay it over.
  const [preview, setPreview] = useState<unknown>(undefined);
  const load = useCallback(() => {
    client.page(publicKey).then(
      (page) => setLoaded({ state: 'ready', page }),
      (error: unknown) => {
        const code = isDataError(error) ? error.code : undefined;
        setLoaded({ state: code === 'NOT_FOUND' ? 'gone' : code === 'BOOKING_CLOSED' ? 'closed' : 'failed' });
      },
    );
  }, [client, publicKey]);
  useEffect(load, [load]);
  // Inside the editor's preview frame, the editor's unsaved draft shows over the saved page (AC-679):
  // only from the parent window on this same origin.
  useEffect(() => {
    if (globalThis.parent === globalThis.window) return;
    const listen = (event: MessageEvent) => {
      if (event.origin !== globalThis.location.origin || event.source !== globalThis.parent) return;
      setPreview(event.data);
    };
    globalThis.addEventListener('message', listen);
    return () => {
      globalThis.removeEventListener('message', listen);
    };
  }, []);

  switch (loaded.state) {
    case 'ready':
      return (
        <Booking
          client={client}
          page={withPreviewDraft(loaded.page, preview) ?? loaded.page}
          locale={locale}
          detected={timeZone}
          now={now}
          startedAt={startedAt}
          onBooked={onBooked}
          {...(prefill === undefined ? {} : { prefill })}
        />
      );
    case 'loading':
      return <BookingFrame />;
    case 'gone':
      return <BookingMessage title={strings.notFoundTitle}>{strings.notFoundText}</BookingMessage>;
    case 'closed':
      return <BookingMessage title={strings.paused} />;
    case 'failed':
      return (
        <BookingMessage
          title={strings.failedTitle}
          onRetry={() => {
            setLoaded({ state: 'loading' });
            load();
          }}
        >
          {strings.failedText}
        </BookingMessage>
      );
  }
}

/** Every zone this browser knows, the current one first, each with its offset. */
function zoneItems(current: string, at: number): readonly SelectItem[] {
  const listed = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [current, ...listed.filter((zone) => zone !== current)].map((zone) => ({
    id: zone,
    label: zoneDisplay(zone, at).replace(/ \(.*\)$/, ''),
    description: offsetLabel(zone, at),
  }));
}

/** Every typed word must match the zone's name, city or offset ("york", "+8", "asia sing"). */
function zoneMatches(item: SelectItem, query: string): boolean {
  const words = `${item.id} ${item.label} ${item.description ?? ''}`.replaceAll(/[/_]/g, ' ').toLowerCase();
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .every((term) => words.includes(term));
}

/** The loaded page: the rail, the month and the times, then the details. */
function Booking({
  client,
  page,
  locale,
  detected,
  now,
  startedAt,
  prefill,
  onBooked,
}: {
  readonly client: Client;
  readonly page: PublicBookingPage;
  readonly locale: string;
  readonly detected: string;
  readonly now: () => number;
  readonly startedAt: number;
  readonly prefill?: Prefill;
  readonly onBooked: (manageToken: string) => void;
}) {
  const [zone, setZone] = useState(detected);
  const [hour12, setHour12] = useState(() => savedHour12() ?? localeUses12h(locale));
  const [view, setView] = useState<SlotView>(savedView);
  const [chosen, setDuration] = useState<number>(page.durations[0] ?? 30);
  // A length the page no longer offers (the editor's preview changed them) falls back to its first.
  const duration = page.durations.some((minutes) => minutes === chosen) ? chosen : (page.durations[0] ?? 30);
  const today = dayKey(now(), zone);
  const horizon = dayKey(now() + page.windowDays * 86_400_000, zone);
  const chunks = Math.max(1, Math.ceil(page.windowDays / CHUNK_DAYS));
  // Slots by chunk of 62 days from today, for the zone and length they were read in.
  const [read, setRead] = useState<{
    readonly key: string;
    readonly loaded: ReadonlyMap<number, readonly string[]>;
    readonly unreachable: boolean;
    readonly failed: boolean;
  }>({ key: '', loaded: new Map(), unreachable: false, failed: false });
  const [wanted, setWanted] = useState(0);
  const [reload, setReload] = useState(0);
  const readKey = `${zone}|${String(duration)}|${String(reload)}`;
  const [day, setDay] = useState<string | undefined>(undefined);
  const [month, setMonth] = useState(monthOf(today));
  const [time, setTime] = useState<string | undefined>(undefined);
  const [step, setStep] = useState<{
    readonly step: 'pick' | 'details';
    readonly attempt: string;
    readonly back: boolean;
  }>({ step: 'pick', attempt: '', back: false });
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const zones = useMemo(() => zoneItems(zone, now()), [zone, now]);
  // The tab names the meeting and the host: "Intro call with Ada · Timefix".
  useEffect(() => {
    document.title = `${page.title} with ${page.hostName} · ${strings.product}`;
  }, [page.title, page.hostName]);

  useEffect(() => {
    const current = read.key === readKey ? read.loaded : new Map<number, readonly string[]>();
    if (current.has(wanted)) return;
    const controller = new AbortController();
    const from = startOfDay(addDays(today, wanted * CHUNK_DAYS), zone);
    const to = startOfDay(addDays(today, (wanted + 1) * CHUNK_DAYS), zone);
    client
      .slots(
        page.publicKey,
        { from: new Date(Math.max(from, now())).toISOString(), to: new Date(to).toISOString(), duration, tz: zone },
        controller.signal,
      )
      .then(
        (answer) => {
          const next = new Map(current);
          next.set(
            wanted,
            answer.slots.map((slot) => slot.start),
          );
          setRead({ key: readKey, loaded: next, unreachable: answer.calendar === 'unreachable', failed: false });
          // The first open day is chosen on arrival (AC-665); further chunks on until one has times.
          const first = [...next.values()].flat().sort()[0];
          if (first === undefined && wanted + 1 < chunks) setWanted(wanted + 1);
          setDay((picked) => picked ?? (first === undefined ? undefined : dayKey(Date.parse(first), zone)));
          if (first !== undefined)
            setMonth((shown) => (shown === monthOf(today) ? monthOf(dayKey(Date.parse(first), zone)) : shown));
        },
        (error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setRead({ key: readKey, loaded: current, unreachable: false, failed: true });
        },
      );
    return () => controller.abort();
  }, [client, page.publicKey, zone, duration, wanted, readKey, read, today, chunks, now]);

  const loaded = read.key === readKey ? read.loaded : new Map<number, readonly string[]>();
  const starts = [...loaded.values()].flat().sort();
  const byDay = new Map<string, string[]>();
  for (const start of starts) {
    const key = dayKey(Date.parse(start), zone);
    byDay.set(key, [...(byDay.get(key) ?? []), start]);
  }
  const openDays = new Set(byDay.keys());
  const isLoading = !loaded.has(0) && !read.failed;
  // Moving to a month past what's read asks for its chunk.
  const showMonth = (next: string) => {
    setMonth(next);
    const offset = Math.floor((startOfDay(`${next}-01`, zone) - startOfDay(today, zone)) / 86_400_000 / CHUNK_DAYS);
    for (let chunk = 0; chunk <= Math.min(offset + 1, chunks - 1); chunk += 1) {
      if (!loaded.has(chunk)) {
        setWanted(chunk);
        break;
      }
    }
  };
  const resetChoice = () => {
    setDay(undefined);
    setTime(undefined);
    setMonth(monthOf(today));
    setWanted(0);
  };
  const pickDay = (next: string) => {
    setDay(next);
    setTime(undefined);
  };
  const dayHeading = day === undefined ? '' : dayLabels(day, locale).short;
  const times = day === undefined ? [] : (byDay.get(day) ?? []);

  const book = (values: BookingDetailsValues): Promise<BookingDetailsOutcome> => {
    if (time === undefined) return Promise.resolve({ kind: 'failed', message: strings.errors.failed });
    const needsPhone = page.location.type === 'phone';
    return client
      .book(page.publicKey, {
        idempotencyKey: step.attempt,
        start: time,
        duration: duration as 15 | 30 | 45 | 60 | 90,
        name: values.name,
        email: values.email,
        timeZone: zone,
        ...(needsPhone ? { phone: values.phone } : {}),
        ...(values.guests.length === 0 ? {} : { guests: [...values.guests] }),
        ...(values.note === '' ? {} : { note: values.note }),
        company_url: values.trap,
        startedAt,
      })
      .then(
        (booked): BookingDetailsOutcome => {
          onBooked(booked.manageToken);
          return { kind: 'done' };
        },
        (error: unknown): BookingDetailsOutcome => {
          if (!isDataError(error)) return { kind: 'failed', message: strings.errors.failed };
          if (error.code === 'SLOT_TAKEN') {
            // Back to fresh times, with the reason over them.
            setStep({ step: 'pick', attempt: '', back: true });
            setNotice(strings.errors.taken);
            setTime(undefined);
            setReload((count) => count + 1);
            return { kind: 'done' };
          }
          const fields: Record<string, string> = {};
          for (const issue of error.data?.issues ?? []) {
            const [field, index] = issue.path;
            const key = field === 'guests' && typeof index === 'number' ? `guest-${String(index)}` : field;
            if (typeof key === 'string' && fields[key] === undefined) fields[key] = issue.message;
          }
          for (const refusal of error.data?.refusals ?? []) {
            if (refusal.field !== undefined && fields[refusal.field] === undefined)
              fields[refusal.field] = refusal.message;
          }
          if (Object.keys(fields).length > 0) return { kind: 'invalid', fields };
          return {
            kind: 'failed',
            message:
              error.code === 'RATE_LIMITED'
                ? strings.errors.tooMany
                : error.code === 'BOOKING_CLOSED' || error.code === 'NOT_FOUND'
                  ? strings.errors.closed
                  : error.code === 'CONFIG_INVALID'
                    ? strings.errors.gone
                    : error.code === 'API_UNAVAILABLE'
                      ? strings.errors.offline
                      : strings.errors.failed,
          };
        },
      );
  };

  const isDetails = step.step === 'details' && time !== undefined;
  const facts: BookingFact[] = [];
  if (isDetails) {
    const end = new Date(Date.parse(time) + duration * 60_000).toISOString();
    facts.push({
      id: 'when',
      icon: 'calendar',
      children: `${dayLabels(dayKey(Date.parse(time), zone), locale).short}, ${rangeLabel(time, end, zone, locale, hour12)}`,
    });
  }
  facts.push(
    {
      id: 'meeting',
      icon: page.location.type === 'video' ? 'video' : page.location.type === 'phone' ? 'phone' : 'map-pin',
      children:
        page.durations.length > 1 && !isDetails ? (
          <SegmentedControl
            label={strings.length}
            value={String(duration)}
            onChange={(minutes) => {
              setDuration(Number(minutes));
              resetChoice();
            }}
            segments={page.durations.slice(0, 4).map((minutes) => ({
              value: String(minutes),
              label: strings.minutesShort(minutes),
            }))}
          />
        ) : (
          strings.meeting(duration, locationLabel(page.location))
        ),
    },
    {
      id: 'zone',
      icon: 'globe',
      children: isDetails ? (
        zoneDisplay(zone, now())
      ) : (
        <Select
          label={strings.timeZone}
          isLabelHidden
          variant="inline"
          items={zones}
          showsDescription
          isSearchable
          searchLabel={strings.zoneSearch}
          filter={zoneMatches}
          value={zone}
          onChange={(next) => {
            if (next === null || next === zone) return;
            setZone(next);
            resetChoice();
          }}
        />
      ),
    },
  );
  const frame = {
    host: { name: page.hostName },
    title: page.title,
    description: page.description,
    facts,
    claimHref: CLAIM_URL,
  };

  if (isDetails) {
    return (
      <BookingFrame {...frame}>
        <BookingDetails
          key={step.attempt}
          needsPhone={page.location.type === 'phone'}
          {...(prefill === undefined ? {} : { prefill })}
          onBack={() => {
            setStep({ step: 'pick', attempt: '', back: true });
            setNotice(undefined);
          }}
          onSubmit={book}
        />
      </BookingFrame>
    );
  }

  const noTimes = starts.length === 0 && loaded.size >= Math.min(chunks, 2);
  const message = read.unreachable ? (
    <Callout tone="warning">{strings.unreachable(page.hostName)}</Callout>
  ) : read.failed ? (
    <Callout
      tone="danger"
      actions={
        <Button icon="refresh-cw" onPress={() => setReload((count) => count + 1)}>
          {strings.retry}
        </Button>
      }
    >
      {strings.errors.failed}
    </Callout>
  ) : noTimes ? (
    <Callout tone="info" title={strings.noTimesTitle}>
      {strings.noTimesText}
    </Callout>
  ) : undefined;
  const slotList = (
    <SlotList
      heading={dayHeading}
      slots={times.map((start) => {
        const label = timeLabel(start, zone, locale, hour12);
        return { id: start, label, name: strings.timeName(label, dayHeading, duration) };
      })}
      value={time}
      onChange={setTime}
      hour12={hour12}
      onHour12Change={(next) => {
        setHour12(next);
        saveHour12(next);
      }}
      layout={view === 'month' ? 'column' : 'grid'}
      isLoading={isLoading}
      drawKey={`${day ?? ''}|${zone}|${view}`}
    />
  );
  const viewSwitch = (
    <SegmentedControl
      label={strings.view}
      value={view}
      onChange={(next) => {
        const picked = next === 'list' ? 'list' : 'month';
        setView(picked);
        saveView(picked);
      }}
      segments={[
        { value: 'month', label: strings.month, icon: 'calendar', isIconOnly: true },
        { value: 'list', label: strings.list, icon: 'list', isIconOnly: true },
      ]}
    />
  );

  const bookBar = (
    <Button
      variant="primary"
      size="lg"
      isFullWidth="center"
      isDisabled={time === undefined}
      onPress={() => {
        setNotice(undefined);
        setStep({ step: 'details', attempt: crypto.randomUUID(), back: false });
      }}
    >
      {time === undefined ? strings.book : strings.bookAt(dayHeading, timeLabel(time, zone, locale, hour12))}
    </Button>
  );

  return (
    <BookingFrame
      {...frame}
      heading={strings.chooseTime}
      toolbar={viewSwitch}
      {...(message === undefined ? { footer: bookBar } : {})}
      {...(view === 'month' && message === undefined ? { aside: slotList } : {})}
    >
      {notice !== undefined && <Callout tone="danger">{notice}</Callout>}
      {message ??
        (view === 'month' ? (
          <MonthTiles
            month={month}
            today={today}
            openDays={openDays}
            value={day}
            onChange={pickDay}
            onMonthChange={showMonth}
            canPrevious={month > monthOf(today)}
            canNext={month < monthOf(horizon)}
            focusesValue={step.back}
          />
        ) : (
          <>
            <DayStrip days={[...openDays].sort()} value={day} onChange={pickDay} focusesValue={step.back} />
            {slotList}
          </>
        ))}
    </BookingFrame>
  );
}
