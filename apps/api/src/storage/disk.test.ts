// The local disk's file store (27 Oct 2026), for a laptop with no Blob token: it keeps, reads, copies and removes as
// the Blob store does, never overwrites, and refuses any path that could climb out of its folder before it touches
// the disk.
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDiskFileStore } from './disk.ts';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'crm-disk-test-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const bytes = (text: string) => new TextEncoder().encode(text);
const text = async (stream: ReadableStream<Uint8Array>) => new Response(stream).text();

describe('the disk file store', () => {
  it('keeps a file with its type, and reads it back', async () => {
    const store = createDiskFileStore(root);
    await store.put('pictures/a/b.jpg', bytes('hello'), 'image/jpeg');
    const found = await store.get('pictures/a/b.jpg');
    expect(found?.size).toBe(5);
    expect(found?.contentType).toBe('image/jpeg');
    expect(found === undefined ? undefined : await text(found.stream)).toBe('hello');
  });

  it('answers nothing for a file it doesn’t keep', async () => {
    expect(await createDiskFileStore(root).get('pictures/a/missing.jpg')).toBeUndefined();
  });

  it('never overwrites, as the Blob store doesn’t', async () => {
    const store = createDiskFileStore(root);
    await store.put('pictures/a/b.jpg', bytes('first'), 'image/jpeg');
    await expect(store.put('pictures/a/b.jpg', bytes('second'), 'image/jpeg')).rejects.toThrow();
    const found = await store.get('pictures/a/b.jpg');
    expect(found === undefined ? undefined : await text(found.stream)).toBe('first');
  });

  it('copies, and removes what it was asked to, a missing one included', async () => {
    const store = createDiskFileStore(root);
    await store.put('pictures/a/b.jpg', bytes('x'), 'image/jpeg');
    await store.copy('pictures/a/b.jpg', 'pictures/a/c.jpg');
    expect(await store.get('pictures/a/c.jpg')).toBeDefined();
    await store.remove(['pictures/a/b.jpg', 'pictures/a/c.jpg', 'pictures/a/never.jpg']);
    expect(await store.get('pictures/a/b.jpg')).toBeUndefined();
    expect(await store.get('pictures/a/c.jpg')).toBeUndefined();
  });

  it('refuses a path that could climb out of its folder, before the disk is touched', async () => {
    const store = createDiskFileStore(root);
    const climbing = ['../escape.jpg', 'pictures/../../escape.jpg', '/etc/passwd', 'pictures//b.jpg', 'Pictures/B.jpg'];
    for (const path of climbing) {
      await expect(store.put(path, bytes('x'), 'image/jpeg')).rejects.toThrow();
      await expect(store.get(path)).rejects.toThrow();
    }
    // Nothing was written anywhere, inside the folder or beside it.
    expect(await readdir(root)).toEqual([]);
  });
});
