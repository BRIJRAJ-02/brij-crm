// Ids the browser mints (spec 0005): a new workspace's id, and from milestone
// 2 every record and mutation id. UUID v7: 48 bits of Unix milliseconds, then
// random bits, so ids sort by creation time like the server's own.

/** What minting needs: the clock, and the browser's cryptographic random source. */
export interface IdSources {
  /** Unix milliseconds now. */
  readonly now: () => number;
  /** Fills the array with cryptographically strong random bytes (`crypto.getRandomValues`). */
  readonly fill: (bytes: Uint8Array<ArrayBuffer>) => void;
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Makes a UUID v7 minter (RFC 9562): the timestamp in the first six bytes,
 * the version (7) and the variant (10) set, and the rest random. Pass it to
 * the data layer as `mintId`.
 */
export function createIdMinter({ now, fill }: IdSources): () => string {
  return () => {
    const bytes = new Uint8Array(16);
    fill(bytes.subarray(6));
    const ms = Math.max(0, Math.floor(now()));
    // Six bytes of milliseconds, most significant first (48 bits fit in a double exactly).
    for (let index = 5, rest = ms; index >= 0; index -= 1, rest = Math.floor(rest / 256)) {
      bytes[index] = rest % 256;
    }
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const text = hex(bytes);
    return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
  };
}
