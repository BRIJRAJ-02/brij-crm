// Routing › Insights' two judgements (spec 0037, AC-1389): which way the comparison went, and the words that say
// so. A direction blind verdict would state a page where the ranking is **hurting** as confidently, and as
// greenly, as one where it helps, which is the one case a manager most needs to act on.
import { describe, expect, it } from 'vitest';
import type { InsightsPage } from '@crm/data';
import { verdictOf } from './InsightsTab.tsx';
import { insightsStrings as strings } from './insights-strings.ts';

/** One page's comparison, with everything the verdict doesn't read left empty. */
function page(over: { changed: number; holdout: number; isCertain: boolean }): InsightsPage {
  const arm = (rate: number) => ({ trials: 100, successes: Math.round(rate * 100), rate, low: 0, high: 1 });
  return {
    pageId: '00000000-0000-0000-0000-0000000000aa',
    name: 'Sales intro call',
    objective: 'deal',
    ranked: 100,
    cells: [],
    changed: arm(over.changed),
    leftAlone: arm(over.changed),
    holdout: arm(over.holdout),
    isCertain: over.isCertain,
  };
}

describe('which way the comparison went (AC-1389)', () => {
  it('is ahead only when the ranking is certainly better', () => {
    expect(verdictOf(page({ changed: 0.42, holdout: 0.35, isCertain: true }))).toBe('ahead');
  });

  it('is behind when the ranking is certainly worse, never a confident green', () => {
    expect(verdictOf(page({ changed: 0.28, holdout: 0.46, isCertain: true }))).toBe('behind');
  });

  it('is unsure while the arms overlap, whichever way they lean', () => {
    expect(verdictOf(page({ changed: 0.42, holdout: 0.35, isCertain: false }))).toBe('unsure');
    expect(verdictOf(page({ changed: 0.28, holdout: 0.46, isCertain: false }))).toBe('unsure');
  });
});

describe('the words the verdict uses', () => {
  it('says which way it went, and only hedges when it is unsure', () => {
    expect(strings.verdict('42%', '35%', 'ahead')).toBe('Smart routing is ahead: 42% against 35% without it.');
    expect(strings.verdict('28%', '46%', 'behind')).toBe('Smart routing is behind: 28% against 46% without it.');
    expect(strings.verdict('42%', '35%', 'unsure')).toContain('not enough meetings to be sure yet');
  });

  it('writes a rep’s gap to the team in signed points, never as a share', () => {
    expect(strings.points(0.06)).toBe('+6 pts');
    expect(strings.points(-0.06)).toBe('−6 pts');
    expect(strings.points(0)).toBe('0 pts');
  });
});
