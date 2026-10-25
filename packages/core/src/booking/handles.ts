// Handles (owner decision, 22 Oct 2026): a person's public profile at `/<handle>` and each booking page at
// `/<handle>/<slug>`. Handles live in schema auth (migration 0086), out of the app role's reach; these are its only
// ways there, each one of crm_handle's definer functions, run inside the caller's workspace transaction.
import { bookingPagePath, DEFAULT_PAGE_THEME, handleFromName, HANDLE_MAX, PageTheme } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { sql } from 'drizzle-orm';
import { isUuid } from '../engine/ids.ts';
import { postgresError, refuseOn } from '../engine/refusals.ts';

/** A person's public facts: their current handle and bio. */
export interface PublicProfileRow {
  readonly handle: string;
  readonly bio: string;
  /** The look they picked for their link page (spec 0054); the default until they touch it. */
  readonly theme: PageTheme;
}

interface ProfileRow extends Record<string, unknown> {
  readonly user_id: string;
  readonly handle: string;
  readonly bio: string;
  readonly theme: unknown;
}

/** The handle, bio and look of each person named who has a handle (`crm_public_profiles_of`), by their user id. */
export async function publicProfilesOf(
  tx: WorkspaceTx,
  userIds: readonly (string | null | undefined)[],
): Promise<ReadonlyMap<string, PublicProfileRow>> {
  const ids = [...new Set(userIds.filter((id): id is string => id !== null && id !== undefined && isUuid(id)))];
  if (ids.length === 0) return new Map();
  const found = await tx.execute<ProfileRow>(
    sql`select user_id::text as user_id, handle, bio, theme from crm_public_profiles_of(${`{${ids.join(',')}}`}::uuid[])`,
  );
  return new Map(
    found.rows.map((row) => [
      row.user_id,
      { handle: row.handle, bio: row.bio, theme: PageTheme.safeParse(row.theme).data ?? DEFAULT_PAGE_THEME },
    ]),
  );
}

/** The constraint a handle another person holds (or held) is refused on. */
const HANDLE_CLAIM_CONSTRAINT = 'public_handles_pkey';

/**
 * Claims `handle` for the person and sets their bio (`crm_save_public_profile`): their old handle keeps finding
 * them. A handle another person holds or held is `SLUG_TAKEN` on `handle`; past 20 held, `LIMIT_REACHED`.
 */
export async function savePublicProfile(tx: WorkspaceTx, userId: string, handle: string, bio: string): Promise<void> {
  try {
    await tx.execute(sql`select crm_save_public_profile(${userId}::uuid, ${handle}, ${bio})`);
  } catch (error) {
    const pg = postgresError(error);
    if (pg?.code === '23505' && pg.constraint === HANDLE_CLAIM_CONSTRAINT) {
      throw refuseOn('SLUG_TAKEN', 'That handle is taken. Pick another.', 'handle');
    }
    if (pg?.code === '54000') {
      throw refuseOn('LIMIT_REACHED', 'You’ve changed your handle too many times. Pick one you used before.', 'handle');
    }
    throw error;
  }
}

interface OwnerRow extends Record<string, unknown> {
  readonly user_id: string;
}

/** Whether a person holds or held `handle` (`crm_handle_owner`). */
async function isHeld(tx: WorkspaceTx, handle: string): Promise<boolean> {
  const found = await tx.execute<OwnerRow>(sql`select user_id::text as user_id from crm_handle_owner(${handle})`);
  return found.rows.length > 0;
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
    readonly slug: string;
    readonly publicKey: string;
    readonly isPrivate: boolean;
  },
): Promise<string> {
  if (page.isPrivate) return bookingPagePath(page);
  const handle =
    page.ownerUserId === null
      ? undefined
      : (await publicProfilesOf(tx, [page.ownerUserId])).get(page.ownerUserId)?.handle;
  return bookingPagePath({ handle, slug: page.slug, publicKey: page.publicKey });
}

interface SlugRow extends Record<string, unknown> {
  readonly slug: string;
}

/** The slugs the person's live pages hold in every workspace that start with `prefix` (`crm_booking_owner_slugs`). */
export async function ownerSlugs(tx: WorkspaceTx, userId: string, prefix: string): Promise<readonly string[]> {
  const found = await tx.execute<SlugRow>(sql`select slug from crm_booking_owner_slugs(${userId}::uuid, ${prefix})`);
  return found.rows.map((row) => row.slug);
}
