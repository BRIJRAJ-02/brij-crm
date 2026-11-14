// Small targets at the app's density keep WCAG 2.5.8's room (24 by 24, or a 24px circle on their centre that touches
// no other target), as axe measures it in the app's flows. Spec 0072's ported sizes drew two a little smaller at the
// app's density, and the circle then reached the target beside them (CI run 43536222784, 14 Nov 2026): a filter chip's
// remove (its 12px icon left it 23px wide) against its value (views.flow), and a record value's Copy (an 18px sm
// button, 2px after the link) against the value's link (record.flow and timeline.flow at 375).
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import preview from '../.storybook/preview.tsx';
import * as EmailStories from './fields/Email/Email.stories.tsx';
import * as FilterChipStories from './molecules/FilterChip/FilterChip.stories.tsx';

setProjectAnnotations(preview);

const { Default: Chip } = composeStories(FilterChipStories);
const { CopyOnPanel } = composeStories(EmailStories);

/** axe's target size check alone, over the page, as `node | summary` lines. */
async function targetSize(): Promise<readonly string[]> {
  const results = await axe.run(document.body, { runOnly: { type: 'rule', values: ['target-size'] } });
  return results.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${node.html} | ${node.failureSummary ?? ''}`),
  );
}

describe('small targets at the app’s density', () => {
  it('a filter chip’s remove keeps its room beside the value', async () => {
    await Chip.run();
    expect(document.documentElement.dataset.scale).toBe('app');
    expect(await targetSize()).toEqual([]);
  });

  it('a record value’s Copy keeps its 24px circle off the value’s link', async () => {
    await CopyOnPanel.run();
    expect(document.documentElement.dataset.scale).toBe('app');
    const copy = document.querySelector('button[aria-label^="Copy"]')?.getBoundingClientRect();
    const link = document.querySelector('a[href^="mailto:"]')?.getBoundingClientRect();
    expect(copy !== undefined && link !== undefined).toBe(true);
    if (copy === undefined || link === undefined) return;
    // From the Copy's centre to the link's nearest edge: at least half the 24px circle, as axe measured it in the
    // record flow's trace (its circle 22px across there).
    expect(copy.left + copy.width / 2 - link.right).toBeGreaterThanOrEqual(12);
  });
});
