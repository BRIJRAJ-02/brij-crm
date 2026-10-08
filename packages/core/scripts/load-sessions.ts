// Minted sessions for the load harness (spec 0011, AC-196): one Better Auth
// `session` row per seeded user, written as the owner login on the load
// database, and each user's signed cookie, so 1,000 users cost a seed step
// instead of 1,000 email codes. Sessions are minted, never signed in.
//
// The only place in the codebase that mints a session. It signs only with the
// load stack's fixed `local-only` secret (which the API refuses outside
// local), and its command refuses any host but localhost, so production never
// gains a way to mint one. `pnpm load:sessions` mints them again when they
// expire; `pnpm load:seed` runs it after seeding. A test in apps/api proves
// the API accepts a minted cookie, so a Better Auth upgrade that changes the
// format fails that test, not a run.
import { createHmac, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import type { LoadSessions } from './load-files.ts';
import { readManifest, writeSessions } from './load-files.ts';
import { LOAD_DIR, LOAD_STACK, loadRefusal, loadUrls, runLoadCommand } from './load-local.ts';

/** Better Auth's session cookie, as the API sets it locally (no `__Secure-` prefix: local cookies aren't Secure). */
export const SESSION_COOKIE = 'better-auth.session_token';
/** How long a minted session lasts, as long as a signed in one (the API's `session.expiresIn`). */
export const SESSION_DAYS = 30;
/** The only secret sessions are minted with: the load stack's `BETTER_AUTH_SECRET`. */
export const LOAD_AUTH_SECRET = LOAD_STACK.betterAuthSecret;

/** A new session token: 32 random bytes, base64url. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The `Cookie` header a signed in browser sends for `token`: Better Auth's
 * signed cookie, `<token>.<signature>` with the signature an HMAC SHA-256 of
 * the token under `secret` in standard base64, the whole value URL encoded.
 */
export function signSessionCookie(token: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(token).digest('base64');
  return `${SESSION_COOKIE}=${encodeURIComponent(`${token}.${signature}`)}`;
}

/** Refuses (exit 3) any secret but the load stack's fixed `local-only` one. */
export function assertLoadSecret(secret: string): void {
  if (secret !== LOAD_AUTH_SECRET) {
    throw loadRefusal(
      'Refusing to mint sessions with that secret: only the load stack’s fixed local-only BETTER_AUTH_SECRET may sign them.',
    );
  }
}

/** One user to mint a session for: its number in the seed and its `auth.user` id. */
export interface MintUser {
  readonly n: number;
  readonly userId: string;
}

/**
 * Replaces each user's sessions with one fresh session row (a random token,
 * expiring in 30 days), writing through `db` (the owner login on the load
 * database), and returns each user's cookie header by user number. Refuses
 * (exit 3) any secret but the load stack's.
 */
export async function mintSessions(
  db: Database,
  input: { readonly workspaceId: string; readonly users: readonly MintUser[]; readonly secret: string },
): Promise<Readonly<Record<string, string>>> {
  assertLoadSecret(input.secret);
  const minted = input.users.map((user) => ({ ...user, token: newSessionToken() }));
  const array = (items: readonly string[]) => `{${items.join(',')}}`;
  await db.withWorkspace(input.workspaceId, async (tx) => {
    await tx.execute(
      sql`delete from auth.session where user_id = any(${array(minted.map((user) => user.userId))}::uuid[])`,
    );
    await tx.execute(sql`
      insert into auth.session (token, user_id, expires_at)
      select token, user_id, now() + make_interval(days => ${SESSION_DAYS}::int)
      from unnest(${array(minted.map((user) => user.token))}::text[], ${array(minted.map((user) => user.userId))}::uuid[])
        as s(token, user_id)
    `);
  });
  return Object.fromEntries(minted.map((user) => [String(user.n), signSessionCookie(user.token, input.secret)]));
}

/** `pnpm load:sessions`: mints every seeded user's session again and rewrites `.load/sessions.json`. */
export async function mintLoadSessions(env: Readonly<Record<string, string | undefined>>): Promise<string> {
  const urls = loadUrls(env);
  const secret = env.LOAD_BETTER_AUTH_SECRET ?? LOAD_AUTH_SECRET;
  assertLoadSecret(secret);
  const manifest = await readManifest(LOAD_DIR);
  const db = createDatabase({ url: urls.LOAD_DATABASE_URL_OWNER, applicationName: 'crm-load-sessions' });
  try {
    const sessions = await mintSessions(db, { workspaceId: manifest.workspaceId, users: manifest.users, secret });
    const file: LoadSessions = { apiUrl: urls.LOAD_API_URL, mintedAt: new Date().toISOString(), sessions };
    return await writeSessions(LOAD_DIR, file);
  } finally {
    await db.close();
  }
}

if (import.meta.main) {
  await runLoadCommand(async () => {
    const path = await mintLoadSessions(process.env);
    console.log(`Minted a session for every seeded user: ${path}`);
  });
}
