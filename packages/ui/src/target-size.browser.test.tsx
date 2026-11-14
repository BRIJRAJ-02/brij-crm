// Small targets at the app's density keep WCAG 2.5.8's room (24 by 24, or a 24px circle on their centre that touches
// no other target), as axe measures it in the app's flows. Spec 0072's ported small icon is 12px at the app's density,
// which drew a filter chip's remove 23px wide, so its circle reached the value beside it (views.flow in CI run
// 43536222784, 14 Nov 2026).
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import preview from '../.storybook/preview.tsx';
import * as FilterChipStories from './molecules/FilterChip/FilterChip.stories.tsx';

setProjectAnnotations(preview);

const { Default: Chip } = composeStories(FilterChipStories);

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
});
