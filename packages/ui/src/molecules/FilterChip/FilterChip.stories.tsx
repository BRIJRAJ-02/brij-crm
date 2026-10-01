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
