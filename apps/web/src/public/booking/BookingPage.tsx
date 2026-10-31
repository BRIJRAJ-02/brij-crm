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
import type {
  BookingDetails as DetailsStep,
  BookingDetailsOutcome,
  BookingDetailsValues,
} from '@crm/ui/public-booking/details';
import {
  BookingFrame,
  BookingMessage,
  Button,
  Callout,
  claimPageHref,
  DayStrip,
  DeferredSelect,
  MonthTiles,
  SegmentedControl,
  Skeleton,
  SlotList,
  type BookingFact,
  type DeferredSelectItem,
  type SelectItem,
} from '@crm/ui/public-booking';
import { createElement, lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { railBrand, railHost, railTitle } from './host.ts';
import { brandHref, preloadImage, wearStylesheet } from '../stylesheet.ts';
import type { ChatMemory } from './ChatPanel.tsx';
import type { Prefill } from './prefill.ts';
import {
  openedBefore,
  rememberOpened,
  saveHour12,
  savedHour12,
  savedView,
  saveView,
  viewOf,
  type SlotView,
} from './prefs.ts';
import { needsRead, pageEnded } from './reads.ts';
import { refusalLine } from './refusal.ts';
import { guessCountry } from '../country.ts';
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
  zoneName,
} from './time.ts';
import { readReturn, returnPath, tidiedAddress, type Chosen, type ConnectResult } from './visitor.ts';
import type { MatchCalendarStep } from '@crm/ui/public-booking/visitor';

// The visitor bar and the details step load beside the first paint, not in it (the page's size budget): both
// start loading as this module does, so they are there long before the page's own read answers.
const visitorModule = import('@crm/ui/public-booking/visitor');
const detailsModule = import('@crm/ui/public-booking/details');
const VisitorBar = lazy(() => visitorModule.then((module) => ({ default: module.VisitorBar })));
// Book by chat (spec 0042) loads only when Chat is first chosen.
const ChatPanel = lazy(() => import('./ChatPanel.tsx').then((module) => ({ default: module.ChatPanel })));
const BookingDetails = lazy(() => detailsModule.then((module) => ({ default: module.BookingDetails })));

/** One minute in milliseconds. */
const MINUTE_MS = 60_000;

/** The instant `now` gives, read again just after each minute turns: a clock's minute that never goes stale. */
function useMinute(now: () => number): number {
  const [minute, setMinute] = useState(now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => {
      // A beat past the turn, so the reading lands in the new minute.
      timer = setTimeout(
        () => {
          setMinute(now());
          next();
        },
        MINUTE_MS - (now() % MINUTE_MS) + 50,
      );
    };
    next();
    return () => {
      clearTimeout(timer);
    };
  }, [now]);
  return minute;
}

/**
 * The details step once its code is in, which it nearly always is by the time a visitor presses Book: drawn at once,
 * so it slides in with the step rather than after a Suspense fallback's hold. Until then (or if it failed) the page
 * draws it through the lazy path, as before.
 */
function useLoadedDetails(): typeof DetailsStep | undefined {
  const [loaded, setLoaded] = useState<{ readonly step: typeof DetailsStep } | undefined>(undefined);
  useEffect(() => {
    let isCurrent = true;
    detailsModule.then(
      (module) => {
        if (isCurrent) setLoaded({ step: module.BookingDetails });
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, []);
  return loaded?.step;
}

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
  /**
   * The page has a handle address (`/<handle>/<slug>`, 22 Oct 2026): a plain `/b/<key>` visit shows it in the
   * address bar.
   */
  readonly onAddress?: (path: string) => void;
}

type Client = ReturnType<typeof createBookingClient>;

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly page: PublicBookingPage }
  | { readonly state: 'gone' | 'closed' | 'failed' };

/** One slots read covers 62 days (two months of the month view). */
const CHUNK_DAYS = 62;

/** How many other matching times See the other times offers: a handful, not every match the horizon holds. */
const MATCH_OTHERS = 6;

/** Where "Claim your free page" goes: www.timefix.com, tagged as this page's claim link (the wordmark beside it tags itself). */
const CLAIM_URL = claimPageHref('booking_page');

/** How the location reads in the facts: "Video call", "Phone call", or the address or words the host gave. */
const locationLabel = (location: PublicBookingPage['location']) =>
  location.type === 'video'
    ? strings.locations.video
    : location.type === 'phone'
      ? strings.locations.phone
      : location.value;

/** The page: its facts load once, then the steps; each state as the experience note writes it. */
export function BookingPage({
  publicKey,
  locale,
  timeZone,
  now,
  prefill: given,
  handoff,
  onBooked,
  onAddress,
}: BookingPageProps) {
  const client = useMemo(() => createBookingClient({ origin: globalThis.location.origin }), []);
  // A form's hand off fills the name and email once the API vouches for it; anything else leaves them empty.
  const [handed, setHanded] = useState<Prefill | undefined>(undefined);
  useEffect(() => {
    if (handoff === undefined) return;
    let isCurrent = true;
    client.prefill(publicKey, handoff).then(
      (answer) => {
        if (
          isCurrent &&
          (answer.name !== undefined ||
            answer.email !== undefined ||
            answer.answers !== undefined ||
            answer.skip !== undefined)
        )
          setHanded(answer);
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
  // The editor's own preview, as against a site's embed: a frame whose address carries no embed marker (`frame.ts`).
  // Only the editor's preview shows the host their setting over their own remembered choice.
  const isEditorPreview = isPreview && new URLSearchParams(globalThis.location.search).get('embed') !== '1';
  // The address this visit began at, read before the page's handle address replaces it: what the opening view is
  // kept under, so the next visit to the same link draws the same shape.
  const [addressPath] = useState(() => globalThis.location.pathname);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  // Who the visitor is (spec 0028), asked for as the page's own facts are, not after them: the two answers then
  // land together, so the card is drawn once with the visitor's bar or without it, and never with a held place
  // that is taken back a moment later.
  const [viewer, setViewer] = useState<PublicViewerAnswer | undefined>(undefined);
  // The last preview message, kept until the page loads to lay it over.
  const [preview, setPreview] = useState<unknown>(undefined);
  const load = useCallback(() => {
    client.page(publicKey).then(
      (page) => {
        if (page.path !== undefined) onAddress?.(page.path);
        // The brand it wears (spec 0060, AC-4), waited on a moment so the page draws in its colour from the start,
        // with its logo already decoded, so the logo is there with the header rather than pushing it down later.
        void Promise.all([
          wearStylesheet(document, brandHref('booking', page.publicKey, page.brand?.version)),
          preloadImage(railBrand(page).brand?.logo?.src),
        ]).then(() => {
          setLoaded({ state: 'ready', page });
        });
      },
      (error: unknown) => {
        const code = isDataError(error) ? error.code : undefined;
        setLoaded({ state: code === 'NOT_FOUND' ? 'gone' : code === 'BOOKING_CLOSED' ? 'closed' : 'failed' });
      },
    );
  }, [client, publicKey, onAddress]);
  useEffect(load, [load]);
  useEffect(() => {
    if (isPreview) return;
    let isCurrent = true;
    client.viewer(publicKey).then(
      (answer) => {
        if (isCurrent) setViewer(answer);
      },
      () => {
        // A refused read answers nobody, rather than nothing: left unsettled, the bar's held place would pulse
        // above a page that is otherwise perfectly usable, for the rest of the visit.
        if (isCurrent) setViewer({ isHost: false, canConnect: false });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [client, publicKey, isPreview]);
  // A slot read can find the page deleted or paused after it loaded: then that state shows, not a retry.
  const ended = useCallback((state: 'gone' | 'closed') => setLoaded({ state }), []);
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
          onEnded={ended}
          chosen={back.chosen}
          isPreview={isPreview}
          isEditorPreview={isEditorPreview}
          addressPath={addressPath}
          {...(viewer === undefined ? {} : { viewer })}
          {...(back.result === undefined ? {} : { connected: back.result })}
          {...(prefill === undefined ? {} : { prefill })}
          {...(handoff === undefined ? {} : { handoff })}
        />
      );
    case 'loading':
      return <LoadingBooking locale={locale} timeZone={timeZone} now={now} />;
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

/** The view switch's segments: Month, List or Chat, the same three the loaded page offers. */
const viewSegments = [
  { value: 'month', label: strings.month, icon: 'calendar' as const, isIconOnly: true },
  { value: 'list', label: strings.list, icon: 'list' as const, isIconOnly: true },
  { value: 'chat', label: strings.chat, icon: 'message-square' as const, isIconOnly: true },
];

/**
 * The page while its facts are still coming: the same frame, the same card,
 * the real month of the visitor's own zone with no day open yet, and a time's
 * box in each of the times' places. Nothing here is a different shape from
 * what arrives, so when the facts land the page fills in rather than moving.
 * The two switches are the loaded page's own and keep working: what they
 * remember is what the loaded page opens with.
 */
export function LoadingBooking({
  locale,
  timeZone,
  now,
}: {
  readonly locale: string;
  readonly timeZone: string;
  readonly now: () => number;
}) {
  // The address this shape is drawn at, read once, before a handle address replaces it.
  const [addressPath] = useState(() => globalThis.location.pathname);
  // The host's default comes with the facts, which this shape can't wait for, so it holds the place the page took
  // here last time (a choice made on it, else its host's default as it was then), and Month for a page never met.
  const [view, setView] = useState<SlotView>(() => openedBefore(addressPath) ?? 'month');
  const [hour12, setHour12] = useState(() => savedHour12() ?? localeUses12h(locale));
  const today = dayKey(now(), timeZone);
  // A page that opens on chat fetches the chat's code at once, beside the page's read, not after it.
  useEffect(() => {
    if (view === 'chat') void import('./ChatPanel.tsx');
  }, [view]);
  const times = (layout: 'column' | 'grid') => (
    <SlotList
      heading=""
      slots={[]}
      value={undefined}
      onChange={() => undefined}
      hour12={hour12}
      onHour12Change={(next) => {
        setHour12(next);
        saveHour12(next);
      }}
      layout={layout}
      isLoading
    />
  );
  const bookBar = (
    <Button variant="primary" size="lg" isFullWidth="center" isDisabled>
      {strings.book}
    </Button>
  );
  return (
    <BookingFrame
      claimHref={CLAIM_URL}
      heading={strings.chooseTime}
      toolbar={
        <SegmentedControl
          label={strings.view}
          value={view}
          onChange={(next) => {
            const picked = next === 'list' || next === 'chat' ? next : 'month';
            setView(picked);
            saveView(addressPath, picked);
          }}
          segments={viewSegments}
        />
      }
      view={view}
      // The month sets the card's size in every view, so List and Chat draw over it, as the loaded page does.
      aside={times('column')}
      footer={bookBar}
      {...(view === 'list'
        ? {
            cover: (
              <>
                <DayStrip days={[]} value={undefined} onChange={() => undefined} isLoading />
                {times('grid')}
              </>
            ),
            coverFooter: bookBar,
          }
        : view === 'chat'
          ? { cover: <ChatLoading /> }
          : {})}
    >
      <MonthTiles
        month={monthOf(today)}
        today={today}
        openDays={NO_DAYS}
        value={undefined}
        onChange={() => undefined}
        onMonthChange={() => undefined}
        canPrevious={false}
        canNext={false}
        isLoading
      />
    </BookingFrame>
  );
}

/** The chat's shape while it loads: the greeting's place at the top and the composer's at the foot. */
function ChatLoading() {
  return (
    <>
      <Skeleton shape="block" lines={3} />
      <Skeleton shape="block" />
    </>
  );
}

/** No day is open until the times arrive. */
const NO_DAYS: ReadonlySet<string> = new Set();

/** Every zone this browser knows, the current one first, each with its offset. */
function zoneItems(current: string, at: number, clock: string): readonly DeferredSelectItem[] {
  const listed = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [current, ...listed.filter((zone) => zone !== current)].map((zone) => ({
    id: zone,
    label: zoneName(zone),
    // The zone in use shows its time now beside its offset ("GMT+7 · 14:06"), as Calendly's does, so a visitor
    // checks the zone at a glance. Look only: what the zone does is unchanged.
    description: zone === current ? `${offsetLabel(zone, at)} · ${clock}` : offsetLabel(zone, at),
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
  onEnded,
  chosen,
  connected,
  isPreview,
  isEditorPreview,
  addressPath,
  viewer,
}: {
  readonly handoff?: string;
  readonly chosen: Chosen;
  /** What a guest connect just answered. */
  readonly connected?: ConnectResult;
  /** Inside a frame of any kind: no visitor. */
  readonly isPreview: boolean;
  /** Inside the editor's preview, so the host sees the view they set rather than the one they last picked. */
  readonly isEditorPreview: boolean;
  /** The address this visit began at, which the opening view is kept under. */
  readonly addressPath: string;
  /** Who the visitor is (spec 0028), read beside the page's own facts so both land together; undefined while it loads. */
  readonly viewer?: PublicViewerAnswer;
  readonly client: Client;
  readonly page: PublicBookingPage;
  readonly locale: string;
  readonly detected: string;
  readonly now: () => number;
  readonly startedAt: number;
  readonly prefill?: Prefill;
  readonly onBooked: (manageToken: string) => void;
  /** The page was deleted or paused since it loaded. */
  readonly onEnded: (state: 'gone' | 'closed') => void;
}) {
  const [zone, setZone] = useState(chosen.zone ?? detected);
  // The visitor's country, guessed once, for a phone or country question of the page's own (spec 0057).
  const [countryGuess] = useState(guessCountry);
  const [hour12, setHour12] = useState(() => savedHour12() ?? localeUses12h(locale));
  // The view the host set the page to open in. The facts are read without a schema, so an API that doesn't send it
  // yet reads as Month, the view every page had before this was a setting.
  // A page with a required question books through its form only (owner, 26 Oct 2026): no Chat, which asks none.
  const isChatOff = (page.questions ?? []).some((question) => question.required);
  const hostView = viewOf(page.defaultView) ?? 'month';
  const opensIn = isChatOff && hostView === 'chat' ? 'month' : hostView;
  // The view this opens in (owner, 25 Oct 2026): what was chosen on this page before, else the host's own default,
  // which came with the page's facts. Read once, as the card is first drawn, so the page never paints and swaps.
  // A page whose entry has been pushed out opens in its host's default again, never in nothing.
  const [picked, setView] = useState<SlotView>(() => savedView(addressPath) ?? opensIn);
  // The editor's preview is inert, so nothing inside it switches the view: it reads the host's setting straight from
  // the page, and the choice they haven't saved yet shows the moment they pick it. A visitor keeps their own.
  const view = isEditorPreview ? opensIn : isChatOff && picked === 'chat' ? 'month' : picked;
  // The view this page opens in, kept under the address the visit began at, so a later visit's loading shape holds
  // the place the page will take.
  useEffect(() => {
    if (!isEditorPreview) rememberOpened(addressPath, opensIn);
  }, [isEditorPreview, addressPath, opensIn]);
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
  const LoadedDetails = useLoadedDetails();
  const [step, setStep] = useState<{
    readonly step: 'pick' | 'details';
    readonly attempt: string;
    readonly back: boolean;
  }>({ step: 'pick', attempt: '', back: false });
  const [notice, setNotice] = useState<string | undefined>(undefined);
  // "Not you?": no name, no email and no overlay for the rest of the visit.
  const [notYou, setNotYou] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // Match with your calendar (the owner, 25 Oct 2026): the dialog opens from the page's call to action, and
  // again on the way back from Google, where it waits for the overlay before it says what matched.
  const [matchOpen, setMatchOpen] = useState(connected === 'connected');
  // Book by chat's conversation (spec 0042), kept while the length, the zone or the view changes.
  const [chatMemory, setChatMemory] = useState<ChatMemory | undefined>(undefined);
  // The time now in the zone in use, on the page's clock (12 or 24 hours), beside its name: it ticks on each minute's
  // turn, so a page left open never shows a stale time.
  const minute = useMinute(now);
  const clockNow = timeLabel(new Date(minute).toISOString(), zone, locale, hour12);
  const zones = useMemo(() => zoneItems(zone, now(), clockNow), [zone, now, clockNow]);
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
          const end = pageEnded(isDataError(error) ? error.code : undefined);
          if (end !== undefined) {
            onEnded(end);
            return;
          }
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
  }, [
    client,
    page.publicKey,
    zone,
    duration,
    wanted,
    readKey,
    read,
    today,
    chunks,
    now,
    notYou,
    showAll,
    handoff,
    onEnded,
  ]);

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
        ...(Object.keys(values.answers).length === 0 ? {} : { answers: { ...values.answers } }),
        company_url: values.trap,
        startedAt,
        ...(handoff === undefined ? {} : { prefill: handoff }),
      })
      .then(
        (booked): BookingDetailsOutcome => {
          onBooked(booked.manageToken);
          return { kind: 'done' };
        },
        (error: unknown): BookingDetailsOutcome | Promise<BookingDetailsOutcome> => {
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
          // The answer's sentence goes too, when a visitor can read it: the form says it when none of these is a field it shows.
          if (Object.keys(fields).length > 0)
            return refusalLine(error.message, fields).then((message): BookingDetailsOutcome => ({
              kind: 'invalid',
              fields,
              ...(message === undefined ? {} : { message }),
            }));
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
                      : error.code === 'INPUT_INVALID'
                        ? strings.errors.check
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
        `${zoneDisplay(zone, now())} · ${clockNow}`
      ) : (
        // The picker's list loads on the first hover, focus or press (or once the page is idle): a visitor rarely
        // opens it, and its code was a tenth of the page's first load styles. Until then the same trigger stands in.
        <DeferredSelect
          label={strings.timeZone}
          items={zones}
          showsDescription
          isSearchable
          searchLabel={strings.zoneSearch}
          placeholder={strings.zoneChoose}
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
  // What the match found: the times both are free, the best of them first (the server picks Best: the soonest
  // shared times in working hours with a gap either side, packages/core/src/booking/overlay.ts).
  const matches = isOverlaid ? allStarts.filter((start) => !clashes.has(start)) : [];
  const bestMatch = matches.find((start) => best.has(start)) ?? matches[0];
  const otherMatches = matches.filter((start) => start !== bestMatch).slice(0, MATCH_OTHERS);
  const matchDays = [...new Map(otherMatches.map((start) => [dayKey(Date.parse(start), zone), []])).keys()].map(
    (key) => ({
      day: dayLabels(key, locale).short,
      times: otherMatches
        .filter((start) => dayKey(Date.parse(start), zone) === key)
        .map((start) => {
          const label = timeLabel(start, zone, locale, hour12);
          return { id: start, label, name: strings.timeName(label, dayLabels(key, locale).short, duration) };
        }),
    }),
  );
  // Waiting always has somewhere to go: a calendar we couldn't read, a read that failed, and a trip to Google
  // that came back with no calendar on all land on the failed state, which offers Try again and Close.
  const matchStep: MatchCalendarStep =
    isUnreadable || read.failed
      ? 'failed'
      : isOverlaid
        ? matches.length === 0
          ? 'unmatched'
          : 'matched'
        : person?.calendar === 'on'
          ? 'waiting'
          : connected === 'connected'
            ? viewer === undefined
              ? 'waiting'
              : 'failed'
            : person?.calendar === 'needs-reconnect'
              ? 'failed'
              : 'why';
  const bookMatch = (start: string) => {
    setMatchOpen(false);
    setNotice(undefined);
    const key = dayKey(Date.parse(start), zone);
    setDay(key);
    // The month moves with it, so Back from the details form lands on the day it booked.
    setMonth(monthOf(key));
    setTime(start);
    setStep({ step: 'details', attempt: crypto.randomUUID(), back: false });
  };
  const canMatch = connectHref !== undefined || person?.calendar === 'on';
  const match =
    canMatch && !isPreview
      ? {
          step: matchStep,
          isOpen: matchOpen,
          onOpenChange: setMatchOpen,
          host: { name: page.hostName, ...(page.hostImage === undefined ? {} : { image: page.hostImage }) },
          ...(known === undefined ? {} : { visitor: known }),
          ...(connectHref === undefined ? {} : { connectHref }),
          ...(bestMatch === undefined
            ? {}
            : {
                result: {
                  count: matches.length,
                  best: {
                    id: bestMatch,
                    label: timeLabel(bestMatch, zone, locale, hour12),
                    name: strings.timeName(
                      timeLabel(bestMatch, zone, locale, hour12),
                      dayLabels(dayKey(Date.parse(bestMatch), zone), locale).short,
                      duration,
                    ),
                    ...(best.has(bestMatch) ? { isBest: true } : {}),
                  },
                  when: strings.matchWhen(
                    timeLabel(bestMatch, zone, locale, hour12),
                    dayLabels(dayKey(Date.parse(bestMatch), zone), locale).short,
                  ),
                  ...(matchDays.length === 0 ? {} : { days: matchDays }),
                },
              }),
          onBook: bookMatch,
          // Already showing every time: the dialog is left with Close alone rather than a primary that does nothing.
          ...(showAll
            ? {}
            : {
                onShowAll: () => {
                  setShowAll(true);
                },
              }),
        }
      : undefined;
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
          {/* holdsBar is only true off an embed, so the call to action's own space is the space to hold. */}
          {holdsBar && <VisitorBar isLoading holdsMatch />}
          {showsBar && (
            <VisitorBar
              {...(person === undefined
                ? {}
                : { person: { name: person.name, email: person.email }, onNotYou: forget })}
              {...(barCalendar === undefined ? {} : { calendar: barCalendar })}
              {...(connectHref === undefined ? {} : { connectHref })}
              showAll={showAll}
              onShowAllChange={setShowAll}
              {...(match === undefined ? {} : { match })}
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
    ...railBrand(page),
    ...(banner === undefined ? {} : { banner }),
  };

  // The details step (spec 0025) draws over the whole card, its heading row too: the month stays underneath and
  // keeps the card its size, so the step moves nothing but its own content in, from the end, and Back from the start.
  // The page's own questions, less any a form's hand off already answered onto the same attribute (AC-5713).
  const handedSkip = prefill?.skip ?? [];
  const asked = (page.questions ?? []).filter((question) => !handedSkip.includes(question.key));
  const detailsProps = {
    needsPhone: page.location.type === 'phone',
    // The page's own questions (spec 0057), after the note; a page with none draws nothing more (AC-5704).
    ...(asked.length === 0
      ? {}
      : {
          questions: asked,
          ...(countryGuess === undefined ? {} : { countryGuess }),
          ...(prefill?.answers === undefined ? {} : { prefillAnswers: prefill.answers }),
        }),
    ...(known === undefined ? (prefill === undefined ? {} : { prefill }) : { prefill: known }),
    onBack: () => {
      setStep({ step: 'pick', attempt: '', back: true });
      setNotice(undefined);
    },
    onSubmit: book,
  };
  const detailsStep = !isDetails ? undefined : LoadedDetails === undefined ? (
    <Suspense fallback={null}>
      <BookingDetails key={step.attempt} {...detailsProps} />
    </Suspense>
  ) : (
    createElement(LoadedDetails, { key: step.attempt, ...detailsProps })
  );
  // The form says who's booking, with its own Not you: the bar would say it twice.
  const { banner: _bar, ...withoutBar } = frame;

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
  const slotList = (layout: 'column' | 'grid') => (
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
      layout={layout}
      isLoading={isLoading}
      drawKey={`${day ?? ''}|${zone}`}
    />
  );
  const viewSwitch = (
    <SegmentedControl
      label={strings.view}
      value={view}
      onChange={(next) => {
        const picked = next === 'list' || next === 'chat' ? next : 'month';
        setView(picked);
        // A switch is a fresh look: the taken time's note goes, and no day takes focus from the switch.
        setStep((now) => (now.back ? { ...now, back: false } : now));
        setNotice(undefined);
        saveView(addressPath, picked);
      }}
      segments={[
        { value: 'month', label: strings.month, icon: 'calendar', isIconOnly: true },
        { value: 'list', label: strings.list, icon: 'list', isIconOnly: true },
        ...(isChatOff
          ? []
          : [{ value: 'chat', label: strings.chat, icon: 'message-square' as const, isIconOnly: true }]),
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
  const noticeLine =
    notice === undefined ? undefined : (
      // Said as it shows: Back put focus on the day, and the reason is why.
      <Callout tone="danger" isAnnounced>
        {notice}
      </Callout>
    );

  if (message !== undefined && detailsStep === undefined) {
    // Nothing to pick in any view: the message alone, the same card whichever view is chosen.
    return (
      <BookingFrame {...frame} heading={strings.chooseTime} toolbar={viewSwitch} view={view}>
        {noticeLine}
        {message}
      </BookingFrame>
    );
  }

  // The month is the card in every view: List and Book by chat (spec 0042) draw over it, in exactly its box, so a
  // switch between views moves nothing on the page (the owner, 25 October 2026).
  const cover =
    detailsStep ??
    (view === 'list' ? (
      <>
        {noticeLine}
        <DayStrip
          days={[...openDays].sort()}
          bestDays={bestDays}
          value={day}
          onChange={pickDay}
          focusesValue={step.back}
          // Its tiles' places until the first times arrive, so the times below never move up to meet them.
          isLoading={isLoading && openDays.size === 0}
        />
        {slotList('grid')}
      </>
    ) : view === 'chat' ? (
      chatMemory === undefined && allStarts.length === 0 && !noTimes ? (
        <ChatLoading />
      ) : (
        <Suspense fallback={<ChatLoading />}>
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
      )
    ) : undefined);

  return (
    <BookingFrame
      {...(isDetails ? withoutBar : frame)}
      heading={strings.chooseTime}
      toolbar={viewSwitch}
      view={isDetails ? 'details' : view}
      {...(isDetails
        ? { coverPlace: 'card' as const, enter: 'forward' as const }
        : step.back
          ? { enter: 'back' as const }
          : {})}
      aside={slotList('column')}
      footer={bookBar}
      {...(cover === undefined ? {} : { cover })}
      {...(view === 'list' && !isDetails ? { coverFooter: bookBar } : {})}
    >
      {noticeLine}
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
        focusesValue={step.back && view === 'month'}
      />
    </BookingFrame>
  );
}
