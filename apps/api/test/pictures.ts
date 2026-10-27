// Small pictures for the upload tests (27 Oct 2026): real file structures, made by hand, with metadata to take out
// where a test asks for it. Their pixels are placeholders; only their structure is read.
const bytesOf = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

function join(pieces: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.byteLength, 0));
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.byteLength;
  }
  return out;
}

/** A JPEG segment: its marker, its length and its body. */
function segment(marker: number, body: Uint8Array): Uint8Array {
  const length = body.byteLength + 2;
  return join([new Uint8Array([0xff, marker, length >> 8, length & 0xff]), body]);
}

/** A JPEG: JFIF, then EXIF with GPS, a comment and a colour profile where asked, then a scan. */
export function jpegWith(options: { exif?: boolean; comment?: boolean; profile?: boolean }): Uint8Array {
  return join([
    new Uint8Array([0xff, 0xd8]),
    segment(0xe0, bytesOf('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    ...(options.exif === true ? [segment(0xe1, bytesOf('Exif\0\0GPS 51.5N 0.12W'))] : []),
    ...(options.comment === true ? [segment(0xfe, bytesOf('a comment'))] : []),
    ...(options.profile === true ? [segment(0xe2, bytesOf('ICC_PROFILE\0\x01\x01profile'))] : []),
    segment(0xdb, new Uint8Array(65)),
    segment(0xda, bytesOf('\x01\x01\0\0?\0')),
    bytesOf('SCAN'),
    new Uint8Array([0xff, 0xd9]),
  ]);
}

/** A PNG chunk; its CRC is left zero, which nothing here reads. */
function chunk(type: string, body: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, body.byteLength);
  head.set(bytesOf(type), 4);
  return join([head, body, new Uint8Array(4)]);
}

/** A PNG: IHDR, text, a time and EXIF where asked, IDAT and IEND. */
export function pngWith(options: { text?: boolean }): Uint8Array {
  return join([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', new Uint8Array(13)),
    ...(options.text === true
      ? [chunk('tEXt', bytesOf('Comment\0GPS here')), chunk('tIME', new Uint8Array(7)), chunk('eXIf', bytesOf('GPS'))]
      : []),
    chunk('IDAT', bytesOf('pixels')),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** A WebP chunk, padded to an even size. */
function riffChunk(fourcc: string, body: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  head.set(bytesOf(fourcc));
  new DataView(head.buffer).setUint32(4, body.byteLength, true);
  return join([head, body, new Uint8Array(body.byteLength % 2)]);
}

/** An extended WebP: VP8X (its EXIF and XMP flags set where asked), the picture, then EXIF and XMP where asked. */
export function webpWith(options: { exif?: boolean }): Uint8Array {
  const flags = new Uint8Array(10);
  flags[0] = options.exif === true ? 0x0c : 0;
  const body = join([
    riffChunk('VP8X', flags),
    riffChunk('VP8L', bytesOf('pixels!')),
    ...(options.exif === true ? [riffChunk('EXIF', bytesOf('GPS 51.5N')), riffChunk('XMP ', bytesOf('<x/>'))] : []),
  ]);
  const head = new Uint8Array(12);
  head.set(bytesOf('RIFF'));
  new DataView(head.buffer).setUint32(4, body.byteLength + 4, true);
  head.set(bytesOf('WEBP'), 8);
  return join([head, body]);
}
