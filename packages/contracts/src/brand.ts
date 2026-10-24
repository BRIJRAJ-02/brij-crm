// The Timefix links on the pages and emails Timefix makes for other people (owner, 20 October 2026): "Powered by
// Timefix" and "Claim your free page". The one place that says where they go and what they are tagged with, so the
// booking pages, the guest's page, the hosted form and every email tag them the same way, and a tag is renamed here
// alone. Plain TypeScript with no Zod, so the public pages' bundles stay small.

/** The marketing site every Timefix link goes to. */
export const TIMEFIX_SITE = 'https://www.timefix.com';

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
