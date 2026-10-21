// Where a submission came from (the embed, 20 October 2026): the page the
// visitor sent it from, its title, the visitor's first landing in this visit
// with its referrer and UTM tags, the parameters the site chose to pass
// along, and, only where the site allows it, a first party visitor id that
// links one visitor's submissions and bookings. It travels beside the submit
// body (`context`), never inside it, so the submit and spam contract stay as
// they are. Every field is checked on its own and a bad one is dropped, never
// the lead: lengths are capped and addresses are parsed, http and https only,
// with no credentials.
import * as z from 'zod';

/** The longest address kept. */
export const CONTEXT_URL_MAX = 2_048;

/** The longest UTM tag or passed value kept. */
export const CONTEXT_VALUE_MAX = 200;

/** The most parameters a site may pass along. */
export const CONTEXT_PARAMS_MAX = 10;

/** A visitor id (`tfx_vid`): 16 to 64 letters, digits, `-` or `_`, minted by the embed script. */
export const VISITOR_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** A workspace's public key, as a snippet carries it (`data-timefix-workspace`). */
export const WORKSPACE_PUBLIC_KEY = /^ws_[a-z0-9]{16}$/;

/** A parameter name a site passes along: the same shape as a question key. */
const PARAM_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** An http or https address, without its credentials, at most 2,048 characters; anything else is dropped. */
const ContextUrl = z
  .string()
  .max(CONTEXT_URL_MAX)
  .transform((value, context) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('not the web');
      url.username = '';
      url.password = '';
      return url.href.slice(0, CONTEXT_URL_MAX);
    } catch {
      context.addIssue({ code: 'custom', message: 'Not a web address.' });
      return z.NEVER;
    }
  });

/** Whether the text holds a control character (below space, or delete). */
const hasControlCharacter = (value: string): boolean =>
  Array.from({ length: value.length }, (_, index) => value.charCodeAt(index)).some((code) => code < 32 || code === 127);

/** Short text with no control characters, trimmed. */
const ContextText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => value !== '' && !hasControlCharacter(value));

/** One field kept when it passes, dropped (undefined) when it doesn't. */
const kept = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

/** How the submission was sent: the embed's mode, or the hosted page itself. */
export const SUBMIT_CONTEXT_MODES = ['page', 'inline', 'popup', 'floating', 'own'] as const;

/**
 * `context` beside a submit body: where the visitor was and how they arrived.
 * Each field is optional and dropped alone when it doesn't pass.
 */
export const SubmitContext = z
  .object({
    /** The page the visitor submitted from. */
    page_url: kept(ContextUrl),
    page_title: kept(ContextText(300)),
    /** The first page of the visitor's visit, and the site that sent them there. */
    landing_url: kept(ContextUrl),
    referrer: kept(ContextUrl),
    utm_source: kept(ContextText(CONTEXT_VALUE_MAX)),
    utm_medium: kept(ContextText(CONTEXT_VALUE_MAX)),
    utm_campaign: kept(ContextText(CONTEXT_VALUE_MAX)),
    utm_term: kept(ContextText(CONTEXT_VALUE_MAX)),
    utm_content: kept(ContextText(CONTEXT_VALUE_MAX)),
    /** The parameters the site named for passing along (`data-timefix-pass`), at most 10. */
    params: kept(
      z
        .record(z.string().regex(PARAM_KEY), ContextText(CONTEXT_VALUE_MAX))
        .refine((params) => Object.keys(params).length <= CONTEXT_PARAMS_MAX),
    ),
    /** The first party visitor id, only where the site allowed it (`data-timefix-consent`). */
    visitor_id: kept(z.string().regex(VISITOR_ID)),
    /** The workspace the snippet names: a submission naming another workspace than its form's is refused. */
    workspace: kept(z.string().regex(WORKSPACE_PUBLIC_KEY)),
    mode: kept(z.enum(SUBMIT_CONTEXT_MODES)),
    /** The embed script's version, `1`. */
    version: kept(z.string().regex(/^\d{1,3}$/)),
  })
  .catch({});
/** Where a submission came from, as checked. */
export type SubmitContext = z.infer<typeof SubmitContext>;

/** Where a submission came from, as members read it on the submission. */
export const SubmissionContext = z.object({
  page_url: z.string().optional(),
  page_title: z.string().optional(),
  landing_url: z.string().optional(),
  referrer: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_term: z.string().optional(),
  utm_content: z.string().optional(),
  params: z.record(z.string(), z.string()).optional(),
  visitor_id: z.string().optional(),
  mode: z.enum(SUBMIT_CONTEXT_MODES).optional(),
});
/** Where a submission came from, as members read it. */
export type SubmissionContext = z.infer<typeof SubmissionContext>;

/** The context as stored: the checked fields, without the workspace key (checked, never kept). */
export function storedContext(context: SubmitContext): SubmissionContext {
  const { workspace: _checked, version: _version, ...kept } = context;
  const fields: Readonly<Record<string, unknown>> = kept;
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}
