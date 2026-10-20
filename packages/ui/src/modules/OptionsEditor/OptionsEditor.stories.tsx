import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import { expect, fn, screen, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { OptionsEditor, type OptionsEditorChange, type OptionsEditorOption } from './OptionsEditor.tsx';

const TIERS: readonly OptionsEditorOption[] = [
  { id: 'silver', label: 'Silver', hue: 'gray', isArchived: false },
  { id: 'gold', label: 'Gold', hue: 'yellow', isArchived: false },
  { id: 'platinum', label: 'Platinum', hue: 'sky', isArchived: false },
  { id: 'bronze', label: 'Bronze', hue: 'orange', isArchived: true },
];

const SIZES: readonly OptionsEditorOption[] = ['Small', 'Medium', 'Large'].map((label) => ({
  id: label.toLowerCase(),
  label,
  hue: 'gray',
  isArchived: false,
}));

const STAGES: readonly OptionsEditorOption[] = [
  { id: 'not-started', label: 'Not started', hue: 'gray', isArchived: false, outcome: 'open' },
  { id: 'in-progress', label: 'In progress', hue: 'blue', isArchived: false, outcome: 'open', targetDays: 14 },
  { id: 'done', label: 'Done', hue: 'green', isArchived: false, outcome: 'won' },
];

interface SampleProps {
  readonly kind?: 'select' | 'status' | 'choice';
  readonly initial?: readonly OptionsEditorOption[];
  readonly limit?: number;
  readonly isReadOnly?: boolean;
  readonly startsWithBlank?: boolean;
  readonly labelMaxLength?: number;
  /** Before create: Remove instead of Archive and Restore. */
  readonly isDraft?: boolean;
  readonly pending?: readonly string[];
  readonly errors?: Readonly<Record<string, string>>;
  readonly onAdd?: (option: OptionsEditorOption) => void;
  readonly onChange?: (id: string, change: OptionsEditorChange) => void;
  readonly onMove?: (id: string, position: number) => void;
  readonly onArchive?: (id: string) => void;
}

/** The editor holding its own options, as AttributeSettings does before create. */
function SampleOptions({
  kind = 'select',
  initial = TIERS,
  limit = 500,
  isReadOnly = false,
  startsWithBlank = false,
  labelMaxLength,
  isDraft = false,
  pending = [],
  errors = {},
  onAdd,
  onChange,
  onMove,
  onArchive,
}: SampleProps) {
  const [options, setOptions] = useState(initial);
  const made = useRef(0);
  const set = (id: string, change: Partial<OptionsEditorOption>) => {
    setOptions((before) => before.map((option) => (option.id === id ? { ...option, ...change } : option)));
  };
  return (
    <Stage width="narrow">
      <OptionsEditor
        label={kind === 'status' ? 'Stages' : kind === 'choice' ? 'Choices' : 'Options'}
        kind={kind}
        options={options}
        limit={limit}
        isReadOnly={isReadOnly}
        startsWithBlank={startsWithBlank}
        {...(labelMaxLength === undefined ? {} : { labelMaxLength })}
        pending={new Set(pending)}
        errors={errors}
        newId={() => {
          made.current += 1;
          return `new-${String(made.current)}`;
        }}
        onAdd={(option) => {
          setOptions((before) => [...before, option]);
          onAdd?.(option);
        }}
        onChange={(id, change) => {
          const { targetDays, ...rest } = change;
          set(id, { ...rest, ...(targetDays === undefined ? {} : targetDays === null ? {} : { targetDays }) });
          onChange?.(id, change);
        }}
        onMove={(id, position) => {
          setOptions((before) => {
            const moving = before.find((option) => option.id === id);
            if (moving === undefined) return before;
            const rest = before.filter((option) => option.id !== id);
            return [...rest.slice(0, position), moving, ...rest.slice(position)];
          });
          onMove?.(id, position);
        }}
        {...(isDraft
          ? {
              onRemove: (id: string) => {
                setOptions((before) => before.filter((option) => option.id !== id));
              },
            }
          : {
              onArchive: (id: string) => {
                set(id, { isArchived: true });
                onArchive?.(id);
              },
              onRestore: (id: string) => {
                set(id, { isArchived: false });
              },
            })}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/OptionsEditor',
  component: SampleOptions,
} satisfies Meta<typeof SampleOptions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A select's options: each a colour, a label and a menu, moved by its handle; "3 of 500"; archived ones folded away. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('grid', { name: 'Options' })).toBeInTheDocument();
    await expect(canvas.getAllByRole('row')).toHaveLength(3);
    await expect(canvas.getByText('3 of 500')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Gold colour: Yellow' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /Archived/ })).toHaveAttribute('aria-expanded', 'false');
  },
};

/** A status attribute's stages: each also an outcome and a target in days. */
export const Stages: Story = {
  args: { kind: 'status', initial: STAGES, onChange: fn() },
  play: async ({ args, canvas, userEvent }) => {
    const days = canvas.getByRole('textbox', { name: 'Done target days' });
    await userEvent.click(days);
    await userEvent.keyboard('30{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('done', { targetDays: 30 });
    await expect(canvas.getByRole('textbox', { name: 'In progress target days' })).toHaveValue('14');
  },
};

/** Days must be whole, from 1 to 365: anything else is refused on the field, and nothing is sent. */
export const DaysRefused: Story = {
  args: { kind: 'status', initial: STAGES, onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Done target days' }));
    await userEvent.keyboard('400{Enter}');
    await expect(await canvas.findByText('Give whole days from 1 to 365, or leave it empty.')).toBeInTheDocument();
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

/** A new select starts with one blank row: type, Enter adds it with the next hue, and the next blank row takes focus. */
export const AddByTyping: Story = {
  args: { initial: [], startsWithBlank: true, onAdd: fn() },
  play: async ({ args, canvas, userEvent }) => {
    const first = canvas.getByRole('textbox', { name: 'New option' });
    // It waits for Tab: focus stays where the person was.
    await expect(first).not.toHaveFocus();
    await userEvent.click(first);
    await userEvent.keyboard('Silver{Enter}');
    await expect(args.onAdd).toHaveBeenCalledWith({ id: 'new-1', label: 'Silver', hue: 'gray', isArchived: false });
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'New option' })).toHaveFocus());
    await userEvent.keyboard('Gold{Enter}');
    await expect(args.onAdd).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'Gold', hue: 'red' }));
    // Esc leaves the blank row; focus goes to Add option.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Add option' })).toHaveFocus());
  },
};

/** A label a live option already has (ignoring case) is refused on the row, and nothing is added. */
export const LabelTaken: Story = {
  args: { onAdd: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add option' }));
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'New option' })).toHaveFocus());
    await userEvent.keyboard('gold{Enter}');
    await expect(
      await canvas.findByText('An option with that label already exists. Pick another label.'),
    ).toBeInTheDocument();
    await expect(args.onAdd).not.toHaveBeenCalled();
  },
};

/** Renaming: the label commits on Enter or as focus leaves; Esc puts it back. */
export const Rename: Story = {
  args: { onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    const gold = canvas.getByRole('textbox', { name: 'Option 2' });
    await userEvent.tripleClick(gold);
    await userEvent.keyboard('Golden{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('gold', { label: 'Golden' });
    const silver = canvas.getByRole('textbox', { name: 'Option 1' });
    await userEvent.tripleClick(silver);
    await userEvent.keyboard('Steel{Escape}');
    await expect(silver).toHaveValue('Silver');
  },
};

/** By keyboard: Enter on a handle picks the option up, the arrows choose where, Enter drops it. */
export const ReorderByKeyboard: Story = {
  args: { onMove: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    // Into the list (its first row), down to Platinum's row, then Tab to its handle.
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await userEvent.tab();
    const handle = canvas.getByRole('button', { name: 'Move Platinum' });
    await waitFor(() => expect(handle).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    // React Aria starts the drag on the next frame, moving focus to the first place it can land.
    await waitFor(() => expect(handle).not.toHaveFocus());
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(args.onMove).toHaveBeenCalledWith('platinum', 0));
  },
};

/** The row's menu: Move up says where it went; Archive folds the option into Archived, and Restore brings it back. */
export const MenuMoveAndArchive: Story = {
  args: { onMove: fn(), onArchive: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Actions for Gold' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move up' }));
    await expect(args.onMove).toHaveBeenCalledWith('gold', 0);
    await expect(canvas.getByRole('status')).toHaveTextContent('Gold moved to 1 of 3.');
    await userEvent.click(canvas.getByRole('button', { name: 'Actions for Silver' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await expect(args.onArchive).toHaveBeenCalledWith('silver');
    await expect(canvas.getAllByRole('row')).toHaveLength(2);
    await userEvent.click(canvas.getByRole('button', { name: /Archived/ }));
    await expect(canvas.getAllByRole('button', { name: 'Restore' })).toHaveLength(2);
  },
};

/** Before create: the row menu removes a draft option rather than archiving it. */
export const Draft: Story = {
  args: { isDraft: true, initial: TIERS.filter((option) => !option.isArchived) },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Actions for Silver' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    await expect(canvas.getAllByRole('row')).toHaveLength(2);
  },
};

/** At the limit: Add option is off, the note says why, and Restore waits for room. */
export const Full: Story = {
  args: { limit: 3 },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Add option' })).toBeDisabled();
    await expect(canvas.getByText('An attribute holds at most 3 options. Archive one to add another.')).toBeVisible();
  },
};

/** A change with the server spins on its row; a refusal shows on the row's label. */
export const PendingAndRefused: Story = {
  args: {
    pending: ['gold'],
    errors: { platinum: 'An option with that label already exists. Pick another label.' },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('progressbar', { name: 'Saving' })).toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: 'Option 3' })).toHaveAttribute('aria-invalid', 'true');
  },
};

/** Nothing yet: what goes here, and Add option. */
export const Empty: Story = {
  args: { initial: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No options yet')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Add option' })).toBeEnabled();
  },
};

/** Read only (a member, a system attribute): the options as tags, a stage's outcome as words, nothing to change. */
export const ReadOnly: Story = {
  args: { kind: 'status', initial: STAGES, isReadOnly: true },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Add stage' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: /^Move / })).toBeNull();
    await expect(canvas.getByText('Open, 14 days target')).toBeInTheDocument();
  },
};

/** A refused add whose row is gone says why beside Add option, naming what was typed. */
export const AddRefused: Story = {
  args: { errors: { new: 'Couldn’t add “Gold”. An attribute holds at most 500 options.' } },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('Couldn’t add “Gold”.');
  },
};

/** Restore moves focus to the next archived option's Restore, else to Add option, as its button leaves. */
export const RestoreKeepsFocus: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Archived/ }));
    await userEvent.click(canvas.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Add option' })).toHaveFocus());
  },
};

/** Choices (a form question's): no colour or menu, a quiet remove on each row, moved by the handle. */
export const Choices: Story = {
  args: { kind: 'choice', initial: SIZES, isDraft: true, limit: 40 },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.queryByRole('button', { name: /colour$/ })).toBeNull();
    await expect(canvas.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Remove Medium' }));
    await expect(canvas.getAllByRole('row')).toHaveLength(2);
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Choice 2' })).toHaveFocus());
  },
};

/** Typing choices: Enter adds one and the same blank row stays focused for the next; a repeat is refused on the row. */
export const ChoicesByTyping: Story = {
  args: { kind: 'choice', initial: [], isDraft: true, limit: 40, onAdd: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByText('No choices yet')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Add choice' }));
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'New choice' })).toHaveFocus());
    await userEvent.keyboard('North{Enter}');
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'New choice' })).toHaveFocus());
    await userEvent.keyboard('South{Enter}');
    await expect(args.onAdd).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'South' }));
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'New choice' })).toHaveFocus());
    await userEvent.keyboard('north{Enter}');
    await expect(canvas.getByRole('textbox', { name: 'New choice' })).toHaveAccessibleDescription(
      'That choice is already in the list. Type another.',
    );
  },
};

/** Read only choices: their words, with nothing to move, add or remove. */
export const ChoicesReadOnly: Story = {
  args: { kind: 'choice', initial: SIZES, isReadOnly: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Medium')).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Add choice' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: /^Remove/ })).toBeNull();
  },
};

/** A choice question at its limit: Add choice is off and the note says why. */
export const ChoicesFull: Story = {
  args: { kind: 'choice', initial: SIZES, isDraft: true, limit: 3 },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Add choice' })).toBeDisabled();
    await expect(canvas.getByText('A question holds at most 3 choices.')).toBeVisible();
  },
};

/** A new choice question: one blank row waiting for Tab, its placeholder saying what to type, and 80 characters at most. */
export const ChoicesStartBlank: Story = {
  args: { kind: 'choice', initial: [], isDraft: true, limit: 40, startsWithBlank: true, labelMaxLength: 80 },
  play: async ({ canvas }) => {
    const blank = canvas.getByRole('textbox', { name: 'New choice' });
    await expect(blank).not.toHaveFocus();
    await expect(blank).toHaveAttribute('placeholder', 'Type a choice');
    await expect(blank).toHaveAttribute('maxlength', '80');
  },
};
