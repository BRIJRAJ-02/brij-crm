import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import type { Hue } from '../../hue.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { LinkGrid, type LinkGridCard } from './LinkGrid.tsx';

function actions(title: string) {
  return (
    <>
      <Tooltip content={`Open ${title} in a new tab`}>
        <Button variant="ghost" size="lg" icon="external-link" label={`Open ${title}`} />
      </Tooltip>
      <Button variant="ghost" size="lg" icon="ellipsis" label={`More for ${title}`} />
    </>
  );
}

function page(id: string, title: string, hue: Hue, facts: readonly string[], extra: Partial<LinkGridCard> = {}) {
  return {
    id,
    title,
    href: `/w/acme/captures/links/${id}`,
    hue,
    facts,
    address: `/acme/${id}`,
    copyValue: `https://example.com/b/${id}`,
    toggle: { label: `${title} is on`, isSelected: extra.isOff !== true, onChange: () => undefined },
    actions: actions(title),
    ...extra,
  } satisfies LinkGridCard;
}

function pages(): LinkGridCard[] {
  return [
    page('intro-call', 'Intro call', 'blue', ['30 min · 60 min', 'One on one']),
    page('site-visit', 'Site visit with the project lead', 'green', ['90 min', 'One on one', 'In person']),
    page('deep-dive', 'Deep dive', 'orange', ['45 min', 'Collective'], { isOff: true }),
    page('office-hours', 'Office hours', 'purple', ['15 min', 'Round robin'], { badge: 'Private' }),
  ];
}

function forms(): LinkGridCard[] {
  return [
    {
      id: 'contact',
      title: 'Contact us',
      href: '/w/acme/captures/forms/contact',
      facts: ['12 submissions', '2 spam'],
      address: '/f/contact-us',
      copyValue: 'https://example.com/f/contact-us',
      toggle: { label: 'Accepting submissions on Contact us', isSelected: true, onChange: () => undefined },
      actions: actions('Contact us'),
    },
    {
      id: 'untitled',
      title: 'Untitled form',
      href: '/w/acme/captures/forms/untitled',
      facts: ['0 submissions'],
      address: '/f/untitled-form',
      badge: 'Not published',
      isOff: true,
      copyValue: 'https://example.com/f/untitled-form',
      toggle: {
        label: 'Accepting submissions on Untitled form',
        isSelected: false,
        onChange: () => undefined,
        isDisabled: true,
        disabledReason: 'Publish it first',
      },
      actions: actions('Untitled form'),
    },
  ];
}

const meta = {
  title: 'Modules/LinkGrid',
  component: LinkGrid,
  args: { label: 'Booking pages', cards: [] },
} satisfies Meta<typeof LinkGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Booking pages: live, off, private; as many columns as fit, the cards in a row as tall as each other. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="fill">
      <LinkGrid {...args} cards={pages()} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const items = canvas.getAllByRole('listitem');
    await expect(items).toHaveLength(4);
    const [first, second] = items.map((item) => item.getBoundingClientRect());
    await expect(Math.round(second?.top ?? 0)).toBe(Math.round(first?.top ?? 1));
    await expect(Math.round(second?.height ?? 0)).toBe(Math.round(first?.height ?? 1));
  },
};

/** Forms: no colour of their own, so a neutral edge; one not published yet. */
export const Forms: Story = {
  args: { label: 'Forms' },
  render: (args) => (
    <Stage width="fill">
      <LinkGrid {...args} cards={forms()} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Not published')).toBeInTheDocument();
  },
};

/**
 * Grouped (Captures › Links with a workspace link, 30 Oct 2026): each group under its h2 with its own grid, the cards'
 * titles h3s. No baseline yet: its screenshot joins with the next visual run in the pinned image.
 */
export const Grouped: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <LinkGrid
        {...args}
        groups={[
          { id: 'workspace', label: 'Workspace', description: 'Book whoever is working, round robin' },
          { id: 'members', label: 'Members’ pages' },
        ]}
        cards={[
          page('talk-to-us', 'Talk to us', 'blue', ['30 min', 'Workspace link'], { groupId: 'workspace' }),
          ...pages().map((card) => ({ ...card, groupId: 'members' })),
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Workspace' })).toBeInTheDocument();
    await expect(canvas.getByRole('list', { name: 'Workspace' }).querySelectorAll('li')).toHaveLength(1);
    await expect(canvas.getByRole('list', { name: 'Members’ pages' }).querySelectorAll('li')).toHaveLength(4);
    await expect(canvas.getByRole('heading', { level: 3, name: 'Talk to us' })).toBeInTheDocument();
  },
};

/** Many cards: the grid wraps them into rows. */
export const Many: Story = {
  render: (args) => (
    <Stage width="fill">
      <LinkGrid
        {...args}
        cards={Array.from({ length: 12 }, (_, index) =>
          page(`page-${String(index + 1)}`, `Meeting ${String(index + 1)}`, index % 2 === 0 ? 'sky' : 'lime', [
            `${String((index % 4) * 15 + 15)} min`,
            'One on one',
          ]),
        )}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('listitem')).toHaveLength(12);
  },
};

/** On a phone: one column. */
export const Phone: Story = {
  render: (args) => (
    <Stage width="narrow">
      <LinkGrid {...args} cards={pages()} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const [first, second] = canvas.getAllByRole('listitem').map((item) => item.getBoundingClientRect());
    await expect(second?.top ?? 0).toBeGreaterThan(first?.bottom ?? 0);
  },
};

/** Pressing a card opens it; pressing its switch or Copy link doesn't. */
export const Opens: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <LinkGrid {...args} cards={pages()} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: 'Intro call' });
    await expect(link).toHaveAttribute('href', '/w/acme/captures/links/intro-call');
    // The link covers the card: a press on its facts lands on the link.
    const facts = canvas.getByText('30 min · 60 min · One on one').getBoundingClientRect();
    const hit = document.elementFromPoint(facts.left + 4, facts.top + 4);
    await expect(hit).toBe(link);
    const toggle = canvas.getByRole('switch', { name: 'Intro call is on' }).getBoundingClientRect();
    const onToggle = document.elementFromPoint(toggle.left + toggle.width / 2, toggle.top + toggle.height / 2);
    await expect(onToggle).not.toBe(link);
  },
};

/** The search narrows the cards by title or link, and says when nothing matches, with Clear search. */
export const NoMatches: Story = {
  args: { query: 'xyz', onQueryChange: fn() },
  render: (args) => (
    <Stage width="fill">
      <LinkGrid {...args} cards={pages()} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText('Nothing matches “xyz”')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Clear search' }));
    await expect(args.onQueryChange).toHaveBeenCalledWith('');
  },
};

/** Loading: skeleton cards in the cards' shape, after the loading delay. */
export const Loading: Story = {
  args: { status: 'loading' },
  render: (args) => (
    <Stage width="fill">
      <LinkGrid {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading Booking pages')).toBeInTheDocument();
  },
};

/** Failed, with Try again. */
export const Failed: Story = {
  args: { status: 'error', onRetry: fn(), errorTitle: 'Booking pages didn’t load' },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <LinkGrid {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Try again/ }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** No access: the locked state. */
export const NoAccess: Story = {
  args: { status: 'no-access' },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <LinkGrid {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('You can’t see these')).toBeInTheDocument();
  },
};

/** No cards yet: the caller's empty state. */
export const Empty: Story = {
  render: (args) => (
    <Stage width="fill">
      <LinkGrid
        {...args}
        emptyState={<EmptyState title="No booking pages yet">Make one and share its link.</EmptyState>}
      />
    </Stage>
  ),
};
