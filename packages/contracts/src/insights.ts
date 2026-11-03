// Analytics across products (spec 0067): the page kinds and their steps, how a visit's source is read, the beacon
// bodies, the Insights screen's reads and the numbers only share links.
//
// The privacy line (AC-6701, AC-6720, AC-6731): a visit is known only by spec 0047's daily keyed hash, which the api
// mints and keeps neither half of. A source is a short word, a referrer a host, a landing address only its UTM tags
// and whether a click id was there. Names reach a member only through the access door, and a share link carries
// numbers alone: never a session, a name, an email, a free text answer or a parameter beyond source, medium and
// campaign.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** Every kind of public page Timefix counts (AC-6701). Menus, QR codes, events and reservations arrive later. */
export const PAGE_KINDS = [
  'form',
  'booking',
  'business_booking',
  'reservation',
  'event',
  'link',
  'menu',
  'qr',
] as const;
/** One kind of public page. */
export const PageKind = z.enum(PAGE_KINDS);
/** One kind of public page. */
export type PageKind = z.infer<typeof PageKind>;

/**
 * Each kind's steps before its finish, in order (AC-6702); `view` is always first and the finish is never a step.
 * A visit keeps the furthest it reached, so a Back never moves it backwards.
 */
export const PAGE_STEPS = {
  form: ['view', 'start'],
  booking: ['view', 'time', 'details'],
  business_booking: ['view', 'service', 'time', 'details'],
  reservation: ['view', 'party', 'time', 'details'],
  event: ['view'],
  link: ['view'],
  menu: ['view', 'item'],
  qr: ['view'],
} as const satisfies Record<PageKind, readonly string[]>;

/** A step a kind defines. */
export type PageStep = (typeof PAGE_STEPS)[PageKind][number];

/** The rollup's word for a visit that finished. */
export const FINISH_STEP = 'finish';

/** A step's place in its kind's order, or undefined for a step the kind doesn't have. */
export function stepRank(kind: PageKind, step: string): number | undefined {
  const at = (PAGE_STEPS[kind] as readonly string[]).indexOf(step);
  return at < 0 ? undefined : at;
}

/** How long a source, medium or campaign word may be once normalised (the column's own cap). */
export const VISIT_WORD_MAX = 60;

/** How long raw visits are kept (AC-6730): thirteen months, so a year on year read still has last year. */
export const PAGE_VISITS_KEPT_DAYS = 396;

/** The referrer groups (AC-6703), besides a UTM source and the two ad networks. */
export const REFERRER_GROUPS = ['google', 'instagram', 'facebook', 'tiktok', 'linkedin'] as const;

/**
 * The landing address's parameters a visit keeps (AC-6715): the UTM tags as given, and only whether a Google or Meta
 * click id was there, never the id, which identifies a click.
 */
export const VisitLanding = z.strictObject({
  utm_source: z.string().max(100).optional(),
  utm_medium: z.string().max(100).optional(),
  utm_campaign: z.string().max(100).optional(),
  /** Presence only: an email tool may put the recipient's address or an id in these two. */
  utm_term: z.literal(true).optional(),
  utm_content: z.literal(true).optional(),
  gclid: z.literal(true).optional(),
  fbclid: z.literal(true).optional(),
});
/** The landing address's parameters a visit keeps. */
export type VisitLanding = z.infer<typeof VisitLanding>;

/** The UTM tags this reads, in the order a session shows them. */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;
/** The tags kept only as being there. */
const PRESENCE_KEYS = ['utm_term', 'utm_content', 'gclid', 'fbclid'] as const;

/**
 * The landing parameters from a page's own address (`location.search`): the UTM tags cut to 100 characters, and a
 * click id's presence. Anything else on the address is left behind. The server parses what it is sent again.
 */
export function readLanding(search: string): VisitLanding | undefined {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return undefined;
  }
  const landing: Record<string, string | true> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key)?.trim();
    if (value !== undefined && value !== '') landing[key] = value.slice(0, 100);
  }
  for (const key of PRESENCE_KEYS) if ((params.get(key) ?? '') !== '') landing[key] = true;
  const parsed = VisitLanding.safeParse(landing);
  return parsed.success && Object.keys(parsed.data).length > 0 ? parsed.data : undefined;
}

/** A word cut to what a column holds: lowercased, the odd characters dropped. */
function tidyWord(word: string | undefined): string | undefined {
  const tidied = (word ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9 .\-_+]/gu, '')
    .replaceAll(/\s+/gu, ' ')
    .slice(0, VISIT_WORD_MAX)
    .trim();
  return tidied === '' ? undefined : tidied;
}

/** Where a visit came from, normalised (AC-6703). */
export interface VisitSource {
  /** A UTM source, `google` or `meta` for an ad click, a referrer group, `other`, or `direct`. */
  readonly source: string;
  readonly medium?: string;
  readonly campaign?: string;
  /** The referring host, kept for the Other group only. */
  readonly referrerHost?: string;
}

/** A host's referrer group, or undefined for one outside them. */
function groupOf(host: string): (typeof REFERRER_GROUPS)[number] | undefined {
  if (/(^|\.)google\.[a-z.]+$/u.test(host)) return 'google';
  if (/(^|\.)instagram\.com$/u.test(host)) return 'instagram';
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/u.test(host)) return 'facebook';
  if (/(^|\.)tiktok\.com$/u.test(host)) return 'tiktok';
  if (/(^|\.)(linkedin\.com|lnkd\.in)$/u.test(host)) return 'linkedin';
  return undefined;
}

/**
 * Where a visit came from (AC-6703), in this order: the landing address's `utm_source` (with its medium and
 * campaign); else a Google or Meta click id, read as their ads; else the referrer's host in its group (Google,
 * Instagram, Facebook, TikTok, LinkedIn), or Other with the host kept; else Direct. A referrer on one of our own
 * hosts is Direct. The same function runs on the server, whose answer is the one kept.
 */
export function classifySource(input: {
  readonly landing?: VisitLanding;
  readonly referrer?: string;
  readonly ownHosts?: readonly string[];
}): VisitSource {
  const landing = input.landing ?? {};
  const medium = tidyWord(landing.utm_medium);
  const campaign = tidyWord(landing.utm_campaign);
  const tagged = { ...(medium === undefined ? {} : { medium }), ...(campaign === undefined ? {} : { campaign }) };
  const utm = tidyWord(landing.utm_source);
  if (utm !== undefined) return { source: utm, ...tagged };
  if (landing.gclid === true)
    return { source: 'google', medium: medium ?? 'paid', ...(campaign === undefined ? {} : { campaign }) };
  if (landing.fbclid === true)
    return { source: 'meta', medium: medium ?? 'paid', ...(campaign === undefined ? {} : { campaign }) };
  const referrer = (input.referrer ?? '').trim();
  if (referrer === '') return { source: 'direct' };
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./u, '');
  } catch {
    return { source: 'direct' };
  }
  if (host === '' || (input.ownHosts ?? []).some((own) => own.toLowerCase().replace(/^www\./u, '') === host)) {
    return { source: 'direct' };
  }
  const group = groupOf(host);
  if (group !== undefined) return { source: group, medium: 'referral' };
  const kept = /^[a-z0-9.-]{1,120}$/u.test(host) ? host : undefined;
  return { source: 'other', medium: 'referral', ...(kept === undefined ? {} : { referrerHost: kept }) };
}

/**
 * The beacon a booking page sends (`POST /api/public/booking/:publicKey/events`, AC-6702): the page was seen, or a
 * step was reached. The finish is never a beacon: the server marks it when the booking is made. Always 204.
 */
export const PageBeaconBody = z.strictObject({
  kind: z.enum(['view', 'step']),
  step: z.string().max(20).optional(),
  landing: VisitLanding.optional(),
  /** The page's `document.referrer`; only its host is ever kept. */
  referrer: z.string().max(400).optional(),
});
/** The beacon a booking page sends. */
export type PageBeaconBody = z.infer<typeof PageBeaconBody>;

/** The ranges the screen offers (AC-6710), in days, or all time. A custom range is `from` and `to`. */
export const INSIGHT_RANGES = ['7', '30', '90', '365', 'all'] as const;
/** One of the screen's ranges. */
export const InsightRange = z.enum(INSIGHT_RANGES);
/** One of the screen's ranges. */
export type InsightRange = z.infer<typeof InsightRange>;

/** The longest custom range, in days. */
export const INSIGHT_CUSTOM_MAX_DAYS = 400;

/** Which pages the numbers cover (AC-6710): every page the reader may see, one kind, or one page. */
export const InsightPages = z.strictObject({
  kind: PageKind.optional(),
  pageId: Uuid.optional(),
});
/** Which pages the numbers cover. */
export type InsightPages = z.infer<typeof InsightPages>;

/** The period: one of the ranges, or a custom `from` to `to` (UTC days, both included). */
export const InsightPeriod = z.union([
  z.strictObject({ range: InsightRange }),
  z.strictObject({ from: z.iso.date(), to: z.iso.date() }),
]);
/** The period. */
export type InsightPeriod = z.infer<typeof InsightPeriod>;

/** `insights.read`'s input. */
export const InsightsInput = WorkspaceScoped.extend({
  period: InsightPeriod,
  pages: InsightPages.default({}),
});
/** `insights.read`'s input. */
export type InsightsInput = z.input<typeof InsightsInput>;

const Count = z.number().int().min(0);

/** A period's headline numbers (AC-6711). `avgMs` is absent when nobody finished with a measured time. */
export const InsightTotals = z.object({
  visits: Count,
  finishes: Count,
  avgMs: Count.optional(),
});
/** A period's headline numbers. */
export type InsightTotals = z.infer<typeof InsightTotals>;

/** One bar pair of the chart (AC-6712): a day, or a week starting on its Monday. */
export const InsightBucket = z.object({
  start: z.iso.date(),
  visits: Count,
  finishes: Count,
});
/** One bar pair of the chart. */
export type InsightBucket = z.infer<typeof InsightBucket>;

/** One step of the funnel (AC-6713): how many reached it or went further. */
export const InsightFunnelStep = z.object({ step: z.string(), reached: Count });
/** One step of the funnel. */
export type InsightFunnelStep = z.infer<typeof InsightFunnelStep>;

/** Where people stop on one kind of page: each step reached, then the finishes. */
export const InsightFunnel = z.object({
  kind: PageKind,
  steps: z.array(InsightFunnelStep),
  finished: Count,
});
/** Where people stop on one kind of page. */
export type InsightFunnel = z.infer<typeof InsightFunnel>;

/** One row of the Sources table (AC-6714). */
export const InsightSource = z.object({
  source: z.string(),
  medium: z.string(),
  campaign: z.string(),
  visits: Count,
  finishes: Count,
});
/** One row of the Sources table. */
export type InsightSource = z.infer<typeof InsightSource>;

/** One host under Other (AC-6714). */
export const InsightOtherHost = z.object({ host: z.string(), visits: Count });
/** One host under Other. */
export type InsightOtherHost = z.infer<typeof InsightOtherHost>;

/** A page the picker offers (AC-6710): only pages the reader may see. */
export const InsightPage = z.object({ kind: PageKind, id: Uuid, name: z.string() });
/** A page the picker offers. */
export type InsightPage = z.infer<typeof InsightPage>;

/** The numbers a share link shows (AC-6720): no session, name, host or free text, ever. */
export const InsightNumbers = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  grain: z.enum(['day', 'week']),
  totals: InsightTotals,
  /** The equal period just before, for the change line; absent for all time. */
  previous: InsightTotals.optional(),
  buckets: z.array(InsightBucket),
  /** Present when the pages are one kind with steps to stop at. */
  funnel: InsightFunnel.optional(),
  sources: z.array(InsightSource),
});
/** The numbers a share link shows. */
export type InsightNumbers = z.infer<typeof InsightNumbers>;

/** `insights.read`'s answer: the numbers, Other's hosts, and the pages the picker offers. */
/**
 * One answer to a form's How did you hear about us question (AC-6703, AC-6714), counted over the period's accepted
 * submissions. A member's read only, never a share link: the answers are a visitor's own words.
 */
export const InsightHeard = z.object({ answer: z.string(), submissions: Count });
/** One answer to a form's How did you hear about us question. */
export type InsightHeard = z.infer<typeof InsightHeard>;

export const Insights = InsightNumbers.extend({
  others: z.array(InsightOtherHost),
  /** The source questions' answers, most first; empty when no form in view asks one. */
  heard: z.array(InsightHeard),
  pages: z.array(InsightPage),
});
/** `insights.read`'s answer. */
export type Insights = z.infer<typeof Insights>;

/** The Sessions table's column filters (AC-6715). */
export const InsightSessionFilter = z.strictObject({
  finished: z.boolean().optional(),
  source: z.string().max(VISIT_WORD_MAX).optional(),
  medium: z.string().max(VISIT_WORD_MAX).optional(),
  campaign: z.string().max(VISIT_WORD_MAX).optional(),
  step: z.string().max(20).optional(),
});
/** The Sessions table's column filters. */
export type InsightSessionFilter = z.infer<typeof InsightSessionFilter>;

/** How many sessions a page holds. */
export const INSIGHT_SESSIONS_PAGE = 50;

/** `insights.sessions`'s input. */
export const InsightSessionsInput = WorkspaceScoped.extend({
  period: InsightPeriod,
  pages: InsightPages.default({}),
  filter: InsightSessionFilter.default({}),
  cursor: z.string().max(200).optional(),
});
/** `insights.sessions`'s input. */
export type InsightSessionsInput = z.input<typeof InsightSessionsInput>;

/** One session (AC-6715). `person` only for a finish the reader may read through the access door. */
export const InsightSession = z.object({
  id: z.string(),
  at: z.iso.datetime({ offset: true }),
  pageKind: PageKind,
  pageId: Uuid,
  pageName: z.string(),
  finished: z.boolean(),
  source: z.string(),
  medium: z.string().optional(),
  campaign: z.string().optional(),
  furthestStep: z.string(),
  person: z.object({ name: z.string().optional(), email: z.string().optional() }).optional(),
  landing: VisitLanding.optional(),
});
/** One session. */
export type InsightSession = z.infer<typeof InsightSession>;

/** A page of sessions, newest first. */
export const InsightSessionPage = z.object({
  items: z.array(InsightSession),
  nextCursor: z.string().optional(),
});
/** A page of sessions. */
export type InsightSessionPage = z.infer<typeof InsightSessionPage>;

/** A share link as its list shows it (AC-6720): never its secret, which is shown once when it is made. */
export const InsightShare = z.object({
  id: Uuid,
  label: z.string(),
  pageKind: PageKind.optional(),
  pageId: Uuid.optional(),
  range: InsightRange,
  pageCount: Count,
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  revokedAt: z.iso.datetime({ offset: true }).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  /** Whether the reader made it: only its maker, or an admin, revokes it. */
  isMine: z.boolean(),
});
/** A share link as its list shows it. */
export type InsightShare = z.infer<typeof InsightShare>;

/** The most share links a workspace holds, revoked ones included until they are a year old. */
export const INSIGHT_SHARES_MAX = 100;

/** `insights.shares.create`'s input. */
export const InsightShareCreateInput = WorkspaceScoped.extend({
  label: z.string().trim().min(1, 'Give the link a name.').max(80, 'Keep the name under 80 characters.'),
  pages: InsightPages.default({}),
  range: InsightRange,
  /** Absent, it never expires; otherwise a time in the future, at most a year out. */
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});
/** `insights.shares.create`'s input. */
export type InsightShareCreateInput = z.input<typeof InsightShareCreateInput>;

/** A share link just made, with its secret: shown once, never stored. */
export const InsightShareCreated = z.object({ share: InsightShare, token: z.string() });
/** A share link just made, with its secret. */
export type InsightShareCreated = z.infer<typeof InsightShareCreated>;

/** `insights.shares.revoke`'s input. */
export const InsightShareRevokeInput = WorkspaceScoped.extend({ shareId: Uuid });
/** `insights.shares.revoke`'s input. */
export type InsightShareRevokeInput = z.infer<typeof InsightShareRevokeInput>;

/** A share link's token: the workspace and the share as 32 hex digits each, then 43 characters of secret. */
export const INSIGHT_SHARE_TOKEN = /^[0-9a-f]{32}[0-9a-f]{32}[A-Za-z0-9_-]{43}$/u;

/** What `GET /api/public/insights/:token` answers (AC-6720): its label, which pages, and the numbers. */
export const SharedInsights = z.object({
  label: z.string(),
  workspaceName: z.string(),
  pageNames: z.array(z.string()),
  range: InsightRange,
  numbers: InsightNumbers,
});
/** What a share link opens. */
export type SharedInsights = z.infer<typeof SharedInsights>;

/** Insights (spec 0067). */
export const insightsContract = {
  read: oc.input(InsightsInput).output(Insights),
  sessions: oc.input(InsightSessionsInput).output(InsightSessionPage),
  shares: {
    list: oc.input(WorkspaceScoped).output(z.object({ shares: z.array(InsightShare) })),
    create: oc.input(InsightShareCreateInput).output(InsightShareCreated),
    revoke: oc.input(InsightShareRevokeInput).output(InsightShare),
  },
};
