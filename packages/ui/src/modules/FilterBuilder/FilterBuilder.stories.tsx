import type { FilterGroup } from '@crm/contracts/values';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import type { FieldAttribute } from '../../fields/types.ts';
import { attributeOf } from '../../workbench/attributes.ts';
import { SAMPLE_MEMBERS, SAMPLE_STAGES, SAMPLE_TAGS } from '../../workbench/field-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { arraySource } from '../../lib/list-source.ts';
import { FilterBuilder } from './FilterBuilder.tsx';

const ATTRIBUTES: readonly FieldAttribute[] = [
  attributeOf('status', 'Stage', { options: SAMPLE_STAGES }),
  attributeOf('select', 'Segment', { options: SAMPLE_TAGS }),
  attributeOf('currency', 'Value', { defaultCurrency: 'USD' }),
  attributeOf('actor_reference', 'Owner'),
  attributeOf('date', 'Close date'),
  attributeOf('timestamp', 'Created', { isReadOnly: true }),
  attributeOf('record_reference', 'Company', { cardinality: 'one' }),
];

const COMPANY_ATTRIBUTES: readonly FieldAttribute[] = [
  attributeOf('text', 'Name'),
  attributeOf('location', 'Location'),
];

const FILTERS: FilterGroup = {
  conjunction: 'and',
  conditions: [
    { attributeId: 'stage', operator: 'is_any_of', values: ['proposal', 'won'] },
    { attributeId: 'value', operator: 'gt', value: { amount: '10000', currency: 'USD' } },
    {
      conjunction: 'or',
      conditions: [
        { attributeId: 'owner', operator: 'is_me' },
        { attributeId: 'created', operator: 'within_last', range: { amount: 7, unit: 'day' } },
      ],
    },
    {
      operator: 'through',
      path: ['company'],
      condition: { attributeId: 'location', operator: 'country_is', value: 'GB' },
    },
  ],
};

interface SampleBuilderProps {
  readonly initial?: FilterGroup;
  readonly isReadOnly?: boolean;
  readonly isNarrow?: boolean;
  readonly onChange?: (next: FilterGroup) => void;
}

/** The builder holding its own filters, as a view's filter popover would. */
function SampleBuilder({ initial = FILTERS, isReadOnly = false, isNarrow = false, onChange }: SampleBuilderProps) {
  const [value, setValue] = useState(initial);
  const me = SAMPLE_MEMBERS[0];
  return (
    <Stage {...(isNarrow ? { width: 'narrow' as const } : {})}>
      <FilterBuilder
        attributes={ATTRIBUTES}
        relatedAttributes={(relation) => (relation.id === 'company' ? COMPANY_ATTRIBUTES : undefined)}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        editorProps={(attribute) =>
          attribute.type === 'actor_reference'
            ? {
                onSearch: () => arraySource(SAMPLE_MEMBERS, (member) => member.id ?? member.name) as never,
                ...(me === undefined ? {} : { me }),
              }
            : {}
        }
        isReadOnly={isReadOnly}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/FilterBuilder',
  component: SampleBuilder,
} satisfies Meta<typeof SampleBuilder>;

export default meta;
type Story = StoryObj<typeof meta>;

/** "Where", then and; a group joined by or; and a condition through a relation, Company › Location. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Filters' })).toBeInTheDocument();
    await expect(canvas.getByRole('group', { name: 'Filter group 3' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /Company › Location/ })).toBeInTheDocument();
  },
};

/** No filters yet: one button adds the first. */
export const Empty: Story = {
  args: { initial: { conjunction: 'and', conditions: [] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No filters yet')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Add filter' })).toBeInTheDocument();
  },
};

/** Add filter opens the attributes; the row starts with the type's first operator, and its value edits through the field set. */
export const AddAndChoose: Story = {
  args: { initial: { conjunction: 'and', conditions: [] }, onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add filter' }));
    await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    await userEvent.keyboard('Stage');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(canvas.getByRole('button', { name: /^is$/ })).toBeInTheDocument());
    await expect(args.onChange).toHaveBeenLastCalledWith({
      conjunction: 'and',
      conditions: [{ attributeId: 'stage', operator: 'is', value: undefined }],
    });
  },
};

/** The second row chooses and or or for its group; later rows repeat it as a word. */
export const Conjunction: Story = {
  args: { onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getAllByRole('button', { name: /Match/ })[0] as HTMLElement);
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull());
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ conjunction: 'or' }));
  },
};

/** A view you can't change: each filter as a sentence, with nothing to press. */
export const ReadOnly: Story = {
  args: { isReadOnly: true },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Add filter' })).toBeNull();
    await expect(canvas.getByText('is any of')).toBeInTheDocument();
  },
};

/** In a narrow slot, each row's lead sits above its controls. */
export const Narrow: Story = {
  args: { isNarrow: true },
};
