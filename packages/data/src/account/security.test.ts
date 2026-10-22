// Account › Sign in and devices' state (spec 0033, milestone 2): read when held,
// made fresh at once by a step up, a refused step up answered, never thrown,
// and a code that wasn't sent said in plain words.
import type { AccountSecurity } from '@crm/contracts';
import { ORPCError } from '@orpc/client';
import { describe, expect, it } from 'vitest';
import { dataError, ERROR_MESSAGES } from '../errors.ts';
import { type AccountSecurityApi, createAccountSecurityStore, isFresh } from './security.ts';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const stale: AccountSecurity = {
  twoFactor: { on: true, backupCodesLeft: 9 },
  session: { withSecondFactor: false },
  requiredBy: [],
};
const FRESH = { freshUntil: new Date(NOW + 600_000).toISOString(), withSecondFactor: true };
/** A fake api: every call succeeds unless `overrides` says otherwise. */
const fakeApi = (overrides: Partial<AccountSecurityApi> = {}): AccountSecurityApi => ({
  get: () => Promise.resolve(stale),
  startStepUp: () => Promise.resolve({ sent: true }),
  verifyStepUp: () => Promise.resolve(FRESH),
  ...overrides,
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('account security store', () => {
  it('reads when held, and a step up makes the session fresh at once', async () => {
    const store = createAccountSecurityStore(fakeApi());
    const view = store.view();
    view.retain();
    await flush();
    expect(isFresh(view.getSnapshot(), NOW)).toBe(false);
    expect(await store.verify('totp', '123456')).toEqual({ ok: true });
    expect(isFresh(view.getSnapshot(), NOW)).toBe(true);
  });

  it('keeps the server’s words for a code that couldn’t be sent, and only the unexpected is generic', async () => {
    const notSent = 'We couldn’t send the code just now. Try again in a few minutes.';
    const store = (error: Error) => createAccountSecurityStore(fakeApi({ startStepUp: () => Promise.reject(error) }));
    expect(await store(new ORPCError('API_UNAVAILABLE', { status: 503, message: notSent })).sendCode()).toEqual({
      ok: false,
      code: 'API_UNAVAILABLE',
      message: notSent,
    });
    expect(
      await store(
        new ORPCError('RATE_LIMITED', { status: 429, message: 'Too many codes sent. Wait 7 minutes, then try again.' }),
      ).sendCode(),
    ).toMatchObject({ code: 'RATE_LIMITED', message: 'Too many codes sent. Wait 7 minutes, then try again.' });
    expect(
      await store(new ORPCError('INTERNAL', { status: 500, message: 'No mailer was given to this app.' })).sendCode(),
    ).toEqual({ ok: false, code: 'INTERNAL', message: ERROR_MESSAGES.internal });
  });

  it('answers a refused code with its message', async () => {
    const store = createAccountSecurityStore(
      fakeApi({
        startStepUp: () => Promise.reject(dataError('RATE_LIMITED', 'Too many codes sent.')),
        verifyStepUp: () => Promise.reject(dataError('CODE_INVALID', 'That code didn’t work.')),
      }),
    );
    expect(await store.verify('totp', '000000')).toEqual({
      ok: false,
      code: 'CODE_INVALID',
      message: 'That code didn’t work.',
    });
    expect(await store.sendCode()).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });
});
