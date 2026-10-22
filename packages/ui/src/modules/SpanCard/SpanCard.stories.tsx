import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Radio, RadioGroup } from '../../atoms/Radio/Radio.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { hoverUntilHovered } from '../../workbench/pointer.ts';
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
      { id: 'hold', label: 'Reserve for link only pages', icon: 'bookmark', onPress: fn() },
    ],
  },
  render: (args) => (
    <Stage>
      <SpanCard {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    const block = canvas.getByRole('button', { name: 'Block this time' });
    await userEvent.click(block);
    await expect(args.choices?.[1]?.onPress).toHaveBeenCalled();
    // The pointer stays on the choice until its hover shows, so every shot has it (one CI run caught it without).
    await hoverUntilHovered(userEvent, block);
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
    const back = canvas.getByRole('button', { name: 'Back' });
    await userEvent.click(back);
    await expect(args.onBack).toHaveBeenCalled();
    // The pointer stays on Back until its hover shows, so every shot has it (one CI run caught it without).
    await hoverUntilHovered(userEvent, back);
  },
};

/** Saving: Back and the fields wait, the button says so, and Enter waits for it. */
export const Pending: Story = {
  args: { onBack: fn(), isBusy: true },
  render: (args) => (
    <Stage>
      <SpanCard {...args}>
        <Field label="Why" hint="Only you see this." value="Gym" isDisabled />
        <Button variant="primary" isPending>
          Blocking
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

/** Picking a choice swaps the card's body, and focus moves to the first control of the new one. */
export const Picked: Story = {
  render: function Render(args) {
    const [isPicked, setPicked] = useState(false);
    return (
      <Stage>
        {isPicked ? (
          <SpanCard {...args} focusKey="block" onBack={() => setPicked(false)}>
            <Button variant="primary">Block it</Button>
          </SpanCard>
        ) : (
          <SpanCard
            {...args}
            focusKey="choose"
            choices={[{ id: 'block', label: 'Block this time', icon: 'circle-slash', onPress: () => setPicked(true) }]}
          />
        )}
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Block this time' }));
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Block it' })).toHaveFocus());
  },
};
