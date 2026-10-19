import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { HoursEditor, type HoursRange, type HoursRow } from './HoursEditor.tsx';

function weekRows(): HoursRow[] {
  const day = (id: string, label: string, ranges: HoursRange[]): HoursRow => ({ id, label, ranges });
  return [
    day('mon', 'Monday', [
      ['09:00', '12:00'],
      ['13:00', '17:00'],
    ]),
    day('tue', 'Tuesday', [['09:00', '17:00']]),
    day('wed', 'Wednesday', [['09:00', '17:00']]),
    day('thu', 'Thursday', [['09:00', '17:00']]),
    day('fri', 'Friday', [['09:00', '15:00']]),
    day('sat', 'Saturday', []),
    day('sun', 'Sunday', []),
  ];
}

const meta = {
  title: 'Modules/HoursEditor',
  component: HoursEditor,
  args: { label: 'Weekly hours', rows: [], onChange: fn() },
} satisfies Meta<typeof HoursEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A week with a split Monday and the weekend off: turning Saturday on gives it 09:00 to 17:00. */
export const Week: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => {
    function Editor() {
      const [rows, setRows] = useState(weekRows);
      return (
        <HoursEditor
          {...args}
          rows={rows}
          onChange={(id, ranges) => {
            args.onChange(id, ranges);
            setRows((current) => current.map((row) => (row.id === id ? { ...row, ranges } : row)));
          }}
        />
      );
    }
    return (
      <Stage>
        <Editor />
      </Stage>
    );
  },
  play: async ({ canvas, args }) => {
    await expect(canvas.getAllByText('Unavailable')).toHaveLength(2);
    await userEvent.click(canvas.getByRole('switch', { name: 'Saturday' }));
    await expect(args.onChange).toHaveBeenCalledWith('sat', [['09:00', '17:00']]);
    await userEvent.click(canvas.getByRole('button', { name: 'Remove 13:00 to 17:00 on Monday' }));
    await expect(args.onChange).toHaveBeenCalledWith('mon', [['09:00', '12:00']]);
  },
};

/** Date overrides: each can be removed, one is a day off, one has an error. */
export const Overrides: Story = {
  args: {
    label: 'Date overrides',
    onRemoveRow: fn(),
    rows: [
      { id: '2026-12-24', label: 'Thu 24 Dec', ranges: [['09:00', '12:00']] },
      { id: '2026-12-25', label: 'Fri 25 Dec', ranges: [] },
      {
        id: '2026-12-31',
        label: 'Thu 31 Dec',
        ranges: [
          ['09:00', '12:00'],
          ['11:00', '13:00'],
        ],
        error: 'Ranges on one day can’t overlap.',
      },
    ],
  },
  render: (args) => (
    <Stage>
      <HoursEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('Ranges on one day can’t overlap.');
    await userEvent.click(canvas.getByRole('button', { name: 'Remove Fri 25 Dec' }));
    await expect(args.onRemoveRow).toHaveBeenCalledWith('2026-12-25');
  },
};

/** Disabled while nothing may change. */
export const Disabled: Story = {
  args: { isDisabled: true },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <HoursEditor {...args} rows={weekRows().slice(0, 2)} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('switch', { name: 'Monday' })).toBeDisabled();
  },
};
