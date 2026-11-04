// `@crm/ui/public-booking/details`: the booking page's second step on its own
// (spec 0025), so the page loads it apart from its first paint's code.
export {
  BookingDetails,
  type BookingDetailsOutcome,
  type BookingDetailsValues,
} from '../modules/BookingDetails/BookingDetails.tsx';
/** The List view's days (5 Nov 2026): loaded beside the first paint with the details step, out of its CSS budget. */
export { DayStrip } from '../modules/DayStrip/DayStrip.tsx';
