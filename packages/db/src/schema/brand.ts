// A workspace's brand kit (spec 0060, AC-1 to AC-4): the accent its booking pages and hosted forms wear, and its
// logo. One row per workspace, made the first time an owner or admin saves it; no row means the product's own look.
// A tenant table under forced row level security with the plain workspace policy (migration 0143_brand_kit).
//
// The accent is the one free value: a hex checked here as in the contract, so nothing typed ever reaches CSS. The
// logo is a path in the private store the server made (`logos/<workspace id>/<random id>.<ext>`), its type and a
// short version for the path that serves it, all three or none.
import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, workspaceId } from './common.ts';
import { members, workspaces } from './workspaces.ts';

/** A workspace's brand kit: its accent pair and its logo. */
export const workspaceBrands = pgTable(
  'workspace_brands',
  {
    workspaceId: workspaceId(),
    /** The accent, `#` and six lowercase hex digits; null means the product's own. */
    accent: text('accent'),
    /** The dark pages' accent; null means the light one, lifted by the contrast guard. */
    accentDark: text('accent_dark'),
    logoPath: text('logo_path'),
    logoType: text('logo_type'),
    logoVersion: text('logo_version'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    /** The member who last saved it. */
    updatedBy: uuid('updated_by').notNull(),
  },
  (t) => [
    primaryKey({ name: 'workspace_brands_pkey', columns: [t.workspaceId] }),
    foreignKey({
      name: 'workspace_brands_workspace',
      columns: [t.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'workspace_brands_updated_by',
      columns: [t.workspaceId, t.updatedBy],
      foreignColumns: [members.workspaceId, members.id],
    }),
    check(
      'workspace_brands_accent',
      sql`(${t.accent} is null or ${t.accent} ~ '^#[0-9a-f]{6}$')
        and (${t.accentDark} is null or (${t.accentDark} ~ '^#[0-9a-f]{6}$' and ${t.accent} is not null))`,
    ),
    check(
      'workspace_brands_logo',
      sql`(${t.logoPath} is null and ${t.logoType} is null and ${t.logoVersion} is null)
        or (${t.logoPath} ~ ('^logos/' || ${t.workspaceId}::text || '/[0-9a-f-]{36}[.](png|jpg|webp)$')
          and ${t.logoType} in ('image/png', 'image/jpeg', 'image/webp')
          and ${t.logoVersion} ~ '^[0-9a-f]{12}$')`,
    ),
  ],
);
