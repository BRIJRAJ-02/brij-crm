// Add to Google Wallet (the owner, 26 October 2026): the owner carries their own link page in their wallet and
// shows its code at an event, instead of spelling an address out. A scan opens their page tagged `utm_medium=
// google_wallet` (`walletPageUrl`), so a visit that came from the pass is tellable from one that came from a
// shared link.
//
// Google takes a "save" link whose whole payload is a JWT the issuer signed: no API call, nothing stored on their
// side until somebody saves it, and no SDK. So this file is the pass and its signature, with no network and no
// vendor import at all — `node:crypto` signs it. The pass itself is a Generic object, the kind meant for a thing
// that is not a flight, a ticket or a loyalty card.
import { createSign } from 'node:crypto';
import { walletPageUrl } from '@crm/contracts/brand';

/** Where a signed pass is handed to Google. The JWT rides in the path, so nothing of it is stored by us. */
export const GOOGLE_WALLET_SAVE = 'https://pay.google.com/gp/v/save/';

/** How long a save link is good for: a few minutes, since it is made for the press that follows it. */
export const GOOGLE_WALLET_TTL_SECONDS = 600;

/** What Google needs to know us by. All three come from the environment and never from a request. */
export interface GoogleWalletConfig {
  /** The Wallet API issuer id, a number Google gives an approved issuer account. */
  readonly issuerId: string;
  /** The service account's address, which is the JWT's `iss`. */
  readonly clientEmail: string;
  /** The service account's RSA private key, PEM. Never logged, never answered. */
  readonly privateKey: string;
  /** The class every pass of ours belongs to, under the issuer. */
  readonly classSuffix: string;
}

/** The one page a pass stands for. */
export interface WalletPass {
  /** The owner's handle, which also makes the pass's own id: one pass per page, saved again replaces it. */
  readonly handle: string;
  /** The name on the pass. */
  readonly name: string;
  /** The line under it, left off when they have no bio. */
  readonly bio?: string;
  /** Their page's full https address, untagged: this file tags it. */
  readonly pageUrl: string;
  /** The origin the save link is pressed from, which Google checks against the JWT. */
  readonly origin: string;
}

/** base64url, as a JWT writes every part. */
function base64url(value: Buffer | string): string {
  return (typeof value === 'string' ? Buffer.from(value, 'utf8') : value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * An id Google will take: it allows letters, digits, dots, dashes and underscores only, and ours is scoped by the
 * issuer. A handle is already that shape, so this only guards against a later change to what a handle may hold.
 */
function passId(issuerId: string, handle: string): string {
  return `${issuerId}.${handle.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

/** The Generic object a pass is: a title, the person, and the code a phone shows. */
export function googleWalletObject(config: GoogleWalletConfig, pass: WalletPass): Record<string, unknown> {
  const text = (value: string) => ({ defaultValue: { language: 'en', value } });
  return {
    id: passId(config.issuerId, pass.handle),
    classId: `${config.issuerId}.${config.classSuffix}`,
    state: 'ACTIVE',
    cardTitle: text('Timefix'),
    header: text(pass.name),
    ...(pass.bio === undefined || pass.bio === '' ? {} : { subheader: text(pass.bio) }),
    barcode: {
      type: 'QR_CODE',
      value: walletPageUrl(pass.pageUrl, 'google_wallet'),
      // What a phone shows under the code, so somebody reading over a shoulder sees the address too.
      alternateText: pass.pageUrl.replace(/^https:\/\//, ''),
    },
  };
}

/**
 * The link that saves one pass: `https://pay.google.com/gp/v/save/<jwt>`. The JWT is signed RS256 by the service
 * account; `origins` is the one origin it may be pressed from, which is what stops a link lifted from here being
 * made to work on somebody else's site. `now` is injected so a test can pin it.
 */
export function googleWalletLink(config: GoogleWalletConfig, pass: WalletPass, now: Date = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: config.clientEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: issuedAt,
    exp: issuedAt + GOOGLE_WALLET_TTL_SECONDS,
    origins: [new URL(pass.origin).origin],
    payload: { genericObjects: [googleWalletObject(config, pass)] },
  };
  const signing = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signing);
  signer.end();
  return `${GOOGLE_WALLET_SAVE}${signing}.${base64url(signer.sign(config.privateKey))}`;
}
