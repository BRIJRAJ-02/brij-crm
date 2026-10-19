import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { LinkList, type LinkRow } from './LinkList.tsx';

function icons(title: string, isOff = false) {
  return (
    <>
      <Button variant="ghost" icon="external-link" label={`Open ${title}`} isDisabled={isOff} />
      <Button variant="ghost" icon="copy" label={`Copy link to ${title}`} />
      <Button variant="ghost" icon="ellipsis" label={`More for ${title}`} />
    </>
  );
}

function pages(onToggle: (isOn: boolean) => void = () => undefined): LinkRow[] {
  return [
    {
      id: 'intro',
      title: 'Intro call',
      address: '/acme/intro-call',
      chips: ['30 min', '60 min'],
      toggle: { label: 'Intro call is on', isSelected: true, onChange: onToggle },
      actions: icons('Intro call'),
    },
    {
      id: 'visit',
      title: 'Site visit',
      address: '/acme/site-visit',
      description: 'A walk round the site with the project lead, then questions.',
      chips: ['90 min', 'Own hours', 'In person'],
      badge: 'Off',
      toggle: { label: 'Site visit is on', isSelected: false, onChange: () => undefined },
      actions: icons('Site visit', true),
    },
  ];
}

function forms(): LinkRow[] {
  return [
    {
      id: 'contact',
      title: 'Contact us',
      address: '/f/contact-us',
      chips: ['12 responses', '2 spam'],
      toggle: { label: 'Contact us is accepting enquiries', isSelected: true, onChange: () => undefined },
      actions: icons('Contact us'),
    },
    {
      id: 'demo',
      title: 'Book a demo',
      address: '/f/book-a-demo',
      chips: ['0 responses'],
      badge: 'Paused',
      toggle: { label: 'Book a demo is accepting enquiries', isSelected: false, onChange: () => undefined },
      actions: icons('Book a demo'),
    },
    {
      id: 'untitled',
      title: 'Untitled form',
      address: '/f/untitled-form',
      chips: ['0 responses'],
      badge: 'Not published',
      toggle: {
        label: 'Untitled form is accepting enquiries',
        isSelected: false,
        onChange: () => undefined,
        isDisabled: true,
      },
      actions: icons('Untitled form', true),
    },
  ];
}

const meta = {
  title: 'Modules/LinkList',
  component: LinkList,
  args: {
    label: 'Booking pages',
    searchLabel: 'Search booking pages',
    rows: [],
    onOpen: fn(),
    actions: (
      <Button variant="primary" icon="plus">
        New booking page
      </Button>
    ),
  },
} satisfies Meta<typeof LinkList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two booking pages, one off; pressing anywhere on a row opens it, a control in it doesn't. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <LinkList {...args} rows={pages()} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText('Off')).toBeInTheDocument();
    await userEvent.click(canvas.getByText('Site visit'));
    await expect(args.onOpen).toHaveBeenCalledWith('visit');
    await userEvent.click(canvas.getByRole('button', { name: 'Copy link to Intro call' }));
    await expect(args.onOpen).toHaveBeenCalledTimes(1);
  },
};

/** Forms in the same rows: on, Paused and Not published, with their responses as chips. */
export const Forms: Story = {
  args: { label: 'Forms', searchLabel: 'Search forms' },
  render: (args) => (
    <Stage>
      <LinkList {...args} rows={forms()} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Paused')).toBeInTheDocument();
    await expect(canvas.getByRole('switch', { name: 'Untitled form is accepting enquiries' })).toBeDisabled();
  },
};

/** The switch turns a row on or off without opening it. */
export const Toggle: Story = {
  args: { onOpen: fn() },
  parameters: { crm: { screenshot: false } },
  render: (args) => {
    const onToggle = fn();
    return (
      <Stage>
        <LinkList {...args} rows={pages(onToggle)} />
      </Stage>
    );
  },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('switch', { name: 'Intro call is on' }));
    await expect(args.onOpen).not.toHaveBeenCalled();
  },
};

/** The search narrows the rows by title or address, and says when nothing matches. */
export const Search: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <LinkList {...args} rows={pages()} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search booking pages' }), 'visit');
    await expect(canvas.queryByText('Intro call')).not.toBeInTheDocument();
    await expect(canvas.getByText('Site visit')).toBeInTheDocument();
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search booking pages' }), 'xyz');
    await expect(canvas.getByText('Nothing matches “visitxyz”')).toBeInTheDocument();
  },
};

/** By keyboard: the arrows move between rows, Enter opens one, right reaches its controls. */
export const Keyboard: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <LinkList {...args} rows={pages()} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    canvas.getAllByRole('row')[0]?.focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getAllByRole('row')[1]).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onOpen).toHaveBeenCalledWith('visit');
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(canvas.getByRole('switch', { name: 'Site visit is on' })).toHaveFocus());
  },
};

/** A copy on its way: drawn quieter, and it doesn't open until the server made it. */
export const Pending: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <LinkList
        {...args}
        rows={[
          {
            id: 'copy',
            title: 'Intro call (copy)',
            address: '/acme/intro-call-copy',
            chips: ['30 min'],
            toggle: { label: 'Intro call (copy) is on', isSelected: true, onChange: () => undefined },
            actions: icons('Intro call (copy)', true),
            isPending: true,
          },
          ...pages(),
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByText('Intro call (copy)'));
    await expect(args.onOpen).not.toHaveBeenCalled();
  },
};

/** Loading: the search row, then skeleton rows in the rows' shape, after the loading delay. */
export const Loading: Story = {
  args: { status: 'loading' },
  render: (args) => (
    <Stage>
      <LinkList {...args} />
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
    <Stage>
      <LinkList {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Try again/ }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** No pages yet: the caller's empty state. */
export const Empty: Story = {
  render: (args) => (
    <Stage>
      <LinkList
        {...args}
        emptyState={<EmptyState title="No booking pages yet">Make one and share its link.</EmptyState>}
      />
    </Stage>
  ),
};
