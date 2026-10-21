// `@crm/ui/public-booking`: what the public booking pages draw with (spec
// 0025, rebuilt on the library on 20 October 2026, as the hosted form was):
// the provider for a page outside the app, the booking modules, and the few
// controls the page puts around them. The page's client reads and books;
// nothing here touches the network.
import { createElement, useMemo, type ReactNode } from 'react';
import { UiProvider } from '../provider/UiProvider.tsx';
import { createToasts } from '../provider/toasts.tsx';

export { Avatar } from '../atoms/Avatar/Avatar.tsx';
export { Button, ButtonLink } from '../atoms/Button/Button.tsx';
export { Switch } from '../atoms/Switch/Switch.tsx';
export { Callout } from '../molecules/Callout/Callout.tsx';
export { SegmentedControl } from '../molecules/SegmentedControl/SegmentedControl.tsx';
export { Select, type SelectItem } from '../molecules/Select/Select.tsx';
export {
  BookingDetails,
  type BookingDetailsOutcome,
  type BookingDetailsValues,
} from '../modules/BookingDetails/BookingDetails.tsx';
export {
  BookingFoot,
  BookingFrame,
  BookingMessage,
  type BookingFact,
  type BookingHost,
  type BookingTeam,
} from '../modules/BookingFrame/BookingFrame.tsx';
export { BookingReceipt, type BookingReceiptState } from '../modules/BookingReceipt/BookingReceipt.tsx';
export { BookingChanges, type CancelOutcome, type GuestsOutcome } from '../modules/BookingChanges/BookingChanges.tsx';
export { DayStrip } from '../modules/DayStrip/DayStrip.tsx';
export { MonthTiles } from '../modules/MonthTiles/MonthTiles.tsx';
export { SlotList, type Slot } from '../modules/SlotList/SlotList.tsx';
export { VisitorBar, type VisitorBarCalendar } from '../modules/VisitorBar/VisitorBar.tsx';

/** Props for BookingProvider. */
export interface BookingProviderProps {
  /** The visitor's language. */
  readonly locale: string;
  /** The zone times are shown in. */
  readonly timeZone: string;
  readonly children: ReactNode;
}

/** The library's provider for a page outside the app: the visitor's language and zone, full page navigation, its own toasts. */
export function BookingProvider({ locale, timeZone, children }: BookingProviderProps) {
  const toasts = useMemo(() => createToasts(), []);
  return createElement(UiProvider, {
    locale,
    timeZone,
    toasts,
    navigate: (href: string) => globalThis.location.assign(href),
    children,
  });
}
