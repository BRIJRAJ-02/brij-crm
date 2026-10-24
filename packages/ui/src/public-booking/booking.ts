// `@crm/ui/public-booking`: what the public booking pages draw with (spec
// 0025, rebuilt on the library on 20 October 2026, as the hosted form was):
// the provider for a page outside the app, the booking modules, and the few
// controls the page puts around them. The page's client reads and books;
// nothing here touches the network.
import { createElement, useMemo, type ReactNode } from 'react';
import { UiProvider } from '../provider/UiProvider.tsx';
import { createToasts } from '../provider/toasts.tsx';

export { Avatar } from '../atoms/Avatar/Avatar.tsx';
/** The tagged www.timefix.com links on every public page: "Powered by Timefix" (shared with the hosted form) and "Claim your free page". */
export { claimPageHref, poweredByHref, type PoweredByPage } from '../lib/powered-by.ts';
export { Button, ButtonLink } from '../atoms/Button/Button.tsx';
export { Skeleton } from '../atoms/Skeleton/Skeleton.tsx';
/** Inside it a loading state draws at once: a public page's first paint is already its loading state, so there is nothing for a skeleton to flash in front of. */
export { LoadingNow } from '../provider/LoadingNow.tsx';
export { Switch } from '../atoms/Switch/Switch.tsx';
export { Callout } from '../molecules/Callout/Callout.tsx';
/** A profile with no links, or none that match (22 Oct 2026). */
export { EmptyState } from '../molecules/EmptyState/EmptyState.tsx';
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
  /** An address nobody holds (25 Oct 2026): the offer to claim it, and the one action. */
  BookingHandleOffer,
  BookingMessage,
  BookingProfile,
  BookingProfileSection,
  type BookingProfilePerson,
  type BookingFact,
  type BookingHost,
  type BookingTeam,
} from '../modules/BookingFrame/BookingFrame.tsx';
export { BookingReceipt, type BookingReceiptState } from '../modules/BookingReceipt/BookingReceipt.tsx';
export { BookingChanges, type CancelOutcome, type GuestsOutcome } from '../modules/BookingChanges/BookingChanges.tsx';
export { DayStrip } from '../modules/DayStrip/DayStrip.tsx';
/** A profile's booking links (22 Oct 2026): the rows Captures › Links draws, the whole row opening the page. */
export { LinkList, LinkListToolbar, type LinkRow } from '../modules/LinkList/LinkList.tsx';
export { MonthTiles } from '../modules/MonthTiles/MonthTiles.tsx';
export { SlotList, type Slot } from '../modules/SlotList/SlotList.tsx';
export { VisitorBar, type VisitorBarCalendar } from '../modules/VisitorBar/VisitorBar.tsx';
export type {
  MatchCalendarDay,
  MatchCalendarProps,
  MatchCalendarResult,
  MatchCalendarStep,
} from '../modules/MatchCalendar/MatchCalendar.tsx';

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
