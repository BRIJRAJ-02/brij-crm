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

/**
 * Flat (`isFlat`, a card or a line of the timeline): the link's text alone on the chip's line, a refused one
 * plain text; keyboard focus still draws its ring.
 */
export const Flat: Story = {
  render: () => (
    <Stage>
      <LinkChip href="tel:+917710986909" isFlat>
        +91 77109 86909
      </LinkChip>
      <LinkChip href="mailto:ada@example.com" isFlat>
        ada@example.com
      </LinkChip>
      <LinkChip href="javascript:alert(1)" isFlat>
        javascript:alert(1)
      </LinkChip>
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('link', { name: '+91 77109 86909' })).toHaveFocus();
    await expect(canvas.getAllByRole('link')).toHaveLength(2);
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

/** With a brand's mark: a social profile, the network's mark and then the handle; the link is named for both. */
export const WithMark: Story = {
  render: () => (
    <Stage>
      <LinkChip href="https://linkedin.com/in/ada-lovelace" mark="linkedin">
        ada-lovelace
      </LinkChip>
      <LinkChip href="https://x.com/adalovelace" mark="x">
        @adalovelace
      </LinkChip>
      <LinkChip href="https://github.com/octocat" mark="github" isFlat>
        octocat
      </LinkChip>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const linkedin = canvas.getByRole('link', { name: 'LinkedIn ada-lovelace' });
    await expect(linkedin).toHaveAttribute('target', '_blank');
    await expect(canvas.getByRole('link', { name: 'X @adalovelace' })).toBeInTheDocument();
  },
};
