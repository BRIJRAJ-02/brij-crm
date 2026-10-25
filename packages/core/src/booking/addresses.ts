// Which network addresses our server may never be made to open (spec 0055, AC-5520). This is the whole of the
// server side request forgery answer that can be decided without touching the network, so it lives on its own,
// takes a string, answers a boolean, and is tested as a table. It sits beside `picture.ts`, the fetch rule it
// will join: spec 0055 names the module `public/outside-fetch.ts`, and this is the half of it that is pure.
//
// The rule is a refusal list, not an allow list, because the open internet is what we are fetching and the
// private world is what we are not. Every range below is somewhere a request from our own servers could reach
// something no visitor could: our own loopback, the private networks our hosts sit in, the link local address
// cloud metadata answers on, and the carrier range a host may sit behind.
import { isIP } from 'node:net';

/** A refused IPv4 range, as its first address and how many leading bits are fixed. */
const REFUSED_V4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], // This network.
  ['10.0.0.0', 8], // Private.
  ['100.64.0.0', 10], // Carrier grade NAT.
  ['127.0.0.0', 8], // Loopback.
  ['169.254.0.0', 16], // Link local: 169.254.169.254 is the cloud metadata address.
  ['172.16.0.0', 12], // Private.
  ['192.0.0.0', 24], // IETF protocol assignments.
  ['192.0.2.0', 24], // Documentation.
  ['192.88.99.0', 24], // 6to4 relay anycast.
  ['192.168.0.0', 16], // Private.
  ['198.18.0.0', 15], // Benchmarking.
  ['198.51.100.0', 24], // Documentation.
  ['203.0.113.0', 24], // Documentation.
  ['224.0.0.0', 4], // Multicast.
  ['240.0.0.0', 4], // Reserved, the broadcast address included.
];

/** The four bytes of an IPv4 address, or undefined when it is not one. */
function bytesOfV4(address: string): readonly number[] | undefined {
  if (isIP(address) !== 4) return undefined;
  const parts = address.split('.').map((part) => Number(part));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : undefined;
}

/** Whether `address` sits inside `first/bits`. */
function inRange(address: readonly number[], first: string, bits: number): boolean {
  const start = bytesOfV4(first);
  if (start === undefined) return false;
  const value = address.reduce((all, byte) => all * 256 + byte, 0);
  const base = start.reduce((all, byte) => all * 256 + byte, 0);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) >>> 0 === (base & mask) >>> 0;
}

/** The sixteen bytes of an IPv6 address, or undefined when it is not one. */
function bytesOfV6(address: string): readonly number[] | undefined {
  if (isIP(address) !== 6) return undefined;
  const plain = address.split('%')[0] ?? address;
  const double = plain.includes('::');
  const [head = '', tail] = double ? plain.split('::') : [plain, undefined];
  const groupsOf = (text: string | undefined): readonly string[] =>
    text === undefined || text === '' ? [] : text.split(':');
  // A trailing IPv4 (`::ffff:10.0.0.1`) is its own four bytes; every other group is two.
  const expand = (groups: readonly string[]): readonly number[] =>
    groups.flatMap((group) => {
      const embedded = bytesOfV4(group);
      if (embedded !== undefined) return [...embedded];
      const value = Number.parseInt(group, 16);
      return Number.isNaN(value) ? [-1] : [value >> 8, value & 0xff];
    });
  const front = expand(groupsOf(head));
  const back = expand(groupsOf(tail));
  if (front.includes(-1) || back.includes(-1)) return undefined;
  const middle = double ? Array<number>(Math.max(0, 16 - front.length - back.length)).fill(0) : [];
  const bytes = [...front, ...middle, ...back];
  return bytes.length === 16 ? bytes : undefined;
}

/** The IPv4 address an IPv6 one carries inside it (mapped, compatible, NAT64 or 6to4), or undefined. */
function embeddedV4(bytes: readonly number[]): string | undefined {
  const at = (offset: number, ...expected: readonly number[]) =>
    expected.every((byte, index) => bytes[offset + index] === byte);
  const dotted = (offset: number) => bytes.slice(offset, offset + 4).join('.');
  if (at(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) && (at(10, 0xff, 0xff) || at(10, 0, 0))) return dotted(12);
  if (at(0, 0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0)) return dotted(12);
  if (at(0, 0x20, 0x02)) return dotted(2);
  return undefined;
}

/**
 * Whether a request must never be made to `address`: anything loopback, private, link local, unique local,
 * multicast, carrier grade NAT, reserved or documentation, in either family, and an IPv6 address carrying one of
 * those IPv4 addresses inside it. Anything this cannot read as an address at all is refused too, since a value
 * it cannot read is one it cannot vouch for.
 */
export function isRefusedAddress(address: string): boolean {
  const v4 = bytesOfV4(address);
  if (v4 !== undefined) return REFUSED_V4.some(([first, bits]) => inRange(v4, first, bits));
  const v6 = bytesOfV6(address);
  if (v6 === undefined) return true;
  const inside = embeddedV4(v6);
  if (inside !== undefined) return isRefusedAddress(inside);
  const [first = 0, second = 0] = v6;
  if (v6.every((byte) => byte === 0)) return true;
  if (v6.slice(0, 15).every((byte) => byte === 0) && v6[15] === 1) return true;
  if ((first & 0xfe) === 0xfc) return true;
  if (first === 0xfe && (second & 0xc0) === 0x80) return true;
  if (first === 0xff) return true;
  return false;
}

/**
 * Whether a web address may be fetched at all, before anything is resolved (AC-5520): https only, and a host
 * name rather than a literal address, so the refusal list above is always asked about something DNS answered
 * and never bypassed by writing the address in the link. A name that resolves inward is caught by the resolved
 * check, which is the other half and needs the network.
 */
export function isFetchableUrl(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) return false;
  // A trailing dot is the same name to DNS and a different string to every allow list, so it never passes.
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host);
}
