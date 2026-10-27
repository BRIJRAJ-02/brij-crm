// Just enough DER to sign a Wallet pass: a writer for the handful of shapes a CMS SignedData is made of, and a
// reader that finds two fields inside an X.509 certificate. Written by hand, as the vCard is, rather than adding a
// certificate library the rest of the repo would never use.
//
// DER is tag, length, value. A length under 128 is one byte; anything longer is 0x80 plus the count of length
// bytes, then the length, big endian. Nothing here writes a value longer than a few kilobytes, and nothing reads
// a certificate it did not get from our own environment, but the reader still refuses a malformed one rather than
// walking off the end.

/** The tags this file writes or looks for. */
export const TAG = {
  integer: 0x02,
  bitString: 0x03,
  octetString: 0x04,
  null: 0x05,
  oid: 0x06,
  utcTime: 0x17,
  sequence: 0x30,
  set: 0x31,
} as const;

/** A context specific tag, constructed: `[n]` in an ASN.1 module, which CMS uses for its optional pieces. */
export function contextTag(number: number): number {
  return 0xa0 + number;
}

/** A length, DER's way. */
function lengthBytes(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Uint8Array.of(0x80 + bytes.length, ...bytes);
}

/** One tag, length and value. */
export function element(tag: number, value: Uint8Array): Uint8Array {
  const length = lengthBytes(value.byteLength);
  const out = new Uint8Array(1 + length.byteLength + value.byteLength);
  out[0] = tag;
  out.set(length, 1);
  out.set(value, 1 + length.byteLength);
  return out;
}

/** Several encodings one after another, as a SEQUENCE's or SET's contents. */
export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** A SEQUENCE of the parts. */
export function sequence(parts: readonly Uint8Array[]): Uint8Array {
  return element(TAG.sequence, concat(parts));
}

/**
 * A SET OF the parts, in DER's order: the encodings sorted as unsigned bytes, the shorter one first where one is
 * a prefix of the other. A verifier re-encodes a signed attribute set and compares, so the order has to be right.
 */
export function setOf(parts: readonly Uint8Array[]): Uint8Array {
  const sorted = [...parts].sort((one, other) => {
    const length = Math.min(one.byteLength, other.byteLength);
    for (let at = 0; at < length; at += 1) {
      const difference = (one[at] ?? 0) - (other[at] ?? 0);
      if (difference !== 0) return difference;
    }
    return one.byteLength - other.byteLength;
  });
  return element(TAG.set, concat(sorted));
}

/** An object identifier from its dotted form, such as `1.2.840.113549.1.7.2`. */
export function oid(dotted: string): Uint8Array {
  const parts = dotted.split('.').map(Number);
  const [first = 0, second = 0, ...rest] = parts;
  const bytes = [first * 40 + second];
  for (const part of rest) {
    const chunk: number[] = [part % 128];
    for (let left = Math.floor(part / 128); left > 0; left = Math.floor(left / 128)) {
      chunk.unshift((left % 128) + 128);
    }
    bytes.push(...chunk);
  }
  return element(TAG.oid, Uint8Array.from(bytes));
}

/** A small non negative INTEGER, which is every integer this file writes but a serial number. */
export function integer(value: number): Uint8Array {
  const bytes: number[] = [value % 256];
  for (let left = Math.floor(value / 256); left > 0; left = Math.floor(left / 256)) bytes.unshift(left % 256);
  // A leading byte of 128 or more would read as negative.
  if ((bytes[0] ?? 0) >= 0x80) bytes.unshift(0);
  return element(TAG.integer, Uint8Array.from(bytes));
}

/** An algorithm as CMS writes one: its identifier and an explicit NULL, which is what OpenSSL expects back. */
export function algorithm(dotted: string): Uint8Array {
  return sequence([oid(dotted), element(TAG.null, new Uint8Array(0))]);
}

/** A UTCTime, the form CMS's signing time takes: two digit year, seconds, and Z. */
export function utcTime(at: Date): Uint8Array {
  const pad = (value: number) => String(value).padStart(2, '0');
  const text =
    pad(at.getUTCFullYear() % 100) +
    pad(at.getUTCMonth() + 1) +
    pad(at.getUTCDate()) +
    pad(at.getUTCHours()) +
    pad(at.getUTCMinutes()) +
    pad(at.getUTCSeconds()) +
    'Z';
  return element(TAG.utcTime, new TextEncoder().encode(text));
}

/** One element the reader found: its tag, its contents, and the whole thing including tag and length. */
interface Read {
  readonly tag: number;
  readonly contents: Uint8Array;
  readonly whole: Uint8Array;
  readonly end: number;
}

/** The element starting at `at`, or a refusal when the bytes run out or a length is longer than what is left. */
function read(bytes: Uint8Array, at: number): Read {
  const tag = bytes[at];
  const first = bytes[at + 1];
  if (tag === undefined || first === undefined) throw new Error('der: the bytes end mid element');
  let length = first;
  let start = at + 2;
  if (first > 0x80) {
    const count = first - 0x80;
    if (count > 4) throw new Error('der: a length too long to be real');
    length = 0;
    for (let step = 0; step < count; step += 1) {
      const byte = bytes[at + 2 + step];
      if (byte === undefined) throw new Error('der: the bytes end mid length');
      length = length * 256 + byte;
    }
    start = at + 2 + count;
  } else if (first === 0x80) {
    throw new Error('der: an indefinite length, which DER never has');
  }
  const end = start + length;
  if (end > bytes.byteLength) throw new Error('der: an element longer than the bytes');
  return { tag, contents: bytes.subarray(start, end), whole: bytes.subarray(at, end), end };
}

/** Every element directly inside one, in order. */
export function childrenOf(contents: Uint8Array): readonly Read[] {
  const out: Read[] = [];
  for (let at = 0; at < contents.byteLength;) {
    const found = read(contents, at);
    out.push(found);
    at = found.end;
  }
  return out;
}

/**
 * A certificate's issuer and serial number, exactly as they are encoded in it: CMS names a signer by repeating
 * those bytes, so they are copied out rather than parsed and written again.
 *
 * `Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signature }`, and the certificate body is
 * `SEQUENCE { [0] version (optional), serialNumber, signature, issuer, validity, subject, ... }`.
 */
export function signerNameOf(certificate: Uint8Array): {
  readonly issuer: Uint8Array;
  readonly serialNumber: Uint8Array;
} {
  const outer = read(certificate, 0);
  if (outer.tag !== TAG.sequence) throw new Error('der: that is not a certificate');
  const [body] = childrenOf(outer.contents);
  if (body === undefined || body.tag !== TAG.sequence) throw new Error('der: that certificate has no body');
  const fields = childrenOf(body.contents);
  // The version is optional, so the serial number is the first field only when the version is absent.
  const rest = fields[0]?.tag === contextTag(0) ? fields.slice(1) : fields;
  const serial = rest[0];
  const issuer = rest[2];
  if (serial?.tag !== TAG.integer || issuer?.tag !== TAG.sequence) {
    throw new Error('der: that certificate has no serial number and issuer where one should be');
  }
  return { issuer: issuer.whole, serialNumber: serial.whole };
}
