import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
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

/** A week with a split Monday and the weekend off; All days end reads Mixed while the days differ. */
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
    await expect(canvas.getByText('Mixed')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('switch', { name: 'Saturday' }));
    await expect(args.onChange).toHaveBeenCalledWith('sat', [['09:00', '17:00']]);
    await userEvent.click(canvas.getByRole('button', { name: 'Remove 13:00 to 17:00 on Monday' }));
    await expect(args.onChange).toHaveBeenCalledWith('mon', [['09:00', '12:00']]);
  },
};

/** Copy times to: Friday's hours put on Monday and Tuesday. */
export const CopyTimes: Story = {
  args: { rows: weekRows() },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <HoursEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, canvasElement }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Copy Friday’s times to' }));
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('checkbox', { name: 'Monday' }));
    await userEvent.click(body.getByRole('checkbox', { name: 'Tuesday' }));
    await userEvent.click(body.getByRole('button', { name: 'Apply' }));
    await expect(args.onChange).toHaveBeenCalledWith('mon', [['09:00', '15:00']]);
    await expect(args.onChange).toHaveBeenCalledWith('tue', [['09:00', '15:00']]);
  },
};

/** A row's error, and the controls disabled while nothing may change. */
export const ErrorAndDisabled: Story = {
  args: {
    isDisabled: true,
    rows: [
      {
        id: 'mon',
        label: 'Monday',
        ranges: [
          ['09:00', '12:00'],
          ['11:00', '13:00'],
        ],
        error: 'Windows on one day can’t overlap.',
      },
    ],
  },
  render: (args) => (
    <Stage>
      <HoursEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('Windows on one day can’t overlap.');
    await expect(canvas.getByRole('switch', { name: 'Monday' })).toBeDisabled();
  },
};
