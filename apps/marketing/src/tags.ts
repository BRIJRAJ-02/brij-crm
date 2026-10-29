// The site's outside measurement, as the old Timefix marketing site ran it (29 Oct 2026, the owner: "add all the
// tracking from the old code"): Google Analytics 4, Microsoft Clarity, and Vercel's Web Analytics and Speed
// Insights. Each tag is on only in a production build, only with its id set (`VITE_GA_MEASUREMENT_ID`,
// `VITE_CLARITY_PROJECT_ID`, `VITE_VERCEL_ANALYTICS`), and never in a browser under automation. Every script comes
// from a file or an address the CSP in vercel.json names: nothing here is inline, so `script-src` stays free of
// `'unsafe-inline'`. The privacy policy already names Google Analytics and Clarity.

/** The ids each tag needs; a tag with no id stays off. */
export interface TagIds {
  readonly ga?: string | undefined;
  readonly clarity?: string | undefined;
  /** Vercel's Web Analytics and Speed Insights, which the project must have switched on (`1` turns them on here). */
  readonly vercel?: boolean;
}

/** What the tags need from the browser, so a test passes its own. */
export interface TagHost {
  readonly href: string;
  readonly title: string;
  /** True under automation (Playwright, a crawler's browser): nothing loads. */
  readonly isAutomated: boolean;
  /** Adds an async script with this address to the page. */
  readonly addScript: (src: string) => void;
  /** The page's global object, where gtag's and Clarity's queues live. */
  readonly global: Record<string, unknown>;
}

/** A GA4 measurement id (`G-` and letters or digits); anything else is refused, so no address is built from it. */
const GA_ID = /^G-[A-Z0-9]{4,20}$/;
/** A Clarity project id: lower case letters and digits. */
const CLARITY_ID = /^[a-z0-9]{6,20}$/;

/** Which tags start for these ids: the list, in the order they load, for the page and its test. */
export function startTags(ids: TagIds, host: TagHost): readonly string[] {
  if (host.isAutomated) return [];
  const started: string[] = [];
  const ga = ids.ga?.trim();
  if (ga !== undefined && GA_ID.test(ga)) {
    // gtag's own bootstrap, as a module rather than the inline snippet: the queue first, then the library.
    const dataLayer = Array.isArray(host.global.dataLayer) ? (host.global.dataLayer as unknown[]) : [];
    host.global.dataLayer = dataLayer;
    const gtag = function gtag() {
      // gtag reads `arguments` itself, so the call is queued as it came.
      // eslint-disable-next-line prefer-rest-params
      dataLayer.push(arguments);
    };
    host.global.gtag = gtag;
    const call: (...args: unknown[]) => void = gtag;
    call('js', new Date());
    // One page view per page, sent by hand with the whole address, so `utm_*` and click ids reach the report.
    // Google signals off: no advertising audiences, so no calls to doubleclick or a country's google domain, which
    // the CSP couldn't name ahead of time anyway. Measurement is unchanged.
    call('config', ga, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
    call('event', 'page_view', { page_location: host.href, page_title: host.title });
    host.addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga)}`);
    started.push('ga');
  }
  const clarity = ids.clarity?.trim();
  if (clarity !== undefined && CLARITY_ID.test(clarity)) {
    // Clarity's queue, then its tag: the same two steps its snippet takes inline.
    const queue: unknown[][] = [];
    host.global.clarity ??= Object.assign((...args: unknown[]) => queue.push(args), { q: queue });
    host.addScript(`https://www.clarity.ms/tag/${encodeURIComponent(clarity)}`);
    started.push('clarity');
  }
  if (ids.vercel === true) {
    // Vercel serves both from the site's own origin once the project has them switched on.
    host.addScript('/_vercel/insights/script.js');
    host.addScript('/_vercel/speed-insights/script.js');
    started.push('vercel');
  }
  return started;
}
