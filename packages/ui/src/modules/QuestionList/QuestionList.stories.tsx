import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import { Field } from '../../molecules/Field/Field.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { QuestionList, type QuestionListItem } from './QuestionList.tsx';

const QUESTIONS: readonly QuestionListItem[] = [
  { id: 'name', label: 'Your name', typeLabel: 'Short text', isRequired: true, filed: 'Person · Name' },
  { id: 'email', label: 'Work email', typeLabel: 'Email', isRequired: true, filed: 'Person · Email addresses' },
  {
    id: 'budget',
    label: 'Budget',
    typeLabel: 'Dropdown',
    isRequired: false,
    choiceCount: 3,
    filed: 'Person · Budget band',
  },
  { id: 'new', label: '', typeLabel: 'Short text', isRequired: false, filed: 'Not filed, kept with the enquiry' },
];

interface SampleProps {
  readonly initialOpen?: readonly string[];
  readonly isReadOnly?: boolean;
  readonly withProblem?: boolean;
}

/** The list holding its own order and open cards, as the form builder does. */
function SampleQuestions({ initialOpen = [], isReadOnly = false, withProblem = false }: SampleProps) {
  const [items, setItems] = useState(
    withProblem ? QUESTIONS.map((item) => (item.id === 'new' ? { ...item, hasProblem: true } : item)) : QUESTIONS,
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(initialOpen));
  return (
    <Stage width="narrow">
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

/** Closed cards: the handle, the question, its type, Required, its choices and where it is filed. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('grid', { name: 'Questions' })).toBeInTheDocument();
    await expect(canvas.getAllByRole('row')).toHaveLength(4);
    await expect(canvas.getByText('Untitled question')).toBeInTheDocument();
    await expect(canvas.getByText('3 choices')).toBeInTheDocument();
  },
};

/** Pressing a card's header opens its editor; pressing again closes it. */
export const Opening: Story = {
  play: async ({ canvas }) => {
    const toggle = canvas.getByRole('button', { name: /Budget/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'));
    await expect(canvas.getByRole('textbox', { name: 'Question' })).toHaveValue('Budget');
    await userEvent.click(toggle);
    await waitFor(() => expect(canvas.queryByRole('textbox', { name: 'Question' })).toBeNull());
  },
};

/** One card open, its editor under the header. */
export const OneOpen: Story = {
  args: { initialOpen: ['email'] },
};

/** A question a publish refused: marked, with the danger border. */
export const WithProblem: Story = {
  args: { initialOpen: ['new'], withProblem: true },
  parameters: { crm: { screenshot: false } },
};

/** Read only: no handles, the cards still open to read. */
export const ReadOnly: Story = {
  args: { isReadOnly: true },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: /^Move/ })).toBeNull();
  },
};
