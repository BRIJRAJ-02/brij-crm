// The handle address's shell (spec 0055, AC-5501 to AC-5505, AC-5508, AC-5509): one Vercel Function answers
// `/<handle>` with the built shell and a meta block, so a link pasted into a message shows the person rather than
// the product. The request logic lives here, with its one outside call passed in, so it runs in a Node test; the
// function itself (`api/handle.mjs`) is the entry and nothing more.
//
// Three rules hold this together. The bytes below `</head>` are the build's, never rewritten. A read that misses,
// in any way at all, answers the plain shell rather than an error. And nothing is read off the request but its
// path, so one handle has one answer for everybody and the edge can cache it (AC-5504).
import { linkPageCacheTags } from '@crm/contracts/handles';
import {
  BRAND_DESCRIPTION,
  withMeta,
  withPageFacts,
  type MetaLook,
  type MetaSource,
  type PageFacts,
} from './handle-meta.ts';
import { HANDLE_PATH } from './public-paths.ts';

/** How long the profile read may take before the plain shell goes out instead (AC-5503). */
export const READ_TIMEOUT_MS = 800;

/**
 * What a booking page's shell answers with, so a crawler caches it and a person never waits on it (AC-5504). A
 * booking page under a handle isn't the link page and its switch doesn't hide it, so it keeps the long stale window.
 */
export const SHELL_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=86400';

/**
 * What a link page's shell answers with, and a handle with nothing to show (spec 0058, AC-23). The shell carries the
 * page itself (its name, bio and blocks, in the boot block), so a page made Private must stop being served promptly:
 * its Live or Private switch deletes the edge's copy at once (the `link-page:<handle>` cache tag), and where that
 * can't run, a minute fresh and a minute stale bound it at two. The stale minute is only ever a page that was public
 * a minute before, and it keeps the cold api's wait off a visitor.
 */
export const PROFILE_SHELL_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=60';

/**
 * A shell whose read missed (it timed out on a cold api, or failed) is kept by the edge for seconds, not minutes
 * (29 Oct 2026): kept for five, every visitor in that time got the plain shell and waited on the page's own lookup.
 */
export const MISSED_CACHE_CONTROL = 'public, s-maxage=10';

/**
 * What the shell's answer is cached for: a miss briefly, a booking page as usual, and a link page or a 404 (which a
 * private page answers) for a minute, so either side of the Live or Private switch shows promptly.
 */
export function cacheControlFor(outcome: ShellOutcome): string {
  if (outcome === 'missed') return MISSED_CACHE_CONTROL;
  return outcome === 'page' ? SHELL_CACHE_CONTROL : PROFILE_SHELL_CACHE_CONTROL;
}

/** The share card's address for one handle, versioned so a new name or picture is a new address (AC-5513). */
export function cardUrl(origin: string, handle: string, version: string | undefined): string {
  const card = `${origin}/api/public/handles/${encodeURIComponent(handle)}/card.png`;
  return version === undefined || version === '' ? card : `${card}?v=${encodeURIComponent(version)}`;
}

/** What a profile read gives the shell. Everything is optional: a read answers what it has, and misses are normal. */
export interface ShellProfile {
  readonly handle?: unknown;
  readonly image?: unknown;
  readonly name?: unknown;
  readonly bio?: unknown;
  readonly theme?: unknown;
  readonly indexable?: unknown;
  readonly version?: unknown;
  /** The versions of the page's own stylesheet and photos (spec 0060, `PublicLook`). */
  readonly look?: unknown;
  /** The person's social links, as the profile read answers them (spec 0061, AC-6121). */
  readonly socials?: unknown;
  /** The page's first blocks, as the profile read answers them (spec 0061, AC-6122). */
  readonly items?: unknown;
}

/**
 * What structured data and crawler text say of a page (spec 0061, AC-6121, AC-6122), read from the profile answer
 * and trusted in nothing: the social links' web addresses, and the live links' titles and web addresses in order,
 * leaving out every link behind a notice. The picture only when the answer has one, on our own origin.
 */
export function pageFactsOf(profile: ShellProfile, name: string, url: string, origin: string): PageFacts {
  const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? (value as readonly unknown[]) : []);
  const field = (entry: unknown, key: string): string | undefined =>
    typeof entry === 'object' && entry !== null && key in entry
      ? text((entry as Record<string, unknown>)[key])
      : undefined;
  const web = (address: string | undefined) =>
    address !== undefined && /^https?:\/\/[^\s]+$/i.test(address) ? address : undefined;
  const sameAs = list(profile.socials).flatMap((entry) => {
    const href = web(field(entry, 'href'));
    return href === undefined ? [] : [href];
  });
  const links = list(profile.items).flatMap((entry) => {
    if (field(entry, 'kind') !== 'link' || field(entry, 'notice') !== undefined) return [];
    const title = field(entry, 'title');
    const address = web(field(entry, 'url'));
    return title === undefined || address === undefined ? [] : [{ title, url: address }];
  });
  const image = text(profile.image);
  const bio = text(profile.bio);
  return {
    name,
    url,
    sameAs,
    links,
    ...(bio === undefined ? {} : { bio }),
    ...(image !== undefined && image.startsWith('/api/public/') ? { image: `${origin}${image}` } : {}),
  };
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

/** What a booking page read gives the shell: its own title and note, and the host it belongs to. */
export interface ShellPage {
  readonly publicKey?: unknown;
  readonly handle?: unknown;
  readonly slug?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly hostName?: unknown;
}

/** The id of the shell's boot block, which the public bundle reads before it asks the api anything. */
export const BOOT_ID = 'crm-boot';

/**
 * What the shell already read, handed to the page so it never asks again before drawing (29 Oct 2026): a profile
 * draws from it at once, and a booking page starts from its key rather than looking the address up first, which
 * was a whole round trip to the api before anything else could start. The page still reads afresh behind it, and a
 * profile carries when it was read: the edge may serve a shell up to a day old while it fetches a new one, and the
 * page draws only a recent copy (boot.ts), never an old one that the fresh read would then repaint.
 */
export type ShellBoot =
  | { readonly kind: 'profile'; readonly profile: ShellProfile; readonly readAt: number }
  | { readonly kind: 'page'; readonly publicKey: string; readonly handle: string; readonly slug: string };

/**
 * The boot block, before `</head>`: JSON in a script the browser never runs (so the CSP has nothing to say), with
 * every `<` escaped so nothing a person wrote in their bio can close the element. A profile's picture is preloaded
 * beside it, so it is on its way while the bundle loads rather than after the page draws.
 */
export function withBoot(shell: string, boot: ShellBoot): string {
  const headEnd = shell.indexOf('</head>');
  if (headEnd < 0) return shell;
  const json = JSON.stringify(boot).replace(/</g, '\\u003c');
  const image = boot.kind === 'profile' ? text(boot.profile.image) : undefined;
  const preload =
    image !== undefined && image.startsWith('/api/public/') && !/["<>]/.test(image)
      ? `    <link rel="preload" as="image" href="${image.replace(/&/g, '&amp;')}">\n`
      : '';
  const block = `${preload}    <script type="application/json" id="${BOOT_ID}">${json}</script>\n`;
  return `${shell.slice(0, headEnd)}${block}${shell.slice(headEnd)}`;
}

/** The id of the page's own stylesheet link, which the public bundle finds again (`wearStylesheet` in public/). */
export const LOOK_LINK_ID = 'crm-look';

/** A look's version and a font file's built path, as the shell will write them into an attribute. */
const LOOK_VERSION = /^[0-9a-f]{12}$/;
const LOOK_HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FONT_FILE = /^\/assets\/[\w.-]+\.woff2$/;

/**
 * The link page's own look in its head (spec 0060, AC-20, AC-21): its stylesheet on our own api (the accent pair and
 * any photo, `look.css?v=`), and a preload for its pack's heading face, by the built name the build handed over, so
 * the name draws in its own face from the start. Inter is preloaded by the build on every public page already, so a
 * file the shell names once is never named twice. Anything malformed writes nothing: the page draws its look from
 * the shared stylesheet either way, in the product's accent.
 */
export function withLook(shell: string, profile: ShellProfile, fonts: Readonly<Record<string, string>> = {}): string {
  const headEnd = shell.indexOf('</head>');
  if (headEnd < 0) return shell;
  const handle = text(profile.handle);
  const look =
    typeof profile.look === 'object' && profile.look !== null ? (profile.look as Record<string, unknown>) : {};
  const version = text(look.version);
  const theme =
    typeof profile.theme === 'object' && profile.theme !== null ? (profile.theme as Record<string, unknown>) : {};
  const font = text(theme.font);
  const links: string[] = [];
  if (
    font !== undefined &&
    Object.hasOwn(fonts, font) &&
    FONT_FILE.test(fonts[font] ?? '') &&
    !shell.includes(`href="${fonts[font] ?? ''}"`)
  ) {
    links.push(`    <link rel="preload" href="${fonts[font] ?? ''}" as="font" type="font/woff2" crossorigin>\n`);
  }
  if (handle !== undefined && LOOK_HANDLE.test(handle) && handle.length <= 40 && version !== undefined) {
    if (LOOK_VERSION.test(version)) {
      links.push(
        `    <link rel="stylesheet" id="${LOOK_LINK_ID}" href="/api/public/handles/${handle}/look.css?v=${version}">\n`,
      );
    }
  }
  return links.length === 0 ? shell : `${shell.slice(0, headEnd)}${links.join('')}${shell.slice(headEnd)}`;
}

/** What the shell was built from, which the answer's own header reports so a miss is visible in production. */
export type ShellOutcome = 'profile' | 'page' | 'unknown' | 'missed';

/** One answer: the page's bytes, its status, the outcome that produced it, and the edge cache tags it is filed under. */
export interface ShellAnswer {
  readonly body: string;
  readonly status: number;
  readonly outcome: ShellOutcome;
  /**
   * A link page's shell, or the 404 a private one answers, is filed under `link-page:<handle>` for the address asked
   * and the page's current handle (`linkPageCacheTags`), so its Live or Private switch deletes it (spec 0058, AC-23).
   */
  readonly tags?: readonly string[];
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
   * Reads one of their booking pages (spec 0055, slice 2), or throws. Given the handle and the slug apart, for
   * the same reason: neither is ever joined into a path here.
   */
  readonly readPage?: (handle: string, slug: string, signal: AbortSignal) => Promise<ShellPage | undefined>;
  /**
   * The origin that serves the share card, which is the public one. Left out while no card route answers, and then
   * the block claims no picture at all rather than naming one that 404s: a crawler that fetches a missing card
   * shows a broken preview, which is worse than the small one.
   */
  readonly cardOrigin?: string;
  /**
   * The built path of each font pack's heading face, keyed by the `font` a look stores (spec 0060, AC-21): written
   * by the build from `FONT_PACKS` in `@crm/tokens/packs`, so the preload names the file the stylesheet fetches.
   */
  readonly fonts?: Readonly<Record<string, string>>;
  /** The time now, in milliseconds: when a profile was read, so the page can tell an old shell's copy. */
  readonly now?: () => number;
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
  if (parts === undefined) return { body: deps.shell, status: 200, outcome: 'missed' };
  const slug = parts.slug;
  if (slug !== undefined) return await pageShell(parts.handle, slug, deps);
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
    return {
      body: withMeta(deps.shell, source),
      status: 404,
      outcome: 'unknown',
      tags: linkPageCacheTags(parts.handle),
    };
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
  // Structured data on an indexable page, and the page as text for a crawler that runs no script (spec 0061).
  const facts = pageFactsOf(profile, source.name, source.canonical, deps.origin);
  const described = withPageFacts(withMeta(deps.shell, source), facts, source.indexable);
  return {
    body: withBoot(withLook(described, { ...profile, handle }, deps.fonts), {
      kind: 'profile',
      profile,
      readAt: (deps.now ?? Date.now)(),
    }),
    status: 200,
    outcome: 'profile',
    tags: linkPageCacheTags(parts.handle, handle),
  };
}

/**
 * One of a person's booking pages, `/<handle>/<slug>` (AC-5502, AC-5507). The same block as a profile's, written
 * from the page rather than from the person: its own title and note, and `website` rather than `profile`, since
 * the thing being shared is a time to book and not somebody's page of links.
 *
 * The title names the host beside the page ("Intro call · Anish Rao") rather than the product, because a preview
 * that says "Intro call · Timefix" tells the person receiving it nothing about who they would be meeting. With no
 * host name to use it falls back to the product, as everything else here does.
 *
 * It is never indexed on its own: a booking page is reached through the person's page, and a search result for
 * one time slot of one host is not what anybody is looking for. The profile's own switch governs the profile.
 */
async function pageShell(handle: string, slug: string, deps: ShellDeps): Promise<ShellAnswer> {
  const readPage = deps.readPage;
  if (readPage === undefined) return { body: deps.shell, status: 200, outcome: 'missed' };
  const canonical = `${deps.origin}/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`;
  const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
  let page: ShellPage | undefined;
  try {
    page = await readPage(handle, slug, timeout);
  } catch (error) {
    deps.onMiss?.(handle, error instanceof Error ? error.name : 'unknown');
    return { body: deps.shell, status: 200, outcome: 'missed' };
  }
  if (page === undefined) {
    const source: MetaSource = {
      name: '',
      description: BRAND_DESCRIPTION,
      canonical,
      kind: 'website',
      indexable: false,
    };
    return { body: withMeta(deps.shell, source), status: 404, outcome: 'unknown' };
  }
  const title = text(page.title);
  const host = text(page.hostName);
  const source: MetaSource = {
    name: title ?? '',
    // Named whole where there is a host to name: `titleOf` would otherwise add the product to it as well.
    ...(title === undefined || host === undefined ? {} : { title: `${title} · ${host}` }),
    canonical,
    kind: 'website',
    indexable: false,
    ...(text(page.description) === undefined ? {} : { description: text(page.description) }),
  };
  const body = withMeta(deps.shell, source);
  const publicKey = text(page.publicKey);
  const found = { handle: text(page.handle) ?? handle, slug: text(page.slug) ?? slug };
  return {
    body: publicKey === undefined ? body : withBoot(body, { kind: 'page', publicKey, ...found }),
    status: 200,
    outcome: 'page',
  };
}
