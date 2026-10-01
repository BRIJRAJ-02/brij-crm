import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { fakeThemeController } from '../../workbench/theme.ts';
import { SegmentedControl, ThemeSwitch } from './SegmentedControl.tsx';

const meta = {
  title: 'Molecules/SegmentedControl',
  component: SegmentedControl,
  args: {
    label: 'View',
    segments: [
      { value: 'table', label: 'Table', icon: 'list-checks' },
      { value: 'board', label: 'Board', icon: 'kanban' },
    ],
    defaultValue: 'table',
    onChange: fn(),
  },
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The arrow keys move the choice and tell the caller. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage direction="column">
      <SegmentedControl {...args} />
      <SegmentedControl
        label="Period"
        defaultValue="week"
        segments={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'year', label: 'Year' },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('radio', { name: 'Table' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('radio', { name: 'Board' })).toBeChecked();
    await expect(args.onChange).toHaveBeenCalledWith('board');
  },
};

function Themes() {
  const [controller] = useState(fakeThemeController);
  return (
    <Stage direction="column">
      <ThemeSwitch controller={controller} />
      <ThemeSwitch controller={controller} isCompact />
    </Stage>
  );
}

/** ThemeSwitch, full and compact, on one controller: choosing in one moves the other. */
export const Theme: Story = {
  render: () => <Themes />,
  play: async ({ canvas, userEvent }) => {
    const [full] = canvas.getAllByRole('radiogroup', { name: 'Theme' });
    await expect(full).toBeDefined();
    await userEvent.click(canvas.getAllByRole('radio', { name: 'Dark' })[0] as HTMLElement);
    for (const dark of canvas.getAllByRole('radio', { name: 'Dark' })) await expect(dark).toBeChecked();
  },
};

/** Disabled. */
export const Disabled: Story = {
  args: { isDisabled: true },
};
