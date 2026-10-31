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

/**
 * The word beside it is the state (the link page's Live or Private): it reads "Private" while off and "Live" once on,
 * and the accessible name stays "Live" in both, so a screen reader hears on or off, never a double negative.
 */
export const StateLabels: Story = {
  args: { label: 'Live', stateLabels: { on: 'Live', off: 'Private' } },
  play: async ({ canvas, userEvent }) => {
    const toggle = canvas.getByRole('switch', { name: 'Live' });
    await expect(canvas.getByText('Private')).toBeVisible();
    await userEvent.click(toggle);
    await expect(toggle).toBeChecked();
    await expect(canvas.getByText('Live', { selector: '[aria-hidden="true"]' })).toBeVisible();
  },
};

/**
 * With its label hidden (a link card's switch), the switch is only its 28px track, so an invisible hit area
 * grows it to at least 32 by 32: a press just beside it still toggles it.
 */
export const HiddenLabelHitArea: Story = {
  args: { label: 'Intro call is on', isLabelHidden: true },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, args, userEvent }) => {
    const control = canvas.getByRole('switch', { name: 'Intro call is on' }).closest('label');
    if (control === null) throw new Error('the switch has no label element');
    const box = control.getBoundingClientRect();
    const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    // The hit area reaches 16px either side of the middle across, and 16px up and down.
    for (const [x, y] of [
      [middle.x - 15.5, middle.y],
      [middle.x + 15.5, middle.y],
      [middle.x, middle.y - 15.5],
      [middle.x, middle.y + 15.5],
    ] as const) {
      await expect(control.contains(document.elementFromPoint(x, y))).toBe(true);
    }
    // A press 15px above the middle, outside the track, still toggles it.
    await userEvent.pointer({
      keys: '[MouseLeft]',
      target: control,
      coords: { clientX: middle.x, clientY: middle.y - 15 },
    });
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
