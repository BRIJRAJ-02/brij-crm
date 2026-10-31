import { describe, expect, it, vi } from 'vitest';
import { createRecordFactsStore, type RecordFactsApi } from './facts.ts';

const meeting = (startsAt: string, endsAt: string, status: 'confirmed' | 'cancelled' = 'confirmed') => ({
  id: '01900000-0000-7000-8000-000000000001',
  title: 'Renewal call',
  startsAt,
  endsAt,
  allDay: false,
  status,
  isPrivate: false,
  detailsHidden: false,
  attendees: [],
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('record facts', () => {
  it('reads the next meeting and the stage age when held, and again each time it is held', async () => {
    const api: RecordFactsApi = {
      meetings: vi.fn(() =>
        Promise.resolve({ items: [meeting('2026-10-23T09:00:00.000Z', '2026-10-23T09:30:00.000Z')] }),
      ),
      stageSince: vi.fn(() => Promise.resolve({ since: '2026-10-01T08:00:00.000Z' })),
      lastContacted: vi.fn(() => Promise.resolve({ at: '2026-10-21T15:00:00.000Z' })),
    };
    const store = createRecordFactsStore({ api, now: () => '2026-10-22T12:00:00.000Z' });
    const facts = store.forRecord('acme', 'r1', 'stage');
    expect(facts.getSnapshot().status).toBe('loading');
    const release = facts.retain();
    await flush();
    expect(facts.getSnapshot()).toEqual({
      status: 'ready',
      nextMeeting: { title: 'Renewal call', startsAt: '2026-10-23T09:00:00.000Z' },
      stageSince: '2026-10-01T08:00:00.000Z',
      lastContacted: '2026-10-21T15:00:00.000Z',
    });
    expect(store.forRecord('acme', 'r1', 'stage')).toBe(facts);
    const again = facts.retain();
    await flush();
    expect(api.meetings).toHaveBeenCalledTimes(2);
    again();
    release();
  });

  it('has no next meeting when the first is over or cancelled, and asks no stage without an attribute', async () => {
    const api: RecordFactsApi = {
      meetings: vi.fn(() =>
        Promise.resolve({ items: [meeting('2026-10-20T09:00:00.000Z', '2026-10-20T09:30:00.000Z')] }),
      ),
      stageSince: vi.fn(() => Promise.resolve({})),
      lastContacted: vi.fn(() => Promise.resolve({})),
    };
    const store = createRecordFactsStore({ api, now: () => '2026-10-22T12:00:00.000Z' });
    const facts = store.forRecord('acme', 'r2');
    facts.retain();
    await flush();
    expect(facts.getSnapshot()).toEqual({ status: 'ready' });
    expect(api.stageSince).not.toHaveBeenCalled();
  });

  it('reads again under a new key, showing what the record showed meanwhile', async () => {
    let at = '2026-10-21T15:00:00.000Z';
    const api: RecordFactsApi = {
      meetings: () => Promise.resolve({ items: [] }),
      stageSince: () => Promise.resolve({}),
      lastContacted: vi.fn(() => Promise.resolve({ at })),
    };
    const store = createRecordFactsStore({ api, now: () => '2026-10-22T12:00:00.000Z' });
    const first = store.forRecord('acme', 'r3', undefined, 'a');
    const release = first.retain();
    await flush();
    at = '2026-10-22T11:00:00.000Z';
    const next = store.forRecord('acme', 'r3', undefined, 'b');
    expect(next.getSnapshot()).toEqual({ status: 'ready', lastContacted: '2026-10-21T15:00:00.000Z' });
    next.retain();
    release();
    await flush();
    expect(next.getSnapshot()).toEqual({ status: 'ready', lastContacted: '2026-10-22T11:00:00.000Z' });
  });

  it('says it failed when its first read does', async () => {
    const api: RecordFactsApi = {
      meetings: () => Promise.reject(new Error('offline')),
      stageSince: () => Promise.resolve({}),
      lastContacted: () => Promise.resolve({}),
    };
    const facts = createRecordFactsStore({ api, now: () => '2026-10-22T12:00:00.000Z' }).forRecord('acme', 'r3');
    facts.retain();
    await flush();
    expect(facts.getSnapshot().status).toBe('error');
  });
});
