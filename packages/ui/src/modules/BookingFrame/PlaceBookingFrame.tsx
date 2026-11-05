import { BookingFrame, type BookingFrameProps } from './BookingFrame.tsx';
import styles from './PlaceBookingFrame.module.css';

/**
 * BookingFrame for a place, not a person (a restaurant's reservation page, 5 November 2026): the business's initials on
 * a square ink tile (or its logo) beside its name on one row, the title under it in the heading's weight, a quiet link
 * closing the rail ("Manage booking →"), and on a phone the times run with the page rather than scrolling in a box.
 * Apart from BookingFrame so its styles load only where it is drawn: a booking page never draws it.
 */
export function PlaceBookingFrame(props: Omit<BookingFrameProps, 'placeLook'>) {
  return <BookingFrame {...props} placeLook={styles} />;
}
