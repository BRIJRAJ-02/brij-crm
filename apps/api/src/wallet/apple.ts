// Add to Apple Wallet (the owner, 26 October 2026): the owner carries their own link page in their wallet and
// shows its code at an event, instead of spelling an address out. A scan opens their page tagged
// `utm_medium=apple_wallet` (`walletPageUrl`), so a visit from the pass is tellable from a shared link.
//
// A `.pkpass` is a zip of five files: `pass.json`, two icons, a `manifest.json` listing the SHA-1 of each, and a
// detached PKCS#7 signature of that manifest made with the Pass Type ID certificate. Apple checks the signature,
// the certificate chain up to their WWDR intermediate, and that the pass's team and type match the certificate,
// so none of those three is optional and none of them can be faked from here.
//
// `node-forge` signs it: Node has no PKCS#7 of its own, and hand rolling CMS and ASN.1 to avoid a dependency would
// be the wrong trade for something that guards a signing key. This file is the one place that imports it.
import { walletPageUrl } from '@crm/contracts/brand';
import forge from 'node-forge';
import { makeZip, sha1, type ZipEntry } from './zip.ts';

/** The media type a browser must see, or a phone offers to download the file instead of opening Wallet. */
export const PKPASS_TYPE = 'application/vnd.apple.pkpass';

/** What Apple knows us by. All of it comes from the environment and never from a request. */
export interface AppleWalletConfig {
  /** The Pass Type ID (`pass.com.timefix.linkpage`), which must equal the certificate's. */
  readonly passTypeId: string;
  /** The Apple Developer team id, likewise. */
  readonly teamId: string;
  /** The Pass Type ID certificate, PEM. */
  readonly certificatePem: string;
  /** Its private key, PEM. Never logged, never answered, never in an error. */
  readonly privateKeyPem: string;
  /** Apple's WWDR intermediate certificate, PEM: the chain a phone walks to Apple's root. */
  readonly wwdrPem: string;
}

/** The one page a pass stands for, and the pictures Apple requires it to carry. */
export interface ApplePass {
  readonly handle: string;
  readonly name: string;
  readonly bio?: string;
  /** Their page's full https address, untagged: this file tags it. */
  readonly pageUrl: string;
  /** `icon.png` (29px) and `icon@2x.png` (58px). Apple refuses a pass with no icon. */
  readonly icon: Uint8Array;
  readonly icon2x: Uint8Array;
  /** The ground behind the whole pass (`background.png`), at @2x and @3x. Drawn by `./background.ts`. */
  readonly background: Uint8Array;
  readonly background2x: Uint8Array;
}

/** The most of a bio a pass row will hold before it is cut at a whole word. Past this Apple shrinks it to nothing. */
const BIO_LIMIT = 90;

/** A bio as one pass row: tidied, cut at the last whole word that fits, with an ellipsis where it was cut. */
function oneLine(bio: string): string {
  const text = bio.replace(/\s+/g, ' ').trim();
  if (text.length <= BIO_LIMIT) return text;
  const cut = text.slice(0, BIO_LIMIT);
  const space = cut.lastIndexOf(' ');
  return `${(space > BIO_LIMIT * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The pass's own description (`pass.json`), shaped like the passes Apple's own Wallet makes (the owner, 26
 * October 2026): a Generic pass over a full bleed ground, white type on the brand's blue, the person's name in
 * the header, their address and their line under it, and the code beneath.
 */
export function applePassJson(config: AppleWalletConfig, pass: ApplePass): Record<string, unknown> {
  const address = pass.pageUrl.replace(/^https:\/\//, '');
  return {
    formatVersion: 1,
    passTypeIdentifier: config.passTypeId,
    teamIdentifier: config.teamId,
    // One pass per page: saving it again replaces the one already in the wallet rather than adding a second.
    serialNumber: pass.handle,
    organizationName: 'Timefix',
    description: `${pass.name} on Timefix`,
    // The name sits at the top as the pass's own mark, so the face of the pass is a name and a code and
    // nothing else (the owner, 26 October 2026).
    logoText: 'timefix',
    foregroundColor: 'rgb(255, 255, 255)',
    // The same orange Apple's own user passes carry, so a phone that cannot draw the ground still shows the
    // right pass rather than a white one.
    backgroundColor: 'rgb(253, 92, 23)',
    labelColor: 'rgba(255, 255, 255, 0.72)',
    // Handing the pass on is the point: whoever receives it holds a code that opens this page. Apple allows it
    // unless a pass says otherwise, and this says so out loud rather than leaving it to a default.
    sharingProhibited: false,
    barcodes: [
      {
        format: 'PKBarcodeFormatQR',
        message: walletPageUrl(pass.pageUrl, 'apple_wallet'),
        messageEncoding: 'iso-8859-1',
        altText: address,
      },
    ],
    generic: {
      // The name is the pass's header, as a member's name is on Apple's own; the address and the line under it
      // follow, so the face of the pass reads as a card rather than a code with a caption.
      headerFields: [{ key: 'name', label: 'Name', value: pass.name }],
      primaryFields: [],
      secondaryFields: [{ key: 'page', label: 'Page', value: address }],
      auxiliaryFields:
        pass.bio === undefined || pass.bio === '' ? [] : [{ key: 'about', label: 'About', value: oneLine(pass.bio) }],
      backFields: [
        { key: 'open', label: 'Page', value: walletPageUrl(pass.pageUrl, 'apple_wallet') },
        ...(pass.bio === undefined || pass.bio === '' ? [] : [{ key: 'bio', label: 'About', value: pass.bio }]),
      ],
    },
  };
}

/** The manifest: every file in the pass but itself and the signature, by SHA-1, which is what gets signed. */
export function appleManifest(files: readonly ZipEntry[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file.name, sha1(file.bytes)]));
}

/**
 * One of node-forge's object identifiers. They are typed as possibly absent, and none of these ever is; a build of
 * the library without them would be broken in a way worth saying out loud rather than signing around.
 */
function oid(name: 'sha256' | 'contentType' | 'messageDigest' | 'signingTime' | 'data'): string {
  const found: string | undefined = forge.pki.oids[name];
  if (found === undefined) throw new Error(`node-forge has no ${name} OID.`);
  return found;
}

/**
 * The detached PKCS#7 signature of the manifest, DER. Detached: the content is not carried inside the signature,
 * because the phone already has `manifest.json` in the zip and checks it against this.
 */
export function signManifest(config: AppleWalletConfig, manifest: Uint8Array): Uint8Array {
  const certificate = forge.pki.certificateFromPem(config.certificatePem);
  const key = forge.pki.privateKeyFromPem(config.privateKeyPem);
  const wwdr = forge.pki.certificateFromPem(config.wwdrPem);
  const signed = forge.pkcs7.createSignedData();
  signed.content = forge.util.createBuffer(Buffer.from(manifest).toString('binary'));
  signed.addCertificate(certificate);
  // The chain the phone walks: ours, then Apple's intermediate. Their root is already on the device.
  signed.addCertificate(wwdr);
  signed.addSigner({
    key,
    certificate,
    digestAlgorithm: oid('sha256'),
    authenticatedAttributes: [
      { type: oid('contentType'), value: oid('data') },
      { type: oid('messageDigest') },
      { type: oid('signingTime') },
    ],
  });
  signed.sign({ detached: true });
  return Uint8Array.from(Buffer.from(forge.asn1.toDer(signed.toAsn1()).getBytes(), 'binary'));
}

/**
 * One `.pkpass`, ready to answer. The order matters only to a reader's patience, not to Apple: `pass.json` first,
 * then the icons, then the manifest and the signature that covers them.
 */
export function applePkpass(config: AppleWalletConfig, pass: ApplePass): Uint8Array {
  const encoder = new TextEncoder();
  const files: ZipEntry[] = [
    { name: 'pass.json', bytes: encoder.encode(JSON.stringify(applePassJson(config, pass))) },
    { name: 'icon.png', bytes: pass.icon },
    { name: 'icon@2x.png', bytes: pass.icon2x },
    // Apple asks for the ground at each scale and falls back to the plain name on an older device, so all three
    // go in; the @2x stands in for the 1x, which nothing in use today draws.
    { name: 'background.png', bytes: pass.background2x },
    { name: 'background@2x.png', bytes: pass.background2x },
    { name: 'background@3x.png', bytes: pass.background },
  ];
  const manifest = encoder.encode(JSON.stringify(appleManifest(files)));
  return makeZip([
    ...files,
    { name: 'manifest.json', bytes: manifest },
    { name: 'signature', bytes: signManifest(config, manifest) },
  ]);
}
