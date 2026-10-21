// A member's email preferences (the emails lane): which topics of optional
// email they get (`EMAIL_TOPICS`, one list in `@crm/contracts/emails`). A
// topic with no row is on. Reached from an email's preferences link, whose
// signed token the door turns into the member's narrow scope
// (`enterEmailLink`), so the page needs no sign in and can change nothing
// but these choices.
import { sql } from 'drizzle-orm';
import {
  EMAIL_TOPICS,
  type EmailPreference,
  type EmailPreferenceChange,
  type EmailPreferencesView,
  type EmailTopic,
} from '@crm/contracts/emails';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { signValue, verifyValue } from '../calendar/signing.ts';

/** How long a preferences link works: a year from the email it came in. */
export const EMAIL_LINK_DAYS = 365;

/**
 * What a link's token opens, each signed under its own version (a token
 * made for one never reads as the other): `page`, the member's preferences
 * page (read and change every topic), and `unsubscribe`, the one click,
 * which only turns its own topic off. The one click's address sits in a
 * query, so request logs hold it; the page's sits in a fragment.
 */
export type EmailLinkPurpose = 'page' | 'unsubscribe';

const VERSIONS: Readonly<Record<EmailLinkPurpose, string>> = { page: 'ep1', unsubscribe: 'eu1' };

/** What a preferences link names: the workspace, the member, and the topic of the email it came in. */
export interface EmailLink {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly topic: EmailTopic;
}

/** The key preferences links are signed with: 32 bytes the api and the worker share, passed in, never read here. */
export type EmailLinkKey = Uint8Array;

/**
 * A link's token for `purpose`, dated by the email it goes in (`issuedAt`),
 * so drawing the same email again (a retry) makes the same token, and the
 * mail service's idempotency key sees the same email.
 */
export function emailLinkToken(
  key: EmailLinkKey,
  link: EmailLink,
  issuedAt: Date,
  purpose: EmailLinkPurpose = 'page',
): string {
  return signValue(
    key,
    VERSIONS[purpose],
    { w: link.workspaceId, m: link.memberId, t: link.topic },
    EMAIL_LINK_DAYS * 86_400,
    issuedAt,
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The link a token for `purpose` names, or undefined for anything not ours,
 * made for the other purpose, expired or malformed. Never throws.
 */
export function readEmailLinkToken(
  key: EmailLinkKey,
  token: string | undefined,
  now: Date = new Date(),
  purpose: EmailLinkPurpose = 'page',
): EmailLink | undefined {
  const payload = verifyValue(key, VERSIONS[purpose], token, now);
  if (payload === undefined) return undefined;
  const { w, m, t } = payload;
  if (typeof w !== 'string' || typeof m !== 'string' || !UUID.test(w) || !UUID.test(m)) return undefined;
  if (typeof t !== 'string' || !(EMAIL_TOPICS as readonly string[]).includes(t)) return undefined;
  return { workspaceId: w, memberId: m, topic: t as EmailTopic };
}

/**
 * The member whose choices a scope may read and set: an email link's member,
 * or a signed in member's own (a later settings page). Anything else is
 * refused, and how they came is kept with the choice.
 */
function memberOf(scope: EngineScope): { readonly memberId: string; readonly via: 'email_link' | 'app' } {
  const { principal } = scope.access;
  if (principal.kind === 'email_link') return { memberId: principal.memberId, via: 'email_link' };
  if (principal.kind === 'member') return { memberId: principal.memberId, via: 'app' };
  throw new Error('Email preferences belong to a member.');
}

/** The member's choice for every topic (a topic with no row is on), and the workspace they're in. */
export async function readEmailPreferences(scope: EngineScope, topic: EmailTopic): Promise<EmailPreferencesView> {
  const { memberId } = memberOf(scope);
  return inWorkspace(scope, async (tx) => {
    const workspace = await tx.execute<{ name: string }>(sql`select name from workspaces`);
    const rows = await tx.execute<{ topic: string; subscribed: boolean }>(sql`
      select topic, subscribed from email_preferences where member_id = ${memberId}::uuid
    `);
    const chosen = new Map(rows.rows.map((row) => [row.topic, row.subscribed]));
    const preferences: EmailPreference[] = EMAIL_TOPICS.map((each) => ({
      topic: each,
      subscribed: chosen.get(each) ?? true,
    }));
    return { workspaceName: workspace.rows[0]?.name ?? '', topic, preferences };
  });
}

/** Turns one topic on or off for the scope's member, and answers every topic as it now stands. */
export async function setEmailPreference(
  scope: EngineScope,
  change: EmailPreferenceChange,
  topic: EmailTopic,
): Promise<EmailPreferencesView> {
  const { memberId, via } = memberOf(scope);
  await inWorkspace(scope, (tx) =>
    tx.execute(sql`
      insert into email_preferences (workspace_id, member_id, topic, subscribed, updated_via)
      values (
        nullif(current_setting('app.workspace_id', true), '')::uuid, ${memberId}::uuid, ${change.topic},
        ${change.subscribed}, ${via}
      )
      on conflict (workspace_id, member_id, topic) do update
        set subscribed = excluded.subscribed, updated_via = excluded.updated_via, updated_at = now()
    `),
  );
  return readEmailPreferences(scope, topic);
}
