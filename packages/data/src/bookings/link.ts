// Linking a booking to a record by hand (polish F2), as the layer does it:
// the record's chip shows at once in every list, range and page of meetings of
// the workspace, the server is asked, and a refusal puts each back as it was
// (only where nothing newer landed since). The answer changes nothing more,
// so nothing is read again: the chip shown is the one the server keeps.
import type { BookingListItem } from '@crm/contracts';
import type { RecordRefDisplay } from '@crm/contracts/values';
import type { MeetingsStore } from './meetings.ts';
import type { BookingsStore } from './store.ts';

/** What a link needs: the two stores that show bookings, and the call. */
export interface BookingLinkDeps {
  readonly lists: Pick<BookingsStore, 'patchBooking'>;
  readonly meetings: Pick<MeetingsStore, 'patchBooking'>;
  /** Sends the link (`null` takes it off); throws a data error on a refusal. */
  readonly send: (workspace: string, bookingId: string, recordId: string | null) => Promise<unknown>;
}

/**
 * Links a booking to `record`, or takes the link off with `null`: shown at once, put back on a refusal, which it
 * throws on to the screen.
 */
export function createBookingLink(deps: BookingLinkDeps) {
  return async (workspace: string, bookingId: string, record: RecordRefDisplay | null): Promise<void> => {
    const edit = (booking: BookingListItem): BookingListItem => {
      const { linkedRecord: _was, ...rest } = booking;
      return record === null ? rest : { ...rest, linkedRecord: record };
    };
    const restores = [
      deps.lists.patchBooking(workspace, bookingId, edit),
      deps.meetings.patchBooking(workspace, bookingId, edit),
    ];
    try {
      await deps.send(workspace, bookingId, record?.recordId ?? null);
    } catch (error) {
      for (const restore of restores) restore();
      throw error;
    }
  };
}
