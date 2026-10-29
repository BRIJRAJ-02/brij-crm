import type { BookingPageView } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { afterPageProblem } from './after-page.ts';

const DEMO = '0199f0a0-0000-7000-8000-0000000000d1';
const page = (status: 'live' | 'paused') => ({ id: DEMO, title: 'Demo', status }) as unknown as BookingPageView;
const sends = { after: { kind: 'booking' as const, bookingPageId: DEMO, countdownSeconds: 5, message: '' } };

describe('afterPageProblem (late trap #53)', () => {
  it('names a paused page, and a gone one only to a reader who sees every page', () => {
    expect(afterPageProblem(sends, [page('paused')], false)).toEqual({ kind: 'paused', page: page('paused') });
    expect(afterPageProblem(sends, [page('live')], true)).toBeUndefined();
    expect(afterPageProblem(sends, [], true)).toEqual({ kind: 'gone' });
    expect(afterPageProblem(sends, [], false)).toBeUndefined();
  });

  it('says nothing before the pages load, or for a form that shows a message', () => {
    expect(afterPageProblem(sends, undefined, true)).toBeUndefined();
    expect(afterPageProblem({ after: { kind: 'message', message: '' } }, [], true)).toBeUndefined();
    expect(afterPageProblem(undefined, [], true)).toBeUndefined();
  });
});
