import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { LoadingTimingContext } from '../../provider/useDelayedLoading.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Board } from './Board.tsx';

// Board's loading before the loading delay, apart from Board.stories.tsx: its decorator sets the delay through a
// provider context the library doesn't export, and that file's preview story goes to the design system artifact,
// whose previews may import only what the library exports.

/** The width every column takes, read from its token, so a skeleton column can be held to a real one. */
function columnWidth(element: Element): number {
  const probe = document.createElement('div');
  probe.style.inlineSize = 'var(--size-board-column)';
  element.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

const meta = {
  title: 'Modules/Board/Loading delay',
  component: Board,
  args: {
    label: 'Deals by stage',
    columns: [],
    cardFields: [],
    showEmptyColumns: false,
    onMove: () => undefined,
    status: 'loading',
  },
  render: (args) => (
    <Stage height="grid">
      <Board {...args} />
    </Stage>
  ),
} satisfies Meta<typeof Board>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Before the loading delay: the columns' space is held, with no surface, card boxes or bars, so a fast load flashes nothing. */
export const LoadingBeforeDelay: Story = {
  parameters: { crm: { screenshot: false } },
  decorators: [
    (Story) => (
      <LoadingTimingContext value={{ delayMs: 60_000, minimumMs: 0 }}>
        <Story />
      </LoadingTimingContext>
    ),
  ],
  play: async ({ canvasElement }) => {
    const columns = canvasElement.querySelectorAll('[data-skeleton]');
    await expect(columns).toHaveLength(3);
    const width = columnWidth(canvasElement);
    for (const column of columns) {
      await expect(column.getBoundingClientRect().width).toBeCloseTo(width, 0);
      await expect(column).toHaveAttribute('data-waiting');
      await expect(column.querySelector('[data-width]')).toBeNull();
    }
  },
};
