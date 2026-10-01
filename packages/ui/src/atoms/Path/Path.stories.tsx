import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Path } from './Path.tsx';

const meta = {
  title: 'Atoms/Path',
  component: Path,
  args: { parts: ['Company', 'Country'] },
} satisfies Meta<typeof Path>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Through one relation. Screen readers hear "Company, then Country". */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage direction="column">
      <Path parts={['Stage']} />
      <Path {...args} />
      <Path parts={['Deal', 'Company', 'Owner', 'Email']} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent).toContain('Company, then Country');
  },
};
