import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { AccentPicker, type AccentPickerProps, type AccentQuickPick } from './AccentPicker.tsx';

/** The nine quick picks, the dot colours of the library's hues, as the data layer hands them in. */
const PICKS: readonly AccentQuickPick[] = [
  { hue: 'gray', value: '#cad0d9' },
  { hue: 'red', value: '#ff5b59' },
  { hue: 'orange', value: '#fb8f3c' },
  { hue: 'yellow', value: '#f5b900' },
  { hue: 'lime', value: '#b3cf2f' },
  { hue: 'green', value: '#0fc27b' },
  { hue: 'sky', value: '#3fb3e8' },
  { hue: 'blue', value: '#266df0' },
  { hue: 'purple', value: '#9d6ef5' },
];

/** The picker with its value held, as a screen holds it. */
function Held(args: AccentPickerProps) {
  const [value, setValue] = useState(args.value);
  return (
    <AccentPicker
      {...args}
      {...(value === undefined ? {} : { value })}
      onChange={(next) => {
        setValue(next);
        args.onChange(next);
      }}
    />
  );
}

const meta = {
  title: 'Molecules/AccentPicker',
  component: AccentPicker,
  args: { label: 'Colour', defaultName: 'Timefix', quickPicks: PICKS, onChange: fn() },
  render: (args) => (
    <Stage>
      <Held {...args} />
    </Stage>
  ),
} satisfies Meta<typeof AccentPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing picked: the default is ticked, and the page wears the product's own accent. */
export const Default: Story = {
  parameters: { crm: { preview: true, screenshot: false } },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('radio', { name: 'Timefix' })).toBeChecked();
    await userEvent.click(canvas.getByRole('radio', { name: 'Orange' }));
    await expect(args.onChange).toHaveBeenCalledWith('#fb8f3c');
  },
};

/** A brand's exact colour typed as a hex: Any colour wears it, and Enter keeps it. */
export const TypedHex: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, args }) => {
    const hex = canvas.getByRole('textbox', { name: 'Hex' });
    await userEvent.type(hex, '7c3aed{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('#7c3aed');
    await expect(canvas.getByRole('button', { name: 'Any colour' })).toHaveAttribute('data-selected', 'true');
  },
};

/** Something that isn't a colour is refused with one line, never repeating what was typed. */
export const RefusedHex: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, args }) => {
    await userEvent.type(canvas.getByRole('textbox', { name: 'Hex' }), 'red{Enter}');
    await expect(canvas.getByText('Use a colour like #1f5fd6.')).toBeInTheDocument();
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

/** The guard moved a pale yellow: the two colours the page draws, and one line (spec 0060, AC-6). */
export const Adjusted: Story = {
  parameters: { crm: { screenshot: false } },
  args: { value: '#ffd400', drawn: { light: '#7a6700', dark: '#ffd400' } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Adjusted so text stays readable.');
  },
};

/** The workspace's colour as the default a link page follows. */
export const FollowsWorkspace: Story = {
  parameters: { crm: { screenshot: false } },
  args: { defaultName: 'Workspace', defaultValue: '#e8590c' },
};

/** A member who may not change the kit sees it, with no way to change it. */
export const ReadOnly: Story = {
  parameters: { crm: { screenshot: false } },
  args: { value: '#0fc27b', isReadOnly: true },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Any colour' })).toBeNull();
  },
};

/** Disabled while something it depends on loads. */
export const Disabled: Story = {
  parameters: { crm: { screenshot: false } },
  args: { isDisabled: true },
};
