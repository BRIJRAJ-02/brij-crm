import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SampleTable } from './SampleTable.tsx';

const meta = {
  title: 'Molecules/SampleTable',
  component: SampleTable,
  args: {
    label: 'The first row holds the column names',
    rows: [
      ['Name', 'Email', 'Company'],
      ['Ada Lovelace', 'ada@example.com', 'Analytical Engines'],
      ['Grace Hopper', 'grace@example.com', 'Navy'],
    ],
    caption: 'Row 1: column names',
  },
} satisfies Meta<typeof SampleTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A CSV's shape: the header row tinted over two sample rows. One image to a screen reader, never in the tab order. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="narrow">
      <SampleTable {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'The first row holds the column names' })).toBeInTheDocument();
    await expect(canvas.getByText('Row 1: column names')).toBeInTheDocument();
    await expect(canvas.queryByRole('table')).toBeNull();
  },
};

/** No caption: the picture alone. */
export const WithoutCaption: Story = {
  parameters: { crm: { screenshot: false } },
  render: ({ label, rows }) => (
    <Stage width="narrow">
      <SampleTable label={label} rows={rows} />
    </Stage>
  ),
};
