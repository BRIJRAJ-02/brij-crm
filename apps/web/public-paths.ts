// The public booking addresses' routing (22 Oct 2026): `/<handle>` (a person's profile) and `/<handle>/<slug>` (one
// of their booking pages) load the public booking bundle (book.html), beside `/b/<key>`. A handle is never one of
// the app's own top level words (`RESERVED_HANDLES`), so the app's routes, the API and the built files keep their
// paths. vercel.json can't import, so it holds these patterns as text: `public-paths.test.ts` fails until its
// rewrites and headers say exactly what this file builds, and until every top level route is a reserved word.
import { RESERVED_HANDLES } from '@crm/contracts/handles';

/** The reserved words a handle could look like (3 characters and more), longest first, as one alternation. */
const RESERVED = [...RESERVED_HANDLES]
  .filter((word) => word.length >= 3)
  .sort((a, b) => b.length - a.length || a.localeCompare(b))
  .join('|');

/** A handle's path segment: 3 to 40 of a-z, 0-9 and hyphens, not starting or ending with one, never reserved. */
export const HANDLE_SEGMENT = `(?!(?:${RESERVED})(?:/|$))[a-z0-9][a-z0-9-]{1,38}[a-z0-9]`;

/** A booking page's slug segment: 1 to 60 of a-z, 0-9 and hyphens, starting with a letter or digit. */
export const SLUG_SEGMENT = '[a-z0-9][a-z0-9-]{0,59}';

/** vercel.json's rewrite source for a profile, `/<handle>`. */
export const PROFILE_SOURCE = `/(${HANDLE_SEGMENT})`;

/** vercel.json's rewrite source for a booking page, `/<handle>/<slug>`. */
export const PAGE_SOURCE = `/(${HANDLE_SEGMENT})/(${SLUG_SEGMENT})`;

/** vercel.json's header source for both: the booking page's policy (any site may frame it, as `/b/<key>`). */
export const HANDLE_HEADER_SOURCE = `/(${HANDLE_SEGMENT}(?:/${SLUG_SEGMENT})?)`;

/** vercel.json's app policy source: every path but the API, the public pages (hosted forms, booking pages) and the embed script. */
export const APP_HEADER_SOURCE = `/((?!api/|api$|f/|b/[^/]+$|embed/|${HANDLE_SEGMENT}(?:/${SLUG_SEGMENT})?$).*)`;

/** A path vercel.json sends to book.html as a handle address, matched as Vercel anchors it. */
export const HANDLE_PATH = new RegExp(`^/${HANDLE_SEGMENT}(?:/${SLUG_SEGMENT})?/?$`);
