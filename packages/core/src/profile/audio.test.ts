import { describe, expect, it } from 'vitest';
import { PROFILE_AUDIO_MAX_BYTES } from '@crm/contracts';
import { audioExtension, checkProfileAudio, profileAudioStorePath, profileAudioTypeOf } from './audio.ts';

/** An MP3 frame's first bytes: the sync word, MPEG-1 layer III, then a little sound. */
const FRAME = [0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00];

/** An ID3v2.3 tag of `body` bytes (a synchsafe size), the kind that carries a title, a comment or a picture. */
function id3(body: number): number[] {
  return [
    0x49,
    0x44,
    0x33,
    0x03,
    0x00,
    0x00,
    (body >> 21) & 0x7f,
    (body >> 14) & 0x7f,
    (body >> 7) & 0x7f,
    body & 0x7f,
    ...Array.from({ length: body }, () => 0x41),
  ];
}

describe('profileAudioTypeOf', () => {
  it('reads each of the four types by its first bytes', () => {
    expect(profileAudioTypeOf(Uint8Array.from([...id3(4), ...FRAME]))).toBe('audio/mpeg');
    expect(profileAudioTypeOf(Uint8Array.from(FRAME))).toBe('audio/mpeg');
    expect(profileAudioTypeOf(Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]))).toBe(
      'audio/mp4',
    );
    expect(profileAudioTypeOf(Uint8Array.from([0x4f, 0x67, 0x67, 0x53, 0, 2]))).toBe('audio/ogg');
    expect(profileAudioTypeOf(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f]))).toBe('audio/webm');
  });

  it('refuses anything else, whatever it is called', () => {
    // A picture, a page and a script, each of which a browser could be told is a sound.
    expect(profileAudioTypeOf(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined();
    expect(profileAudioTypeOf(new TextEncoder().encode('<html><script>'))).toBeUndefined();
    expect(profileAudioTypeOf(new Uint8Array())).toBeUndefined();
    // HEIC is an MP4 container too: its brand is a picture's, so it is no recording.
    expect(
      profileAudioTypeOf(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])),
    ).toBeUndefined();
  });
});

describe('checkProfileAudio', () => {
  it('takes an MP3’s tags off both ends and keeps the sound', () => {
    const tail = [0x54, 0x41, 0x47, ...Array.from({ length: 125 }, () => 0x42)];
    const sound = [...FRAME, ...Array.from({ length: 200 }, () => 0x11)];
    const checked = checkProfileAudio(Uint8Array.from([...id3(32), ...id3(8), ...sound, ...tail]));
    expect(checked).toEqual({ ok: true, type: 'audio/mpeg', bytes: Uint8Array.from(sound) });
  });

  it('refuses an MP3 whose tag runs past the file, or that holds no sound after it', () => {
    expect(checkProfileAudio(Uint8Array.from(id3(64).slice(0, 20)))).toEqual({ ok: false, reason: 'shape' });
    expect(checkProfileAudio(Uint8Array.from(id3(8)))).toEqual({ ok: false, reason: 'shape' });
  });

  it('keeps an M4A as it came, and refuses one over 1.5 MB', () => {
    const head = [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20];
    const small = Uint8Array.from([...head, 1, 2, 3]);
    expect(checkProfileAudio(small)).toEqual({ ok: true, type: 'audio/mp4', bytes: small });
    const big = new Uint8Array(PROFILE_AUDIO_MAX_BYTES + 1);
    big.set(head);
    expect(checkProfileAudio(big)).toEqual({ ok: false, reason: 'size' });
  });

  it('refuses a file that is no recording', () => {
    expect(checkProfileAudio(new TextEncoder().encode('just words'))).toEqual({ ok: false, reason: 'type' });
  });
});

describe('profileAudioStorePath', () => {
  it('names the file by the server’s own ids and its type', () => {
    expect(audioExtension('audio/webm')).toBe('webm');
    expect(
      profileAudioStorePath(
        '0190a0a0-0000-7000-8000-000000000001',
        '0190a0a0-0000-7000-8000-000000000002',
        '0190a0a0-0000-7000-8000-000000000003',
        'audio/mp4',
      ),
    ).toBe(
      'link-page/0190a0a0-0000-7000-8000-000000000001/0190a0a0-0000-7000-8000-000000000002/0190a0a0-0000-7000-8000-000000000003.m4a',
    );
  });
});
