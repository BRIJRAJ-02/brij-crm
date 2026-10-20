import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent } from 'storybook/test';
import { SegmentedControl } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { BookingDetails } from '../BookingDetails/BookingDetails.tsx';
import { MonthTiles } from '../MonthTiles/MonthTiles.tsx';
import { SlotList } from '../SlotList/SlotList.tsx';
import { BookingFrame, BookingMessage, type BookingFact } from './BookingFrame.tsx';

const FACTS: readonly BookingFact[] = [
  { id: 'length', icon: 'clock', children: '30 min' },
  { id: 'where', icon: 'video', children: 'Video call' },
  { id: 'zone', icon: 'globe', children: 'London time (GMT+1)' },
];

const OPEN = new Set(['2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14']);

const TIMES = ['9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '2:00 PM', '2:30 PM'].map((label) => ({
  id: label,
  label,
  name: `${label}, Thu Oct 8, 30 minutes`,
}));

const meta = {
  title: 'Modules/BookingFrame',
  component: BookingFrame,
  args: {
    host: { name: 'Ada Lovelace' },
    title: 'Intro call',
    description: 'A first chat about what you need.',
    facts: FACTS,
    claimHref: 'https://timefix.ai',
  },
} satisfies Meta<typeof BookingFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The first step: the rail, the month, and the chosen day's times, with Month or List above. */
export const ChooseATime: Story = {
  parameters: { crm: { preview: true } },
  render: function Render(args) {
    const [day, setDay] = useState('2026-10-08');
    const [time, setTime] = useState<string | undefined>(undefined);
    return (
      <Stage width="fill" height="page">
        <BookingFrame
          {...args}
          toolbar={
            <SegmentedControl
              label="View"
              defaultValue="month"
              segments={[
                { value: 'month', label: 'Month', icon: 'calendar', isIconOnly: true },
                { value: 'list', label: 'List', icon: 'list', isIconOnly: true },
              ]}
            />
          }
          aside={
            <SlotList
              heading="Thu Oct 8"
              slots={TIMES}
              value={time}
              onChange={setTime}
              onConfirm={fn()}
              hour12
              onHour12Change={fn()}
            />
          }
        >
          <MonthTiles
            month="2026-10"
            today="2026-10-08"
            openDays={OPEN}
            value={day}
            onChange={setDay}
            onMonthChange={fn()}
            canPrevious={false}
            canNext
          />
        </BookingFrame>
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Intro call' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: /^9:30 AM/ }));
    await expect(canvas.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  },
};

/** The second step: the rail with the picked time, the details wide beside it. */
export const Details: Story = {
  args: {
    facts: [{ id: 'when', icon: 'calendar', children: 'Thu Oct 8, 9:30 – 10:00 AM' }, ...FACTS],
  },
  render: (args) => (
    <Stage width="fill" height="page">
      <BookingFrame {...args}>
        <BookingDetails onBack={fn()} onSubmit={fn(() => Promise.resolve({ kind: 'done' as const }))} />
      </BookingFrame>
    </Stage>
  ),
};

/** While the page's facts load. */
export const Loading: Story = {
  args: { host: undefined, title: undefined },
  render: (args) => (
    <Stage width="fill" height="page">
      <BookingFrame {...args} aside={<span />} />
    </Stage>
  ),
};

/** A page that failed to load, with Try again. */
export const Failed: Story = {
  render: () => (
    <Stage width="fill" height="page">
      <BookingMessage title="This page didn’t load" onRetry={fn()}>
        Check your connection and try again.
      </BookingMessage>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'This page didn’t load' })).toHaveFocus();
  },
};
