import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { hoverFresh, shownTooltip } from '../../workbench/pointer.ts';
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
    await expect(await shownTooltip()).toHaveTextContent(/Oct 8, 2026.+12:30 PM GMT\+1/);
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
    await expect(canvas.getByText('just now')).toBeInTheDocument();
    await expect(canvas.getByText('yesterday')).toBeInTheDocument();
    await expect(canvas.getByText('Sep 20, 2026')).toBeInTheDocument();
  },
};

/**
 * `variant="moment"` (the field types pass): a date and time someone set, as the Date and time field shows it.
 * Today's reads "Today" and its time; further away, the exact day and time. The stories' language is en-US.
 */
export const Moment: Story = {
  render: () => (
    <Stage direction="column">
      <RelativeTime variant="moment" value="2026-10-08T11:30:00.000Z" />
      <RelativeTime variant="moment" value="2026-10-09T08:00:00.000Z" />
      <RelativeTime variant="moment" value="2026-09-20T09:00:00.000Z" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/^Today 12:30\sPM$/)).toBeInTheDocument();
    await expect(canvas.getByText(/^Tomorrow 9:00\sAM$/)).toBeInTheDocument();
    await expect(canvas.getByText(/^Sep 20, 2026, 10:00\sAM$/)).toBeInTheDocument();
  },
};
