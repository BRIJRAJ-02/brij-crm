import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SlotList, type Slot } from './SlotList.tsx';

/** Half hours from 9 AM, as a page would give them. */
function slots(count: number, marks: Partial<Record<number, Partial<Slot>>> = {}): readonly Slot[] {
  return Array.from({ length: count }, (_, index) => {
    const hour = 9 + Math.floor(index / 2);
    const minute = index % 2 === 0 ? '00' : '30';
    const label = `${String(hour > 12 ? hour - 12 : hour)}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
    return {
      id: `2026-10-08T${String(hour).padStart(2, '0')}:${minute}`,
      label,
      name: `${label}, Thu Oct 8, 30 minutes`,
      ...marks[index],
    };
  });
}

const meta = {
  title: 'Modules/SlotList',
  component: SlotList,
  args: {
    heading: 'Thu Oct 8',
    slots: slots(8),
    value: undefined,
    onChange: fn(),
    hour12: true,
    onHour12Change: fn(),
  },
} satisfies Meta<typeof SlotList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A day's times; the picked one fills. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: /^10:00 AM/ }));
    await expect(canvas.getByRole('button', { name: /^10:00 AM/ })).toHaveAttribute('aria-pressed', 'true');
  },
};

/** A fast second tap: the time tapped last is the one picked, and only it. */
export const FastSecondTap: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: /^10:00 AM/ }));
    await userEvent.click(canvas.getByRole('button', { name: /^11:00 AM/ }));
    await expect(canvas.getByRole('button', { name: /^11:00 AM/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getAllByRole('button', { pressed: true })).toHaveLength(1);
  },
};

/** The day's times are read again just after a pick (the list refreshing): the pick stays on the time tapped. */
export const PickDuringRefresh: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => <Refreshing {...args} />,
  play: async ({ canvas }) => {
    const tapped = canvas.getByRole('button', { name: /^10:30 AM/ });
    await userEvent.click(tapped);
    await expect(await canvas.findByRole('button', { name: /^10:30 AM/, pressed: true })).toBe(tapped);
    await expect(canvas.getAllByRole('button', { pressed: true })).toHaveLength(1);
  },
};

/** The picked time is gone from the refreshed list (someone else booked it): nothing shows as picked, and no other time takes its place. */
export const PickedTimeGone: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => <Vanishing {...args} />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: /^10:00 AM/ }));
    await expect(await canvas.findByRole('list')).not.toHaveTextContent('10:00 AM');
    await expect(canvas.queryAllByRole('button', { pressed: true })).toHaveLength(0);
  },
};

/** 12h to 24h: every time keeps its box and only its words change, so nothing redraws under the visitor. */
export const ClockSwitchInPlace: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => <Clocked {...args} />,
  play: async ({ canvas }) => {
    const before = canvas.getByRole('button', { name: /^2:00 PM/ });
    await userEvent.click(canvas.getByRole('radio', { name: '24h' }));
    const after = canvas.getByRole('button', { name: /^14:00/ });
    await expect(after).toBe(before);
  },
};

/** One time in a tall column (the owner's Thu Oct 22): a long list's height at the top, the space below left empty. */
export const OneSlot: Story = {
  args: { slots: slots(1) },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas }) => {
    const only = canvas.getByRole('button', { name: /^9:00 AM/ });
    await expect(only.getBoundingClientRect().height).toBeLessThan(60);
  },
};

/** Two times in a tall column: each keeps a long list's height at the top, never stretched to fill the pane. */
export const TwoSlots: Story = {
  args: { slots: slots(2) },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas }) => {
    const first = canvas.getByRole('button', { name: /^9:00 AM/ });
    const second = canvas.getByRole('button', { name: /^9:30 AM/ });
    // The size of a time in a long list (a row and a step), not half the pane.
    await expect(first.getBoundingClientRect().height).toBeLessThan(60);
    await expect(Math.round(second.getBoundingClientRect().height)).toBe(
      Math.round(first.getBoundingClientRect().height),
    );
  },
};

/** With the visitor's calendar on: Best times tagged; asked to show every time, the busy ones read quieter. */
export const Overlay: Story = {
  args: { slots: slots(6, { 1: { isBest: true }, 2: { isBest: true }, 4: { isBusy: true }, 5: { isBusy: true } }) },
  render: (args) => (
    <Stage width="narrow">
      <SlotList {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /^9:30 AM.*best time/ })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /^11:00 AM.*busy/ })).toBeInTheDocument();
  },
};

/** Two to four across, as room allows: the List view, and phones. */
export const Grid: Story = {
  args: { layout: 'grid', slots: slots(12), value: '2026-10-08T10:00' },
  render: (args) => (
    <Stage width="fill">
      <SlotList {...args} />
    </Stage>
  ),
};

/** A host's Reschedule: each time with the guest's own under it, quieter. */
export const GuestClock: Story = {
  args: {
    layout: 'grid',
    slots: slots(6).map((slot) => ({ ...slot, detail: '03:30 London', name: `${slot.name}, 03:30 in London` })),
    value: undefined,
  },
  render: (args) => (
    <Stage width="fill">
      <SlotList {...args} />
    </Stage>
  ),
};

/** The 24 hour clock. */
export const TwentyFourHours: Story = {
  parameters: { crm: { screenshot: false } },
  args: { hour12: false },
  render: (args) => (
    <Stage width="narrow">
      <SlotList {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('radio', { name: '12h' }));
    await expect(args.onHour12Change).toHaveBeenCalledWith(true);
  },
};

/** While the day's times load. */
export const Loading: Story = {
  args: { isLoading: true },
  render: (args) => (
    <Stage width="narrow">
      <SlotList {...args} />
    </Stage>
  ),
};

/** Every time hidden as busy: the page says so in the list's place. */
export const Empty: Story = {
  args: { slots: [], empty: 'You’re busy for every time Ada has open this day.' },
  render: (args) => (
    <Stage width="narrow">
      <SlotList {...args} />
    </Stage>
  ),
};

/** The story's own state, in a component so the artifact's preview can render it too. */
function Interactive(args: ComponentProps<typeof SlotList>) {
  const [value, setValue] = useState(args.value);
  return (
    <Stage width="narrow" height="page">
      <SlotList {...args} value={value} onChange={setValue} />
    </Stage>
  );
}

/** Picks as Interactive does, then hands the list the same times as new objects, as a refresh would. */
function Refreshing(args: ComponentProps<typeof SlotList>) {
  const [value, setValue] = useState(args.value);
  const [list, setList] = useState(args.slots);
  return (
    <Stage width="narrow" height="page">
      <SlotList
        {...args}
        slots={list}
        value={value}
        onChange={(id) => {
          setValue(id);
          // The read that was already out lands with the pick: the same times, as new objects.
          setList((current) => current.map((slot) => ({ ...slot })));
        }}
      />
    </Stage>
  );
}

/** The clock switch wired up: the same times, labelled for 12h or 24h. */
function Clocked(args: ComponentProps<typeof SlotList>) {
  const [hour12, setHour12] = useState(true);
  const list = slots(12).map((slot) => {
    if (hour12) return slot;
    const [, time = ''] = slot.id.split('T');
    return { ...slot, label: time, name: slot.name.replace(slot.label, time) };
  });
  return (
    <Stage width="narrow" height="page">
      <SlotList {...args} slots={list} hour12={hour12} onHour12Change={setHour12} />
    </Stage>
  );
}

/** Picks, then the refresh that was already out lands without the picked time: it was taken meanwhile. */
function Vanishing(args: ComponentProps<typeof SlotList>) {
  const [value, setValue] = useState(args.value);
  const [list, setList] = useState(args.slots);
  return (
    <Stage width="narrow" height="page">
      <SlotList
        {...args}
        slots={list}
        value={value}
        onChange={(id) => {
          setValue(id);
          setList((current) => current.filter((slot) => slot.id !== id));
        }}
      />
    </Stage>
  );
}
