import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Switch } from './Switch.tsx';

const meta = {
  title: 'Atoms/Switch',
  component: Switch,
  args: { label: 'Email me about mentions', onChange: fn() },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Space turns it on and tells the caller. */
export const Default: Story = {
  play: async ({ canvas, args, userEvent }) => {
    const toggle = canvas.getByRole('switch', { name: 'Email me about mentions' });
    await userEvent.tab();
    await userEvent.keyboard(' ');
    await expect(toggle).toBeChecked();
    await expect(args.onChange).toHaveBeenCalledWith(true);
  },
};

/** Off, on, with a description, read only and disabled. */
export const States: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage direction="column">
      <Switch label="Off" />
      <Switch label="On" defaultSelected />
      <Switch label="Daily summary" description="Sent at 8:00 in your time zone." defaultSelected />
      <Switch label="Managed by your admin" defaultSelected isReadOnly />
      <Switch label="Disabled" isDisabled />
    </Stage>
  ),
};
