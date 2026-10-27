// A `FileStore` on the local disk, for `APP_ENV=local` only (27 Oct 2026): a laptop has no Vercel Blob token, and
// without a store a person's uploaded picture answers 503, so the feature can't be tried. The api refuses it
// anywhere but local (`app.ts`). Paths are the api's own minted ones; anything that could climb out of the folder is
// refused before the disk is touched.
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { FileStore } from './blob.ts';

/** A path the api mints: lowercase segments of letters, digits, dots, dashes and underscores. */
const SAFE_PATH = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9._-]*)*$/;

/** The content type kept beside a file, since the disk keeps none. */
const TYPE_SUFFIX = '.type';

/** The file store on `root`, a folder made on first write. */
export function createDiskFileStore(root: string): FileStore {
  const base = resolve(root);
  const fileOf = (pathname: string): string => {
    if (!SAFE_PATH.test(pathname) || pathname.split('/').includes('..')) {
      throw new Error('That isn’t a path the store keeps.');
    }
    const full = resolve(join(base, pathname));
    if (!full.startsWith(`${base}${sep}`)) throw new Error('That isn’t a path the store keeps.');
    return full;
  };
  const read = async (pathname: string) => {
    const full = fileOf(pathname);
    const found = await stat(full).catch(() => undefined);
    if (found === undefined || !found.isFile()) return undefined;
    const bytes = new Uint8Array(await readFile(full));
    const contentType = await readFile(`${full}${TYPE_SUFFIX}`, 'utf8').catch(() => 'application/octet-stream');
    return { bytes, contentType };
  };
  const write = async (pathname: string, body: Uint8Array, contentType: string) => {
    const full = fileOf(pathname);
    const there = await stat(full).catch(() => undefined);
    // As the Blob store: never overwriting.
    if (there !== undefined) throw new Error('A file is already stored there.');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
    await writeFile(`${full}${TYPE_SUFFIX}`, contentType);
  };
  return {
    put: write,
    async get(pathname) {
      const found = await read(pathname);
      if (found === undefined) return undefined;
      return {
        stream: new Blob([found.bytes]).stream(),
        size: found.bytes.byteLength,
        contentType: found.contentType,
      };
    },
    async copy(from, to) {
      const found = await read(from);
      if (found === undefined) throw new Error('The file to copy is no longer stored.');
      await write(to, found.bytes, found.contentType);
    },
    async remove(pathnames) {
      await Promise.all(
        pathnames.map(async (pathname) => {
          const full = fileOf(pathname);
          await rm(full, { force: true });
          await rm(`${full}${TYPE_SUFFIX}`, { force: true });
        }),
      );
    },
  };
}
