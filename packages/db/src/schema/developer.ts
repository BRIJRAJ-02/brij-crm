// API keys (parity #34, design note `design-note-api-webhooks.md`): one tenant table under forced row level security
// with the plain policy. A key stores only the SHA-256 of its secret and the secret's last four characters: the whole
// key is shown once, when it is made. A key is never wider than the member who made it (the door re-enters them on
// every request), so the creator is a foreign key and a key whose creator left stops working.
import { sql } from 'drizzle-orm';
import { check, customType, foreignKey, index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamptz, workspaceId } from './common.ts';
import { members, workspaces } from './workspaces.ts';

/** Raw bytes (Postgres `bytea`) as a Node Buffer. */
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/** One API key. A revoked one stays, refused, for the Undo window and the audit trail. */
export const apiKeys = pgTable(
  'api_keys',
  {
    workspaceId: workspaceId(),
    id: id(),
    name: text('name').notNull(),
    /** `data.read`, or `data.read` and `data.write` (the key scope catalog, `KEY_SCOPES`). */
    scopes: text('scopes').array().notNull(),
    /** SHA-256 of the secret half. Never the secret. */
    secretHash: bytea('secret_hash').notNull(),
    /** The secret's last four characters, so a person can tell their keys apart. */
    hint: text('hint').notNull(),
    /** Who made it: the key's access never exceeds theirs, and it stops working when they leave. */
    createdByMemberId: uuid('created_by_member_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /** The last request it made, written at most once a minute. */
    lastUsedAt: timestamptz('last_used_at'),
    revokedAt: timestamptz('revoked_at'),
    revokedByMemberId: uuid('revoked_by_member_id'),
  },
  (t) => [
    primaryKey({ name: 'api_keys_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'api_keys_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }).onDelete(
      'cascade',
    ),
    foreignKey({
      name: 'api_keys_created_by',
      columns: [t.workspaceId, t.createdByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'api_keys_revoked_by',
      columns: [t.workspaceId, t.revokedByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    check('api_keys_name', sql`char_length(${t.name}) between 1 and 80`),
    check(
      'api_keys_scopes',
      sql`cardinality(${t.scopes}) between 1 and 2 and ${t.scopes} <@ array['data.read', 'data.write']::text[]`,
    ),
    check('api_keys_secret_hash', sql`octet_length(${t.secretHash}) = 32`),
    check('api_keys_hint', sql`char_length(${t.hint}) = 4`),
    check('api_keys_revoked', sql`(${t.revokedAt} is null) = (${t.revokedByMemberId} is null)`),
    // The list (newest first) and the 25 per workspace count.
    index('api_keys_list')
      .on(t.workspaceId, t.createdAt.desc())
      .where(sql`${t.revokedAt} is null`),
  ],
);
