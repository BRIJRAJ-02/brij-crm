// Publish for every public page (spec 0068, AC-6810 to AC-6816): one table of published versions for every kind of
// page, booking pages first, link, business and event pages after them. A page row keeps its unpublished changes in
// its own `draft` column; Publish writes them into the live columns and keeps the settings it published here, with
// who and when, the last 20 per page. A tenant table under forced row level security with the plain workspace policy
// (migration 0171_page_versions); the app adds and prunes versions and never rewrites one.
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, workspaceId } from './common.ts';
import { members, workspaces } from './workspaces.ts';

/** The kinds of page that publish through this table. */
export const PAGE_VERSION_KINDS = ['booking', 'link', 'business', 'event'] as const;

/** One published version of a page: its number, the settings guests saw, and who published it when. */
export const pageVersions = pgTable(
  'page_versions',
  {
    workspaceId: workspaceId(),
    pageKind: text('page_kind').notNull(),
    pageId: uuid('page_id').notNull(),
    /** 1, 2, … per page; the highest is what guests see now. */
    version: integer('version').notNull(),
    /** The published settings whole, by name (at most 64 KB). */
    snapshot: jsonb('snapshot').notNull(),
    /** Who published it; null for the versions the migration made, and once that member is gone. */
    publishedByMemberId: uuid('published_by_member_id'),
    publishedAt: timestamptz('published_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'page_versions_pkey', columns: [t.workspaceId, t.pageKind, t.pageId, t.version] }),
    foreignKey({ name: 'page_versions_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }).onDelete(
      'cascade',
    ),
    // Hand written in the migration with `on delete set null (published_by_member_id)`.
    foreignKey({
      name: 'page_versions_published_by',
      columns: [t.workspaceId, t.publishedByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    index('page_versions_newest').on(t.workspaceId, t.pageKind, t.pageId, t.version.desc()),
    index('page_versions_by_member')
      .on(t.workspaceId, t.publishedByMemberId)
      .where(sql`${t.publishedByMemberId} is not null`),
    check('page_versions_kind', sql`${t.pageKind} in ('booking', 'link', 'business', 'event')`),
    check('page_versions_version', sql`${t.version} >= 1`),
    check(
      'page_versions_snapshot',
      sql`jsonb_typeof(${t.snapshot}) = 'object' and pg_column_size(${t.snapshot}) <= 65536`,
    ),
  ],
);
