// Add to Google Wallet: the save link is a JWT the service account signed, so these tests generate a key pair,
// sign a pass with it, and check the parts a wrong one would get wrong — what Google reads, what the code opens,
// and that the signature is really over the two parts in front of it.
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GOOGLE_WALLET_SAVE, googleWalletLink, googleWalletObject, type GoogleWalletConfig } from './google.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const config: GoogleWalletConfig = {
  issuerId: '3388000000012345678',
  clientEmail: 'passes@timefix.iam.gserviceaccount.com',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  classSuffix: 'link_page',
};

const pass = {
  handle: 'ada',
  name: 'Ada Lovelace',
  bio: 'Notes, links and a time to meet.',
  pageUrl: 'https://timefix.com/ada',
  origin: 'https://timefix.com',
};

/** One part of the JWT, read back as plain data: a test reads what it asks for and narrows it itself. */
type Part = Readonly<Record<string, unknown>>;

/** The JWT's three parts, as Google splits them. */
function parts(link: string): {
  readonly header: Part;
  readonly claims: Part;
  readonly signing: string;
  readonly signature: string;
} {
  expect(link.startsWith(GOOGLE_WALLET_SAVE)).toBe(true);
  const [header, claims, signature] = link.slice(GOOGLE_WALLET_SAVE.length).split('.');
  const read = (part: string | undefined): Part =>
    JSON.parse(Buffer.from(part ?? '', 'base64url').toString('utf8')) as Part;
  return {
    header: read(header),
    claims: read(claims),
    signing: `${header ?? ''}.${claims ?? ''}`,
    signature: signature ?? '',
  };
}

/** One claim as a number, which is what `iat` and `exp` are. */
const seconds = (claims: Part, key: string): number => (typeof claims[key] === 'number' ? claims[key] : Number.NaN);

describe('googleWalletObject', () => {
  it('carries the person and a code that opens their page, tagged for the wallet', () => {
    const object = googleWalletObject(config, pass);
    expect(object).toMatchObject({
      id: `${config.issuerId}.ada`,
      classId: `${config.issuerId}.link_page`,
      state: 'ACTIVE',
    });
    const barcode = object.barcode as { type: string; value: string; alternateText: string };
    expect(barcode.type).toBe('QR_CODE');
    expect(barcode.value).toBe(
      'https://timefix.com/ada?utm_source=timefix&utm_medium=google_wallet&utm_campaign=wallet_pass',
    );
    // What a phone shows under the code: the address, without the scheme nobody reads out.
    expect(barcode.alternateText).toBe('timefix.com/ada');
  });

  it('leaves the line out when they have no bio, rather than drawing an empty one', () => {
    expect(googleWalletObject(config, { ...pass, bio: '' })).not.toHaveProperty('subheader');
    const { bio: _bio, ...noBio } = pass;
    expect(googleWalletObject(config, noBio)).not.toHaveProperty('subheader');
  });
});

describe('googleWalletLink', () => {
  it('signs the two parts in front of the signature, with the service account’s key', () => {
    const { header, claims, signing, signature } = parts(googleWalletLink(config, pass));
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(claims).toMatchObject({
      iss: config.clientEmail,
      aud: 'google',
      typ: 'savetowallet',
      origins: ['https://timefix.com'],
    });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(signing);
    verifier.end();
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('is good for ten minutes from the clock it is given', () => {
    const now = new Date('2026-10-26T12:00:00Z');
    const { claims } = parts(googleWalletLink(config, pass, now));
    expect(seconds(claims, 'iat')).toBe(1793016000);
    expect(seconds(claims, 'exp') - seconds(claims, 'iat')).toBe(600);
  });

  it('names only the origin the link may be pressed from, whatever path came with it', () => {
    const { claims } = parts(googleWalletLink(config, { ...pass, origin: 'https://timefix.com/somewhere?a=1' }));
    expect(claims.origins).toEqual(['https://timefix.com']);
  });

  it('refuses a page address that is not https, rather than signing one', () => {
    expect(() => googleWalletLink(config, { ...pass, pageUrl: 'http://timefix.com/ada' })).toThrow();
  });
});
