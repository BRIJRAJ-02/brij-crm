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
  type PublicManagedBooking,
  type PublicSlots,
  type PublicViewerAnswer,
  type SlotsOverlay,
} from '@crm/data/booking';
import type {
  BookingDetails as DetailsStep,
  BookingDetailsOutcome,
  BookingDetailsValues,
  DayStrip as DayStripType,
} from '@crm/ui/public-booking/details';
import {
  BookingChatGhost,
  BookingFrame,
  BookingMessage,
  Button,
  Callout,
  claimPageHref,
  DeferredSelect,
  MonthTiles,
  SegmentedControl,
  SlotList,
  type BookingFact,
  type DeferredSelectItem,
  type SelectItem,
} from '@crm/ui/public-booking';
import {
  createElement,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
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
import { oneOffHash } from './one-off.ts';
import { keepTicket, type TicketKeeper } from './ticket.ts';
import { landingOf } from '../landing.ts';
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
  zoneName,
} from './time.ts';
import { openingOf } from './at-param.ts';
import { returnPath, tidiedAddress, type Chosen, type ConnectResult } from './visitor.ts';
import type { MatchCalendarStep } from '@crm/ui/public-booking/visitor';

// The visitor bar and the details step load beside the first paint, not in it (the page's size budget): both
// start loading as this module does, so they are there long before the page's own read answers.
const visitorModule = import('@crm/ui/public-booking/visitor');
const detailsModule = import('@crm/ui/public-booking/details');
const VisitorBar = lazy(() => visitorModule.then((module) => ({ default: module.VisitorBar })));
// Book by chat (spec 0042) loads only when Chat is first chosen.
const ChatPanel = lazy(() => import('./ChatPanel.tsx').then((module) => ({ default: module.ChatPanel })));
const BookingDetails = lazy(() => detailsModule.then((module) => ({ default: module.BookingDetails })));
// The List view's days ride with the details step's code (the first load's CSS budget, 5 Nov 2026): most pages open
// on Month, and the chunk is in long before a visitor switches.
const LazyDayStrip = lazy(() => detailsModule.then((module) => ({ default: module.DayStrip })));
// The receipt the card turns into once booked (critic C1): the guest page's own module, fetched as Confirm is pressed.
const loadManage = () => import('./ManagePage.tsx');
const ManagePage = lazy(() => loadManage().then((module) => ({ default: module.ManagePage })));

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
function useLoadedDetails(): { readonly step: typeof DetailsStep; readonly days: typeof DayStripType } | undefined {
  const [loaded, setLoaded] = useState<
    { readonly step: typeof DetailsStep; readonly days: typeof DayStripType } | undefined
  >(undefined);
  useEffect(() => {
    let isCurrent = true;
    detailsModule.then(
      (module) => {
        if (isCurrent) setLoaded({ step: module.BookingDetails, days: module.DayStrip });
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, []);
  return loaded;
}

/** The List view's days: drawn at once once their code is in (nearly always), else through the lazy path. */
function DayStrip(props: ComponentProps<typeof DayStripType>) {
  const loaded = useLoadedDetails();
  return loaded === undefined ? (
    <Suspense fallback={null}>
      <LazyDayStrip {...props} />
    </Suspense>
  ) : (
    createElement(loaded.days, props)
  );
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
  /**
   * Opens the guest page once booked, with where a redirect page sends the visitor next (spec 0062, AC-6201).
   */
  readonly onBooked: (manageToken: string, redirectUrl?: string) => void;
  /**
   * Booked, and the receipt is drawn in the card itself (critic C1): the entry shows the guest page's address in
   * place, or inside a site's embed tells the site. Left out, every booking goes through `onBooked`.
   */
  readonly onBookedHere?: (manageToken: string) => void;
  /**
   * Inside a site's embed (critic B-01): the guest page's address, which the in-card receipt opens in a new tab as
   * its one action rather than offering the changes inside someone else's frame.
   */
  readonly manageHrefOf?: (manageToken: string) => string;
  /** A one off link's token from the address's fragment (spec 0062, AC-6204). */
  readonly oneOffToken?: string;
  /**
   * The page has a handle address (`/<handle>/<slug>`, 22 Oct 2026): a plain `/b/<key>` visit shows it in the
   * address bar.
   */
  readonly onAddress?: (path: string) => void;
}

type Client = ReturnType<typeof createBookingClient>;

/**
 * The first chunk's times, asked for beside the page's facts rather than after them (4 Nov 2026: the times waited on
 * the facts, then on the brand's stylesheet, a round trip each, 2 to 3 seconds on a phone): the zone and length it
 * was read for, and its answer. The page takes it only when it wants exactly that read; anything else reads afresh.
 */
interface EarlySlots {
  readonly zone: string;
  /** The length asked for; undefined asked for the page's first, which the page opens on. */
  readonly duration: number | undefined;
  readonly answer: Promise<PublicSlots>;
}

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly page: PublicBookingPage; readonly early?: EarlySlots }
  | { readonly state: 'gone' | 'closed' | 'failed' | 'busy' | 'used' | 'invitation' };

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

/** Whether this page is drawn inside a site's embed (`embed=1`, `frame.ts`), so it takes its content's height. */
const isEmbedded = () => new URLSearchParams(globalThis.location.search).get('embed') === '1';

/** The page: its facts load once, then the steps; each state as the experience note writes it. */
export function BookingPage({
  publicKey,
  locale,
  timeZone,
  now,
  prefill: given,
  handoff,
  oneOffToken,
  onBooked,
  onBookedHere,
  manageHrefOf,
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
  // The fill ticket (spec 0023, B-04), asked for as the page loads and kept ready (`ticket.ts`): the server's clock for
  // the bot check a booking passes.
  // passes. A booking without one is refused as too fast, so the page carries it rather than its own clock.
  const [tickets] = useState(() => keepTicket(() => client.ticket(publicKey)));
  // A one off link's token hashed once (spec 0062): the facts and every slots read send it (B-10).
  const [linkHash] = useState(() =>
    oneOffToken === undefined ? Promise.resolve(undefined) : oneOffHash(oneOffToken).catch(() => undefined),
  );
  // What a return from Google carried (the choices and what happened), read once; the address is then tidied.
  // What this visit opened with: a return from Google (the choices and what happened), and a next times chip's
  // `at` and `len` (spec 0061, AC-6110). Read once; the Google parts are then tidied out of the address.
  const [back] = useState(() =>
    openingOf(new URL(globalThis.location.href), now(), (startMs) => dayKey(startMs, timeZone)),
  );
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
  // A failed first read is tried again once, quietly, before the page says it couldn't reach it (critic B-14).
  const quietRetries = useRef(1);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A quiet retry still waiting when the page goes is let go.
  useEffect(() => () => clearTimeout(retryTimer.current), []);
  const [attempt, setAttempt] = useState(0);
  // A page that turned out closed, with whose it is when the read said (critic B-09).
  const [closedHost, setClosedHost] = useState<{ readonly name: string; readonly image?: string } | undefined>(
    undefined,
  );
  const load = useCallback(() => {
    // The first chunk's times, beside the facts (EarlySlots): only when the page opens on that chunk.
    const zone = back.chosen.zone ?? timeZone;
    const today = dayKey(now(), zone);
    const opensOnFirst = back.chosen.day === undefined || back.chosen.day < addDays(today, CHUNK_DAYS);
    const early: EarlySlots | undefined = opensOnFirst
      ? {
          zone,
          duration: back.chosen.duration,
          answer: linkHash.then((o) =>
            client.slots(publicKey, {
              from: new Date(Math.max(startOfDay(today, zone), now())).toISOString(),
              to: new Date(startOfDay(addDays(today, CHUNK_DAYS), zone)).toISOString(),
              tz: zone,
              ...(back.chosen.duration === undefined ? {} : { duration: back.chosen.duration }),
              ...(handoff === undefined ? {} : { p: handoff }),
              ...(o === undefined ? {} : { o }),
            }),
          ),
        }
      : undefined;
    // Nobody may take it (the page turned out closed, or gone): its failure is then nobody's to report.
    early?.answer.catch(() => undefined);
    linkHash
      .then((o) => client.page(publicKey, handoff, o))
      .then(
        (page) => {
          // A one off link with nothing left to book (spec 0062, AC-6204): its own calm state.
          if (page.linkUsed === true) {
            setLoaded({ state: 'used' });
            return;
          }
          // A page that books only through one-time links, opened without one (AC-6204).
          if (page.invitationOnly === true && !isEditorPreview) {
            setLoaded({ state: 'invitation' });
            return;
          }
          // A page that books only through a form, reached without one (spec 0037, AC-1388): its closed state. The
          // host's own editor preview still draws it.
          if (page.formOnly === true && !isEditorPreview) {
            setClosedHost({ name: page.hostName, ...(page.hostImage === undefined ? {} : { image: page.hostImage }) });
            setLoaded({ state: 'closed' });
            return;
          }
          if (page.path !== undefined) onAddress?.(page.path);
          // A template that pins its scheme (spec 0068: Night dark, Studio light) pins the whole document's, so the
          // foot's mark and anything opened outside the frame take it too. Never in the editor's preview, which is the
          // app's.
          const pinned =
            page.brand?.template === 'night' ? 'dark' : page.brand?.template === 'studio' ? 'light' : undefined;
          if (pinned !== undefined && !isEditorPreview) document.documentElement.dataset.theme = pinned;
          // A page that opens on Book by chat fetches the chat's code now, beside its times, not once they're in.
          const opens = isEditorPreview
            ? viewOf(page.defaultView)
            : (savedView(addressPath) ?? viewOf(page.defaultView));
          if (opens === 'chat') void import('./ChatPanel.tsx');
          // The brand it wears (spec 0060, AC-4), waited on a moment so the page draws in its colour from the start,
          // with its logo already decoded, so the logo is there with the header rather than pushing it down later.
          void Promise.all([
            wearStylesheet(document, brandHref('booking', page.publicKey, page.brand?.version)),
            preloadImage(railBrand(page).brand?.logo?.src),
          ]).then(() => {
            setLoaded({ state: 'ready', page, ...(early === undefined ? {} : { early }) });
          });
        },
        (error: unknown) => {
          const code = isDataError(error) ? error.code : undefined;
          const state =
            code === 'NOT_FOUND'
              ? 'gone'
              : code === 'BOOKING_CLOSED'
                ? 'closed'
                : // Too many reads from this address for a moment (B-18): busy, not broken.
                  code === 'RATE_LIMITED'
                  ? 'busy'
                  : 'failed';
          // A failed (not busy) first read is tried again once, quietly, before the page says so (critic B-14).
          if (state === 'failed' && quietRetries.current > 0) {
            quietRetries.current -= 1;
            retryTimer.current = globalThis.setTimeout(() => setAttempt((count) => count + 1), QUIET_RETRY_MS);
            return;
          }
          setLoaded({ state });
        },
      );
  }, [client, publicKey, handoff, linkHash, isEditorPreview, onAddress, back, timeZone, now, addressPath]);
  // A quiet retry (`attempt`) reads again with the same `load`.
  useEffect(load, [load, attempt]);
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
  // Insights (spec 0067, AC-6702): the view, once a visit, with the landing address's UTM tags and the referrer; never
  // from the editor's own preview, which is the host looking at their page. An embed on a site counts.
  const [landing] = useState(() => landingOf(globalThis.location.href));
  useEffect(() => {
    if (isEditorPreview) return;
    const referrer = document.referrer === '' ? undefined : document.referrer.slice(0, 400);
    client.event(publicKey, {
      kind: 'view',
      ...(landing === undefined ? {} : { landing }),
      ...(referrer === undefined ? {} : { referrer }),
    });
  }, [client, publicKey, isEditorPreview, landing]);
  // A slot read can find the page deleted or paused after it loaded: then that state shows, not a retry.
  const ended = useCallback((state: 'gone' | 'closed' | 'used') => setLoaded({ state }), []);
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
          tickets={tickets}
          linkHash={linkHash}
          onBooked={onBooked}
          {...(onBookedHere === undefined ? {} : { onBookedHere })}
          {...(manageHrefOf === undefined ? {} : { manageHrefOf })}
          onEnded={ended}
          {...(loaded.early === undefined ? {} : { early: loaded.early })}
          chosen={back.chosen}
          {...(back.at === undefined ? {} : { at: back.at })}
          {...(back.times === undefined ? {} : { sharedTimes: back.times })}
          isPreview={isPreview}
          isEditorPreview={isEditorPreview}
          addressPath={addressPath}
          {...(viewer === undefined ? {} : { viewer })}
          {...(back.result === undefined ? {} : { connected: back.result })}
          {...(prefill === undefined ? {} : { prefill })}
          {...(handoff === undefined ? {} : { handoff })}
          {...(oneOffToken === undefined ? {} : { oneOffToken })}
        />
      );
    case 'used':
      return <BookingMessage title={strings.linkUsedTitle}>{strings.linkUsedText}</BookingMessage>;
    case 'invitation':
      return <BookingMessage title={strings.invitationTitle}>{strings.invitationText}</BookingMessage>;
    case 'loading':
      return <LoadingBooking locale={locale} timeZone={timeZone} now={now} />;
    case 'gone':
      return <BookingMessage title={strings.notFoundTitle}>{strings.notFoundText}</BookingMessage>;
    case 'closed': {
      // Whose page it is, and the way on to their link page (critic B-09): a handle address names it.
      const handle = linkPageOf(addressPath);
      return (
        <BookingMessage
          title={closedHost === undefined ? strings.paused : strings.pausedBy(closedHost.name)}
          {...(closedHost === undefined ? {} : { host: closedHost })}
          {...(handle === undefined
            ? {}
            : {
                action: {
                  href: handle,
                  // Their first name when the page said whose it is, else a neutral way on, never the address.
                  label:
                    closedHost === undefined
                      ? strings.seeTheirPage
                      : strings.seePage(closedHost.name.split(/\s+/u)[0] ?? closedHost.name),
                },
              })}
        >
          {handle === undefined ? undefined : strings.pausedText}
        </BookingMessage>
      );
    }
    case 'failed':
    case 'busy':
      return (
        <BookingMessage
          title={loaded.state === 'busy' ? strings.busyTitle : strings.failedTitle}
          onRetry={() => {
            setLoaded({ state: 'loading' });
            load();
          }}
        >
          {/* Busy says why (B-18); a failed read's heading and Try again say it all (critic B-14). */}
          {loaded.state === 'busy' ? strings.busyText : undefined}
        </BookingMessage>
      );
  }
}

/** How long the quiet second try waits after a failed first read (critic B-14). */
const QUIET_RETRY_MS = 900;

/** The link page a handle address belongs to (`/ada/intro-call` is Ada's, `/ada`); a `/b/<key>` address has none. */
function linkPageOf(path: string): string | undefined {
  const match = /^\/([a-z0-9][a-z0-9-]{1,38}[a-z0-9])\/[a-z0-9][a-z0-9-]{0,59}\/?$/.exec(path);
  return match?.[1] === undefined ? undefined : `/${match[1]}`;
}

/** The view switch's segments: Month, List or Chat, the same three the loaded page offers. */
const viewSegments = [
  { value: 'month', label: strings.month, icon: 'calendar' as const, isIconOnly: true },
  { value: 'list', label: strings.list, icon: 'list' as const, isIconOnly: true },
  { value: 'chat', label: strings.chat, icon: 'message-square' as const, isIconOnly: true },
];

/** The clock switch's segments, beside the view switch in the picker's corner (spec 0058, AC-24). */
const clockSegments = [
  { value: '12', label: strings.hours12 },
  { value: '24', label: strings.hours24 },
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
  const [hour12] = useState(() => savedHour12() ?? localeUses12h(locale));
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
      layout={layout}
      isLoading
    />
  );
  // Book is not there until a time is picked: its band says so quietly, as the loaded page's does.
  const bookBar = null;
  return (
    <BookingFrame
      isEmbedded={isEmbedded()}
      claimHref={CLAIM_URL}
      heading={strings.chooseTime}
      footerWaiting={strings.pickTime}
      toolbar={
        <>
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
        </>
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
        holdsHeight={!isEmbedded()}
        isLoading
      />
    </BookingFrame>
  );
}

/**
 * The chat's shape while it loads: the host's name and face, the greeting's bubble, a day's times and the prompt box,
 * where the chat puts them.
 */
function ChatLoading() {
  return <BookingChatGhost />;
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
  tickets,
  linkHash,
  prefill,
  handoff,
  oneOffToken,
  onBooked,
  onBookedHere,
  manageHrefOf,
  onEnded,
  chosen,
  at,
  sharedTimes,
  connected,
  isPreview,
  isEditorPreview,
  addressPath,
  viewer,
  early,
}: {
  /** The first chunk's times, asked for beside the page's facts: taken by the first read that wants exactly them. */
  readonly early?: EarlySlots;
  readonly handoff?: string;
  readonly chosen: Chosen;
  /**
   * The time a next times chip asked for (spec 0061, AC-6110), as the instant it names: once the page's times are
   * in, that time is chosen and the details form opens on it. A time that is gone by then says so over fresh times.
   */
  readonly at?: string;
  /**
   * The times a host shared (Share specific times, 5 November 2026): the page offers only these, each while it is
   * still free, so a taken one simply isn't there.
   */
  readonly sharedTimes?: readonly string[];
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
  /** The page's fill ticket (B-04): every booking and chat turn carries it. */
  readonly tickets: TicketKeeper;
  /** The one off link's token hashed, when the page was opened with one (B-10): every slots read sends it. */
  readonly linkHash: Promise<string | undefined>;
  readonly prefill?: Prefill;
  readonly onBooked: (manageToken: string, redirectUrl?: string) => void;
  readonly onBookedHere?: (manageToken: string) => void;
  readonly manageHrefOf?: (manageToken: string) => string;
  /** A one off link's token (spec 0062, AC-6204): sent with the booking, never in an address. */
  readonly oneOffToken?: string;
  /** The page was deleted or paused since it loaded, or its one off link was used meanwhile. */
  readonly onEnded: (state: 'gone' | 'closed' | 'used') => void;
}) {
  const [zone, setZone] = useState(chosen.zone ?? detected);
  // The visitor's country, guessed once, for a phone or country question of the page's own (spec 0057).
  const [countryGuess] = useState(guessCountry);
  const [hour12, setHour12] = useState(() => savedHour12() ?? localeUses12h(locale));
  // The view the host set the page to open in. The facts are read without a schema, so an API that doesn't send it
  // yet reads as Month, the view every page had before this was a setting.
  // Book by chat asks the page's questions too (4 Nov 2026), so every page offers it.
  const opensIn = viewOf(page.defaultView) ?? 'month';
  // The view this opens in (owner, 25 Oct 2026): what was chosen on this page before, else the host's own default,
  // which came with the page's facts. Read once, as the card is first drawn, so the page never paints and swaps.
  // A page whose entry has been pushed out opens in its host's default again, never in nothing.
  const [picked, setView] = useState<SlotView>(() => savedView(addressPath) ?? opensIn);
  // The editor's preview is inert, so nothing inside it switches the view: it reads the host's setting straight from
  // the page, and the choice they haven't saved yet shows the moment they pick it. A visitor keeps their own.
  const view = isEditorPreview ? opensIn : picked;
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
  // Whether the read asked beside the page's facts has answered its chunk: it answers once, never a later read.
  const isEarlyTaken = useRef(false);
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
  const LoadedDetails = useLoadedDetails()?.step;
  const [step, setStep] = useState<{
    readonly step: 'pick' | 'details';
    readonly attempt: string;
    readonly back: boolean;
  }>({ step: 'pick', attempt: '', back: false });
  const [notice, setNotice] = useState<string | undefined>(undefined);
  // The shared times, as instants, for the reads to keep only those (Share specific times).
  const shared = useMemo(
    () => (sharedTimes === undefined ? undefined : new Set(sharedTimes.map((each) => Date.parse(each)))),
    [sharedTimes],
  );
  // Booked, with the receipt drawn in the card (critic C1): the guest page's token and the booking as it now stands.
  const [booked, setBooked] = useState<{ readonly token: string; readonly booking: PublicManagedBooking } | undefined>(
    undefined,
  );
  // Book, so Enter on a time can hand it focus (critic C7, QA B-14).
  const bookButton = useRef<HTMLButtonElement>(null);
  // Whether a next times chip's time has been answered (spec 0061, AC-6110): once a visit, whatever happens next.
  const isAtDone = useRef(at === undefined);
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
    // As the share preview names it (critic C3): "Intro call with Ada Lovelace".
    document.title = `${page.title} with ${page.hostName}`;
  }, [page.title, page.hostName]);

  useEffect(() => {
    if (!needsRead(read, readKey, wanted)) return;
    const current = read.key === readKey ? read.loaded : new Map<number, readonly string[]>();
    const controller = new AbortController();
    const from = startOfDay(addDays(today, wanted * CHUNK_DAYS), zone);
    const to = startOfDay(addDays(today, (wanted + 1) * CHUNK_DAYS), zone);
    // The read asked beside the page's facts answers the first chunk, once, when it was read for this zone and length.
    const isEarly =
      early !== undefined &&
      !isEarlyTaken.current &&
      wanted === 0 &&
      reload === 0 &&
      early.zone === zone &&
      (early.duration ?? page.durations[0]) === duration;
    const request = isEarly
      ? early.answer
      : linkHash.then((o) =>
          client.slots(
            page.publicKey,
            {
              from: new Date(Math.max(from, now())).toISOString(),
              to: new Date(to).toISOString(),
              duration,
              tz: zone,
              // A form's hand off: a team page then offers only the hosts its routing chose (spec 0043).
              ...(handoff === undefined ? {} : { p: handoff }),
              ...(o === undefined ? {} : { o }),
            },
            controller.signal,
          ),
        );
    request.then(
      (answer) => {
        // A read this effect no longer wants (the early one, which nothing aborts) changes nothing.
        if (controller.signal.aborted) return;
        if (isEarly) isEarlyTaken.current = true;
        const next = new Map(current);
        next.set(
          wanted,
          answer.slots
            .map((slot) => slot.start)
            // A shared link offers only the times its host picked, of those still free.
            .filter((start) => shared === undefined || shared.has(Date.parse(start))),
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
        // The time a next times chip asked for (spec 0061, AC-6110), answered by the read that covers it: it is
        // chosen and the details form opens on it, as Match with your calendar's own times do. A time that went
        // between the link page drawing the chip and this read says so, over that day's other times.
        const asked = at === undefined ? undefined : Date.parse(at);
        if (asked !== undefined && !isAtDone.current) {
          // The read that covers the asked time answers it; a time no read can ever cover (one in the past, or
          // past the page's horizon) is answered once the last chunk is in, so the page never waits in silence.
          const covers = asked >= from && asked < to;
          const isLast = wanted + 1 >= chunks;
          if (covers || asked < from || isLast) {
            isAtDone.current = true;
            // A time the visitor's own calendar clashes with is no better an answer here than a taken one: the
            // picker would not have offered it, so it takes the same line rather than opening the form on it.
            const match = covers
              ? (next.get(wanted) ?? []).find((start) => Date.parse(start) === asked && !hidden.has(start))
              : undefined;
            if (match === undefined) {
              // A time already gone by is said as such, not as taken (critic B-08).
              setNotice(asked <= now() ? strings.errors.atPast : strings.errors.atGone);
              // Back's own path: focus lands on the chosen day, where the times the line promises are.
              setStep({ step: 'pick', attempt: '', back: true });
            } else {
              const key = dayKey(asked, zone);
              setDay(key);
              setMonth(monthOf(key));
              setTime(match);
              setStep({ step: 'details', attempt: crypto.randomUUID(), back: false });
            }
          }
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
        if (isEarly) isEarlyTaken.current = true;
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
    linkHash,
    onEnded,
    at,
    shared,
    early,
    reload,
    page.durations,
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

  /**
   * Where a booking lands (critic C1): a redirect page goes on as before (`onBooked`); anything else reads the booking
   * now and, once called, draws its receipt as the card's last step, sliding in where the details were, while the
   * address becomes the guest page's. A read that fails falls back to opening the guest page.
   */
  const arrival = (token: string, redirectUrl?: string): (() => void) => {
    if (redirectUrl !== undefined || onBookedHere === undefined) return () => onBooked(token, redirectUrl);
    const ready = Promise.all([client.managed(token), loadManage()]);
    // Settled either way before anyone waits on it, so a failure is never an unhandled rejection.
    ready.catch(() => undefined);
    return () => {
      ready.then(
        ([booking]) => {
          setBooked({ token, booking });
          onBookedHere(token);
        },
        () => onBooked(token),
      );
    };
  };

  const book = (values: BookingDetailsValues): Promise<BookingDetailsOutcome> => {
    if (time === undefined) return Promise.resolve({ kind: 'failed', message: strings.errors.failed });
    const needsPhone = page.location.type === 'phone';
    return tickets
      .take()
      .then((filled) =>
        client.book(page.publicKey, {
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
          ...(filled === undefined ? {} : { ticket: filled }),
          ...(handoff === undefined ? {} : { prefill: handoff }),
          ...(oneOffToken === undefined ? {} : { oneOffToken }),
        }),
      )
      .then(
        (answer): BookingDetailsOutcome => {
          // The receipt opens once Confirm has shown Booked for a beat; it is read meanwhile.
          const arrive = arrival(answer.manageToken, answer.redirectUrl);
          return {
            kind: 'done',
            next: () => {
              arrive();
            },
          };
        },
        (error: unknown): BookingDetailsOutcome | Promise<BookingDetailsOutcome> => {
          if (!isDataError(error)) return { kind: 'failed', message: strings.errors.failed };
          // The link's last use went to someone else meanwhile (AC-6204).
          if (error.code === 'LINK_USED') {
            onEnded('used');
            return { kind: 'done' };
          }
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

  const isDetails = booked === undefined && step.step === 'details' && time !== undefined;
  // The steps after the times (the details, then the receipt) draw over the whole card and say when in the rail.
  const isPastTimes = isDetails || booked !== undefined;
  // Insights (spec 0067, AC-6702): each step this visit reached, once (a time picked, then the details), never from
  // the editor's preview. The server keeps only the furthest, so going back sends nothing worth counting.
  const reachedSteps = useRef(new Set<string>());
  const reachedStep = isDetails ? 'details' : time !== undefined ? 'time' : undefined;
  useEffect(() => {
    if (isEditorPreview || reachedStep === undefined || reachedSteps.current.has(reachedStep)) return;
    reachedSteps.current.add(reachedStep);
    client.event(page.publicKey, { kind: 'step', step: reachedStep });
  }, [client, page.publicKey, isEditorPreview, reachedStep]);
  // The clock (12h or 24h), in the time zone list's foot (critic A24): the picker's corner keeps the view alone.
  const clockSwitch = (
    <SegmentedControl
      label={strings.clock}
      value={hour12 ? '12' : '24'}
      onChange={(next) => {
        setHour12(next === '12');
        saveHour12(next === '12');
      }}
      segments={clockSegments}
    />
  );
  const facts: BookingFact[] = [];
  const chosenStart = booked?.booking.start ?? time;
  if (isPastTimes && chosenStart !== undefined) {
    const end = new Date(Date.parse(chosenStart) + duration * 60_000).toISOString();
    facts.push({
      id: 'when',
      icon: 'calendar',
      children: `${dayLabels(dayKey(Date.parse(chosenStart), zone), locale).short}, ${rangeLabel(chosenStart, end, zone, locale, hour12)}`,
    });
  }
  facts.push(
    {
      id: 'meeting',
      icon: page.location.type === 'video' ? 'video' : page.location.type === 'phone' ? 'phone' : 'map-pin',
      children:
        page.durations.length > 1 && !isPastTimes ? (
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
      // One format on every step (critic C4): the zone's name, then its offset and the time there, quietly, as the
      // picker shows them; only the pick step can change it.
      ...(isPastTimes ? { aside: `${offsetLabel(zone, now())} · ${clockNow}` } : {}),
      children: isPastTimes ? (
        zoneName(zone)
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
          // The clock goes with the zone (critic A24), as Calendly keeps it: in the list's foot, out of the picker's
          // corner. Book by chat follows it too.
          popoverFoot={clockSwitch}
        />
      ),
    },
  );
  // The page's rules, said plainly under the facts while the times show (bookings critics, 4 Nov 2026): how soon
  // and how far ahead it books. The notice comes with the page's facts only when it keeps one.
  const noticeMinutes = page.minNoticeMinutes;
  if (!isPastTimes)
    facts.push({
      id: 'rules',
      icon: 'clock',
      isQuiet: true,
      children: [
        ...(noticeMinutes === undefined ? [] : [strings.noticeRule(noticeMinutes)]),
        strings.windowRule(page.windowDays),
      ].join(' · '),
    });
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
          returnPath(
            page.publicKey,
            { duration, zone, ...(day === undefined ? {} : { day }) },
            globalThis.location.pathname,
          ),
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
  // A connect that went wrong says so only while the page has no calendar to show for the visitor: one already
  // connected (an earlier connect, or a second try) is the truth, and a stale "couldn't connect" beside it reads as
  // a lie (owner, 2 November 2026).
  const isConnected = person?.source === 'google';
  const connectNote =
    connected === undefined || connected === 'connected' || notYou || isConnected
      ? undefined
      : strings.connectResults[connected];
  const banner =
    connectNote === undefined ? undefined : (
      <Callout tone={connected === 'denied' ? 'info' : 'warning'} isAnnounced>
        {connectNote}
      </Callout>
    );
  const bar =
    showsBar || holdsBar ? (
      <Suspense fallback={null}>
        {/* The small link's space, held while the page asks who the visitor is (spec 0058, AC-24). */}
        {holdsBar && <VisitorBar isLoading />}
        {showsBar && (
          <VisitorBar
            {...(person === undefined ? {} : { person: { name: person.name, email: person.email }, onNotYou: forget })}
            {...(barCalendar === undefined ? {} : { calendar: barCalendar })}
            {...(connectHref === undefined ? {} : { connectHref })}
            showAll={showAll}
            onShowAllChange={setShowAll}
            {...(match === undefined ? {} : { match })}
          />
        )}
      </Suspense>
    ) : undefined;
  const frame = {
    host: railHost(page),
    title: railTitle(page),
    description: page.description,
    facts,
    claimHref: CLAIM_URL,
    ...railBrand(page),
    ...(banner === undefined ? {} : { banner }),
    ...(bar === undefined ? {} : { bar }),
  };

  // The details step (spec 0025) draws over the whole card, its heading row too: the month stays underneath and
  // keeps the card its size, so the step moves nothing but its own content in, from the end, and Back from the start.
  // The page's own questions, less any a form's hand off already answered onto the same attribute (AC-5713).
  const handedSkip = prefill?.skip ?? [];
  const asked = (page.questions ?? []).filter((question) => !handedSkip.includes(question.key));
  const detailsProps = {
    // A page that confirms each booking first sends a request (spec 0062, AC-6203).
    isRequest: page.requiresConfirmation === true,
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
  // A note about a calendar that didn't connect stays: it holds a place in the column, and leaving would move the page.
  const { bar: _bar, ...withoutBar } = frame;

  const noTimes = allStarts.length === 0 && loaded.size >= Math.min(chunks, 2);
  // Every open time clashes with the visitor's calendar: say so, with Show all times.
  const allBusy = isAllHidden && loaded.size >= Math.min(chunks, 2);
  const message = read.unreachable ? (
    <Callout tone="warning">{strings.unreachable}</Callout>
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
  ) : noTimes && shared !== undefined ? (
    // Every time the host shared has gone: said as that, with the way to the page's other times.
    <Callout
      tone="info"
      title={strings.sharedGoneTitle}
      actions={
        <Button
          onPress={() => {
            const address = new URL(globalThis.location.href);
            address.searchParams.delete('times');
            address.searchParams.delete('len');
            globalThis.location.assign(address.href);
          }}
        >
          {strings.seeAllTimes}
        </Button>
      }
    >
      {strings.sharedGoneText}
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
      // Enter on a time picks it and hands focus to Book (critic C7, QA B-14).
      onCommit={() => {
        globalThis.requestAnimationFrame(() => bookButton.current?.focus());
      }}
      hour12={hour12}
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
        { value: 'chat', label: strings.chat, icon: 'message-square', isIconOnly: true },
      ]}
    />
  );
  const controls = viewSwitch;

  // Book, once a time is picked (critic A10): until then its band holds a quiet line, and on a phone nothing.
  // The ref goes on the one Book a visitor can reach: List's own over the month (whose band is inert under it), else
  // the month's (review, 5 Nov 2026: with both holding it, Enter on a time could send focus to the inert copy).
  const bookBarOf = (isReachable: boolean) => (
    <Button
      {...(isReachable ? { ref: bookButton } : {})}
      variant="primary"
      size="lg"
      isFullWidth="center"
      onPress={() => {
        setNotice(undefined);
        setStep({ step: 'details', attempt: crypto.randomUUID(), back: false });
      }}
    >
      {page.requiresConfirmation === true
        ? time === undefined
          ? strings.request
          : strings.requestAt(dayHeading, timeLabel(time, zone, locale, hour12))
        : time === undefined
          ? strings.book
          : strings.bookAt(dayHeading, timeLabel(time, zone, locale, hour12))}
    </Button>
  );
  const isListCovering = view === 'list' && !isPastTimes;
  const bookBar = bookBarOf(!isListCovering);
  const noticeLine =
    notice === undefined ? undefined : (
      // Said as it shows: Back put focus on the day, and the reason is why. A time gone by or a link's time taken
      // is information, not a failure (review, 5 Nov 2026); a time taken under the visitor's Confirm stays a warning.
      <Callout
        tone={notice === strings.errors.atPast || notice === strings.errors.atGone ? 'info' : 'danger'}
        isAnnounced
      >
        {notice}
      </Callout>
    );

  if (message !== undefined && detailsStep === undefined && booked === undefined) {
    // Nothing to pick in any view: the message alone, the same card whichever view is chosen.
    return (
      <BookingFrame {...frame} isEmbedded={isEmbedded()} heading={strings.chooseTime} toolbar={controls} view={view}>
        {noticeLine}
        {message}
      </BookingFrame>
    );
  }

  // The month is the card in every view: List and Book by chat (spec 0042) draw over it, in exactly its box, so a
  // switch between views moves nothing on the page (the owner, 25 October 2026).
  // The receipt, as the card's last step (critic C1): the guest page's own module, drawn from the booking just read.
  const bookedStep =
    booked === undefined ? undefined : (
      <Suspense fallback={null}>
        <ManagePage
          token={booked.token}
          isWelcome
          locale={locale}
          now={now}
          placement="card"
          initial={booked.booking}
          {...(manageHrefOf === undefined ? {} : { manageHref: manageHrefOf(booked.token) })}
        />
      </Suspense>
    );
  const cover =
    bookedStep ??
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
            tickets={tickets}
            memory={chatMemory}
            onMemory={setChatMemory}
            onDuration={(minutes) => {
              setDuration(minutes);
              resetChoice();
            }}
            onBooked={(token) => arrival(token)()}
            // The greeting's zone chip opens the rail's own picker, where every view changes the zone.
            onZone={() => {
              const trigger = document.querySelector<HTMLElement>('aside button[aria-haspopup="listbox"]');
              trigger?.scrollIntoView({ block: 'center' });
              trigger?.click();
            }}
            {...(countryGuess === undefined ? {} : { countryGuess })}
            {...(handoff === undefined ? {} : { handoff })}
          />
        </Suspense>
      )
    ) : undefined);

  return (
    <BookingFrame
      isEmbedded={isEmbedded()}
      {...(isPastTimes ? withoutBar : frame)}
      // The chat's own name over it (critic C16), not "Choose a time".
      heading={view === 'chat' && !isPastTimes ? strings.chat : strings.chooseTime}
      toolbar={controls}
      view={booked !== undefined ? 'booked' : isDetails ? 'details' : view}
      {...(isPastTimes
        ? { coverPlace: 'card' as const, enter: 'forward' as const }
        : step.back
          ? { enter: 'back' as const }
          : {})}
      aside={slotList('column')}
      footer={bookBar}
      {...(time === undefined ? { footerWaiting: strings.pickTime } : {})}
      {...(cover === undefined ? {} : { cover })}
      {...(isListCovering ? { coverFooter: bookBarOf(true) } : {})}
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
        holdsHeight={!isEmbedded()}
      />
    </BookingFrame>
  );
}
