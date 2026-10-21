import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { hoverUntilHovered } from '../../workbench/pointer.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Pagination } from './Pagination.tsx';

const meta = {
  title: 'Molecules/Pagination',
  component: Pagination,
  args: {
    label: 'Upcoming bookings',
    page: 1,
    pageSize: 10,
    total: 42,
    pageSizes: [10, 25, 50, 100],
    onPage: fn(),
    onPageSize: fn(),
  },
} satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The first of five pages: Previous off, Next moves on. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <Pagination {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText('1–10 of 42')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    const next = canvas.getByRole('button', { name: 'Next page' });
    await userEvent.click(next);
    await expect(args.onPage).toHaveBeenCalledWith(2);
    // The pointer stays on Next until its hover shows, so every shot has it (one CI run caught it without).
    await hoverUntilHovered(userEvent, next);
  },
};

/** The last page: Next off. */
export const LastPage: Story = {
  parameters: { crm: { screenshot: false } },
  args: { page: 5 },
  render: (args) => (
    <Stage>
      <Pagination {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('41–42 of 42')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Next page' })).toBeDisabled();
  },
};
