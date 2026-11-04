// A link page's audio intro (spec 0068, AC-6808): what a recording's own first bytes say it is, its size, and its
// bytes with an MP3's tags taken out. Every recording a page keeps comes through `checkProfileAudio`; the declared
// type and the file's name are never believed.
//
// Pure: bytes in, bytes out. Nothing here decodes sound. MP3's ID3 tags (which may carry a name, a picture, a
// comment) are cut off both ends; an M4A's, Ogg's or WebM's own metadata boxes are kept, since cutting them means
// rewriting the container's offsets, and a phone's voice memo writes no place in them.
import { PROFILE_AUDIO_MAX_BYTES, type ProfileAudioType } from '@crm/contracts';

/** A recording as kept: its type by its bytes and its bytes, an MP3 without its tags. */
export interface CheckedAudio {
  readonly ok: true;
  readonly type: ProfileAudioType;
  readonly bytes: Uint8Array;
}

/** Why a recording is refused: not one of the four types, too big, or an MP3 tag that runs past the file. */
export type AudioRefusal = { readonly ok: false; readonly reason: 'type' | 'size' | 'shape' };

/** The extension a stored recording's path takes. */
export function audioExtension(type: ProfileAudioType): 'mp3' | 'm4a' | 'ogg' | 'webm' {
  if (type === 'audio/mpeg') return 'mp3';
  if (type === 'audio/mp4') return 'm4a';
  return type === 'audio/ogg' ? 'ogg' : 'webm';
}

/** The type `bytes` begin as among the four a link page stores, or undefined. */
export function profileAudioTypeOf(bytes: Uint8Array): ProfileAudioType | undefined {
  const at = (offset: number, ...expected: readonly number[]) =>
    expected.every((byte, index) => bytes[offset + index] === byte);
  // An MP3 starts with its ID3 tag, or straight away with a frame's sync word (eleven set bits).
  if (at(0, 0x49, 0x44, 0x33)) return 'audio/mpeg';
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) return 'audio/mpeg';
  // An MP4 container names its type in its first box: `ftyp`, four bytes in.
  if (at(4, 0x66, 0x74, 0x79, 0x70)) return 'audio/mp4';
  if (at(0, 0x4f, 0x67, 0x67, 0x53)) return 'audio/ogg';
  // WebM is Matroska: the EBML header's id.
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return 'audio/webm';
  return undefined;
}

/** An ID3v2 tag's length, header included, or undefined when its size bytes are not a synchsafe number. */
function id3Length(bytes: Uint8Array): number | undefined {
  const size = [6, 7, 8, 9].map((at) => bytes[at] ?? 0xff);
  if (size.some((byte) => byte > 0x7f)) return undefined;
  const [a = 0, b = 0, c = 0, d = 0] = size;
  const body = a * 0x200000 + b * 0x4000 + c * 0x80 + d;
  // A footer (bit 4 of the flags) adds ten bytes more.
  const footer = ((bytes[5] ?? 0) & 0x10) === 0 ? 0 : 10;
  return 10 + body + footer;
}

/** An MP3 without its ID3v2 tags in front and its ID3v1 tag at the end, or undefined when a tag runs past the file. */
function stripMp3(bytes: Uint8Array): Uint8Array | undefined {
  let start = 0;
  // A file may carry more than one tag in front; each is cut.
  while (bytes[start] === 0x49 && bytes[start + 1] === 0x44 && bytes[start + 2] === 0x33) {
    const length = id3Length(bytes.subarray(start));
    if (length === undefined || start + length > bytes.length) return undefined;
    start += length;
  }
  let end = bytes.length;
  if (end - start >= 128 && bytes[end - 128] === 0x54 && bytes[end - 127] === 0x41 && bytes[end - 126] === 0x47) {
    end -= 128;
  }
  const kept = bytes.subarray(start, end);
  // What is left must be sound: a frame's sync word.
  return kept[0] === 0xff && ((kept[1] ?? 0) & 0xe0) === 0xe0 ? kept : undefined;
}

/**
 * A recording checked for a link page (AC-6808): its type by its first bytes (MP3, M4A, Ogg or WebM; anything else
 * refused whatever it claimed to be), an MP3's tags taken out, and at most 1.5 MB kept.
 */
export function checkProfileAudio(bytes: Uint8Array): CheckedAudio | AudioRefusal {
  const type = profileAudioTypeOf(bytes);
  if (type === undefined) return { ok: false, reason: 'type' };
  if (bytes.byteLength > PROFILE_AUDIO_MAX_BYTES * 2) return { ok: false, reason: 'size' };
  const kept = type === 'audio/mpeg' ? stripMp3(bytes) : bytes;
  if (kept === undefined || kept.byteLength === 0) return { ok: false, reason: 'shape' };
  if (kept.byteLength > PROFILE_AUDIO_MAX_BYTES) return { ok: false, reason: 'size' };
  return { ok: true, type, bytes: kept };
}

/** A stored recording's path in the file store: the person's folder for that workspace, and the recording's id. */
export function profileAudioStorePath(
  userId: string,
  workspaceId: string,
  audioId: string,
  type: ProfileAudioType,
): string {
  return `link-page/${userId}/${workspaceId}/${audioId}.${audioExtension(type)}`;
}
