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

/** The done fold open: each done step with its check and detail. */
export const DoneExpanded: Story = {
  args: { defaultDoneExpanded: true },
  play: async ({ canvas }) => {
    const done = canvas.getByRole('list', { name: '2 done' });
    await expect(within(done).getByText('Connect your calendar')).toBeVisible();
    await expect(within(done).queryByRole('button')).toBeNull();
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
    await userEvent.click(canvas.getByRole('button', { name: /try again/i }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};
