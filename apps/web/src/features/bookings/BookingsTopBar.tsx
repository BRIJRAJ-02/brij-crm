// Brief
// Purpose: the Bookings TopBar, drawn once by the layout: the scheduling tile, the title and New, as People's TopBar has.
// Main task: book someone in from any tab: New opens New meeting at the next free half hour of the week on screen.
// Leaves out: drawing a span on the week (the calendar's own way into the same dialog) and the tabs (the layout's).
import { useCalendar, useCaptureList } from '@crm/data/react';
import { Button, TopBar } from '@crm/ui';
import { useMatch, useNavigate, useRouteContext, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { SCHEDULING_HUE } from '../scheduling.ts';
import { busyOf, nextFreeSpan } from './free.ts';
import { NewMeetingDialog } from './NewMeetingDialog.tsx';
import { bookingsSearchOf, parseBookingsSearch } from './search.ts';
import type { DrawnSpan } from './span.ts';
import { strings } from './strings.ts';
import { weekRange } from './week.ts';
import { useFirstDay } from '../workspace/first-day.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { pageEditorHref } from '../booking/links.ts';
import { NewPageDialog } from '../booking/NewPageDialog.tsx';

/** Props for BookingsTopBar. */
export interface BookingsTopBarProps {
  readonly slug: string;
  /**
   * On a tab with a primary action of its own (Availability's New schedule): where it goes, in place of New
   * meeting, so the screen has one primary (the owner, 22 October 2026).
   */
  readonly actionSlot?: ((element: HTMLElement | null) => void) | undefined;
}

/**
 * Bookings' TopBar: the tile, Bookings, and New at the end (no count: the list pages every meeting, so it has no total). New reads
 * New on every tab, named New meeting, at one place and one width. A meeting goes on a booking page, so with none
 * on yet New opens New booking page instead of sitting turned off (the owner, 22 October 2026).
 */
export function BookingsTopBar({ slug, actionSlot }: BookingsTopBarProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  // The week on screen: the Calendar's, else this week.
  const { week } = bookingsSearchOf(parseBookingsSearch(useSearch({ strict: false })), new Date(), useFirstDay());
  // The member's hours, when the Calendar has read them; else nine to five on weekdays.
  const availability = useMatch({ from: '/w/$slug/bookings/calendar', shouldThrow: false })?.loaderData?.availability;
  const pages = useCaptureList(data.bookingPages.view(slug));
  const calendar = useCalendar(data.calendar.view(slug));
  const [meeting, setMeeting] = useState<DrawnSpan | undefined>(undefined);
  // With no booking page on yet, New makes one first (a meeting goes on a page), rather than sitting turned off.
  const [isAddingPage, setAddingPage] = useState(false);
  const navigate = useNavigate();
  const canBookTeams = useCan('booking.admin');
  const bookable = pages.status === 'ready' ? pages.items.filter((page) => page.status === 'live') : [];
  const connections =
    calendar.status === 'ready' ? calendar.connections.filter((connection) => connection.status !== 'revoked') : [];
  const hasNoPage = pages.status === 'ready' && bookable.length === 0;

  const open = () => {
    const range = weekRange(week);
    const shown = data.bookings.calendar(slug, range.from, range.to).getSnapshot();
    setMeeting(
      nextFreeSpan({
        now: new Date(),
        week,
        minutes: bookable[0]?.durations[0] ?? 30,
        busy: busyOf(shown.status === 'ready' ? shown : undefined),
        ...(availability === undefined ? {} : { availability }),
      }),
    );
  };

  const button = hasNoPage ? (
    <Button
      variant="primary"
      icon="plus"
      label={strings.newPageFirst}
      onPress={() => {
        setAddingPage(true);
      }}
    >
      {strings.newButton}
    </Button>
  ) : (
    <Button variant="primary" icon="plus" label={strings.newMeeting} isDisabled={bookable.length === 0} onPress={open}>
      {strings.newButton}
    </Button>
  );
  return (
    <TopBar title={strings.title} icon="calendar-days" hue={SCHEDULING_HUE}>
      {actionSlot !== undefined ? <div ref={actionSlot} /> : button}
      <NewPageDialog
        data={data}
        slug={slug}
        canBookTeams={canBookTeams}
        isOpen={isAddingPage}
        onClose={() => {
          setAddingPage(false);
        }}
        onCreated={(page) => {
          setAddingPage(false);
          void navigate({ to: pageEditorHref(slug, page.id) });
        }}
      />
      {meeting !== undefined && (
        <NewMeetingDialog
          span={meeting}
          onSpanChange={setMeeting}
          locale={navigator.languages[0] ?? 'en-GB'}
          hasCalendar={connections.length > 0}
          pages={bookable}
          newKey={data.bookings.newKey}
          onBook={async (input) => {
            await data.bookings.bookAsHost(slug, { ...input, guests: [...input.guests] });
            toasts.toast({
              tone: 'success',
              message: connections.length > 0 ? strings.booked(input.name) : strings.bookedQuietly(input.name),
            });
          }}
          onClose={() => {
            setMeeting(undefined);
          }}
        />
      )}
    </TopBar>
  );
}
