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
function Interactive(args: ComponentProps<typeof SlotList>) {
  const [value, setValue] = useState(args.value);
  return (
    <Stage width="narrow" height="page">
      <SlotList {...args} value={value} onChange={setValue} />
    </Stage>
  );
}
