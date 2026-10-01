import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Breadcrumbs } from './Breadcrumbs.tsx';

const meta = {
  title: 'Molecules/Breadcrumbs',
  component: Breadcrumbs,
  args: {
    items: [
      { id: 'settings', label: 'Settings', href: '/settings', icon: 'settings' },
      { id: 'objects', label: 'Objects', href: '/settings/objects' },
      { id: 'companies', label: 'Companies' },
    ],
  },
} satisfies Meta<typeof Breadcrumbs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two links, then the current page. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <Breadcrumbs {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Objects' })).toHaveAttribute('href', '/settings/objects');
    await expect(canvas.getByText('Companies').closest('[aria-current]')).toHaveAttribute('aria-current', 'page');
  },
};
