import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Code } from './Code.tsx';

const meta = {
  title: 'Atoms/Code',
  component: Code,
  args: { children: 'person.email_addresses' },
} satisfies Meta<typeof Code>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Inline, in a sentence. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <span>
        Filter on <Code {...args} /> to find people by address.
      </span>
    </Stage>
  ),
};

/** With a copy button. Where the browser refuses the clipboard, it says so and selects the text. */
export const Copyable: Story = {
  args: { children: 'https://hooks.example.com/w/8c1f2', isCopyable: true, copyLabel: 'Copy the webhook URL' },
  render: (args) => (
    <Stage>
      <Code {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Copy the webhook URL' }));
    // Headless browsers may or may not grant the clipboard; either way a toast reports it.
    await waitFor(() =>
      expect(document.querySelector('[role="alertdialog"], [role="alert"], [role="status"]')).not.toBeNull(),
    );
  },
};
