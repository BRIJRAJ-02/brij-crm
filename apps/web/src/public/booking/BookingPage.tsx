// Brief
// Purpose: the visitor's booking page at /b/<publicKey> (spec 0025, 0025-experience.md): book time with a member.
// Main task: see the first open day's times at once, pick a time, press Book, give a name and email, confirm.
// Leaves out: questions (milestone 2), analytics and captcha. A form's signed hand off fills the name and email (AC-1058).
//
// The visitor's own calendar (spec 0028): signed in to Timefix here, they are known (the bar on top, their name and
// email filled, their calendar laid over the times); anyone else may connect Google for the visit. Clashing times
// hide unless Show all times is on, up to three are marked Best, and a calendar that can't be read shows every time.
//
// Drawn with the library (`@crm/ui/public-booking`, since 20 October 2026, as the hosted form is): one card with
// the host's rail, the month and the day's times, after the timefix booking page and calendars' scheduling pages.
// This file holds the page's state and reads; the modules draw.
import {
  createBookingClient,
  isDataError,
  withPreviewDraft,
  type PublicBookingPage,
  type PublicViewerAnswer,
  type SlotsOverlay,
} from '@crm/data/booking';
import type { BookingDetailsOutcome, BookingDetailsValues } from '@crm/ui/public-booking/details';
import {
  BookingFrame,
  BookingMessage,
  Button,
  Callout,
  DayStrip,
  MonthTiles,
  SegmentedControl,
  Select,
  Skeleton,
  SlotList,
  type BookingFact,
  type SelectItem,
} from '@crm/ui/public-booking';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { railHost, railTitle } from './host.ts';
import type { ChatMemory } from './ChatPanel.tsx';
import type { Prefill } from './prefill.ts';
import { saveHour12, savedHour12, savedView, saveView, type SlotView } from './prefs.ts';
import { needsRead } from './reads.ts';
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
import { readReturn, returnPath, tidiedAddress, type Chosen, type ConnectResult } from './visitor.ts';

// The visitor bar and the details step load beside the first paint, not in it (the page's size budget): both
// start loading as this module does, so they are there long before the page's own read answers.
const visitorModule = import('@crm/ui/public-booking/visitor');
const detailsModule = import('@crm/ui/public-booking/details');
const VisitorBar = lazy(() => visitorModule.then((module) => ({ default: module.VisitorBar })));
// Book by chat (spec 0042) loads only when Chat is first chosen.
const ChatPanel = lazy(() => import('./ChatPanel.tsx').then((module) => ({ default: module.ChatPanel })));
const BookingDetails = lazy(() => detailsModule.then((module) => ({ default: module.BookingDetails })));

/** Props for the page: its key, the visitor's language and zone, the clock, a prefill, and where success goes. */
export interface BookingPageProps {
  readonly publicKey: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly now: () => number;
  readonly prefill?: Prefill;
  /** A form's signed hand off (spec 0023 AC-1058): its name and email come from the API, and it rides on the booking. */
  readonly handoff?: string;
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
export function BookingPage({ publicKey, locale, timeZone, now, prefill: given, handoff, onBooked }: BookingPageProps) {
  const client = useMemo(() => createBookingClient({ origin: globalThis.location.origin }), []);
  // A form's hand off fills the name and email once the API vouches for it; anything else leaves them empty.
  const [handed, setHanded] = useState<Prefill | undefined>(undefined);
  useEffect(() => {
    if (handoff === undefined) return;
    let isCurrent = true;
    client.prefill(publicKey, handoff).then(
      (answer) => {
        if (isCurrent && (answer.name !== undefined || answer.email !== undefined)) setHanded(answer);
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [client, publicKey, handoff]);
  const prefill = given ?? handed;
  const [startedAt] = useState(now);
  // What a return from Google carried (the choices and what happened), read once; the address is then tidied.
  const [back] = useState(() => readReturn(new URL(globalThis.location.href)));
  useEffect(() => {
    const tidied = tidiedAddress(new URL(globalThis.location.href));
    if (tidied !== undefined) globalThis.history.replaceState(globalThis.history.state, '', tidied);
  }, []);
  const isPreview = globalThis.parent !== globalThis.window;
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
          chosen={back.chosen}
          isPreview={isPreview}
          {...(back.result === undefined ? {} : { connected: back.result })}
          {...(prefill === undefined ? {} : { prefill })}
          {...(handoff === undefined ? {} : { handoff })}
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
  handoff,
  onBooked,
  chosen,
  connected,
  isPreview,
}: {
  readonly handoff?: string;
  readonly chosen: Chosen;
  /** What a guest connect just answered. */
  readonly connected?: ConnectResult;
  /** Inside the editor's preview: no visitor. */
  readonly isPreview: boolean;
  readonly client: Client;
  readonly page: PublicBookingPage;
  readonly locale: string;
  readonly detected: string;
  readonly now: () => number;
  readonly startedAt: number;
  readonly prefill?: Prefill;
  readonly onBooked: (manageToken: string) => void;
}) {
  const [zone, setZone] = useState(chosen.zone ?? detected);
  const [hour12, setHour12] = useState(() => savedHour12() ?? localeUses12h(locale));
  const [view, setView] = useState<SlotView>(savedView);
  const [length, setDuration] = useState<number>(chosen.duration ?? page.durations[0] ?? 30);
  // A length the page no longer offers (the editor's preview changed them) falls back to its first.
  const duration = page.durations.some((minutes) => minutes === length) ? length : (page.durations[0] ?? 30);
  const today = dayKey(now(), zone);
  const horizon = dayKey(now() + page.windowDays * 86_400_000, zone);
  const chunks = Math.max(1, Math.ceil(page.windowDays / CHUNK_DAYS));
  // Slots by chunk of 62 days from today, for the zone and length they were read in.
  const [read, setRead] = useState<{
    readonly key: string;
    readonly loaded: ReadonlyMap<number, readonly string[]>;
    /** The visitor's calendar over each chunk (spec 0028), when they have one. */
    readonly overlays: ReadonlyMap<number, SlotsOverlay>;
    readonly unreachable: boolean;
    readonly failed: boolean;
  }>({ key: '', loaded: new Map(), overlays: new Map(), unreachable: false, failed: false });
  // A day brought back from Google is read with its chunk first.
  const [wanted, setWanted] = useState(() =>
    chosen.day === undefined || chosen.day < today
      ? 0
      : Math.max(
          0,
          Math.min(
            chunks - 1,
            Math.floor((startOfDay(chosen.day, zone) - startOfDay(today, zone)) / 86_400_000 / CHUNK_DAYS),
          ),
        ),
  );
  const [reload, setReload] = useState(0);
  // Coming back to the page reads the times again, so hours the host changed meanwhile show (the owner, 22 October
  // 2026): the server answers with no-store, and nothing else would read them until a reload.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === 'visible') setReload((count) => count + 1);
    };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, []);
  const readKey = `${zone}|${String(duration)}|${String(reload)}`;
  const [pickedDay, setDay] = useState<string | undefined>(
    chosen.day !== undefined && chosen.day >= today ? chosen.day : undefined,
  );
  const [month, setMonth] = useState(monthOf(pickedDay ?? today));
  const [pickedTime, setTime] = useState<string | undefined>(undefined);
  const [step, setStep] = useState<{
    readonly step: 'pick' | 'details';
    readonly attempt: string;
    readonly back: boolean;
  }>({ step: 'pick', attempt: '', back: false });
  const [notice, setNotice] = useState<string | undefined>(undefined);
  // Who the visitor is (spec 0028): undefined while it loads, and in the editor's preview.
  const [viewer, setViewer] = useState<PublicViewerAnswer | undefined>(undefined);
  // "Not you?": no name, no email and no overlay for the rest of the visit.
  const [notYou, setNotYou] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // Book by chat's conversation (spec 0042), kept while the length, the zone or the view changes.
  const [chatMemory, setChatMemory] = useState<ChatMemory | undefined>(undefined);
  useEffect(() => {
    if (isPreview) return;
    let isCurrent = true;
    client.viewer(page.publicKey).then(
      (answer) => {
        if (isCurrent) setViewer(answer);
      },
      () => {
        // Nobody in particular: the page works the same.
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [client, page.publicKey, isPreview]);
  const zones = useMemo(() => zoneItems(zone, now()), [zone, now]);
  // The tab names the meeting and the host: "Intro call with Ada · Timefix".
  useEffect(() => {
    document.title = `${page.title} with ${page.hostName} · ${strings.product}`;
  }, [page.title, page.hostName]);

  useEffect(() => {
    if (!needsRead(read, readKey, wanted)) return;
    const current = read.key === readKey ? read.loaded : new Map<number, readonly string[]>();
    const controller = new AbortController();
    const from = startOfDay(addDays(today, wanted * CHUNK_DAYS), zone);
    const to = startOfDay(addDays(today, (wanted + 1) * CHUNK_DAYS), zone);
    client
      .slots(
        page.publicKey,
        {
          from: new Date(Math.max(from, now())).toISOString(),
          to: new Date(to).toISOString(),
          duration,
          tz: zone,
          // A form's hand off: a team page then offers only the hosts its routing chose (spec 0043).
          ...(handoff === undefined ? {} : { p: handoff }),
        },
        controller.signal,
      )
      .then(
        (answer) => {
          const next = new Map(current);
          next.set(
            wanted,
            answer.slots.map((slot) => slot.start),
          );
          const overlays = new Map(read.key === readKey ? read.overlays : []);
          if (answer.viewer === undefined) overlays.delete(wanted);
          else overlays.set(wanted, answer.viewer);
          setRead({
            key: readKey,
            loaded: next,
            overlays,
            unreachable: answer.calendar === 'unreachable',
            failed: false,
          });
          // The first open day is chosen on arrival (AC-665); further chunks on until one has times, the
          // visitor's clashes left out while they're hidden (spec 0028), so a busy first chunk reads on.
          const hidden = new Set(
            notYou || showAll
              ? []
              : [...overlays.values()].filter((each) => each.calendar === 'ok').flatMap((each) => each.clashes),
          );
          const first = [...next.values()]
            .flat()
            .filter((start) => !hidden.has(start))
            .sort()[0];
          if (first === undefined && wanted + 1 < chunks) setWanted(wanted + 1);
          setDay((picked) => picked ?? (first === undefined ? undefined : dayKey(Date.parse(first), zone)));
          if (first !== undefined)
            setMonth((shown) => (shown === monthOf(today) ? monthOf(dayKey(Date.parse(first), zone)) : shown));
        },
        (error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setRead({
            key: readKey,
            loaded: current,
            overlays: read.key === readKey ? read.overlays : new Map(),
            unreachable: false,
            failed: true,
          });
        },
      );
    return () => controller.abort();
  }, [client, page.publicKey, zone, duration, wanted, readKey, read, today, chunks, now, notYou, showAll, handoff]);

  const loaded = read.key === readKey ? read.loaded : new Map<number, readonly string[]>();
  const allStarts = [...loaded.values()].flat().sort();
  // The visitor's calendar over what's read (spec 0028, AC-723 to AC-726), unless they said Not you.
  const overlays = notYou || read.key !== readKey ? [] : [...read.overlays.values()];
  const isOverlaid = overlays.some((each) => each.calendar === 'ok');
  const isUnreadable = overlays.length > 0 && overlays.every((each) => each.calendar === 'unreachable');
  const clashes = new Set(overlays.flatMap((each) => each.clashes));
  const best = new Set(overlays.flatMap((each) => each.best));
  const hidesClashes = isOverlaid && !showAll;
  const starts = hidesClashes ? allStarts.filter((start) => !clashes.has(start)) : allStarts;
  const byDay = new Map<string, string[]>();
  for (const start of starts) {
    const key = dayKey(Date.parse(start), zone);
    byDay.set(key, [...(byDay.get(key) ?? []), start]);
  }
  const openDays = new Set(byDay.keys());
  const bestDays = new Set(starts.filter((start) => best.has(start)).map((start) => dayKey(Date.parse(start), zone)));
  // With clashes hidden, a day left with no time (the first day on arrival, or one brought back from Google)
  // gives way to the first day that has one, and a picked time that now clashes is let go.
  const day =
    hidesClashes && (pickedDay === undefined || !openDays.has(pickedDay))
      ? ([...openDays].sort()[0] ?? pickedDay)
      : pickedDay;
  const time = pickedTime !== undefined && hidesClashes && clashes.has(pickedTime) ? undefined : pickedTime;
  const isAllHidden = hidesClashes && allStarts.length > 0 && starts.length === 0;
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
        duration,
        name: values.name,
        email: values.email,
        timeZone: zone,
        ...(needsPhone ? { phone: values.phone } : {}),
        ...(values.guests.length === 0 ? {} : { guests: [...values.guests] }),
        ...(values.note === '' ? {} : { note: values.note }),
        company_url: values.trap,
        startedAt,
        ...(handoff === undefined ? {} : { prefill: handoff }),
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
  // The visitor we know (from their sign in or the Google account they connected), unless they said Not you.
  const person = notYou ? undefined : viewer?.viewer;
  const known = person === undefined ? undefined : { name: person.name, email: person.email };
  const forget = () => {
    setNotYou(true);
    setShowAll(false);
    // A guest's calendar is forgotten at the server too, and the times read again without it.
    if (person?.source === 'google') {
      client.forget().then(
        () => setReload((count) => count + 1),
        () => setReload((count) => count + 1),
      );
    }
  };
  const connectHref =
    viewer?.canConnect === true && (person === undefined || person.source === 'google')
      ? client.connectUrl(
          page.publicKey,
          returnPath(page.publicKey, { duration, zone, ...(day === undefined ? {} : { day }) }),
        )
      : undefined;
  const barCalendar =
    person === undefined
      ? undefined
      : person.calendar === 'on'
        ? isUnreadable
          ? 'unreachable'
          : 'on'
        : person.calendar;
  const showsBar = viewer !== undefined && !viewer.isHost && (person !== undefined || connectHref !== undefined);
  // Its space is held while the page asks who the visitor is, so the card doesn't jump down under a reaching hand.
  const holdsBar = viewer === undefined && !isPreview;
  const connectNote =
    connected === undefined || connected === 'connected' || notYou ? undefined : strings.connectResults[connected];
  const banner =
    showsBar || holdsBar || connectNote !== undefined ? (
      <>
        {connectNote !== undefined && (
          <Callout tone={connected === 'denied' ? 'info' : 'warning'} isAnnounced>
            {connectNote}
          </Callout>
        )}
        <Suspense fallback={null}>
          {holdsBar && <VisitorBar isLoading />}
          {showsBar && (
            <VisitorBar
              {...(person === undefined
                ? {}
                : { person: { name: person.name, email: person.email }, onNotYou: forget })}
              {...(barCalendar === undefined ? {} : { calendar: barCalendar })}
              {...(connectHref === undefined ? {} : { connectHref })}
              showAll={showAll}
              onShowAllChange={setShowAll}
            />
          )}
        </Suspense>
      </>
    ) : undefined;
  const frame = {
    host: railHost(page),
    title: railTitle(page),
    description: page.description,
    facts,
    claimHref: CLAIM_URL,
    ...(banner === undefined ? {} : { banner }),
  };

  if (isDetails) {
    // The form says who's booking, with its own Not you: the bar would say it twice.
    const { banner: _bar, ...details } = frame;
    return (
      <BookingFrame {...details}>
        <Suspense fallback={null}>
          <BookingDetails
            key={step.attempt}
            needsPhone={page.location.type === 'phone'}
            {...(known === undefined ? (prefill === undefined ? {} : { prefill }) : { prefill: known })}
            onBack={() => {
              setStep({ step: 'pick', attempt: '', back: true });
              setNotice(undefined);
            }}
            onSubmit={book}
          />
        </Suspense>
      </BookingFrame>
    );
  }

  const noTimes = allStarts.length === 0 && loaded.size >= Math.min(chunks, 2);
  // Every open time clashes with the visitor's calendar: say so, with Show all times.
  const allBusy = isAllHidden && loaded.size >= Math.min(chunks, 2);
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
  ) : allBusy ? (
    <Callout
      tone="info"
      actions={
        <Button
          onPress={() => {
            setShowAll(true);
            // The note goes as the times come: focus stays with the switch that now says Show all times.
            globalThis.requestAnimationFrame(() =>
              document.querySelector<HTMLElement>('[aria-label="Your calendar"] [role="switch"]')?.focus(),
            );
          }}
        >
          {strings.showAllTimes}
        </Button>
      }
    >
      {strings.allBusy(page.hostName)}
    </Callout>
  ) : undefined;
  const slotList = (
    <SlotList
      heading={dayHeading}
      slots={times.map((start) => {
        const label = timeLabel(start, zone, locale, hour12);
        return {
          id: start,
          label,
          name: strings.timeName(label, dayHeading, duration),
          ...(best.has(start) ? { isBest: true } : {}),
          ...(isOverlaid && showAll && clashes.has(start) ? { isBusy: true } : {}),
        };
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
        const picked = next === 'list' || next === 'chat' ? next : 'month';
        setView(picked);
        saveView(picked);
      }}
      segments={[
        { value: 'month', label: strings.month, icon: 'calendar', isIconOnly: true },
        { value: 'list', label: strings.list, icon: 'list', isIconOnly: true },
        { value: 'chat', label: strings.chat, icon: 'message-square', isIconOnly: true },
      ]}
    />
  );

  if (view === 'chat') {
    // Book by chat (spec 0042): the same card and rail, the conversation in the picker's place.
    return (
      <BookingFrame {...frame} heading={strings.chooseTime} toolbar={viewSwitch}>
        {message ??
          (chatMemory === undefined && allStarts.length === 0 && !noTimes ? (
            <Skeleton shape="block" lines={4} />
          ) : (
            <Suspense fallback={<Skeleton shape="block" lines={4} />}>
              <ChatPanel
                client={client}
                page={page}
                locale={locale}
                zone={zone}
                hour12={hour12}
                duration={duration}
                starts={allStarts}
                startedAt={startedAt}
                memory={chatMemory}
                onMemory={setChatMemory}
                onDuration={setDuration}
                onBooked={onBooked}
              />
            </Suspense>
          ))}
      </BookingFrame>
    );
  }

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
            bestDays={bestDays}
            value={day}
            onChange={pickDay}
            onMonthChange={showMonth}
            canPrevious={month > monthOf(today)}
            canNext={month < monthOf(horizon)}
            focusesValue={step.back}
          />
        ) : (
          <>
            <DayStrip
              days={[...openDays].sort()}
              bestDays={bestDays}
              value={day}
              onChange={pickDay}
              focusesValue={step.back}
            />
            {slotList}
          </>
        ))}
    </BookingFrame>
  );
}
