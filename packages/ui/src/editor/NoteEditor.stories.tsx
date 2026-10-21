import type { ActorDisplay, RichTextDoc } from '@crm/contracts/values';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { expect, fn, screen, waitFor } from 'storybook/test';
import { Button } from '../atoms/Button/Button.tsx';
import { RecordChip } from '../atoms/RecordChip/RecordChip.tsx';
import { RelativeTime } from '../atoms/RelativeTime/RelativeTime.tsx';
import { Tooltip } from '../atoms/Tooltip/Tooltip.tsx';
import { Callout } from '../molecules/Callout/Callout.tsx';
import { Modal } from '../molecules/Modal/Modal.tsx';
import { SAMPLE_MEMBERS } from '../workbench/field-samples.ts';
import { NoteEditor, type NoteEditorProps } from './NoteEditor.tsx';

// A note as the note window draws it (spec 0019, the owner's Notion pass of 21 October 2026): the Modal's peek,
// its quiet bar holding the record as a crumb, the save state, More and Close, and the page itself: the note's
// title over its text, with no box around either. Every state of the window, from a new note to one read only.

/** The record every note here is on. */
const RECORD = { objectId: 'people', recordId: 'p1', name: 'Brijraj', kind: 'person' as const, hue: 'blue' as const };

/** A note as it is read again: a line, a heading and a list. */
const KICKOFF: RichTextDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'They want 40 seats by March, and an EU workspace before they sign.' }],
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Next steps' }] },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Send the security review' }] }],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Book the legal call with ' },
                { type: 'mention', attrs: { id: 'm-ada', label: 'Ada Lovelace' } },
              ],
            },
          ],
        },
      ],
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'Next call on Friday.' }] },
  ],
};

/** Puts the caret at the very end of the text, as a click after its last line would; ProseMirror follows the DOM. */
function caretAtEnd(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

/** Members whose name starts a word with the query, as the members store answers. */
async function searchMembers(query: string): Promise<readonly ActorDisplay[]> {
  const wanted = query.toLowerCase();
  await Promise.resolve();
  return SAMPLE_MEMBERS.filter((member) =>
    member.name
      .toLowerCase()
      .split(' ')
      .some((word) => word.startsWith(wanted)),
  );
}

/** The note's text. */
function text(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[role="textbox"][contenteditable]');
  if (element === null) throw new Error('No editor on the page.');
  return element;
}

/** The note's title. */
function titleField(): HTMLTextAreaElement {
  const element = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Title"]');
  if (element === null) throw new Error('No title on the page.');
  return element;
}

/** What the window adds around the page: a notice above it, and the bar's save state. */
interface PeekArgs extends NoteEditorProps {
  readonly status?: ReactNode;
  readonly notice?: ReactNode;
}

/** The note window around the page, its title kept in the story's state as the window keeps it in the session's. */
function NotePeek({ status, notice, title: startTitle = '', ...args }: PeekArgs) {
  const [title, setTitle] = useState(startTitle);
  return (
    <Modal
      variant="peek"
      title={title.trim() === '' ? 'New note' : title}
      context={<RecordChip display={RECORD} isFlat href="/w/acme/objects/people/p1" />}
      isOpen
      {...(status === undefined ? {} : { status })}
      headerActions={
        <Tooltip content="More actions">
          <Button variant="ghost" icon="ellipsis" label="More actions" />
        </Tooltip>
      }
    >
      {notice}
      <NoteEditor
        {...args}
        title={title}
        onTitleChange={(next) => {
          setTitle(next);
          args.onTitleChange?.(next);
        }}
      />
    </Modal>
  );
}

const meta = {
  title: 'Editor/NoteEditor',
  component: NotePeek,
  args: {
    label: 'Note',
    titleMaxLength: 200,
    onChange: fn(),
    onTitleChange: fn(),
    onSearchMentions: searchMembers,
  },
  render: (args: PeekArgs) => <NotePeek {...args} />,
} satisfies Meta<typeof NotePeek>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A new note: no box anywhere, "Untitled" in the large title with focus in it, and the text's placeholder under it. */
export const New: Story = {
  args: { autoFocus: 'title' },
  play: async () => {
    const dialog = await waitFor(() => {
      const found = document.querySelector('[role="dialog"]');
      if (found === null) throw new Error('No window yet.');
      return found;
    });
    await expect(dialog).toHaveAccessibleName('New note');
    await waitFor(() => expect(titleField()).toHaveFocus());
    await expect(titleField()).toHaveAttribute('placeholder', 'Untitled');
    await expect(getComputedStyle(titleField()).fontSize).toBe('28px');
    await expect(text().querySelector('[data-placeholder]')).toHaveAttribute(
      'data-placeholder',
      'Write something, press / for commands, or @ to mention someone',
    );
    // The record stays in view, as the bar's crumb.
    await expect(dialog.querySelector('a[href="/w/acme/objects/people/p1"]')).toHaveTextContent('Brijraj');
  },
};

/** Typing: Enter in the title goes on to the text, and the bar says the note is saving. */
export const Typing: Story = {
  args: { autoFocus: 'title', status: 'Saving…' },
  play: async ({ args, userEvent }) => {
    await waitFor(() => expect(titleField()).toHaveFocus());
    await userEvent.keyboard('Kickoff call{Enter}');
    await waitFor(() => expect(text()).toHaveFocus());
    await expect(titleField()).toHaveValue('Kickoff call');
    await userEvent.keyboard('They want 40 seats by March.');
    await waitFor(() => expect(args.onChange).toHaveBeenCalled());
    await expect(args.onTitleChange).toHaveBeenLastCalledWith('Kickoff call');
    await expect(document.querySelector('[role="status"]')).toHaveTextContent('Saving…');
  },
};

/** Saved: the bar says so, quietly, beside More and Close. */
export const Saved: Story = {
  args: { title: 'Kickoff call', defaultValue: KICKOFF, status: 'Saved' },
  play: async () => {
    await expect(document.querySelector('[role="status"]')).toHaveTextContent('Saved');
    await expect(text().querySelector('h2')).toHaveTextContent('Next steps');
  },
};

/** A note opened again: the bar says when it was last edited, and focus is at the start of its text. */
export const Edited: Story = {
  args: {
    title: 'Kickoff call',
    defaultValue: KICKOFF,
    autoFocus: 'text',
    status: (
      <>
        {'Edited '}
        <RelativeTime value="2026-10-08T11:30:00.000Z" />
      </>
    ),
  },
  play: async () => {
    await waitFor(() => expect(text()).toHaveFocus());
    await expect(document.querySelector('[role="status"]')).toHaveTextContent(/Edited 3 hours ago/);
    const selection = window.getSelection();
    await expect(selection?.anchorNode?.textContent).toContain('They want 40 seats');
    await expect(selection?.anchorOffset).toBe(0);
  },
};

/** A refused save: the reason in a danger Callout over the page, the text kept for copying. */
export const Refused: Story = {
  args: {
    title: 'Kickoff call',
    defaultValue: KICKOFF,
    status: 'Not saved.',
    notice: (
      <Callout tone="danger" isAnnounced>
        This note is too long to save. Split it into two notes.
      </Callout>
    ),
  },
  play: async () => {
    await expect(document.querySelector('[role="dialog"]')).toHaveTextContent('This note is too long to save.');
    await expect(text()).toHaveTextContent('They want 40 seats');
  },
};

/** Read only: the reason over the page, and neither the title nor the text can change. */
export const ReadOnly: Story = {
  args: {
    title: 'Kickoff call',
    defaultValue: KICKOFF,
    isReadOnly: true,
    autoFocus: 'text',
    notice: <Callout tone="info">You can view this note but not change it.</Callout>,
  },
  play: async () => {
    await expect(titleField()).toHaveAttribute('readonly');
    await expect(text()).toHaveAttribute('contenteditable', 'false');
    // Read only takes no focus into the text.
    await expect(text()).not.toHaveFocus();
  },
};

/** The slash menu open at a new line of a note, its first block highlighted. */
export const SlashMenu: Story = {
  args: { title: 'Kickoff call', defaultValue: KICKOFF, status: 'Saved' },
  play: async ({ userEvent }) => {
    text().focus();
    caretAtEnd(text());
    await userEvent.keyboard('{Enter}/');
    const list = await waitFor(() => {
      const found = document.querySelector('[role="listbox"]');
      if (found === null) throw new Error('No menu yet.');
      return found;
    });
    await expect(list).toHaveAccessibleName('Blocks');
    // The window stays open while the menu is: Esc closes the menu first.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
    await expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await userEvent.keyboard('{Backspace}/');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull());
  },
};

/** The selection toolbar over a phrase: the marks and Link, as Notion's. */
export const SelectionToolbar: Story = {
  args: { title: 'Kickoff call', defaultValue: KICKOFF, status: 'Saved' },
  play: async () => {
    const words = text().querySelector('p')?.firstChild;
    if (words === null || words === undefined) throw new Error('No paragraph.');
    text().focus();
    const range = document.createRange();
    range.setStart(words, 0);
    range.setEnd(words, 'They want 40 seats'.length);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    // The window is a portal outside the story's frame, so its toolbar is found on the page.
    const toolbar = await screen.findByRole('toolbar', { name: 'Formatting' });
    await waitFor(() => expect(toolbar).toBeVisible());
  },
};

/** Back up to the title: the arrow up on the text's first line, or Backspace in an empty first line. */
export const BackToTitle: Story = {
  args: { title: 'Kickoff call', autoFocus: 'text' },
  parameters: { crm: { screenshot: false } },
  play: async ({ userEvent }) => {
    await waitFor(() => expect(text()).toHaveFocus());
    await userEvent.keyboard('{Backspace}');
    await waitFor(() => expect(titleField()).toHaveFocus());
    await expect(titleField().selectionStart).toBe('Kickoff call'.length);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(text()).toHaveFocus());
    await userEvent.keyboard('Met at the fair');
    await waitFor(() => expect(text()).toHaveTextContent('Met at the fair'));
    await userEvent.keyboard('{ArrowUp}');
    await waitFor(() => expect(titleField()).toHaveFocus());
    await expect(titleField()).toHaveValue('Kickoff call');
  },
};
