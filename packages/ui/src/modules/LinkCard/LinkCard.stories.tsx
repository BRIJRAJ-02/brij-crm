import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FormPicture } from '../FormPicture/FormPicture.tsx';
import { Link } from '../../atoms/Link/Link.tsx';
import { LinkCard, LinkCardSkeleton } from './LinkCard.tsx';

/** Open (only while it is on: there is nothing to open on an off link) and the ··· menu. */
function actions(title: string, canOpen = true) {
  return (
    <>
      {canOpen && (
        <Tooltip content="Open in a new tab">
          <Button variant="ghost" size="lg" icon="external-link" label={`Open ${title} in a new tab`} />
        </Tooltip>
      )}
      <Button variant="ghost" size="lg" icon="ellipsis" label={`More for ${title}`} />
    </>
  );
}

const meta = {
  title: 'Modules/LinkCard',
  component: LinkCard,
  args: {
    title: 'Intro call',
    href: '/w/acme/captures/links/intro',
    hue: 'blue',
    facts: ['30 min', 'One on one'],
    address: '/acme/intro-call',
    copyValue: 'https://example.com/b/intro',
    toggle: { label: 'Intro call is on', isSelected: true, onChange: fn(), hint: 'Taking bookings' },
  },
  render: (args) => (
    <Stage width="narrow">
      <LinkCard {...args} actions={actions(args.title, args.isOff !== true)} />
    </Stage>
  ),
} satisfies Meta<typeof LinkCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A live booking page: its colour dot, the facts, the link, the switch, Copy link, Open and the menu. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas, canvasElement, args }) => {
    await expect(canvas.getByRole('link', { name: 'Intro call' })).toBeInTheDocument();
    await expect(canvas.getByText('30 min · One on one')).toBeInTheDocument();
    // Its colour is a small dot before the title, never a stripe (T3, 4 November 2026).
    await expect(canvasElement.querySelector('[data-dot]')).not.toBeNull();
    await userEvent.click(canvas.getByRole('switch', { name: 'Intro call is on' }));
    await expect(args.toggle?.onChange).toHaveBeenCalledWith(false);
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  },
};

/** Off: quieter, its title muted (its dot keeps its colour), with no Off badge (the switch says it). */
export const Off: Story = {
  args: {
    isOff: true,
    toggle: { label: 'Intro call is on', isSelected: false, onChange: fn() },
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByText('Off')).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /^Open/ })).not.toBeInTheDocument();
    await expect(canvas.getByRole('switch', { name: 'Intro call is on' })).not.toBeChecked();
  },
};

/** A form never published: the badge beside the title and what to do, with no switch, no address and nothing to copy. */
export const NotPublished: Story = {
  args: {
    title: 'Untitled form',
    href: '/w/acme/captures/forms/untitled',
    hue: undefined,
    colourKey: '01a15d53-7271-7fec-919b-2575bf34beea',
    facts: ['Publish it to start taking submissions'],
    address: undefined,
    badge: 'Not published',
    isOff: true,
    copyValue: undefined,
    toggle: undefined,
  },
  render: (args) => (
    <Stage width="narrow">
      <LinkCard
        {...args}
        actions={<Button variant="ghost" size="lg" icon="ellipsis" label={`More for ${args.title}`} />}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Not published')).toBeInTheDocument();
    await expect(canvas.getByText('Publish it to start taking submissions')).toBeInTheDocument();
    // Nothing to switch, copy or open until it is published.
    await expect(canvas.queryByRole('switch')).not.toBeInTheDocument();
    await expect(canvas.queryByText(/^\/f\//)).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
  },
};

/** A form taking submissions: no colour dot, its counts, and its switch's hint on hover. */
export const Form: Story = {
  args: {
    title: 'Contact us',
    href: '/w/acme/captures/forms/contact',
    hue: undefined,
    facts: ['12 submissions', '2 spam'],
    address: '/f/contact-us',
    copyValue: 'https://example.com/f/contact-us',
    toggle: {
      label: 'Accepting submissions on Contact us',
      isSelected: true,
      onChange: fn(),
      hint: 'Accepting submissions',
    },
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('12 submissions · 2 spam')).toBeInTheDocument();
    // A form has no colour of its own, so no dot (T3, 4 November 2026).
    await expect(canvasElement.querySelector('[data-dot]')).toBeNull();
    // The tooltip waits out its open delay; a busy runner can miss the first hover, so it hovers again until shown.
    const toggle = canvas.getByRole('switch', { name: 'Accepting submissions on Contact us' });
    await waitFor(
      async () => {
        await userEvent.hover(toggle);
        await expect(await within(document.body).findByRole('tooltip', {}, { timeout: 2000 })).toHaveTextContent(
          'Accepting submissions',
        );
      },
      { timeout: 10_000 },
    );
    // The pointer rests on the empty page, and the tooltip is gone before the screenshot.
    await userEvent.hover(canvasElement);
    await waitFor(() => expect(document.querySelector('[role="tooltip"]')).toBeNull(), { timeout: 4000 });
  },
};

/** A private page: live, but only for people given the link. */
export const Private: Story = {
  args: { badge: 'Private', hue: 'purple' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Private')).toBeInTheDocument();
  },
};

/** A long title wraps to two lines and stops; the link truncates. */
export const LongTitle: Story = {
  args: {
    title: 'Site visit with the project lead, then a walk round the plot and questions about access',
    address: '/acme/site-visit-with-the-project-lead-then-a-walk-round-the-plot',
    hue: 'green',
  },
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: /Site visit/ });
    const height = link.getBoundingClientRect().height;
    await expect(height).toBeLessThan(48);
  },
};

/** Someone else's page, without the permission to change it: the switch is disabled with why; Copy link and Open still work. */
export const ReadOnly: Story = {
  args: {
    toggle: {
      label: 'Intro call is on',
      isSelected: true,
      onChange: fn(),
      isDisabled: true,
      disabledReason: 'Only its owner or an admin can change it',
    },
  },
  render: (args) => (
    <Stage width="narrow">
      <LinkCard
        {...args}
        actions={
          <Tooltip content="Open Intro call in a new tab">
            <Button variant="ghost" size="lg" icon="external-link" label="Open Intro call in a new tab" />
          </Tooltip>
        }
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('switch', { name: 'Intro call is on' })).toBeDisabled();
    await expect(canvas.queryByRole('button', { name: 'More for Intro call' })).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toBeEnabled();
  },
};

/** A copy on its way: quieter still, not a link yet, and its controls wait. */
export const Pending: Story = {
  args: { title: 'Intro call (copy)', badge: 'Copying', isPending: true },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('link')).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toBeDisabled();
  },
};

/** Focused from the keyboard: the whole card rings (in forced colours, the title draws an outline). */
export const Focused: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('link', { name: 'Intro call' })).toHaveFocus();
  },
};

/** By keyboard: the title link first, then the switch, Copy link, Open and the menu. */
export const Keyboard: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('link', { name: 'Intro call' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('switch', { name: 'Intro call is on' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Open Intro call in a new tab' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'More for Intro call' })).toHaveFocus();
  },
};

/** Its footer controls are 30px tall and at least space-8 apart, and a press that misses one does nothing. */
export const Targets: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    const copy = canvas.getByRole('button', { name: 'Copy link' }).getBoundingClientRect();
    const open = canvas.getByRole('button', { name: 'Open Intro call in a new tab' }).getBoundingClientRect();
    const more = canvas.getByRole('button', { name: 'More for Intro call' }).getBoundingClientRect();
    for (const box of [copy, open, more]) await expect(box.height).toBeGreaterThanOrEqual(30);
    await expect(more.left - open.right).toBeGreaterThanOrEqual(8);
    await expect(open.left - copy.right).toBeGreaterThanOrEqual(8);
    const link = canvas.getByRole('link', { name: 'Intro call' });
    // Just past Copy link, and just beside the switch: neither lands on the card's link.
    await expect(document.elementFromPoint(copy.right + 4, copy.top + copy.height / 2)).not.toBe(link);
    const toggle = canvas.getByRole('switch', { name: 'Intro call is on' }).getBoundingClientRect();
    await expect(document.elementFromPoint(toggle.left - 2, toggle.bottom + 4)).not.toBe(link);
  },
};

/** While the grid loads: a card's shape in skeletons. */
export const Loading: Story = {
  render: () => (
    <Stage width="narrow">
      <LinkCardSkeleton />
    </Stage>
  ),
};

/**
 * A pictured form (5 November 2026): its name and first questions as shapes across the top, hidden and inert; its
 * state as a dot and a word, then its submissions as a quiet link at the facts line's end; its address in the foot
 * with Copy link a quiet icon and the ··· menu, as a booking page's card.
 */
export const Pictured: Story = {
  parameters: { crm: { preview: true } },
  args: {
    title: 'Contact us',
    href: '/w/acme/captures/forms/contact',
    hue: undefined,
    facts: [],
    address: '/f/contact-us',
    toggle: undefined,
    isCopyQuiet: true,
    status: { label: 'Live', hue: 'green' },
    picture: (
      <FormPicture
        title="Contact us"
        count="4 questions"
        fields={[{ kind: 'text' }, { kind: 'text' }, { kind: 'choices', count: 3 }]}
        hue="blue"
      />
    ),
    factsEnd: (
      <Link href="/w/acme/captures/forms/contact?tab=submissions" tone="quiet" label="24 submissions to Contact us">
        24 submissions
      </Link>
    ),
  },
  render: (args) => (
    <Stage width="narrow">
      <LinkCard {...args} actions={<Button variant="ghost" size="lg" icon="ellipsis" label="More for Contact us" />} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('Live')).toBeInTheDocument();
    // The picture is shown, never read or reached: hidden and inert, its name its only words.
    const stage = canvasElement.querySelector('[aria-hidden="true"][inert]');
    await expect(stage?.textContent).toBe('Contact us4 questions');
    // The count is its own link on the facts line, above the card's.
    const count = canvas.getByRole('link', { name: '24 submissions to Contact us' });
    const spot = count.getBoundingClientRect();
    await expect(document.elementFromPoint(spot.left + spot.width / 2, spot.top + spot.height / 2)).toBe(count);
    // Copy link is an icon with its name, no words.
    const copy = canvas.getByRole('button', { name: 'Copy link' });
    await expect(copy.textContent.trim()).toBe('');
    // A press on the picture opens the card: the title's link lies over it.
    const box = stage?.getBoundingClientRect();
    if (box !== undefined) {
      await expect(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)).toBe(
        canvas.getByRole('link', { name: 'Contact us' }),
      );
    }
  },
};

/** While a pictured grid loads: the card's shape with its stage. */
export const LoadingPictured: Story = {
  render: () => (
    <Stage width="narrow">
      <LinkCardSkeleton hasPicture />
    </Stage>
  ),
};

/**
 * `page` (Bookings › Pages, the mock of 9 November 2026): the kind's tile, the title and ⋯; one facts line, who it books
 * with and the link; a foot band with Copy link and the card's own control (its Live or Hidden menu).
 */
export const PageVariant: Story = {
  args: {
    variant: 'page',
    icon: 'refresh-cw',
    facts: ['45 min', 'Zoom', 'Team, taking turns'],
    address: 'timefix.com/brij/product-demo',
    people: {
      people: [
        { id: 'p1', name: 'Priya Nair' },
        { id: 'p2', name: 'Oliver Brown' },
        { id: 'p3', name: 'Arjun Mehta' },
      ],
      label: '3 hosts',
    },
    footEnd: (
      <Button dot="green" iconRight="chevron-down" label="Live, status of Intro call">
        Live
      </Button>
    ),
  },
  render: (args) => (
    <Stage width="narrow">
      <LinkCard {...args} actions={<Button variant="ghost" icon="ellipsis" label={`More for ${args.title}`} />} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Intro call' })).toBeInTheDocument();
    await expect(canvas.getByText('45 min · Zoom · Team, taking turns')).toBeInTheDocument();
    await expect(canvas.getByText('timefix.com/brij/product-demo')).toBeInTheDocument();
    await expect(canvas.getByRole('group', { name: '3 hosts' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Live, status of Intro call' })).toBeInTheDocument();
  },
};

/** `page`, hidden: the title and the inset read quieter; Copy link stays. */
export const PageHidden: Story = {
  args: {
    ...PageVariant.args,
    isOff: true,
    footEnd: (
      <Button dot="gray" iconRight="chevron-down">
        Hidden
      </Button>
    ),
  },
  render: PageVariant.render,
};

/** `page`, loading. */
export const PageLoading: Story = {
  render: () => (
    <Stage width="narrow">
      <LinkCardSkeleton variant="page" />
    </Stage>
  ),
};

/** `page`, on its way (a copy being made): Copying, quieter, nothing works yet. */
export const PagePending: Story = {
  args: { ...PageVariant.args, isPending: true, badge: 'Copying' },
  render: PageVariant.render,
};

/** `page`, view only (a member's look at the workspace link): no editor or ⋯, its state shown but not changed. */
export const PageViewOnly: Story = {
  args: {
    ...PageVariant.args,
    href: undefined,
    badge: 'View only',
    footEnd: (
      <Button dot="green" iconRight="chevron-down" isDisabled>
        Live
      </Button>
    ),
  },
  render: (args) => (
    <Stage width="narrow">
      <LinkCard {...args} />
    </Stage>
  ),
};
