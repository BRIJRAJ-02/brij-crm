// Where a submission came from, as its panel reads it (spec 0023, tagging):
// the stored context where it has one (the embed script and the hosted page
// send it), else the older hidden fields. Addresses show as their path on
// their site, the way a person names a page ("/pricing on acme.com").
import type { SubmissionView } from '@crm/data';
import { strings } from './strings.ts';

/** One line of Came from: what it is and its value. */
export interface CameFromItem {
  readonly term: string;
  readonly description: string;
}

/** An address as a person names it: its path on its host, or the text as it is when it isn't one. */
export function pageName(address: string): string {
  if (!URL.canParse(address)) return address;
  const url = new URL(address);
  const path = url.pathname === '/' && url.search === '' ? strings.cameFromHome : `${url.pathname}${url.search}`;
  return `${path} on ${url.host}`;
}

/** The UTM tags, with how each reads. */
const UTM: readonly (readonly [string, string])[] = [
  ['utm_source', strings.utmSource],
  ['utm_medium', strings.utmMedium],
  ['utm_campaign', strings.utmCampaign],
  ['utm_term', strings.utmTerm],
  ['utm_content', strings.utmContent],
];

/** Came from's lines for one submission, in reading order; empty when nothing came with it. */
export function cameFromOf(submission: Pick<SubmissionView, 'context' | 'hidden'>): readonly CameFromItem[] {
  const { context, hidden } = submission;
  const page = context?.page_url ?? hidden.page;
  const referrer = context?.referrer ?? hidden.referrer;
  const items: CameFromItem[] = [];
  if (page !== undefined) items.push({ term: strings.cameFromPage, description: pageName(page) });
  if (context?.page_title !== undefined) items.push({ term: strings.cameFromTitle, description: context.page_title });
  if (context?.landing_url !== undefined && context.landing_url !== page) {
    items.push({ term: strings.cameFromLanding, description: pageName(context.landing_url) });
  }
  if (referrer !== undefined) {
    items.push({ term: strings.cameFromReferrer, description: pageName(referrer) });
  }
  for (const [key, term] of UTM) {
    const value = (context as Readonly<Record<string, unknown>> | undefined)?.[key] ?? hidden[key];
    if (typeof value === 'string') items.push({ term, description: value });
  }
  for (const [key, value] of Object.entries(context?.params ?? {})) items.push({ term: key, description: value });
  // A mode this version doesn't name is left out rather than shown blank.
  const how = context?.mode === undefined ? undefined : (strings.cameFromMode[context.mode] as string | undefined);
  if (how !== undefined) items.push({ term: strings.cameFromHow, description: how });
  return items;
}
