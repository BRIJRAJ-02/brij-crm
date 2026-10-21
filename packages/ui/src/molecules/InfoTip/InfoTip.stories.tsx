import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { InfoTip } from './InfoTip.tsx';

const meta = {
  title: 'Molecules/InfoTip',
  component: InfoTip,
  args: {
    label: 'Minimum notice',
    children: 'How far ahead someone has to book. Slots closer than this are hidden.',
  },
} satisfies Meta<typeof InfoTip>;

export default meta;
type Story = StoryObj<typeof meta>;

function openDialog() {
  return waitFor(() => {
    const found = document.querySelector('[role="dialog"]');
    if (found === null) throw new Error('the help did not open');
    return found;
  });
}

/** Closed: a quiet info button named after what it explains. */
export const Default: Story = {
  render: (args) => (
    <Stage>
      <InfoTip {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'About Minimum notice' })).toBeVisible();
  },
};

/** Open, with an example under the help. A press opens it, so touch works as well as a mouse. */
export const WithExample: Story = {
  args: { example: 'With 4 hours, a 2:00 PM slot can’t be booked after 10:00 AM that day.' },
  render: (args) => (
    <Stage>
      <InfoTip {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'About Minimum notice' }));
    const dialog = await openDialog();
    await expect(dialog).toHaveAccessibleName('About Minimum notice');
    await expect(dialog).toHaveTextContent('Example With 4 hours');
  },
};

/** Beside a label, as it sits in a form or a settings row: the label stays the field's name. */
export const BesideALabel: Story = {
  render: (args) => (
    <Stage>
      <span>Minimum notice</span>
      <InfoTip {...args} />
    </Stage>
  ),
};

/** By keyboard: Enter opens it, focus moves into the help, and Esc closes it with focus back on the button. */
export const Keyboard: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <InfoTip {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole('button', { name: 'About Minimum notice' });
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const dialog = await openDialog();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await expect(button).toHaveFocus();
  },
};
