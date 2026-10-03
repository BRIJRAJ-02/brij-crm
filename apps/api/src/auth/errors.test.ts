// Better Auth's error answers, rewritten into the shared `{ code, message }`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureLogs } from '../testing.ts';
import { authErrorResponse } from './errors.ts';

let logs: ReturnType<typeof captureLogs>;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => logs.restore());

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('authErrorResponse', () => {
  it('passes success through untouched', async () => {
    const ok = answer(200, { success: true }, { 'set-cookie': 'a=b' });
    expect(await authErrorResponse(ok)).toBe(ok);
  });

  it("turns its limiter's 429 into RATE_LIMITED with Retry-After", async () => {
    const limited = await authErrorResponse(
      answer(429, { message: 'Too many requests. Please try again later.' }, { 'x-retry-after': '42' }),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('42');
    expect(limited.headers.get('x-retry-after')).toBeNull();
    expect(await limited.json()).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
    });
  });

  it('keeps its codes with plain sentences, and keeps cookies it sets', async () => {
    const wrong = await authErrorResponse(
      answer(400, { code: 'INVALID_OTP', message: 'Invalid OTP', extra: 'dropped' }, { 'set-cookie': 'x=; Max-Age=0' }),
    );
    expect(wrong.status).toBe(400);
    expect(wrong.headers.getSetCookie()).toEqual(['x=; Max-Age=0']);
    expect(await wrong.json()).toEqual({
      code: 'INVALID_OTP',
      message: "That code isn't right. Check it, or send a new one.",
    });
  });

  it('gives a refusal without a code one from its status', async () => {
    expect(await (await authErrorResponse(answer(404, undefined))).json()).toEqual({
      code: 'NOT_FOUND',
      message: 'This request was refused.',
    });
    expect(await (await authErrorResponse(answer(401, { message: 'Unauthorized' }))).json()).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Unauthorized',
    });
  });

  it('answers a fault as INTERNAL with no detail, and logs it', async () => {
    const fault = await authErrorResponse(answer(500, { message: 'relation auth.session does not exist' }));
    expect(fault.status).toBe(500);
    expect(await fault.json()).toEqual({ code: 'INTERNAL', message: 'Something went wrong. Try again.' });
    expect(logs.lines()).toContainEqual(expect.objectContaining({ level: 'error', message: 'Sign in route failed' }));
  });
});
