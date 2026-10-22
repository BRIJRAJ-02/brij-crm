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

/** Compact: a week's hours, the days in one narrow column so the times line up, rows close together. */
export const Compact: Story = {
  args: {
    layout: 'compact',
    items: [
      { term: 'Mon to Wed', description: '9:00 AM to 5:00 PM' },
      { term: 'Thu', description: '9:00 AM to 1:00 PM' },
      { term: 'Fri', description: '9:00 AM to 5:00 PM' },
      { term: 'Sat, Sun', description: 'Unavailable' },
    ],
  },
  render: (args) => (
    <Stage width="narrow">
      <DescriptionList {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Thu')).toBeInTheDocument();
  },
};

/** A value with `copy`: its copy button after it, shown on hover or focus (always under a finger), copying the raw value. */
export const Copy: Story = {
  render: () => (
    <Stage>
      <DescriptionList
        layout="stacked"
        items={[
          {
            term: 'Work email',
            description: 'grace@navy.mil',
            copy: { value: 'grace@navy.mil', label: 'Copy Work email' },
          },
          { term: 'Phone', description: '+91 77109 86909', copy: { value: '+917710986909', label: 'Copy Phone' } },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole('button', { name: 'Copy Phone' });
    await userEvent.tab();
    await userEvent.tab();
    await expect(button).toHaveFocus();
  },
};
