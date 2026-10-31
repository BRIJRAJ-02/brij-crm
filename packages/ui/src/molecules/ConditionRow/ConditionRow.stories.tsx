import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Field } from '../Field/Field.tsx';
import { Select } from '../Select/SelectWithFaces.tsx';
import { ConditionRow } from './ConditionRow.tsx';

const questions = [
  { id: 'budget', label: 'Budget' },
  { id: 'size', label: 'Team size' },
  { id: 'country', label: 'Country' },
];
const operators = [
  { id: 'is', label: 'is' },
  { id: 'is_any_of', label: 'is any of' },
  { id: 'more_than', label: 'is more than' },
];
const countries = [
  { id: 'de', label: 'Germany' },
  { id: 'fr', label: 'France' },
  { id: 'nl', label: 'Netherlands' },
];

const meta = {
  title: 'Molecules/ConditionRow',
  component: ConditionRow,
  args: { lead: 'When', removeLabel: 'Remove condition 1', children: null, onRemove: fn() },
} satisfies Meta<typeof ConditionRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two conditions joined by "and": the second can be removed. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="fill">
      <ConditionRow lead="When" removeLabel="Remove condition 1">
        <Select label="Question" isLabelHidden items={questions} value="budget" />
        <Select label="Comparison" isLabelHidden items={operators} value="is" />
        <Select label="Value" isLabelHidden items={[{ id: 'Large', label: 'Large' }]} value="Large" />
      </ConditionRow>
      <ConditionRow {...args} lead="and" removeLabel="Remove condition 2">
        <Select label="Question" isLabelHidden items={questions} value="size" />
        <Select label="Comparison" isLabelHidden items={operators} value="more_than" />
        <Field label="Value" isLabelHidden defaultValue="50" />
      </ConditionRow>
    </Stage>
  ),
  play: async ({ args, canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Remove condition 1' })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Remove condition 2' }));
    await expect(args.onRemove).toHaveBeenCalledOnce();
  },
};

/** Disabled: the remove button can't be pressed. */
export const Disabled: Story = {
  render: (args) => (
    <Stage width="fill">
      <ConditionRow {...args} isDisabled>
        <Select label="Question" isLabelHidden items={questions} value="budget" isDisabled />
        <Select label="Comparison" isLabelHidden items={operators} value="is" isDisabled />
        <Field label="Value" isLabelHidden defaultValue="Large" isDisabled />
      </ConditionRow>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Remove condition 1' })).toBeDisabled();
  },
};

/** Narrow: the controls stack under the lead word. */
export const Narrow: Story = {
  render: (args) => (
    <Stage width="narrow">
      <ConditionRow {...args}>
        <Select label="Question" isLabelHidden items={questions} value="budget" />
        <Select label="Comparison" isLabelHidden items={operators} value="is" />
        <Field label="Value" isLabelHidden defaultValue="Large" />
      </ConditionRow>
    </Stage>
  ),
};

/** "is any of": the value is a Select of several (`selectionMode="multiple"`), named in one line like the others. */
export const AnyOf: Story = {
  render: (args) => (
    <Stage width="fill">
      <ConditionRow {...args}>
        <Select label="Question" isLabelHidden items={questions} value="country" />
        <Select label="Comparison" isLabelHidden items={operators} value="is_any_of" />
        <Select label="Values" isLabelHidden selectionMode="multiple" items={countries} values={['de', 'fr']} />
      </ConditionRow>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /Values/ })).toHaveTextContent('Germany, France');
  },
};
