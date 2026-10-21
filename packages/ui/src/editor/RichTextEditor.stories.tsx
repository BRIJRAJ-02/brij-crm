import { RichTextDocBody, type ActorDisplay, type RichTextDoc } from '@crm/contracts/values';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Button } from '../atoms/Button/Button.tsx';
import { SAMPLE_MEMBERS } from '../workbench/field-samples.ts';
import { Stage } from '../workbench/Stage/Stage.tsx';
import { NoteEditor, type NoteEditorProps } from './NoteEditor.tsx';

/** A note with every node and mark the editor writes. */
const EVERY_PART: RichTextDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Renewal call' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Met ' },
        { type: 'mention', attrs: { id: 'm-ada', label: 'Ada Lovelace' } },
        { type: 'text', text: ' in Portland. ' },
        { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ', ' },
        { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
        { type: 'text', text: ', ' },
        { type: 'text', text: 'struck', marks: [{ type: 'strike' }] },
        { type: 'text', text: ', ' },
        { type: 'text', text: 'underlined', marks: [{ type: 'underline' }] },
        { type: 'text', text: ', ' },
        { type: 'text', text: 'apiLimit', marks: [{ type: 'code' }] },
        { type: 'text', text: ', ' },
        { type: 'text', text: 'the deadline', marks: [{ type: 'highlight' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'their pricing page', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        { type: 'text', text: '.' },
        { type: 'hardBreak' },
        { type: 'text', text: 'A second line.' },
      ],
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What they asked for' }] },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Higher API limits' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'An EU workspace' }] }] },
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 1 },
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Legal review' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Signature' }] }] },
      ],
    },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Follow ups' }] },
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Send the deck' }] }],
        },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Book the security review' }] }],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'We sign once the limits move.' }] }],
    },
    { type: 'codeBlock', content: [{ type: 'text', text: 'limit: 10000 requests / minute' }] },
    { type: 'horizontalRule' },
    { type: 'paragraph', content: [{ type: 'text', text: 'Next call on Friday.' }] },
  ],
};

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

/** The editable text. */
function editable(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[role="textbox"][contenteditable]');
  if (element === null) throw new Error('No editor on the page.');
  return element;
}

/** Selects the whole of an element's text, as a person dragging over it would; ProseMirror follows the DOM selection. */
function selectText(element: Element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** The editor in a stage that counts the Esc presses reaching what holds it, beside a button to move focus to. */
function EscapeWatch(args: NoteEditorProps) {
  const [escapes, setEscapes] = useState(0);
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = holder.current;
    const count = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEscapes((before) => before + 1);
    };
    element?.addEventListener('keydown', count);
    return () => {
      element?.removeEventListener('keydown', count);
    };
  }, []);
  return (
    <Stage direction="column" width="fill">
      <div ref={holder}>
        <NoteEditor {...args} />
      </div>
      <Button>Elsewhere</Button>
      <output data-testid="escapes">{escapes}</output>
    </Stage>
  );
}

/** The last document `onChange` heard. */
function lastDoc(onChange: unknown): unknown {
  const calls = (onChange as { mock: { calls: unknown[][] } }).mock.calls;
  return calls.at(-1)?.[0];
}

const meta = {
  title: 'Editor/RichTextEditor',
  component: NoteEditor,
  args: { label: 'Note', onChange: fn() },
  render: (args: NoteEditorProps) => (
    <Stage direction="column" width="fill">
      <NoteEditor {...args} />
    </Stage>
  ),
} satisfies Meta<typeof NoteEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An empty note shows its placeholder; typing hands the document to onChange once typing pauses. */
export const Empty: Story = {
  play: async ({ args, userEvent }) => {
    const text = editable();
    await expect(text).toHaveAccessibleName('Note');
    await expect(text.querySelector('[data-placeholder]')).toHaveAttribute(
      'data-placeholder',
      'Write something, press / for commands, or @ to mention someone',
    );
    // A page, not a form: no box around the text.
    await expect(getComputedStyle(text).borderStyle).toBe('none');
    await userEvent.click(text);
    await userEvent.keyboard('Call notes');
    await waitFor(() => expect(args.onChange).toHaveBeenCalled());
    const doc = lastDoc(args.onChange);
    await expect(RichTextDocBody.safeParse(doc).success).toBe(true);
    await expect(JSON.stringify(doc)).toContain('Call notes');
  },
};

/** Every node and mark a note may hold: headings, marks, a mention, a link, lists, a task list, a quote, code and a rule. */
export const EveryPart: Story = {
  args: { defaultValue: EVERY_PART },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Renewal call' })).toBeInTheDocument();
    await expect(canvas.getByText('@Ada Lovelace')).toBeInTheDocument();
    await expect(canvas.getByText('their pricing page')).toHaveAttribute('href', 'https://example.com');
    await expect(canvas.getByRole('checkbox', { name: 'Mark “Send the deck” as not done' })).toBeChecked();
    await expect(canvas.getByRole('checkbox', { name: 'Mark “Book the security review” as done' })).not.toBeChecked();
  },
};

/** Selecting text raises the format toolbar, which holds the marks and Link only; Bold makes the selection bold. */
export const FormatToolbar: Story = {
  args: {
    defaultValue: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ship it' }] }] },
  },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    const text = editable();
    await userEvent.click(text);
    const paragraph = text.querySelector('p');
    if (paragraph === null) throw new Error('No paragraph.');
    selectText(paragraph);
    const bold = await canvas.findByRole('button', { name: 'Bold' });
    const toolbar = canvas.getByRole('toolbar', { name: 'Formatting' });
    await waitFor(() => expect(toolbar).toBeVisible());
    const names = [...toolbar.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'));
    await expect(names).toEqual(['Bold', 'Italic', 'Strikethrough', 'Code', 'Highlight', 'Link']);
    await userEvent.click(bold);
    await waitFor(() => expect(text.querySelector('strong')).toHaveTextContent('Ship it'));
    await waitFor(() => expect(JSON.stringify(lastDoc(args.onChange))).toContain('"bold"'));
  },
};

/** Link asks for an address: an unsafe one is refused, a bare site gets https. */
export const AddLink: Story = {
  args: {
    defaultValue: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pricing' }] }] },
  },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const text = editable();
    await userEvent.click(text);
    const paragraph = text.querySelector('p');
    if (paragraph === null) throw new Error('No paragraph.');
    selectText(paragraph);
    await userEvent.click(await canvas.findByRole('button', { name: 'Link' }));
    const field = await canvas.findByRole('textbox', { name: 'Link address' });
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.keyboard('javascript:alert(1){Enter}');
    await expect(await canvas.findByText(/Use an address that starts with/)).toBeInTheDocument();
    await userEvent.keyboard(`{Backspace>${String('javascript:alert(1)'.length)}/}`);
    await expect(field).toHaveValue('');
    await userEvent.keyboard('example.com{Enter}');
    await waitFor(() => expect(canvas.getByText('Pricing')).toHaveAttribute('href', 'https://example.com'));
  },
};

/** Typing @ opens the members list under it; the arrows move, Enter inserts the member as a mention. */
export const Mentions: Story = {
  args: { onSearchMentions: searchMembers },
  play: async ({ args, userEvent }) => {
    const text = editable();
    await userEvent.click(text);
    await userEvent.keyboard('Ask @');
    const list = await waitFor(() => {
      const found = document.querySelector('[role="listbox"]');
      if (found === null) throw new Error('No list yet.');
      return found;
    });
    await expect(list).toHaveAccessibleName('Members');
    await waitFor(() => expect(list.querySelectorAll('[role="option"]')).toHaveLength(4));
    await userEvent.keyboard('g');
    await waitFor(() => expect(list.querySelectorAll('[role="option"]')).toHaveLength(1));
    await expect(text).toHaveAttribute('aria-activedescendant');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
    await expect(text).toHaveTextContent('@Grace Hopper');
    await waitFor(() => expect(JSON.stringify(lastDoc(args.onChange))).toContain('"label":"Grace Hopper"'));
  },
};

/** The members list stays open while choosing, the second member highlighted. */
export const MentionsOpen: Story = {
  args: { onSearchMentions: searchMembers },
  play: async ({ userEvent }) => {
    const text = editable();
    await userEvent.click(text);
    await userEvent.keyboard('@');
    await waitFor(() => expect(document.querySelectorAll('[role="option"]')).toHaveLength(4));
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(document.querySelector('[role="option"][aria-selected="true"]')).toHaveTextContent('Grace Hopper'),
    );
  },
};

/** Esc closes the members list and leaves the @ as typed. */
export const MentionsEscape: Story = {
  args: { onSearchMentions: searchMembers },
  parameters: { crm: { screenshot: false } },
  play: async ({ userEvent }) => {
    const text = editable();
    await userEvent.click(text);
    await userEvent.keyboard('@a');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
    await expect(text).toHaveTextContent('@a');
  },
};

/** Pasted content keeps what the schema allows: an unsafe link loses its address and an image is dropped. */
export const Paste: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ args, userEvent }) => {
    const text = editable();
    await userEvent.click(text);
    const data = new DataTransfer();
    data.setData(
      'text/html',
      '<p>See <a href="javascript:alert(1)">this</a> and <a href="https://example.com">that</a>.</p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">',
    );
    data.setData('text/plain', 'See this and that.');
    await userEvent.paste(data);
    await waitFor(() => expect(text).toHaveTextContent('See this and that.'));
    await expect(text.querySelector('img')).toBeNull();
    await expect(text.querySelectorAll('[href]')).toHaveLength(1);
    await waitFor(() => expect(RichTextDocBody.safeParse(lastDoc(args.onChange)).success).toBe(true));
    await expect(JSON.stringify(lastDoc(args.onChange))).not.toContain('javascript');
  },
};

/** The open slash menu (spec 0019, 21 October 2026): every block, its markdown at the row's end, the first highlighted. */
export const SlashMenuOpen: Story = {
  play: async ({ userEvent }) => {
    const text = editable();
    await userEvent.click(text);
    await userEvent.keyboard('/');
    const list = await waitFor(() => {
      const found = document.querySelector('[role="listbox"]');
      if (found === null) throw new Error('No menu yet.');
      return found;
    });
    await expect(list).toHaveAccessibleName('Blocks');
    const rows = [...list.querySelectorAll('[role="option"]')];
    await expect(rows.map((row) => row.textContent)).toEqual([
      'Text',
      'Heading 1#',
      'Heading 2##',
      'Heading 3###',
      'Bulleted list-',
      'Numbered list1.',
      'To do list[]',
      'Quote>',
      'Divider---',
      'Code block```',
    ]);
    await expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    await expect(text).toHaveAttribute('aria-controls', list.id);
    await expect(text).toHaveAttribute('aria-activedescendant', rows[0]?.id);
    // A bare "/" says what to do next.
    await expect(text.querySelector('[data-decoration-content]')).toHaveAttribute(
      'data-decoration-content',
      'Type to filter',
    );
  },
};

/** Typing after "/" filters the blocks; the arrows move, Enter turns the line into the block and the menu closes. */
export const SlashMenuPick: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ args, userEvent }) => {
    const text = editable();
    await userEvent.click(text);
    await userEvent.keyboard('Next steps /head');
    const list = await waitFor(() => {
      const found = document.querySelector('[role="listbox"]');
      if (found === null) throw new Error('No menu yet.');
      return found;
    });
    await waitFor(() => expect(list.querySelectorAll('[role="option"]')).toHaveLength(3));
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(document.querySelector('[role="option"][aria-selected="true"]')).toHaveTextContent('Heading 2'),
    );
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
    await expect(text.querySelector('h2')).toHaveTextContent('Next steps');
    await expect(text).not.toHaveTextContent('/head');
    await expect(text).not.toHaveAttribute('aria-controls');
    await waitFor(() => expect(JSON.stringify(lastDoc(args.onChange))).toContain('"level":2'));
  },
};

/** Each block from the menu: a to do list, a divider and a code block; a query matching nothing says so. */
export const SlashMenuBlocks: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ userEvent }) => {
    const text = editable();
    await userEvent.click(text);
    await userEvent.keyboard('/todo');
    await waitFor(() => expect(document.querySelectorAll('[role="option"]')).toHaveLength(1));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(text.querySelector('ul[data-type="taskList"]')).not.toBeNull());
    await userEvent.keyboard('Send the deck{Enter}{Enter}/divider{Enter}');
    await waitFor(() => expect(text.querySelector('hr')).not.toBeNull());
    await userEvent.keyboard('/code{Enter}');
    await waitFor(() => expect(text.querySelector('pre')).not.toBeNull());
    // In code "/" is a character: no menu.
    await userEvent.keyboard('a /b');
    await expect(document.querySelector('[role="listbox"]')).toBeNull();
    await userEvent.keyboard('{Enter}{Enter}{Enter}/zzz');
    // Nothing matching: no empty listbox, but a polite word on why.
    await waitFor(() =>
      expect(document.querySelector('[role="status"][aria-label="Blocks"]')).toHaveTextContent('No block matches'),
    );
    await expect(document.querySelector('[role="listbox"]')).toBeNull();
  },
};

/** Esc closes the slash menu and leaves the "/" as typed; whatever holds the editor never hears that Esc. */
export const SlashMenuEscape: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args: NoteEditorProps) => <EscapeWatch {...args} />,
  play: async ({ canvas, userEvent }) => {
    const text = editable();
    await userEvent.click(text);
    await userEvent.keyboard('/');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
    await expect(text).toHaveTextContent('/');
    await expect(canvas.getByTestId('escapes')).toHaveTextContent('0');
    // Leaving the text closes an open menu too.
    await userEvent.keyboard(' /');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull());
    await userEvent.click(canvas.getByRole('button', { name: 'Elsewhere' }));
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
  },
};

/** Esc over a selection closes the format toolbar first, so the holder's Esc comes only with the next press. */
export const EscapeSelection: Story = {
  args: {
    defaultValue: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ship it' }] }] },
  },
  parameters: { crm: { screenshot: false } },
  render: (args: NoteEditorProps) => <EscapeWatch {...args} />,
  play: async ({ canvas, userEvent }) => {
    const text = editable();
    await userEvent.click(text);
    const paragraph = text.querySelector('p');
    if (paragraph === null) throw new Error('No paragraph.');
    selectText(paragraph);
    await waitFor(() => expect(canvas.getByRole('toolbar', { name: 'Formatting' })).toBeVisible());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByRole('toolbar', { name: 'Formatting' })).toBeNull());
    await expect(canvas.getByTestId('escapes')).toHaveTextContent('0');
    await userEvent.keyboard('{Escape}');
    await expect(canvas.getByTestId('escapes')).toHaveTextContent('1');
  },
};

/** The markdown shortcuts make blocks as they are typed: a heading, a list, a numbered list, a to do, a quote and code. */
export const MarkdownShortcuts: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ userEvent }) => {
    const text = editable();
    await userEvent.click(text);
    await userEvent.keyboard('# Plan{Enter}');
    await userEvent.keyboard('- One{Enter}{Enter}');
    await userEvent.keyboard('1. First{Enter}{Enter}');
    // "[[" types one "[" (user-event reads a single one as a key's code).
    await userEvent.keyboard('[[] Call back{Enter}{Enter}');
    await userEvent.keyboard('> Said yes{Enter}{Enter}');
    await userEvent.keyboard('``` ');
    await waitFor(() => expect(text.querySelector('pre')).not.toBeNull());
    await expect(text.querySelector('h1')).toHaveTextContent('Plan');
    await expect(text.querySelector('ul:not([data-type])')).toHaveTextContent('One');
    await expect(text.querySelector('ol')).toHaveTextContent('First');
    await expect(text.querySelector('ul[data-type="taskList"]')).toHaveTextContent('Call back');
    await expect(text.querySelector('blockquote')).toHaveTextContent('Said yes');
  },
};

/** Read only: nothing can change, and the reason shows under the note. */
export const ReadOnly: Story = {
  args: {
    defaultValue: EVERY_PART,
    isReadOnly: true,
    readOnlyReason: 'You can view this note but not change it.',
  },
  play: async ({ canvas }) => {
    const text = editable();
    await expect(text).toHaveAttribute('contenteditable', 'false');
    await expect(text).toHaveAttribute('aria-readonly', 'true');
    await expect(text).toHaveAccessibleDescription('You can view this note but not change it.');
    await expect(canvas.getByText('You can view this note but not change it.')).toBeInTheDocument();
  },
};

/** A refusal shows under the note, and the text stays for copying. */
export const Refused: Story = {
  args: {
    defaultValue: EVERY_PART,
    error: 'This note is too long to save. Split it into two notes.',
  },
  play: async () => {
    const text = editable();
    await expect(text).toHaveAttribute('aria-invalid', 'true');
    await expect(text).toHaveAccessibleDescription('This note is too long to save. Split it into two notes.');
  },
};
