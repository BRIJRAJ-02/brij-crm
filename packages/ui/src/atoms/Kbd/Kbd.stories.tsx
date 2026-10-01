import type { Meta, StoryObj } from '@storybook/react-vite';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Kbd } from './Kbd.tsx';

const meta = {
  title: 'Atoms/Kbd',
  component: Kbd,
  args: { children: '⌘K' },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A raised keycap on its own, beside the control it triggers. */
export const Default: Story = {};

/** Raised on its own, soft inside buttons and menu items. The third tone, `onAccent`, sits inside a primary button: see Button's With Shortcut story. */
export const Tones: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <Kbd>⌘K</Kbd>
      <Kbd>/</Kbd>
      <Kbd tone="soft">ESC</Kbd>
      <Kbd tone="soft">⌘↵</Kbd>
      <Kbd>↑</Kbd>
      <Kbd>↓</Kbd>
    </Stage>
  ),
};
