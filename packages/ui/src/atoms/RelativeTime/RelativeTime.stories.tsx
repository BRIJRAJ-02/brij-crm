import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { hoverFresh } from '../../workbench/pointer.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { RelativeTime } from './RelativeTime.tsx';

const meta = {
  title: 'Atoms/RelativeTime',
  component: RelativeTime,
  args: { value: '2026-10-08T11:30:00.000Z' },
} satisfies Meta<typeof RelativeTime>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three hours before the stories' frozen clock (14:30 UTC). The exact time, in London, is in the tooltip. */
export const Default: Story = {
  render: (args) => (
    <Stage>
      <RelativeTime {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const time = canvas.getByText('3 hours ago');
    await expect(time).toHaveAttribute('datetime', '2026-10-08T11:30:00.000Z');
    // Screen readers get the exact time without a hover.
    await expect(time.parentElement).toHaveTextContent(/3 hours ago, Oct 8, 2026.+12:30 PM GMT\+1/);
    await hoverFresh(userEvent, time);
    // Engines join the date and time differently ("," or "at"), so match the parts.
    await waitFor(() =>
      expect(document.querySelector('[role="tooltip"]')).toHaveTextContent(/Oct 8, 2026.+12:30 PM GMT\+1/),
    );
  },
};

/** From now to past a week, when it becomes the date. Switch the language to Deutsch to see "vor 3 Stunden". */
export const Ranges: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage direction="column">
      <RelativeTime value="2026-10-08T14:29:40.000Z" />
      <RelativeTime value="2026-10-08T14:05:00.000Z" />
      <RelativeTime value="2026-10-08T11:30:00.000Z" />
      <RelativeTime value="2026-10-07T09:00:00.000Z" />
      <RelativeTime value="2026-10-04T09:00:00.000Z" />
      <RelativeTime value="2026-09-20T09:00:00.000Z" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('now')).toBeInTheDocument();
    await expect(canvas.getByText('yesterday')).toBeInTheDocument();
    await expect(canvas.getByText('Sep 20, 2026')).toBeInTheDocument();
  },
};
