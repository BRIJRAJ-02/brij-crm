// The networks a person's own social links may name (booking socials, 25 Oct 2026): the profile networks whose
// marks the library draws, and their own website. A plain list with no Zod and no parsing, so the browser's
// editor, the server and the public pages' types share it. Add a network here, with its rules in `social.ts`,
// its mark in ProviderMark and its name below.

/** A network a person's social link names, or their own website. */
export type SocialLinkNetwork =
  'linkedin' | 'x' | 'instagram' | 'github' | 'facebook' | 'youtube' | 'tiktok' | 'threads' | 'angellist' | 'website';

/** Every network a social link may name, in the order an editor offers them. */
export const SOCIAL_LINK_NETWORKS = [
  'linkedin',
  'x',
  'instagram',
  'github',
  'facebook',
  'youtube',
  'tiktok',
  'threads',
  'angellist',
  'website',
] as const satisfies readonly SocialLinkNetwork[];

/** The most social links a person keeps: one per network. */
export const SOCIAL_LINKS_MAX = 10;

/** The longest website link kept. */
export const WEBSITE_LINK_MAX = 2_000;

/** Each network's name as people say it. */
export const SOCIAL_LINK_NAMES: Readonly<Record<SocialLinkNetwork, string>> = {
  linkedin: 'LinkedIn',
  x: 'X',
  instagram: 'Instagram',
  github: 'GitHub',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  threads: 'Threads',
  angellist: 'AngelList',
  website: 'Website',
};

/** Whether a value names a network a social link may (a stored row, a message). */
export function isSocialLinkNetwork(value: unknown): value is SocialLinkNetwork {
  return typeof value === 'string' && (SOCIAL_LINK_NETWORKS as readonly string[]).includes(value);
}
