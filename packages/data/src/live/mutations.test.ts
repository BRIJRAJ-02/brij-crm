// This tab's writes waiting for their echo (spec 0005): each is known until
// its echo, its refusal, or 5 minutes.
import { describe, expect, it } from 'vitest';
import { createMutationLog, ECHO_WAIT_MS } from './mutations.ts';

describe('the mutation log', () => {
  it('knows a sent write until its echo, once', () => {
    const log = createMutationLog();
    log.sent('a');
    expect(log.echoed('b')).toBe(false);
    expect(log.echoed(undefined)).toBe(false);
    expect(log.echoed('a')).toBe(true);
    expect(log.echoed('a')).toBe(false);
  });

  it('forgets a refused write, and every write on clear', () => {
    const log = createMutationLog();
    log.sent('a');
    log.sent('b');
    log.forget('a');
    expect(log.echoed('a')).toBe(false);
    log.clear();
    expect(log.echoed('b')).toBe(false);
  });

  it('lets go of a write whose echo never came after 5 minutes', () => {
    let now = 0;
    const log = createMutationLog(() => now);
    log.sent('quiet');
    now = ECHO_WAIT_MS + 1;
    log.sent('next');
    expect(log.echoed('quiet')).toBe(false);
    expect(log.echoed('next')).toBe(true);
  });
});
