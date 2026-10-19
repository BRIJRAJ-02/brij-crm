// `@crm/data/public-form`: what the hosted form page (spec 0023,
// 0023-public-surface.md) reads and sends, and nothing else: the live form
// by its public key, and a submission. Plain `fetch` to the public endpoints,
// no session, no oRPC, so the page loads none of the app's data layer. It
// also loads reCAPTCHA v3's script and asks it for a token, the one place
// the page reaches Google. Every answer is a plain union a screen switches
// on; nothing throws for an answer the endpoint gives on purpose.
import { PublicForm, SubmitErrors, SubmitResult, type SubmitBody, type SubmitNext } from '@crm/contracts/forms';
import type { FetchLike } from '../fetch.ts';

export {
  checkAnswers,
  formStrings,
  isEmptyAnswer,
  publicQuestions,
  type FormStrings,
  type PublicBlock,
  type PublicForm,
  type PublicQuestion,
  type SubmitBody,
  type SubmitNext,
} from '@crm/contracts/forms';

/**
 * The pattern engine the page's answer check runs rules with: the browser's
 * own RegExp, close enough for a first look (the server checks again with
 * RE2, so a pattern the two read differently is caught there). A pattern the
 * browser can't compile passes here.
 */
export function browserPattern(source: string, ignoreCase: boolean): { readonly test: (text: string) => boolean } {
  try {
    const compiled = new RegExp(source, ignoreCase ? 'iu' : 'u');
    return { test: (text) => compiled.test(text) };
  } catch {
    return { test: () => true };
  }
}

/** What reading a form answered. */
export type FormLoad =
  { readonly kind: 'form'; readonly form: PublicForm } | { readonly kind: 'missing' } | { readonly kind: 'failed' };

/** What sending a submission answered. */
export type SubmitOutcome =
  | { readonly kind: 'done'; readonly next: SubmitNext }
  /** Field errors by question id (422): nothing was stored. */
  | { readonly kind: 'invalid'; readonly fields: Readonly<Record<string, string>> }
  /** The form stopped taking responses (410). */
  | { readonly kind: 'closed' }
  /** The form changed since the page loaded (409): reload it. */
  | { readonly kind: 'changed' }
  /** Too many in a short time (429). */
  | { readonly kind: 'limited' }
  /** The endpoint couldn't be reached, or failed: the same attempt may be sent again. */
  | { readonly kind: 'failed' };

/** The hosted page's client. */
export interface PublicFormClient {
  load(publicKey: string): Promise<FormLoad>;
  submit(publicKey: string, body: SubmitBody): Promise<SubmitOutcome>;
}

const path = (publicKey: string) => `/api/public/forms/${encodeURIComponent(publicKey)}`;

/** A client on the page's own origin, through `fetch` (a fake one in tests). */
export function createPublicFormClient(options: { readonly fetch?: FetchLike } = {}): PublicFormClient {
  const call: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  return {
    async load(publicKey) {
      try {
        const response = await call(path(publicKey), { headers: { accept: 'application/json' } });
        if (response.status === 404 || response.status === 410) return { kind: 'missing' };
        if (!response.ok) return { kind: 'failed' };
        const parsed = PublicForm.safeParse(await response.json());
        return parsed.success ? { kind: 'form', form: parsed.data } : { kind: 'failed' };
      } catch {
        return { kind: 'failed' };
      }
    },
    async submit(publicKey, body) {
      let response: Response;
      try {
        response = await call(`${path(publicKey)}/submissions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        return { kind: 'failed' };
      }
      try {
        if (response.ok) {
          const parsed = SubmitResult.safeParse(await response.json());
          return parsed.success ? { kind: 'done', next: parsed.data.next } : { kind: 'failed' };
        }
        if (response.status === 410 || response.status === 404) return { kind: 'closed' };
        if (response.status === 409) return { kind: 'changed' };
        if (response.status === 429) return { kind: 'limited' };
        if (response.status === 422) {
          const parsed = SubmitErrors.safeParse(await response.json());
          if (parsed.success && parsed.data.fields !== undefined)
            return { kind: 'invalid', fields: parsed.data.fields };
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
 * token, or undefined when it couldn't load or answer within 3 seconds (the
 * API then stores the submission as spam, AC-583, so a page with no token
 * never loses a visitor's answers silently: it still sends).
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
