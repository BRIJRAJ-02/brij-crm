// `@crm/data/public-form`: what the hosted form page (spec 0023,
// 0023-experience.md, The visitor) reads and sends, and nothing else: the
// live form by its address, and a submission. Plain `fetch` to the public
// endpoints, no session, no oRPC and no Zod, so the page's bundle stays
// small. With reCAPTCHA on (optional everywhere), it also loads Google's
// script and asks it for a token. Every answer is a plain union a screen
// switches on; nothing throws for an answer the endpoint gives on purpose.
import type { FillTicket, PublicForm, SubmitBody, SubmitNext } from '@crm/contracts/forms';
import type { FetchLike } from '../fetch.ts';

/** Where a submission came from, as the hosted page sends it beside the answers (`SubmitBody.context`). */
export type { SubmitContext } from '@crm/contracts/forms';

/** What reading a form answered. */
export type FormLoad =
  { readonly kind: 'form'; readonly form: PublicForm } | { readonly kind: 'missing' } | { readonly kind: 'failed' };

/** What sending a submission answered. */
export type SubmitOutcome =
  | { readonly kind: 'done'; readonly next: SubmitNext }
  /** Field errors by question key (422): nothing was stored. */
  | { readonly kind: 'invalid'; readonly fields: Readonly<Record<string, string>> }
  /** The form stopped taking enquiries (410). */
  | { readonly kind: 'closed' }
  /** Too many in a short time (429). */
  | { readonly kind: 'limited' }
  /** The endpoint failed: the same attempt may be sent again. */
  | { readonly kind: 'failed' }
  /** The endpoint couldn't be reached at all. */
  | { readonly kind: 'offline' };

/** The hosted page's client. */
export interface PublicFormClient {
  load(address: string): Promise<FormLoad>;
  submit(address: string, body: SubmitBody): Promise<SubmitOutcome>;
  /**
   * A fill ticket for the address (the spam checks: the server's note of when
   * the page loaded), never cached; undefined when it can't be had, and the
   * submit goes without one.
   */
  ticket(address: string): Promise<string | undefined>;
}

const path = (address: string) => `/api/public/forms/${encodeURIComponent(address)}`;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Whether the endpoint's answer looks like a form (our own API's; a light check, not a parse). */
function isForm(value: unknown): value is PublicForm {
  return (
    isObject(value) &&
    typeof value.key === 'string' &&
    Array.isArray(value.questions) &&
    typeof value.buttonText === 'string'
  );
}

/** A client on `base` (the page's own origin by default), through `fetch` (a fake one in tests). */
export function createPublicFormClient(
  options: { readonly fetch?: FetchLike; readonly base?: string } = {},
): PublicFormClient {
  const call: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const base = options.base ?? '';
  return {
    async load(address) {
      try {
        const response = await call(`${base}${path(address)}`, { headers: { accept: 'application/json' } });
        if (response.status === 404 || response.status === 410) return { kind: 'missing' };
        if (!response.ok) return { kind: 'failed' };
        const body: unknown = await response.json();
        return isForm(body) ? { kind: 'form', form: body } : { kind: 'failed' };
      } catch {
        return { kind: 'failed' };
      }
    },
    async ticket(address) {
      try {
        const response = await call(`${base}${path(address)}/ticket`, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });
        if (!response.ok) return undefined;
        const body: unknown = await response.json();
        return isObject(body) && typeof body.ticket === 'string' ? (body as FillTicket).ticket : undefined;
      } catch {
        return undefined;
      }
    },
    async submit(address, body) {
      let response: Response;
      try {
        response = await call(`${base}${path(address)}/submissions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        return { kind: 'offline' };
      }
      try {
        const answer: unknown = await response.json();
        if (response.ok && isObject(answer) && isObject(answer.next))
          return { kind: 'done', next: answer.next as SubmitNext };
        if (response.status === 410 || response.status === 404) return { kind: 'closed' };
        if (response.status === 429) return { kind: 'limited' };
        if (response.status === 422 && isObject(answer) && isObject(answer.fields)) {
          const fields = Object.fromEntries(
            Object.entries(answer.fields).flatMap(([key, message]) =>
              typeof message === 'string' ? [[key, message]] : [],
            ),
          );
          return { kind: 'invalid', fields };
        }
        return { kind: 'failed' };
      } catch {
        return { kind: 'failed' };
      }
    },
  };
}

/** reCAPTCHA v3's browser API, as much of it as the page calls. */
interface Grecaptcha {
  ready(callback: () => void): void;
  execute(siteKey: string, options: { readonly action: string }): Promise<string>;
}

/** The action every hosted form token is for: the API checks it. */
export const CAPTCHA_ACTION = 'form_submit';

/**
 * Loads reCAPTCHA v3 for `siteKey` and answers a function that asks it for a
 * token, or undefined when it couldn't load or answer within 3 seconds.
 */
export function loadCaptcha(siteKey: string): () => Promise<string | undefined> {
  const ready = new Promise<Grecaptcha | undefined>((resolve) => {
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    script.async = true;
    script.addEventListener('load', () => {
      const api = (window as unknown as { grecaptcha?: Grecaptcha }).grecaptcha;
      if (api === undefined) resolve(undefined);
      else api.ready(() => resolve(api));
    });
    script.addEventListener('error', () => resolve(undefined));
    document.head.append(script);
  });
  return async () => {
    const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3_000));
    const api = await Promise.race([ready, timeout]);
    if (api === undefined) return undefined;
    try {
      return await Promise.race([api.execute(siteKey, { action: CAPTCHA_ACTION }), timeout]);
    } catch {
      return undefined;
    }
  };
}
