import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Code } from '../../atoms/Code/Code.tsx';
import { RelativeTime } from '../../atoms/RelativeTime/RelativeTime.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { DescriptionList } from './DescriptionList.tsx';

const meta = {
  title: 'Molecules/DescriptionList',
  component: DescriptionList,
  args: {
    items: [
      { term: 'Name', description: 'Zapier' },
      { term: 'Created', description: <RelativeTime value="2026-10-06T09:00:00.000Z" /> },
      { term: 'Scopes', description: <Code>records:read records:write</Code> },
      { term: 'Last used', description: 'Never' },
    ],
  },
} satisfies Meta<typeof DescriptionList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Terms beside their values. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="narrow">
      <DescriptionList {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('term')).toHaveLength(4);
  },
};

/** Terms above their values. */
export const Stacked: Story = {
  args: { layout: 'stacked' },
  render: (args) => (
    <Stage width="narrow">
      <DescriptionList {...args} />
    </Stage>
  ),
};
