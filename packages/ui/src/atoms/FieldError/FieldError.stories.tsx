import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FieldError } from './FieldError.tsx';

const meta = {
  title: 'Atoms/FieldError',
  component: FieldError,
  args: { children: 'Pick one of the choices.', kind: 'standalone' },
  render: (args) => (
    <Stage>
      <FieldError {...args} />
    </Stage>
  ),
} satisfies Meta<typeof FieldError>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The mark and the message on one line, in the danger colour. */
export const Default: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    const line = canvas.getByText('Pick one of the choices.');
    await expect(line.querySelector('svg')).not.toBeNull();
  },
};

/** Under a checkbox's words, past its box. */
export const UnderACheckbox: Story = {
  parameters: { crm: { screenshot: false } },
  args: { inset: 'check', children: 'Tick this to go on.' },
};
