import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Tag } from '../../atoms/Tag/Tag.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FilterChip } from './FilterChip.tsx';

const meta = {
  title: 'Molecules/FilterChip',
  component: FilterChip,
  args: {
    attribute: ['Stage'],
    icon: 'tag',
    operator: 'is',
    value: <Tag hue="green">Won</Tag>,
    onPressValue: fn(),
    onRemove: fn(),
  },
} satisfies Meta<typeof FilterChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Each part is a button: Tab reaches the value, Enter opens it; remove removes. */
export const Default: Story = {
  render: (args) => (
    <Stage>
      <FilterChip {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    await expect(args.onPressValue).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('button', { name: 'Remove filter' }));
    await expect(args.onRemove).toHaveBeenCalled();
  },
};

/** Through a relation, and one with no value yet. */
export const Kinds: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <FilterChip icon="tag" attribute={['Stage']} operator="is" value={<Tag hue="green">Won</Tag>} />
      <FilterChip
        icon="map-pin"
        attribute={['Company', 'Country']}
        operator="is any of"
        value="United Kingdom, Ireland"
      />
      <FilterChip icon="calendar" attribute={['Created']} operator="within the last" />
    </Stage>
  ),
};

/** No value part: a condition that takes none ("is empty"), and a group with no operator either. */
export const WithoutValue: Story = {
  render: () => (
    <Stage>
      <FilterChip icon="calendar" attribute={['Close date']} operator="is empty" hasValue={false} />
      <FilterChip icon="list-filter" attribute={['2 conditions']} hasValue={false} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByText('Choose a value')).not.toBeInTheDocument();
    await expect(canvas.getByRole('group', { name: 'Filter: 2 conditions' })).toBeInTheDocument();
  },
};

/** Read only: no remove part, for a view you can't edit. */
export const ReadOnly: Story = {
  args: { onRemove: undefined },
  render: (args) => (
    <Stage>
      <FilterChip {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Remove filter' })).toBeNull();
  },
};
