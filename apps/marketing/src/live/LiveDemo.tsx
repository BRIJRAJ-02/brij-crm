import {
  createToasts,
  Icon,
  NavItem,
  NavSection,
  ProviderMark,
  Sidebar,
  UiProvider,
  type UiProviderProps,
} from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { BookingsView } from './BookingsView/BookingsView.tsx';
import { BookView } from './BookView/BookView.tsx';
import {
  BOOKING_PAGE,
  DEALS,
  MEETINGS,
  PEOPLE,
  STAGES,
  WEEKS,
  WORKSPACE,
  clockLabel,
  shortDay,
  type DemoMeeting,
  type DemoPerson,
} from './data.ts';
import { DealsView } from './DealsView/DealsView.tsx';
import styles from './LiveDemo.module.css';
import { RecordsView } from './RecordsView/RecordsView.tsx';
import { DEMO_NOW, DEMO_TIME_ZONE } from './time.ts';

/** The demo's screens, by the app's own paths. */
type View = '/bookings' | '/book' | '/people' | '/companies' | '/deals';

const VIEWS: readonly View[] = ['/bookings', '/book', '/people', '/companies', '/deals'];

/** Where the footer's product links (`/#<area>`) open the demo. */
const AREA_VIEWS: Readonly<Record<string, View>> = {
  'booking-pages': '/book',
  bookings: '/bookings',
  records: '/people',
  pipeline: '/deals',
  forms: '/book',
  'round-robin': '/bookings',
  home: '/bookings',
  team: '/people',
  security: '/people',
};

/** The window's address for each screen: the booking page is public, on the booking origin. */
const ADDRESS: Readonly<Record<View, string>> = {
  '/bookings': 'app.timefix.ai/bookings',
  '/book': BOOKING_PAGE.address,
  '/people': 'app.timefix.ai/people',
  '/companies': 'app.timefix.ai/companies',
  '/deals': 'app.timefix.ai/deals',
};

/** Under this width the demo's sidebar folds to its rail, as the app's does on a small screen. */
const RAIL_BELOW = 760;

const frozenClock: NonNullable<UiProviderProps['clock']> = { now: () => DEMO_NOW, subscribe: () => () => undefined };

/**
 * A working Timefix in the home page's first fold, built from the app's own components with a made up workspace
 * (data.ts): the sidebar switches between the team's week, the booking page, People, Companies and Deals, and what
 * a visitor does carries through, as it would in the product (a booking lands in Bookings and People). It runs in
 * its own provider, so its links switch screens instead of leaving the page, and its toasts rise inside its window.
 */
export function LiveDemo() {
  const [view, setView] = useState<View>('/bookings');
  const [week, setWeek] = useState<(typeof WEEKS)[number]>(WEEKS[0]);
  const [meetings, setMeetings] = useState<readonly DemoMeeting[]>(MEETINGS);
  const [people, setPeople] = useState<readonly DemoPerson[]>(PEOPLE);
  const [deals, setDeals] = useState(DEALS);
  const [openId, setOpenId] = useState<string>();
  const [highlightId, setHighlightId] = useState<string>();
  const [isRail, setIsRail] = useState(false);
  const [toasts] = useState(createToasts);
  const app = useRef<HTMLDivElement>(null);

  // The footer's product links name an area in the address's fragment: open the screen that shows it.
  useEffect(() => {
    const follow = () => {
      const target = AREA_VIEWS[window.location.hash.slice(1)];
      if (target === undefined) return;
      setView(target);
      window.scrollTo({ top: 0 });
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => {
      window.removeEventListener('hashchange', follow);
    };
  }, []);

  // Fold the sidebar to its rail when the window is narrow.
  useEffect(() => {
    const element = app.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setIsRail(entry.contentRect.width < RAIL_BELOW);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const navigate = (href: string) => {
    const next = VIEWS.find((candidate) => candidate === href);
    if (next !== undefined) setView(next);
  };

  const book = ({ name, dayKey, startMinute }: { name: string; dayKey: string; startMinute: number }) => {
    const known = people.find((person) => person.name.toLowerCase() === name.toLowerCase());
    const personId = known?.id ?? `guest-${String(people.length + 1)}`;
    if (known === undefined) {
      const guest: DemoPerson = {
        id: personId,
        name,
        companyId: undefined,
        title: `Booked ${BOOKING_PAGE.title}`,
        ownerId: BOOKING_PAGE.hostId,
        tags: [{ id: 'lead', label: 'Lead', hue: 'blue' }],
        isNew: true,
      };
      setPeople((current) => [guest, ...current]);
    }
    const meeting: DemoMeeting = {
      id: `booked-${String(meetings.length + 1)}`,
      kind: 'booking',
      title: BOOKING_PAGE.title,
      personId,
      hostId: BOOKING_PAGE.hostId,
      dayKey,
      startMinute,
      endMinute: startMinute + BOOKING_PAGE.minutes,
      where: BOOKING_PAGE.where,
    };
    setMeetings((current) => [...current, meeting]);
    setHighlightId(personId);
    toasts.toast({
      tone: 'success',
      message: `${name} booked ${BOOKING_PAGE.title}, ${shortDay(dayKey)} at ${clockLabel(startMinute)}. Added to People.`,
      action: {
        label: 'View',
        onAction: () => {
          setWeek(dayKey < '2026-10-26' ? WEEKS[0] : WEEKS[1]);
          setView('/bookings');
          setOpenId(meeting.id);
        },
      },
    });
  };

  const move = (dealId: string, stageId: string) => {
    const deal = deals.find((candidate) => candidate.id === dealId);
    const stage = STAGES.find((candidate) => candidate.id === stageId);
    if (deal === undefined || stage === undefined || deal.stageId === stageId) return;
    setDeals((current) =>
      current.map((candidate) => (candidate.id === dealId ? { ...candidate, stageId } : candidate)),
    );
    toasts.toast({ tone: 'info', message: `Moved ${deal.name} to ${stage.title}.` });
  };

  const openPerson = (personId: string) => {
    setOpenId(undefined);
    setHighlightId(personId);
    setView('/people');
  };

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <span className={styles.lights} aria-hidden="true">
          <span className={styles.light} data-tone="red" />
          <span className={styles.light} data-tone="yellow" />
          <span className={styles.light} data-tone="green" />
        </span>
        <span className={styles.address}>
          <Icon name="lock" size="xs" />
          {ADDRESS[view]}
        </span>
        <span className={styles.hint}>Live demo · try it</span>
      </div>
      <div className={styles.app} ref={app}>
        <UiProvider
          locale="en-US"
          timeZone={DEMO_TIME_ZONE}
          navigate={navigate}
          useHref={(href) => `#${href.slice(1)}`}
          toasts={toasts}
          clock={frozenClock}
          platform="mac"
        >
          <div className={styles.shell} data-rail={isRail || undefined}>
            <Sidebar
              workspace={WORKSPACE}
              mark={<ProviderMark provider="timefix" size="lg" />}
              label="Demo navigation"
              isCollapsed={isRail}
            >
              <NavSection title="Scheduling">
                <NavItem icon="calendar-days" hue="blue" href="/bookings" isCurrent={view === '/bookings'}>
                  Bookings
                </NavItem>
                <NavItem icon="calendar-check" hue="sky" href="/book" isCurrent={view === '/book'}>
                  Booking page
                </NavItem>
              </NavSection>
              <NavSection title="Records">
                <NavItem icon="users" hue="green" href="/people" isCurrent={view === '/people'}>
                  People
                </NavItem>
                <NavItem icon="building" hue="yellow" href="/companies" isCurrent={view === '/companies'}>
                  Companies
                </NavItem>
                <NavItem icon="kanban" hue="orange" href="/deals" isCurrent={view === '/deals'}>
                  Deals
                </NavItem>
              </NavSection>
            </Sidebar>
            <div className={styles.view}>
              {view === '/bookings' && (
                <BookingsView
                  key={week}
                  meetings={meetings}
                  people={people}
                  openId={openId}
                  onOpen={setOpenId}
                  onOpenPerson={openPerson}
                  week={week}
                  onWeekChange={setWeek}
                />
              )}
              {view === '/book' && <BookView meetings={meetings} onBook={book} />}
              {view === '/people' && <RecordsView object="people" people={people} highlightId={highlightId} />}
              {view === '/companies' && <RecordsView object="companies" people={people} />}
              {view === '/deals' && <DealsView deals={deals} onMove={move} />}
            </div>
          </div>
        </UiProvider>
      </div>
    </div>
  );
}
