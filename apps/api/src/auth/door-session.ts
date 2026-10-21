// What the access door asks of a session (spec 0033, milestone 4): when it
// last proved who it is, and whether its person has a second factor. The
// passkey read runs only if the door asks, in a workspace that requires two
// factor, and at most once a request.
import type { DoorSession } from '@crm/core';
import type { IdentityStore } from '@crm/db';
import type { AuthSession } from './auth.ts';

/** The door's view of `session`: its last proof, and a second factor (the app, else a passkey) read when asked. */
export function doorSession(
  session: Pick<AuthSession, 'user' | 'verifiedAt' | 'twoFactorEnabled'>,
  identity: Pick<IdentityStore, 'hasPasskey'>,
): DoorSession {
  let asked: Promise<boolean> | undefined;
  return {
    verifiedAt: session.verifiedAt,
    hasSecondFactor: () => {
      asked ??= session.twoFactorEnabled ? Promise.resolve(true) : identity.hasPasskey(session.user.id);
      return asked;
    },
  };
}
