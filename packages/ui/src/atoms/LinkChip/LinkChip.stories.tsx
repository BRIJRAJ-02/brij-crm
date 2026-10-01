import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { LinkChip } from './LinkChip.tsx';

const meta = {
  title: 'Atoms/LinkChip',
  component: LinkChip,
  args: { href: 'mailto:ada@example.com', children: 'ada@example.com' },
} satisfies Meta<typeof LinkChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An email address. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'ada@example.com' })).toHaveAttribute(
      'href',
      'mailto:ada@example.com',
    );
  },
};

/** Each type it shows: email, phone, domain and URL. */
export const Types: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <LinkChip href="mailto:ada@example.com">ada@example.com</LinkChip>
      <LinkChip href="tel:+447700900123">+44 7700 900123</LinkChip>
      <LinkChip href="https://example.com">example.com</LinkChip>
      <LinkChip href="https://example.com/pricing">https://example.com/pricing</LinkChip>
    </Stage>
  ),
};

/** A refused link is a plain chip (AC-14). */
export const Refused: Story = {
  args: { href: 'javascript:alert(1)', children: 'javascript:alert(1)' },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('link')).toBeNull();
  },
};

/** A long URL is cut inside a narrow slot. */
export const Long: Story = {
  render: () => (
    <Stage width="narrow">
      <LinkChip href="https://example.com/a/very/long/path/to/the/pricing/page?ref=newsletter">
        https://example.com/a/very/long/path/to/the/pricing/page?ref=newsletter
      </LinkChip>
    </Stage>
  ),
};
