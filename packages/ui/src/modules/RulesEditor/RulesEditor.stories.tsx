import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import { expect, fn, screen, waitFor } from 'storybook/test';
import type { FieldAttribute } from '../../fields/types.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { editorRuleOf, RulesEditor, type RulesEditorProps, type RulesEditorRule } from './RulesEditor.tsx';

const STAGE: FieldAttribute = {
  id: 'stage',
  name: 'Stage',
  type: 'status',
  allowMultiple: false,
  isRequired: false,
  isUnique: false,
  isReadOnly: false,
  options: [
    { id: 'lead', label: 'Lead', hue: 'gray', archived: false },
    { id: 'won', label: 'Won', hue: 'green', archived: false },
  ],
};

const AMOUNT: FieldAttribute = {
  id: 'amount',
  name: 'Amount',
  type: 'number',
  allowMultiple: false,
  isRequired: false,
  isUnique: false,
  isReadOnly: false,
};

const RULES: readonly RulesEditorRule[] = [
  editorRuleOf({ id: 'short', kind: 'length', params: { min: 3, max: 40 } }),
  editorRuleOf({
    id: 'digits',
    kind: 'pattern',
    params: { preset: 'letters', ignoreCase: false },
    condition: { conjunction: 'and', conditions: [{ attributeId: 'stage', operator: 'is', value: 'won' }] },
  }),
  editorRuleOf({ id: 'own', kind: 'length', params: { max: 80 }, message: 'Keep the reference under 80 characters.' }),
];

type SampleProps = Omit<RulesEditorProps, 'rules' | 'newId' | 'onChange' | 'label' | 'kinds' | 'attribute'> &
  Partial<Pick<RulesEditorProps, 'kinds' | 'attribute'>> & {
    readonly initial?: readonly RulesEditorRule[];
    readonly onChange?: RulesEditorProps['onChange'];
  };

/** The editor holding its own rules, as AttributeSettings does until Save. */
function SampleRules({ initial = RULES, onChange, ...props }: SampleProps) {
  const [rules, setRules] = useState(initial);
  const made = useRef(0);
  return (
    <Stage width="narrow">
      <RulesEditor
        label="Rules"
        kinds={['length', 'pattern']}
        attribute={{ title: 'Reference', type: 'text' }}
        conditionAttributes={[STAGE, AMOUNT]}
        {...props}
        rules={rules}
        newId={() => {
          made.current += 1;
          return `new-${String(made.current)}`;
        }}
        onChange={(next) => {
          setRules(next);
          onChange?.(next);
        }}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/RulesEditor',
  component: SampleRules,
} satisfies Meta<typeof SampleRules>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Each rule reads as the message it gives: generated, with its condition, or its own; "3 of 20". */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('grid', { name: 'Rules' })).toBeInTheDocument();
    await expect(canvas.getAllByRole('row')).toHaveLength(3);
    await expect(canvas.getByText('3 of 20')).toBeInTheDocument();
    await expect(canvas.getByText('Reference needs 3 to 40 characters.')).toBeInTheDocument();
    await expect(canvas.getByText('Reference can only contain letters when Stage is Won.')).toBeInTheDocument();
    await expect(canvas.getByText('Keep the reference under 80 characters.')).toBeInTheDocument();
  },
};

/** No rules yet: a line says any value of the type is accepted, and Add rule offers the type's kinds. */
export const Empty: Story = {
  args: { initial: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No rules yet. Any value of the type is accepted.')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Add rule' })).toBeEnabled();
  },
};

/** Add rule: a kind from the menu adds a row open on its settings, its first field focused; Done closes it. */
export const AddByKeyboard: Story = {
  args: { initial: [], onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add rule' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Length' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    const least = await canvas.findByRole('textbox', { name: 'At least, in characters' });
    await waitFor(() => expect(least).toHaveFocus());
    await userEvent.tab();
    await userEvent.keyboard('12');
    await expect(canvas.getByText('Reference can have at most 12 characters.')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Done' }));
    await expect(canvas.queryByRole('textbox', { name: 'At least, in characters' })).not.toBeInTheDocument();
    await expect(args.onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ kind: 'length', fields: { min: '', max: '12' } }),
    ]);
  },
};

/** A custom pattern, with Ignore case: the row reads "isn't in the required format". */
export const CustomPattern: Story = {
  args: {
    initial: [
      editorRuleOf({
        id: 'code',
        kind: 'pattern',
        params: { preset: 'custom', regex: '[A-Z]{2}-\\d+', ignoreCase: true },
      }),
    ],
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Actions for/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await expect(await canvas.findByRole('textbox', { name: 'Pattern' })).toHaveValue('[A-Z]{2}-\\d+');
    await expect(canvas.getByRole('checkbox', { name: 'Ignore case' })).toBeChecked();
    await expect(canvas.getByText('Reference isn’t in the required format.')).toBeInTheDocument();
  },
};

/** A refused setting opens its rule, the message on the field it names. */
export const Refused: Story = {
  args: {
    errors: { 'rules.1.preset': 'Pick a pattern.', 'rules.0.min': 'The smallest value must not be above the largest.' },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('textbox', { name: 'At least, in characters' })).toHaveAccessibleDescription(
      /The smallest value must not be above the largest\./,
    );
  },
};

/** A condition: Only when… holds the FilterBuilder on the object's own attributes, open when the rule has one. */
export const Condition: Story = {
  args: { initial: [RULES[1] ?? RULES[0]].flatMap((rule) => (rule === undefined ? [] : [rule])) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Actions for/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await expect(await canvas.findByRole('button', { name: 'Only when…' })).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('group', { name: 'Filters' })).toBeInTheDocument();
  },
};

/** The row's menu: Move up says where the rule went, Delete takes it out and focus moves to the next. */
export const MenuMoveAndDelete: Story = {
  args: { onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    const [, second] = canvas.getAllByRole('button', { name: /Actions for/ });
    if (second === undefined) throw new globalThis.Error('no second rule');
    await userEvent.click(second);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move up' }));
    await expect(await canvas.findByText('Rule moved to 1 of 3.')).toBeInTheDocument();
    const [first] = canvas.getAllByRole('button', { name: /Actions for/ });
    if (first === undefined) throw new globalThis.Error('no first rule');
    await userEvent.click(first);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(canvas.getAllByRole('row')).toHaveLength(2));
    await expect(args.onChange).toHaveBeenCalledTimes(2);
  },
};

/** By keyboard: Enter on a handle picks the rule up, the arrows choose where, Enter drops it. */
export const ReorderByKeyboard: Story = {
  args: { onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await userEvent.tab();
    const handle = canvas.getByRole('button', { name: 'Move Keep the reference under 80 characters.' });
    await waitFor(() => expect(handle).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(handle).not.toHaveFocus());
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(args.onChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'own' }),
        expect.objectContaining({ id: 'short' }),
        expect.objectContaining({ id: 'digits' }),
      ]),
    );
  },
};

/** At the limit: Add rule is off and a line says why. */
export const Full: Story = {
  args: {
    limit: 3,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Add rule' })).toBeDisabled();
    await expect(canvas.getByText('An attribute holds at most 3 rules.')).toBeInTheDocument();
  },
};

/** Read only (a member): the rules as sentences, with no handle, menu or Add rule. */
export const ReadOnly: Story = {
  args: { isReadOnly: true },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('row')).toHaveLength(3);
    await expect(canvas.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Add rule' })).not.toBeInTheDocument();
    await expect(canvas.getByText('Only when its conditions are met.')).toBeInTheDocument();
  },
};

/** A date range's settings, open: a fixed earliest day and a latest one counted from today. */
export const EveryKind: Story = {
  args: {
    attribute: { title: 'Close date', type: 'date' },
    kinds: ['date_range'],
    initial: [
      editorRuleOf({
        id: 'dates',
        kind: 'date_range',
        params: { min: { date: '2026-10-01' }, max: { daysFromToday: 30 } },
      }),
    ],
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Actions for/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await expect(await canvas.findByRole('textbox', { name: 'Latest, in days from today' })).toHaveValue('30');
  },
};
