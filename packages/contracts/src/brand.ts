// The Timefix links on the pages and emails Timefix makes for other people (owner, 20 October 2026): "Powered by
// Timefix" and "Claim your free page". The one place that says where they go and what they are tagged with, so the
// booking pages, the guest's page, the hosted form and every email tag them the same way, and a tag is renamed here
// alone. Plain TypeScript with no Zod, so the public pages' bundles stay small.

/** The marketing site every Timefix link goes to. */
export const TIMEFIX_SITE = 'https://www.timefix.com';

/**
 * The app, where signing in and signing up both happen (the server decides which an email is), beside the public
 * booking origin. The marketing site holds the same address in `apps/marketing/src/site.ts`.
 */
export const TIMEFIX_APP = 'https://app.timefix.com';

/** Where the app's sign in page lives, the one way in for a new person too. */
export const SIGN_IN_PATH = '/sign-in';

/**
 * The sign in page, carrying the address a visitor was offered (`/<handle>` that nobody holds, 25 Oct 2026), so
 * they do not have to type it again. `appOrigin` lets a page on one origin point at the app on another; left off,
 * or anything but an `https` origin, the path is relative, which is what a deployment serving both on one origin
 * wants and what keeps this from building a link to somebody else's host. The handle rides as `handle`, already
 * public (it is the address the visitor typed), and nothing else ever does.
 */
export function signInPath(options: { readonly handle?: string; readonly appOrigin?: string } = {}): string {
  const base = `${httpsOrigin(options.appOrigin)}${SIGN_IN_PATH}`;
  const { handle } = options;
  return handle === undefined || handle === '' ? base : `${base}?${new URLSearchParams({ handle }).toString()}`;
}

/** `value` as an `https` origin alone, or the empty string for anything else, so no caller can hand over a host. */
function httpsOrigin(value: string | undefined): string {
  if (value === undefined || value === '') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : '';
  } catch {
    return '';
  }
}

/**
 * The public pages a Timefix link sits on, sent as `utm_medium`: the booking page (one page at both of its
 * addresses, `/b/<key>` and `/<handle>/<slug>`, framed or not), a person's profile (`/<handle>`), the guest's page
 * just after booking and when they come back to it, and the hosted form (framed or not).
 */
export const POWERED_BY_PAGES = [
  'booking_page',
  'booking_profile',
  'booking_confirmation',
  'booking_manage',
  'form',
] as const;
/** A public page a Timefix link sits on (`utm_medium`). */
export type PoweredByPage = (typeof POWERED_BY_PAGES)[number];

/** The emails a Timefix link sits in, sent as `utm_medium`: one word per family of email. */
export const POWERED_BY_EMAILS = [
  'email_sign_in',
  'email_sign_in_alert',
  'email_invite',
  'email_form_notice',
  'email_form_confirmation',
  'email_calendar_alert',
  'email_booking',
  'email_reminder',
  'email_import',
  'email_job',
  'email_mention',
] as const;
/** The family of email a Timefix link sits in (`utm_medium`). */
export type PoweredByEmail = (typeof POWERED_BY_EMAILS)[number];

/**
 * Every place a Timefix link sits (`utm_medium`): a closed list, so nothing but these words, never a workspace or
 * a person, can ride in it.
 */
export const POWERED_BY_SURFACES = [...POWERED_BY_PAGES, ...POWERED_BY_EMAILS] as const;
/** Where a Timefix link sits (`utm_medium`). */
export type PoweredBySurface = (typeof POWERED_BY_SURFACES)[number];

/**
 * Which of a surface's Timefix links it is, sent as `utm_content`: the wordmark in the footer ("Powered by
 * Timefix"), or "Claim your free page" beside it.
 */
export const POWERED_BY_PLACEMENTS = ['footer_logo', 'claim_link'] as const;
/** Which of a surface's Timefix links it is (`utm_content`). */
export type PoweredByPlacement = (typeof POWERED_BY_PLACEMENTS)[number];

/** What a Timefix link is built from. */
export interface TimefixLink {
  readonly surface: PoweredBySurface;
  /** Left off for the footer's wordmark. */
  readonly placement?: PoweredByPlacement | undefined;
  /**
   * The workspace's web address (`acme`), sent as `ref` by a page that knows it. Emails leave it off. Left out of
   * the link unless it has a workspace address's shape and isn't an id, so no name, email or id can reach it.
   */
  readonly workspaceSlug?: string | undefined;
}

/** A workspace's web address, the rule `WorkspaceSlug` and the database check: 3 to 40 lowercase letters and digits in single dash runs. */
const WORKSPACE_ADDRESS = /^(?=.{3,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A UUID has that shape too, but it is an id, never an address. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A Timefix link: `https://www.timefix.com/` tagged `utm_source=timefix`, `utm_medium=<surface>`,
 * `utm_campaign=powered_by` and `utm_content=<placement>`, in that order, then `ref=<workspace address>` when the
 * surface knows one. Every value is a word from the lists above or a workspace address, so nothing personal can
 * ride in it; a surface or placement off those lists throws.
 */
export function timefixUrl({ surface, placement = 'footer_logo', workspaceSlug }: TimefixLink): string {
  if (!(POWERED_BY_SURFACES as readonly string[]).includes(surface)) {
    throw new Error('That isn’t a Timefix link surface.');
  }
  if (!(POWERED_BY_PLACEMENTS as readonly string[]).includes(placement)) {
    throw new Error('That isn’t a Timefix link placement.');
  }
  const query = new URLSearchParams({
    utm_source: 'timefix',
    utm_medium: surface,
    utm_campaign: 'powered_by',
    utm_content: placement,
  });
  if (workspaceSlug !== undefined && WORKSPACE_ADDRESS.test(workspaceSlug) && !UUID.test(workspaceSlug)) {
    query.set('ref', workspaceSlug);
  }
  return `${TIMEFIX_SITE}/?${query.toString()}`;
}

/**
 * The wallets a page's pass can be kept in, sent as `utm_medium` (26 October 2026). The owner carries their own
 * link page in their wallet and shows its code; a visit that came from that scan should be tellable from one that
 * came from a shared link, which is the whole point of tagging it.
 */
export const WALLET_KINDS = ['apple_wallet', 'google_wallet'] as const;
/** Which wallet a pass is in (`utm_medium`). */
export type WalletKind = (typeof WALLET_KINDS)[number];

/**
 * The owner's own page as a wallet pass's code carries it: their address, tagged `utm_source=timefix`,
 * `utm_medium=<wallet>` and `utm_campaign=wallet_pass`. A query the address already had is kept, and a tag it
 * already had is overwritten, so the pass's own tags always win. Anything but an `https` address throws, since a
 * pass is signed and shipped to a phone and nothing unchecked belongs in one.
 */
export function walletPageUrl(pageUrl: string, kind: WalletKind): string {
  if (!(WALLET_KINDS as readonly string[]).includes(kind)) throw new Error('That isn’t a wallet.');
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    throw new Error('A wallet pass needs a full https address.');
  }
  if (url.protocol !== 'https:') throw new Error('A wallet pass needs a full https address.');
  url.searchParams.set('utm_source', 'timefix');
  url.searchParams.set('utm_medium', kind);
  url.searchParams.set('utm_campaign', 'wallet_pass');
  url.hash = '';
  return url.href;
}
