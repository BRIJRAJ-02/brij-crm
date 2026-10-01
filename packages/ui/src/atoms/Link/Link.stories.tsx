import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Link } from './Link.tsx';

const meta = {
  title: 'Atoms/Link',
  component: Link,
  args: { href: '/settings/members', children: 'Invite your team' },
} satisfies Meta<typeof Link>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A path in the app, routed. */
export const Default: Story = {
  play: async ({ canvas, userEvent }) => {
    const link = canvas.getByRole('link', { name: 'Invite your team' });
    await expect(link).toHaveAttribute('href', '/settings/members');
    await expect(link).not.toHaveAttribute('target');
    await userEvent.tab();
    await expect(link).toHaveFocus();
  },
};

/** A link out opens in a new tab. */
export const External: Story = {
  args: { href: 'https://docs.example.com/import', children: 'Read the import guide' },
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: 'Read the import guide' });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  },
};

/** A `javascript:` URL is refused and renders as text (AC-14). */
export const Refused: Story = {
  args: { href: 'javascript:alert(1)', children: 'Click me' },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('link')).toBeNull();
    await expect(canvas.getByText('Click me')).toBeInTheDocument();
  },
};

/** In a sentence. */
export const InText: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <span>
        No members yet. <Link href="/settings/members">Invite your team</Link> to share this workspace.
      </span>
    </Stage>
  ),
};
