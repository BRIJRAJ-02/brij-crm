import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { CalendarList, type CalendarListAccount } from './CalendarList.tsx';

/** Two accounts: Google with three calendars (one read only), Outlook with one. */
function accounts(): CalendarListAccount[] {
  return [
    {
      id: 'google',
      provider: 'google-calendar',
      email: 'ada@acme.dev',
      calendars: [
        { id: 'ada', name: 'Ada Lovelace', hue: 'blue', isShown: true },
        { id: 'team', name: 'Team', hue: 'green', isShown: true },
        { id: 'holidays', name: 'Holidays', hue: 'orange', isShown: true },
      ],
    },
    {
      id: 'outlook',
      provider: 'outlook',
      email: 'ada@lovelace.example',
      calendars: [{ id: 'cal', name: 'Calendar', hue: 'purple', isShown: true }],
    },
  ];
}

const meta = {
  title: 'Modules/CalendarList',
  component: CalendarList,
  args: { accounts: [], onShownChange: fn(), onShowOnly: fn(), onShowAll: fn() },
} satisfies Meta<typeof CalendarList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every calendar shown: Outlook's one calendar is one row, Google's three fold under its address. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="narrow">
      <CalendarList {...args} accounts={accounts()} />
    </Stage>
  ),
};

/** Some hidden: Show all follows the list; a box toggles one calendar; Show only this keeps one. */
export const Toggling: Story = {
  parameters: { crm: { screenshot: false } },
  render: function Render(args) {
    const [list, setList] = useState(accounts);
    const setShown = (shown: (id: string) => boolean) =>
      setList((now) =>
        now.map((account) => ({
          ...account,
          calendars: account.calendars.map((calendar) => ({ ...calendar, isShown: shown(calendar.id) })),
        })),
      );
    const shownNow = new Map(list.flatMap((account) => account.calendars).map((each) => [each.id, each.isShown]));
    return (
      <Stage width="narrow">
        <CalendarList
          {...args}
          accounts={list}
          onShownChange={(id, isShown) => setShown((each) => (each === id ? isShown : (shownNow.get(each) ?? true)))}
          onShowOnly={(id) => setShown((each) => each === id)}
          onShowAll={() => setShown(() => true)}
        />
      </Stage>
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Team' }));
    await expect(canvas.getByRole('checkbox', { name: 'Team' })).not.toBeChecked();
    await expect(canvas.getByRole('button', { name: 'Show all' })).toBeInTheDocument();
    // The row's own options button, by keyboard: Show only this.
    canvas.getByRole('button', { name: 'Calendar options' }).focus();
    await userEvent.keyboard('{Enter}');
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByRole('menuitem', { name: 'Show only this' })).toBeInTheDocument());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(canvas.getByRole('checkbox', { name: 'Calendar' })).toBeChecked());
    await expect(canvas.getByRole('checkbox', { name: 'Ada Lovelace' })).not.toBeChecked();
    await userEvent.click(canvas.getByRole('button', { name: 'Show all' }));
    await expect(canvas.getByRole('checkbox', { name: 'Ada Lovelace' })).toBeChecked();
  },
};

/** An account with one calendar is one row, with no heading; its box is filled with its colour; no Default chip. */
export const OneCalendarAccount: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <CalendarList {...args} accounts={accounts()} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'My calendars' })).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /ada@lovelace\.example/ })).not.toBeInTheDocument();
    await expect(canvas.getByRole('checkbox', { name: 'Calendar' })).toBeChecked();
    // The one calendar row carries its provider's mark, named, as a folded account's heading does.
    const single = canvas.getByRole('checkbox', { name: 'Calendar' }).closest('li');
    if (single === null) throw new Error('no row for the one calendar account');
    await expect(within(single).getByRole('img', { name: 'Outlook' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /ada@acme\.dev/ })).toBeInTheDocument();
    await expect(canvas.queryByText('Default')).not.toBeInTheDocument();
  },
};

/** An account folded by its heading. */
export const Folded: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <CalendarList {...args} accounts={accounts()} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: /ada@acme\.dev/ }));
    await waitFor(() => expect(canvas.queryByRole('checkbox', { name: 'Team' })).not.toBeInTheDocument());
  },
};

/** A long address: cut with an ellipsis before the options button's room, never mid letter, hovered or not. */
export const LongName: Story = {
  render: (args) => (
    <Stage width="narrow">
      <CalendarList
        {...args}
        accounts={[
          {
            id: 'school',
            provider: 'google-calendar',
            email: '1032201225@tcetmumbai.in',
            calendars: [{ id: 'school', name: '1032201225@tcetmumbai.in.example.edu', hue: 'sky', isShown: true }],
          },
          ...accounts(),
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    // The visible name (the StatusDot's); the checkbox's own label is for screen readers.
    const [name] = canvas.getAllByText('1032201225@tcetmumbai.in.example.edu');
    if (name === undefined) throw new Error('no name');
    await expect(getComputedStyle(name).textOverflow).toBe('ellipsis');
    // Pressing the name toggles its box (the list is the caller's, so it says so rather than changing).
    await userEvent.click(name);
    await expect(args.onShownChange).toHaveBeenCalledWith('school', false);
  },
};
