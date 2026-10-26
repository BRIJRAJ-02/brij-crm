// An address on one of our own public origins that names a page of a workspace (spec 0056, AC-5610 and AC-5611): a
// booking page at `/b/<key>` or `/<handle>/<slug>`, a form at `/f/<key>`, or a person's link page at `/<handle>`. A
// link block on a link page, a form's redirect and a routing rule's redirect may only hold one that resolves inside
// their own workspace, so the parsing is here, once, and the lookups are `@crm/core`'s. Plain TypeScript with no Zod.
import { HANDLE_PATTERN, isReservedHandle, SLUG_PATTERN } from './handles.ts';

/** What a refused workspace address says, for a link block and for both redirects (AC-5610). */
export const WORKSPACE_ADDRESS_REFUSAL = 'That page isn’t in this workspace.';

/** The page of a workspace an address names, before anything has looked it up. */
export type WorkspaceAddress =
  | { readonly kind: 'booking_key'; readonly key: string }
  | { readonly kind: 'form_key'; readonly key: string }
  | { readonly kind: 'booking'; readonly handle: string; readonly slug: string }
  | { readonly kind: 'handle'; readonly handle: string };

/** An origin as `URL` spells it, or undefined for anything that is not a web address. */
function originOf(value: string): string | undefined {
  if (!URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
}

/**
 * The page of a workspace `address` names, or undefined when it names none: an address on any other site, a path
 * we serve that is not a page (`/sign-in`, `/w/acme/home`), or text that is not a web address at all. `origins`
 * are our own public origins (the app's, the forms' and the booking pages'), compared as origins, so a look alike
 * host, another port or `http` for `https` is another site. The query and the fragment are ignored.
 */
export function parseWorkspaceAddress(address: string, origins: readonly string[]): WorkspaceAddress | undefined {
  const origin = originOf(address.trim());
  if (origin === undefined || !origins.some((own) => originOf(own) === origin)) return undefined;
  const segments = new URL(address.trim()).pathname.split('/').filter((segment) => segment !== '');
  const [first, second] = segments.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  if (first === undefined) return undefined;
  if (first === 'b' && second !== undefined) return { kind: 'booking_key', key: second };
  if (first === 'f' && second !== undefined) return { kind: 'form_key', key: second };
  if (!HANDLE_PATTERN.test(first) || isReservedHandle(first)) return undefined;
  if (second === undefined) return segments.length === 1 ? { kind: 'handle', handle: first } : undefined;
  // `/<handle>/<slug>` is a booking page; a longer path under a handle is none of ours to resolve.
  return segments.length === 2 && SLUG_PATTERN.test(second)
    ? { kind: 'booking', handle: first, slug: second }
    : undefined;
}
