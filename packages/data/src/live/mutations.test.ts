// This tab's writes whose echoes are due (spec 0006, AC-60): each is known
// from its send until its answer, then until the answer's `echoes` have come
// or 60 seconds have passed, whichever is first.
import { describe, expect, it } from 'vitest';
import { createMutationLog, ECHO_TTL_MS, UNANSWERED_MS } from './mutations.ts';

describe('the mutation log', () => {
  it('skips echoes from the send until the answer, and as many after it as the answer names', () => {
    const log = createMutationLog();
    log.sent('a');
    expect(log.echoed('b', 1)).toBe(false);
    expect(log.echoed(undefined, 1)).toBe(false);
    // An echo can beat the answer: it counts.
    expect(log.echoed('a', 1)).toBe(true);
    // The write touched two objects: two events carry it.
    log.answered('a', 2);
    expect(log.echoed('a', 2)).toBe(true);
    expect(log.echoed('a', 3)).toBe(false);
    expect(log.size()).toBe(0);
  });

  it('counts a repeated seq once', () => {
    const log = createMutationLog();
    log.sent('a');
    log.answered('a', 2);
    expect(log.echoed('a', 7)).toBe(true);
    expect(log.echoed('a', 7)).toBe(true);
    expect(log.size()).toBe(1);
    expect(log.echoed('a', 8)).toBe(true);
    expect(log.size()).toBe(0);
  });

  it('drops an id at once when its answer names no echo (nothing changed)', () => {
    const log = createMutationLog();
    log.sent('a');
    log.answered('a', 0);
    expect(log.size()).toBe(0);
    expect(log.echoed('a', 1)).toBe(false);
  });

  it('drops an id 60 seconds after its answer when an echo never comes', () => {
    let now = 0;
    const log = createMutationLog(() => now);
    log.sent('a');
    now = 30_000;
    log.answered('a', 1);
    now = 30_000 + ECHO_TTL_MS;
    expect(log.echoed('a', 1)).toBe(true);
    log.sent('b');
    log.answered('b', 1);
    now += ECHO_TTL_MS + 1;
    expect(log.echoed('b', 2)).toBe(false);
  });

  it('keeps an unanswered write while it is out, up to 5 minutes', () => {
    let now = 0;
    const log = createMutationLog(() => now);
    log.sent('slow');
    now = UNANSWERED_MS - 1;
    expect(log.size()).toBe(1);
    now = UNANSWERED_MS + 1;
    log.sent('next');
    expect(log.echoed('slow', 1)).toBe(false);
  });

  it('forgets a refused write, and every write on clear', () => {
    const log = createMutationLog();
    log.sent('a');
    log.sent('b');
    log.forget('a');
    expect(log.echoed('a', 1)).toBe(false);
    log.clear();
    expect(log.echoed('b', 1)).toBe(false);
  });
});
