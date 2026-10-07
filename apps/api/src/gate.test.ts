// The read gate on its own: places per workspace, freed however the work ends.
import { describe, expect, it } from 'vitest';
import { createReadGate, TOO_MANY_READS } from './gate.ts';

/** A promise and the functions that settle it. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('the read gate', () => {
  it('admits a set number per workspace, refuses the next with 429, and leaves other workspaces alone', async () => {
    const gate = createReadGate(2);
    const held = deferred<string>();
    const running = [gate.run('a', () => held.promise), gate.run('a', () => held.promise)];
    await expect(gate.run('a', () => Promise.resolve('third'))).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      status: 429,
      message: TOO_MANY_READS,
    });
    expect(await gate.run('b', () => Promise.resolve('other workspace'))).toBe('other workspace');
    held.resolve('done');
    expect(await Promise.all(running)).toEqual(['done', 'done']);
    expect(gate.inFlight('a')).toBe(0);
  });

  it('frees the place when the work fails or throws at once', async () => {
    const gate = createReadGate(1);
    const failing = deferred<never>();
    const run = gate.run('a', () => failing.promise);
    expect(gate.inFlight('a')).toBe(1);
    failing.reject(new Error('cancelled'));
    await expect(run).rejects.toThrow('cancelled');
    await expect(
      gate.run('a', () => {
        throw new Error('at once');
      }),
    ).rejects.toThrow('at once');
    expect(gate.inFlight('a')).toBe(0);
    expect(await gate.run('a', () => Promise.resolve(1))).toBe(1);
  });
});
