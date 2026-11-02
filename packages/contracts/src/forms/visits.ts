// Forms analytics (spec 0063, AC-6320 to AC-6322): the beacon's event body,
// how a visit's source is normalised, and the shapes the Analytics tab reads.
//
// The privacy line this file holds (AC-6320): a visit is known only by the
// daily keyed hash the link page already mints (spec 0047), which is a
// different value for the same browser tomorrow, on purpose. No cookie, no
// address and no lasting visitor id are ever stored, and a source is cut to a
// host or a UTM word, never a whole address with its query.
import * as z from 'zod';
import { WorkspaceScoped } from '../workspaces.ts';
import { Uuid } from '../values/ids.ts';
import { FILL_TICKET_MAX } from './ticket.ts';

/** What the beacon reports: the page was seen, the first answer was given, or a question was reached. */
export const FORM_EVENT_KINDS = ['view', 'start', 'reach'] as const;
/** One kind of beacon event. */
export type FormEventKind = (typeof FORM_EVENT_KINDS)[number];

/** How long a source string may be once normalised (the column's own cap). */
export const FORM_SOURCE_MAX = 60;

/** How long a visit row is kept (AC-6320's retention): thirteen months, so a year on year read still has last year. */
export const FORM_VISITS_KEPT_DAYS = 396;

/** The ranges the Analytics tab offers, in days (AC-6321). */
export const FORM_ANALYTICS_RANGES = [7, 30, 90] as const;
/** One of the Analytics tab's ranges. */
export type FormAnalyticsRange = (typeof FORM_ANALYTICS_RANGES)[number];

/**
 * The beacon's body (`POST /api/public/forms/:publicKey/events`). It passes
 * the same bot checks a submit does (AC-6330): the honeypot and the signed
 * fill ticket, plus the route's rate limits and size cap. The endpoint always
 * answers 204, so a blocked or lost beacon never shows the visitor an error:
 * analytics are lossy by design.
 */
export const FormEventBody = z.object({
  kind: z.enum(FORM_EVENT_KINDS),
  /** Which question was reached, on a `reach`; ignored on the others. */
  questionId: z.string().max(40).optional(),
  /** Where the visitor came from, as the page saw it: a UTM source, else the referrer. Normalised on the server. */
  source: z.string().max(400).optional(),
  ticket: z.string().max(FILL_TICKET_MAX).optional(),
  /** The honeypot: a filled one is counted as nothing at all. */
  company_url: z.string().max(1_000).optional(),
});
/** The beacon's body. */
export type FormEventBody = z.input<typeof FormEventBody>;

/** A source word cut to what a column holds: lowercased, the odd characters dropped. */
function tidy(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9.\-_]/gu, '')
    .slice(0, FORM_SOURCE_MAX - 5);
}

/**
 * Where a visit came from, in one short, unidentifying word (AC-6320,
 * AC-6321): `utm:<source>` when the link carried one, else `ref:<host>` for
 * the referring site, else `direct`. Only the host of a referrer survives, so
 * no path, query or fragment of the page someone came from is ever stored.
 * The same function runs on the page and on the server, and the server's
 * answer is the one kept.
 */
export function normaliseSource(input: { readonly utmSource?: string; readonly referrer?: string }): string {
  const utm = tidy(input.utmSource ?? '');
  if (utm !== '') return `utm:${utm}`;
  const referrer = (input.referrer ?? '').trim();
  if (referrer === '') return 'direct';
  try {
    const host = tidy(new URL(referrer).hostname.replace(/^www\./u, ''));
    return host === '' ? 'direct' : `ref:${host}`;
  } catch {
    return 'direct';
  }
}

/** `forms.analytics`'s input: one form, over 7, 30 or 90 days. */
export const FormAnalyticsInput = WorkspaceScoped.extend({
  formId: Uuid,
  range: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
});
/** `forms.analytics`'s input. */
export type FormAnalyticsInput = z.input<typeof FormAnalyticsInput>;

const Count = z.number().int().min(0);

/** A range's headline numbers (AC-6320): `medianMs` is absent when nobody completed in the range. */
export const FormAnalyticsTotals = z.object({
  views: Count,
  /** Visitors who gave a first answer. */
  starts: Count,
  /** Accepted submissions, spam and held ones left out. */
  completions: Count,
  /** The median time from the first answer to the accepted submit, in milliseconds. */
  medianMs: Count.optional(),
});
/** A range's headline numbers. */
export type FormAnalyticsTotals = z.infer<typeof FormAnalyticsTotals>;

/** One UTC day of the chart (AC-6321). */
export const FormAnalyticsDay = z.object({
  day: z.iso.date(),
  views: Count,
  starts: Count,
  completions: Count,
});
/** One UTC day of the chart. */
export type FormAnalyticsDay = z.infer<typeof FormAnalyticsDay>;

/**
 * One question's drop off (AC-6321, AC-6322). `reached` counts the visitors
 * whose furthest question was this one or a later one (a completion reached
 * every question on its path); `answered` counts those who went past it or
 * finished. `leftHere` is the difference: the people this question lost.
 */
export const FormAnalyticsQuestion = z.object({
  questionId: z.string(),
  reached: Count,
  answered: Count,
  leftHere: Count,
});
/** One question's drop off. */
export type FormAnalyticsQuestion = z.infer<typeof FormAnalyticsQuestion>;

/** One row of the by source table: the normalised source and what it brought. */
export const FormAnalyticsSource = z.object({
  source: z.string().max(FORM_SOURCE_MAX),
  views: Count,
  completions: Count,
});
/** One row of the by source table. */
export type FormAnalyticsSource = z.infer<typeof FormAnalyticsSource>;

/**
 * A form's analytics over a range (AC-6321), with the same numbers for the
 * range before it, so every headline can show its change. Nothing here names
 * a visitor: the rows are counts.
 */
export const FormAnalytics = z.object({
  range: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  totals: FormAnalyticsTotals,
  /** The range immediately before this one, for the change line. */
  previous: FormAnalyticsTotals,
  byDay: z.array(FormAnalyticsDay),
  byQuestion: z.array(FormAnalyticsQuestion),
  bySource: z.array(FormAnalyticsSource),
});
/** A form's analytics over a range. */
export type FormAnalytics = z.infer<typeof FormAnalytics>;
