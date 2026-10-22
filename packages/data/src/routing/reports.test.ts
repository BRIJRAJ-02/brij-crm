import { describe, expect, it } from 'vitest';
import type { RoutingReport } from '@crm/contracts';
import { createRoutingReports, REPORT_RETURN_GAP_MS, type RoutingReportSurface } from './reports.ts';

const PAGE: RoutingReportSurface = { kind: 'booking_page', pageId: '019a0000-0000-7000-8000-000000000001' };

function report(noShow: number): RoutingReport {
  return { days: 30, rows: [{ matched: 2, booked: 2, noShow, qualified: 0, notQualified: 0 }] };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const calls: string[] = [];
  let noShow = 0;
  let time = 0;
  let returned: (() => void) | undefined;
  const store = createRoutingReports({
    report: (workspace, surface, days) => {
      calls.push(`${workspace}:${surface.kind}:${String(days)}`);
      return Promise.resolve(report(noShow));
    },
    onReturn: (refresh) => {
      returned = refresh;
      return () => {
        returned = undefined;
      };
    },
    now: () => time,
  });
  return {
    store,
    calls,
    setNoShow: (count: number) => {
      noShow = count;
    },
    advance: (ms: number) => {
      time += ms;
    },
    comeBack: () => returned?.(),
  };
}

describe('routing reports', () => {
  it('reads nothing until a screen holds it, and hands every screen the same handle', async () => {
    const { store, calls } = setup();
    const view = store.view('acme', PAGE, 30);
    expect(store.view('acme', PAGE, 30)).toBe(view);
    await flush();
    expect(calls).toEqual([]);
    const release = view.retain();
    await flush();
    expect(calls).toEqual(['acme:booking_page:30']);
    expect(view.getSnapshot()).toMatchObject({ status: 'ready' });
    release();
  });

  it('reads a held report again after a no show lands in its workspace, and drops an unheld one', async () => {
    const { store, calls, setNoShow } = setup();
    const view = store.view('acme', PAGE, 30);
    const release = view.retain();
    const other = store.view('other', PAGE, 30);
    other.retain();
    await flush();
    setNoShow(1);
    store.reloadWorkspace('acme');
    await flush();
    expect(calls.filter((call) => call.startsWith('acme'))).toHaveLength(2);
    expect(calls.filter((call) => call.startsWith('other'))).toHaveLength(1);
    const state = view.getSnapshot();
    expect(state.status === 'ready' ? state.report.rows[0]?.noShow : undefined).toBe(1);
    release();
    store.reloadWorkspace('acme');
    expect(store.view('acme', PAGE, 30)).not.toBe(view);
  });

  it('reads again on coming back only after the gap', async () => {
    const { store, calls, advance, comeBack } = setup();
    const release = store.view('acme', PAGE, 90).retain();
    await flush();
    comeBack();
    await flush();
    expect(calls).toHaveLength(1);
    advance(REPORT_RETURN_GAP_MS);
    comeBack();
    await flush();
    expect(calls).toHaveLength(2);
    release();
  });
});
