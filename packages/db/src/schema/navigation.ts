// The sidebar (spec 0034): one row per member per workspace holding their own
// choices for it: the order of its items, the hidden ones and the favourites
// (`items`, an ordered array of `{ kind, id, pinned, hidden }`), the section
// order and folds (`sections`), and the rail. A member with no row sees the
// defaults; their first change makes it. Ids in `items` point at four tables
// and carry no foreign keys, so a purge never fails on them: reads skip what
// doesn't resolve, and writes and the daily cleanup prune it. Only the member
// writes their row (`nav.change` takes no member id), and their removal
// deletes it.
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, integer, jsonb, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, workspaceId } from './common.ts';
import { actorConstraints, members } from './workspaces.ts';

/** The most items one row stores (spec 0034; `MAX_NAV_ITEMS` in `@crm/contracts/navigation`). */
export const NAV_ITEMS_MAX = 400;

/** One member's sidebar in one workspace. */
export const memberNavPrefs = pgTable(
  'member_nav_prefs',
  {
    workspaceId: workspaceId(),
    memberId: uuid('member_id').notNull(),
    /** `NavItemPref[]`: the order inside each section is the order here. */
    items: jsonb('items')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** `{ order: NavSectionKey[], folded: NavSectionKey[] }`. */
    sections: jsonb('sections')
      .notNull()
      .default(sql`'{"order": [], "folded": []}'::jsonb`),
    rail: boolean('rail').notNull().default(false),
    /** Up by one on every write: the browser ignores an answer older than the copy it holds. */
    version: integer('version').notNull().default(1),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'member_nav_prefs_pkey', columns: [t.workspaceId, t.memberId] }),
    foreignKey({
      name: 'member_nav_prefs_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('cascade'),
    check('member_nav_prefs_items', sql`jsonb_typeof(${t.items}) = 'array' and jsonb_array_length(${t.items}) <= 400`),
    check(
      'member_nav_prefs_sections',
      sql`jsonb_typeof(${t.sections}) = 'object' and octet_length(${t.sections}::text) <= 1024`,
    ),
    check('member_nav_prefs_version', sql`${t.version} >= 1`),
    ...actorConstraints('member_nav_prefs', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('member_nav_prefs', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);
