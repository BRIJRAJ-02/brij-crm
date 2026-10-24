// The link page's contact card as a vCard (spec 0051, AC-5114): version 3.0, which iOS, Android and every desktop
// address book read, written by hand rather than by a library: a dozen lines, every value escaped per RFC 6350
// (backslash, comma, semicolon and line breaks), every line folded at 75 octets of UTF-8 without splitting a
// character, and lines ended with CRLF. The person's picture goes in as base64 when the caller fetched one.
import type { ProfileContactCard } from '@crm/contracts';

/** A picture to embed: its bytes and their type. A WebP is left out: older address books show it broken. */
export interface VcardPhoto {
  readonly type: string;
  readonly bytes: Uint8Array;
}

/** The picture types a vCard 3.0 names, by media type. */
const PHOTO_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/gif': 'GIF',
};

/** The longest a line may be, in octets, before it folds (RFC 6350 §3.2). */
const FOLD_OCTETS = 75;

const encoder = new TextEncoder();

/** A text value with RFC 6350's escapes: `\\`, `\,`, `\;`, and a line break as `\n`. */
export function escapeVcardText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/** A web address as a vCard value: the three characters a reader would split on, percent encoded. */
function uriValue(url: string): string {
  return url.replace(/[\\,;]/g, (character) => encodeURIComponent(character));
}

/**
 * One content line folded at 75 octets (RFC 6350 §3.2): each further line starts with one space, which counts
 * towards its 75, and a character of several octets is never split.
 */
export function foldVcardLine(line: string): string {
  if (encoder.encode(line).length <= FOLD_OCTETS) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  let room = FOLD_OCTETS;
  for (const character of line) {
    const octets = character.length === 1 && character.charCodeAt(0) < 0x80 ? 1 : encoder.encode(character).length;
    if (size + octets > room) {
      parts.push(current);
      current = '';
      size = 0;
      room = FOLD_OCTETS - 1;
    }
    current += character;
    size += octets;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** A full name as N's family and given names: the last word is the family name, a single word a given name. */
function nameParts(fullName: string): { readonly family: string; readonly given: string } {
  const words = fullName.trim().split(/\s+/u);
  if (words.length < 2) return { family: '', given: fullName.trim() };
  return { family: words.at(-1) ?? '', given: words.slice(0, -1).join(' ') };
}

/** The base64 of some bytes. */
function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

/**
 * A contact card as a vCard 3.0 file: the name (N and FN), the company, the job title, the email, the phone, the
 * website and the note, each only when given, and the picture when there is one of a type a vCard names. Nothing
 * else: no workspace data, nothing from a CRM record (AC-5113).
 */
export function writeVcard(card: ProfileContactCard, photo?: VcardPhoto): string {
  const { family, given } = nameParts(card.fullName);
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escapeVcardText(family)};${escapeVcardText(given)};;;`,
    `FN:${escapeVcardText(card.fullName)}`,
    ...(card.company === undefined ? [] : [`ORG:${escapeVcardText(card.company)}`]),
    ...(card.jobTitle === undefined ? [] : [`TITLE:${escapeVcardText(card.jobTitle)}`]),
    ...(card.email === undefined ? [] : [`EMAIL;TYPE=INTERNET:${escapeVcardText(card.email)}`]),
    ...(card.phone === undefined ? [] : [`TEL;TYPE=CELL:${escapeVcardText(card.phone)}`]),
    ...(card.website === undefined ? [] : [`URL:${uriValue(card.website)}`]),
    ...(card.note === undefined ? [] : [`NOTE:${escapeVcardText(card.note)}`]),
  ];
  const photoType = photo === undefined ? undefined : PHOTO_TYPES[photo.type];
  if (photo !== undefined && photoType !== undefined) {
    lines.push(`PHOTO;ENCODING=b;TYPE=${photoType}:${base64Of(photo.bytes)}`);
  }
  lines.push('END:VCARD');
  return `${lines.map(foldVcardLine).join('\r\n')}\r\n`;
}
