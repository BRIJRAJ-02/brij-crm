import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState, type ComponentProps } from 'react';
import { expect, fn, userEvent } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
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
/** A restaurant's day in 24 hour times: Lunch from 12:00 and Dinner from 18:00, a quarter hour apart. */
function service(prefix: string, hour: number, count: number): readonly Slot[] {
  return Array.from({ length: count }, (_, index) => {
    const minutes = hour * 60 + index * 15;
    const label = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    return { id: `${prefix}-${label}`, label, name: `${label}, Fri 9 Oct` };
  });
}

const SERVICES = [
  { id: 'lunch', heading: 'Lunch', slots: service('lunch', 12, 7) },
  { id: 'dinner', heading: 'Dinner', slots: service('dinner', 18, 11) },
];

/**
 * `groups` (a restaurant's Lunch and Dinner, spec 0066 B7): one list that scrolls as one, each group under its small
 * heading, three across; the long date heads it with a count, and the first time is the page's to focus.
 */
export const Groups: Story = {
  args: { heading: 'Friday 9 October', slots: [], groups: SERVICES, badge: '18 available', onHour12Change: undefined },
  render: (args) => <GroupsInPane {...args} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Lunch' })).toBeInTheDocument();
    await expect(canvas.getByRole('list', { name: 'Dinner times on Friday 9 October' })).toBeInTheDocument();
    await expect(canvas.getByText('18 available')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: /^19:30/ }));
    await expect(canvas.getByRole('button', { name: /^19:30/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(canvas.getByRole('button', { name: 'Focus the first time' }));
    await expect(canvas.getByRole('button', { name: /^12:00/ })).toHaveFocus();
  },
};

/** The grouped list while the times load: three across, in its pane. */
export const GroupsLoading: Story = {
  parameters: { crm: { screenshot: false } },
  args: { heading: 'Friday 9 October', slots: [], groups: [], isLoading: true, onHour12Change: undefined },
  render: (args) => <GroupsInPane {...args} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading times…')).toBeInTheDocument();
  },
};

/** A grouped day with nothing left: the page's own words in the list's place. */
export const GroupsEmpty: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    heading: 'Friday 9 October',
    slots: [],
    groups: [{ id: 'lunch', heading: 'Lunch', slots: [] }],
    empty: 'No tables left that day for this party.',
    onHour12Change: undefined,
  },
  render: (args) => <GroupsInPane {...args} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No tables left that day for this party.')).toBeInTheDocument();
    await expect(canvas.queryByRole('heading', { name: 'Lunch' })).toBeNull();
  },
};

/** The grouped list in a pane a booking page's height, with a button that focuses the first time through `firstRef`. */
function GroupsInPane(args: ComponentProps<typeof SlotList>) {
  const [value, setValue] = useState(args.value);
  const first = useRef<HTMLButtonElement>(null);
  return (
    <Stage width="narrow" height="page">
      <Button variant="ghost" onPress={() => first.current?.focus()}>
        Focus the first time
      </Button>
      <SlotList {...args} value={value} onChange={setValue} firstRef={first} />
    </Stage>
  );
}

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
