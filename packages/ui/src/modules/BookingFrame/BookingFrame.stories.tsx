import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { SegmentedControl } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { BookingDetails } from '../BookingDetails/BookingDetails.tsx';
import { MonthTiles } from '../MonthTiles/MonthTiles.tsx';
import { SlotList } from '../SlotList/SlotList.tsx';
import { LinkList } from '../LinkList/LinkList.tsx';
import {
  BookingFrame,
  BookingMessage,
  BookingProfile,
  BookingProfileSection,
  type BookingFact,
} from './BookingFrame.tsx';

const FACTS: readonly BookingFact[] = [
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
    title: 'Intro call · 30 min',
    description: 'A first chat about what you need.',
    facts: FACTS,
    claimHref: 'https://timefix.ai',
  },
} satisfies Meta<typeof BookingFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The first step: the rail beside the card, the month and the chosen day's times, and the Book bar. */
export const ChooseATime: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Intro call · 30 min' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: /^9:30 AM/ }));
    await expect(canvas.getByRole('button', { name: 'Book Thu Oct 8 at 9:30 AM' })).toBeEnabled();
  },
};

/** The second step: the rail with the picked time, the details in the card. */
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

/** A team page (spec 0037, AC-1339): 4 faces of 6 in place of the picture, and "Intro call with Acme". */
export const TeamPage: Story = {
  args: {
    title: 'Intro call with Acme',
    host: {
      name: 'Acme',
      team: {
        people: [
          { id: 't1', name: 'S L' },
          { id: 't2', name: 'K P' },
          { id: 't3', name: 'M R' },
          { id: 't4', name: 'J B' },
        ],
        total: 6,
        label: 'Team of 6',
      },
    },
  },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas }) => {
    const stack = canvas.getByRole('group', { name: 'Team of 6' });
    await expect(stack).toHaveTextContent('SL');
    await expect(stack).toHaveTextContent('+2');
    await expect(canvas.getByRole('heading', { level: 1, name: 'Intro call with Acme' })).toBeInTheDocument();
  },
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

const LINKS = [
  {
    id: 'intro',
    title: 'Intro call',
    address: '',
    href: '/ada/intro',
    description: 'A first chat about what you need.',
    chips: ['15 min'],
  },
  { id: 'demo', title: 'Product demo', address: '', href: '/ada/demo', chips: ['30 min', '60 min'] },
];
const TEAM_LINKS = [
  { id: 'team', title: 'Talk to sales', address: '', href: '/acme/sales', chips: ['30 min', 'Team'] },
];

/** A person's public profile (`/<handle>`): their card, then their Public links, the whole row opening each. */
export const Profile: Story = {
  render: () => (
    <Stage width="fill" height="page">
      <BookingProfile
        person={{ name: 'Ada Lovelace', id: 'ada', bio: 'Product at Acme. Happy to talk about anything.' }}
        claimHref="https://timefix.ai"
      >
        <BookingProfileSection>
          <LinkList
            label="Booking links"
            searchLabel="Search links"
            isToolbarHidden
            rowsAreLinks
            rows={LINKS}
            onOpen={fn()}
          />
        </BookingProfileSection>
        <BookingProfileSection title="Sales">
          <LinkList
            label="Sales"
            searchLabel="Search links"
            isToolbarHidden
            rowsAreLinks
            rows={TEAM_LINKS}
            onOpen={fn()}
          />
        </BookingProfileSection>
      </BookingProfile>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Ada Lovelace' })).toBeVisible();
    await expect(canvas.getByRole('heading', { level: 2, name: 'Sales' })).toBeVisible();
    // Each row is a real link, so it opens in a new tab and crawlers follow it.
    await expect(canvas.getByRole('link', { name: /Intro call/ })).toHaveAttribute('href', '/ada/intro');
  },
};

/** A profile while it loads: the card and the rows as skeletons. */
export const ProfileLoading: Story = {
  render: () => (
    <Stage width="fill" height="page">
      <BookingProfile>
        <LinkList
          label="Booking links"
          searchLabel="Search links"
          isToolbarHidden
          status="loading"
          rows={[]}
          onOpen={fn()}
        />
      </BookingProfile>
    </Stage>
  ),
};

/** A profile with nothing public to book yet. */
export const ProfileEmpty: Story = {
  render: () => (
    <Stage width="fill" height="page">
      <BookingProfile person={{ name: 'Ada Lovelace', id: 'ada' }} claimHref="https://timefix.ai">
        <EmptyState title="Nothing to book here yet" icon="calendar-clock">
          This person has no public booking links right now.
        </EmptyState>
      </BookingProfile>
    </Stage>
  ),
};

/** The story's own state, in a component so the artifact's preview can render it too. */
function Interactive(args: ComponentProps<typeof BookingFrame>) {
  const [day, setDay] = useState('2026-10-08');
  const [time, setTime] = useState<string | undefined>(undefined);
  return (
    <Stage width="fill" height="page">
      <BookingFrame
        {...args}
        heading="Choose a time"
        footer={
          <Button variant="primary" size="lg" isFullWidth="center" isDisabled={time === undefined}>
            {time === undefined ? 'Book' : `Book Thu Oct 8 at ${time}`}
          </Button>
        }
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
          <SlotList heading="Thu Oct 8" slots={TIMES} value={time} onChange={setTime} hour12 onHour12Change={fn()} />
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
}
