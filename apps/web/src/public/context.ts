// Where a hosted form's submission came from (spec 0023, 0023-embeds.md):
// the site's page the embed script passed along in the frame's address
// (`ctx`), or the hosted page itself. Sent beside the answers as `context`,
// and as the older hidden fields. The server checks every field again; this
// only keeps the shape and the lengths.
import type { SubmitContext } from '@crm/data/public-form';
import type { EmbedMode } from './frame.ts';

/** The tag keys a context carries as text. */
const TEXT_KEYS = [
  'page_url',
  'page_title',
  'landing_url',
  'referrer',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'visitor_id',
  'workspace',
] as const;

/** The UTM tags. */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

/**
 * The context the embed script passed in `ctx` (JSON), as the submit sends
 * it: text fields only, each cut short, the parameters at most ten. The
 * server checks every field again; this only keeps the shape.
 */
export function contextFromFrame(search: string, mode: EmbedMode): SubmitContext {
  const params = new URLSearchParams(search);
  let raw: unknown;
  try {
    raw = JSON.parse(params.get('ctx') ?? '{}');
  } catch {
    raw = {};
  }
  const given = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { mode, version: '1' };
  for (const key of TEXT_KEYS) {
    const value = given[key];
    if (typeof value === 'string' && value !== '')
      out[key] = value.slice(0, key.endsWith('_url') || key === 'referrer' ? 2_048 : 300);
  }
  const passed = given.params;
  if (typeof passed === 'object' && passed !== null) {
    const kept = Object.entries(passed as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .slice(0, 10);
    if (kept.length > 0) out.params = Object.fromEntries(kept.map(([key, value]) => [key, value.slice(0, 200)]));
  }
  return out;
}

/** The context of a visit to the hosted page itself: this page, its referrer and its UTM tags. */
export function contextOfPage(page: {
  readonly href: string;
  readonly title: string;
  readonly referrer: string;
}): SubmitContext {
  const params = new URL(page.href).searchParams;
  const out: Record<string, string> = { mode: 'page', version: '1', page_url: page.href.slice(0, 2_048) };
  if (page.title !== '') out.page_title = page.title.slice(0, 300);
  if (page.referrer !== '') out.referrer = page.referrer.slice(0, 2_048);
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value !== null && value !== '') out[key] = value.slice(0, 200);
  }
  return out;
}

/** The older hidden fields (page, referrer, UTM tags), from a context. */
export function hiddenOf(context: SubmitContext): Record<string, string> {
  const hidden: Record<string, string> = {};
  if (context.page_url !== undefined) hidden.page = context.page_url;
  if (context.referrer !== undefined) hidden.referrer = context.referrer;
  for (const key of UTM_KEYS) {
    const value = context[key];
    if (value !== undefined) hidden[key] = value;
  }
  return hidden;
}
