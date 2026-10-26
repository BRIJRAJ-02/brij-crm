// The one place that imports Vercel Blob (#32): the private store `brij-crm-forms` that holds the files visitors upload
// to public forms. Everything else takes the small `FileStore` below, so a test passes an in memory one and no other
// module learns the vendor's shapes. Every object is private: a read goes through the api, which checks the member
// first, and nothing here hands out a URL.
import { del, get, put } from '@vercel/blob';

/** A file read back from the store: its bytes as a stream, and what the store knows of it. */
export interface StoredFile {
  readonly stream: ReadableStream<Uint8Array>;
  readonly size: number;
  readonly contentType: string;
}

/** What the api needs of file storage. */
export interface FileStore {
  /** Stores `body` under `pathname` (never overwriting, never adding a suffix), private. */
  put(pathname: string, body: Uint8Array, contentType: string): Promise<void>;
  /** The file at `pathname`, or undefined when there is none. */
  get(pathname: string): Promise<StoredFile | undefined>;
  /** Deletes files by pathname; one already gone is not an error. */
  remove(pathnames: readonly string[]): Promise<void>;
}

/** The file store over Vercel Blob, signed with the store's read write token. */
export function createFileStore(token: string): FileStore {
  return {
    async put(pathname, body, contentType) {
      await put(pathname, Buffer.from(body), {
        access: 'private',
        token,
        contentType,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
    },
    async get(pathname) {
      const found = await get(pathname, { access: 'private', token });
      if (found === null || found.statusCode !== 200) return undefined;
      return { stream: found.stream, size: found.blob.size, contentType: found.blob.contentType };
    },
    async remove(pathnames) {
      if (pathnames.length === 0) return;
      await del([...pathnames], { token });
    },
  };
}
