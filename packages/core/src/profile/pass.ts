// The link page's contact card as an Apple Wallet pass (`.pkpass`): the same card the vCard carries, as something
// a person keeps in Wallet, with a QR of the page on the back so it can be handed to someone across a table.
//
// A pass is a zip of `pass.json`, its images, a `manifest.json` of SHA-1 digests, and a detached CMS signature
// over that manifest (`zip.ts`, `pkcs7.ts`). Everything here is pure: the card, the images and the keys come in,
// the bytes go out, so `pass.test.ts` builds real passes with a throwaway certificate.
//
// It leaves out: relevance (a pass that surfaces on the lock screen by place or time), updates over the web
// service (a pass's fields never change once it is saved), and anything from a CRM record (AC-5113).
import { createHash } from 'node:crypto';
import { contactValuesOf, type ProfileContactCard } from '@crm/contracts';
import type { PageTheme } from '@crm/contracts';
import { gradientPng } from './gradient.ts';
import { passImage, PASS_IMAGE_NAMES } from './pass-images.ts';
import { signDetached, type PassSigningKeys } from './pkcs7.ts';
import { writeZip, type ZipEntry } from './zip.ts';

/** What Apple issued for this product: the pass type and the team it belongs to, from the environment. */
export interface PassIdentity {
  readonly passTypeIdentifier: string;
  readonly teamIdentifier: string;
  readonly organizationName: string;
}

/**
 * The images a pass carries, already PNG and already at the sizes Wallet asks for: the Timefix mark as the icon,
 * the wordmark as the logo (at the full 160 points Wallet allows, because a pass someone shows another person is
 * the product standing in front of them), and their own face as the thumbnail when we have one as a PNG.
 */
export type PassImages = Readonly<Record<string, Uint8Array | undefined>>;

/**
 * The Timefix images a pass carries, for a pass whose text is `white` or not: the icon, and the wordmark in the
 * colour that reads on this pass's background. `logo-ink*` is the black wordmark, and it is published under the
 * plain `logo` names, because a pass names its logo `logo.png` and nothing else.
 */
export function brandImages(whiteText: boolean): PassImages {
  const wanted = whiteText ? ['icon', 'logo'] : ['icon', 'logo-ink'];
  return Object.fromEntries(
    PASS_IMAGE_NAMES.flatMap((name) => {
      const stem = name.replace(/(@\dx)?\.png$/, '');
      if (!wanted.includes(stem)) return [];
      return [[name.replace('logo-ink', 'logo'), passImage(name)]];
    }),
  );
}

/**
 * Every image one person's pass carries: the Timefix mark and wordmark, and the gradient behind the card, drawn
 * in their hue. Drawing the three sizes costs a few milliseconds, so a hue's set is kept for the life of the
 * process: a hue is one of nine, and every pass in that colour is the same picture.
 */
const gradients = new Map<string, PassImages>();
export function passImages(hue: string): PassImages {
  const colours = coloursOf(hue);
  const already = gradients.get(hue);
  const background =
    already ??
    ({
      'background.png': gradientPng(colours.background, 1),
      'background@2x.png': gradientPng(colours.background, 2),
      'background@3x.png': gradientPng(colours.background, 3),
    } satisfies PassImages);
  if (already === undefined) gradients.set(hue, background);
  return { ...brandImages(isWhite(colours.text)), ...background };
}

/** Whether a pass's text colour is the white one, which decides which wordmark it carries. */
function isWhite(text: readonly [number, number, number]): boolean {
  return text[0] === 255;
}

/** Everything one person's pass is made of. */
export interface PassInput {
  readonly card: ProfileContactCard;
  readonly handle: string;
  /** The page's own address, which the QR carries and the back links to. */
  readonly pageUrl: string;
  /** The look of their link page, so the pass is the colour their page is. */
  readonly theme: Pick<PageTheme, 'hue'>;
  /** Stable per person: Wallet replaces a pass with the same serial rather than keeping two. */
  readonly serialNumber: string;
  readonly identity: PassIdentity;
  readonly images: PassImages;
}

/**
 * Each hue's dot colour, copied from `packages/tokens/tokens.css` (light). `pass.test.ts` reads that file and
 * fails when one drifts, so a token change reaches the pass. The pass darkens these itself (`inkOf`), because a
 * dot sits on a page's background and a pass's colour sits under white text.
 */
export const PASS_HUES: Readonly<Record<string, string>> = {
  gray: '#cad0d9',
  red: '#ff5b59',
  orange: '#fb8f3c',
  yellow: '#f5b900',
  lime: '#b3cf2f',
  green: '#0fc27b',
  sky: '#3fb3e8',
  blue: '#266df0',
  purple: '#9d6ef5',
};

/** The hue a pass falls back to: the page theme's own default. */
const DEFAULT_HUE = 'blue';

/** The contrast the text needs against the pass's background (WCAG AA for the body text a field label is). */
const AA_CONTRAST = 4.5;

/** The ink a pass uses when its colour is too light for white text: near black, not black, as the tokens are. */
const DARK_TEXT: readonly [number, number, number] = [21, 21, 21];

/** A `#rrggbb` as its three channels, 0 to 255. */
function channelsOf(colour: string): readonly [number, number, number] {
  const hex = colour.replace('#', '');
  return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as unknown as [number, number, number];
}

/** A channel's share of relative luminance (WCAG 2). */
function channelLuminance(value: number): number {
  const part = value / 255;
  return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
}

/** A colour's relative luminance (WCAG 2). */
function luminanceOf(channels: readonly [number, number, number]): number {
  const [red, green, blue] = channels;
  return 0.2126 * channelLuminance(red) + 0.7152 * channelLuminance(green) + 0.0722 * channelLuminance(blue);
}

/** The contrast between two colours (WCAG 2). */
export function contrastOf(one: readonly [number, number, number], other: readonly [number, number, number]): number {
  const [lighter, darker] = [luminanceOf(one), luminanceOf(other)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

/** A colour as Wallet writes one. */
function rgb(channels: readonly [number, number, number]): string {
  return `rgb(${channels.map((value) => String(Math.round(value))).join(', ')})`;
}

/**
 * The three colours of a pass, from one hue. The hue itself is the background, at full strength: a pass is held
 * up to other people, and a hue toned down until it suits one text colour is a worse card than one that picks
 * the text colour to suit the hue. So the text is white or near black, whichever reads on it, and the label is
 * that colour drawn back towards the background until it is quieter but still clears AA.
 *
 * A dot that clears AA against neither (nothing in the token set does) keeps the darker of the two, which is
 * the token's own text colour on a pale tag.
 */
export function coloursOf(hue: string): {
  readonly background: readonly [number, number, number];
  readonly text: readonly [number, number, number];
  readonly label: readonly [number, number, number];
} {
  const background = channelsOf(PASS_HUES[hue] ?? PASS_HUES[DEFAULT_HUE] ?? '#266df0');
  const white: readonly [number, number, number] = [255, 255, 255];
  const text = contrastOf(background, white) >= contrastOf(background, DARK_TEXT) ? white : DARK_TEXT;
  // The label, pulled towards the background a step at a time while it still clears AA: quieter than the value
  // above it, never so quiet it stops being readable.
  let label = text;
  for (let step = 1; step <= 5; step += 1) {
    const tried = text.map((value, at) => value + ((background[at] ?? 0) - value) * (step * 0.06)) as unknown as [
      number,
      number,
      number,
    ];
    if (contrastOf(background, tried) < AA_CONTRAST) break;
    label = tried;
  }
  return { background, text, label };
}

/** One field of a pass, as `pass.json` holds it. */
interface PassField {
  readonly key: string;
  readonly label?: string;
  readonly value: string;
  readonly dataDetectorTypes?: readonly string[];
}

/** A field, left out when it has no value. */
function fieldOf(key: string, label: string, value: string | undefined): readonly PassField[] {
  return value === undefined || value === '' ? [] : [{ key, label, value }];
}

/** The address as a person reads it: `timefix.com/anish`, not the scheme and not a trailing slash. */
export function shownAddress(pageUrl: string): string {
  return pageUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * The `pass.json` for one person: a generic pass, because a contact card is not a ticket, a coupon or a boarding
 * pass, and generic is the one style with a thumbnail, which is where their face goes.
 *
 * The front stays short on purpose: their name, what they do, and the two things someone reaches for, their email
 * and their phone. Everything else is on the back, where Wallet lets text be long and selectable.
 */
export function passJson(input: PassInput): string {
  const { card } = input;
  const emails = contactValuesOf(card, 'email');
  const phones = contactValuesOf(card, 'phone');
  const websites = contactValuesOf(card, 'website');
  const colours = coloursOf(input.theme.hue);
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: input.identity.passTypeIdentifier,
    teamIdentifier: input.identity.teamIdentifier,
    organizationName: input.identity.organizationName,
    serialNumber: input.serialNumber,
    // What a person reads in a list of passes and what VoiceOver says first.
    description: `${card.fullName}’s contact card`,
    // No `logoText`: the wordmark beside it would shrink to make room, and the logo is the point. Whoever this
    // card is handed to sees Timefix at full size, which is half of why the pass exists.
    backgroundColor: rgb(colours.background),
    foregroundColor: rgb(colours.text),
    labelColor: rgb(colours.label),
    // A QR of the page, so the pass is something to hold up: whoever scans it lands on everything, not just the
    // one card. `iso-8859-1` is what Wallet asks for, and every address here is ASCII.
    barcodes: [
      {
        format: 'PKBarcodeFormatQR',
        message: input.pageUrl,
        messageEncoding: 'iso-8859-1',
        altText: shownAddress(input.pageUrl),
      },
    ],
    // An event ticket, though nothing here is an event: it is the one pass style Wallet draws a full card
    // background behind (`background.png`), and that gradient is the card. A generic pass ignores the file and
    // comes out flat (26 October 2026).
    eventTicket: {
      headerFields: [],
      // Their name, large, with what they do as its label: the one line someone reads across a table.
      primaryFields: [{ key: 'name', label: card.jobTitle ?? '', value: card.fullName }],
      secondaryFields: [...fieldOf('company', 'Company', card.company), ...fieldOf('phone', 'Phone', phones[0])],
      auxiliaryFields: [
        ...fieldOf('email', 'Email', emails[0]),
        ...fieldOf('page', 'Page', shownAddress(input.pageUrl)),
      ],
      backFields: [
        ...emails.slice(1).map((email, at) => ({ key: `email${String(at + 2)}`, label: 'Email', value: email })),
        ...phones.slice(1).map((phone, at) => ({ key: `phone${String(at + 2)}`, label: 'Phone', value: phone })),
        ...websites.map((website, at) => ({ key: `website${String(at + 1)}`, label: 'Website', value: website })),
        ...fieldOf('note', 'Note', card.note),
        { key: 'link', label: 'Link page', value: input.pageUrl },
      ],
    },
  };
  // Two space JSON, as Apple's own examples are: a pass is read by people as often as by devices.
  return JSON.stringify(pass, undefined, 2);
}

/** The files a pass carries, in the order they go into the archive: `pass.json` first, then its images. */
function filesOf(input: PassInput): readonly ZipEntry[] {
  return [
    { name: 'pass.json', bytes: new TextEncoder().encode(passJson(input)) },
    ...Object.entries(input.images)
      .sort(([one], [other]) => (one < other ? -1 : 1))
      .flatMap(([name, bytes]) => (bytes === undefined ? [] : [{ name, bytes }])),
  ];
}

/**
 * The manifest: every file in the pass by name, with its SHA-1. SHA-1 is what the pass format asks for; it is a
 * checksum here, not a security boundary, which is the signature's job.
 */
export function manifestJson(files: readonly ZipEntry[]): string {
  const digests = Object.fromEntries(
    files.map((file) => [file.name, createHash('sha1').update(file.bytes).digest('hex')]),
  );
  return JSON.stringify(digests, undefined, 2);
}

/**
 * One person's pass, signed and zipped. `at` is the signing time, passed in so nothing here reads a clock and a
 * test can pin the bytes.
 */
export function writePass(input: PassInput, keys: PassSigningKeys, at: Date): Uint8Array {
  const files = filesOf(input);
  const manifest = new TextEncoder().encode(manifestJson(files));
  return writeZip([
    ...files,
    { name: 'manifest.json', bytes: manifest },
    { name: 'signature', bytes: signDetached(manifest, keys, at) },
  ]);
}
