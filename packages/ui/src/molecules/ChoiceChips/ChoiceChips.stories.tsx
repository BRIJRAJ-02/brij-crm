import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { ChoiceChips } from './ChoiceChips.tsx';

function lengths() {
  return [15, 30, 45, 60, 90].map((minutes) => ({ id: String(minutes), label: `${String(minutes)} min` }));
}

const meta = {
  title: 'Molecules/ChoiceChips',
  component: ChoiceChips,
  args: { label: 'Duration', choices: [], selected: [], onChange: fn() },
} satisfies Meta<typeof ChoiceChips>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Several lengths may be chosen. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => {
    function Chips() {
      const [selected, setSelected] = useState<readonly string[]>(['30']);
      return (
        <ChoiceChips
          {...args}
          choices={lengths()}
          selected={selected}
          onChange={(next) => {
            args.onChange(next);
            setSelected(next);
          }}
        />
      );
    }
    return (
      <Stage>
        <Chips />
      </Stage>
    );
  },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: '60 min' }));
    await expect(args.onChange).toHaveBeenCalledWith(['30', '60']);
    await expect(canvas.getByRole('button', { name: '60 min' })).toHaveAttribute('aria-pressed', 'true');
  },
};

/** None chosen: the error under the group. */
export const WithError: Story = {
  args: { error: 'Pick at least one length.' },
  render: (args) => (
    <Stage>
      <ChoiceChips {...args} choices={lengths()} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Pick at least one length.')).toBeInTheDocument();
  },
};
