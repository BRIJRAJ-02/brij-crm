import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { DescriptionList } from '../DescriptionList/DescriptionList.tsx';
import { FieldGroup } from './FieldGroup.tsx';

const meta = {
  title: 'Molecules/FieldGroup',
  component: FieldGroup,
  args: { label: 'Weekly hours', children: null },
} satisfies Meta<typeof FieldGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A schedule's week, read only, with a quiet Edit at the label row's end and the zone as its hint. */
export const Default: Story = {
  render: (args) => (
    <Stage>
      <FieldGroup
        {...args}
        action={
          <Button variant="ghost" size="sm">
            Edit
          </Button>
        }
        hint="Kolkata time (GMT+5:30)"
      >
        <DescriptionList
          items={[
            { term: 'Mon to Fri', description: '9:00 AM to 5:00 PM' },
            { term: 'Sat, Sun', description: 'Unavailable' },
          ]}
        />
      </FieldGroup>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Weekly hours' })).toHaveAccessibleDescription(
      'Kolkata time (GMT+5:30)',
    );
    await expect(canvas.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  },
};

/** `layout="row"`: the calendars checked for conflicts, as Badges with their colour, then Manage. */
export const Row: Story = {
  args: { label: 'Checks for conflicts in' },
  render: (args) => (
    <Stage>
      <FieldGroup
        {...args}
        layout="row"
        action={
          <Button variant="ghost" size="sm">
            Manage
          </Button>
        }
      >
        <Badge text="ada@acme.dev" dot="blue" />
        <Badge text="Team offsites" dot="green" />
      </FieldGroup>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Checks for conflicts in' })).toHaveTextContent('Team offsites');
  },
};

/** Empty: a line saying so, and the way to fix it. */
export const Empty: Story = {
  args: { label: 'Checks for conflicts in' },
  render: (args) => (
    <Stage>
      <FieldGroup {...args} layout="row" hint="No calendars connected">
        <Button size="sm" icon="plus">
          Connect calendar
        </Button>
      </FieldGroup>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No calendars connected')).toBeInTheDocument();
  },
};
