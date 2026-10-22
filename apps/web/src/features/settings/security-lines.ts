// Settings › Account › Sign in and devices's device lines (spec 0033, AC-890): plain
// functions, so they are tested without the screen.
import type { AccountSession } from '@crm/data';
import type { IconName } from '@crm/ui';
import { strings } from './security-strings.ts';

const regions = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' });
  } catch {
    return undefined;
  }
})();

/** A device's name: its browser and system, or a plain word when the browser said nothing useful. */
export const deviceName = (session: Pick<AccountSession, 'deviceLabel'>): string =>
  session.deviceLabel.trim() === '' ? strings.unknownDevice : session.deviceLabel;

/** The device's kind as an icon, from the system its name ends with: a phone, a tablet, else a screen. */
export function deviceIcon(session: Pick<AccountSession, 'deviceLabel'>): IconName {
  const system = session.deviceLabel.split(' on ').at(-1) ?? '';
  if (system === 'iOS' || system === 'Android') return 'smartphone';
  if (system === 'iPadOS') return 'tablet';
  return 'monitor';
}

/** Roughly where: "Mumbai, India", leaving out what the edge didn't know; undefined when it knew nothing. */
export function devicePlace(session: Pick<AccountSession, 'city' | 'country'>): string | undefined {
  const country = session.country === undefined ? undefined : (regions?.of(session.country) ?? session.country);
  const place = [session.city, country].filter((each) => each !== undefined && each !== '').join(', ');
  return place === '' ? undefined : place;
}

/** This device first, then the rest as the server ordered them (most recently used first). */
export const currentFirst = (sessions: readonly AccountSession[]): readonly AccountSession[] => [
  ...sessions.filter((each) => each.current),
  ...sessions.filter((each) => !each.current),
];
