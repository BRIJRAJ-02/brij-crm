import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, waitFor } from 'storybook/test';
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

/** Compact, in a row with no room for nine: one swatch, named with its hue, opens the nine and closes on a choice. */
export const Compact: Story = {
  args: { label: 'Gold colour', defaultValue: 'yellow', isCompact: true },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <HuePicker {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Gold colour: Yellow' }));
    const sky = await screen.findByRole('radio', { name: 'Sky' });
    await userEvent.click(sky);
    await expect(args.onChange).toHaveBeenCalledWith('sky');
    await waitFor(() => expect(screen.queryByRole('radiogroup')).toBeNull());
  },
};

/** Compact and read only: the swatch names its hue, with nothing to open. */
export const CompactReadOnly: Story = {
  args: { label: 'Gold colour', defaultValue: 'yellow', isCompact: true, isReadOnly: true },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <HuePicker {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'Gold colour: Yellow' })).toBeInTheDocument();
    await expect(canvas.queryByRole('button')).toBeNull();
  },
};

/** Compact, open: the nine in a popover from the one swatch, the chosen one ticked (kept open for its picture). */
export const CompactOpen: Story = {
  args: { label: 'Gold colour', defaultValue: 'yellow', isCompact: true },
  render: (args) => (
    <Stage>
      <HuePicker {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Gold colour: Yellow' }));
    await expect(await screen.findByRole('radio', { name: 'Yellow' })).toBeChecked();
  },
};
