// A step up by passkey (spec 0033, milestone 3, AC-896): the one module that
// imports @simplewebauthn/server. Better Auth's passkey plugin adds passkeys
// and signs in with them; a step up must not make a new session, so it checks
// the passkey here instead, against a challenge kept for this one session.
// The relying party is the web app's origin (AC-889), so a preview's passkey
// never works in production.
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { PasskeyAssertion, PasskeyRequestOptions } from '@crm/contracts';
import type { IdentityStore } from '@crm/db';

/** How long a step up's passkey challenge lives. */
export const PASSKEY_CHALLENGE_SECONDS = 5 * 60;

/** The authenticator data's flag byte: bit 0 user present, bit 2 user verified (WebAuthn §6.1). */
const FLAGS_OFFSET = 32;
const USER_VERIFIED = 0x04;

const TRANSPORTS: ReadonlySet<string> = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);

const transportsOf = (list: readonly string[]): AuthenticatorTransportFuture[] =>
  list.filter((each): each is AuthenticatorTransportFuture => TRANSPORTS.has(each));

/**
 * Whether a passkey's answer says the person was verified on the device (a
 * fingerprint, face or PIN), not just present. A passkey counts as a second
 * factor only then (owner decision 3). The flag is inside the signed data, so
 * a forged one fails the signature check anyway.
 */
export function userVerified(authenticatorData: string): boolean {
  const bytes = Buffer.from(authenticatorData, 'base64url');
  const flags = bytes[FLAGS_OFFSET];
  return flags !== undefined && (flags & USER_VERIFIED) !== 0;
}

/** What a passkey step up needs: the identity store, and the relying party (the web app's host and origin). */
export interface PasskeyStepUpDeps {
  readonly identity: Pick<
    IdentityStore,
    'passkeyCredentials' | 'passkeyByCredential' | 'passkeyUsed' | 'putPasskeyChallenge' | 'takePasskeyChallenge'
  >;
  readonly rpID: string;
  readonly origin: string;
}

/** A passkey step up: a challenge for this session, then its answer checked once. */
export interface PasskeyStepUp {
  /** The challenge for this session and the person's passkeys, or undefined when they have none. */
  options(userId: string, sessionId: string): Promise<PasskeyRequestOptions | undefined>;
  /** Checks the answer against this session's challenge (used up either way). False for anything wrong. */
  check(userId: string, sessionId: string, response: PasskeyAssertion): Promise<boolean>;
}

/** Builds the passkey step up for this relying party. */
export function createPasskeyStepUp({ identity, rpID, origin }: PasskeyStepUpDeps): PasskeyStepUp {
  return {
    async options(userId, sessionId) {
      const credentials = await identity.passkeyCredentials(userId);
      if (credentials.length === 0) return undefined;
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: 'required',
        timeout: PASSKEY_CHALLENGE_SECONDS * 1000,
        allowCredentials: credentials.map((each) => ({
          id: each.credentialId,
          transports: transportsOf(each.transports),
        })),
      });
      await identity.putPasskeyChallenge(
        sessionId,
        options.challenge,
        new Date(Date.now() + PASSKEY_CHALLENGE_SECONDS * 1000),
      );
      return {
        challenge: options.challenge,
        rpId: rpID,
        timeout: PASSKEY_CHALLENGE_SECONDS * 1000,
        userVerification: 'required',
        allowCredentials: credentials.map((each) => ({
          id: each.credentialId,
          type: 'public-key' as const,
          transports: transportsOf(each.transports),
        })),
      };
    },

    async check(userId, sessionId, response) {
      const challenge = await identity.takePasskeyChallenge(sessionId);
      if (challenge === undefined) return false;
      if (!userVerified(response.response.authenticatorData)) return false;
      const stored = await identity.passkeyByCredential(response.id);
      // Another person's passkey proves nothing about this one.
      if (stored === undefined || stored.userId !== userId) return false;
      try {
        const verification = await verifyAuthenticationResponse({
          response: {
            ...response,
            clientExtensionResults: {},
          },
          expectedChallenge: challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
          credential: {
            id: stored.credentialId,
            publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64')),
            counter: stored.counter,
            transports: transportsOf(stored.transports),
          },
        });
        if (!verification.verified) return false;
        await identity.passkeyUsed(stored.id, verification.authenticationInfo.newCounter);
        return true;
      } catch {
        // A bad signature, a counter that went back (a cloned key), a wrong origin: all a plain no.
        return false;
      }
    },
  };
}
