import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, screen, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Select } from '../../molecules/Select/SelectWithFaces.tsx';
import { attributeOf } from '../../workbench/attributes.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { ViewSettings, type ViewField } from './ViewSettings.tsx';

const FIELDS: readonly ViewField[] = [
  { attribute: attributeOf('text', 'Name'), isShown: true, isLocked: true },
  { attribute: attributeOf('domain', 'Domain'), isShown: true },
  { attribute: attributeOf('status', 'Stage'), isShown: true },
  { attribute: attributeOf('currency', 'ARR'), isShown: false },
  { attribute: attributeOf('actor_reference', 'Owner'), isShown: true },
];

const MANY: readonly ViewField[] = [
  ...FIELDS,
  ...['City', 'Region', 'Industry', 'Founded', 'Employees', 'Twitter'].map((name) => ({
    attribute: attributeOf('text', name),
    isShown: false,
  })),
  { attribute: attributeOf('timestamp', 'Created at', { isSystem: true, isReadOnly: true }), isShown: false },
  { attribute: attributeOf('text', 'Record ID', { isSystem: true, isReadOnly: true }), isShown: false },
];

interface SampleProps {
  readonly isReadOnly?: boolean;
  readonly initial?: readonly ViewField[];
  readonly onChange?: (next: readonly ViewField[]) => void;
  readonly onAdd?: () => void;
  readonly maxShown?: number;
  /** A table's Group by above the columns. */
  readonly withGroupBy?: boolean;
}

/** The settings holding their own fields, as a view's settings popover would. */
function SampleSettings({
  initial = FIELDS,
  onChange,
  onAdd,
  isReadOnly = false,
  maxShown,
  withGroupBy = false,
}: SampleProps) {
  const [fields, setFields] = useState(initial);
  const [groupBy, setGroupBy] = useState<string | null>(null);
  return (
    <Stage width="narrow">
      <ViewSettings
        label="Columns"
        fields={fields}
        isReadOnly={isReadOnly}
        {...(maxShown === undefined ? {} : { maxShown })}
        {...(withGroupBy
          ? {
              header: (
                <Select
                  label="Group by"
                  size="sm"
                  items={[
                    { id: 'none', label: 'None' },
                    { id: 'stage', label: 'Stage', icon: 'circle-dot' },
                  ]}
                  value={groupBy ?? 'none'}
                  onChange={(id) => {
                    setGroupBy(id === 'none' ? null : id);
                  }}
                />
              ),
            }
          : {})}
        {...(onAdd === undefined
          ? {}
          : {
              footer: (
                <Button variant="ghost" icon="plus" onPress={onAdd}>
                  Add attribute
                </Button>
              ),
            })}
        onChange={(next) => {
          setFields(next);
          onChange?.(next);
        }}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/ViewSettings',
  component: SampleSettings,
} satisfies Meta<typeof SampleSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shown in order with Hide on each, the name locked first; Hidden below with Show. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('grid', { name: 'Columns, shown' })).toBeInTheDocument();
    await expect(canvas.getByRole('grid', { name: 'Columns, hidden' })).toBeInTheDocument();
    await expect(canvas.getByRole('img', { name: 'Always shown' })).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Hide Name' })).not.toBeInTheDocument();
    await expect(canvas.queryAllByRole('switch')).toHaveLength(0);
  },
};

/** Show moves a column into Shown, at its place in the view; Hide moves it back. */
export const ShowAndHide: Story = {
  args: { onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Show ARR' }));
    await expect(args.onChange).toHaveBeenCalled();
    await expect(canvas.queryByRole('grid', { name: 'Columns, hidden' })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Hide Owner' }));
    await expect(within(canvas.getByRole('grid', { name: 'Columns, hidden' })).getByText('Owner')).toBeInTheDocument();
  },
};

/** Enter on a hidden row shows it, and focus stays in Hidden's place for the next one. */
export const ShowByKeyboard: Story = {
  args: { initial: MANY, onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    const hidden = canvas.getByRole('grid', { name: 'Columns, hidden' });
    const first = within(hidden).getAllByRole('row')[0];
    if (first === undefined) throw new Error('No hidden rows');
    first.focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onChange).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(hidden).getAllByRole('row')[0]).toHaveFocus());
  },
};

/** System fields (Created at, Record ID) sit apart, under System, after the rest. */
export const SystemFields: Story = {
  args: { initial: MANY },
  play: async ({ canvas }) => {
    const system = canvas.getByRole('grid', { name: 'Columns, system' });
    await expect(within(system).getAllByRole('row')).toHaveLength(2);
    await expect(within(canvas.getByRole('grid', { name: 'Columns, hidden' })).queryByText('Record ID')).toBeNull();
  },
};

/** By keyboard: Enter on a grip lifts the column, the arrows move it, Enter drops it; nothing lands above the locked Name. */
export const ReorderByKeyboard: Story = {
  args: { onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowRight}');
    const handle = canvas.getByRole('button', { name: 'Move Stage' });
    await waitFor(() => expect(handle).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    // Lifted: focus waits on the move itself, away from the list's own arrow keys.
    await waitFor(() => expect(handle).not.toHaveFocus());
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{Enter}');
    const named = (name: string): unknown => {
      const attribute: unknown = expect.objectContaining({ name });
      return expect.objectContaining({ attribute });
    };
    await waitFor(() =>
      expect(args.onChange).toHaveBeenLastCalledWith([
        named('Name'),
        named('Stage'),
        named('Domain'),
        named('ARR'),
        named('Owner'),
      ]),
    );
  },
};

/** Past eight attributes, a search field ("Find a field") narrows every list; Esc clears it. */
export const Search: Story = {
  args: { initial: MANY },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const search = canvas.getByLabelText('Search attributes');
    await expect(search).toHaveAttribute('placeholder', 'Find a field');
    await userEvent.type(search, 'reg');
    await waitFor(() => expect(canvas.getAllByRole('row')).toHaveLength(1));
    await userEvent.type(search, 'zzz');
    await expect(canvas.getByText('No attributes match')).toBeInTheDocument();
  },
};

/** A view you can't edit: the lists show what is shown and hidden, with no Show, Hide or handles. */
export const ReadOnly: Story = {
  args: { isReadOnly: true, onChange: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.queryAllByRole('button', { name: /^(Move|Show|Hide) / })).toHaveLength(0);
    await userEvent.click(within(canvas.getByRole('grid', { name: 'Columns, hidden' })).getByText('ARR'));
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

/** Nothing drops above the locked name: moving Domain up by keyboard stops below it. */
export const NameStaysFirst: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowRight}');
    const handle = canvas.getByRole('button', { name: 'Move Domain' });
    await waitFor(() => expect(handle).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    // Lifted: focus waits on the move itself, away from the list's own arrow keys.
    await waitFor(() => expect(handle).not.toHaveFocus());
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(canvas.getAllByRole('row')[0]).toHaveTextContent('Name'));
  },
};

/** A table's footer: Add attribute under the columns, apart from them after a hairline. */
export const WithFooter: Story = {
  args: { onAdd: fn() },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add attribute' }));
    await expect(args.onAdd).toHaveBeenCalledTimes(1);
  },
};

/**
 * A board's card fields: at most `maxShown` besides the name. Shown counts against the limit, and at it the
 * hidden fields can't be added until one is hidden.
 */
export const AtTheLimit: Story = {
  args: { maxShown: 3 },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('3 of 3')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Show ARR' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Hide Owner' }));
    await expect(canvas.getByText('2 of 3')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Show ARR' })).toBeEnabled();
  },
};

/** A table's Group by above its columns (13 Oct reference batch 4): None, or a status or single select. */
export const WithGroupBy: Story = {
  args: { withGroupBy: true },
  play: async ({ canvas, userEvent }) => {
    const pick = canvas.getByRole('button', { name: /Group by/ });
    await userEvent.click(pick);
    await userEvent.click(await screen.findByRole('option', { name: 'Stage' }));
    await waitFor(() => expect(canvas.getByRole('button', { name: /Group by/ })).toHaveTextContent('Stage'));
  },
};
