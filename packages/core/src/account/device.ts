// What device a session is on (spec 0033, AC-890): the browser's family and
// its system, read once from the user agent at sign in, so Account › Security
// can say "Chrome on macOS". A best effort read of a header anyone can set: it
// is shown to the account's own person and never trusted for anything.

/** A browser family and a system, each empty when the user agent didn't say. */
export interface DeviceParts {
  readonly browser: string;
  readonly system: string;
}

/** The longest user agent read; anything past it is ignored (a header can be long). */
const MAX_AGENT = 512;

// Order matters: Edge and Opera also say Chrome, Chrome also says Safari.
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\bCriOS\//, 'Chrome'],
  [/\b(?:Chrome|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

// iPad before Mac (an iPad asking for desktop pages says Macintosh, which it then is to us).
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\biPhone\b/, 'iOS'],
  [/\biPad\b/, 'iPadOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac(?:intosh| OS X)\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

/** The browser family and system a user agent names. */
export function deviceParts(userAgent: string | null | undefined): DeviceParts {
  const agent = (userAgent ?? '').slice(0, MAX_AGENT);
  const browser = BROWSERS.find(([pattern]) => pattern.test(agent))?.[1] ?? '';
  const system = SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1] ?? '';
  return { browser, system };
}

/** "Chrome on macOS", "Chrome", "macOS", or empty when the user agent said nothing we know. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const { browser, system } = deviceParts(userAgent);
  if (browser !== '' && system !== '') return `${browser} on ${system}`;
  return browser !== '' ? browser : system;
}
