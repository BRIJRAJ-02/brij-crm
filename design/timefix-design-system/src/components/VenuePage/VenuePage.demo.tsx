import { ToastProvider } from '../Toast/Toast.tsx';
import { VenueGuest } from '../BookingsFlow/guest-venue.tsx';
import { lumen } from '../BookingsFlow/seed-business.ts';

/** A salon's public page (timefix.com/lumen), live: pick a service, a professional, a time, then confirm. */
export function VenuePageDemo() {
  return <ToastProvider><div className="tf-demo tf-demo--canvas"><VenueGuest state={lumen()} onBooked={() => undefined} onOpenPage={() => undefined} /></div></ToastProvider>;
}
