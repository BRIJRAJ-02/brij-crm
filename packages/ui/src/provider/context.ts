// What UiProvider supplies, and the hooks components read it with. Kept apart
// from the provider itself, so components import these without pulling in the
// toast region (and the Button it draws).
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { KeyboardPlatform } from '../atoms/Kbd/shortcuts.ts';
import type { DateFormat } from '../lib/format.ts';
import { memoIntl } from '../lib/intl-memo.ts';
import { regionDefaults } from '../lib/region-defaults.ts';
import type { WeekStart } from '../lib/month.ts';
import type { Clock } from './clock.ts';
import type { Toasts } from './toasts.tsx';

/** The language, time zone, date format and week start every date, number and amount formats in. */
export interface FormatSettings {
  /** A BCP 47 tag, such as `en-GB`. */
  readonly locale: string;
  /** An IANA zone, such as `Europe/London`. "Today" is today here. */
  readonly timeZone: string;
  /** How a date is written (the member's preference); the language's own when absent. */
  readonly dateFormat?: DateFormat;
  /** The day a week starts on (the member's preference); the language's own when absent. */
  readonly weekStart?: WeekStart;
  /** The workspace's currency, for an amount whose attribute names none; the language's region's when absent. */
  readonly currency?: string;
  /** The workspace's country, for a phone number or an address that names none; the language's region when absent. */
  readonly country?: string;
}

export const FormatContext = createContext<FormatSettings | undefined>(undefined);
export const ClockContext = createContext<Clock | undefined>(undefined);
export const ToastsContext = createContext<Toasts | undefined>(undefined);
export const PlatformContext = createContext<KeyboardPlatform | undefined>(undefined);

/** The language and time zone from UiProvider. Throws outside it, so a missing provider fails loudly. */
export function useFormatSettings(): FormatSettings {
  const settings = useContext(FormatContext);
  if (settings === undefined) throw new Error('Wrap the app in <UiProvider> to format dates and numbers.');
  return settings;
}

/**
 * The country and currency a value starts in when its attribute names none:
 * the workspace's (FormatScope), else the language's region's (en-IN is IN
 * and INR), else the US's. A new Currency attribute and a new phone number
 * start here instead of always in USD and the US.
 */
export function useRegionDefaults(): { readonly country: string; readonly currency: string } {
  const { locale, country, currency } = useFormatSettings();
  return regionDefaults(locale, { country, currency });
}

/** Today (`YYYY-MM-DD`) in the zone at `now`: Swedish writes a date as YYYY-MM-DD, with no date library in the first load. */
function dayKeyIn(now: number, timeZone: string): string {
  return memoIntl(
    `dayKey:${timeZone}`,
    () => new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }),
  ).format(now);
}

/**
 * Reads "today" (`YYYY-MM-DD`, in the provider's time zone) when called, without re-rendering on each tick: a
 * paste or an import reads "tomorrow" against it once, so a grid of thousands of cells never redraws for the clock.
 */
export function useTodayReader(): () => string {
  const clock = useContext(ClockContext);
  const { timeZone } = useFormatSettings();
  if (clock === undefined) throw new Error('Wrap the app in <UiProvider> to read today.');
  return () => dayKeyIn(clock.now(), timeZone);
}

/**
 * Today (`YYYY-MM-DD`, in the provider's time zone), re-rendering only when the day changes: the snapshot is the
 * day's text, so the clock's 30 second ticks leave a grid of dates alone until midnight.
 */
export function useToday(): string {
  const clock = useContext(ClockContext);
  const { timeZone } = useFormatSettings();
  if (clock === undefined) throw new Error('Wrap the app in <UiProvider> to read today.');
  return useSyncExternalStore(clock.subscribe, () => dayKeyIn(clock.now(), timeZone));
}

/** The shared clock's time, in milliseconds. Re-renders on each tick (every 30 seconds). */
export function useNow(): number {
  const clock = useContext(ClockContext);
  if (clock === undefined) throw new Error('Wrap the app in <UiProvider> to show relative times.');
  return useSyncExternalStore(clock.subscribe, clock.now);
}

/** The app's toasts, for library components that report something themselves (a failed copy). Screens raise toasts through the data layer. */
export function useToasts(): Toasts {
  const toasts = useContext(ToastsContext);
  if (toasts === undefined) throw new Error('Wrap the app in <UiProvider> to show toasts.');
  return toasts;
}

/** The viewer's keyboard, for keycaps and shortcuts: `mac` or `other`. */
export function useKeyboardPlatform(): KeyboardPlatform {
  const platform = useContext(PlatformContext);
  if (platform === undefined) throw new Error('Wrap the app in <UiProvider> to show keyboard shortcuts.');
  return platform;
}

/** Where a stored file downloads from, by its id: the web app supplies it for the open workspace. */
export const FileLinksContext = createContext<((fileId: string) => string) | undefined>(undefined);

/** The download address of a stored file, when the app says where files download from; undefined draws no link. */
export function useFileHref(): ((fileId: string) => string) | undefined {
  return useContext(FileLinksContext);
}

/**
 * A site's icon by its host ("acme.com"), served from the app's own origin: the web app supplies it for the
 * open workspace, and a domain or link chip shows it before its words. Undefined draws no icon.
 */
export const SiteIconsContext = createContext<((host: string) => string | undefined) | undefined>(undefined);

/** The icon address for a host, when the app says where site icons come from. */
export function useSiteIcons(): ((host: string) => string | undefined) | undefined {
  return useContext(SiteIconsContext);
}
