// `@crm/contracts/file-limits` (#32): a record file's limits and checks, plain TypeScript with no Zod, so the
// browser's data layer and the Files tab refuse early what the server refuses too.
import { FORM_UPLOAD_ACCEPT, FORM_UPLOAD_MAX_BYTES } from './forms/uploads.ts';

/** The `accept` list a record's file picker is given: the same types a form takes. */
export const RECORD_FILE_ACCEPT: readonly string[] = FORM_UPLOAD_ACCEPT;

/** The most bytes one record file takes: the 4 MiB a Vercel Function's body allows, as a form's file does. */
export const RECORD_FILE_MAX_BYTES = FORM_UPLOAD_MAX_BYTES;

/** The most bytes a workspace's record files may hold together, live and deleted (kept for Undo) alike. */
export const WORKSPACE_FILE_BYTES = 500 * 1000 * 1000;

/** How long a deleted file waits for Undo before the daily cleanup removes it for good. */
export const RECORD_FILE_KEPT_DAYS = 30;

/**
 * Extensions a browser, a shell or an operating system would run or render as a page. A file name carrying one
 * anywhere (`invoice.exe.pdf`, `notes.html.txt`) is refused before anything is stored, on top of the type allowlist
 * and the first byte check, so a double extension can't ride in on an allowed type.
 */
export const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  'app',
  'apk',
  'appimage',
  'bat',
  'bin',
  'cmd',
  'com',
  'cpl',
  'deb',
  'dll',
  'dmg',
  'docm',
  'exe',
  'hta',
  'htm',
  'html',
  'jar',
  'js',
  'jse',
  'lnk',
  'mjs',
  'msi',
  'msp',
  'pif',
  'pkg',
  'ps1',
  'psm1',
  'reg',
  'rpm',
  'scr',
  'sh',
  'svg',
  'svgz',
  'vb',
  'vbe',
  'vbs',
  'wsf',
  'xhtml',
  'xlsm',
]);

/** Whether a file name carries an executable extension in any of its dotted parts, its last one included. */
export function hasExecutableName(name: string): boolean {
  return name
    .toLowerCase()
    .split('.')
    .slice(1)
    .some((part) => EXECUTABLE_EXTENSIONS.has(part.trim()));
}

/** The types a download may show in the browser rather than save (`?inline=1`): raster images only, never SVG. */
export const INLINE_FILE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Whether a file of this type opens in a new tab (an image) rather than downloads. */
export function opensInline(contentType: string): boolean {
  return INLINE_FILE_TYPES.has(contentType);
}

/** What a record holding as many files as it may answers. */
export const RECORD_FILES_FULL = 'This record holds as many files as it can. Remove one first.';

/** What a workspace past its file storage answers. */
export const WORKSPACE_FILES_FULL = 'Your workspace is out of file storage. Delete some files first.';
