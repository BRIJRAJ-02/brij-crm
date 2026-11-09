import { ToastProvider } from '../Toast/Toast.tsx';
import { BookingsFlow } from './BookingsFlow.tsx';

/** The whole Bookings module, full screen, over the Northwind dummy workspace. The Demo menu starts fresh, plays edge cases and the guest's side. */
export function BookingsFlowDemo() {
  return (
    <div className="tf-demo tf-demo--canvas tf-bkf-demo">
      <ToastProvider>
        <BookingsFlow showDemoMenu />
      </ToastProvider>
    </div>
  );
}
