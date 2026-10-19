import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Radio, RadioGroup } from '../../atoms/Radio/Radio.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SpanCard } from './SpanCard.tsx';

const meta = {
  title: 'Modules/SpanCard',
  component: SpanCard,
  args: { title: '10:00 – 10:30 AM', meta: 'Tuesday 20 October · 30 min' },
} satisfies Meta<typeof SpanCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** What a drawn span can become. */
export const Choices: Story = {
  parameters: { crm: { preview: true } },
  args: {
    choices: [
      { id: 'book', label: 'Book someone in', icon: 'user-plus', onPress: fn() },
      { id: 'block', label: 'Block this time', icon: 'circle-slash', onPress: fn() },
      { id: 'hold', label: 'Hold for a private meeting type', icon: 'bookmark', onPress: fn() },
    ],
  },
  render: (args) => (
    <Stage>
      <SpanCard {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Block this time' }));
    await expect(args.choices?.[1]?.onPress).toHaveBeenCalled();
  },
};

/** One choice's form, with Back to the choices. */
export const Form: Story = {
  args: { onBack: fn() },
  render: (args) => (
    <Stage>
      <SpanCard {...args}>
        <RadioGroup label="How often" defaultValue="once">
          <Radio value="once">Just this Tuesday</Radio>
          <Radio value="weekly">Every Tuesday</Radio>
        </RadioGroup>
        <Field label="Why" hint="Only you see this." />
        <Button variant="primary">Block it</Button>
      </SpanCard>
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }));
    await expect(args.onBack).toHaveBeenCalled();
  },
};
