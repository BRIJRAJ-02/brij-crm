import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../Button/Button.tsx';
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

/** With an `id`: a disabled button says why it is off to screen readers. */
export const DescribesAControl: Story = {
  render: () => (
    <Stage>
      <Button isDisabled aria-describedby="why-off">
        Empty trash
      </Button>
      <VisuallyHidden id="why-off">Wait for the change under way to finish.</VisuallyHidden>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Empty trash' })).toHaveAccessibleDescription(
      'Wait for the change under way to finish.',
    );
  },
};
