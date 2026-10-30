// Handles (owner decision, 22 Oct 2026): a person's public profile at `/<handle>` and each booking page at
// `/<handle>/<slug>`. Handles live in schema auth (migration 0086), out of the app role's reach; these are its only
// ways there, each one of crm_handle's definer functions, run inside the caller's workspace transaction.
import {
  bookingPagePath,
  DEFAULT_PAGE_THEME,
  handleBaseFor,
  handleFromName,
  HANDLE_MAX,
  PageTheme,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { sql } from 'drizzle-orm';
import { isUuid } from '../engine/ids.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';

/** A person's public facts: their current handle and bio. */
export interface PublicProfileRow {
  readonly handle: string;
  readonly bio: string;
  /** The look they picked for their link page (spec 0054); the default until they touch it. */
  readonly theme: PageTheme;
  /** Whether search engines may show their page (spec 0055, AC-5506). */
  readonly indexable: boolean;
  /**
   * The version of the picture a pasted link to their page shows instead of the drawn card (spec 0055, AC-5511),
   * or absent when they have set none. The bytes are never read with the profile: only the path's version is.
   */
  readonly shareImageVersion?: string;
  /**
   * Whether the link page is public (27 Oct 2026; spec 0058, AC-23). A page made with a membership starts private and
   * goes live the first time its owner claims or opens it (`showLinkPage`); after that only their Live or Private
   * switch changes it (`setLinkPageLive`).
   */
  readonly isShown: boolean;
}

interface ProfileRow extends Record<string, unknown> {
  readonly user_id: string;
  readonly handle: string;
  readonly bio: string;
  readonly theme: unknown;
  readonly indexable: boolean;
  readonly share_image_version: string | null;
  readonly shown: boolean;
}

/**
 * The handle, bio and look each person named holds in ONE workspace (`crm_public_profiles_of`), by their user id: a
 * person's handle belongs to their membership there (spec 0056, AC-5601), so another workspace's is never answered.
 */
export async function publicProfilesOf(
  tx: WorkspaceTx,
  workspaceId: string,
  userIds: readonly (string | null | undefined)[],
): Promise<ReadonlyMap<string, PublicProfileRow>> {
  const ids = [...new Set(userIds.filter((id): id is string => id !== null && id !== undefined && isUuid(id)))];
  if (ids.length === 0) return new Map();
  const found = await tx.execute<ProfileRow>(
    sql`select user_id::text as user_id, handle, bio, theme, indexable, share_image_version, shown from crm_public_profiles_of(${`{${ids.join(',')}}`}::uuid[], ${workspaceId}::uuid)`,
  );
  return new Map(
    found.rows.map((row) => [
      row.user_id,
      {
        handle: row.handle,
        bio: row.bio,
        theme: PageTheme.safeParse(row.theme).data ?? DEFAULT_PAGE_THEME,
        indexable: row.indexable,
        ...(typeof row.share_image_version === 'string' ? { shareImageVersion: row.share_image_version } : {}),
        isShown: row.shown,
      },
    ]),
  );
}

interface ShownRow extends Record<string, unknown> {
  readonly shown: boolean;
}

/**
 * The person claimed, opened or edited their link page in this workspace (`crm_show_public_profile`; spec 0058,
 * AC-23): a page nobody has chosen for yet goes live, once, and is theirs from then on. A page made with their
 * membership is private until then, since an address made from their name, showing their name and photo, is not
 * one they ever asked for. True when the page is public after this; false when they set it Private, or have no page
 * here. It never overrules their own choice, so it is safe on every claim, open and edit.
 */
export async function showLinkPage(tx: WorkspaceTx, userId: string, workspaceId: string): Promise<boolean> {
  const found = await tx.execute<ShownRow>(
    sql`select crm_show_public_profile(${userId}::uuid, ${workspaceId}::uuid) as shown`,
  );
  return found.rows[0]?.shown === true;
}

/**
 * The Live or Private switch (`crm_set_public_profile_live`; spec 0058, AC-23): the person's link page in this
 * workspace is public when `live`, private otherwise, and their own choice from now on. Answers whether it is
 * public after this; false, writing nothing, when they have no page here.
 */
export async function setLinkPageLive(
  tx: WorkspaceTx,
  userId: string,
  workspaceId: string,
  live: boolean,
): Promise<boolean> {
  const found = await tx.execute<ShownRow>(
    sql`select crm_set_public_profile_live(${userId}::uuid, ${workspaceId}::uuid, ${live}) as shown`,
  );
  return found.rows[0]?.shown === true;
}

/** The constraint a handle another person holds (or held) is refused on. */
const HANDLE_CLAIM_CONSTRAINT = 'public_handles_pkey';

/**
 * Claims `handle` for the person and sets their bio (`crm_save_public_profile`): their old handle keeps finding
 * them. A handle another person holds or held is `SLUG_TAKEN` on `handle`; past 20 held, `LIMIT_REACHED`.
 */
export async function savePublicProfile(
  tx: WorkspaceTx,
  userId: string,
  workspaceId: string,
  handle: string,
  bio: string,
): Promise<void> {
  try {
    await tx.execute(sql`select crm_save_public_profile(${userId}::uuid, ${workspaceId}::uuid, ${handle}, ${bio})`);
  } catch (error) {
    const pg = postgresError(error);
    if (pg?.code === '23505' && pg.constraint === HANDLE_CLAIM_CONSTRAINT) {
      throw refuseOn('SLUG_TAKEN', 'That handle is taken. Pick another.', 'handle');
    }
    if (pg?.code === '54000') {
      // Only with 20 live pages: an old handle makes room for a new one (late trap #76, migration 0124).
      throw refuseOn('LIMIT_REACHED', 'You have link pages in 20 workspaces, the most one person can have.', 'handle');
    }
    if (pg?.code === '42501') throw refuse('FORBIDDEN', 'You’re not a member of this workspace.');
    throw error;
  }
}

interface HeldRow extends Record<string, unknown> {
  readonly held: boolean;
}

/**
 * Whether anyone holds or ever held `handle` (`crm_handle_taken`): a handle is never freed, so this does not ask
 * whether its person is still a member of anything (`crm_handle_owner` does, and answers nothing then).
 */
async function isHeld(tx: WorkspaceTx, handle: string): Promise<boolean> {
  const found = await tx.execute<HeldRow>(sql`select crm_handle_taken(${handle}) as held`);
  return found.rows[0]?.held === true;
}

interface EnsuredRow extends Record<string, unknown> {
  readonly handle: string | null;
}

/**
 * The membership's link page, made the moment the membership is (26 Oct 2026, the owner: "create link page
 * automatically as soon as someone signs up"): their handle in the workspace, the one they hold or a new one from
 * their name (else their email's first part, `handleBaseFor`) made unique with a short number, and an empty page
 * behind it (`crm_ensure_public_profile`). Runs under its own savepoint in the caller's transaction and never
 * throws: a membership never fails because of its link page. Undefined when none was made (not an active member,
 * 20 live pages already, every try taken, or a failure); the daily cleanup tries again.
 */
export async function ensureLinkPage(
  tx: WorkspaceTx,
  member: { readonly userId: string; readonly workspaceId: string; readonly name: string; readonly email: string },
): Promise<string | undefined> {
  if (!isUuid(member.userId) || !isUuid(member.workspaceId)) return undefined;
  const base = handleBaseFor(member.name, member.email);
  try {
    return await tx.transaction(async (savepoint) => {
      const found = await savepoint.execute<EnsuredRow>(
        sql`select crm_ensure_public_profile(${member.userId}::uuid, ${member.workspaceId}::uuid, ${base}) as handle`,
      );
      return found.rows[0]?.handle ?? undefined;
    });
  } catch {
    return undefined;
  }
}

/** A free handle from a name, for the field's first value: the name's, else it with -2, -3 … up to -9; else none. */
export async function suggestHandle(tx: WorkspaceTx, name: string): Promise<string | undefined> {
  const base = handleFromName(name);
  for (let n = 1; n <= 9; n += 1) {
    const suffix = n === 1 ? '' : `-${String(n)}`;
    const wanted = `${base.slice(0, HANDLE_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!(await isHeld(tx, wanted))) return wanted;
  }
  return undefined;
}

/**
 * A page's public path: `/<handle>/<slug>` for a Public page once its owner has a handle, else `/b/<publicKey>`
 * (which keeps working either way, and is a Link only page's only address).
 */
export async function pagePath(
  tx: WorkspaceTx,
  page: {
    readonly ownerUserId: string | null;
    readonly workspaceId: string;
    readonly slug: string;
    readonly publicKey: string;
    readonly isPrivate: boolean;
  },
): Promise<string> {
  if (page.isPrivate) return bookingPagePath(page);
  const handle =
    page.ownerUserId === null
      ? undefined
      : (await publicProfilesOf(tx, page.workspaceId, [page.ownerUserId])).get(page.ownerUserId)?.handle;
  return bookingPagePath({ handle, slug: page.slug, publicKey: page.publicKey });
}

interface HandlesOfRow extends Record<string, unknown> {
  readonly workspace_id: string;
  readonly handle: string;
}

/**
 * The handles a person holds now, one per workspace they are still an active member of (`crm_profile_handles_of`),
 * for the one line that says they already have a link page elsewhere (spec 0056, AC-5618).
 */
export async function profileHandlesOf(
  tx: WorkspaceTx,
  userId: string,
): Promise<readonly { readonly workspaceId: string; readonly handle: string }[]> {
  const found = await tx.execute<HandlesOfRow>(
    sql`select workspace_id::text as workspace_id, handle from crm_profile_handles_of(${userId}::uuid)`,
  );
  return found.rows.map((row) => ({ workspaceId: row.workspace_id, handle: row.handle }));
}

interface SlugRow extends Record<string, unknown> {
  readonly slug: string;
}

/** The slugs the person's pages hold in ONE workspace that start with `prefix` (`crm_booking_owner_slugs`). */
export async function ownerSlugs(
  tx: WorkspaceTx,
  userId: string,
  workspaceId: string,
  prefix: string,
): Promise<readonly string[]> {
  const found = await tx.execute<SlugRow>(
    sql`select slug from crm_booking_owner_slugs(${userId}::uuid, ${workspaceId}::uuid, ${prefix})`,
  );
  return found.rows.map((row) => row.slug);
}
