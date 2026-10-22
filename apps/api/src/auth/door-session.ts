// What the access door asks of a session (spec 0033, milestone 4): when it
// last proved who it is, and whether its person has a second factor (the
// authenticator app; passkeys were taken out on 22 October 2026).
import type { DoorSession } from '@crm/core';
import type { AuthSession } from './auth.ts';

/** The door's view of `session`: its last proof, and whether its person has the authenticator app on. */
export function doorSession(session: Pick<AuthSession, 'verifiedAt' | 'twoFactorEnabled'>): DoorSession {
  return {
    verifiedAt: session.verifiedAt,
    hasSecondFactor: () => Promise.resolve(session.twoFactorEnabled),
  };
}
