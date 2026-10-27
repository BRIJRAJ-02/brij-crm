// The detached signature a `.pkpass` carries (`signature`, beside `manifest.json`): a CMS SignedData with no
// content of its own, signed with the Pass Type ID certificate Apple issues, carrying that certificate and
// Apple's WWDR intermediate so a device can build the chain.
//
// Node has no CMS writer, and the one structure we need is small, so it is written here over `der.ts` and
// `node:crypto`'s RSA signature. `pkcs7.test.ts` hands what this makes to `openssl cms -verify`, which is the
// only proof that matters.
import { createSign, createHash, X509Certificate, createPrivateKey, type KeyObject } from 'node:crypto';
import {
  algorithm,
  concat,
  contextTag,
  element,
  integer,
  oid,
  sequence,
  setOf,
  signerNameOf,
  TAG,
  utcTime,
} from './der.ts';

/** PKCS#7 and PKCS#9's identifiers, by the name the specification gives them. */
const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsa: '1.2.840.113549.1.1.1',
  sha256Rsa: '1.2.840.113549.1.1.11',
} as const;

/** What signing needs: the pass certificate, Apple's intermediate, and the key, each as PEM. */
export interface PassSigningKeys {
  readonly certificatePem: string;
  readonly intermediatePem: string;
  readonly keyPem: string;
  readonly keyPassphrase?: string;
}

/** One signed attribute: its identifier and its one value. */
function attribute(dotted: string, value: Uint8Array): Uint8Array {
  return sequence([oid(dotted), setOf([value])]);
}

/** A private key, with its passphrase when it has one. A key that won't open is a refusal the caller sees once. */
function keyFrom(keys: PassSigningKeys): KeyObject {
  return createPrivateKey(
    keys.keyPassphrase === undefined || keys.keyPassphrase === ''
      ? keys.keyPem
      : { key: keys.keyPem, passphrase: keys.keyPassphrase },
  );
}

/**
 * The detached CMS signature over `content`, as a pass's `signature` file.
 *
 * The signature is made over the signed attributes (re-encoded as a SET OF, which is what RFC 5652 §5.4 asks
 * for), not over the content itself; the content's digest travels as one of those attributes. `at` is the signing
 * time, passed in so a test can pin it and so nothing here reads a clock.
 */
export function signDetached(content: Uint8Array, keys: PassSigningKeys, at: Date): Uint8Array {
  const certificate = new X509Certificate(keys.certificatePem);
  const intermediate = new X509Certificate(keys.intermediatePem);
  const digest = createHash('sha256').update(content).digest();
  const signedAttributes = [
    attribute(OID.contentType, oid(OID.data)),
    attribute(OID.signingTime, utcTime(at)),
    attribute(OID.messageDigest, element(TAG.octetString, digest)),
  ];
  // Signed as a SET OF, though it travels under the implicit [0] tag below: RFC 5652 §5.4, and what a verifier
  // re-encodes before checking. Getting this wrong gives a signature that is well formed and never verifies.
  const toSign = setOf(signedAttributes);
  const signature = createSign('sha256').update(toSign).sign(keyFrom(keys));

  const signerInfo = sequence([
    integer(1),
    (({ issuer, serialNumber }) => sequence([issuer, serialNumber]))(signerNameOf(certificate.raw)),
    algorithm(OID.sha256),
    // The same attributes, under [0] IMPLICIT: the tag changes, the contents do not.
    element(contextTag(0), concat([...signedAttributes].sort(byBytes))),
    algorithm(OID.sha256Rsa),
    element(TAG.octetString, signature),
  ]);

  const signedData = sequence([
    integer(1),
    setOf([algorithm(OID.sha256)]),
    // No content: a detached signature names the type and carries nothing.
    sequence([oid(OID.data)]),
    element(contextTag(0), concat([certificate.raw, intermediate.raw])),
    setOf([signerInfo]),
  ]);

  return sequence([oid(OID.signedData), element(contextTag(0), signedData)]);
}

/** DER's order for a SET OF's members, the same one `setOf` uses. */
function byBytes(one: Uint8Array, other: Uint8Array): number {
  const length = Math.min(one.byteLength, other.byteLength);
  for (let at = 0; at < length; at += 1) {
    const difference = (one[at] ?? 0) - (other[at] ?? 0);
    if (difference !== 0) return difference;
  }
  return one.byteLength - other.byteLength;
}
