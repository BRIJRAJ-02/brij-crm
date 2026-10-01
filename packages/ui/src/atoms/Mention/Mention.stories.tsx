import type { Meta, StoryObj } from '@storybook/react-vite';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Mention } from './Mention.tsx';

const meta = {
  title: 'Atoms/Mention',
  component: Mention,
  args: { children: '@Ada Lovelace' },
} satisfies Meta<typeof Mention>;

export default meta;
type Story = StoryObj<typeof meta>;

/** In a comment. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <span>
        <Mention {...args} /> can you check the renewal terms before Friday?
      </span>
    </Stage>
  ),
};
