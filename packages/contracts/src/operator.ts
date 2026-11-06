// The operator console, slice 1 (spec 0047): the super admin's read only
// analytics across every workspace. Counts, ids and names only: no record
// value, note, answer or booking visitor ever leaves through these shapes.
// Every procedure is behind the api's operator gate (OPERATOR_EMAILS, two
// factor, a recent sign in), never a workspace role.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Timestamp } from './values/attribute-values.ts';
import { Uuid } from './values/ids.ts';

/** The periods the console reads: the last 7, 30 or 90 UTC days, today included. */
export const OPERATOR_PERIODS = ['7d', '30d', '90d'] as const;

/** One of the console's periods. */
export const OperatorPeriod = z.enum(OPERATOR_PERIODS);
/** One of the console's periods. */
export type OperatorPeriod = z.infer<typeof OperatorPeriod>;

/** How many days a period covers. */
export const PERIOD_DAYS: Readonly<Record<OperatorPeriod, number>> = { '7d': 7, '30d': 30, '90d': 90 };

/** People one page of the users list holds. */
export const OPERATOR_USERS_PAGE = 50;

/** The longest search the users list takes. */
export const OPERATOR_SEARCH_MAX = 100;

/** A UTC day, `YYYY-MM-DD`. */
export const OperatorDay = z.iso.date();
/** A UTC day. */
export type OperatorDay = z.infer<typeof OperatorDay>;

/** The days a read covers: `from` and `to` inclusive, UTC. */
export const OperatorRange = z.object({ period: OperatorPeriod, from: OperatorDay, to: OperatorDay });
/** The days a read covers. */
export type OperatorRange = z.infer<typeof OperatorRange>;

/** A figure in the period, and the same figure in the period just before it. */
export const OperatorFigure = z.object({
  value: z.number().int().nonnegative(),
  before: z.number().int().nonnegative(),
});
/** A figure and its comparison. */
export type OperatorFigure = z.infer<typeof OperatorFigure>;

/** One day of the app's numbers. */
export const OperatorOverviewDay = z.object({
  day: OperatorDay,
  signups: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  records: z.number().int().nonnegative(),
  bookings: z.number().int().nonnegative(),
});
/** One day of the app's numbers. */
export type OperatorOverviewDay = z.infer<typeof OperatorOverviewDay>;

/** Overview (AC-1629): the app's dashboard analytics for a period. */
export const OperatorOverview = OperatorRange.extend({
  people: z.object({ total: z.number().int().nonnegative(), new: OperatorFigure }),
  active: z.object({
    /** Users active on any day of the period, against the period before. */
    period: OperatorFigure,
    today: z.number().int().nonnegative(),
    week: z.number().int().nonnegative(),
    month: z.number().int().nonnegative(),
  }),
  workspaces: z.object({ total: z.number().int().nonnegative(), new: OperatorFigure }),
  records: OperatorFigure,
  bookings: OperatorFigure,
  submissions: OperatorFigure,
  days: z.array(OperatorOverviewDay),
});
/** The app's dashboard analytics. */
export type OperatorOverview = z.infer<typeof OperatorOverview>;

/** How a person signs in. */
export const OperatorSignInMethod = z.enum(['email', 'google']);
/** How a person signs in. */
export type OperatorSignInMethod = z.infer<typeof OperatorSignInMethod>;

/** One person in the users list (AC-1630). */
export const OperatorUserRow = z.object({
  id: Uuid,
  name: z.string(),
  email: z.string(),
  createdAt: Timestamp,
  lastActiveAt: Timestamp.optional(),
  activeDays: z.number().int().nonnegative(),
  workspaces: z.number().int().nonnegative(),
  recordsMade: z.number().int().nonnegative(),
  bookingsHosted: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  twoFactor: z.boolean(),
});
/** One person in the users list. */
export type OperatorUserRow = z.infer<typeof OperatorUserRow>;

/** The users list's input: a period, an optional search, and where the last page ended. */
export const OperatorUsersInput = z.object({
  period: OperatorPeriod,
  q: z.string().trim().max(OPERATOR_SEARCH_MAX).optional(),
  after: z
    .string()
    .regex(/^\d{1,17}\.[0-9a-f-]{36}$/)
    .optional(),
});
/** The users list's input. */
export type OperatorUsersInput = z.infer<typeof OperatorUsersInput>;

/** One page of people, newest first, and the cursor of the next when there is one. */
export const OperatorUserPage = OperatorRange.extend({
  total: z.number().int().nonnegative(),
  users: z.array(OperatorUserRow),
  next: z.string().optional(),
});
/** One page of people. */
export type OperatorUserPage = z.infer<typeof OperatorUserPage>;

/** One workspace a person is in, with what they made there in the period. */
export const OperatorUserWorkspace = z.object({
  workspaceId: Uuid,
  name: z.string(),
  slug: z.string(),
  role: z.string(),
  status: z.string(),
  deleted: z.boolean(),
  members: z.number().int().nonnegative(),
  /** Live records in the workspace, counted to `OPERATOR_RECORDS_CAP` at most: past it, read as "100,000+". */
  records: z.number().int().nonnegative(),
  recordsMade: z.number().int().nonnegative(),
  bookingsHosted: z.number().int().nonnegative(),
  pagesOwned: z.number().int().nonnegative(),
});
/** One workspace a person is in. */
export type OperatorUserWorkspace = z.infer<typeof OperatorUserWorkspace>;

/** A person's page (AC-1630). */
export const OperatorUserDetail = OperatorRange.extend({
  user: OperatorUserRow.extend({
    emailVerified: z.boolean(),
    methods: z.array(OperatorSignInMethod),
    sessions: z.number().int().nonnegative(),
  }),
  days: z.array(z.object({ day: OperatorDay, active: z.boolean() })),
  workspaces: z.array(OperatorUserWorkspace),
});
/** A person's page. */
export type OperatorUserDetail = z.infer<typeof OperatorUserDetail>;

/** One booking page's figures in the period (AC-1631). */
export const OperatorPageRow = z.object({
  pageId: Uuid,
  workspaceId: Uuid,
  workspaceName: z.string(),
  title: z.string(),
  kind: z.string(),
  status: z.string(),
  owner: z.object({ id: Uuid, name: z.string(), email: z.string() }).optional(),
  createdAt: Timestamp,
  views: z.number().int().nonnegative(),
  visitors: z.number().int().nonnegative(),
  bookings: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
});
/** One booking page's figures. */
export type OperatorPageRow = z.infer<typeof OperatorPageRow>;

/** One day of booking page numbers. */
export const OperatorPageDay = z.object({
  day: OperatorDay,
  views: z.number().int().nonnegative(),
  visitors: z.number().int().nonnegative(),
  bookings: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
});
/** One day of booking page numbers. */
export type OperatorPageDay = z.infer<typeof OperatorPageDay>;

/** The four figures booking pages are read by. */
export const OperatorPageTotals = z.object({
  views: OperatorFigure,
  visitors: OperatorFigure,
  bookings: OperatorFigure,
  cancelled: OperatorFigure,
});
/** The four figures booking pages are read by. */
export type OperatorPageTotals = z.infer<typeof OperatorPageTotals>;

/** Every booking page together, and each one (AC-1631). */
export const OperatorPages = OperatorRange.extend({
  totals: OperatorPageTotals,
  days: z.array(OperatorPageDay),
  pages: z.array(OperatorPageRow),
});
/** Every booking page together, and each one. */
export type OperatorPages = z.infer<typeof OperatorPages>;

/** One booking page's own figures and days. */
export const OperatorPageDetail = OperatorRange.extend({
  page: OperatorPageRow,
  totals: OperatorPageTotals,
  days: z.array(OperatorPageDay),
});
/** One booking page's own figures and days. */
export type OperatorPageDetail = z.infer<typeof OperatorPageDetail>;

/** A ranked count: a page, a referrer, a source, a country or a device, and its visitors and views. */
export const OperatorRank = z.object({
  name: z.string(),
  visitors: z.number().int().nonnegative(),
  views: z.number().int().nonnegative(),
});
/** A ranked count. */
export type OperatorRank = z.infer<typeof OperatorRank>;

/** The most live records a workspace is counted to (its row reads "100,000+" past it). */
export const OPERATOR_RECORDS_CAP = 100_000;

/** The most booking pages the list holds, most viewed first. */
export const OPERATOR_PAGES_MAX = 500;

/** The website's figures (AC-1632). */
export const OperatorSite = OperatorRange.extend({
  /** Whether the site ever sent a visit: false means it isn't counting yet. */
  hasVisits: z.boolean(),
  visitors: OperatorFigure,
  views: OperatorFigure,
  days: z.array(
    z.object({
      day: OperatorDay,
      visitors: z.number().int().nonnegative(),
      views: z.number().int().nonnegative(),
    }),
  ),
  pages: z.array(OperatorRank),
  referrers: z.array(OperatorRank),
  sources: z.array(OperatorRank),
  countries: z.array(OperatorRank),
  devices: z.array(OperatorRank),
});
/** The website's figures. */
export type OperatorSite = z.infer<typeof OperatorSite>;

/** A period only. */
export const OperatorPeriodInput = z.object({ period: OperatorPeriod });
/** A period only. */
export type OperatorPeriodInput = z.infer<typeof OperatorPeriodInput>;

/** One person, in a period. */
export const OperatorUserInput = z.object({ userId: Uuid, period: OperatorPeriod });
/** One person, in a period. */
export type OperatorUserInput = z.infer<typeof OperatorUserInput>;

/** One booking page, in a period. */
export const OperatorPageInput = z.object({ workspaceId: Uuid, pageId: Uuid, period: OperatorPeriod });
/** One booking page, in a period. */
export type OperatorPageInput = z.infer<typeof OperatorPageInput>;

/**
 * The console's reads. Anyone the api doesn't count as a super admin gets
 * `NOT_FOUND`, as for a procedure that doesn't exist; a super admin without
 * two factor `TWO_FACTOR_REQUIRED`, and one whose sign in is over 12 hours
 * old `SIGN_IN_AGAIN` (AC-1618). A person or page that isn't there is
 * `NOT_FOUND`.
 */
export const operatorContract = {
  overview: oc.input(OperatorPeriodInput).output(OperatorOverview),
  users: oc.input(OperatorUsersInput).output(OperatorUserPage),
  user: oc.input(OperatorUserInput).output(OperatorUserDetail),
  pages: oc.input(OperatorPeriodInput).output(OperatorPages),
  page: oc.input(OperatorPageInput).output(OperatorPageDetail),
  site: oc.input(OperatorPeriodInput).output(OperatorSite),
};

/** What the marketing site's beacon sends (AC-1627): the path, the referring site's host, and `utm_source`. */
export const SiteHit = z.object({
  path: z.string().min(1).max(200).startsWith('/'),
  referrer: z.string().min(1).max(120).optional(),
  source: z.string().min(1).max(60).optional(),
});
/** What the marketing site's beacon sends. */
export type SiteHit = z.infer<typeof SiteHit>;
