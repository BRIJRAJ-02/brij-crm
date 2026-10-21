// Settings › Account › Security's device lines (spec 0033, AC-890): plain
// functions, so they are tested without the screen.
import type { AccountSession } from '@crm/data';
import { strings } from './security-strings.ts';

const regions = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' });
  } catch {
    return undefined;
  }
})();
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const STEPS = [
  { unit: 'year', ms: 365 * 86_400_000 },
  { unit: 'month', ms: 30 * 86_400_000 },
  { unit: 'week', ms: 7 * 86_400_000 },
  { unit: 'day', ms: 86_400_000 },
  { unit: 'hour', ms: 3_600_000 },
  { unit: 'minute', ms: 60_000 },
] as const;

/** "2 hours ago", "yesterday": how long since a moment, in the browser's language. */
export function sinceText(iso: string, now = Date.now()): string {
  const ago = Math.max(0, now - Date.parse(iso));
  const step = STEPS.find((each) => ago >= each.ms);
  return step === undefined ? relative.format(0, 'minute') : relative.format(-Math.floor(ago / step.ms), step.unit);
}

/** A device's name: its browser and system, or a plain word when the browser said nothing useful. */
export const deviceName = (session: Pick<AccountSession, 'deviceLabel'>): string =>
  session.deviceLabel.trim() === '' ? strings.unknownDevice : session.deviceLabel;

/** Where and when: "Mumbai, India · Active 2 hours ago", leaving out what isn't known. */
export function deviceDetail(session: AccountSession, now = Date.now()): string {
  const country = session.country === undefined ? undefined : (regions?.of(session.country) ?? session.country);
  const place = [session.city, country].filter((each) => each !== undefined && each !== '').join(', ');
  const when = session.current ? strings.activeNow : strings.active(sinceText(session.lastActiveAt, now));
  return place === '' ? when : `${place} · ${when}`;
}
