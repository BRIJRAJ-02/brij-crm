import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { QuestionList, type QuestionListItem } from './QuestionList.tsx';

const QUESTIONS: readonly QuestionListItem[] = [
  {
    id: 'name',
    label: 'Your name',
    typeLabel: 'Short text',
    typeIcon: 'type',
    isRequired: true,
    filed: 'Person › Name',
  },
  {
    id: 'email',
    label: 'Work email',
    typeLabel: 'Email',
    typeIcon: 'mail',
    isRequired: true,
    filed: 'Person › Email addresses',
  },
  {
    id: 'budget',
    label: 'Budget',
    typeLabel: 'Dropdown',
    typeIcon: 'chevrons-up-down',
    isRequired: false,
    choiceCount: 3,
    filed: 'Person › Budget band',
  },
  {
    id: 'new',
    label: '',
    typeLabel: 'Short text',
    typeIcon: 'type',
    isRequired: false,
    filed: 'Not filed, kept with the submission',
  },
];

interface SampleProps {
  readonly initialOpen?: readonly string[];
  readonly isReadOnly?: boolean;
  readonly withProblem?: boolean;
  /** `fill` shows the builder's full width; `narrow-fill` a phone's column, where the second line wraps. */
  readonly width?: 'narrow-fill' | 'fill';
  /** No questions yet: the header alone. */
  readonly isEmpty?: boolean;
}

/** The list holding its own order and open questions, as the form builder does. */
function SampleQuestions({
  initialOpen = [],
  isReadOnly = false,
  withProblem = false,
  width = 'fill',
  isEmpty = false,
}: SampleProps) {
  const [items, setItems] = useState(
    isEmpty
      ? []
      : withProblem
        ? QUESTIONS.map((item) => (item.id === 'new' ? { ...item, hasProblem: true } : item))
        : QUESTIONS,
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(initialOpen));
  return (
    <Stage width={width}>
      <QuestionList
        label="Questions"
        items={items}
        openIds={open}
        onOpenChange={(id, isOpen) => {
          setOpen((before) => {
            const next = new Set(before);
            if (isOpen) next.add(id);
            else next.delete(id);
            return next;
          });
        }}
        renderOpen={(id) => (
          <Field
            label="Question"
            placeholder="What do you want to ask?"
            value={items.find((item) => item.id === id)?.label ?? ''}
            onChange={(label) => {
              setItems((before) => before.map((item) => (item.id === id ? { ...item, label } : item)));
            }}
          />
        )}
        renderFooterStart={(id) => (
          <Checkbox
            label="Visitors must answer"
            isSelected={items.find((item) => item.id === id)?.isRequired ?? false}
            isReadOnly={isReadOnly}
            onChange={(isRequired) => {
              setItems((before) => before.map((item) => (item.id === id ? { ...item, isRequired } : item)));
            }}
          />
        )}
        renderFooter={() =>
          isReadOnly ? null : (
            <>
              <Button variant="ghost" size="lg" icon="copy" label="Duplicate" />
              <Button variant="ghost-danger" size="lg" icon="trash" label="Delete" />
            </>
          )
        }
        {...(isReadOnly
          ? {}
          : {
              onMove: (id: string, index: number) => {
                setItems((before) => {
                  const moving = before.find((item) => item.id === id);
                  if (moving === undefined) return before;
                  const rest = before.filter((item) => item.id !== id);
                  return [...rest.slice(0, index), moving, ...rest.slice(index)];
                });
              },
            })}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/QuestionList',
  component: SampleQuestions,
} satisfies Meta<typeof SampleQuestions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Closed questions at the builder's width, two lines each: a type tile, the question with Required, then the type, its choices and where it is filed. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('grid', { name: 'Questions' })).toBeInTheDocument();
    await expect(canvas.getAllByRole('row')).toHaveLength(4);
    await expect(canvas.getByText('Untitled question')).toBeInTheDocument();
    await expect(canvas.getByText(/Person › Budget band/)).toBeInTheDocument();
  },
};

/** Pressing a question's head opens its editor; pressing again closes it. */
export const Opening: Story = {
  play: async ({ canvas }) => {
    const toggle = canvas.getByRole('button', { name: /^Budget/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'));
    await expect(canvas.getByRole('textbox', { name: 'Question' })).toHaveValue('Budget');
    await userEvent.click(toggle);
    await waitFor(() => expect(canvas.queryByRole('textbox', { name: 'Question' })).toBeNull());
  },
};

/** One question open, its head filled, its editor under it, and its footer row: Required at the start, Duplicate and Delete at the end. */
export const OneOpen: Story = {
  args: { initialOpen: ['email'] },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('checkbox', { name: 'Visitors must answer' })).toBeChecked();
    await expect(canvas.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
  },
};

/** A question a publish refused: the danger edge, and Needs a fix by its title. */
export const WithProblem: Story = {
  args: { initialOpen: ['new'], withProblem: true },
  parameters: { crm: { screenshot: false } },
};

/** Read only: no handles, the questions still open to read. */
export const ReadOnly: Story = {
  args: { isReadOnly: true },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: /^Move/ })).toBeNull();
  },
};

/** In a narrow column (a phone): the second line wraps rather than cutting where it is filed. */
export const Narrow: Story = {
  args: { width: 'narrow-fill' },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('row')).toHaveLength(4);
    await expect(canvas.getAllByRole('row')[0]?.getBoundingClientRect().width).toBeGreaterThan(200);
    await expect(canvas.getByText(/Person › Budget band/)).toBeVisible();
  },
};

/** By keyboard: Tab reaches the first handle, which shows in its tile's place at once; Enter, an arrow and Enter move the question, and the move is said. */
export const KeyboardReorder: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const handle = canvas.getByRole('button', { name: 'Move Your name' });
    // Tab enters the list on its first question, then reaches its handle.
    for (let step = 0; step < 4 && document.activeElement !== handle; step += 1) await userEvent.tab();
    await expect(handle).toHaveFocus();
    await waitFor(() => expect(getComputedStyle(handle.parentElement ?? handle).opacity).toBe('1'));
    await userEvent.keyboard('{Enter}');
    // Lifted: focus waits on the move itself, away from the list's own arrow keys.
    await waitFor(() => expect(handle).not.toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Enter}');
    // The drag wrapper's live region sits at the end of the page, outside the story's canvas.
    await waitFor(() =>
      expect(within(document.body).getByText('Your name, moved to position 2 of 4.')).toBeInTheDocument(),
    );
  },
};

/** No questions yet: the header alone, its count at 0. */
export const Empty: Story = {
  args: { isEmpty: true },
  play: async ({ canvas }) => {
    await expect(canvas.queryAllByRole('row')).toHaveLength(0);
    await expect(canvas.getByRole('heading', { name: 'Questions' })).toBeInTheDocument();
  },
};
