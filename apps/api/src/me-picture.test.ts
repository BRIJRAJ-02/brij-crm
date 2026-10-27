// The person's own picture routes (27 Oct 2026), with a fake session, identity store and file store, so no database
// is needed: an upload is taken only from a session, only as a JPEG, PNG or WebP whose first bytes say so and under
// the ceiling, is kept under the person's own id, replaces their picture and drops their older upload; and the read
// answers only the current version.
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '@crm/contracts';
import { errorStatus } from '@crm/contracts';
import type { Auth } from './auth/auth.ts';
import { createMemoryLimiter } from './limits.ts';
import { mountMyPicture } from './me-picture.ts';
import { createPictureLoader, type PictureFetch } from './public/picture.ts';
import type { FileStore } from './storage/blob.ts';

const USER = '01a17d71-1ebc-7ae4-986b-7879179e331a';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

/** A store in memory. */
function memoryStore(): FileStore & { readonly kept: Map<string, { bytes: Uint8Array; type: string }> } {
  const kept = new Map<string, { bytes: Uint8Array; type: string }>();
  return {
    kept,
    put(path, body, contentType) {
      if (kept.has(path)) return Promise.reject(new Error('exists'));
      kept.set(path, { bytes: body, type: contentType });
      return Promise.resolve();
    },
    get(path) {
      const found = kept.get(path);
      return Promise.resolve(
        found === undefined
          ? undefined
          : { stream: new Blob([found.bytes]).stream(), size: found.bytes.byteLength, contentType: found.type },
      );
    },
    copy: () => Promise.reject(new Error('unused')),
    remove(paths) {
      for (const path of paths) kept.delete(path);
      return Promise.resolve();
    },
  };
}

/** The routes over fakes: `signedIn` false answers no session; the person's picture lives in `account.image`. */
function setUp({ signedIn = true, withStore = true } = {}) {
  // A flag, not `files = …`: a default would stand in for an `undefined` passed on purpose.
  const files = withStore ? memoryStore() : undefined;
  const account: { image: string | undefined } = { image: undefined };
  const auth = {
    session: () =>
      Promise.resolve(signedIn ? { user: { id: USER, image: account.image ?? null }, setCookies: [] } : undefined),
  } as unknown as Auth;
  const noGoogle: PictureFetch = () => Promise.resolve({ ok: false, reason: 'url' });
  const app = new Hono<{
    Variables: { requestId: string; clientIp: string | undefined; origin: string | undefined };
  }>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'test');
    c.set('clientIp', undefined);
    c.set('origin', undefined);
    await next();
  });
  mountMyPicture(app, {
    auth,
    identity: {
      setUserImageFromUpload: (_id, image) => {
        const previous = account.image;
        account.image = image;
        return Promise.resolve({ saved: true as const, previous });
      },
    },
    files,
    load: createPictureLoader(noGoogle, files),
    limiter: createMemoryLimiter(),
    errorResponse: (code: ErrorCode, message: string) =>
      Response.json({ code, message }, { status: errorStatus(code) }),
  });
  const upload = (type: string, body: Uint8Array) =>
    app.request('/me/picture', { method: 'POST', headers: { 'content-type': type }, body });
  return { app, account, files, upload };
}

describe('uploading your own picture', () => {
  it('keeps a JPEG under your own id, makes it your picture, and answers its path', async () => {
    const { account, files, upload } = setUp();
    const answer = await upload('image/jpeg', JPEG);
    expect(answer.status).toBe(200);
    const { image } = (await answer.json()) as { image: string };
    expect(image).toMatch(/^\/api\/me\/picture\?v=[0-9a-f]{12}$/);
    expect(account.image).toMatch(new RegExp(`^stored:pictures/${USER}/[0-9a-f-]{36}\\.jpg$`));
    expect([...(files?.kept.keys() ?? [])]).toEqual([account.image?.slice('stored:'.length)]);
  });

  it('drops your older upload once the new one is yours', async () => {
    const { files, upload } = setUp();
    await upload('image/jpeg', JPEG);
    await upload('image/png', PNG);
    const kept = [...(files?.kept.keys() ?? [])];
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatch(/\.png$/);
  });

  it('refuses without a session', async () => {
    const { upload } = setUp({ signedIn: false });
    expect((await upload('image/jpeg', JPEG)).status).toBe(401);
  });

  it('refuses a type it doesn’t take, and a file whose bytes aren’t what it says', async () => {
    const { files, upload } = setUp();
    expect((await upload('image/svg+xml', new TextEncoder().encode('<svg/>'))).status).toBe(400);
    expect((await upload('image/gif', new Uint8Array([0x47, 0x49, 0x46, 0x38]))).status).toBe(400);
    expect((await upload('image/png', new TextEncoder().encode('<html>'))).status).toBe(400);
    expect((await upload('image/jpeg', new Uint8Array(0))).status).toBe(400);
    expect(files?.kept.size).toBe(0);
  });

  it('refuses past the ceiling', async () => {
    const { upload } = setUp();
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(JPEG);
    expect((await upload('image/jpeg', big)).status).toBe(413);
  });

  it('says so where there is no store to keep it in', async () => {
    const { upload } = setUp({ withStore: false });
    expect((await upload('image/jpeg', JPEG)).status).toBe(503);
  });
});

describe('reading your own picture', () => {
  it('answers the current version, checked again on the way out, and nothing else', async () => {
    const { app, upload } = setUp();
    const { image } = (await (await upload('image/jpeg', JPEG)).json()) as { image: string };
    const read = await app.request(image.replace('/api', ''));
    expect(read.status).toBe(200);
    expect(read.headers.get('content-type')).toBe('image/jpeg');
    expect(read.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await app.request('/me/picture?v=000000000000')).status).toBe(404);
  });

  it('answers nothing for a stored file whose bytes no longer match its type', async () => {
    const { app, files, upload } = setUp();
    const { image } = (await (await upload('image/jpeg', JPEG)).json()) as { image: string };
    const [path] = [...(files?.kept.keys() ?? [])];
    if (path !== undefined) files?.kept.set(path, { bytes: new TextEncoder().encode('<html>'), type: 'image/jpeg' });
    expect((await app.request(image.replace('/api', ''))).status).toBe(404);
  });
});
