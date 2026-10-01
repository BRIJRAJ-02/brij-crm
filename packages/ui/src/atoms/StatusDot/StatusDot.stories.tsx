import type { Meta, StoryObj } from '@storybook/react-vite';
import { HUES } from '../../hue.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { StatusDot } from './StatusDot.tsx';

const meta = {
  title: 'Atoms/StatusDot',
  component: StatusDot,
  args: { children: 'Active', hue: 'green' },
} satisfies Meta<typeof StatusDot>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One status. */
export const Default: Story = {};

/** A dot for each hue, each with its label. */
export const Hues: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      {HUES.map((hue) => (
        <StatusDot key={hue} hue={hue}>
          {hue.charAt(0).toUpperCase() + hue.slice(1)}
        </StatusDot>
      ))}
    </Stage>
  ),
};

/** An archived status on an old value. */
export const Archived: Story = {
  args: { children: 'Paused', hue: 'orange', isArchived: true },
};
