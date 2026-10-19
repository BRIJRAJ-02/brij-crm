// The busy cache (spec 0025): an answer kept for its minute, failures asked
// again, the oldest dropped past the limit, and `fresh` reading past it.
import { describe, expect, it } from 'vitest';
import { createBusyCache, NO_CALENDAR, type BusyAnswer, type BusyReader } from './calendar.ts';

const request = { workspaceId: 'w', memberId: 'm', from: '2026-11-02T00:00:00.000Z', to: '2026-11-03T00:00:00.000Z' };

function counting(answers: readonly BusyAnswer[]) {
  let calls = 0;
  const reader: BusyReader = () =>
    Promise.resolve(answers[Math.min(calls++, answers.length - 1)] ?? { status: 'none' });
  return { reader, calls: () => calls };
}

describe('createBusyCache', () => {
  it('keeps a read for its minute, then asks again', async () => {
    let clock = 0;
    const source = counting([{ status: 'read', busy: [] }]);
    const cache = createBusyCache(source.reader, { now: () => clock });
    await cache(request);
    await cache(request);
    expect(source.calls()).toBe(1);
    clock = 60_000;
    await cache(request);
    expect(source.calls()).toBe(2);
    await cache.fresh(request);
    expect(source.calls()).toBe(3);
  });

  it('never keeps a failure, and drops the oldest past its limit', async () => {
    const failing = counting([{ status: 'unavailable' }, { status: 'blocked' }, { status: 'none' }]);
    const cache = createBusyCache(failing.reader);
    expect(await cache(request)).toEqual({ status: 'unavailable' });
    expect(await cache(request)).toEqual({ status: 'blocked' });
    expect(await cache(request)).toEqual({ status: 'none' });
    expect(failing.calls()).toBe(3);
    const source = counting([{ status: 'none' }]);
    const small = createBusyCache(source.reader, { max: 1 });
    await small(request);
    await small({ ...request, memberId: 'other' });
    await small(request);
    expect(source.calls()).toBe(3);
  });

  it('answers no calendar and makes no event without calendar sync', async () => {
    expect(await NO_CALENDAR.busy(request)).toEqual({ status: 'none' });
    expect(await NO_CALENDAR.events({} as never)).toEqual({});
  });
});
