// The handle address's shell (spec 0055, AC-5501 to AC-5505, AC-5508, AC-5509): one Vercel Function answers
// `/<handle>` with the built shell and a meta block, so a link pasted into a message shows the person rather than
// the product. The request logic lives here, with its one outside call passed in, so it runs in a Node test; the
// function itself (`api/handle.mjs`) is the entry and nothing more.
//
// Three rules hold this together. The bytes below `</head>` are the build's, never rewritten. A read that misses,
// in any way at all, answers the plain shell rather than an error. And nothing is read off the request but its
// path, so one handle has one answer for everybody and the edge can cache it (AC-5504).
import { BRAND_DESCRIPTION, withMeta, type MetaLook, type MetaSource } from './handle-meta.ts';
import { HANDLE_PATH } from './public-paths.ts';

/** How long the profile read may take before the plain shell goes out instead (AC-5503). */
export const READ_TIMEOUT_MS = 800;

/** What the shell answers with, so a crawler caches it and a person never waits on it (AC-5504). */
export const SHELL_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=86400';

/** The share card's address for one handle, versioned so a new name or picture is a new address (AC-5513). */
export function cardUrl(origin: string, handle: string, version: string | undefined): string {
  const card = `${origin}/api/public/handles/${encodeURIComponent(handle)}/card.png`;
  return version === undefined || version === '' ? card : `${card}?v=${encodeURIComponent(version)}`;
}

/** What a profile read gives the shell. Everything is optional: a read answers what it has, and misses are normal. */
export interface ShellProfile {
  readonly handle?: unknown;
  readonly name?: unknown;
  readonly bio?: unknown;
  readonly theme?: unknown;
  readonly indexable?: unknown;
  readonly version?: unknown;
}

/** A string, or undefined for anything else: a read's answer is parsed here, never trusted by its type. */
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** The six names of a look, or undefined unless every one of them is there (AC-5509). */
export function lookOf(theme: unknown): MetaLook | undefined {
  if (typeof theme !== 'object' || theme === null) return undefined;
  const given = theme as Record<string, unknown>;
  const keys = ['ground', 'hue', 'mode', 'shape', 'fill', 'font'] as const;
  const look: Record<string, string> = {};
  for (const key of keys) {
    const value = text(given[key]);
    // A look is all six or none: a half look would paint a page the owner never picked.
    if (value === undefined || !/^[a-z]{1,16}$/.test(value)) return undefined;
    look[key] = value;
  }
  return look as unknown as MetaLook;
}

/** The handle and page slug a path names, or undefined when it names neither. */
export function partsOf(pathname: string): { readonly handle: string; readonly slug?: string } | undefined {
  if (!HANDLE_PATH.test(pathname)) return undefined;
  const [handle, slug] = pathname.replace(/\/$/, '').slice(1).split('/');
  if (handle === undefined || handle === '') return undefined;
  return slug === undefined || slug === '' ? { handle } : { handle, slug };
}

/** What the shell was built from, which the answer's own header reports so a miss is visible in production. */
export type ShellOutcome = 'profile' | 'unknown' | 'missed';

/** One answer: the page's bytes, its status and the outcome that produced it. */
export interface ShellAnswer {
  readonly body: string;
  readonly status: number;
  readonly outcome: ShellOutcome;
}

/** What the shell needs from outside: the built bytes, where the page lives, and the one read it makes. */
export interface ShellDeps {
  /** The built `book.html`, inlined at build time so the function reads no file while answering. */
  readonly shell: string;
  /** The public origin a canonical address is built on, never the request's own host (AC-5502). */
  readonly origin: string;
  /** Reads a handle's public profile, or throws. Given the handle alone, so it can never be sent a path. */
  readonly readProfile: (handle: string, signal: AbortSignal) => Promise<ShellProfile | undefined>;
  /**
   * The origin that serves the share card, which is the public one. Left out while no card route answers, and then
   * the block claims no picture at all rather than naming one that 404s: a crawler that fetches a missing card
   * shows a broken preview, which is worse than the small one.
   */
  readonly cardOrigin?: string;
  /** Where a miss is reported. */
  readonly onMiss?: (handle: string, reason: string) => void;
}

/**
 * The shell for one path (AC-5501). A path that names no handle, and a read that misses in any way, both answer
 * the built shell exactly as it stands, with a 200 (AC-5503). A handle nobody holds answers the brand's own words
 * and a `noindex`, with a 404, so a dead address is never indexed and the page still draws what spec 0051 draws
 * for it (AC-5508).
 */
export async function shellFor(pathname: string, deps: ShellDeps): Promise<ShellAnswer> {
  const parts = partsOf(pathname);
  // Until spec 0055's slice 2, a booking page's own address keeps the shell it has: a block written from the
  // person rather than from the page would name the wrong thing.
  if (parts === undefined || parts.slug !== undefined) {
    return { body: deps.shell, status: 200, outcome: 'missed' };
  }
  const canonical = `${deps.origin}/${encodeURIComponent(parts.handle)}`;
  const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
  let profile: ShellProfile | undefined;
  try {
    profile = await deps.readProfile(parts.handle, timeout);
  } catch (error) {
    deps.onMiss?.(parts.handle, error instanceof Error ? error.name : 'unknown');
    return { body: deps.shell, status: 200, outcome: 'missed' };
  }
  if (profile === undefined) {
    const source: MetaSource = {
      // No name at all, so the title is the product's own word once rather than twice (AC-5508).
      name: '',
      description: BRAND_DESCRIPTION,
      canonical,
      kind: 'profile',
      indexable: false,
    };
    return { body: withMeta(deps.shell, source), status: 404, outcome: 'unknown' };
  }
  const handle = text(profile.handle) ?? parts.handle;
  const look = lookOf(profile.theme);
  const bio = text(profile.bio);
  const source: MetaSource = {
    name: text(profile.name) ?? handle,
    canonical: `${deps.origin}/${encodeURIComponent(handle)}`,
    ...(deps.cardOrigin === undefined ? {} : { card: cardUrl(deps.cardOrigin, handle, text(profile.version)) }),
    kind: 'profile',
    // A read that doesn't say answers the default the column carries: a page is shown unless its owner said not.
    indexable: profile.indexable !== false,
    ...(bio === undefined ? {} : { description: bio }),
    ...(look === undefined ? {} : { look }),
  };
  return { body: withMeta(deps.shell, source), status: 200, outcome: 'profile' };
}
