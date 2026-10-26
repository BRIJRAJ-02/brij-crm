// File answers on public forms (spec 0023, #32): what a visitor may upload, how a file's name is made safe,
// and how the server checks that a file is what it says it is. Plain TypeScript with no Zod and no I/O: the hosted
// page's bundle carries the limits (so it can refuse a file before sending it) and the server enforces the same ones.

/**
 * The most bytes a form accepts in one file: 4 MiB. The api runs as a Vercel Function, whose request body is capped
 * at 4.5 MB, so the file goes through the api rather than straight to storage; a larger limit needs direct uploads.
 */
export const FORM_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** One file type a form takes: its MIME type, the extensions it may carry and how the server recognises its bytes. */
export interface UploadType {
  readonly contentType: string;
  /** Lowercase extensions with no dot; the first is the one a file is stored under. */
  readonly extensions: readonly string[];
  /** How the first bytes are checked: a signature the file starts with, or `text` (no binary bytes). */
  readonly sniff: 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'zip' | 'ole' | 'text';
}

/**
 * What a public form accepts, and nothing else. No SVG, HTML or script: a file a browser would run is refused,
 * and a download is always sent as an attachment besides.
 */
export const FORM_UPLOAD_TYPES: readonly UploadType[] = [
  { contentType: 'application/pdf', extensions: ['pdf'], sniff: 'pdf' },
  { contentType: 'image/png', extensions: ['png'], sniff: 'png' },
  { contentType: 'image/jpeg', extensions: ['jpg', 'jpeg'], sniff: 'jpeg' },
  { contentType: 'image/gif', extensions: ['gif'], sniff: 'gif' },
  { contentType: 'image/webp', extensions: ['webp'], sniff: 'webp' },
  { contentType: 'text/plain', extensions: ['txt'], sniff: 'text' },
  { contentType: 'text/csv', extensions: ['csv'], sniff: 'text' },
  { contentType: 'application/msword', extensions: ['doc'], sniff: 'ole' },
  {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'],
    sniff: 'zip',
  },
  { contentType: 'application/vnd.ms-excel', extensions: ['xls'], sniff: 'ole' },
  {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['xlsx'],
    sniff: 'zip',
  },
];

/** The `accept` list a file picker is given: every extension a form takes, with its dot. */
export const FORM_UPLOAD_ACCEPT: readonly string[] = FORM_UPLOAD_TYPES.flatMap((type) =>
  type.extensions.map((extension) => `.${extension}`),
);

/** The type entry for a MIME type (parameters such as `; charset=utf-8` ignored), or undefined when none is taken. */
export function uploadTypeOf(contentType: string): UploadType | undefined {
  const bare = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  return FORM_UPLOAD_TYPES.find((type) => type.contentType === bare);
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean =>
  bytes.length >= at + signature.length && signature.every((byte, index) => bytes[at + index] === byte);

/**
 * Whether `head` (a file's first bytes, at least its first 4 KB where it has them) is what `type` says: a PDF starts
 * `%PDF`, a PNG with its eight byte signature, and so on; text holds no NUL byte. A file that claims one type and
 * is another is refused, so a script renamed `.pdf` is never kept as a PDF.
 */
export function matchesContent(type: UploadType, head: Uint8Array): boolean {
  switch (type.sniff) {
    case 'pdf':
      // Readers accept the header within the first kilobyte.
      return head.subarray(0, 1_024).indexOf(0x25) !== -1 && startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case 'png':
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpeg':
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case 'gif':
      return startsWith(head, [0x47, 0x49, 0x46, 0x38]);
    case 'webp':
      return startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8);
    case 'zip':
      return startsWith(head, [0x50, 0x4b, 0x03, 0x04]);
    case 'ole':
      return startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'text':
      return head.length > 0 && !head.subarray(0, 4_096).includes(0);
  }
}

/** The extension of a file name, lowercase with no dot, or an empty string. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

// Control characters, and the characters that reorder or hide text (bidi overrides, zero width marks): a name
// drawn in the CRM must read as it is.
function isUnsafeChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}
const NAME_MAX = 120;

/**
 * A file name safe to keep and to draw: Unicode normalised, no path (everything up to the last slash or backslash
 * goes), no control or direction-changing characters, no leading dots, runs of space collapsed, and at most 120
 * characters with the extension kept. The extension is then made one `type` takes: a name whose extension is
 * another one's gets the type's own. Never empty.
 */
export function sanitiseFileName(raw: string, type: UploadType): string {
  const base = raw.normalize('NFKC').split(/[\\/]/u).pop() ?? '';
  const cleaned = Array.from(base)
    .filter((char) => !isUnsafeChar(char))
    .join('')
    .replace(/[<>:"|?*]/gu, '_')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\.+/u, '');
  const extension = extensionOf(cleaned);
  const keep = type.extensions.includes(extension) ? extension : (type.extensions[0] ?? '');
  const stem = (extension === '' ? cleaned : cleaned.slice(0, -(extension.length + 1))).trim().replace(/\.+$/u, '');
  const room = NAME_MAX - keep.length - 1;
  const shortStem = Array.from(stem === '' ? 'file' : stem)
    .slice(0, room)
    .join('')
    .trim();
  return `${shortStem === '' ? 'file' : shortStem}.${keep}`;
}

/** The stored name of an upload: its id and the extension of its type, never anything the visitor typed. */
export function storedNameOf(id: string, type: UploadType): string {
  return `${id}.${type.extensions[0] ?? 'bin'}`;
}

/** What the upload endpoint answers: the id the visitor's answer carries, and what was kept. */
export interface UploadedFile {
  readonly fileId: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

/** The header the upload's file name travels in (percent encoded), since the body is the file itself. */
export const UPLOAD_NAME_HEADER = 'x-file-name';

/** How long an upload waits for its submission before the daily cleanup removes it. */
export const UPLOAD_KEPT_HOURS = 24;
