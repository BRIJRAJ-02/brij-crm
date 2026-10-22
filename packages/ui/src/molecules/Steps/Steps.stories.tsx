import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Steps } from './Steps.tsx';

const STEPS = [
  { id: 'upload', label: 'Upload a file', description: 'CSV or Excel, up to 50 MB.' },
  { id: 'map', label: 'Map columns', description: 'Match each column to an attribute.' },
  { id: 'review', label: 'Review', description: 'Check what will be created and updated.' },
  { id: 'import', label: 'Import' },
] as const;

const meta = {
  title: 'Molecules/Steps',
  component: Steps,
  args: { label: 'Import progress', steps: STEPS, current: 'map' },
} satisfies Meta<typeof Steps>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Partway: one done, one current, two to come. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <Steps {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('listitem', { current: 'step' })).toHaveTextContent('Map columns');
    await expect(canvas.getByText('(done)')).toBeInTheDocument();
  },
};

/** In one row across the top of a page (import); a slot under 480px turns it back into the column. */
export const Horizontal: Story = {
  args: { steps: STEPS.map(({ id, label }) => ({ id, label })), orientation: 'horizontal' },
  render: (args) => (
    <Stage>
      <Steps {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('list', { name: 'Import progress' })).toHaveAttribute(
      'data-orientation',
      'horizontal',
    );
    await expect(canvas.getByRole('listitem', { current: 'step' })).toHaveTextContent('Map columns');
  },
};

/** Horizontal on a phone: under 480px the row turns back into the column, a done step and a failed one among them. */
export const HorizontalPhone: Story = {
  args: {
    steps: STEPS.map(({ id, label }) => ({ id, label })),
    orientation: 'horizontal',
    current: 'review',
    failed: 'review',
  },
  render: (args) => (
    <Stage width="phone">
      <Steps {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const items = canvas.getAllByRole('listitem');
    const [first, second] = items;
    // A column: each step under the one before.
    await expect((second?.getBoundingClientRect().top ?? 0) > (first?.getBoundingClientRect().top ?? 0)).toBe(true);
    await expect(canvas.getByText('(failed)')).toBeInTheDocument();
  },
};

/** A step that failed. */
export const Failed: Story = {
  args: { current: 'review', failed: 'review' },
  render: (args) => (
    <Stage>
      <Steps {...args} />
    </Stage>
  ),
};

/** Counted: one quiet line where the flow's own title names the step (first run). */
export const Count: Story = {
  args: {
    label: 'Setting up',
    variant: 'count',
    steps: [
      { id: 'about', label: 'About you' },
      { id: 'workspace', label: 'Your workspace' },
      { id: 'calendar', label: 'Connect your calendar' },
    ],
    current: 'workspace',
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Step 2 of 3')).toBeInTheDocument();
    await expect(canvas.queryByRole('list')).toBeNull();
  },
};
