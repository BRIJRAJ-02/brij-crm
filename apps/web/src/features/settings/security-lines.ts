// Settings › Account › Sign in and security' device lines (spec 0033, AC-890): plain
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

/** The systems the server names on its own when the browser said nothing it knows (packages/core's device.ts). */
const SYSTEMS = new Set(['iOS', 'iPadOS', 'Android', 'ChromeOS', 'Windows', 'macOS', 'Linux']);

/**
 * A device's name, always browser and system (critics A and B, 5 November 2026: rows read "macOS" alone): "Chrome on
 * macOS"; "Unknown browser on macOS" when the browser said nothing the server knew; a plain word when nothing at all.
 */
export const deviceName = (session: Pick<AccountSession, 'deviceLabel'>): string => {
  const label = session.deviceLabel.trim();
  if (label === '') return strings.unknownDevice;
  return SYSTEMS.has(label) ? strings.unknownBrowserOn(label) : label;
};

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

/** One row of the devices list: the sessions of one browser, system and place, newest first. */
export interface DeviceGroup {
  /** Stable while the list holds: the newest session's id. */
  readonly id: string;
  readonly sessions: readonly AccountSession[];
  /** The newest of them, whose name, place and last use the row shows. */
  readonly latest: AccountSession;
}

/**
 * The devices list's rows (critic A #12, 5 November 2026: 19 rows of one Mac): this device alone first, then the
 * others merged by browser, system and place, each row as recent as its newest session, in the server's order.
 */
export function deviceGroups(sessions: readonly AccountSession[]): readonly DeviceGroup[] {
  const ordered = currentFirst(sessions);
  const keyOf = (session: AccountSession) =>
    session.current ? `current:${session.id}` : `${deviceName(session)}|${devicePlace(session) ?? ''}`;
  const groups = new Map<string, AccountSession[]>();
  for (const session of ordered) {
    const key = keyOf(session);
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  return [...groups.values()].flatMap((group) => {
    const [latest] = group;
    return latest === undefined ? [] : [{ id: latest.id, sessions: group, latest }];
  });
}

/** How many device rows show before "Show more": this device and the four most recent others. */
export const DEVICES_SHOWN = 5;
