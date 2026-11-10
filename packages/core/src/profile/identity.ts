// Who a link page belongs to (3 Nov 2026, the owner's reference page): whether its owner's job title shows under
// their name, the site address the workspace's logo and name link to, and one line of their own above "Powered by
// Timefix". The three live in schema auth's `public_profiles`, which the app never touches itself:
// `crm_profile_identity` reads them and `crm_save_profile_identity` writes them, each for an active member's own page
// in the transaction's own workspace. What a visitor sees is made here (`publicIdentityOf`), inside the page owner's
// workspace transaction, so a job title or a workspace's name is read under that workspace's own row level security.
import { profileLogoPath, type PublicProfile } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { brandRowOf } from '../brand/brand.ts';
import { publishedBusinessHandle } from '../hospitality/public-page.ts';

const { members, workspaces } = schema;

/** One membership's three choices, as `crm_profile_identity` answers them. */
interface IdentityRow extends Record<string, unknown> {
  readonly show_job_title: boolean;
  readonly site_url: string | null;
  readonly foot_line: string | null;
}

/** A page's three choices: off, and none, until its owner makes them. */
export interface ProfileIdentity {
  readonly showJobTitle: boolean;
  readonly site?: string;
  readonly footLine?: string;
}

/**
 * `owner`'s choices in `workspace`, or undefined: no page there, or not an active member of it. `published` reads them
 * as guests see them (spec 0068, AC-6810: the last Publish); the owner's editor reads the draft.
 */
export async function identityOf(
  tx: WorkspaceTx,
  owner: string,
  workspace: string,
  which: 'draft' | 'published' = 'draft',
): Promise<ProfileIdentity | undefined> {
  const found = await tx.execute<IdentityRow>(
    which === 'published'
      ? sql`select show_job_title, site_url, foot_line from crm_profile_identity_public(${owner}::uuid, ${workspace}::uuid)`
      : sql`select show_job_title, site_url, foot_line from crm_profile_identity(${owner}::uuid, ${workspace}::uuid)`,
  );
  const [row] = found.rows;
  if (row === undefined) return undefined;
  return {
    showJobTitle: row.show_job_title,
    ...(typeof row.site_url === 'string' ? { site: row.site_url } : {}),
    ...(typeof row.foot_line === 'string' ? { footLine: row.foot_line } : {}),
  };
}

/** Writes `owner`'s three choices in `workspace`, whole; an absent address or line clears it. */
export async function saveIdentity(
  tx: WorkspaceTx,
  owner: string,
  workspace: string,
  identity: ProfileIdentity,
): Promise<void> {
  await tx.execute(
    sql`select crm_save_profile_identity(${owner}::uuid, ${workspace}::uuid, ${identity.showJobTitle}, ${identity.site ?? null}, ${identity.footLine ?? null})`,
  );
}

/** A member's job title in this workspace, while they are active here; undefined when they set none. */
export async function jobTitleOf(tx: WorkspaceTx, userId: string, workspace: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ jobTitle: members.jobTitle })
    .from(members)
    .where(and(eq(members.workspaceId, workspace), eq(members.userId, userId), eq(members.status, 'active')))
    .limit(1);
  const title = row?.jobTitle?.trim() ?? '';
  return title === '' ? undefined : title;
}

/**
 * A member's name in this workspace, while they are active here; undefined when the row has none. A link page is the
 * membership's (one per workspace), and its editor names the page through this row (`updateMyMemberProfile`, or
 * `namePageOnlyPerson` for a page only person), so the page reads it live, as Profile does (owner, 10 Nov 2026).
 */
export async function memberNameOf(tx: WorkspaceTx, userId: string, workspace: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ name: members.name })
    .from(members)
    .where(and(eq(members.workspaceId, workspace), eq(members.userId, userId), eq(members.status, 'active')))
    .limit(1);
  const name = row?.name.trim() ?? '';
  return name === '' ? undefined : name;
}

/**
 * What a visitor to `owner`'s link page is told of who it belongs to: their job title while they show it, the
 * workspace's name and logo path while they have set a site for them to link to, and their own foot line. Inside the
 * owner's own workspace transaction; nothing here is an email, an id or anything the owner didn't choose to show.
 */
export async function publicIdentityOf(
  tx: WorkspaceTx,
  owner: { readonly userId: string; readonly workspaceId: string; readonly handle: string },
  /** `draft` only for the owner's own Preview (spec 0068). */
  which: 'draft' | 'published' = 'published',
): Promise<Pick<PublicProfile, 'role' | 'brand' | 'footLine'>> {
  const identity = await identityOf(tx, owner.userId, owner.workspaceId, which);
  if (identity === undefined) return {};
  const role = identity.showJobTitle ? await jobTitleOf(tx, owner.userId, owner.workspaceId) : undefined;
  let brand: PublicProfile['brand'];
  if (identity.site !== undefined) {
    const [workspace] = await tx
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(and(eq(workspaces.id, owner.workspaceId), isNull(workspaces.deletedAt)));
    const kit = await brandRowOf(tx, owner.workspaceId);
    // The company page, while one is published, on the public host the link page is on (spec 0066, AC-6646).
    const company = await publishedBusinessHandle(tx, owner.workspaceId);
    if (workspace !== undefined) {
      brand = {
        name: workspace.name,
        site: company === undefined ? identity.site : `/${company}`,
        ...(typeof kit?.logoVersion === 'string' && typeof kit.logoPath === 'string'
          ? { logo: profileLogoPath(owner.handle, kit.logoVersion) }
          : {}),
      };
    }
  }
  return {
    ...(role === undefined ? {} : { role }),
    ...(brand === undefined ? {} : { brand }),
    ...(identity.footLine === undefined ? {} : { footLine: identity.footLine }),
  };
}

/**
 * The workspace logo a link page's lockup draws, to serve (`/api/public/profiles/:handle/logo`): the brand kit's,
 * only while the page has a site address for it to link to, so the route answers nothing a visitor can't see.
 */
export async function lockupLogoOf(
  tx: WorkspaceTx,
  owner: { readonly userId: string; readonly workspaceId: string },
): Promise<{ readonly path: string; readonly type: string; readonly version: string } | undefined> {
  const identity = await identityOf(tx, owner.userId, owner.workspaceId, 'published');
  if (identity?.site === undefined) return undefined;
  const kit = await brandRowOf(tx, owner.workspaceId);
  if (typeof kit?.logoPath !== 'string' || typeof kit.logoType !== 'string' || typeof kit.logoVersion !== 'string') {
    return undefined;
  }
  return { path: kit.logoPath, type: kit.logoType, version: kit.logoVersion };
}
