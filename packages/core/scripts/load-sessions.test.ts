// Minted sessions (spec 0011, AC-196, AC-212): the cookie signer against an
// independent WebCrypto signature (Better Auth's own way), the secret check,
// and the rows written to a real Postgres. apps/api's minted-session test
// proves the API accepts the cookie.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { newId } from '../src/index.ts';
import { isLoadRefusal } from './load-local.ts';
import {
  assertLoadSecret,
  LOAD_AUTH_SECRET,
  mintSessions,
  newSessionToken,
  SESSION_COOKIE,
  signSessionCookie,
} from './load-sessions.ts';

const { ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: ownerUrl, applicationName: 'crm-load-sessions-tests' });
});
afterAll(async () => {
  await db.close();
});

/** HMAC SHA-256 in standard base64 through WebCrypto, as Better Auth's cookie signer computes it. */
async function webCryptoSignature(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...signature));
}

function refusalCode(work: () => unknown): number | undefined {
  try {
    work();
  } catch (error) {
    if (isLoadRefusal(error)) return error.exitCode;
    throw error;
  }
  return undefined;
}

describe('the session cookie', () => {
  it('is the token and its signature, URL encoded, under Better Auth’s cookie name', async () => {
    const token = newSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const signature = await webCryptoSignature(token, LOAD_AUTH_SECRET);
    expect(signSessionCookie(token, LOAD_AUTH_SECRET)).toBe(
      `${SESSION_COOKIE}=${encodeURIComponent(`${token}.${signature}`)}`,
    );
  });

  it('is signed only with the load stack’s local-only secret', () => {
    expect(LOAD_AUTH_SECRET).toContain('local-only');
    expect(refusalCode(() => assertLoadSecret(LOAD_AUTH_SECRET))).toBeUndefined();
    expect(refusalCode(() => assertLoadSecret('a-production-secret-that-is-long-enough-to-pass'))).toBe(3);
  });
});

describe('mintSessions', () => {
  async function newUser(): Promise<string> {
    const [row] = await testQuery<{ id: string }>(
      ownerUrl,
      `insert into auth."user" (email, name, email_verified) values ($1, 'Load', true) returning id::text`,
      [`${randomUUID()}@example.com`],
    );
    return row?.id ?? '';
  }

  it('writes one 30 day session per user, whose token the cookie carries', async () => {
    const users = [
      { n: 1, userId: await newUser() },
      { n: 2, userId: await newUser() },
    ];
    const cookies = await mintSessions(db, { workspaceId: newId(), users, secret: LOAD_AUTH_SECRET });
    for (const user of users) {
      const rows = await testQuery<{ token: string; days: string }>(
        ownerUrl,
        `select token, round(extract(epoch from expires_at - now()) / 86400) as days from auth.session where user_id = $1`,
        [user.userId],
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]?.days)).toBe(30);
      expect(cookies[String(user.n)]).toBe(signSessionCookie(rows[0]?.token ?? '', LOAD_AUTH_SECRET));
    }
  });

  it('replaces a user’s sessions when minted again', async () => {
    const users = [{ n: 1, userId: await newUser() }];
    const first = await mintSessions(db, { workspaceId: newId(), users, secret: LOAD_AUTH_SECRET });
    const second = await mintSessions(db, { workspaceId: newId(), users, secret: LOAD_AUTH_SECRET });
    expect(second['1']).not.toBe(first['1']);
    const rows = await testQuery(ownerUrl, 'select 1 from auth.session where user_id = $1', [users[0]?.userId]);
    expect(rows).toHaveLength(1);
  });

  it('refuses any other secret before writing anything', async () => {
    const users = [{ n: 1, userId: await newUser() }];
    const refused: unknown = await mintSessions(db, {
      workspaceId: newId(),
      users,
      secret: 'local-only-but-not-the-load-stack-secret',
    }).catch((error: unknown) => error);
    expect(isLoadRefusal(refused) && refused.exitCode === 3).toBe(true);
    expect(await testQuery(ownerUrl, 'select 1 from auth.session where user_id = $1', [users[0]?.userId])).toEqual([]);
  });
});
