import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Variable } from './Variable.tsx';

const meta = {
  title: 'Atoms/Variable',
  component: Variable,
  args: { path: ['First name'] },
} satisfies Meta<typeof Variable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** In a sentence, with one the record can't fill. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <span>
        Hi <Variable path={['First name']} />, congratulations on the launch at <Variable path={['Company', 'Name']} />{' '}
        in <Variable path={['Company', 'Country']} isMissing />.
      </span>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('(no value for this record)')).toBeInTheDocument();
  },
};
