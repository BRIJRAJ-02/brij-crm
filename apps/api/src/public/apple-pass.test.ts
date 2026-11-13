// A partner's own Apple Wallet card (13 November 2026): the same pass, signed with the same certificate, in the
// partner's name, colour and logo. These tests make a certificate of their own, build real passes, and read the
// zip back with `unzip`, as `wallet/apple.test.ts` does.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { describe, expect, it } from 'vitest';
import { createApplePass } from './apple-pass.ts';

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
const make = createApplePass({
  origin: 'https://timefix.com',
  apple: {
    passTypeId: 'pass.com.timefix.linkpage',
    teamId: 'ABCDE12345',
    certificatePem: signer.certificatePem,
    privateKeyPem: signer.privateKeyPem,
    wwdrPem: selfSigned('Apple WWDR CA').certificatePem,
  },
});

/** The zip's entries by name, read back with `unzip`. */
function entries(pkpass: Uint8Array): Record<string, Buffer> {
  const file = join(mkdtempSync(join(tmpdir(), 'pkpass-')), 'pass.pkpass');
  writeFileSync(file, pkpass);
  const names = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).trim().split('\n');
  return Object.fromEntries(
    names.map((name) => [name, execFileSync('unzip', ['-p', file, name], { maxBuffer: 1 << 24 })]),
  );
}

const json = (found: Record<string, Buffer>) =>
  JSON.parse((found['pass.json'] ?? Buffer.alloc(0)).toString('utf8')) as Record<string, string>;

/** Bytes that stand for a logo file: the pass carries whatever the registry checked, unread. */
const logo = { x1: Uint8Array.from([1, 1, 1]), x2: Uint8Array.from([2, 2, 2]), x3: Uint8Array.from([3, 3, 3]) };
const ada = { handle: 'ada', name: 'Ada Lovelace' };

describe('createApplePass', () => {
  it('makes Timefix’s own card for a person with no partner’s brand', () => {
    if (make === undefined) throw new Error('No pass maker.');
    const pass = json(entries(make(ada)));
    expect(pass.organizationName).toBe('Timefix');
    expect(pass.backgroundColor).toBe('rgb(251, 143, 60)');
  });

  it('makes a partner’s card in its name, colour and logo, signed as every pass is', () => {
    if (make === undefined) throw new Error('No pass maker.');
    const plain = entries(make(ada));
    const found = entries(make({ ...ada, brand: { name: 'Rilian', colour: '#13265b', logo } }));
    const pass = json(found);
    expect(pass.organizationName).toBe('Rilian');
    expect(pass.backgroundColor).toBe('rgb(19, 38, 91)');
    expect(pass.foregroundColor).toBe('rgb(255, 255, 255)');
    // Still Timefix's pass type and team: the certificate signs the pass, it does not name it.
    expect(pass.passTypeIdentifier).toBe('pass.com.timefix.linkpage');
    expect(found['logo.png']).toEqual(Buffer.from(logo.x1));
    expect(found['logo@2x.png']).toEqual(Buffer.from(logo.x2));
    expect(found['logo@3x.png']).toEqual(Buffer.from(logo.x3));
    // Its own ground, and the Timefix icon it keeps.
    expect(found['background@3x.png']).not.toEqual(plain['background@3x.png']);
    expect(found['icon.png']).toEqual(plain['icon.png']);
    // The same files as any pass, each hashed in the manifest the signature covers.
    expect(Object.keys(found).sort()).toEqual(Object.keys(plain).sort());
    const manifest = JSON.parse((found['manifest.json'] ?? Buffer.alloc(0)).toString('utf8')) as Record<string, string>;
    expect(manifest['logo@3x.png']).toBe(createHash('sha1').update(logo.x3).digest('hex'));
  });

  it('keeps the Timefix wordmark for a partner with only a colour, and the Timefix ground with only a logo', () => {
    if (make === undefined) throw new Error('No pass maker.');
    const plain = entries(make(ada));
    const coloured = entries(make({ ...ada, brand: { name: 'Rilian', colour: '#13265b' } }));
    expect(coloured['logo.png']).toEqual(plain['logo.png']);
    expect(json(coloured).backgroundColor).toBe('rgb(19, 38, 91)');
    const marked = entries(make({ ...ada, brand: { name: 'Rilian', logo } }));
    expect(marked['background.png']).toEqual(plain['background.png']);
    expect(json(marked).backgroundColor).toBe('rgb(251, 143, 60)');
    expect(marked['logo.png']).toEqual(Buffer.from(logo.x1));
  });
});
