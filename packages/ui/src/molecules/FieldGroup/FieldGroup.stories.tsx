import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
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

/** A schedule's week, read only: its zone after the label, a quiet Edit at the row's end, the week compact. */
export const Default: Story = {
  render: (args) => (
    <Stage>
      <FieldGroup
        {...args}
        action={
          <Button variant="ghost" size="sm" icon="pencil">
            Edit
          </Button>
        }
        meta="Kolkata time (GMT+5:30)"
      >
        <DescriptionList
          layout="compact"
          items={[
            { term: 'Mon to Fri', description: '9:00 AM to 5:00 PM' },
            { term: 'Sat, Sun', description: 'Unavailable' },
          ]}
        />
      </FieldGroup>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Weekly hours' })).toHaveTextContent('Kolkata time (GMT+5:30)');
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
          <Button variant="ghost" size="sm" icon="settings">
            Manage
          </Button>
        }
      >
        <Badge size="chip" text="ada@acme.dev" dot="blue" />
        <Badge size="chip" text="Team offsites" dot="green" />
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

/** Loading: a Skeleton in the content's place, the label already there, so nothing moves when it lands. */
export const Loading: Story = {
  render: (args) => (
    <Stage>
      <FieldGroup {...args}>
        <Skeleton lines={2} />
      </FieldGroup>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Weekly hours' })).toBeInTheDocument();
  },
};

/** A long row wraps: many calendars, then the action that fixes it at the label row's end. */
export const LongRow: Story = {
  args: { label: 'Checks for conflicts in' },
  render: (args) => (
    <Stage>
      <FieldGroup {...args} layout="row">
        {['ada@acme.dev', 'Team offsites', 'Holidays in India', 'Birthdays', 'Support rota', 'Board meetings'].map(
          (name) => (
            <Badge key={name} size="chip" text={name} dot="purple" />
          ),
        )}
      </FieldGroup>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Board meetings')).toBeInTheDocument();
  },
};

/** `tone="heading"` with `headingLevel`: a section's heading over labelled values, medium beside the terms under it. */
export const Strong: Story = {
  args: { label: 'Answers', tone: 'heading', headingLevel: 3 },
  render: (args) => (
    <Stage>
      <FieldGroup {...args}>
        <DescriptionList
          layout="stacked"
          items={[
            { term: 'Your name', description: 'Grace Hopper' },
            { term: 'Work email', description: 'grace@navy.mil' },
          ]}
        />
      </FieldGroup>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Answers' })).toHaveTextContent('Grace Hopper');
    await expect(canvas.getByRole('heading', { level: 3, name: 'Answers' })).toBeInTheDocument();
  },
};

/** `isLive`: a polite live region, its hint said while the content is on its way. */
export const Live: Story = {
  args: { label: 'Records', tone: 'heading', headingLevel: 3, isLive: true, hint: 'Adding it to the CRM now.' },
  render: (args) => (
    <Stage>
      <FieldGroup {...args}>{null}</FieldGroup>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Records' })).toHaveAttribute('aria-live', 'polite');
  },
};

/** `error`: what is wrong with the content, in the danger colour under it, and part of the group's description. */
export const WithError: Story = {
  args: { label: 'Your CV', error: 'Add this.' },
  render: (args) => (
    <Stage>
      <FieldGroup {...args}>
        <Button variant="secondary" size="sm">
          Choose a file
        </Button>
      </FieldGroup>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('Add this.');
  },
};
