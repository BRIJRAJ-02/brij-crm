import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Stepper, type StepperProps } from './Stepper.tsx';

/** A Stepper holding its own count. */
function Counted({ start = 1, ...rest }: Omit<StepperProps, 'value' | 'onChange'> & { readonly start?: number }) {
  const [count, setCount] = useState(start);
  return <Stepper {...rest} value={count} onChange={setCount} />;
}

const meta = {
  title: 'Molecules/Stepper',
  component: Stepper,
  args: { label: 'Quantity', value: 1 },
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The 30px hairline pill a dish's row and a selection line use, its name for screen readers: one more counts up. */
export const Small: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <Counted label="How many Flat white" isLabelHidden start={2} moreLabel="Add another Flat white" />
      <Counted label="How many Margherita" isLabelHidden start={1} tone="filled" />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const group = canvas.getByRole('group', { name: 'How many Flat white' });
    await expect(group).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Add another Flat white' }));
    await waitFor(() => expect(canvas.getAllByRole('status')[0]).toHaveTextContent('3'));
  },
};

/** The 40px pill with its label over it: a reservation's party size, 1 to 12. */
export const Medium: Story = {
  render: () => (
    <Stage>
      <Counted label="Party size" size="md" start={2} min={1} max={12} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Party size' })).toBeVisible();
  },
};

/** The 48px pill of the chip colour at a sheet's foot. */
export const Large: Story = {
  render: () => (
    <Stage>
      <Counted label="Quantity" isLabelHidden size="lg" tone="filled" start={2} min={1} max={99} />
    </Stage>
  ),
};

/**
 * Checklabs' row stepper (`row`): 30px, 24px buttons, a 13px semibold count, the − and + in the text colour and bolder,
 * on a dish's row and a selection line.
 */
export const Row: Story = {
  render: () => (
    <Stage>
      <Counted label="How many Edamame" isLabelHidden size="row" start={2} moreLabel="Add another Edamame" />
      <Counted label="How many Miso soup" isLabelHidden size="row" start={1} min={0} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const more = canvas.getByRole('button', { name: 'Add another Edamame' });
    await expect(more.getBoundingClientRect().height).toBe(24);
    await expect(canvas.getByRole('group', { name: 'How many Edamame' }).getBoundingClientRect().height).toBe(30);
    await userEvent.click(more);
    await waitFor(() => expect(canvas.getAllByRole('status')[0]).toHaveTextContent('3'));
  },
};

/** Checklabs' sheet quantity (`sheet`): 48px of the chip colour, 32px buttons, beside a sheet's 48px action. */
export const Sheet: Story = {
  render: () => (
    <Stage>
      <Counted label="Quantity" isLabelHidden size="sheet" tone="filled" start={1} min={1} max={99} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'One fewer' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'One more' }).getBoundingClientRect().height).toBe(32);
  },
};

/** At the least: one fewer is off. */
export const AtTheLeast: Story = {
  render: () => (
    <Stage>
      <Counted label="Quantity" isLabelHidden start={1} min={1} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'One fewer' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'One more' })).toBeEnabled();
  },
};

/** At the most: one more turns off, and focus moves to one fewer when a key press reaches it. */
export const AtTheMost: Story = {
  render: () => (
    <Stage>
      <Counted label="Quantity" isLabelHidden start={2} max={3} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const more = canvas.getByRole('button', { name: 'One more' });
    await userEvent.tab();
    await userEvent.tab();
    await expect(more).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(more).toBeDisabled();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'One fewer' })).toHaveFocus());
  },
};

/** Disabled: neither button presses, and the count fades. */
export const Disabled: Story = {
  render: () => (
    <Stage>
      <Stepper label="Party size" value={2} onChange={() => undefined} isDisabled />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'One fewer' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'One more' })).toBeDisabled();
  },
};

/** The count and one more only: a count taken away elsewhere (a dish with choices on the guest menu). */
export const AddOnly: Story = {
  render: () => (
    <Stage>
      <Stepper label="How many Margherita" isLabelHidden value={2} isFewerHidden onChange={() => undefined} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'One fewer' })).toBeNull();
  },
};
