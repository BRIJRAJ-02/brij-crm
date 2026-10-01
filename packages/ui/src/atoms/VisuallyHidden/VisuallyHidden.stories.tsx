import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { VisuallyHidden } from './VisuallyHidden.tsx';

const meta = {
  title: 'Atoms/VisuallyHidden',
  component: VisuallyHidden,
  args: { children: 'Read aloud only' },
  parameters: { crm: { screenshot: false } },
} satisfies Meta<typeof VisuallyHidden>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing shows, but the words are in the page for screen readers. */
export const Default: Story = {
  render: (args) => (
    <Stage>
      <span>
        3<VisuallyHidden>{args.children}</VisuallyHidden>
      </span>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const hidden = canvas.getByText('Read aloud only');
    await expect(hidden).toBeInTheDocument();
    await expect(hidden.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  },
};
