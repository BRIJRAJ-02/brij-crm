// The migration journal's order rules (see journal.ts), and the committed journal keeping them.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Journal, journalProblems } from './journal.ts';

const entry = (idx: number, when: number, slug = 'step') => ({
  idx,
  when,
  tag: `${String(idx).padStart(4, '0')}_${slug}`,
});

describe('the migration journal', () => {
  it('keeps the order rules as committed', () => {
    const journal = Journal.parse(
      JSON.parse(readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')),
    );
    expect(journalProblems(journal)).toEqual([]);
  });

  it('refuses a stamp no later than the one before, a gap in the indexes and a tag off its index', () => {
    const problems = journalProblems({ entries: [entry(0, 10), entry(1, 10), { idx: 3, when: 30, tag: '0003_x' }] });
    expect(problems).toHaveLength(3);
  });

  it('refuses a new migration stamped before the base it lands on, which a deployed database would skip', () => {
    const base = { entries: [entry(0, 10), entry(1, 20)] };
    expect(journalProblems({ entries: [entry(0, 10), entry(1, 20), entry(2, 30)] }, base)).toEqual([]);
    expect(journalProblems({ entries: [entry(0, 10), entry(1, 15), entry(2, 30)] }, base)).toEqual([
      '0001_step was already committed and must stay as it was, at position 1.',
    ]);
    const skipped = { entries: [entry(0, 5), entry(1, 10), entry(2, 20)] };
    expect(journalProblems(skipped, { entries: [entry(0, 10), entry(1, 20)] })).toContain(
      '0002_step is new but stamped before 0001_step, so a database that has it would skip it.',
    );
  });
});
