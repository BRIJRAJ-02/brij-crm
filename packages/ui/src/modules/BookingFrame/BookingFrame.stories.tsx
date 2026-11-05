import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { SegmentedControl } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import { timefixLinkTags, timefixTags } from '../../workbench/timefix-links.ts';
import { BookingDetails } from '../BookingDetails/BookingDetails.tsx';
import { DayStrip } from '../DayStrip/DayStrip.tsx';
import { GuestLook } from '../GuestLook/GuestLook.tsx';
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
    // The clock and the view share the heading row's end, one group on one line (spec 0058, AC-24).
    const clock = canvas.getByRole('radiogroup', { name: 'Clock' });
    const view = canvas.getByRole('radiogroup', { name: 'View' });
    await expect(clock.parentElement).toBe(view.parentElement);
    await expect(clock.getBoundingClientRect().top).toBe(view.getBoundingClientRect().top);
    // Both feet, the rail's (wide screens) and the page's (phones): each link tagged as the booking page's.
    await expect(timefixLinkTags(canvasElement)).toEqual([
      timefixTags('booking_page', 'footer_logo'),
      timefixTags('booking_page', 'claim_link'),
      timefixTags('booking_page', 'footer_logo'),
      timefixTags('booking_page', 'claim_link'),
    ]);
  },
};

/** An orange brand, as `brandProperties(brandVariables({ accent: '#e8590c' }))` makes it (spec 0060, AC-7). */
const ORANGE_BRAND = [
  ['--brand-accent', '#e65708'],
  ['--brand-on-accent', '#000000'],
  ['--brand-link', '#b74300'],
  ['--brand-accent-dark', '#e8590c'],
  ['--brand-on-accent-dark', '#000000'],
  ['--brand-link-dark', '#fd6c2b'],
] as const;

/** A stand in logo: a mark and a word, in one fill. */
const LOGO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 60"><circle cx="30" cy="30" r="24" fill="#e8590c"/><rect x="66" y="18" width="160" height="24" rx="6" fill="#e8590c"/></svg>',
)}`;

/**
 * The workspace's brand kit (spec 0060, AC-4): its logo heads the rail, and its accent marks the chosen day, the
 * chosen time, Book and the focus ring. The steps and the requests are the same as without it.
 */
export const Branded: Story = {
  parameters: { crm: { screenshot: false } },
  args: { brand: { logo: { src: LOGO, alt: 'Acme' }, variables: ORANGE_BRAND } },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'Acme' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: /^9:30 AM/ }));
    const book = canvas.getByRole('button', { name: 'Book Thu Oct 8 at 9:30 AM' });
    await expect(getComputedStyle(book).backgroundColor).toBe('rgb(230, 87, 8)');
  },
};

/** A booking page in one of the four templates (spec 0068, AC-6801), the workspace's, in the orange brand. */
function templated(template: 'classic' | 'studio' | 'night' | 'split'): Story {
  return {
    args: { brand: { logo: { src: LOGO, alt: 'Acme' }, variables: ORANGE_BRAND, template } },
    render: (args) => <Interactive {...args} />,
    play: async ({ canvasElement }) => {
      const root = canvasElement.querySelector('main');
      await expect(root).toHaveAttribute('data-template', template);
      // Night pins dark and Studio light; Classic and Split follow the visitor.
      const scheme = template === 'night' ? 'dark' : template === 'studio' ? 'light' : null;
      await expect(root?.getAttribute('data-theme') ?? null).toBe(scheme);
    },
  };
}

/** Classic: the booking page as it always was, its headings in a clean grotesk. */
export const TemplateClassic: Story = templated('classic');
/** Studio: a warm ground and an editorial serif for the host. */
export const TemplateStudio: Story = templated('studio');
/** Night: a deep dark ground with the accent as a glow. */
export const TemplateNight: Story = templated('night');
/** Split: the rail as a sticky panel on the page's own ground (no card around it) beside the card, from the page breakpoint. */
export const TemplateSplit: Story = templated('split');

/** A navy brand, as `brandProperties(brandVariables({ accent: '#1f2a5a' }))` makes it: dark, lifted for dark pages. */
const NAVY_BRAND = [
  ['--brand-accent', '#1f2a5a'],
  ['--brand-on-accent', '#ffffff'],
  ['--brand-link', '#1f2a5a'],
  ['--brand-accent-dark', '#6878af'],
  ['--brand-on-accent-dark', '#000000'],
  ['--brand-link-dark', '#8597d0'],
] as const;

/** A yellow brand, as `brandProperties(brandVariables({ accent: '#f5c518' }))` makes it: darkened for light pages. */
const YELLOW_BRAND = [
  ['--brand-accent', '#a38100'],
  ['--brand-on-accent', '#000000'],
  ['--brand-link', '#806600'],
  ['--brand-accent-dark', '#f5c518'],
  ['--brand-on-accent-dark', '#000000'],
  ['--brand-link-dark', '#f5c518'],
] as const;

/**
 * A template in a hard accent (spec 0068, AC-6802): navy or yellow, the accent adjusted where it carries text (spec
 * 0060), and axe checks AA in light and dark on every one. A time is chosen, so Book wears the accent.
 */
function accented(
  template: 'classic' | 'studio' | 'night' | 'split',
  variables: typeof NAVY_BRAND | typeof YELLOW_BRAND,
): Story {
  return {
    parameters: { crm: { screenshot: false } },
    args: { brand: { logo: { src: LOGO, alt: 'Acme' }, variables, template } },
    render: (args) => <Interactive {...args} />,
    play: async ({ canvas }) => {
      await userEvent.click(canvas.getByRole('button', { name: /^9:30 AM/ }));
      await expect(canvas.getByRole('button', { name: 'Book Thu Oct 8 at 9:30 AM' })).toBeEnabled();
    },
  };
}

/** Classic in navy. */
export const ClassicNavy: Story = accented('classic', NAVY_BRAND);
/** Classic in yellow. */
export const ClassicYellow: Story = accented('classic', YELLOW_BRAND);
/** Studio in navy: the paper takes a touch of the navy. */
export const StudioNavy: Story = accented('studio', NAVY_BRAND);
/** Studio in yellow. */
export const StudioYellow: Story = accented('studio', YELLOW_BRAND);
/** Night in navy: the lifted navy glows. */
export const NightNavy: Story = accented('night', NAVY_BRAND);
/** Night in yellow. */
export const NightYellow: Story = accented('night', YELLOW_BRAND);
/** Split in navy. */
export const SplitNavy: Story = accented('split', NAVY_BRAND);
/** Split in yellow. */
export const SplitYellow: Story = accented('split', YELLOW_BRAND);

/**
 * Night's Book before a time is chosen: neutral rather than the accent at half strength, so it reads as waiting
 * and its words still hold 4.5:1 on the dark card (spec 0068).
 */
export const NightBookWaiting: Story = {
  args: { brand: { logo: { src: LOGO, alt: 'Acme' }, variables: NAVY_BRAND, template: 'night' } },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas }) => {
    const book = canvas.getByRole('button', { name: 'Book' });
    await expect(book).toBeDisabled();
    // Neutral: the waiting Book wears no accent.
    await expect(getComputedStyle(book).backgroundColor).not.toBe('rgb(104, 120, 175)');
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

/** A host who shows their job title (3 Nov 2026): a quiet line between their name and the meeting's title. */
export const WithRole: Story = {
  args: { host: { name: 'Ada Lovelace', role: 'Head of partnerships' } },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Head of partnerships')).toBeVisible();
  },
};

/** A restaurant whose one place carries its name (spec 0066 B7): the name shows once, as the h1. */
export const SameNameHost: Story = {
  parameters: { crm: { screenshot: false } },
  args: { host: { name: 'Somewhere' }, title: 'Somewhere' },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Somewhere' })).toBeInTheDocument();
    await expect(canvas.getAllByText('Somewhere', { exact: true })).toHaveLength(1);
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
    // Focus is in the first field at once, while it slides in, and the card keeps its size.
    await expect(canvas.getByRole('textbox', { name: /Your name/ })).toHaveFocus();
    await expect(card()?.height).toBe(atMonth?.height);
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(document.getAnimations().filter((each) => each.playState === 'running')).toEqual([]));
    await expect(canvas.getByRole('button', { name: 'Book Thu Oct 8 at 9:30 AM' })).toBeVisible();
    await expect(card()?.height).toBe(atMonth?.height);
  },
};

/**
 * In a site's embed (3 November 2026) the card follows its step: the details step is as tall as the details, not
 * the month, since the frame takes the page's height. Back brings the month, at its own height, again.
 */
export const EmbeddedStepToDetails: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => <Interactive {...args} isEmbedded />,
  play: async ({ canvas, canvasElement }) => {
    const card = () => canvasElement.querySelector('section')?.getBoundingClientRect().height ?? 0;
    const atMonth = card();
    await userEvent.click(canvas.getByRole('button', { name: /^9:30 AM/ }));
    await userEvent.click(canvas.getByRole('button', { name: 'Book Thu Oct 8 at 9:30 AM' }));
    await waitFor(() => expect(document.getAnimations().filter((each) => each.playState === 'running')).toEqual([]));
    await expect(card()).toBeLessThan(atMonth);
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(document.getAnimations().filter((each) => each.playState === 'running')).toEqual([]));
    await expect(card()).toBe(atMonth);
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
    // Book by key: the details show at once, focus in their first field.
    canvas.getByRole('button', { name: 'Book Thu Oct 8 at 9:30 AM' }).focus();
    await userEvent.keyboard('{Enter}');
    await expect(canvas.getByRole('textbox', { name: /Your name/ })).toHaveFocus();
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

/** A reservation's manage link that opens nothing (spec 0066 B7): Try again, and a way on to find it by code. */
export const FailedWithLink: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="fill" height="page">
      <BookingMessage
        title="Your reservation"
        onRetry={fn()}
        link={{ label: 'Find your reservation', href: '/r/somewhere/manage' }}
        page="booking_manage"
      >
        This link doesn’t open a reservation.
      </BookingMessage>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Find your reservation' })).toHaveAttribute(
      'href',
      '/r/somewhere/manage',
    );
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
/** A restaurant's day: Lunch from 12:00 and Dinner from 18:00, a quarter hour apart, on the place's clock. */
const SERVICES = [
  { id: 'lunch', heading: 'Lunch', from: 12 * 60, count: 6 },
  { id: 'dinner', heading: 'Dinner', from: 18 * 60, count: 9 },
].map((service) => ({
  id: service.id,
  heading: service.heading,
  slots: Array.from({ length: service.count }, (_, index) => {
    const at = service.from + index * 15;
    const label = `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`;
    return { id: `${service.id}-${label}`, label, name: `${label}, Fri 9 Oct` };
  }),
}));

/**
 * A restaurant's reservation page (5 November 2026, after checklabs): the guest menu's look (GuestLook, here with
 * no look stylesheet, so its token fallbacks: the ink as the accent), the place's tile beside its name with Manage
 * booking under its facts, the plain month, the day's Lunch and Dinner in one list, and the Book bar.
 */
export const Reservation: Story = {
  args: {
    host: { name: 'Somewhere' },
    title: 'Reserve your table',
    description: 'Pick a date and time at Somewhere.',
    facts: [
      { id: 'where', icon: 'map-pin', children: '1 Example Street, London' },
      { id: 'phone', icon: 'phone', children: '020 7946 0000' },
    ],
    identity: 'tile',
    railLink: { label: 'Manage booking', href: '/r/abcdefghijklmnop/manage' },
  },
  render: (args) => (
    <GuestLook>
      <Reserving {...args} />
    </GuestLook>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Reserve your table' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Manage booking' })).toHaveAttribute(
      'href',
      '/r/abcdefghijklmnop/manage',
    );
    await expect(canvas.getByRole('button', { name: 'Pick a time' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: /^19:30/ }));
    const book = canvas.getByRole('button', { name: 'Continue · Fri 9 Oct, 19:30' });
    // The ink, never the app's blue: with no look stylesheet the Book bar takes the inverse surface (#18191d in light).
    await expect(getComputedStyle(book).backgroundColor).toBe('rgb(24, 25, 29)');
    // The times and the month drew in while the play ran: settled, so the theme checks read their real colours.
    await settleAnimations();
  },
};

/** Checklabs' Nova values, light and dark, as `--menu-*`: a stand in for the look stylesheet, so axe reads both themes. */
const MENU_LOOK = [
  ['--menu-ground', 'light-dark(#ffffff, #141414)'],
  ['--menu-card', 'light-dark(#ffffff, #1c1c1c)'],
  ['--menu-chip', 'light-dark(#f5f1ea, #2b2824)'],
  ['--menu-line', 'light-dark(#0000000f, #ffffff17)'],
  ['--menu-text', 'light-dark(#1a1a1a, #f5f5f5)'],
  ['--menu-quiet', 'light-dark(#6b6b6b, #a8a8a8)'],
  ['--menu-accent', 'light-dark(#1a1a1a, #f5f5f5)'],
  ['--menu-on-accent', 'light-dark(#ffffff, #141414)'],
] as const;

/** The reservation page with the menu's look stylesheet linked: the cream chips, the hairlines and the ink. */
export const ReservationMenuLook: Story = {
  args: Reservation.args,
  render: (args) => (
    <MenuLook>
      <GuestLook>
        <Reserving {...args} />
      </GuestLook>
    </MenuLook>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: /^12:15/ }));
    const book = canvas.getByRole('button', { name: 'Continue · Fri 9 Oct, 12:15' });
    await expect(getComputedStyle(book).backgroundColor).toBe('rgb(26, 26, 26)');
    await settleAnimations();
  },
};

/** Sets the menu's look on a wrapper, as its stylesheet sets it on the page's root. */
function MenuLook({ children }: { readonly children: ReactNode }) {
  return (
    <div
      ref={(element) => {
        for (const [name, value] of MENU_LOOK) element?.style.setProperty(name, value);
      }}
    >
      {children}
    </div>
  );
}

/** The reservation page's month view, then its details step, as the page drives them. */
function Reserving(args: ComponentProps<typeof BookingFrame>) {
  const [day, setDay] = useState('2026-10-09');
  const [time, setTime] = useState<string | undefined>(undefined);
  const [step, setStep] = useState<'pick' | 'details'>('pick');
  const label = SERVICES.flatMap((service) => service.slots).find((slot) => slot.id === time)?.label;
  return (
    <Stage width="fill" height="page">
      <BookingFrame
        {...args}
        heading="Choose a date"
        view={step}
        {...(step === 'details'
          ? {
              cover: (
                <BookingDetails
                  needsPhone
                  maxGuests={0}
                  fieldSize="lg"
                  isPhoneFirst
                  labels={{ name: 'Full name', phone: 'Phone', confirm: `Confirm Fri 9 Oct at ${label ?? ''}` }}
                  onBack={() => setStep('pick')}
                  onSubmit={fn(() => Promise.resolve({ kind: 'done' as const }))}
                />
              ),
              coverPlace: 'card' as const,
              enter: 'forward' as const,
            }
          : {})}
        aside={
          <SlotList
            heading="Friday 9 October"
            badge={<Badge text="15 available" isWhole />}
            slots={[]}
            groups={SERVICES}
            value={time}
            onChange={setTime}
          />
        }
        footer={
          <Button
            variant="primary"
            size="lg"
            isFullWidth="center"
            isDisabled={time === undefined}
            onPress={() => setStep('details')}
          >
            {label === undefined ? 'Pick a time' : `Continue · Fri 9 Oct, ${label}`}
          </Button>
        }
      >
        <MonthTiles
          tone="plain"
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

function Interactive(args: ComponentProps<typeof BookingFrame>) {
  const [day, setDay] = useState('2026-10-08');
  const [time, setTime] = useState<string | undefined>(undefined);
  const [view, setView] = useState('month');
  const [step, setStep] = useState<'pick' | 'details' | 'back'>('pick');
  const [hour12, setHour12] = useState(true);
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
                    hour12={hour12}
                    layout="grid"
                  />
                </>
              ),
              coverFooter: bookBar,
            }
          : {})}
        // The picker's corner as the page draws it (spec 0058, AC-24): the clock and the view in one compact group.
        toolbar={
          <>
            <SegmentedControl
              label="Clock"
              value={hour12 ? '12' : '24'}
              onChange={(next) => setHour12(next === '12')}
              segments={[
                { value: '12', label: '12h' },
                { value: '24', label: '24h' },
              ]}
            />
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
          </>
        }
        aside={<SlotList heading="Thu Oct 8" slots={TIMES} value={time} onChange={setTime} hour12={hour12} />}
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

/**
 * `isEmbedded`: inside a site's embed the page is as tall as what it holds, never the frame, because the embed
 * script sizes the frame to what the page reports. Measured, not shot: it looks like any short page.
 */
export const Embedded: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="fill" height="page">
      <BookingFrame
        isEmbedded
        host={{ name: 'Ada Lovelace' }}
        title="Intro call"
        facts={[{ id: 'length', icon: 'clock', children: '30 min' }]}
        heading="Choose a time"
      >
        <p>The month goes here.</p>
      </BookingFrame>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const page = canvasElement.querySelector('main');
    await expect(page).not.toBeNull();
    await expect(page?.getBoundingClientRect().height ?? 0).toBeLessThan(globalThis.innerHeight / 2);
  },
};
