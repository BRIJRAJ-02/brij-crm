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

const SNIPPET = `<script src="https://crm.example.com/embed.js" async></script>
<div data-crm-form="contact-us" data-crm-title="Fill this in and we will come back to you"></div>`;

const LONG = Array.from(
  { length: 14 },
  (_, index) => `  <label>Question ${String(index + 1)} <input name="q${String(index + 1)}"></label>`,
).join('\n');

/** A snippet to paste: its own box, lines kept, Copy inside its top end. */
export const Block: Story = {
  args: { children: SNIPPET, variant: 'block' },
  render: (args) => (
    <Stage width="fill">
      <Code {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  },
};

/** A long snippet held to eight lines under a fade; Show all opens it. */
export const BlockClamped: Story = {
  args: {
    children: `<form action="https://crm.example.com/f/contact-us" method="post">\n${LONG}\n</form>`,
    variant: 'block',
    isClamped: true,
  },
  render: (args) => (
    <Stage width="fill">
      <Code {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const toggle = canvas.getByRole('button', { name: 'Show all' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    await expect(canvas.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  },
};
