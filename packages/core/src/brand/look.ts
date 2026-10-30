// The caller's own link page accent and photos (spec 0060, AC-10, AC-13, AC-14). The columns live in schema auth's
// `public_profiles`, which the app never touches itself: `crm_profile_look` reads them and `crm_save_profile_accent`
// and `crm_save_profile_image` write them, each for an active member's own page in the transaction's own workspace.
// The owner is always the scope's own identity, never an input, so no one reaches another person's page.
import {
  BRAND_HEX_PATTERN,
  BRAND_HEX_REFUSAL,
  type PageImageSlot,
  type ProfileAccent,
  type ProfileLook,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { sql } from 'drizzle-orm';
import { ownUserId } from '../access/door.ts';
import { inWorkspace } from '../access/run.ts';
import { showLinkPage } from '../booking/handles.ts';
import type { EngineScope } from '../engine/scope.ts';
import { inputInvalid, postgresError, refuse } from '../engine/refusals.ts';

/** One membership's look columns, as `crm_profile_look` answers them. */
export interface LookRow extends Record<string, unknown> {
  readonly accent: string | null;
  readonly accent_dark: string | null;
  readonly cover_path: string | null;
  readonly cover_type: string | null;
  readonly cover_version: string | null;
  readonly ground_path: string | null;
  readonly ground_type: string | null;
  readonly ground_version: string | null;
}

/** `owner`'s look columns in `workspace`, or undefined: no page there, or not an active member of it. */
export async function lookRowOf(tx: WorkspaceTx, owner: string, workspace: string): Promise<LookRow | undefined> {
  const found = await tx.execute<LookRow>(
    sql`select accent, accent_dark, cover_path, cover_type, cover_version, ground_path, ground_type, ground_version
        from crm_profile_look(${owner}::uuid, ${workspace}::uuid)`,
  );
  return found.rows[0];
}

/** The sentence a person with no page meets. */
const NO_PAGE = 'Pick a handle before you choose a look.';

/** The caller's own link page accent and photos in this workspace (the Design panel's read); empty with no page. */
export async function readProfileLook(scope: EngineScope): Promise<ProfileLook> {
  const owner = ownUserId(scope);
  const row = await inWorkspace(scope, (tx) => lookRowOf(tx, owner, scope.workspaceId));
  return {
    ...(typeof row?.accent === 'string' ? { accent: row.accent } : {}),
    ...(typeof row?.accent_dark === 'string' ? { accentDark: row.accent_dark } : {}),
    ...(typeof row?.cover_version === 'string' ? { cover: row.cover_version } : {}),
    ...(typeof row?.ground_version === 'string' ? { ground: row.ground_version } : {}),
  };
}

/** Maps what the definers raise to refusals; anything else is rethrown. */
function definerRefusal(error: unknown): never {
  const pg = postgresError(error);
  if (pg?.code === 'P0002' || pg?.code === '42501') throw refuse('NOT_FOUND', NO_PAGE);
  if (pg?.code === '23514') throw inputInvalid('accent', BRAND_HEX_REFUSAL);
  throw error;
}

/**
 * Sets or clears the caller's own link page accent pair (AC-14), whole. Their page, and their personal booking pages,
 * wear it; cleared, they follow the workspace's brand. Like any edit of the page, it is its first touch.
 */
export async function saveProfileAccent(
  scope: EngineScope,
  input: { readonly accent: string | null; readonly accentDark: string | null },
): Promise<ProfileAccent> {
  const owner = ownUserId(scope);
  const check = (value: string | null, field: string): string | null => {
    if (value === null) return null;
    const lower = value.toLowerCase();
    if (!BRAND_HEX_PATTERN.test(lower)) throw inputInvalid(field, BRAND_HEX_REFUSAL);
    return lower;
  };
  const accent = check(input.accent, 'accent');
  const accentDark = check(input.accentDark, 'accentDark');
  if (accentDark !== null && accent === null)
    throw inputInvalid('accentDark', 'Pick the main colour before a dark one.');
  return inWorkspace(scope, async (tx) => {
    try {
      const saved = await tx.execute<{ accent: string | null; accent_dark: string | null }>(
        sql`select accent, accent_dark from crm_save_profile_accent(${owner}::uuid, ${scope.workspaceId}::uuid, ${accent}, ${accentDark})`,
      );
      await showLinkPage(tx, owner, scope.workspaceId);
      const row = saved.rows[0];
      return { accent: row?.accent ?? null, accentDark: row?.accent_dark ?? null };
    } catch (error) {
      return definerRefusal(error);
    }
  });
}

/** A cover or photo ground as the store keeps it: a path the server made, its checked type, and its version. */
export interface StoredPageImage {
  readonly path: string;
  readonly type: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly version: string;
}

/** The store folder one membership's photos live under; nothing outside it is ever written to the row. */
export function pageImageFolder(userId: string, workspaceId: string): string {
  return `profile-images/${userId.toLowerCase()}/${workspaceId.toLowerCase()}/`;
}

/**
 * Sets (`image`) or clears the caller's own cover photo or photo ground (AC-10, AC-13), answering the path it
 * replaced, which the caller deletes from the store once this has committed. NOT_FOUND with no page to put it on.
 */
export async function saveProfileImage(
  scope: EngineScope,
  input: { readonly slot: PageImageSlot; readonly image?: StoredPageImage },
): Promise<{ readonly previous?: string }> {
  const owner = ownUserId(scope);
  const { slot, image } = input;
  if (
    image !== undefined &&
    (!image.path.startsWith(pageImageFolder(owner, scope.workspaceId)) || image.path.includes('..'))
  ) {
    throw new Error('Refused a photo path the server did not make for this page.');
  }
  const previous = await inWorkspace(scope, async (tx) => {
    try {
      const saved = await tx.execute<{ previous: string | null }>(
        sql`select crm_save_profile_image(${owner}::uuid, ${scope.workspaceId}::uuid, ${slot}, ${image?.path ?? null}, ${image?.type ?? null}, ${image?.version ?? null}) as previous`,
      );
      await showLinkPage(tx, owner, scope.workspaceId);
      return saved.rows[0]?.previous ?? undefined;
    } catch (error) {
      return definerRefusal(error);
    }
  });
  return previous === undefined || previous === image?.path ? {} : { previous };
}
