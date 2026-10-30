import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Form } from '../Form/Form.tsx';
import { DatePicker, DateRangePicker, MonthCalendar } from './DatePicker.tsx';

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

/**
 * Open, on 15 October: "Type a date" on top, today (the stories' 8 October) in a ring, six weeks with the days outside
 * October faded, and the quick picks as a list with their days.
 */
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
    await expect(calendar.querySelector('[data-today-mark]')).toHaveTextContent('8');
    await expect(calendar.querySelector('[data-selected]')).toHaveTextContent('15');
    // October 2026 starts on a Thursday: the days before it show, faded, so the grid keeps its shape.
    await expect(calendar.querySelectorAll('[data-outside-month]').length).toBeGreaterThan(0);
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
    // Each pick shows the day it means at its end ("Tomorrow Fri 9 Oct").
    const tomorrow = [...calendar.querySelectorAll('button')].find((button) =>
      button.textContent.startsWith('Tomorrow'),
    );
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

/** MonthCalendar: the calendar inline and compact, for jumping to a date beside a view; picking a day calls back. */
export const Inline: Story = {
  render: function Render() {
    const [day, setDay] = useState('2026-10-15');
    return (
      <Stage width="narrow">
        <MonthCalendar label="Go to date" value={day} onChange={setDay} />
      </Stage>
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('application', { name: /Go to date/ })).toBeInTheDocument();
    await expect(canvasElement.querySelector('[data-selected]')).toHaveTextContent('15');
    await userEvent.click(canvas.getByRole('button', { name: /October 20, 2026|20 October 2026/ }));
    await expect(canvasElement.querySelector('[data-selected]')).toHaveTextContent('20');
  },
};

/** MonthCalendar with `autoFocus`, as a popover opens it (Bookings' Go to date): focus is on the chosen day, and the
 * arrows move from it at once. */
export const InlineFocused: Story = {
  parameters: { crm: { screenshot: false } },
  render: function Render() {
    const [day, setDay] = useState('2026-10-15');
    return (
      <Stage width="narrow">
        {/* eslint-disable-next-line jsx-a11y-x/no-autofocus -- the story shows the popover case */}
        <MonthCalendar label="Go to date" value={day} onChange={setDay} autoFocus />
      </Stage>
    );
  },
  play: async ({ canvasElement }) => {
    await expect(document.activeElement).toHaveTextContent('15');
    await userEvent.keyboard('{ArrowRight}');
    await expect(document.activeElement).toHaveTextContent('16');
    await expect(canvasElement.contains(document.activeElement)).toBe(true);
  },
};

/** MonthCalendar with `shown`: the week the view beside it shows, 12 to 18 October, tinted as one band. */
export const InlineWeekShown: Story = {
  parameters: { crm: { screenshot: false } },
  render: function Render() {
    const [day, setDay] = useState('2026-10-15');
    return (
      <Stage width="narrow">
        <MonthCalendar
          label="Go to date"
          value={day}
          onChange={setDay}
          shown={{ start: '2026-10-12', end: '2026-10-18' }}
        />
      </Stage>
    );
  },
  play: async ({ canvasElement }) => {
    const shown = [...canvasElement.querySelectorAll<HTMLElement>('[data-shown]')];
    await expect(shown.map((day) => day.textContent)).toEqual(['12', '13', '14', '15', '16', '17', '18']);
    await expect(canvasElement.querySelector('[data-shown-start]')).toHaveTextContent('12');
    await expect(canvasElement.querySelector('[data-shown-end]')).toHaveTextContent('18');
  },
};

/** In a form, Enter in the date submits it, as in any text field. */
export const SubmitsOnEnter: Story = {
  args: { onChange: fn() },
  render: function Render(args) {
    return (
      <Stage>
        <Form id="day-off" label="Add a day off" onSubmit={args.onChange ?? (() => undefined)}>
          <DatePicker label="Day to close" defaultValue="2026-12-25" />
        </Form>
      </Stage>
    );
  },
  play: async ({ canvas, args }) => {
    const [month] = canvas.getAllByRole('spinbutton');
    if (month === undefined) throw new Error('no date segments');
    await userEvent.click(month);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(args.onChange).toHaveBeenCalled());
  },
};

/** "Type a date": words resolve live at the field's end, and Enter chooses the day. */
export const TypeADate: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <DatePicker {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Open calendar/ }));
    const calendar = await dialog();
    const typed = calendar.querySelector('input');
    if (typed === null) throw new Error('no Type a date field');
    await waitFor(() => expect(typed).toHaveFocus());
    await userEvent.keyboard('next fri');
    await waitFor(() => expect(calendar).toHaveTextContent(/16/));
    await userEvent.keyboard('{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('2026-10-16');
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  },
};

/** The month's title opens its year's months; choosing one shows its days. Today comes back to this month. */
export const MonthJump: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <Stage width="narrow">
      <DatePicker {...args} />
    </Stage>
  ),
  play: async () => {
    const calendar = await dialog();
    const title = calendar.querySelector<HTMLElement>('[aria-expanded]');
    if (title === null) throw new Error('no month title');
    await userEvent.click(title);
    await expect(title).toHaveAttribute('aria-expanded', 'true');
    const months = [...calendar.querySelectorAll<HTMLElement>('[role="group"] button')];
    await expect(months).toHaveLength(12);
    const january = months[0];
    if (january === undefined) throw new Error('no January');
    await userEvent.click(january);
    await waitFor(() => expect(title).toHaveAttribute('aria-expanded', 'false'));
    await expect(title).toHaveTextContent('2026');
    // Away from today's month, Today shows and brings it back.
    const today = [...calendar.querySelectorAll('button')].find((button) => button.textContent === 'Today');
    if (today === undefined) throw new Error('no Today');
    await userEvent.click(today);
    await waitFor(() => expect(calendar.querySelector('[data-today-mark]')).not.toBeNull());
  },
};

/** The range's presets under its calendar: Last 7 days sets the week up to today and closes. */
export const RangePresets: Story = {
  parameters: { crm: { screenshot: false } },
  render: function Render() {
    const [range, setRange] = useState<{ start: string; end: string } | null>(null);
    return (
      <Stage width="narrow">
        <DateRangePicker label="Period" value={range} onChange={setRange} defaultOpen />
        <span>{range === null ? 'None' : `${range.start} to ${range.end}`}</span>
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    const calendar = await dialog();
    const preset = [...calendar.querySelectorAll('button')].find((button) => button.textContent === 'Last 7 days');
    if (preset === undefined) throw new Error('no Last 7 days');
    await userEvent.click(preset);
    await waitFor(() => expect(canvas.getByText('2026-10-02 to 2026-10-08')).toBeInTheDocument());
  },
};
