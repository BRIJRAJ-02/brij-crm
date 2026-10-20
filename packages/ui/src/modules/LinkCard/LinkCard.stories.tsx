import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { LinkCard, LinkCardSkeleton } from './LinkCard.tsx';

function actions(title: string, isOpenDisabled = false) {
  return (
    <>
      <Tooltip content={`Open ${title} in a new tab`}>
        <Button variant="ghost" size="lg" icon="external-link" label={`Open ${title}`} isDisabled={isOpenDisabled} />
      </Tooltip>
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
    toggle: { label: 'Intro call is on', isSelected: true, onChange: fn() },
  },
  render: (args) => (
    <Stage width="narrow">
      <LinkCard {...args} actions={actions(args.title)} />
    </Stage>
  ),
} satisfies Meta<typeof LinkCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A live booking page: its colour edge, the facts, the link, the switch, Copy link, Open and the menu. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('link', { name: 'Intro call' })).toBeInTheDocument();
    await expect(canvas.getByText('30 min · One on one')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('switch', { name: 'Intro call is on' }));
    await expect(args.toggle?.onChange).toHaveBeenCalledWith(false);
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  },
};

/** Off: quieter, its title muted and its edge grey, with no Off badge (the switch says it). */
export const Off: Story = {
  args: {
    isOff: true,
    toggle: { label: 'Intro call is on', isSelected: false, onChange: fn() },
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByText('Off')).not.toBeInTheDocument();
    await expect(canvas.getByRole('switch', { name: 'Intro call is on' })).not.toBeChecked();
  },
};

/** A form never published: the badge beside the title, its switch disabled with the reason in a tooltip. */
export const NotPublished: Story = {
  args: {
    title: 'Untitled form',
    href: '/w/acme/captures/forms/untitled',
    hue: undefined,
    facts: ['0 submissions'],
    address: '/f/untitled-form',
    badge: 'Not published',
    isOff: true,
    toggle: {
      label: 'Accepting submissions on Untitled form',
      isSelected: false,
      onChange: fn(),
      isDisabled: true,
      disabledReason: 'Publish it first',
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Not published')).toBeInTheDocument();
    await expect(canvas.getByRole('switch', { name: 'Accepting submissions on Untitled form' })).toBeDisabled();
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
            <Button variant="ghost" size="lg" icon="external-link" label="Open Intro call" />
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
  args: { title: 'Intro call (copy)', badge: 'Copying…', isPending: true },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('link')).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toBeDisabled();
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
    await expect(canvas.getByRole('button', { name: 'Open Intro call' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'More for Intro call' })).toHaveFocus();
  },
};

/** Its footer controls are 30px tall and at least space-8 apart, so none is missed. */
export const Targets: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    const copy = canvas.getByRole('button', { name: 'Copy link' }).getBoundingClientRect();
    const open = canvas.getByRole('button', { name: 'Open Intro call' }).getBoundingClientRect();
    const more = canvas.getByRole('button', { name: 'More for Intro call' }).getBoundingClientRect();
    for (const box of [copy, open, more]) await expect(box.height).toBeGreaterThanOrEqual(30);
    await expect(more.left - open.right).toBeGreaterThanOrEqual(8);
    await expect(open.left - copy.right).toBeGreaterThanOrEqual(8);
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
