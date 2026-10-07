// The identity store against a real Postgres, as the identity login (spec 0005):
// its reads, the directory write, and Better Auth running on its adapter, from
// an email code to a session.
import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '../client.ts';
import { createTestUser } from '../testing.ts';
import { addWorkspaceToDirectory } from './directory.ts';
import { createIdentityStore, type IdentityStore } from './store.ts';

const { appUrl, identityUrl } = inject('testDatabase');

let db: Database;
let identity: IdentityStore;
let identitySql: pg.Client;

beforeAll(async () => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-identity-tests' });
  identity = createIdentityStore({ url: identityUrl, applicationName: 'crm-identity-tests' });
  identitySql = new pg.Client({ connectionString: identityUrl });
  await identitySql.connect();
});

afterAll(async () => {
  await identitySql.end();
  await identity.close();
  await db.close();
});

const unique = () => randomUUID().slice(0, 8);

/** A workspace with a member for `userId`, listed in the directory, all in one transaction (as the engine does it). */
async function listedWorkspace(userId: string, slug = `ws-${unique()}`) {
  const workspaceId = randomUUID();
  const memberId = randomUUID();
  await db.withWorkspace(workspaceId, async (tx) => {
    await tx.execute(
      sql`insert into workspaces (id, name, slug, created_by_type, updated_by_type) values (${workspaceId}, ${slug}, ${slug}, 'system', 'system')`,
    );
    await tx.execute(
      sql`insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${memberId}, ${userId}, 'Ada', 'ada@example.com', 'owner', 'system', 'system')`,
    );
    await addWorkspaceToDirectory(tx, { workspaceId, slug, name: `Name ${slug}`, userId, memberId });
  });
  return { workspaceId, memberId, slug };
}

describe('the directory', () => {
  it('finds a workspace by its address, and nothing for an unknown one', async () => {
    const userId = await createTestUser(identityUrl, { email: `${unique()}@example.com` });
    const { workspaceId, slug } = await listedWorkspace(userId);
    expect(await identity.findWorkspace(slug)).toEqual({ id: workspaceId, slug, name: `Name ${slug}` });
    expect(await identity.findWorkspace(`missing-${unique()}`)).toBeUndefined();
  });

  it("lists a user's workspaces oldest first, and none of anyone else's", async () => {
    const userId = await createTestUser(identityUrl, { email: `${unique()}@example.com` });
    const other = await createTestUser(identityUrl, { email: `${unique()}@example.com` });
    const first = await listedWorkspace(userId);
    const second = await listedWorkspace(userId);
    await listedWorkspace(other);
    // The directory's created_at is the transaction's time; set them apart so the order is the point.
    await identitySql.query(
      `update auth.workspace_directory set created_at = now() - interval '1 day' where workspace_id = $1`,
      [first.workspaceId],
    );
    const listed = await identity.workspacesOf(userId);
    expect(listed.map((workspace) => workspace.id)).toEqual([first.workspaceId, second.workspaceId]);
    expect(await identity.workspacesOf(randomUUID())).toEqual([]);
    expect(await identity.workspacesOf('not-a-uuid')).toEqual([]);
  });

  it('never gives a slug out twice, even once the workspace stops using it', async () => {
    const userId = await createTestUser(identityUrl, { email: `${unique()}@example.com` });
    const { workspaceId, slug } = await listedWorkspace(userId);
    await db.withWorkspace(workspaceId, (tx) => tx.execute(sql`update workspaces set deleted_at = now()`));
    await expect(listedWorkspace(userId, slug)).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'workspace_directory_slug' },
    });
  });

  it('refuses an address outside the slug rule, and an email that is not lowercase', async () => {
    const userId = await createTestUser(identityUrl, { email: `${unique()}@example.com` });
    await expect(listedWorkspace(userId, `Ws-${unique()}`)).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'workspace_directory_slug_shape' },
    });
    await expect(createTestUser(identityUrl, { email: `Ada-${unique()}@Example.com` })).rejects.toMatchObject({
      code: '23514',
      constraint: 'user_email_lowercase',
    });
  });

  it('rolls the directory rows back with the transaction they were written in', async () => {
    const userId = await createTestUser(identityUrl, { email: `${unique()}@example.com` });
    const workspaceId = randomUUID();
    const slug = `ws-${unique()}`;
    await expect(
      db.withWorkspace(workspaceId, async (tx) => {
        await tx.execute(
          sql`insert into workspaces (id, name, slug, created_by_type, updated_by_type) values (${workspaceId}, 'x', ${slug}, 'system', 'system')`,
        );
        const memberId = randomUUID();
        await tx.execute(
          sql`insert into members (workspace_id, id, user_id, name, email, created_by_type, updated_by_type) values (${workspaceId}, ${memberId}, ${userId}, 'Ada', 'ada@example.com', 'system', 'system')`,
        );
        await addWorkspaceToDirectory(tx, { workspaceId, slug, name: 'x', userId, memberId });
        throw new Error('forced');
      }),
    ).rejects.toThrow('forced');
    expect(await identity.findWorkspace(slug)).toBeUndefined();
    expect(await identity.workspacesOf(userId)).toEqual([]);
  });
});

describe('users', () => {
  it('reads a user, and nothing for an unknown or malformed id', async () => {
    const email = `${unique()}@example.com`;
    const id = await createTestUser(identityUrl, { email, name: 'Grace Hopper' });
    expect(await identity.getUser(id)).toEqual({ id, name: 'Grace Hopper', email, emailVerified: true });
    expect(await identity.getUser(randomUUID())).toBeUndefined();
    expect(await identity.getUser('nope')).toBeUndefined();
  });

  it('fills in a name only while it is empty', async () => {
    const id = await createTestUser(identityUrl, { email: `${unique()}@example.com` });
    expect(await identity.setUserNameIfEmpty(id, '   ')).toBe(false);
    expect(await identity.setUserNameIfEmpty(id, '  Ada Lovelace ')).toBe(true);
    expect((await identity.getUser(id))?.name).toBe('Ada Lovelace');
    expect(await identity.setUserNameIfEmpty(id, 'Someone Else')).toBe(false);
    expect((await identity.getUser(id))?.name).toBe('Ada Lovelace');
  });
});

describe('Better Auth on the identity store', () => {
  const ORIGIN = 'http://localhost:5173';

  function createAuth(codes: Map<string, string>) {
    return betterAuth({
      baseURL: ORIGIN,
      secret: 'a-test-secret-that-is-long-enough-for-better-auth',
      database: identity.authDatabase(),
      advanced: { database: { generateId: 'uuid' } },
      rateLimit: { enabled: true, storage: 'database' },
      telemetry: { enabled: false },
      plugins: [
        emailOTP({
          otpLength: 6,
          expiresIn: 600,
          allowedAttempts: 5,
          storeOTP: 'hashed',
          sendVerificationOTP: ({ email, otp }) => {
            codes.set(email, otp);
            return Promise.resolve();
          },
        }),
      ],
    });
  }

  function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    return new Request(`${ORIGIN}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    });
  }

  it('signs a new email up by code into uuid ids, a hashed code, a session and a stored rate limit', async () => {
    const codes = new Map<string, string>();
    const auth = createAuth(codes);
    const email = `${unique()}@example.com`;

    const sent = await auth.handler(post('/email-otp/send-verification-otp', { email, type: 'sign-in' }));
    expect(sent.status).toBe(200);
    const code = codes.get(email);
    expect(code).toMatch(/^\d{6}$/);
    const stored = await identitySql.query<{ value: string }>(
      `select value from auth.verification where identifier like '%' || $1`,
      [email],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.value).not.toContain(code ?? '');

    const signedIn = await auth.handler(post('/sign-in/email-otp', { email, otp: code }));
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    expect(cookie).toContain('session_token');

    const session = await auth.handler(
      new Request(`${ORIGIN}/api/auth/get-session`, { headers: { cookie, origin: ORIGIN } }),
    );
    const body = (await session.json()) as { user: { id: string; email: string; name: string } };
    expect(body.user.email).toBe(email);
    expect(body.user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await identity.getUser(body.user.id)).toEqual({ id: body.user.id, name: '', email, emailVerified: true });

    const sessions = await identitySql.query('select 1 from auth.session where user_id = $1', [body.user.id]);
    expect(sessions.rowCount).toBe(1);
    const limits = await identitySql.query<{ count: number }>('select count(*)::int as count from auth.rate_limit');
    expect(limits.rows[0]?.count).toBeGreaterThan(0);
  });

  it('refuses a wrong code and signs nothing in', async () => {
    const codes = new Map<string, string>();
    const auth = createAuth(codes);
    const email = `${unique()}@example.com`;
    await auth.handler(post('/email-otp/send-verification-otp', { email, type: 'sign-in' }));
    const wrong = (codes.get(email) ?? '000000') === '000000' ? '111111' : '000000';
    const refused = await auth.handler(post('/sign-in/email-otp', { email, otp: wrong }));
    expect(refused.status).toBe(400);
    const users = await identitySql.query('select 1 from auth."user" where email = $1', [email]);
    expect(users.rowCount).toBe(0);
  });
});

describe('limits the auth library cannot key', () => {
  it('counts uses of a key in a fixed window, refuses past the limit, and opens again once it passes', async () => {
    const key = `email:${unique()}@example.com|send-code`;
    const rule = { window: 600, max: 2 };
    expect(await identity.consumeRateLimit(key, rule)).toEqual({ allowed: true, retryAfterSeconds: undefined });
    expect(await identity.consumeRateLimit(key, rule)).toEqual({ allowed: true, retryAfterSeconds: undefined });
    const refused = await identity.consumeRateLimit(key, rule);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(590);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(600);
    // Another key has its own count.
    expect((await identity.consumeRateLimit(`${key}-other`, rule)).allowed).toBe(true);
    // The window passes.
    await identitySql.query('update auth.rate_limit set last_request = last_request - 600001 where key = $1', [key]);
    expect(await identity.consumeRateLimit(key, rule)).toEqual({ allowed: true, retryAfterSeconds: undefined });
  });

  it("keeps a window longer than Better Auth's through its pruning", async () => {
    const key = `email:${unique()}@example.com|sign-in`;
    const rule = { window: 24 * 60 * 60, max: 1 };
    expect((await identity.consumeRateLimit(key, rule)).allowed).toBe(true);
    // Twenty minutes on, Better Auth prunes every row older than its longest window (ten minutes here).
    await identitySql.query('update auth.rate_limit set last_request = last_request - 1200000 where key = $1', [key]);
    await identitySql.query('delete from auth.rate_limit where last_request < $1', [Date.now() - 600_000]);
    const refused = await identity.consumeRateLimit(key, rule);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(24 * 60 * 60 - 1300);
  });

  it('holds the limit when uses arrive at once', async () => {
    const key = `email:${unique()}@example.com|send-code`;
    const decisions = await Promise.all(
      Array.from({ length: 8 }, () => identity.consumeRateLimit(key, { window: 600, max: 5 })),
    );
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
  });
});

describe('the identity login', () => {
  it('passes the role check as the identity login, and the app login fails it', async () => {
    await identity.assertIdentityRole();
    const asApp = createIdentityStore({ url: appUrl, applicationName: 'crm-identity-tests-app' });
    try {
      await expect(asApp.assertIdentityRole()).rejects.toThrow(/crm_app|crm_identity/);
      // And the app login can't use the store's reads at all.
      await expect(asApp.getUser(randomUUID())).rejects.toMatchObject({ cause: { code: '42501' } });
    } finally {
      await asApp.close();
    }
  });
});
