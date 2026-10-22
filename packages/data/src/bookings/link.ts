// Linking a booking to a record by hand (polish F2), as the layer does it:
// the record's chip shows at once in every list, range and page of meetings of
// the workspace, the server is asked, and its answer is shown again (over any
// read that started before the link and landed after it). A refusal puts back
// what was linked before, only where the link's own edit still shows: another
// change since then (another booking's, or a read) is left as it is.
import type { BookingListItem } from '@crm/contracts';
import type { RecordRefDisplay } from '@crm/contracts/values';
import type { MeetingsStore } from './meetings.ts';
import type { BookingsStore } from './store.ts';

/** What a link needs: the two stores that show bookings, and the call. */
export interface BookingLinkDeps {
  readonly lists: Pick<BookingsStore, 'patchBooking'>;
  readonly meetings: Pick<MeetingsStore, 'patchBooking'>;
  /** Sends the link (`null` takes it off); answers what is linked now, or throws a data error on a refusal. */
  readonly send: (
    workspace: string,
    bookingId: string,
    recordId: string | null,
  ) => Promise<{ readonly linkedRecord?: RecordRefDisplay }>;
}

/** A booking showing `linked`, or no link. */
function withLinked(booking: BookingListItem, linked: RecordRefDisplay | undefined): BookingListItem {
  const { linkedRecord: _was, ...rest } = booking;
  return linked === undefined ? rest : { ...rest, linkedRecord: linked };
}

/**
 * Links a booking to `record`, or takes the link off with `null`: shown at once, the server's answer shown once it
 * lands, put back on a refusal, which it throws on to the screen.
 */
export function createBookingLink(deps: BookingLinkDeps) {
  return async (workspace: string, bookingId: string, record: RecordRefDisplay | null): Promise<void> => {
    const show = (edit: (booking: BookingListItem) => BookingListItem) => {
      deps.lists.patchBooking(workspace, bookingId, edit);
      deps.meetings.patchBooking(workspace, bookingId, edit);
    };
    const shown = record ?? undefined;
    let was: { readonly linked: RecordRefDisplay | undefined } | undefined;
    show((booking) => {
      was ??= { linked: booking.linkedRecord };
      return withLinked(booking, shown);
    });
    try {
      const answer = await deps.send(workspace, bookingId, record?.recordId ?? null);
      show((booking) => withLinked(booking, answer.linkedRecord));
    } catch (error) {
      const before = was;
      if (before !== undefined) {
        show((booking) => (booking.linkedRecord === shown ? withLinked(booking, before.linked) : booking));
      }
      throw error;
    }
  };
}
