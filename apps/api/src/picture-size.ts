// A picture's pixel size from its own header (security review, 4 Nov 2026), so an upload can be refused before anything
// decodes it: a few hundred bytes that unpack to 50,000 by 50,000 pixels are a decompression bomb. PNG's IHDR, JPEG's
// first start of frame, and WebP's VP8X, VP8 or VP8L chunk. Undefined when the header says nothing we can read.

/** The width and height a PNG, JPEG or WebP says it is, or undefined. */
export function pictureSize(bytes: Uint8Array): { readonly width: number; readonly height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = (offset: number, length: number) => offset + length <= bytes.byteLength;
  // PNG: the signature, then IHDR's width and height, big endian.
  if (at(0, 24) && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: walk the markers to the first start of frame (C0 to CF, but C4, C8 and CC).
  if (at(0, 4) && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (at(offset, 9)) {
      if (bytes[offset] !== 0xff) return undefined;
      const marker = bytes[offset + 1] ?? 0;
      const length = view.getUint16(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      }
      if (length < 2) return undefined;
      offset += 2 + length;
    }
    return undefined;
  }
  // WebP: RIFF....WEBP, then the first chunk.
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (at(0, 30) && tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    const chunk = tag(12);
    if (chunk === 'VP8X') {
      const width = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
      const height = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
      return { width, height };
    }
    if (chunk === 'VP8 ')
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return undefined;
}
