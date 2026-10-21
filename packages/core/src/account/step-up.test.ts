// The step up (spec 0033, AC-885, AC-896) against a fake identity store: fresh
// for 10 minutes after a check, a second factor needed to turn two factor
// off, an email code only while two factor is off, and a wrong code refused.
import { describe, expect, it } from 'vitest';
import type { SessionVerification, VerifiedWith } from '@crm/db';
import { requireFresh, sessionFreshness, startStepUp, verifyStepUp, type StepUpDeps } from './step-up.ts';

const USER = '0199a6f2-0000-7000-8000-000000000001';
const SESSION = '0199a6f2-0000-7000-8000-000000000002';
const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const caller = { userId: USER, sessionId: SESSION };

function setup(state: { enabled: boolean; verification?: SessionVerification }) {
  let verification = state.verification;
  const sent: string[] = [];
  const codes = new Map<string, string>();
  const deps: StepUpDeps = {
    identity: {
      sessionVerification: () => Promise.resolve(verification),
      markSessionVerified: (_user, _session, verifiedWith: VerifiedWith) => {
        verification = { at: new Date(NOW).toISOString(), with: verifiedWith };
        return Promise.resolve(true);
      },
      twoFactorState: () => Promise.resolve({ enabled: state.enabled, appVerified: state.enabled }),
      putStepUpCode: (session, hash) => {
        codes.set(session, hash);
        return Promise.resolve();
      },
      checkStepUpCode: (session, hash) => Promise.resolve(codes.get(session) === hash ? 'ok' : 'wrong'),
    },
    checkSecondFactor: (_user, _method, code) => Promise.resolve(code === '123456'),
    backupCodesLeft: () => Promise.resolve(10),
    sendCode: (_email, code) => {
      sent.push(code);
      return Promise.resolve();
    },
    mintCode: () => '654321',
    hashCode: (code) => `hash:${code}`,
    now: () => NOW,
  };
  return { deps, sent };
}

const minutesAgo = (minutes: number, by: VerifiedWith = 'email'): SessionVerification => ({
  at: new Date(NOW - minutes * 60_000).toISOString(),
  with: by,
});

describe('the step up', () => {
  it('is fresh for 10 minutes after a check, and not after', async () => {
    expect(
      (await sessionFreshness(setup({ enabled: false, verification: minutesAgo(9) }).deps, caller)).freshUntil,
    ).toBe(new Date(NOW + 60_000).toISOString());
    const stale = setup({ enabled: false, verification: minutesAgo(11) }).deps;
    await expect(requireFresh(stale, caller)).rejects.toMatchObject({ refusal: { code: 'STEP_UP_REQUIRED' } });
  });

  it('needs a second factor to turn two factor off', async () => {
    const byEmail = setup({ enabled: true, verification: minutesAgo(1) }).deps;
    await expect(requireFresh(byEmail, caller, { secondFactor: true })).rejects.toMatchObject({
      refusal: { code: 'SECOND_FACTOR_REQUIRED' },
    });
    const byApp = setup({ enabled: true, verification: minutesAgo(1, 'second_factor') }).deps;
    await expect(requireFresh(byApp, caller, { secondFactor: true })).resolves.toBeUndefined();
  });

  it('checks an app code while two factor is on, and refuses an email code then', async () => {
    const { deps } = setup({ enabled: true });
    await expect(verifyStepUp(deps, caller, { method: 'totp', code: '000000' })).rejects.toMatchObject({
      refusal: { code: 'CODE_INVALID' },
    });
    await expect(verifyStepUp(deps, caller, { method: 'email', code: '654321' })).rejects.toMatchObject({
      inputProblem: { field: 'method' },
    });
    expect(await verifyStepUp(deps, caller, { method: 'totp', code: '123456' })).toMatchObject({
      withSecondFactor: true,
    });
  });

  it('emails a code while two factor is off, and takes it back once', async () => {
    const { deps, sent } = setup({ enabled: false });
    await startStepUp(deps, { ...caller, email: 'ada@example.com' });
    expect(sent).toEqual(['654321']);
    await expect(verifyStepUp(deps, caller, { method: 'email', code: '111111' })).rejects.toMatchObject({
      refusal: { code: 'CODE_INVALID' },
    });
    expect(await verifyStepUp(deps, caller, { method: 'email', code: '654321' })).toMatchObject({
      withSecondFactor: false,
      freshUntil: new Date(NOW + 10 * 60_000).toISOString(),
    });
  });
});
