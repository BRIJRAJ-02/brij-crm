import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { probeAlignment } from '../../lib/alignment-probe.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SpotIllustration } from '../SpotIllustration/SpotIllustration.tsx';
import { EmptyState } from './EmptyState.tsx';

const meta = {
  title: 'Molecules/EmptyState',
  component: EmptyState,
  args: { title: 'No deals yet' },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The default: one quiet line in the list's place, with its one action after the words. No mark and no tile: the
 * title says what is missing, the button what to do.
 */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  args: {
    title: 'No matches',
    actions: (
      <Button variant="ghost" size="sm">
        Clear filters
      </Button>
    ),
  },
  play: async ({ canvas }) => {
    const status = canvas.getByRole('status');
    await expect(status).toHaveTextContent('No matches');
    await expect(status).toHaveAttribute('data-layout', 'row');
    // A row's height, starting where a row's words start, and no icon of any kind.
    // size-row at the app's density (spec 0071).
    await expect(Math.round(status.getBoundingClientRect().height)).toBe(38);
    await expect(status.querySelector('svg:not(button svg)')).toBeNull();
  },
};

/** A row with no action: the words alone, at a list row's height. */
export const Row: Story = {
  parameters: { crm: { screenshot: false } },
  args: { title: 'No open tasks.', icon: 'list-todo' },
  play: async ({ canvas }) => {
    const status = canvas.getByRole('status');
    await expect(status).toHaveTextContent('No open tasks.');
    // size-row at the app's density (spec 0071).
    await expect(Math.round(status.getBoundingClientRect().height)).toBe(38);
    // A row never draws the glyph it was given.
    await expect(status.querySelector('svg')).toBeNull();
  },
};

/** A whole surface's first run: a centred block with a bare glyph (never a tile), one line and the next step. */
export const FirstRun: Story = {
  args: {
    title: 'No deals yet',
    icon: 'handshake',
    layout: 'block',
    actions: (
      <>
        <Button variant="primary" icon="plus">
          Add deal
        </Button>
        <Button>Import</Button>
      </>
    ),
  },
  play: async ({ canvas }) => {
    const status = canvas.getByRole('status');
    await expect(status).toHaveAttribute('data-layout', 'block');
    const mark = status.firstElementChild;
    await expect(mark).not.toBeNull();
    if (mark === null) return;
    // The glyph is bare: no edge and no fill behind it.
    await expect(getComputedStyle(mark).borderTopStyle).toBe('none');
    await expect(getComputedStyle(mark).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  },
};

/** A row with a line of text (Home's cards): the text sits under the title, both beside the icon. */
export const RowWithText: Story = {
  args: {
    title: 'No meetings today',
    children: 'Meetings you host and your calendar’s events show here.',
    layout: 'row',
  },
  render: (args) => (
    <Stage width="narrow">
      <EmptyState {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const title = canvas.getByText('No meetings today');
    const text = canvas.getByText(/calendar’s events show here/);
    // The text starts where the title does, on the line below it.
    await expect(Math.round(text.getBoundingClientRect().left)).toBe(Math.round(title.getBoundingClientRect().left));
    await expect(text.getBoundingClientRect().top).toBeGreaterThan(title.getBoundingClientRect().top);
  },
};

/** A row that failed, with text and Try again: the alert mark beside the title, both in the danger colour. */
export const RowErrorWithText: Story = {
  args: {
    title: 'Recent records didn’t load',
    children: 'Check your connection.',
    tone: 'error',
    layout: 'row',
    onRetry: fn(),
  },
  play: async ({ canvas, args }) => {
    // Try again starts where the words start, not centred under them.
    const title = canvas.getByText('Recent records didn’t load').getBoundingClientRect();
    const retry = canvas.getByRole('button', { name: 'Try again' }).getBoundingClientRect();
    await expect(Math.abs(retry.left - title.left)).toBeLessThan(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** Fill: centred in the whole height of its slot, for an empty view with the whole area. */
export const Fill: Story = {
  parameters: { crm: { screenshot: false } },
  args: { title: 'Nothing coming up', layout: 'fill' },
  render: (args) => (
    <Stage height="grid">
      <EmptyState {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    // It takes the slot's height (a header and twelve rows), far more than its own block needs.
    await expect(canvas.getByRole('status').getBoundingClientRect().height).toBeGreaterThan(300);
  },
};

/** A load that failed: not emptiness. Its alert mark and title in the danger colour, and Try again inline. */
export const Failed: Story = {
  args: {
    tone: 'error',
    title: 'Couldn’t load deals',
    onRetry: fn(),
  },
  play: async ({ canvas, args, userEvent }) => {
    const alert = canvas.getByRole('alert');
    await expect(alert).toHaveTextContent('Couldn’t load deals');
    const title = canvas.getByText('Couldn’t load deals');
    // The title takes the danger colour, so it never reads as "nothing here yet".
    await expect(getComputedStyle(title).color).not.toBe(getComputedStyle(canvas.getByRole('button')).color);
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** A whole surface that failed: the block, with its mark and Try again under the words. */
export const FailedBlock: Story = {
  args: { tone: 'error', title: 'Couldn’t load deals', layout: 'block', onRetry: fn() },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveAttribute('data-layout', 'block');
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible();
  },
};

/** An error with no retry of its own still has Try again (it loads the page again), so it is never a dead end. */
export const FailedWithoutRetry: Story = {
  parameters: { crm: { screenshot: false } },
  args: { tone: 'error', title: 'Couldn’t load deals' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible();
  },
};

/** A view the viewer may not see. */
export const Locked: Story = {
  args: { tone: 'locked', title: 'You can’t see this list', children: 'Ask a workspace admin for access.' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('You can’t see this list');
  },
};

/** Still loading: skeleton lines where the title and text go, so what follows lands in place. The title is read as the busy status. */
export const Loading: Story = {
  args: { isLoading: true, title: 'Loading', layout: 'block' },
  play: async ({ canvas }) => {
    const status = canvas.getByRole('status');
    await expect(status).toHaveAttribute('aria-busy', 'true');
    await expect(status).toHaveTextContent('Loading');
    await expect(canvas.queryByText('No deals yet')).toBeNull();
  },
};

/** A first empty moment: a picture of what will be here over one heading, one line and one action, all on one centre line. */
export const Illustration: Story = {
  parameters: { crm: { preview: true } },
  args: {
    title: 'No booking pages yet',
    children: 'Make one and share the link.',
    illustration: <SpotIllustration kind="booking" />,
    layout: 'block',
    actions: (
      <Button variant="primary" icon="plus">
        New booking page
      </Button>
    ),
  },
  render: (args) => (
    <Stage width="fill">
      <div data-slot="">
        <EmptyState {...args} />
      </div>
    </Stage>
  ),
  play: async ({ canvas }) => {
    // The picture is decoration: the heading alone says what is missing.
    await expect(canvas.getByText('No booking pages yet')).toBeVisible();
    const status = canvas.getByRole('status');
    // The picture draws at its own size: the slot shrink wraps, so a picture with no width of its own vanishes.
    await expect(status.firstElementChild?.getBoundingClientRect().width ?? 0).toBeGreaterThan(0);
    const centre = (element: Element) =>
      element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2;
    for (const child of status.children) await expect(Math.abs(centre(child) - centre(status))).toBeLessThan(1);
    const report = probeAlignment({ root: 'body', ignoreSpacing: '*' });
    await expect(report.failures).toEqual([]);
  },
};
