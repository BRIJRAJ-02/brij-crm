// Social profile links: which network a link or an attribute belongs to, the
// handle a profile link shows, and a typed handle or link turned into the
// profile's one canonical link. Plain functions, no React, so the display, the
// editor and the text conversion (paste, CSV, the import preview) share them.
import { UrlValue } from '@crm/contracts/values';
import { strings as markStrings } from '../../atoms/ProviderMark/strings.ts';
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
  /** A company's handle to its page's path, where a company's differs from a person's (LinkedIn, AngelList). */
  readonly companyPathOf?: (handle: string) => string;
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
    hosts: ['linkedin.com'],
    at: false,
    handle: /^[\p{L}\p{N}_-]{2,100}$/u,
    pathOf: (handle) => `in/${handle}`,
    companyPathOf: (handle) => `company/${handle}`,
    profileOf: kindAndHandle(['in', 'company', 'school', 'showcase']),
    example: 'ada-lovelace',
  },
  x: {
    hosts: ['x.com', 'twitter.com'],
    at: true,
    handle: /^\w{1,15}$/,
    pathOf: (handle) => handle,
    profileOf: firstSegment(['home', 'i', 'intent', 'search', 'hashtag', 'share', 'explore', 'settings']),
    example: 'adalovelace',
  },
  instagram: {
    hosts: ['instagram.com'],
    at: true,
    handle: /^[\w.]{1,30}$/,
    pathOf: (handle) => handle,
    profileOf: firstSegment(['p', 'reel', 'reels', 'explore', 'stories', 'accounts']),
    example: 'ada.lovelace',
  },
  github: {
    hosts: ['github.com'],
    at: false,
    handle: /^[a-z\d](?:[a-z\d-]{0,38})$/i,
    pathOf: (handle) => handle,
    profileOf: firstSegment(['orgs', 'settings', 'search', 'explore', 'topics', 'marketplace']),
    example: 'adalovelace',
  },
  facebook: {
    hosts: ['facebook.com', 'fb.com'],
    at: false,
    handle: /^[\w.-]{1,50}$/,
    pathOf: (handle) => handle,
    profileOf: firstSegment(['profile.php', 'groups', 'events', 'watch', 'share', 'pages', 'people']),
    example: 'ada.lovelace',
  },
  youtube: {
    hosts: ['youtube.com'],
    at: true,
    handle: /^[\w.-]{3,30}$/,
    pathOf: (handle) => `@${handle}`,
    profileOf: (segments) => firstSegment([], { at: true })(segments) ?? kindAndHandle(['c', 'user'])(segments),
    example: 'adalovelace',
  },
  angellist: {
    hosts: ['wellfound.com', 'angel.co'],
    at: false,
    handle: /^[\w-]{1,100}$/,
    pathOf: (handle) => `u/${handle}`,
    companyPathOf: (handle) => `company/${handle}`,
    profileOf: kindAndHandle(['u', 'company', 'p']),
    example: 'ada-lovelace',
  },
  tiktok: {
    hosts: ['tiktok.com'],
    at: true,
    handle: /^[\w.]{2,24}$/,
    pathOf: (handle) => `@${handle}`,
    profileOf: firstSegment([], { at: true }),
    example: 'adalovelace',
  },
  threads: {
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

/** A network's name ("LinkedIn"), as its mark is labelled. */
export function networkName(network: SocialNetwork): string {
  return markStrings.names[network];
}

/** Whose profiles an attribute holds: a company's on the Companies object, else a person's. */
export type ProfileKind = 'person' | 'company';

/** Whose profiles this attribute holds, from its object (`objectKey`). */
export function profileKindOf(attribute: { readonly objectKey?: string | undefined }): ProfileKind {
  return attribute.objectKey === 'companies' ? 'company' : 'person';
}

/** The example handle for a company's page. */
const COMPANY_EXAMPLE = 'northwind';

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

/** What a link shows: its network and handle, or its domain and path. */
export interface LinkLabel {
  /** The chip's words: "@adalovelace", "ada-lovelace", or the domain and path ("northwind.com/pricing"). */
  readonly label: string;
  /** The network whose mark goes before the words, when the link is to one of them. */
  readonly network?: SocialNetwork;
}

/**
 * How a stored link reads: a profile on a known network is its mark and the
 * handle; anything else is its domain, without `www.`, and its path, without
 * the protocol, query or a trailing slash (the chip cuts a long one from the
 * end, so the domain stays). A link that doesn't parse reads as itself.
 */
export function describeLink(url: string): LinkLabel {
  const parsed = parse(url);
  if (parsed === undefined) return { label: url };
  const shown = `${bareHost(parsed.hostname)}${decoded(parsed.pathname).replace(/\/+$/, '')}`;
  const network = networkOfHost(parsed.hostname);
  if (network === undefined) return { label: shown };
  const profile = NETWORKS[network].profileOf(segmentsOf(parsed));
  if (profile === undefined) return { label: shown, network };
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

/** How a network's field names itself in its copy, and whose profiles it holds. */
export interface SocialContext {
  /** The attribute's name ("Twitter"), as its label reads, so the message matches the field. */
  readonly label: string;
  readonly kind: ProfileKind;
}

/**
 * A network's profile, typed as a handle (`ada`, `@ada`, `company/acme` on
 * LinkedIn) or as a link (`linkedin.com/in/ada/`, `twitter.com/ada?s=20`),
 * to its one canonical link: the network's own host, the profile's path, no
 * tracking. A bare handle on a company is its company page where the
 * network tells the two apart (LinkedIn, AngelList). A link to another
 * network is refused; a link to anywhere else (a link page) is kept, checked
 * as a link.
 */
export function checkSocial(network: SocialNetwork, draft: string, context: SocialContext): Checked {
  const text = draft.trim();
  const def = NETWORKS[network];
  const invalid = {
    ok: false,
    message: strings.invalidSocial(context.label, exampleHandle(network, context.kind)),
  } as const;
  if (network === 'linkedin') {
    const kind = kindAndHandle(['in', 'company', 'school', 'showcase'])(text.split('/'));
    if (kind !== undefined && def.handle.test(kind.handle))
      return { ok: true, value: `https://linkedin.com/${kind.path}` };
  }
  // The network's bare host ("facebook.com") is no one's profile.
  if (def.hosts.includes(bareHost(text.replace(/^[a-z][a-z\d+.-]*:\/\//i, '').replace(/\/+$/, '')))) return invalid;
  if (isLinkLike(text)) {
    const link = checkLink(text);
    if (!link.ok) return invalid;
    const host = parse(link.value)?.hostname;
    const elsewhere = host === undefined ? undefined : networkOfHost(host);
    if (elsewhere !== undefined && elsewhere !== network) {
      return { ok: false, message: strings.otherNetwork(networkName(elsewhere), context.label) };
    }
    return { ok: true, value: canonicalProfile(network, link.value) };
  }
  const handle = text.replace(/^@/, '');
  if (!def.handle.test(handle)) return invalid;
  const path =
    context.kind === 'company' && def.companyPathOf !== undefined ? def.companyPathOf(handle) : def.pathOf(handle);
  return { ok: true, value: `https://${def.hosts[0] ?? ''}/${path}` };
}

/** The handle a network's editor shows as its placeholder, written the network's way ("@adalovelace"). */
export function exampleHandle(network: SocialNetwork, kind: ProfileKind = 'person'): string {
  const def = NETWORKS[network];
  const example = kind === 'company' && def.companyPathOf !== undefined ? COMPANY_EXAMPLE : def.example;
  return def.at ? `@${example}` : example;
}
