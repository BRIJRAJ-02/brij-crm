import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
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

/** A week with a split Monday and the weekend off, and Set all days under it. */
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
      <Stage width="fill">
        <Editor />
      </Stage>
    );
  },
  play: async ({ canvas, args }) => {
    await expect(canvas.getAllByText('Unavailable')).toHaveLength(2);
    await expect(canvas.getByRole('button', { name: 'Set all days' })).toBeEnabled();
    // Every "to" at one place: the times are one width, whatever they say.
    const lefts = new Set(canvas.getAllByText('to').map((to) => Math.round(to.getBoundingClientRect().left)));
    await expect(lefts.size).toBe(1);
    await userEvent.click(canvas.getByRole('switch', { name: 'Saturday' }));
    await expect(args.onChange).toHaveBeenCalledWith('sat', [['09:00', '17:00']]);
    await userEvent.click(canvas.getByRole('button', { name: 'Remove 1:00 PM to 5:00 PM on Monday' }));
    await expect(args.onChange).toHaveBeenCalledWith('mon', [['09:00', '12:00']]);
  },
};

/**
 * At a phone's width: each day and its Copy on one line, the times under them; a day off keeps one line, its
 * Unavailable in the times' column right after the day, never at the line's end.
 */
export const Phone: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    // Stretched across a narrow column (the editor is its own size container, so it needs a width given to it,
    // as a phone's settings card gives it), under 480px.
    <Stage width="narrow-fill">
      <HoursEditor {...args} rows={weekRows()} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const [saturday, sunday] = canvas.getAllByText('Unavailable');
    const day = canvas.getByRole('switch', { name: 'Saturday' }).closest('li');
    const dayCell = day?.firstElementChild;
    if (saturday === undefined || sunday === undefined || day === null || !(dayCell instanceof HTMLElement))
      throw new Error('no day off');
    const row = day.getBoundingClientRect();
    const label = saturday.getBoundingClientRect();
    // On the day's own line, right after the day's column (where the times start on a wide card), with the
    // same start on every day off.
    await expect(label.top).toBeLessThan(row.top + row.height / 2);
    await expect(label.left - dayCell.getBoundingClientRect().right).toBeLessThanOrEqual(16);
    await expect(label.left).toBeGreaterThanOrEqual(dayCell.getBoundingClientRect().right);
    await expect(Math.round(label.left)).toBe(Math.round(sunday.getBoundingClientRect().left));
  },
};

/** While the hours load: each day's row and Set all days in place, busy, with a skeleton where the times go. */
export const Loading: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <HoursEditor {...args} rows={weekRows().map((row) => ({ ...row, ranges: [] }))} isLoading />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('list', { name: 'Weekly hours' })).toBeInTheDocument();
    await expect(canvas.getAllByRole('listitem')).toHaveLength(7);
    await expect(canvas.queryByRole('switch')).not.toBeInTheDocument();
  },
};

/** Set all days: one start and one end for every day that is on, from a quiet button under the week. */
export const SetAllDays: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <HoursEditor {...args} rows={weekRows()} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Set all days' }));
    const body = within(document.body);
    await expect(await body.findByRole('dialog', { name: 'Set all days' })).toBeInTheDocument();
    await userEvent.click(body.getByRole('button', { name: 'Apply' }));
    await expect(args.onChange).toHaveBeenCalledWith('tue', [['09:00', '17:00']]);
  },
};

/** Copy times to: Friday's hours put on Monday and Tuesday. */
export const CopyTimes: Story = {
  args: { rows: weekRows() },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <HoursEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, canvasElement }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Copy Friday’s times to other days' }));
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('checkbox', { name: 'Monday' }));
    await userEvent.click(body.getByRole('checkbox', { name: 'Tuesday' }));
    await userEvent.click(body.getByRole('button', { name: 'Apply' }));
    await expect(args.onChange).toHaveBeenCalledWith('mon', [['09:00', '15:00']]);
    await expect(args.onChange).toHaveBeenCalledWith('tue', [['09:00', '15:00']]);
    // The accessibility check runs after this; a popover still fading out reads as low contrast.
    await waitFor(() => expect(body.queryByRole('dialog')).toBeNull());
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
        error: 'Hours on one day can’t overlap.',
      },
    ],
  },
  render: (args) => (
    <Stage width="fill">
      <HoursEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('Hours on one day can’t overlap.');
    await expect(canvas.getByRole('switch', { name: 'Monday' })).toBeDisabled();
  },
};

/** Read only: the week as text, as a page that follows its member's hours shows it. */
export const ReadOnly: Story = {
  args: {
    label: 'Weekly hours',
    isReadOnly: true,
    rows: [
      {
        id: 'mon',
        label: 'Monday',
        ranges: [
          ['09:00', '12:00'],
          ['13:00', '24:00'],
        ],
      },
      { id: 'sat', label: 'Saturday', ranges: [] },
    ],
    onChange: fn(),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('1:00 PM to Midnight')).toBeInTheDocument();
    await expect(canvas.queryByRole('switch')).not.toBeInTheDocument();
  },
};

/** British English, by default: still the 12 hour clock (the owner's call), in that language's own form. */
export const TwelveHourByDefault: Story = {
  globals: { locale: 'en-GB' },
  args: {
    label: 'Weekly hours',
    isReadOnly: true,
    rows: [{ id: 'mon', label: 'Monday', ranges: [['13:00', '24:00']] }],
    onChange: fn(),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/^1:00\s?pm to Midnight$/i)).toBeInTheDocument();
  },
};

/** `hourClock="locale"` in a language whose day runs to 24 hours: 13:00, and 24:00 at the day's end. */
export const LocaleClock: Story = {
  globals: { locale: 'en-GB' },
  args: {
    label: 'Weekly hours',
    isReadOnly: true,
    hourClock: 'locale',
    rows: [{ id: 'mon', label: 'Monday', ranges: [['13:00', '24:00']] }],
    onChange: fn(),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('13:00 to 24:00')).toBeInTheDocument();
  },
};

/** A whole day reads All day with Set hours, and a day that runs to midnight has no +; Copy stays in one column. */
export const AllDay: Story = {
  args: {
    rows: [
      { id: 'mon', label: 'Monday', ranges: [['00:00', '24:00']] },
      { id: 'tue', label: 'Tuesday', ranges: [['09:00', '17:00']] },
      { id: 'wed', label: 'Wednesday', ranges: [['20:00', '24:00']] },
      { id: 'sat', label: 'Saturday', ranges: [] },
    ],
  },
  render: (args) => (
    <Stage width="fill">
      <HoursEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText('All day')).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Add more hours on Wednesday' })).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Add more hours on Tuesday' })).toBeInTheDocument();
    const copies = ['Monday', 'Tuesday', 'Wednesday'].map((day) =>
      Math.round(
        canvas.getByRole('button', { name: `Copy ${day}’s times to other days` }).getBoundingClientRect().left,
      ),
    );
    await expect(new Set(copies).size).toBe(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Set hours for Monday' }));
    await expect(args.onChange).toHaveBeenCalledWith('mon', [['09:00', '17:00']]);
  },
};

/** One date's hours, held as the Team week's cell holds its draft. */
function SingleDayEditor(props: Parameters<typeof HoursEditor>[0]) {
  const [rows, setRows] = useState<HoursRow[]>([{ id: '2026-11-03', label: 'Tue 3', ranges: [['10:00', '14:00']] }]);
  return (
    <HoursEditor
      {...props}
      label="Hours on Tue 3"
      rows={rows}
      stepMinutes={15}
      isSingleDay
      onChange={(id, ranges) => setRows([{ id, label: 'Tue 3', ranges: [...ranges] }])}
    />
  );
}

/**
 * One date's hours (the Team week's cell, spec 0037): Working, then the day's windows at full width, with no Copy and
 * no Set all days; an end before its start is never offered.
 */
export const SingleDay: Story = {
  render: (args) => (
    <Stage>
      <SingleDayEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('switch', { name: 'Working' })).toBeChecked();
    await expect(canvas.queryByRole('button', { name: /Copy/ })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /Set all days/ })).not.toBeInTheDocument();
    // Both times whole: the editor takes its content's width, so neither Select is cut off.
    const until = canvas.getByRole('button', { name: /Tue 3 until/ });
    await expect(until.getBoundingClientRect().width).toBeGreaterThan(0);
    await userEvent.click(canvas.getByRole('button', { name: 'Add more hours on Tue 3' }));
    await expect(canvas.getAllByRole('button', { name: /Tue 3 until/ })).toHaveLength(2);
    await userEvent.click(canvas.getByRole('switch', { name: 'Working' }));
    await expect(canvas.queryByRole('button', { name: /Tue 3 until/ })).not.toBeInTheDocument();
  },
};

/** One date's hours, with the row's error (overlapping windows) under them, and the whole editor disabled. */
export const SingleDayErrorAndDisabled: Story = {
  render: (args) => (
    <Stage>
      <div>
        <HoursEditor
          {...args}
          label="Hours on Tue 3"
          rows={[
            {
              id: '2026-11-03',
              label: 'Tue 3',
              ranges: [
                ['09:00', '13:00'],
                ['12:00', '17:00'],
              ],
              error: 'These hours overlap.',
            },
          ]}
          isSingleDay
        />
      </div>
      <div>
        <HoursEditor
          {...args}
          label="Hours on Wed 4"
          rows={[{ id: '2026-11-04', label: 'Wed 4', ranges: [['09:00', '17:00']] }]}
          isSingleDay
          isDisabled
        />
      </div>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('These hours overlap.');
    const switches = canvas.getAllByRole('switch', { name: 'Working' });
    await expect(switches[1]).toBeDisabled();
  },
};
