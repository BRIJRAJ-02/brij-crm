import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Card } from '../../molecules/Card/Card.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { PageColumn } from './PageColumn.tsx';

const meta = {
  title: 'Modules/PageColumn',
  component: PageColumn,
  args: { children: null },
} satisfies Meta<typeof PageColumn>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two cards in a readable column. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <PageColumn {...args}>
        <Card title="Weekly hours">Monday to Friday, 09:00 to 17:00.</Card>
        <Card title="Days off">None coming up.</Card>
      </PageColumn>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Weekly hours')).toBeInTheDocument();
  },
};
