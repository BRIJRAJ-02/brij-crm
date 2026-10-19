import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Radio, RadioGroup } from '../../atoms/Radio/Radio.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
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

/** Saving: the button says so, and Enter waits for it. */
export const Pending: Story = {
  args: { onBack: fn() },
  render: (args) => (
    <Stage>
      <SpanCard {...args}>
        <Field label="Why" hint="Only you see this." value="Gym" />
        <Button variant="primary" isPending>
          Block it
        </Button>
      </SpanCard>
    </Stage>
  ),
};

/** Refused: the reason, above the button to try again. */
export const Error: Story = {
  args: { onBack: fn() },
  render: (args) => (
    <Stage>
      <SpanCard {...args}>
        <Field label="Why" hint="Only you see this." />
        <Callout tone="danger">That time couldn’t be blocked. Try again.</Callout>
        <Button variant="primary">Block it</Button>
      </SpanCard>
    </Stage>
  ),
};

/** Done: what happened, and Done, which takes focus as the card changes. */
export const Done: Story = {
  render: function Render(args) {
    const [isDone, setDone] = useState(false);
    return (
      <Stage>
        {isDone ? (
          <SpanCard {...args} focusKey="done">
            <Callout tone="success" isAnnounced>
              Time blocked.
            </Callout>
            <Button>Done</Button>
          </SpanCard>
        ) : (
          <SpanCard {...args} focusKey="block">
            <Button variant="primary" onPress={() => setDone(true)}>
              Block it
            </Button>
          </SpanCard>
        )}
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Block it' }));
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Done' })).toHaveFocus());
  },
};
