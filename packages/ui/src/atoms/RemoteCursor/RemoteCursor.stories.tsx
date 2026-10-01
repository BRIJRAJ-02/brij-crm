import type { Meta, StoryObj } from '@storybook/react-vite';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { RemoteCursor } from './RemoteCursor.tsx';

const meta = {
  title: 'Atoms/RemoteCursor',
  component: RemoteCursor,
  args: { name: 'Maya', hue: 'purple' },
} satisfies Meta<typeof RemoteCursor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two collaborators in one line of a note. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <span>
        Kickoff moved to Thursday
        <RemoteCursor name="Maya" hue="purple" />. Jonas will send the agenda
        <RemoteCursor name="Jonas" hue="lime" /> before then.
      </span>
    </Stage>
  ),
};
