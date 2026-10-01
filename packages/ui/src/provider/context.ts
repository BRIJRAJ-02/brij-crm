// What UiProvider supplies, and the hooks components read it with. Kept apart
// from the provider itself, so components import these without pulling in the
// toast region (and the Button it draws).
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { KeyboardPlatform } from '../atoms/Kbd/shortcuts.ts';
import type { Clock } from './clock.ts';
import type { Toasts } from './toasts.tsx';

/** The language and time zone every date, number and amount formats in. */
export interface FormatSettings {
  /** A BCP 47 tag, such as `en-GB`. */
  readonly locale: string;
  /** An IANA zone, such as `Europe/London`. "Today" is today here. */
  readonly timeZone: string;
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
