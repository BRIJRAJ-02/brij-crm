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
    await expect(canvas.getByText('3 of 20 rules')).toBeInTheDocument();
    await expect(canvas.getByText('Reference needs 3 to 40 characters.')).toBeInTheDocument();
    await expect(canvas.getByText('Reference can only contain letters when Stage is Won.')).toBeInTheDocument();
    await expect(canvas.getByText('Keep the reference under 80 characters.')).toBeInTheDocument();
  },
};

/** No rules yet: a line says any value of the type is accepted, and Add rule offers the type's kinds. */
export const Empty: Story = {
  args: { initial: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No rules yet, so any value is accepted.')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'About Rules' })).toBeInTheDocument();
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
    await userEvent.click(canvas.getByRole('textbox', { name: 'At most, in characters' }));
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

/** A condition: Only use this rule when… holds the FilterBuilder on the object's own attributes, open when the rule has one. */
export const Condition: Story = {
  args: { initial: [RULES[1] ?? RULES[0]].flatMap((rule) => (rule === undefined ? [] : [rule])) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Actions for/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await expect(await canvas.findByRole('button', { name: 'Only use this rule when…' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
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

/** By keyboard: Enter on a grip lifts the rule, the arrows move it, Enter drops it. */
export const ReorderByKeyboard: Story = {
  args: { onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    // The label's ⓘ comes first, then the rules.
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'About Rules' })).toHaveFocus();
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await userEvent.tab();
    const handle = canvas.getByRole('button', { name: 'Move rule 3, Length' });
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
    await expect(canvas.getByText('Reference can only contain letters when Stage is Won.')).toBeInTheDocument();
  },
};

/** A date range's settings, open: a fixed earliest day and a latest one counted from today. */
export const DateRange: Story = {
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

/** Opens the first rule from its menu, as Edit does, and waits for the menu to close. */
async function openFirst(
  canvas: { getAllByRole: (role: string, options: { name: RegExp }) => HTMLElement[] },
  userEvent: { click: (element: Element) => Promise<void> },
) {
  const [menu] = canvas.getAllByRole('button', { name: /Actions for/ });
  if (menu === undefined) throw new globalThis.Error('no rule');
  await userEvent.click(menu);
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
}

/** An email rule's settings: allow or block, and the domains. */
export const EmailDomains: Story = {
  args: {
    attribute: { title: 'Email addresses', type: 'email' },
    kinds: ['pattern', 'email_domain', 'count'],
    initial: [editorRuleOf({ id: 'acme', kind: 'email_domain', params: { mode: 'allow', domains: ['acme.com'] } })],
  },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('Email addresses must be an address at acme.com.')).toBeInTheDocument();
    await openFirst(canvas, userEvent);
    await expect(await canvas.findByRole('textbox', { name: 'Domains' })).toHaveValue('acme.com');
    await expect(canvas.getByRole('radio', { name: 'Only at these domains' })).toBeChecked();
  },
};

/** A phone rule's countries, and a currency rule's codes: one field each, separated by commas. */
export const CountriesAndCurrencies: Story = {
  args: {
    attribute: { title: 'Phone', type: 'phone' },
    kinds: ['phone_country'],
    initial: [editorRuleOf({ id: 'uk', kind: 'phone_country', params: { countries: ['GB', 'IE'] } })],
  },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('Phone must be a number from United Kingdom or Ireland.')).toBeInTheDocument();
    await openFirst(canvas, userEvent);
    await expect(await canvas.findByRole('textbox', { name: 'Countries' })).toHaveValue('GB, IE');
  },
};

/** A number's range and whole numbers: two bounds, and a rule with no settings of its own. */
export const RangeAndWholeNumbers: Story = {
  args: {
    attribute: { title: 'Probability', type: 'number' },
    kinds: ['range', 'integer'],
    initial: [
      editorRuleOf({ id: 'range', kind: 'range', params: { min: '0', max: '100' } }),
      editorRuleOf({ id: 'whole', kind: 'integer', params: {} }),
    ],
  },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('Probability must be between 0 and 100.')).toBeInTheDocument();
    await expect(canvas.getByText('Probability must be a whole number.')).toBeInTheDocument();
    await openFirst(canvas, userEvent);
    await expect(await canvas.findByRole('textbox', { name: 'Largest' })).toHaveValue('100');
  },
};

/** A count of values on a multi select, and a format that starts with given text, case ignored. */
export const CountAndStartsWith: Story = {
  args: {
    attribute: { title: 'Codes', type: 'email' },
    kinds: ['pattern', 'email_domain', 'count'],
    initial: [
      editorRuleOf({ id: 'starts', kind: 'pattern', params: { preset: 'starts_with', text: 'ID-', ignoreCase: true } }),
      editorRuleOf({ id: 'count', kind: 'count', params: { max: 3 } }),
    ],
  },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('Codes must start with “ID-”.')).toBeInTheDocument();
    await expect(canvas.getByText('Codes can hold at most 3 values.')).toBeInTheDocument();
    await openFirst(canvas, userEvent);
    await expect(await canvas.findByRole('textbox', { name: 'Text' })).toHaveValue('ID-');
    await expect(canvas.getByRole('checkbox', { name: 'Ignore case' })).toBeChecked();
  },
};

/** A new Format rule picks no format: it reads as unfinished until one is chosen, and refuses nothing meanwhile. */
export const NewFormat: Story = {
  args: { initial: [] },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add rule' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Format' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await expect(canvas.getByText('Not set up yet.')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-haspopup')).toBe('listbox'));
  },
};

/** A rule with its own message and a condition: a line under it says when it applies. */
export const OwnMessageWithCondition: Story = {
  args: {
    initial: [
      editorRuleOf({
        id: 'won',
        kind: 'length',
        params: { max: 12 },
        message: 'Keep won references short.',
        condition: { conjunction: 'and', conditions: [{ attributeId: 'stage', operator: 'is', value: 'won' }] },
      }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Only when Stage is Won')).toBeInTheDocument();
  },
};
