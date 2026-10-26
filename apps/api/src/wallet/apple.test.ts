// Add to Apple Wallet: a `.pkpass` is a zip whose `manifest.json` lists the SHA-1 of every other file and whose
// `signature` is a detached PKCS#7 over that manifest. These tests make a certificate of their own, build a real
// pass with it, and then read the zip back the way a phone would: the entries, the hashes, and a signature that
// verifies against the manifest and no other bytes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'node:zlib';
import forge from 'node-forge';
import { describe, expect, it } from 'vitest';
import { applePassJson, applePkpass, appleManifest, type AppleWalletConfig } from './apple.ts';
import { passIcon, passIcons } from './icon.ts';
import { passBackground, passBackground2x } from './background.ts';
import { makeZip, sha1 } from './zip.ts';

/** A certificate and key of this test's own: nothing here ever touches a real Pass Type ID certificate. */
function selfSigned(commonName: string): { readonly certificatePem: string; readonly privateKeyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = '01';
  certificate.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  certificate.validity.notAfter = new Date('2027-01-01T00:00:00Z');
  const name = [{ name: 'commonName', value: commonName }];
  certificate.setSubject(name);
  certificate.setIssuer(name);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certificatePem: forge.pki.certificateToPem(certificate),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

const signer = selfSigned('Pass Type ID: pass.com.timefix.linkpage');
const intermediate = selfSigned('Apple WWDR CA');

const config: AppleWalletConfig = {
  passTypeId: 'pass.com.timefix.linkpage',
  teamId: 'ABCDE12345',
  certificatePem: signer.certificatePem,
  privateKeyPem: signer.privateKeyPem,
  wwdrPem: intermediate.certificatePem,
};

const pass = {
  handle: 'ada',
  name: 'Ada Lovelace',
  bio: 'Notes, links and a time to meet.',
  pageUrl: 'https://timefix.com/ada',
  ...passIcons(),
  // A real ground, so what the manifest signs is what ships; it is the same few hundred milliseconds either way.
  background: passBackground(),
  background2x: passBackground2x(),
};

describe('applePassJson', () => {
  it('names the certificate’s pass type and team, which is what a phone checks it against', () => {
    expect(applePassJson(config, pass)).toMatchObject({
      formatVersion: 1,
      passTypeIdentifier: 'pass.com.timefix.linkpage',
      teamIdentifier: 'ABCDE12345',
      serialNumber: 'ada',
    });
  });

  it('carries a code that opens their page, tagged for the wallet, with the address readable under it', () => {
    const json = applePassJson(config, pass) as { barcodes: { message: string; altText: string }[] };
    expect(json.barcodes[0]?.message).toBe(
      'https://timefix.com/ada?utm_source=timefix&utm_medium=apple_wallet&utm_campaign=wallet_pass',
    );
    expect(json.barcodes[0]?.altText).toBe('timefix.com/ada');
  });

  it('reads as a card: the brand, then the name, the address and the line under it', () => {
    const json = applePassJson(config, pass) as {
      logoText: string;
      backgroundColor: string;
      generic: Record<string, { key: string; value: string }[]>;
    };
    expect(json.logoText).toBe('timefix');
    expect(json.backgroundColor).toBe('rgb(253, 92, 23)');
    expect(json.generic.headerFields).toEqual([{ key: 'name', label: 'Name', value: 'Ada Lovelace' }]);
    expect(json.generic.secondaryFields).toEqual([{ key: 'page', label: 'Page', value: 'timefix.com/ada' }]);
    expect(json.generic.auxiliaryFields?.[0]?.value).toBe('Notes, links and a time to meet.');
    // The middle stays empty, so the code keeps the room it needs.
    expect(json.generic.primaryFields).toEqual([]);
  });

  it('cuts a long line at a whole word rather than letting the row shrink to nothing', () => {
    const long = {
      ...pass,
      bio: 'Engineer and designer, building scheduling software that gets out of the way of the people using it.',
    };
    const json = applePassJson(config, long) as { generic: { auxiliaryFields: { value: string }[] } };
    const value = json.generic.auxiliaryFields[0]?.value ?? '';
    expect(value.endsWith('…')).toBe(true);
    expect(value.length).toBeLessThanOrEqual(91);
    expect(value).not.toMatch(/\s…$/);
  });

  it('may be handed on, because a pass whose code opens a page is worth passing on', () => {
    expect(applePassJson(config, pass)).toMatchObject({ sharingProhibited: false });
  });

  it('keeps the address and the bio on the back, where they do not crowd the code', () => {
    const json = applePassJson(config, pass) as { generic: { backFields: { key: string }[] } };
    expect(json.generic.backFields.map((field) => field.key)).toEqual(['open', 'bio']);
  });

  it('leaves the About row out when they have no bio', () => {
    const { bio: _bio, ...noBio } = pass;
    const json = applePassJson(config, noBio) as { generic: { backFields: { key: string }[] } };
    expect(json.generic.backFields.map((field) => field.key)).toEqual(['open']);
  });
});

describe('appleManifest', () => {
  it('lists every file by its SHA-1, which is what the signature covers', () => {
    const bytes = new TextEncoder().encode('{}');
    expect(appleManifest([{ name: 'pass.json', bytes }])).toEqual({ 'pass.json': sha1(bytes) });
  });
});

describe('applePkpass', () => {
  /** The zip's entries, by name, read back with `unzip` so nothing here grades its own homework. */
  function entries(pkpass: Uint8Array): Record<string, Buffer> {
    const folder = mkdtempSync(join(tmpdir(), 'pkpass-'));
    const file = join(folder, 'pass.pkpass');
    writeFileSync(file, pkpass);
    const names = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).trim().split('\n');
    return Object.fromEntries(
      names.map((name) => [name, execFileSync('unzip', ['-p', file, name], { maxBuffer: 1 << 24 })]),
    );
  }

  it('holds the five files a pass needs, and a real system reads the zip', () => {
    const found = entries(applePkpass(config, pass));
    expect(Object.keys(found).sort()).toEqual([
      'background.png',
      'background@2x.png',
      'background@3x.png',
      'icon.png',
      'icon@2x.png',
      'manifest.json',
      'pass.json',
      'signature',
    ]);
  });

  it('hashes every file but the manifest and the signature, and gets them right', () => {
    const found = entries(applePkpass(config, pass));
    const manifest = JSON.parse((found['manifest.json'] ?? Buffer.alloc(0)).toString('utf8')) as Record<string, string>;
    expect(Object.keys(manifest).sort()).toEqual([
      'background.png',
      'background@2x.png',
      'background@3x.png',
      'icon.png',
      'icon@2x.png',
      'pass.json',
    ]);
    for (const [name, digest] of Object.entries(manifest)) {
      expect(sha1(Uint8Array.from(found[name] ?? Buffer.alloc(0))), name).toBe(digest);
    }
  });

  it('signs the manifest itself, and that signature covers no other bytes', () => {
    const found = entries(applePkpass(config, pass));
    const manifest = Uint8Array.from(found['manifest.json'] ?? Buffer.alloc(0));
    // A forge buffer is consumed as it is read, so every parse below starts from these bytes afresh.
    const der = (found.signature ?? Buffer.alloc(0)).toString('binary');
    const parse = () => forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(der)));
    // node-forge's types widen a parsed message to either kind; a pass is always signed data.
    const signed = parse() as forge.pkcs7.PkcsSignedData & { readonly rawCapture: Record<string, unknown> };
    // Both certificates travel with the pass: ours, and the intermediate a phone needs to reach Apple's root.
    const subjects = signed.certificates.map((certificate) => {
      const field: unknown = certificate.subject.getField('CN');
      return typeof field === 'object' && field !== null && 'value' in field ? String(field.value) : '';
    });
    expect(subjects).toContain('Pass Type ID: pass.com.timefix.linkpage');
    expect(subjects).toContain('Apple WWDR CA');
    // Detached: the signature carries no content of its own, which is why the phone hands it the manifest.
    expect(signed.rawCapture.content).toBeUndefined();
    // What the signature commits to: the signed attributes carry the SHA-256 of the manifest, so those 32 bytes
    // are in the DER and the digest of anything else is not. (node-forge's own `verify` does not do detached
    // signed data, so this reads the one property that matters rather than trusting its verifier.)
    const digest = (content: Uint8Array) => createHash('sha256').update(content).digest();
    const bytes = Buffer.from(der, 'binary');
    expect(bytes.includes(digest(manifest))).toBe(true);
    expect(bytes.includes(digest(new TextEncoder().encode('{"pass.json":"nope"}')))).toBe(false);
  });
});

describe('passIcon', () => {
  it('draws a real PNG at the size asked for, which is what Apple refuses a pass without', () => {
    const png = passIcon(29);
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // The IHDR's width and height, which a reader takes the picture's size from.
    const header = Buffer.from(png.slice(16, 24));
    expect(header.readUInt32BE(0)).toBe(29);
    expect(header.readUInt32BE(4)).toBe(29);
    expect(passIcon(58).byteLength).toBeGreaterThan(png.byteLength);
  });
});

describe('makeZip', () => {
  it('stores a file a reader can inflate back to exactly what went in', () => {
    const bytes = new TextEncoder().encode('x'.repeat(5000));
    const zip = makeZip([{ name: 'big.txt', bytes }]);
    const folder = mkdtempSync(join(tmpdir(), 'zip-'));
    const file = join(folder, 'one.zip');
    writeFileSync(file, zip);
    expect(execFileSync('unzip', ['-p', file, 'big.txt'])).toEqual(Buffer.from(bytes));
    // It compressed rather than stored: the whole point of trying deflate first.
    expect(zip.byteLength).toBeLessThan(bytes.byteLength);
    expect(unzipSync).toBeTypeOf('function');
  });
});
