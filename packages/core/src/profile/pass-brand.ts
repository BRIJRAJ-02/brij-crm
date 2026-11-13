// A Wallet pass in somebody else's brand (the owner, 13 November 2026): a partner's own logo in place of the
// Timefix wordmark, and the card's ground drawn from one colour of theirs. Pure: the colour and the logo come in
// already checked, and what goes out is the look and the pictures `writePass` takes.
//
// It leaves out the pass's icon, which stays the Timefix mark (Wallet shows it only in its own list), and Google
// Wallet, whose pass is a different thing made elsewhere.
import { walletCardColours, walletRampAt } from '@crm/contracts';
import type { Channels } from './colour.ts';
import { rowsPng } from './gradient.ts';
import { stripPng } from './images.ts';
import type { PassImages } from './pass.ts';

/** A brand's logo for a pass: one PNG for each of Wallet's three scales, at most 160 by 50 points. */
export interface PassLogo {
  readonly x1: Uint8Array;
  readonly x2: Uint8Array;
  readonly x3: Uint8Array;
}

/** What a pass wears in place of Timefix's own look: whose it is, and either or both of a colour and a logo. */
export interface PassBrand {
  /** The brand's name: the pass's organisation, which Wallet shows where it names who issued a pass. */
  readonly name: string;
  /** `#rrggbb`, the colour at the foot of the card; none keeps the Timefix ground. */
  readonly colour?: string;
  /** None keeps the Timefix wordmark. */
  readonly logo?: PassLogo;
}

/** The colours a pass is written in: its ground, its text and its quieter labels. */
export interface PassLook {
  readonly background: Channels;
  readonly text: Channels;
  readonly label: Channels;
}

/**
 * A brand colour's look: white text on a colour that carries it, the app's ink on one that does not. The rule is
 * `walletCardColours`, shared with the console's preview so the two never disagree.
 */
export function brandLook(colour: string): PassLook {
  const { bottom, text, label } = walletCardColours(colour);
  return { background: bottom, text, label };
}

/** Whether a brand colour's text is the white one, which decides the Timefix wordmark a logo-less brand carries. */
export function brandTextIsWhite(colour: string): boolean {
  return walletCardColours(colour).isTextWhite;
}

/** How many colours' grounds are kept: a partner's colour rarely changes, and there are few partners. */
const KEPT = 24;
const grounds = new Map<string, PassImages>();

/**
 * The ground behind a brand's card at Wallet's three scales. Kept by colour for the life of the process, oldest
 * out first past a small bound, because a colour here is any colour at all and not one of nine hues.
 */
export function brandBackground(colour: string): PassImages {
  const already = grounds.get(colour);
  if (already !== undefined) return already;
  const colours = walletCardColours(colour);
  const row = (along: number) => walletRampAt(colours, along);
  const drawn: PassImages = {
    'background.png': rowsPng(row, 1),
    'background@2x.png': rowsPng(row, 2),
    'background@3x.png': rowsPng(row, 3),
  };
  if (grounds.size >= KEPT) {
    const [oldest] = grounds.keys();
    if (oldest !== undefined) grounds.delete(oldest);
  }
  grounds.set(colour, drawn);
  return drawn;
}

/** A brand's logo under the three names a pass knows its logo by. */
export function brandLogoImages(logo: PassLogo): PassImages {
  return { 'logo.png': logo.x1, 'logo@2x.png': logo.x2, 'logo@3x.png': logo.x3 };
}

/** The largest a pass logo may be, in points (Apple's own bound), and in bytes for each scale's file. */
export const PASS_LOGO_POINTS = { width: 160, height: 50 } as const;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * A PNG's width and height from its header, or undefined when the bytes are no PNG: the eight byte signature, then
 * an `IHDR` chunk first, as every PNG has. Only the header is read; Wallet decodes the rest, on the phone.
 */
export function pngSizeOf(bytes: Uint8Array): { readonly width: number; readonly height: number } | undefined {
  if (bytes.byteLength < 24) return undefined;
  if (PNG_SIGNATURE.some((byte, at) => bytes[at] !== byte)) return undefined;
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width === 0 || height === 0 ? undefined : { width, height };
}

/** Whether a PNG whose chunks are already checked is an animated one (APNG), which a pass never carries. */
function isAnimated(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at + 12 <= bytes.byteLength; at += 12 + view.getUint32(at)) {
    if (String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === 'acTL') return true;
  }
  return false;
}

/**
 * A logo file as a pass carries it at `scale` pixels to the point, or undefined when it can't be one. Every chunk
 * is walked and its length checked (`stripPng`): text, EXIF and anything after the picture's end are left behind,
 * so what Timefix's certificate signs and a phone then parses is a still PNG and nothing else. It must fit Wallet's
 * logo, 160 by 50 points.
 */
export function cleanPassLogo(bytes: Uint8Array, scale: number): Uint8Array | undefined {
  if (pngSizeOf(bytes) === undefined) return undefined;
  const clean = stripPng(bytes);
  if (clean === undefined || isAnimated(clean.bytes)) return undefined;
  const fits = clean.width <= PASS_LOGO_POINTS.width * scale && clean.height <= PASS_LOGO_POINTS.height * scale;
  return fits ? clean.bytes : undefined;
}
