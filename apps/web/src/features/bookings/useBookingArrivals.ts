// A toast when a guest books while a Bookings screen is open (bookings fix lane O, B-12): "Ada Lovelace booked Intro
// call for Thu 5 Nov, 10:00", with Open, which opens the booking on the List. The data layer hears it (the host's
// booking notice and its `notifications` event, `data.bookings.arrivals`) and reads the lists again with it, so the
// toast and the row arrive together; this hook only says so. Mounted once by the Bookings layout.
import type { BookingArrival } from '@crm/data';
import { useFormatSettings } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { arrivalStrings } from './arrival-strings.ts';
import { bookingsTabHref } from './tabs.ts';

/** Toasts each booking a guest makes on the member's pages while Bookings is open. */
export function useBookingArrivals(slug: string): void {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const { locale, timeZone } = useFormatSettings();
  // The latest of what a toast needs, so the listener stays one for the workspace's life on screen.
  const latest = useRef({ navigate, locale, timeZone });
  useEffect(() => {
    latest.current = { navigate, locale, timeZone };
  }, [navigate, locale, timeZone]);
  useEffect(
    () =>
      data.bookings.arrivals(slug, (arrival: BookingArrival) => {
        const { locale: language, timeZone: zone } = latest.current;
        const when = new Intl.DateTimeFormat(language, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
          timeZone: zone,
        }).format(new Date(arrival.startsAt));
        toasts.toast(
          {
            tone: 'info',
            message: arrivalStrings.booked(arrival.guestName, arrival.pageTitle, when),
            action: {
              label: arrivalStrings.open,
              onAction: () => {
                void latest.current.navigate({ href: `${bookingsTabHref(slug, 'list')}?open=${arrival.bookingId}` });
              },
            },
          },
          { timeout: arrivalStrings.toastMs },
        );
      }),
    [data, slug, toasts],
  );
}
