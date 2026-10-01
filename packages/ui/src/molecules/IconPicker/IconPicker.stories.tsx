import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { IconPicker } from './IconPicker.tsx';

const meta = {
  title: 'Molecules/IconPicker',
  component: IconPicker,
  args: { label: 'Object icon', value: 'building', onChange: fn() },
} satisfies Meta<typeof IconPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The curated set, with the chosen icon marked. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <IconPicker {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('option', { name: 'Building' })).toHaveAttribute('aria-selected', 'true');
  },
};

/** Typing filters the icons by name. */
export const Search: Story = {
  parameters: { crm: { screenshot: false } },
  args: { hue: 'blue' },
  render: (args) => (
    <Stage>
      <IconPicker {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('searchbox', { name: 'Search icons' }));
    await userEvent.keyboard('rocket');
    await waitFor(() => expect(canvas.getAllByRole('option')).toHaveLength(1));
  },
};
