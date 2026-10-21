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
        { id: 'ada', name: 'Ada Lovelace', hue: 'blue', isShown: true, isDefault: true, canBeDefault: true },
        { id: 'team', name: 'Team', hue: 'green', isShown: true, isDefault: false, canBeDefault: true },
        { id: 'holidays', name: 'Holidays', hue: 'orange', isShown: true, isDefault: false, canBeDefault: false },
      ],
    },
    {
      id: 'outlook',
      provider: 'outlook',
      email: 'ada@lovelace.example',
      calendars: [{ id: 'cal', name: 'Calendar', hue: 'purple', isShown: true, isDefault: false, canBeDefault: true }],
    },
  ];
}

const meta = {
  title: 'Modules/CalendarList',
  component: CalendarList,
  args: { accounts: [], onShownChange: fn(), onShowOnly: fn(), onShowAll: fn(), onMakeDefault: fn() },
} satisfies Meta<typeof CalendarList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every calendar shown, Default on the one bookings go to. */
export const Default: Story = {
  parameters: { crm: { preview: true, screenshot: false } },
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

/** Make default is offered on a writable calendar that isn't the default, never on a read only one. */
export const MakeDefault: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <CalendarList {...args} accounts={accounts()} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByText('Default')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Holidays options' }));
    await waitFor(() => expect(body.getByRole('menuitem', { name: 'Show only this' })).toBeInTheDocument());
    await expect(body.queryByRole('menuitem', { name: 'Make default' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(canvas.getByRole('button', { name: 'Team options' }));
    await userEvent.click(await body.findByRole('menuitem', { name: 'Make default' }));
    await expect(args.onMakeDefault).toHaveBeenCalledWith('team');
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
