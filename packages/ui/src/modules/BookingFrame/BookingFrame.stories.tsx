import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { SegmentedControl } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { timefixLinkTags, timefixTags } from '../../workbench/timefix-links.ts';
import { BookingDetails } from '../BookingDetails/BookingDetails.tsx';
import { DayStrip } from '../DayStrip/DayStrip.tsx';
import { MonthTiles } from '../MonthTiles/MonthTiles.tsx';
import { SlotList } from '../SlotList/SlotList.tsx';
import { LinkList } from '../LinkList/LinkList.tsx';
import {
  BookingFrame,
  BookingHandleOffer,
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

/** "Claim your free page" as the booking page passes it, `claimPageHref('booking_page')`. */
const PAGE_CLAIM =
  'https://www.timefix.com/?utm_source=timefix&utm_medium=booking_page&utm_campaign=powered_by&utm_content=claim_link';
/** "Claim your free page" as a profile passes it, `claimPageHref('booking_profile')`. */
const PROFILE_CLAIM =
  'https://www.timefix.com/?utm_source=timefix&utm_medium=booking_profile&utm_campaign=powered_by&utm_content=claim_link';

const meta = {
  title: 'Modules/BookingFrame',
  component: BookingFrame,
  args: {
    host: { name: 'Ada Lovelace' },
    title: 'Intro call · 30 min',
    description: 'A first chat about what you need.',
    facts: FACTS,
    claimHref: PAGE_CLAIM,
  },
} satisfies Meta<typeof BookingFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The first step: the rail beside the card, the month and the chosen day's times, and the Book bar. */
export const ChooseATime: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Intro call · 30 min' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: /^9:30 AM/ }));
    await expect(canvas.getByRole('button', { name: 'Book Thu Oct 8 at 9:30 AM' })).toBeEnabled();
    // Both feet, the rail's (wide screens) and the page's (phones): each link tagged as the booking page's.
    await expect(timefixLinkTags(canvasElement)).toEqual([
      timefixTags('booking_page', 'footer_logo'),
      timefixTags('booking_page', 'claim_link'),
      timefixTags('booking_page', 'footer_logo'),
      timefixTags('booking_page', 'claim_link'),
    ]);
  },
};

/** The host's social links (booking socials, 25 Oct 2026): the last line of their block, under the facts. */
const SOCIALS = [
  { network: 'linkedin', href: 'https://linkedin.com/in/ada-lovelace', label: 'ada-lovelace' },
  { network: 'x', href: 'https://x.com/ada', label: '@ada' },
  { network: 'github', href: 'https://github.com/ada', label: 'ada' },
  { network: 'website', href: 'https://ada.dev', label: 'ada.dev' },
] as const;

/** A host who added social links: a row of marks closes their block, each a named link opening in a new tab. */
export const WithSocials: Story = {
  args: { host: { name: 'Ada Lovelace', socials: [...SOCIALS] } },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas }) => {
    const list = canvas.getByRole('list', { name: 'Ada Lovelace’s social links' });
    await expect(list).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'LinkedIn, ada-lovelace' })).toHaveAttribute('target', '_blank');
  },
};

/**
 * List over the month (25 October 2026): the month stays underneath, hidden and inert, and sets the card's size, so
 * switching views moves nothing; the views crossfade.
 */
export const SwitchingViews: Story = {
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas, canvasElement }) => {
    const card = () => canvasElement.querySelector('section')?.getBoundingClientRect();
    const atMonth = card();
    await userEvent.click(canvas.getByRole('radio', { name: 'List' }));
    // The month fades out and the List in over it; settled, the List is read at rest.
    await waitFor(() => expect(document.getAnimations().filter((each) => each.playState === 'running')).toEqual([]));
    await expect(canvas.getByRole('group', { name: /days/i })).toBeVisible();
    // The month is out of reach under the List: one Book bar to press, one set of times.
    await expect(canvas.getAllByRole('button', { name: 'Book' })).toHaveLength(1);
    await expect(card()?.height).toBe(atMonth?.height);
    await expect(card()?.y).toBe(atMonth?.y);
  },
};

/**
 * A page opening on Book by chat, while it loads: the chat's shape over the month (the greeting's place at the top,
 * the composer's at the foot), so the card is the month's size from the first frame.
 */
export const ChatLoadingOverMonth: Story = {
  render: (args) => (
    <Stage width="fill" height="page">
      <BookingFrame
        {...args}
        heading="Choose a time"
        view="chat"
        footer={
          <Button variant="primary" size="lg" isFullWidth="center" isDisabled>
            Book
          </Button>
        }
        aside={<SlotList heading="" slots={[]} value={undefined} onChange={fn()} isLoading />}
        cover={
          <>
            <Skeleton shape="block" lines={3} />
            <Skeleton shape="block" />
          </>
        }
      >
        <MonthTiles
          month="2026-10"
          today="2026-10-08"
          openDays={new Set()}
          value={undefined}
          onChange={fn()}
          onMonthChange={fn()}
          canPrevious={false}
          canNext={false}
          isLoading
        />
      </BookingFrame>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const body = canvasElement.querySelector('section > div:last-child')?.getBoundingClientRect();
    const composer = canvasElement
      .querySelector('section [inert] + div > div > [data-shape]:last-child')
      ?.getBoundingClientRect();
    // The composer's place stands at the foot of the card's body.
    await expect(composer).toBeDefined();
    await expect(Math.abs((body?.bottom ?? 0) - (composer?.bottom ?? 0))).toBeLessThanOrEqual(32);
  },
};

/**
 * Book, then Back (25 October 2026): the details step takes the whole card over the month, in from the end, and Back
 * brings the month in from the start, the card one size throughout.
 */
export const StepToDetailsAndBack: Story = {
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas, canvasElement }) => {
    const card = () => canvasElement.querySelector('section')?.getBoundingClientRect();
    const atMonth = card();
    await userEvent.click(canvas.getByRole('button', { name: /^9:30 AM/ }));
    await userEvent.click(canvas.getByRole('button', { name: 'Book Thu Oct 8 at 9:30 AM' }));
    // Focus is on the step's heading at once, while it slides in.
    await expect(canvas.getByRole('heading', { name: 'Your details' })).toHaveFocus();
    await expect(card()?.height).toBe(atMonth?.height);
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(document.getAnimations().filter((each) => each.playState === 'running')).toEqual([]));
    await expect(canvas.getByRole('button', { name: 'Book Thu Oct 8 at 9:30 AM' })).toBeVisible();
    await expect(card()?.height).toBe(atMonth?.height);
  },
};

/** From the keyboard (25 October 2026): a view or a step chosen by key shows at once, and nothing replays after. */
export const FromTheKeyboard: Story = {
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas, canvasElement }) => {
    // The card's own moves: its heading row, the month under, and the view or step over it (not the times' own
    // stagger, the switches' indicators or a button's colour).
    const running = () => {
      const card = canvasElement.querySelector('section');
      const stage = card?.lastElementChild;
      return [card?.firstElementChild, stage?.firstElementChild, stage?.children[1]]
        .flatMap((part) => part?.getAnimations() ?? [])
        .filter((each) => each.playState === 'running');
    };
    await userEvent.click(canvas.getByRole('button', { name: /^9:30 AM/ }));
    canvas.getByRole('radio', { name: 'Month' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('radio', { name: 'List' })).toBeChecked();
    await expect(running()).toEqual([]);
    // Book by key: the details show at once, focus on their heading.
    canvas.getByRole('button', { name: 'Book Thu Oct 8 at 9:30 AM' }).focus();
    await userEvent.keyboard('{Enter}');
    await expect(canvas.getByRole('heading', { name: 'Your details' })).toHaveFocus();
    await expect(running()).toEqual([]);
    await userEvent.tab();
    await expect(running()).toEqual([]);
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
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { name: 'This page didn’t load' })).toHaveFocus();
    // A message on the booking page keeps the page's tags, with the wordmark alone.
    await expect(timefixLinkTags(canvasElement)).toEqual([timefixTags('booking_page', 'footer_logo')]);
  },
};

/** A profile's address that names nobody: the same message, its Timefix link tagged as the profile's. */
export const ProfileNotFound: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="fill" height="page">
      <BookingMessage title="Page not found" page="booking_profile">
        This address has no public page.
      </BookingMessage>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await expect(timefixLinkTags(canvasElement)).toEqual([timefixTags('booking_profile', 'footer_logo')]);
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
        person={{
          name: 'Ada Lovelace',
          id: 'ada',
          bio: 'Product at Acme. Happy to talk about anything.',
          socials: [...SOCIALS],
        }}
        claimHref={PROFILE_CLAIM}
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
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Ada Lovelace' })).toBeVisible();
    await expect(canvas.getByRole('heading', { level: 2, name: 'Sales' })).toBeVisible();
    // Each row is a real link, so it opens in a new tab and crawlers follow it.
    await expect(canvas.getByRole('link', { name: /Intro call/ })).toHaveAttribute('href', '/ada/intro');
    // The foot's links are tagged as the profile's, not the booking page's.
    await expect(timefixLinkTags(canvasElement)).toEqual([
      timefixTags('booking_profile', 'footer_logo'),
      timefixTags('booking_profile', 'claim_link'),
    ]);
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
  play: async ({ canvasElement }) => {
    await expect(timefixLinkTags(canvasElement)).toEqual([timefixTags('booking_profile', 'footer_logo')]);
  },
};

/** A profile with nothing public to book yet. */
export const ProfileEmpty: Story = {
  render: () => (
    <Stage width="fill" height="page">
      <BookingProfile person={{ name: 'Ada Lovelace', id: 'ada' }} claimHref={PROFILE_CLAIM}>
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
  const [view, setView] = useState('month');
  const [step, setStep] = useState<'pick' | 'details' | 'back'>('pick');
  const bookBar = (
    <Button
      variant="primary"
      size="lg"
      isFullWidth="center"
      isDisabled={time === undefined}
      onPress={() => setStep('details')}
    >
      {time === undefined ? 'Book' : `Book Thu Oct 8 at ${time}`}
    </Button>
  );
  return (
    <Stage width="fill" height="page">
      <BookingFrame
        {...args}
        heading="Choose a time"
        footer={bookBar}
        view={step === 'details' ? 'details' : view}
        {...(step === 'details'
          ? {
              cover: (
                <BookingDetails
                  onBack={() => setStep('back')}
                  onSubmit={fn(() => Promise.resolve({ kind: 'done' as const }))}
                />
              ),
              coverPlace: 'card' as const,
              enter: 'forward' as const,
            }
          : step === 'back'
            ? { enter: 'back' as const }
            : {})}
        {...(step !== 'details' && view === 'list'
          ? {
              cover: (
                <>
                  <DayStrip days={[...OPEN]} value={day} onChange={setDay} />
                  <SlotList
                    heading="Thu Oct 8"
                    slots={TIMES}
                    value={time}
                    onChange={setTime}
                    hour12
                    onHour12Change={fn()}
                    layout="grid"
                  />
                </>
              ),
              coverFooter: bookBar,
            }
          : {})}
        toolbar={
          <SegmentedControl
            label="View"
            value={view}
            onChange={(next) => {
              setView(next);
              // A switch is a fresh look, as the page's is: Back's slide doesn't replay.
              setStep('pick');
            }}
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

/** An address nobody holds (25 Oct 2026): the quiet fact, the offer, and the one action. The foot carries the
   wordmark alone, since the card is already the claim. */
export const HandleFree: Story = {
  render: () => (
    <Stage width="fill" height="page">
      <BookingHandleOffer address="timefix.com/ada" handle="ada" claimHref="/sign-in?handle=ada" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await expect(timefixLinkTags(canvasElement)).toEqual([timefixTags('booking_profile', 'footer_logo')]);
  },
};

/**
 * The longest address a handle can make, which has to break rather than run off a phone. No screenshot: the wrap
 * it proves is the browser's own, and this lane doesn't add baselines.
 */
export const HandleFreeLongest: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="fill" height="page">
      <BookingHandleOffer
        address="timefix.com/ada-lovelace-and-charles-babbage-1843"
        handle="ada-lovelace-and-charles-babbage-1843"
        claimHref="/sign-in?handle=ada-lovelace-and-charles-babbage-1843"
      />
    </Stage>
  ),
};

/**
 * `isCompact`: the stacked layout kept however wide the window is, for a page
 * drawn in something narrow that is not a frame of its own (first run's
 * preview of a page that doesn't exist yet). The same layout the page already
 * has below its breakpoint, so no screenshot of its own.
 */
export const Compact: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="fill" height="page">
      <BookingFrame
        isCompact
        host={{ name: 'Ada Lovelace' }}
        title="Intro call"
        facts={[{ id: 'length', icon: 'clock', children: '30 min' }]}
        heading="Choose a time"
      >
        <p>The month goes here.</p>
      </BookingFrame>
    </Stage>
  ),
};
