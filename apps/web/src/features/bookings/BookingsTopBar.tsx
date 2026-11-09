// Brief
// Purpose: the Bookings TopBar, drawn once by the layout: the scheduling tile, the title, the module's tabs on its
// line, and at its end whose bookings or hours show, New and the settings gear (the mock's shell, 9 November 2026).
// Main task: book someone in from any tab: New opens New meeting at the next free half hour of the week on screen,
// else of the next two weeks.
// Leaves out: drawing a span on the week (the calendar's own way into the same dialog), and which tab is chosen (the
// layout hands the tabs in).
import type { BookingPageView } from '@crm/data';
import { useCalendar, useCalendarList, useCaptureList } from '@crm/data/react';
import { Button, ButtonLink, Menu, MenuItem, MenuTrigger, Tooltip, TopBar, useFormatSettings } from '@crm/ui';
import { useMatch, useNavigate, useRouteContext, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SCHEDULING_HUE } from '../scheduling.ts';
import { busyOf, findFreeSpan, freeSpanIn } from './free.ts';
import { NewMeetingDialog, NewPageDialog, usePreloadParts } from './lazy-parts.tsx';
import { useSettled } from './settling.ts';
import { bookingsSearchOf, parseBookingsSearch } from './search.ts';
import type { DrawnSpan } from './span.ts';
import { strings } from './strings.ts';
import { weekRange } from './week.ts';
import { useFirstDay } from '../workspace/first-day.ts';
import { useCan, useWorkspaceObjects } from '../workspace/WorkspacePage.tsx';
import { peopleSearchOf } from './people.ts';
import { bookingsSettingsHref, pageEditorHref } from '../booking/links.ts';

/** Props for BookingsTopBar. */
export interface BookingsTopBarProps {
  readonly slug: string;
  /** The module's tabs, on the bar's line after its title (`BookingsModuleTabs`). */
  readonly tabs: ReactNode;
  /** Whose bookings or hours the tab shows (`BookingsScope`), before the primary action; absent when nothing to pick. */
  readonly scope?: ReactNode;
  /**
   * On a tab with a primary action of its own (Availability's New schedule): where it goes, in place of New
   * meeting, so the screen has one primary (the owner, 22 October 2026).
   */
  readonly actionSlot?: ((element: HTMLElement | null) => void) | undefined;
  /** New booking page is open: the layout holds it, so Pages and the Calendar's empty state open the same dialog. */
  readonly isAddingPage: boolean;
  /** New › Booking page. */
  readonly onAddPage: () => void;
  /** The dialog closed, made or not. */
  readonly onAddPageClose: () => void;
}

/**
 * Bookings' TopBar: the tile, Bookings, and New at the end (no count: the list pages every meeting, so it has no total). New reads
 * New on every tab, at one place and one width, and opens a menu: Booking page or Meeting (the bookings critique,
 * B-02). A meeting goes on a booking page, so with none on yet Meeting is turned off with the reason under it.
 */
export function BookingsTopBar({
  slug,
  tabs,
  scope,
  actionSlot,
  isAddingPage,
  onAddPage,
  onAddPageClose,
}: BookingsTopBarProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  // The dialogs and the jump month, loaded once the tab has drawn: on every Bookings tab, since this bar is.
  usePreloadParts();
  // The week on screen: the Calendar's, else this week.
  const { timeZone } = useFormatSettings();
  const { week } = bookingsSearchOf(
    parseBookingsSearch(useSearch({ strict: false })),
    new Date(),
    useFirstDay(),
    timeZone,
  );
  // The member's hours, when the Calendar has read them; else nine to five on weekdays.
  const calendarLoaded = useMatch({ from: '/w/$slug/bookings/calendar', shouldThrow: false })?.loaderData;
  const calendarData = useSettled(calendarLoaded?.extras);
  const availability = calendarLoaded?.availability;
  // Whom the member Manages, for New meeting's For (spec 0037, AC-1272), as the Calendar read them.
  const forPeople = calendarData?.forPeople;
  const pages = useCaptureList(data.bookingPages.view(slug));
  const calendar = useCalendar(data.calendar.view(slug));
  const [meeting, setMeeting] = useState<DrawnSpan | undefined>(undefined);
  const navigate = useNavigate();
  const canBookTeams = useCan('booking.admin');
  // The member's own pages (an admin's, everyone's): a workspace link they may only see isn't theirs to book on.
  const bookable =
    pages.status === 'ready' ? pages.items.filter((page) => page.status === 'live' && page.canChange) : [];
  const connections =
    calendar.status === 'ready' ? calendar.connections.filter((connection) => connection.status !== 'revoked') : [];
  const hasNoPage = pages.status === 'ready' && bookable.length === 0;

  // Reading what New needs first (the week on screen off the Calendar tab, the member's hours, the next weeks when
  // this one is full): New waits, busy, meanwhile.
  const [isFinding, setFinding] = useState(false);
  // The workspace and week now, so a look that comes back after either changed opens nothing.
  const current = useRef({ slug, week });
  useEffect(() => {
    current.current = { slug, week };
  }, [slug, week]);
  const open = () => {
    if (isFinding) return;
    const now = new Date();
    const minutes = bookable[0]?.durations[0] ?? 30;
    const rangeOf = (monday: string) => {
      const range = weekRange(monday, timeZone);
      return data.bookings.calendar(slug, range.from, range.to);
    };
    const shown = rangeOf(week).getSnapshot();
    // The Calendar's week read and its hours known: its free time opens the dialog at once.
    if (shown.status === 'ready' && availability !== undefined) {
      const here = freeSpanIn({ now, week, minutes, busy: busyOf(shown), availability, zone: timeZone });
      if (here !== undefined) {
        setMeeting(here);
        return;
      }
    }
    // Else read as the look needs (Q72): the member's hours, then each week, where not yet read or last failed.
    const asked = { slug, week };
    setFinding(true);
    void (async () => {
      const hours =
        availability ??
        (await data.bookings.hours(slug, timeZone).then(
          (answer) => answer.availability,
          () => undefined,
        ));
      const span = await findFreeSpan({
        now,
        week,
        minutes,
        ...(hours === undefined ? {} : { availability: hours }),
        zone: timeZone,
        busyIn: async (monday) => {
          const held = rangeOf(monday);
          if (held.getSnapshot().status !== 'ready') await held.ready();
          const read = held.getSnapshot();
          return read.status === 'ready' ? busyOf(read) : undefined;
        },
      });
      if (current.current.slug === asked.slug && current.current.week === asked.week) setMeeting(span);
    })().finally(() => {
      setFinding(false);
    });
  };

  // New is a menu (the bookings critique, B-02): a booking page, or a meeting on one. With no page on yet, Meeting
  // stays in the menu, turned off with the reason under it, so New never sits turned off itself.
  const hasPage = pages.status === 'ready' && pages.items.some((page) => page.canChange);
  const meetingReason = !hasNoPage ? undefined : hasPage ? strings.turnOnPageFirst : strings.makePageFirst;
  const button = (
    <MenuTrigger>
      <Button variant="primary" icon="plus" iconRight="chevron-down" label={strings.newMenu} isPending={isFinding}>
        {strings.newButton}
      </Button>
      <Menu
        label={strings.newMenu}
        placement="bottom end"
        onAction={(key) => {
          if (key === 'page') onAddPage();
          if (key === 'meeting') open();
        }}
      >
        <MenuItem id="page" icon="link">
          {strings.newBookingPage}
        </MenuItem>
        <MenuItem
          id="meeting"
          icon="calendar-plus"
          isDisabled={meetingReason !== undefined}
          {...(meetingReason === undefined ? {} : { description: meetingReason })}
        >
          {strings.newMeetingItem}
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
  return (
    <TopBar title={strings.title} icon="calendar-days" hue={SCHEDULING_HUE} tabs={tabs}>
      {scope}
      {actionSlot !== undefined ? <div ref={actionSlot} /> : button}
      {/* Bookings' own settings, last on the bar (the mock's shell): Calendars, Teams and Scheduling access live there. */}
      <Tooltip content={strings.settingsLabel}>
        <ButtonLink variant="ghost" icon="settings" label={strings.settingsLabel} href={bookingsSettingsHref(slug)} />
      </Tooltip>
      <NewPageDialog
        data={data}
        slug={slug}
        canBookTeams={canBookTeams}
        isOpen={isAddingPage}
        onClose={onAddPageClose}
        onCreated={(page) => {
          onAddPageClose();
          void navigate({ to: pageEditorHref(slug, page.id) });
          // The page opens under Captures, where every booking page lives: said, so the jump isn't a mystery (B1).
          toasts.toast({ tone: 'success', message: strings.pageMadeWhere(page.title) });
        }}
      />
      {meeting !== undefined && (
        <NewMeetingFromTopBar
          slug={slug}
          span={meeting}
          onSpanChange={setMeeting}
          hasCalendar={connections.length > 0}
          pages={bookable}
          {...(forPeople === undefined ? {} : { forPeople })}
          onClose={() => {
            setMeeting(undefined);
          }}
        />
      )}
    </TopBar>
  );
}

/** New meeting from New: the member's calendars and People are held only while it is open. */
function NewMeetingFromTopBar({
  slug,
  span,
  onSpanChange,
  hasCalendar,
  pages,
  forPeople,
  onClose,
}: {
  readonly slug: string;
  readonly span: DrawnSpan;
  readonly onSpanChange: (span: DrawnSpan) => void;
  readonly hasCalendar: boolean;
  readonly pages: readonly BookingPageView[];
  readonly forPeople?: readonly { readonly id: string; readonly name: string }[];
  readonly onClose: () => void;
}) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  // Calendar's choices and With's People, as on the week.
  const calendarList = useCalendarList(data.calendar.calendars(slug));
  const objects = useWorkspaceObjects();
  return (
    <NewMeetingDialog
      span={span}
      onSpanChange={onSpanChange}
      locale={navigator.languages[0] ?? 'en-GB'}
      hasCalendar={hasCalendar}
      pages={pages}
      {...(forPeople === undefined ? {} : { forPeople })}
      newKey={data.bookings.newKey}
      people={peopleSearchOf(data, slug, objects)}
      calendars={calendarList}
      pageDestination={(pageId) => data.calendar.pageDestination(slug, pageId)}
      limitsAt={(input) => data.bookings.limitsAt(slug, input)}
      onBook={async (input) => {
        const booked = await data.bookings.bookAsHost(slug, { ...input, guests: [...input.guests] });
        toasts.toast(
          booked.notInCrm === undefined
            ? { tone: 'success', message: hasCalendar ? strings.booked(input.name) : strings.bookedQuietly(input.name) }
            : { tone: 'info', message: strings.bookedNotInCrm(input.name, booked.notInCrm) },
          booked.notInCrm === undefined ? undefined : { timeout: strings.notInCrmToastMs },
        );
      }}
      onClose={onClose}
    />
  );
}
