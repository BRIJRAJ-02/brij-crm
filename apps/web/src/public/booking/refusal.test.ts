// The booking refusal's sentence: the server's own when a visitor can read it, else none.
import { describe, expect, it } from 'vitest';
import { refusalLine } from './refusal.ts';

describe('refusalLine', () => {
  it('keeps a sentence that says what to do', async () => {
    expect(await refusalLine('Pick a time zone from the list.', { timeZone: 'Pick a time zone from the list.' })).toBe(
      'Pick a time zone from the list.',
    );
    expect(await refusalLine('Invite at most 10 guests.', { guests: 'Invite at most 10 guests.' })).toBe(
      'Invite at most 10 guests.',
    );
    expect(await refusalLine('Give a number to call you on.', { phone: 'Give a number to call you on.' })).toBe(
      'Give a number to call you on.',
    );
  });

  it('leaves out the start time’s sentence, which is written for developers', async () => {
    const start = 'Give the time in UTC with milliseconds, such as 2026-10-01T09:30:00.000Z.';
    expect(await refusalLine(start, { start })).toBeUndefined();
    expect(await refusalLine('Pick a time zone from the list.', { timeZone: 'x', start })).toBeUndefined();
  });

  it('leaves out the safety net’s sentences, which name no field', async () => {
    expect(await refusalLine('This isn’t in the right format.', { idempotencyKey: 'x' })).toBeUndefined();
    expect(await refusalLine('Use 4,096 characters or fewer.', { prefill: 'x' })).toBeUndefined();
  });
});
