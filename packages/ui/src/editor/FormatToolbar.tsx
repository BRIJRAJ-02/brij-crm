// The format toolbar (spec 0003's FormatToolbar): a bubble over the selection
// in a note, holding the library's ToggleButtons in a React Aria Toolbar. It
// follows the editor in the page, so Tab from the text reaches it (and
// Alt+F10, the usual toolbar key, jumps to it); arrows move between its
// buttons and Esc goes back to the text. Link swaps the buttons for an
// address field.
import { isSafeLink } from '@crm/contracts/values';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useState, type KeyboardEvent } from 'react';
import { Toolbar } from 'react-aria-components';
import { Button, ToggleButton } from '../atoms/Button/Button.tsx';
import { editorIcons } from '../atoms/Icon/editor-icons.ts';
import { IconScope } from '../atoms/Icon/Icon.tsx';
import type { IconName } from '../atoms/Icon/icons.ts';
import { spaceToken } from '../lib/token-values.ts';
import { Field } from '../molecules/Field/Field.tsx';
import styles from './FormatToolbar.module.css';
import { strings } from './strings.ts';

/** Props for FormatToolbar. */
export interface FormatToolbarProps {
  readonly editor: Editor;
}

/** What each toggle shows and does. */
interface Toggle {
  readonly key: string;
  readonly icon: IconName;
  readonly label: string;
  readonly isActive: (editor: Editor) => boolean;
  readonly run: (editor: Editor) => void;
}

const TOGGLES: readonly Toggle[] = [
  {
    key: 'bold',
    icon: 'bold',
    label: strings.bold,
    isActive: (editor) => editor.isActive('bold'),
    run: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    key: 'italic',
    icon: 'italic',
    label: strings.italic,
    isActive: (editor) => editor.isActive('italic'),
    run: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    key: 'strike',
    icon: 'strikethrough',
    label: strings.strike,
    isActive: (editor) => editor.isActive('strike'),
    run: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  {
    key: 'code',
    icon: 'code',
    label: strings.code,
    isActive: (editor) => editor.isActive('code'),
    run: (editor) => editor.chain().focus().toggleCode().run(),
  },
  {
    key: 'highlight',
    icon: 'highlighter',
    label: strings.highlight,
    isActive: (editor) => editor.isActive('highlight'),
    run: (editor) => editor.chain().focus().toggleHighlight().run(),
  },
  {
    key: 'heading1',
    icon: 'heading-1',
    label: strings.heading1,
    isActive: (editor) => editor.isActive('heading', { level: 1 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    key: 'heading2',
    icon: 'heading-2',
    label: strings.heading2,
    isActive: (editor) => editor.isActive('heading', { level: 2 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    key: 'bulletList',
    icon: 'list',
    label: strings.bulletList,
    isActive: (editor) => editor.isActive('bulletList'),
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    key: 'orderedList',
    icon: 'list-ordered',
    label: strings.orderedList,
    isActive: (editor) => editor.isActive('orderedList'),
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    key: 'taskList',
    icon: 'list-todo',
    label: strings.taskList,
    isActive: (editor) => editor.isActive('taskList'),
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    key: 'blockquote',
    icon: 'text-quote',
    label: strings.quote,
    isActive: (editor) => editor.isActive('blockquote'),
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
];

/** An address as typed, with `https://` added when it names a site without a protocol. */
export function linkAddress(typed: string): string {
  const value = typed.trim();
  if (value === '' || value.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  return `https://${value}`;
}

/** The bubble toolbar over a selection: marks, headings, lists, quote and link. */
export function FormatToolbar({ editor }: FormatToolbarProps) {
  const [isEditingLink, setEditingLink] = useState(false);
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      toggles: TOGGLES.map((toggle) => toggle.isActive(current)),
      link: current.isActive('link'),
      href: String(current.getAttributes('link').href ?? ''),
    }),
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    setEditingLink(false);
    editor.commands.focus();
  };
  // The toolbar's own icons come in the editor's chunk (editor-icons.ts), not the registry every page loads.
  return (
    <IconScope icons={editorIcons}>
      <BubbleMenu
        editor={editor}
        className={styles.bubble}
        options={{ placement: 'top', offset: spaceToken('space-8') }}
        onKeyDown={onKeyDown}
      >
        {isEditingLink ? (
          <LinkForm
            editor={editor}
            initial={active.href}
            hasLink={active.link}
            onDone={() => {
              setEditingLink(false);
            }}
          />
        ) : (
          <Toolbar aria-label={strings.formatting} className={styles.toolbar}>
            {TOGGLES.map((toggle, index) => (
              <ToggleButton
                key={toggle.key}
                variant="ghost"
                icon={toggle.icon}
                label={toggle.label}
                isSelected={active.toggles[index] ?? false}
                onChange={() => {
                  toggle.run(editor);
                }}
              />
            ))}
            <ToggleButton
              variant="ghost"
              icon="link"
              label={strings.link}
              isSelected={active.link}
              onChange={() => {
                setEditingLink(true);
              }}
            />
          </Toolbar>
        )}
      </BubbleMenu>
    </IconScope>
  );
}

/** The address field Link opens: Enter applies a safe address, Esc goes back. */
function LinkForm({
  editor,
  initial,
  hasLink,
  onDone,
}: {
  readonly editor: Editor;
  readonly initial: string;
  readonly hasLink: boolean;
  readonly onDone: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | undefined>(undefined);
  // Back to the text on the next frame: moved during the Enter that applied the link, Safari would
  // hand that Enter to the editor, and it would replace the linked text with a new line.
  const finish = () => {
    onDone();
    requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.commands.focus();
    });
  };
  const apply = () => {
    const href = linkAddress(value);
    if (href !== '' && !isSafeLink(href)) {
      setError(strings.unsafeLink);
      return;
    }
    const chain = editor.chain().extendMarkRange('link');
    (href === '' ? chain.unsetLink() : chain.setLink({ href })).run();
    finish();
  };
  const remove = () => {
    editor.chain().extendMarkRange('link').unsetLink().run();
    finish();
  };
  return (
    <div className={styles.link}>
      <Field
        // eslint-disable-next-line jsx-a11y-x/no-autofocus -- the field was opened on purpose, from Link
        autoFocus
        label={strings.linkAddress}
        isLabelHidden
        size="sm"
        type="url"
        value={value}
        placeholder={strings.linkPlaceholder}
        {...(error === undefined ? {} : { error })}
        onChange={(next) => {
          setValue(next);
          setError(undefined);
        }}
        onSubmit={apply}
        onEscape={finish}
      />
      <Button variant="primary" onPress={apply}>
        {strings.applyLink}
      </Button>
      {hasLink ? (
        <Button variant="ghost" icon="trash" label={strings.removeLink} onPress={remove} />
      ) : (
        <Button variant="ghost" onPress={finish}>
          {strings.cancelLink}
        </Button>
      )}
    </div>
  );
}
