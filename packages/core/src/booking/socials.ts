// A person's own social links (booking socials, 25 Oct 2026): LinkedIn, X, their website and the rest, shown on
// their booking pages and their `/<handle>` profile. The person's, like their handle and bio, the same in every
// workspace, kept in schema auth (`auth.social_links`, migration 0096) and reached only through crm_handle's two
// definer functions, inside the caller's workspace transaction. What a public page draws is made here
// (`publicSocialsOf`), ready to draw, so the public bundles carry no link parsing.
import {
  checkSocialLink,
  describeLink,
  isSocialLinkNetwork,
  SOCIAL_LINKS_MAX,
  type PublicSocialLink,
  type SocialLink,
  type SocialLinkNetwork,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { sql } from 'drizzle-orm';
import { refuseOn } from '../engine/refusals.ts';
import { isUuid } from '../engine/ids.ts';

interface SocialRow extends Record<string, unknown> {
  readonly user_id: string;
  readonly network: string;
  readonly href: string;
}

/** Each person's social links, in their order (`crm_social_links_of`), by user id; a stored row of an unknown network is left out. */
export async function socialLinksOf(
  tx: WorkspaceTx,
  userIds: readonly (string | null | undefined)[],
): Promise<ReadonlyMap<string, readonly SocialLink[]>> {
  const ids = [...new Set(userIds.filter((id): id is string => id !== null && id !== undefined && isUuid(id)))];
  if (ids.length === 0) return new Map();
  const found = await tx.execute<SocialRow>(
    sql`select user_id::text as user_id, network, href from crm_social_links_of(${`{${ids.join(',')}}`}::uuid[])`,
  );
  const links = new Map<string, SocialLink[]>();
  for (const row of found.rows) {
    if (!isSocialLinkNetwork(row.network)) continue;
    const held = links.get(row.user_id) ?? [];
    held.push({ network: row.network, href: row.href });
    links.set(row.user_id, held);
  }
  return links;
}

/** One person's social links, in their order. */
export async function socialLinksOfUser(tx: WorkspaceTx, userId: string): Promise<readonly SocialLink[]> {
  return (await socialLinksOf(tx, [userId])).get(userId) ?? [];
}

/**
 * The person's links checked again for writing: each made canonical by `checkSocialLink` (a core caller gets the
 * contract's refusals), one per network, at most ten. Refusals name the row (`socials.2.href`).
 */
export function checkedSocialLinks(links: readonly SocialLink[]): readonly SocialLink[] {
  if (links.length > SOCIAL_LINKS_MAX) {
    throw refuseOn('LIMIT_REACHED', `Add at most ${String(SOCIAL_LINKS_MAX)} social links.`, 'socials');
  }
  const seen = new Set<SocialLinkNetwork>();
  return links.map((link, index) => {
    if (!isSocialLinkNetwork(link.network)) {
      throw refuseOn('CONFIG_INVALID', 'Pick one of the networks.', `socials.${String(index)}.network`);
    }
    if (seen.has(link.network)) {
      throw refuseOn('CONFIG_INVALID', 'Add each network only once.', `socials.${String(index)}.network`);
    }
    seen.add(link.network);
    const checked = checkSocialLink(link.network, link.href);
    if (!checked.ok) throw refuseOn('CONFIG_INVALID', 'That link isn’t right.', `socials.${String(index)}.href`);
    return { network: link.network, href: checked.value };
  });
}

/** Whether two sets of links are the same, in the same order. */
export function sameSocialLinks(left: readonly SocialLink[], right: readonly SocialLink[]): boolean {
  return (
    left.length === right.length &&
    left.every((link, index) => link.network === right[index]?.network && link.href === right[index].href)
  );
}

/** Replaces the person's social links with `links`, in order (`crm_save_social_links`); nothing written when equal. */
export async function saveSocialLinks(tx: WorkspaceTx, userId: string, links: readonly SocialLink[]): Promise<void> {
  // Sent as JSON lists, kept in order, so no link is ever spliced into an array literal.
  const list = (values: readonly string[]) =>
    sql`array(select t.v from jsonb_array_elements_text(${JSON.stringify(values)}::jsonb) with ordinality as t(v, n) order by t.n)`;
  await tx.execute(
    sql`select crm_save_social_links(${userId}::uuid, ${list(links.map((link) => link.network))}, ${list(links.map((link) => link.href))})`,
  );
}

/** A stored link as a public page draws it: its network, the link, and what it reads as ("@ada", "ada.dev"). */
export function publicSocialLink(link: SocialLink): PublicSocialLink {
  const { label } = describeLink(link.href);
  return { network: link.network, href: link.href, label };
}

/**
 * The person's social links ready for a public page (their booking pages, their profile, a link page): one read of
 * `crm_social_links_of`, inside the caller's transaction.
 */
export async function publicSocialsOf(tx: WorkspaceTx, userId: string): Promise<readonly PublicSocialLink[]> {
  return (await socialLinksOfUser(tx, userId)).map(publicSocialLink);
}
