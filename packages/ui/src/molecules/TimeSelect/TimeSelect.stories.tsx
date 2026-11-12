import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { TimeSelect } from './TimeSelect.tsx';

const meta = {
  title: 'Molecules/TimeSelect',
  component: TimeSelect,
  args: { label: 'Starts', onChange: fn() },
} satisfies Meta<typeof TimeSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty: "--:--" until a time is picked. */
export const Empty: Story = {
  render: (args) => (
    <Stage width="narrow-fill">
      <TimeSelect {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /Starts/u })).toHaveTextContent('--:--');
  },
};

/** An end time listed after its start, on a 12 hour clock: Enter opens, the pick is `HH:MM`. */
export const EndAfterStart: Story = {
  parameters: { crm: { preview: true } },
  args: { label: 'Ends', hourCycle: 12, from: 9 * 60 + 15, defaultValue: '17:00' },
  render: (args) => (
    <Stage width="narrow-fill">
      <TimeSelect {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: /Ends/u });
    await expect(trigger).toHaveTextContent('5:00 PM');
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const list = await waitFor(() => within(document.body).getByRole('listbox'));
    await settleAnimations();
    const options = within(list).getAllByRole('option');
    await expect(options[0]).toHaveTextContent('9:15 AM');
    await userEvent.click(within(list).getByRole('option', { name: '9:30 AM' }));
    await expect(args.onChange).toHaveBeenLastCalledWith('09:30');
  },
};

/** Controlled, 24 hour, 30 minutes apart, in a row of hours. */
export const Controlled: Story = {
  render: function Controlled(args) {
    const [time, setTime] = useState<string | null>('09:00');
    return (
      <Stage>
        <TimeSelect
          {...args}
          label="Opens"
          isLabelHidden
          size="sm"
          hourCycle={24}
          step={30}
          value={time}
          onChange={setTime}
        />
        <span>{time}</span>
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /Opens/u })).toHaveTextContent('09:00');
  },
};

/** Invalid and disabled. */
export const States: Story = {
  render: (args) => (
    <Stage direction="column" width="narrow-fill">
      <TimeSelect {...args} label="Ends" defaultValue="08:00" error="End after the start." />
      <TimeSelect {...args} label="Last call" defaultValue="22:00" isDisabled />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('End after the start.')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /Last call/u })).toBeDisabled();
  },
};
