// Account › Sign in and devices' state (spec 0033, milestones 2 and 3): read when held,
// made fresh at once by a step up (a code or a passkey), a refused step up
// answered, never thrown, and passkeys renamed and removed at once, put back
// when refused.
import type { AccountSecurity, PasskeyAssertion } from '@crm/contracts';
import { ORPCError } from '@orpc/client';
import { describe, expect, it } from 'vitest';
import { dataError, ERROR_MESSAGES } from '../errors.ts';
import { type AccountSecurityApi, createAccountSecurityStore, isFresh } from './security.ts';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const PASSKEY = { id: '0199a6f2-0000-7000-8000-00000000000a', name: 'MacBook', createdAt: '2026-10-20T10:00:00.000Z' };
const stale: AccountSecurity = {
  twoFactor: { on: true, backupCodesLeft: 9 },
  passkeys: [PASSKEY],
  session: { withSecondFactor: false },
  requiredBy: [],
};
const FRESH = { freshUntil: new Date(NOW + 600_000).toISOString(), withSecondFactor: true };
const ASSERTION: PasskeyAssertion = {
  id: 'cred',
  rawId: 'cred',
  type: 'public-key',
  response: { clientDataJSON: 'a', authenticatorData: 'b', signature: 'c' },
  clientExtensionResults: {},
};

/** A fake api: every call succeeds unless `overrides` says otherwise. */
const fakeApi = (overrides: Partial<AccountSecurityApi> = {}): AccountSecurityApi => ({
  get: () => Promise.resolve(stale),
  startStepUp: () => Promise.resolve({ sent: true }),
  verifyStepUp: () => Promise.resolve(FRESH),
  passkeyOptions: () => Promise.resolve({ options: { challenge: 'xyz' } }),
  passkeyAssertion: () => Promise.resolve(ASSERTION),
  verifyPasskey: () => Promise.resolve(FRESH),
  renamePasskey: ({ name }) => Promise.resolve({ ...PASSKEY, name }),
  removePasskey: () => Promise.resolve({ ok: true }),
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

  it('steps up with a passkey, and answers a closed prompt as cancelled', async () => {
    let verified = false;
    const store = createAccountSecurityStore(
      fakeApi({
        get: () => Promise.resolve(verified ? { ...stale, session: FRESH } : stale),
        verifyPasskey: () => {
          verified = true;
          return Promise.resolve(FRESH);
        },
      }),
    );
    const view = store.view();
    view.retain();
    await flush();
    expect(await store.verifyPasskey()).toEqual({ ok: true });
    expect(isFresh(view.getSnapshot(), NOW)).toBe(true);

    const closed = createAccountSecurityStore(fakeApi({ passkeyAssertion: () => Promise.resolve('cancelled') }));
    expect(await closed.verifyPasskey()).toEqual({ ok: false, code: 'CANCELLED' });
  });

  it('renames at once, and puts the old name back when refused', async () => {
    let refuse = false;
    const store = createAccountSecurityStore(
      fakeApi({
        renamePasskey: ({ name }) =>
          refuse ? Promise.reject(dataError('NOT_FOUND', 'Gone.')) : Promise.resolve({ ...PASSKEY, name }),
      }),
    );
    const view = store.view();
    view.retain();
    await flush();
    const renaming = store.renamePasskey(PASSKEY.id, 'Work laptop');
    expect(view.getSnapshot()).toMatchObject({ passkeys: [{ name: 'Work laptop' }] });
    expect(await renaming).toEqual({ ok: true });
    refuse = true;
    expect(await store.renamePasskey(PASSKEY.id, 'Other')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(view.getSnapshot()).toMatchObject({ passkeys: [{ name: 'Work laptop' }] });
  });

  it('removes at once, and puts it back when the server wants a step up first', async () => {
    const store = createAccountSecurityStore(
      fakeApi({ removePasskey: () => Promise.reject(dataError('STEP_UP_REQUIRED', 'Confirm it’s you first.')) }),
    );
    const view = store.view();
    view.retain();
    await flush();
    const removing = store.removePasskey(PASSKEY.id);
    expect(view.getSnapshot()).toMatchObject({ passkeys: [] });
    expect(await removing).toMatchObject({ ok: false, code: 'STEP_UP_REQUIRED' });
    expect(view.getSnapshot()).toMatchObject({ passkeys: [PASSKEY] });
  });
});
