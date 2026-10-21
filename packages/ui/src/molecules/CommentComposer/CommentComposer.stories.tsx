import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor, within } from 'storybook/test';
import { SAMPLE_MEMBERS } from '../../workbench/field-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { CommentComposer, type CommentComposerProps } from './CommentComposer.tsx';

const ADA_ID = SAMPLE_MEMBERS[0]?.id ?? '';

type SampleProps = Omit<CommentComposerProps, 'members'>;

/** The composer at a record panel's width. */
function SampleComposer(props: SampleProps) {
  return (
    <Stage width="fill">
      <CommentComposer members={SAMPLE_MEMBERS} {...props} />
    </Stage>
  );
}

const meta = {
  title: 'Molecules/CommentComposer',
  component: SampleComposer,
  args: { onSubmit: fn((_body: string): Promise<string | undefined> => Promise.resolve(undefined)) },
} satisfies Meta<typeof SampleComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty: one line tall, Comment off until there is text. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Add a comment' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /Comment/ })).toBeDisabled();
  },
};

/** Typing @ opens the members; Down and Enter pick one, and the comment sends with the member's token. */
export const Mentioning: Story = {
  play: async ({ args, canvas, userEvent }) => {
    const field = canvas.getByRole('textbox', { name: 'Add a comment' });
    await userEvent.click(field);
    await userEvent.keyboard('Thanks @gr');
    await waitFor(() => expect(field).toHaveAttribute('aria-controls'));
    await expect(field).toHaveAttribute('aria-activedescendant');
    await userEvent.keyboard('{Enter}');
    await expect(field).toHaveValue('Thanks @Grace Hopper ');
    await userEvent.keyboard('{Backspace}{Backspace}');
    await expect(field).toHaveValue('Thanks ');
    await userEvent.keyboard('@ad{Tab}');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await expect(args.onSubmit).toHaveBeenCalledWith(`Thanks <@${ADA_ID}>`);
    await expect(field).toHaveValue('');
  },
};

/** The list says when nobody matches. */
export const NobodyMatches: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Add a comment' }));
    await userEvent.keyboard('@zzz');
    // The list is a popover, outside the story's root.
    await expect(await within(document.body).findByText('No one matches')).toBeInTheDocument();
  },
};

/** A reply, with Cancel; Esc cancels too. */
export const Reply: Story = {
  args: { mode: 'reply', onCancel: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Reply' }));
    await userEvent.keyboard('{Escape}');
    await expect(args.onCancel).toHaveBeenCalled();
  },
};

/** An edit starts from the comment's text, its mentions shown by name. */
export const Edit: Story = {
  args: { mode: 'edit', initialBody: `Over to <@${ADA_ID}> for the contract.`, onCancel: fn() },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Edit comment' })).toHaveValue(
      'Over to @Ada Lovelace for the contract.',
    );
    await expect(canvas.getByRole('button', { name: /Save/ })).toBeEnabled();
  },
};

/** Refused: the text comes back with the reason and Retry. */
export const Refused: Story = {
  args: {
    onSubmit: fn((_body: string): Promise<string | undefined> =>
      Promise.resolve('This thread is full. Start a new one.'),
    ),
  },
  play: async ({ canvas, userEvent }) => {
    const field = canvas.getByRole('textbox', { name: 'Add a comment' });
    await userEvent.click(field);
    await userEvent.keyboard('One more{Control>}{Enter}{/Control}');
    await waitFor(() => expect(canvas.getByText('This thread is full. Start a new one.')).toBeInTheDocument());
    await expect(field).toHaveValue('One more');
    await expect(canvas.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  },
};

/** Disabled: a record in the trash takes no comments. */
export const Disabled: Story = {
  args: { isDisabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Add a comment' })).toBeDisabled();
  },
};
