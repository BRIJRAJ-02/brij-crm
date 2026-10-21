// Account › Security's state (spec 0033, milestone 2): read when held, made
// fresh at once by a step up, and a refused step up answered, never thrown.
import type { AccountSecurity } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { dataError } from '../errors.ts';
import { createAccountSecurityStore, isFresh } from './security.ts';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const stale: AccountSecurity = { twoFactor: { on: true, backupCodesLeft: 9 }, session: { withSecondFactor: false } };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('account security store', () => {
  it('reads when held, and a step up makes the session fresh at once', async () => {
    const store = createAccountSecurityStore({
      get: () => Promise.resolve(stale),
      startStepUp: () => Promise.resolve({ sent: true }),
      verifyStepUp: () =>
        Promise.resolve({ freshUntil: new Date(NOW + 600_000).toISOString(), withSecondFactor: true }),
    });
    const view = store.view();
    view.retain();
    await flush();
    expect(isFresh(view.getSnapshot(), NOW)).toBe(false);
    expect(await store.verify('totp', '123456')).toEqual({ ok: true });
    expect(isFresh(view.getSnapshot(), NOW)).toBe(true);
  });

  it('answers a refused code with its message', async () => {
    const store = createAccountSecurityStore({
      get: () => Promise.resolve(stale),
      startStepUp: () => Promise.reject(dataError('RATE_LIMITED', 'Too many codes sent.')),
      verifyStepUp: () => Promise.reject(dataError('CODE_INVALID', 'That code didn’t work.')),
    });
    expect(await store.verify('totp', '000000')).toEqual({
      ok: false,
      code: 'CODE_INVALID',
      message: 'That code didn’t work.',
    });
    expect(await store.sendCode()).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });
});
