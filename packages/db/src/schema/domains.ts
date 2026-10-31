// Custom domains for link pages (spec 0064, slice 1, migration 0145). One row per host a person asked for, tied to
// their link page in one workspace (until spec 0064's lane P1 gives a page its own id, a page is its person and
// workspace). The host serves anything only once its TXT token was found (`verified_at`) and Vercel reports it
// configured (`status = 'live'`); the policies, the lookups (`crm_live_domain_handle`, `crm_domain_host_bound`) and
// the queue function (`crm_enqueue_domain_check`) are hand written in the migration.
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamptz, workspaceId } from './common.ts';
import { members } from './workspaces.ts';

/** A custom domain a person asked for, its DNS proof, and how its last check went. */
export const publicDomains = pgTable(
  'public_domains',
  {
    workspaceId: workspaceId(),
    id: id(),
    /** The member whose link page it serves. */
    memberId: uuid('member_id').notNull(),
    /** Their sign in identity, which keys their link page in `auth.public_profiles`. */
    userId: uuid('user_id').notNull(),
    /** Lowercase, punycode, no port and no path (`normaliseHost` in core). */
    host: text('host').notNull(),
    /** `apex` (`janedoe.com`, with `www` redirected beside it) or `subdomain` (`book.janedoe.com`). */
    kind: text('kind').notNull(),
    /** `waiting`, `checking`, `live`, `attention`, `failed` or `removed`. */
    status: text('status').notNull().default('waiting'),
    /** 32 hex characters, the value of the `_timefix.<host>` TXT record that proves ownership. */
    verifyToken: text('verify_token').notNull(),
    /** The records Vercel asked for, as last read. */
    dnsRecords: jsonb('dns_records')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The one line Needs attention shows. */
    problem: text('problem'),
    /** When it started waiting for its TXT record: seven days on with none, it fails (AC-6408). */
    waitingSince: timestamptz('waiting_since').notNull().defaultNow(),
    verifiedAt: timestamptz('verified_at'),
    liveAt: timestamptz('live_at'),
    lastCheckedAt: timestamptz('last_checked_at'),
    removedAt: timestamptz('removed_at'),
    /** When a removed domain left the Vercel project. */
    detachedAt: timestamptz('detached_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'public_domains_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'public_domains_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    // One domain per link page, not counting removed ones.
    uniqueIndex('public_domains_one_per_page')
      .on(t.workspaceId, t.userId)
      .where(sql`${t.status} <> 'removed'`),
    index('public_domains_by_member').on(t.workspaceId, t.memberId),
    // A proved host belongs to one page everywhere, so it is unique across workspaces (read only by the lookups).
    uniqueIndex('public_domains_host_bound')
      .on(t.host)
      .where(sql`${t.verifiedAt} is not null and ${t.status} <> 'removed'`),
    check(
      'public_domains_host',
      sql`char_length(${t.host}) between 4 and 253 and ${t.host} ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'`,
    ),
    check('public_domains_kind', sql`${t.kind} in ('apex', 'subdomain')`),
    check(
      'public_domains_status',
      sql`${t.status} in ('waiting', 'checking', 'live', 'attention', 'failed', 'removed')`,
    ),
    check('public_domains_token', sql`${t.verifyToken} ~ '^[0-9a-f]{32}$'`),
    check(
      'public_domains_records',
      sql`jsonb_typeof(${t.dnsRecords}) = 'array' and pg_column_size(${t.dnsRecords}) <= 8192`,
    ),
    check('public_domains_problem', sql`char_length(${t.problem}) <= 200`),
    check('public_domains_removed', sql`(${t.status} = 'removed') = (${t.removedAt} is not null)`),
  ],
);
