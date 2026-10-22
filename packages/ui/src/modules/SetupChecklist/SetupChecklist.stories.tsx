import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SetupChecklist, type SetupChecklistStep } from './SetupChecklist.tsx';

const STEPS: readonly SetupChecklistStep[] = [
  { id: 'calendar', title: 'Connect your calendar', detail: 'ada@example.com', isDone: true },
  { id: 'bookingPage', title: 'Create a booking page', detail: '1 page', isDone: true },
  { id: 'form', title: 'Create a form', detail: 'None yet', isDone: false, action: 'Create' },
  { id: 'invite', title: 'Invite your team', detail: 'Just you', isDone: false, action: 'Invite' },
];

const meta = {
  title: 'Modules/SetupChecklist',
  component: SetupChecklist,
  args: { title: 'Finish setting up', steps: STEPS, onAction: fn(), onHide: fn(), onRetry: fn() },
  render: (args) => (
    <Stage width="narrow-fill">
      <SetupChecklist {...args} />
    </Stage>
  ),
} satisfies Meta<typeof SetupChecklist>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two done, two open: the bar, the open steps' buttons, and the done steps folded. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('progressbar', { name: '2 of 4 done' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: '2 done' })).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(canvas.getByRole('button', { name: 'Create, Create a form' }));
    await expect(args.onAction).toHaveBeenCalledWith('form');
  },
};

/** An element's box; a missing element fails the story. */
function box(element: Element | null | undefined): DOMRect {
  if (element === null || element === undefined) throw new globalThis.Error('Expected an element to measure');
  return element.getBoundingClientRect();
}

/**
 * The done fold open: each done step with its check and detail. A done row lines up with an open row, check on
 * circle and title on title, and is as tall; the fold is a quiet control sized to its words, its chevron in the
 * marks' column and its words on the titles' line, with the done rows flush under it (the owner, 22 October 2026).
 */
export const DoneExpanded: Story = {
  args: { defaultDoneExpanded: true },
  play: async ({ canvas }) => {
    const done = canvas.getByRole('list', { name: '2 done' });
    await expect(within(done).getByText('Connect your calendar')).toBeVisible();
    await expect(within(done).queryByRole('button')).toBeNull();
    const openTitle = canvas.getByText('Create a form');
    const doneTitle = within(done).getByText('Connect your calendar');
    const openRow = openTitle.closest('li');
    const doneRow = doneTitle.closest('li');
    const openMark = box(openRow?.querySelector('svg'));
    await expect(box(doneRow?.querySelector('svg')).left).toBeCloseTo(openMark.left, 0);
    await expect(box(doneTitle).left).toBeCloseTo(box(openTitle).left, 0);
    await expect(box(doneRow).height).toBeCloseTo(box(openRow).height, 0);
    const fold = canvas.getByRole('button', { name: '2 done' });
    await expect(getComputedStyle(fold).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    await expect(box(fold).width).toBeLessThan(box(done).width / 2);
    const chevron = box(fold.querySelector('svg'));
    await expect(chevron.left + chevron.width / 2).toBeCloseTo(openMark.left + openMark.width / 2, 0);
    await expect(box(within(fold).getByText('2 done')).left).toBeCloseTo(box(openTitle).left, 0);
    await expect(box(done).top).toBeCloseTo(box(fold).bottom, 0);
  },
};

/** The done fold by keyboard: Tab reaches it after the ⋯ menu and the steps' buttons, Enter opens it, Space closes it. */
export const DoneKeyboard: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    const fold = canvas.getByRole('button', { name: '2 done' });
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'More setup actions' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Create, Create a form' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Invite, Invite your team' })).toHaveFocus();
    await userEvent.tab();
    await expect(fold).toHaveFocus();
    await expect(fold).toHaveAttribute('data-focus-visible');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{Enter}');
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await expect(within(canvas.getByRole('list', { name: '2 done' })).getByText('Connect your calendar')).toBeVisible();
    await userEvent.keyboard(' ');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
  },
};

/** Nothing done yet: an empty bar and no fold. */
export const NoneDone: Story = {
  args: { steps: STEPS.map((step) => ({ ...step, isDone: false, action: step.action ?? 'Connect' })) },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('progressbar', { name: '0 of 4 done' })).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /done$/ })).toBeNull();
  },
};

/** Every step done: one quiet line to dismiss. */
export const AllSet: Story = {
  args: { steps: STEPS.map((step) => ({ ...step, isDone: true })) },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText('You’re all set. Every setup step is done.')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss' }));
    await expect(args.onHide).toHaveBeenCalled();
  },
};

/** The ⋯ menu's Hide setup. */
export const HideMenu: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'More setup actions' }));
    const menu = await within(document.body).findByRole('menu');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Hide setup' }));
    await expect(args.onHide).toHaveBeenCalled();
  },
};

/** Loading: skeleton lines in the card. */
export const Loading: Story = {
  args: { status: 'loading', steps: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading setup')).toBeInTheDocument();
  },
};

/** The first read failed: Try again. */
export const Error: Story = {
  args: { status: 'error', steps: [] },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('alert')).toHaveAttribute('data-layout', 'row');
    await userEvent.click(canvas.getByRole('button', { name: /try again/i }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** The reader may not see setup: a locked row. */
export const NoAccess: Story = {
  args: { status: 'no-access', steps: [] },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('You can’t see setup for this workspace')).toBeInTheDocument();
  },
};

/** On a phone: a long title wraps beside its button, nothing past the edge. */
export const Phone: Story = {
  args: {
    steps: [
      {
        id: 'calendar',
        title: 'Connect your work calendar and your personal one',
        detail: 'Not connected',
        isDone: false,
        action: 'Connect',
      },
      ...STEPS.slice(1),
    ],
  },
  render: (args) => (
    <Stage width="phone">
      <SetupChecklist {...args} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('button', { name: /^Connect, / })).toBeVisible();
    await expect(canvasElement.scrollWidth <= canvasElement.clientWidth).toBe(true);
  },
};

/** One step left: a single row with that step's button and the menu. */
export const OneLeft: Story = {
  args: { steps: STEPS.map((step) => (step.id === 'invite' ? step : { ...step, isDone: true })) },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText('One setup step left: Invite your team')).toBeInTheDocument();
    await expect(canvas.queryByRole('progressbar')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Invite, Invite your team' }));
    await expect(args.onAction).toHaveBeenCalledWith('invite');
  },
};
