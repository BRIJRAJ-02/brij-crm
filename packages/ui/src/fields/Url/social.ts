// Social profile links: which network a link or an attribute belongs to, the
// handle a profile link shows, and a typed handle or link turned into the
// profile's one canonical link. Plain functions, no React, so the display, the
// editor and the text conversion (paste, CSV, the import preview) share them.
import { UrlValue } from '@crm/contracts/values';
import { strings } from './strings.ts';

/** The networks whose profile links show the network's mark and the handle. */
export type SocialNetwork =
  'linkedin' | 'x' | 'instagram' | 'github' | 'facebook' | 'youtube' | 'angellist' | 'tiktok' | 'threads';

/** A profile: the handle to show and the canonical path on the network's own host. */
interface Profile {
  readonly handle: string;
  readonly path: string;
}

interface NetworkDef {
  /** The network's name, as a mark's label and a message say it. */
  readonly name: string;
  /** The hosts its links live on; the first is the one canonical links use. */
  readonly hosts: readonly string[];
  /** Shown before the handle: `@` where the network writes handles that way. */
  readonly at: boolean;
  /** What a handle may hold on this network. */
  readonly handle: RegExp;
  /** A handle as typed (no `@`), to its profile's path. */
  readonly pathOf: (handle: string) => string;
  /** A link's path segments to the profile, or `undefined` when the link is to something else (a post, a search). */
  readonly profileOf: (segments: readonly string[]) => Profile | undefined;
  /** A handle the editor's placeholder shows. */
  readonly example: string;
}

/** A one segment path as the handle, unless it is one of the network's own pages. */
const firstSegment =
  (reserved: readonly string[], { at = false }: { readonly at?: boolean } = {}) =>
  (segments: readonly string[]): Profile | undefined => {
    const [first] = segments;
    if (segments.length !== 1 || first === undefined || reserved.includes(first.toLowerCase())) return undefined;
    const handle = at ? first.replace(/^@/, '') : first;
    if (at && !first.startsWith('@')) return undefined;
    return handle === '' ? undefined : { handle, path: first };
  };

/** A two segment `/kind/handle` profile (`/in/ada`, `/company/acme`), for the kinds listed. */
const kindAndHandle =
  (kinds: readonly string[]) =>
  (segments: readonly string[]): Profile | undefined => {
    const [kind, handle] = segments;
    if (segments.length !== 2 || kind === undefined || handle === undefined || !kinds.includes(kind.toLowerCase()))
      return undefined;
    return { handle, path: `${kind.toLowerCase()}/${handle}` };
  };

const NETWORKS: { readonly [N in SocialNetwork]: NetworkDef } = {
  linkedin: {
    name: 'LinkedIn',
    hosts: ['linkedin.com'],
    at: false,
    handle: /^[\p{L}\p{N}_-]{2,100}$/u,
    pathOf: (handle) => `in/${handle}`,
    profileOf: kindAndHandle(['in', 'company', 'school', 'showcase']),
    example: 'ada-lovelace',
  },
  x: {
    name: 'X',
    hosts: ['x.com', 'twitter.com'],
    at: true,
    handle: /^\w{1,15}$/,
    pathOf: (handle) => handle,
    profileOf: firstSegment(['home', 'i', 'intent', 'search', 'hashtag', 'share', 'explore', 'settings']),
    example: 'adalovelace',
  },
  instagram: {
    name: 'Instagram',
    hosts: ['instagram.com'],
    at: true,
    handle: /^[\w.]{1,30}$/,
    pathOf: (handle) => handle,
    profileOf: firstSegment(['p', 'reel', 'reels', 'explore', 'stories', 'accounts']),
    example: 'ada.lovelace',
  },
  github: {
    name: 'GitHub',
    hosts: ['github.com'],
    at: false,
    handle: /^[a-z\d](?:[a-z\d-]{0,38})$/i,
    pathOf: (handle) => handle,
    profileOf: firstSegment(['orgs', 'settings', 'search', 'explore', 'topics', 'marketplace']),
    example: 'adalovelace',
  },
  facebook: {
    name: 'Facebook',
    hosts: ['facebook.com', 'fb.com'],
    at: false,
    handle: /^[\w.-]{1,50}$/,
    pathOf: (handle) => handle,
    profileOf: firstSegment(['profile.php', 'groups', 'events', 'watch', 'share', 'pages', 'people']),
    example: 'ada.lovelace',
  },
  youtube: {
    name: 'YouTube',
    hosts: ['youtube.com'],
    at: true,
    handle: /^[\w.-]{3,30}$/,
    pathOf: (handle) => `@${handle}`,
    profileOf: (segments) => firstSegment([], { at: true })(segments) ?? kindAndHandle(['c', 'user'])(segments),
    example: 'adalovelace',
  },
  angellist: {
    name: 'AngelList',
    hosts: ['wellfound.com', 'angel.co'],
    at: false,
    handle: /^[\w-]{1,100}$/,
    pathOf: (handle) => `u/${handle}`,
    profileOf: kindAndHandle(['u', 'company', 'p']),
    example: 'ada-lovelace',
  },
  tiktok: {
    name: 'TikTok',
    hosts: ['tiktok.com'],
    at: true,
    handle: /^[\w.]{2,24}$/,
    pathOf: (handle) => `@${handle}`,
    profileOf: firstSegment([], { at: true }),
    example: 'adalovelace',
  },
  threads: {
    name: 'Threads',
    hosts: ['threads.com', 'threads.net'],
    at: true,
    handle: /^[\w.]{1,30}$/,
    pathOf: (handle) => `@${handle}`,
    profileOf: firstSegment([], { at: true }),
    example: 'ada.lovelace',
  },
};

/** Standard and common attribute API names that hold one network's profile (People's and Companies' `linkedin`, `twitter`). */
const NETWORK_SLUGS: Readonly<Record<string, SocialNetwork>> = {
  linkedin: 'linkedin',
  twitter: 'x',
  x: 'x',
  instagram: 'instagram',
  github: 'github',
  facebook: 'facebook',
  youtube: 'youtube',
  angellist: 'angellist',
  wellfound: 'angellist',
  tiktok: 'tiktok',
  threads: 'threads',
};

/** Every network, in a stable order. */
export const SOCIAL_NETWORKS = Object.keys(NETWORKS) as readonly SocialNetwork[];

/** A network's name ("LinkedIn"). */
export function networkName(network: SocialNetwork): string {
  return NETWORKS[network].name;
}

/** The network an attribute holds profiles of, from its API name, or `undefined` for a plain link. */
export function networkOfAttribute(attribute: { readonly apiSlug?: string | undefined }): SocialNetwork | undefined {
  return attribute.apiSlug === undefined ? undefined : NETWORK_SLUGS[attribute.apiSlug.toLowerCase()];
}

/** The host as people say it: lowercased, without `www.` or a mobile `m.`. */
function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^(?:www|m|mobile)\./, '');
}

/** Which network a host belongs to (`uk.linkedin.com` is LinkedIn's), if any. */
function networkOfHost(hostname: string): SocialNetwork | undefined {
  const host = bareHost(hostname);
  return SOCIAL_NETWORKS.find((network) =>
    NETWORKS[network].hosts.some((own) => host === own || host.endsWith(`.${own}`)),
  );
}

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function segmentsOf(url: URL): readonly string[] {
  return url.pathname.split('/').filter((segment) => segment !== '');
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** What a link shows: its network and handle, or its domain. */
export interface LinkLabel {
  /** The chip's words: "@adalovelace", "ada-lovelace", or the domain ("northwind.com"). */
  readonly label: string;
  /** The network whose mark goes before the words, when the link is to one of them. */
  readonly network?: SocialNetwork;
}

/**
 * How a stored link reads: a profile on a known network is its mark and the
 * handle; anything else is its domain, without `www.`. A link that doesn't
 * parse reads as itself.
 */
export function describeLink(url: string): LinkLabel {
  const parsed = parse(url);
  if (parsed === undefined) return { label: url };
  const domain = bareHost(parsed.hostname);
  const network = networkOfHost(parsed.hostname);
  if (network === undefined) return { label: domain };
  const profile = NETWORKS[network].profileOf(segmentsOf(parsed));
  if (profile === undefined) return { label: domain, network };
  const handle = decoded(profile.handle);
  return { label: NETWORKS[network].at ? `@${handle}` : handle, network };
}

/** One checked value, or the sentence to show. */
export type Checked = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string };

/** True when the text is a link rather than a handle: it has a protocol or a path. */
function isLinkLike(text: string): boolean {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(text) || text.includes('/');
}

/**
 * A link typed by hand: a bare domain gets `https://`, and it must be an
 * `http` or `https` link that parses. The scheme and host are lowercased; the
 * path keeps its case.
 */
export function checkLink(draft: string): Checked {
  const text = draft.trim();
  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`;
  const parsed = UrlValue.safeParse(withProtocol);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, message: text.length > 2_048 ? strings.tooLong : strings.invalidLink };
}

/** A link on the network's host, as its one canonical profile link (`https://x.com/ada`), or as checked when it isn't a profile. */
function canonicalProfile(network: SocialNetwork, url: string): string {
  const parsed = parse(url);
  if (parsed === undefined || networkOfHost(parsed.hostname) !== network) return url;
  const profile = NETWORKS[network].profileOf(segmentsOf(parsed));
  return profile === undefined ? url : `https://${NETWORKS[network].hosts[0] ?? ''}/${profile.path}`;
}

/**
 * A network's profile, typed as a handle (`ada`, `@ada`, `company/acme` on
 * LinkedIn) or as a link (`linkedin.com/in/ada/`, `twitter.com/ada?s=20`),
 * to its one canonical link: the network's own host, the profile's path, no
 * tracking. A link to anywhere else is kept as a link, checked as one.
 */
export function checkSocial(network: SocialNetwork, draft: string): Checked {
  const text = draft.trim();
  const def = NETWORKS[network];
  if (network === 'linkedin') {
    const kind = kindAndHandle(['in', 'company', 'school', 'showcase'])(text.split('/'));
    if (kind !== undefined && def.handle.test(kind.handle))
      return { ok: true, value: `https://linkedin.com/${kind.path}` };
  }
  if (isLinkLike(text)) {
    const link = checkLink(text);
    return link.ok
      ? { ok: true, value: canonicalProfile(network, link.value) }
      : { ok: false, message: strings.invalidSocial(def.name, exampleHandle(network)) };
  }
  const handle = text.replace(/^@/, '');
  if (!def.handle.test(handle)) return { ok: false, message: strings.invalidSocial(def.name, exampleHandle(network)) };
  return { ok: true, value: `https://${def.hosts[0] ?? ''}/${def.pathOf(handle)}` };
}

/** The handle a network's editor shows as its placeholder, written the network's way ("@adalovelace"). */
export function exampleHandle(network: SocialNetwork): string {
  const def = NETWORKS[network];
  return def.at ? `@${def.example}` : def.example;
}
