import type { Meta, StoryObj } from '@storybook/react-vite';
import { restPointer } from '../../workbench/pointer.ts';
import { expect, fn, waitFor, within } from 'storybook/test';
import { SAMPLE_MEMBERS } from '../../workbench/field-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { CommentThread, type CommentItem, type CommentThreadItem, type CommentThreadProps } from './CommentThread.tsx';

const [ADA, GRACE, ALAN] = SAMPLE_MEMBERS;

/** A comment with the sample's defaults. */
function comment(id: string, body: string, extra: Partial<CommentItem> = {}): CommentItem {
  return {
    id,
    isDeleted: false,
    author: ADA,
    createdAt: '2026-10-08T12:30:00.000Z',
    body,
    reactions: [],
    canEdit: false,
    canDelete: false,
    ...extra,
  };
}

/** A conversation about a renewal: a question, a mention, a reply with reactions. */
function sampleThread(extra: Partial<CommentThreadItem> = {}): CommentThreadItem {
  return {
    id: 't1',
    earlierCount: 0,
    comments: [
      comment('c1', `Can we close this before the board pack? <@${GRACE?.id ?? ''}> has the numbers.`, {
        reactions: [{ emoji: '👍', count: 3, mine: true, names: ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'] }],
        canEdit: true,
        canDelete: true,
      }),
      comment('c2', 'Yes. Draft is here: https://docs.example.com/renewal\nI will send it tonight.', {
        author: GRACE,
        createdAt: '2026-10-08T13:10:00.000Z',
        editedAt: '2026-10-08T13:15:00.000Z',
      }),
    ],
    ...extra,
  };
}

type SampleProps = Partial<Omit<CommentThreadProps, 'thread' | 'members'>> & { readonly thread?: CommentThreadItem };

/** The thread at a record tab's width. */
function SampleThread({ thread = sampleThread(), ...props }: SampleProps) {
  return (
    <Stage width="fill">
      <CommentThread
        thread={thread}
        members={SAMPLE_MEMBERS}
        formerMember="Former member"
        onReply={props.onReply ?? (() => Promise.resolve(undefined))}
        onEdit={props.onEdit ?? (() => Promise.resolve(undefined))}
        onDelete={props.onDelete ?? (() => undefined)}
        onResolve={props.onResolve ?? (() => undefined)}
        onReact={props.onReact ?? (() => undefined)}
        onLoadVersions={
          props.onLoadVersions ??
          (() => Promise.resolve([{ version: 1, body: 'Yes. Draft soon.', at: '2026-10-08T13:10:00.000Z' }]))
        }
        {...(props.onShowEarlier === undefined ? {} : { onShowEarlier: props.onShowEarlier })}
        {...(props.isReadOnly === undefined ? {} : { isReadOnly: props.isReadOnly })}
        {...(props.isHighlighted === undefined ? {} : { isHighlighted: props.isHighlighted })}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/CommentThread',
  component: SampleThread,
} satisfies Meta<typeof SampleThread>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A question with a mention, a reply with a link, reactions, and "edited". */
export const Default: Story = {
  args: { onReact: fn() },
  parameters: { crm: { preview: true } },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('article', { name: 'Thread started by Ada Lovelace' })).toBeInTheDocument();
    await expect(canvas.getByText('@Grace Hopper')).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'https://docs.example.com/renewal' })).toBeInTheDocument();
    const chip = canvas.getByRole('button', { name: '👍 3' });
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(chip);
    await expect(args.onReact).toHaveBeenCalledWith('c1', '👍', false);
  },
};

/** "edited" opens the earlier versions, newest first. */
export const EditedVersions: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'edited' }));
    const body = within(document.body);
    await waitFor(() => expect(body.getByText('Yes. Draft soon.')).toBeInTheDocument());
  },
};

/** Reply opens a composer under the last comment, and sends. */
export const Replying: Story = {
  args: { onReply: fn((_body: string): Promise<string | undefined> => Promise.resolve(undefined)) },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Reply' }));
    const field = canvas.getByRole('textbox', { name: 'Reply' });
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.keyboard('On it{Meta>}{Enter}{/Meta}');
    await expect(args.onReply).toHaveBeenCalledWith('On it');
  },
};

/** The first comment's menu: Edit, Resolve thread and Delete (which the screen confirms). */
export const Actions: Story = {
  args: { onDelete: fn(), onResolve: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getAllByRole('button', { name: 'More actions' })[0] as HTMLElement);
    const body = within(document.body);
    await userEvent.click(await body.findByRole('menuitem', { name: 'Resolve thread' }));
    await expect(args.onResolve).toHaveBeenCalledWith(true);
    await userEvent.click(canvas.getAllByRole('button', { name: 'More actions' })[0] as HTMLElement);
    await userEvent.click(await body.findByRole('menuitem', { name: 'Delete' }));
    await expect(args.onDelete).toHaveBeenCalledWith('c1');
  },
};

/** Editing in place: the comment's text in the composer, Save and Cancel. */
export const Editing: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getAllByRole('button', { name: 'More actions' })[0] as HTMLElement);
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Edit' }));
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: 'Edit comment' })).toHaveValue(
        'Can we close this before the board pack? @Grace Hopper has the numbers.',
      ),
    );
  },
};

/** Resolved: who resolved it and when, above the comments. */
export const Resolved: Story = {
  args: { thread: sampleThread({ resolvedAt: '2026-10-08T14:00:00.000Z', resolvedBy: ALAN }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Resolved by Alan Turing')).toBeInTheDocument();
  },
};

/** A deleted first comment keeps its place while the reply reads; a reply is still sending. */
export const DeletedAndSending: Story = {
  args: {
    thread: {
      id: 't2',
      earlierCount: 0,
      comments: [
        comment('d1', '', { isDeleted: true }),
        comment('d2', 'Still here.', { author: GRACE }),
        comment('d3', 'Sending this one', { isSending: true }),
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('This comment was deleted.')).toBeInTheDocument();
    await expect(canvas.getByText('Sending')).toBeInTheDocument();
  },
};

/** A busy thread read its newest replies only: "Show 12 earlier replies". */
export const EarlierReplies: Story = {
  args: { thread: sampleThread({ earlierCount: 12 }), onShowEarlier: fn() },
  play: async ({ args, canvas, userEvent }) => {
    const earlier = canvas.getByRole('button', { name: 'Show 12 earlier replies' });
    await userEvent.click(earlier);
    await expect(args.onShowEarlier).toHaveBeenCalled();
    // The pointer is left resting on what it pressed, and this story is a screenshot: at rest, not hovered.
    await restPointer(userEvent, earlier);
  },
};

/** Opened from a link: the accent's soft fill. */
export const Highlighted: Story = {
  args: { isHighlighted: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('article')).toHaveAttribute('data-highlighted');
  },
};

/** Read only (the record is in the trash): no Reply, no menus, chips that can't be pressed. */
export const ReadOnly: Story = {
  args: { isReadOnly: true },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: '👍 3' })).toBeDisabled();
  },
};
