import { describe, expect, it } from 'vitest';
import type { InsightSession } from '@crm/contracts';
import { createInsightsStore, INSIGHT_SESSIONS_MAX, type InsightSessionsState } from './store.ts';

/** A page of 50 sessions after `at`, always with more behind it. */
const page = (at: number) => ({
  items: Array.from({ length: 50 }, (_, index): InsightSession => ({
    id: `s${String(at + index)}`,
    at: '2026-11-04T10:00:00.000Z',
    pageKind: 'form',
    pageId: '0190a0a0-0000-7000-8000-000000000001',
    pageName: 'Enquiry',
    finished: false,
    source: 'direct',
    furthestStep: 'view',
  })),
  nextCursor: String(at + 50),
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the sessions table (spec 0067, AC-6715)', () => {
  it('holds at most 500 sessions, then stops More and says it is capped', async () => {
    let reads = 0;
    const store = createInsightsStore({
      read: () => Promise.reject(new Error('not asked')),
      sessions: (_workspace, query) => {
        reads += 1;
        return Promise.resolve(page(Number(query.cursor ?? '0')));
      },
      listShares: () => Promise.resolve({ shares: [] }),
      createShare: () => Promise.reject(new Error('not asked')),
      revokeShare: () => Promise.reject(new Error('not asked')),
      onReturn: () => () => undefined,
    });
    const view = store.sessions('acme', { range: '30' }, {}, {});
    const release = view.retain();
    await settle();
    for (let more = 0; more < 15; more += 1) {
      view.more();
      await settle();
    }
    const state: InsightSessionsState = view.getSnapshot();
    expect(state).toMatchObject({ status: 'ready', hasMore: false, isCapped: true });
    expect(state.status === 'ready' ? state.items.length : 0).toBe(INSIGHT_SESSIONS_MAX);
    // Past the cap, More asks for nothing.
    const asked = reads;
    view.more();
    await settle();
    expect(reads).toBe(asked);
    release();
  });
});
