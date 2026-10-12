import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { HuePicker } from './HuePicker.tsx';

const meta = {
  title: 'Molecules/HuePicker',
  component: HuePicker,
  args: { label: 'Option colour', defaultValue: 'green', onChange: fn() },
} satisfies Meta<typeof HuePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The arrow keys move the choice and tell the caller. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <HuePicker {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('radio', { name: 'Green' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(args.onChange).toHaveBeenCalledWith('sky');
  },
};

/** In a form beside labelled Fields: the label shows above the swatches, as a field's does. */
export const LabelShown: Story = {
  args: { label: 'Colour', isLabelShown: true },
  render: (args) => (
    <Stage>
      <HuePicker {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Colour')).toBeVisible();
    await expect(canvas.getByRole('radiogroup', { name: 'Colour' })).toBeInTheDocument();
  },
};
