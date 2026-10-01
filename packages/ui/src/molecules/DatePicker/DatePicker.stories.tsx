import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { DatePicker, DateRangePicker } from './DatePicker.tsx';

const meta = {
  title: 'Molecules/DatePicker',
  component: DatePicker,
  args: { label: 'Projected close', defaultValue: '2026-10-15', onChange: fn() },
} satisfies Meta<typeof DatePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

function dialog() {
  return waitFor(() => {
    const found = document.querySelector('[role="dialog"]');
    if (found === null) throw new Error('the calendar did not open');
    return found;
  });
}

/** Open, on 15 October; today (the stories' 8 October) has a dot. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  args: { defaultOpen: true },
  render: (args) => (
    <Stage width="narrow">
      <DatePicker {...args} />
    </Stage>
  ),
  play: async () => {
    const calendar = await dialog();
    await expect(calendar.querySelector('[data-today-mark]')?.parentElement).toHaveTextContent('8');
    await expect(calendar.querySelector('[data-selected]')).toHaveTextContent('15');
  },
};

/** A quick pick sets the day in the provider's time zone and closes the calendar. */
export const QuickPick: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <DatePicker {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Open calendar/ }));
    const calendar = await dialog();
    const tomorrow = [...calendar.querySelectorAll('button')].find((button) => button.textContent === 'Tomorrow');
    if (tomorrow === undefined) throw new Error('no Tomorrow pick');
    await userEvent.click(tomorrow);
    await expect(args.onChange).toHaveBeenCalledWith('2026-10-09');
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  },
};

/** Typed from the keyboard, segment by segment. */
export const Typed: Story = {
  parameters: { crm: { screenshot: false } },
  args: { defaultValue: null },
  render: (args) => (
    <Stage width="narrow">
      <DatePicker {...args} />
    </Stage>
  ),
  play: async ({ args, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('10202026');
    await expect(args.onChange).toHaveBeenLastCalledWith('2026-10-20');
  },
};

/** Invalid, read only and disabled. */
export const States: Story = {
  render: () => (
    <Stage direction="column" width="narrow">
      <DatePicker label="Projected close" isRequired error="Choose a close date to save the deal." />
      <DatePicker
        label="Created"
        defaultValue="2026-09-02"
        isReadOnly
        readOnlyReason="Set when the record is created."
      />
      <DatePicker label="Renewal" defaultValue="2027-01-31" isDisabled />
    </Stage>
  ),
};

/** The range variant, for filters and dashboards. */
export const Range: Story = {
  render: () => (
    <Stage width="narrow">
      <DateRangePicker label="Period" defaultValue={{ start: '2026-10-05', end: '2026-10-16' }} defaultOpen />
    </Stage>
  ),
  play: async () => {
    const calendar = await dialog();
    await expect(calendar.querySelector('[data-selection-start]')).toHaveTextContent('5');
    await expect(calendar.querySelector('[data-selection-end]')).toHaveTextContent('16');
  },
};
