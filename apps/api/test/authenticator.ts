// A software passkey for tests (spec 0033, milestone 3): one ES256 key pair,
// answering WebAuthn's registration ("none" attestation) and assertion the
// way a browser's authenticator would, so the API's passkey routes run for
// real. Only what the tests need: a small CBOR writer, the COSE public key,
// and the authenticator data with its flags and counter.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

type Cbor = number | string | Uint8Array | ReadonlyMap<Cbor, Cbor> | { readonly [key: string]: Cbor };

function head(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  const bytes = Buffer.alloc(3);
  bytes[0] = (major << 5) | 25;
  bytes.writeUInt16BE(length, 1);
  return bytes;
}

/** CBOR (RFC 8949) for the few shapes WebAuthn uses here. */
function cbor(value: Cbor): Buffer {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const text = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, text.length), text]);
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), value]);
  const entries: [Cbor, Cbor][] =
    value instanceof Map
      ? [...(value as ReadonlyMap<Cbor, Cbor>).entries()]
      : Object.entries(value as Record<string, Cbor>);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([key, item]) => [cbor(key), cbor(item)])]);
}

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
const sha256 = (data: Uint8Array | string): Buffer => createHash('sha256').update(data).digest();

/** Authenticator data flags: user present, user verified, attested credential data. */
const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

/** A passkey on a pretend device. */
export interface TestAuthenticator {
  readonly credentialId: string;
  /** Answers a registration's options as `navigator.credentials.create` would (its JSON form). */
  register(options: { readonly challenge: string }): Record<string, unknown>;
  /** Answers an authentication's options as `navigator.credentials.get` would; `verified: false` skips the PIN. */
  assert(options: { readonly challenge: string }, how?: { readonly verified?: boolean }): Record<string, unknown>;
}

/** A new passkey for the relying party `rpId`, used from `origin`. */
export function createTestAuthenticator(rpId: string, origin: string): TestAuthenticator {
  const { privateKey, publicKey }: { privateKey: KeyObject; publicKey: KeyObject } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const coseKey = new Map<Cbor, Cbor>([
    [1, 2], // kty: EC2
    [3, -7], // alg: ES256
    [-1, 1], // crv: P-256
    [-2, Buffer.from(jwk.x ?? '', 'base64url')],
    [-3, Buffer.from(jwk.y ?? '', 'base64url')],
  ]);
  const credential = randomBytes(32);
  const credentialId = b64url(credential);
  const rpIdHash = sha256(rpId);
  let counter = 0;

  const clientData = (type: string, challenge: string): Buffer =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
  const count = (): Buffer => {
    counter += 1;
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(counter);
    return bytes;
  };

  return {
    credentialId,
    register({ challenge }) {
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(credential.length);
      const authData = Buffer.concat([
        rpIdHash,
        Buffer.from([UP | UV | AT]),
        count(),
        Buffer.alloc(16), // aaguid: none, as a privacy minded platform answers
        idLength,
        credential,
        cbor(coseKey),
      ]);
      const attestationObject = cbor({ fmt: 'none', attStmt: {}, authData });
      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: b64url(clientData('webauthn.create', challenge)),
          attestationObject: b64url(attestationObject),
          transports: ['internal'],
        },
        authenticatorAttachment: 'platform',
        clientExtensionResults: {},
      };
    },
    assert({ challenge }, how = {}) {
      const flags = how.verified === false ? UP : UP | UV;
      const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), count()]);
      const data = clientData('webauthn.get', challenge);
      const signature = sign('sha256', Buffer.concat([authData, sha256(data)]), privateKey);
      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: b64url(data),
          authenticatorData: b64url(authData),
          signature: b64url(signature),
        },
        authenticatorAttachment: 'platform',
        clientExtensionResults: {},
      };
    },
  };
}
