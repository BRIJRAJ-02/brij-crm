import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Card } from '../../molecules/Card/Card.tsx';
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
      isOff: true,
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
      toggle: { label: 'Accepting enquiries on Contact us', isSelected: true, onChange: () => undefined },
      actions: icons('Contact us'),
    },
    {
      id: 'demo',
      title: 'Book a demo',
      address: '/f/book-a-demo',
      chips: ['0 responses'],
      badge: 'Off',
      isOff: true,
      toggle: { label: 'Accepting enquiries on Book a demo', isSelected: false, onChange: () => undefined },
      actions: icons('Book a demo'),
    },
    {
      id: 'untitled',
      title: 'Untitled form',
      address: '/f/untitled-form',
      chips: ['0 responses'],
      badge: 'Not published',
      isOff: true,
      toggle: {
        label: 'Accepting enquiries on Untitled form',
        isSelected: false,
        onChange: () => undefined,
        isDisabled: true,
        disabledReason: 'Publish it first',
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

/** Forms in the same rows: on, Off and Not published, with their responses as chips. */
export const Forms: Story = {
  args: { label: 'Forms', searchLabel: 'Search forms' },
  render: (args) => (
    <Stage>
      <LinkList {...args} rows={forms()} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText('Off')).toHaveLength(1);
    await expect(canvas.getByRole('switch', { name: 'Accepting enquiries on Untitled form' })).toBeDisabled();
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

/** Pressing a disabled control (an unpublished form's switch, Open and Copy link) never opens the row. */
export const DisabledControls: Story = {
  args: { label: 'Forms', searchLabel: 'Search forms', onOpen: fn() },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <LinkList {...args} rows={forms()} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('switch', { name: 'Accepting enquiries on Untitled form' }), {
      pointerEventsCheck: 0,
    });
    await userEvent.click(canvas.getByRole('button', { name: 'Open Untitled form' }), { pointerEventsCheck: 0 });
    await expect(args.onOpen).not.toHaveBeenCalled();
  },
};

/** No access: the locked state, in the library's words. */
export const NoAccess: Story = {
  args: { status: 'no-access' },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <LinkList {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('You can’t see this list')).toBeInTheDocument();
  },
};

/** Compact (Captures): one line rows at size-row with no frame, edge to edge with the page's gutter inside them. */
export const Compact: Story = {
  args: { density: 'compact', isToolbarHidden: true },
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="fill">
      <LinkList {...args} rows={pages()} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    const rows = canvas.getAllByRole('row');
    for (const row of rows) await expect(row.getBoundingClientRect().height).toBeLessThan(40);
    await expect(
      canvas.queryByText('A walk round the site with the project lead, then questions.'),
    ).not.toBeInTheDocument();
    await expect(canvas.getByText('60 min')).toBeVisible();
    await userEvent.click(canvas.getByText('Site visit'));
    await expect(args.onOpen).toHaveBeenCalledWith('visit');
  },
};

/** Compact forms: the Not published badge, the facts lined up in one column down the list. */
export const CompactForms: Story = {
  args: { density: 'compact', isToolbarHidden: true, label: 'Forms', searchLabel: 'Search forms' },
  render: (args) => (
    <Stage width="fill">
      <LinkList {...args} rows={forms()} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const first = canvas.getByText('12 responses').getBoundingClientRect();
    const second = canvas.getAllByText('0 responses')[0]?.getBoundingClientRect();
    await expect(second?.left).toBe(first.left);
  },
};

/** Compact by keyboard: the GridList model stays, arrows between rows and right to a row's controls. */
export const CompactKeyboard: Story = {
  args: { density: 'compact', isToolbarHidden: true },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
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

/** Compact on a phone: the facts and the address give way, so the title, switch and actions stay on one line. */
export const CompactNarrow: Story = {
  args: { density: 'compact', isToolbarHidden: true },
  render: (args) => (
    <Stage width="narrow">
      <LinkList {...args} rows={pages()} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('60 min')).not.toBeVisible();
    await expect(canvas.getByText('/acme/intro-call')).not.toBeVisible();
    for (const row of canvas.getAllByRole('row')) await expect(row.getBoundingClientRect().height).toBeLessThan(40);
  },
};

/** Compact inside a Card (Bookings › Availability's pages): rows keep to the card's padding, with no search. */
export const CompactInCard: Story = {
  args: { density: 'compact', placement: 'card', isToolbarHidden: true },
  render: (args) => (
    <Stage>
      <Card title="Your pages" description="The hours each page books on. Open one to change it.">
        <LinkList
          {...args}
          rows={pages().map((row) => ({
            id: row.id,
            title: row.title,
            address: row.address,
            chips: ['Your hours'],
            ...(row.badge === undefined ? {} : { badge: row.badge }),
            ...(row.isOff === undefined ? {} : { isOff: row.isOff }),
          }))}
        />
      </Card>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('row')).toHaveLength(2);
  },
};

/** Compact while loading: one line skeleton rows. */
export const CompactLoading: Story = {
  args: { density: 'compact', isToolbarHidden: true, status: 'loading' },
  render: (args) => (
    <Stage width="fill">
      <LinkList {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading Booking pages')).toBeInTheDocument();
  },
};

/** Compact and failed: the failure where the rows go, with Try again. */
export const CompactFailed: Story = {
  args: {
    density: 'compact',
    isToolbarHidden: true,
    status: 'error',
    onRetry: fn(),
    errorTitle: 'Booking pages didn’t load',
  },
  render: (args) => (
    <Stage width="fill">
      <LinkList {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Try again/ }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** Compact with its own search: nothing matches, with Clear search. */
export const CompactNoMatches: Story = {
  args: { density: 'compact' },
  render: (args) => (
    <Stage width="fill">
      <LinkList {...args} rows={pages()} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search booking pages' }), 'xyz');
    await expect(canvas.getByText('Nothing matches “xyz”')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Clear search' }));
    await expect(canvas.getByText('Intro call')).toBeInTheDocument();
  },
};

/** Compact with a copy on its way: quieter, and it doesn't open until the server made it. */
export const CompactPending: Story = {
  args: { density: 'compact', isToolbarHidden: true },
  render: (args) => (
    <Stage width="fill">
      <LinkList
        {...args}
        rows={[
          {
            id: 'copy',
            title: 'Intro call (copy)',
            address: '/acme/intro-call-copy',
            chips: ['30 min'],
            badge: 'Copying…',
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

/** Compact with long facts: the facts column stops at a wide column and clips, so the titles keep their room. */
export const CompactLongFacts: Story = {
  args: { density: 'compact', isToolbarHidden: true, label: 'Forms', searchLabel: 'Search forms' },
  render: (args) => (
    <Stage width="fill">
      <LinkList
        {...args}
        rows={forms().map((row) =>
          row.id === 'contact'
            ? { ...row, chips: ['12 responses', '2 spam', 'Last enquiry Mon, Oct 19 · 3:42 PM', 'Shared with sales'] }
            : row,
        )}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const title = canvas.getByText('Contact us').getBoundingClientRect();
    await expect(title.width).toBeGreaterThan(40);
  },
};

/** Compact in a narrow Card: rows take more lines rather than hiding the address or the facts. */
export const CompactInCardNarrow: Story = {
  args: { density: 'compact', placement: 'card', isToolbarHidden: true },
  render: (args) => (
    <Stage width="narrow">
      <Card title="Your pages">
        <LinkList
          {...args}
          rows={[
            {
              id: 'visit',
              title: 'Site visit with the project lead',
              address: 'Mon to Fri, 9:00 AM to 5:00 PM',
              chips: ['Your hours'],
              badge: 'Off',
              isOff: true,
            },
          ]}
        />
      </Card>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Mon to Fri, 9:00 AM to 5:00 PM')).toBeVisible();
    await expect(canvas.getByText('Your hours')).toBeVisible();
  },
};
