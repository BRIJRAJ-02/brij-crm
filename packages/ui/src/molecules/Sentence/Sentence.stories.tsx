import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Field } from '../Field/Field.tsx';
import { Select } from '../Select/SelectWithFaces.tsx';
import { Sentence } from './Sentence.tsx';

const objects = [
  { id: 'deal', label: 'Deal' },
  { id: 'person', label: 'Person' },
];
const events = [
  { id: 'created', label: 'is created' },
  { id: 'stage', label: 'Stage changes' },
];

const meta = {
  title: 'Molecules/Sentence',
  component: Sentence,
  args: { lead: 'When', children: null },
} satisfies Meta<typeof Sentence>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A trigger and an action read as two lines of one rule. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage width="fill">
      <Sentence lead="When">
        <Select label="Object" variant="inline" items={objects} value="deal" />
        <Select label="Event" variant="inline" items={events} value="stage" />
        to
        <Select label="Value" variant="inline" items={[{ id: 'won', label: 'Won' }]} value="won" />
      </Sentence>
      <Sentence lead="Then" end={<Button variant="ghost" icon="x" label="Remove action 1" onPress={fn()} />}>
        create a task
        <Field label="Title" isLabelHidden size="sm" defaultValue="Send contract" />
        due in
        <Field label="Days" isLabelHidden size="sm" defaultValue="3" />
        days
      </Sentence>
    </Stage>
  ),
};

/** In a narrow container the lead word sits above its line. */
export const Narrow: Story = {
  render: () => (
    <Stage width="narrow">
      <Sentence lead="Only if">
        <Select label="Field" variant="inline" items={events} value="stage" />
      </Sentence>
    </Stage>
  ),
};
