// The error map is the one place a code gets its status (spec 0005's Status
// codes line). These tests pin each family, so a code can't drift.
import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_MAP, ErrorCode, errorStatus, retryAfterSeconds } from './errors.ts';
import { ERROR_CODES } from './codes.ts';
import { ATTRIBUTE_VALUE_INVALID } from './values/attribute-values.ts';
import { ENGINE_REFUSAL_CODES } from './values/engine.ts';

describe('the error map', () => {
  it('gives every code a status, and has no entry without a code', () => {
    expect(Object.keys(ERROR_MAP).sort()).toEqual([...ErrorCode.options].sort());
  });

  it('covers every engine refusal code', () => {
    for (const code of ENGINE_REFUSAL_CODES) expect(ErrorCode.options).toContain(code);
  });

  it('lists the same codes in the Zod free list the browser reads, including the value refusal', () => {
    expect([...ERROR_CODES].sort()).toEqual([...ErrorCode.options].sort());
    expect(ENGINE_REFUSAL_CODES).toContain(ATTRIBUTE_VALUE_INVALID);
  });

  it.each([
    [400, ['INPUT_INVALID']],
    [401, ['UNAUTHENTICATED']],
    [403, ['EDGE_REQUIRED', 'FORBIDDEN_ORIGIN', 'SIGNUP_CLOSED', 'EMAIL_UNVERIFIED']],
    [404, ['NOT_FOUND']],
    [409, ['SLUG_TAKEN', 'UNIQUE_CONFLICT', 'ID_TAKEN', 'RECORD_DELETED', 'LIMIT_REACHED']],
    [413, ['PAYLOAD_TOO_LARGE']],
    [422, ['VALUE_REQUIRED', 'ATTRIBUTE_VALUE_INVALID', 'CONFIG_INVALID', 'FILTER_INVALID']],
    [429, ['RATE_LIMITED']],
    [503, ['QUERY_CANCELLED']],
    [500, ['INTERNAL']],
  ] as const)('answers %i for %j', (status, codes) => {
    for (const code of codes) expect(errorStatus(code)).toBe(status);
  });

  it('asks for a retry only on rate limits, too many reads at once and cancelled queries', () => {
    const retrying = Object.entries(ERROR_MAP)
      .filter(([, entry]) => 'retryAfterSeconds' in entry)
      .map(([code]) => code)
      .sort();
    expect(retrying).toEqual(['QUERY_CANCELLED', 'RATE_LIMITED', 'TOO_MANY_REQUESTS']);
    expect(retryAfterSeconds('QUERY_CANCELLED')).toBeGreaterThan(0);
    expect(retryAfterSeconds('TOO_MANY_REQUESTS')).toBe(1);
    expect(errorStatus('TOO_MANY_REQUESTS')).toBe(429);
    expect(retryAfterSeconds('INTERNAL')).toBeUndefined();
  });

  it('only uses error statuses', () => {
    for (const entry of Object.values(ERROR_MAP)) expect(entry.status).toBeGreaterThanOrEqual(400);
  });
});

describe('ApiError', () => {
  it('reads a refusal with its per attribute details', () => {
    const parsed = ApiError.parse({
      code: 'VALUE_REQUIRED',
      message: 'Name is required.',
      data: { refusals: [{ code: 'VALUE_REQUIRED', message: 'Name is required.', attributeId: 'a1' }] },
    });
    expect(parsed.data?.refusals?.[0]?.attributeId).toBe('a1');
  });

  it('reads input issues', () => {
    const parsed = ApiError.parse({
      code: 'INPUT_INVALID',
      message: 'Some of the input is invalid.',
      data: { issues: [{ path: ['values', 0], message: 'Expected a string.' }] },
    });
    expect(parsed.data?.issues).toHaveLength(1);
  });

  it('refuses a code outside the map', () => {
    expect(ApiError.safeParse({ code: 'TEAPOT', message: 'No.' }).success).toBe(false);
  });
});
