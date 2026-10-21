import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
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
];

interface SampleProps {
  readonly isReadOnly?: boolean;
  readonly initial?: readonly ViewField[];
  readonly onChange?: (next: readonly ViewField[]) => void;
  readonly onAdd?: () => void;
  readonly maxShown?: number;
}

/** The settings holding their own fields, as a view's settings popover would. */
function SampleSettings({ initial = FIELDS, onChange, onAdd, isReadOnly = false, maxShown }: SampleProps) {
  const [fields, setFields] = useState(initial);
  return (
    <Stage width="narrow">
      <ViewSettings
        label="Columns"
        fields={fields}
        isReadOnly={isReadOnly}
        {...(maxShown === undefined ? {} : { maxShown })}
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

/** A switch per column; the name is always shown and stays first. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('4 of 5 shown')).toBeInTheDocument();
    await expect(canvas.getByText('Always shown')).toBeInTheDocument();
    await expect(canvas.queryByRole('switch', { name: 'Show Name' })).not.toBeInTheDocument();
  },
};

/** A switch shows or hides its column. */
export const ShowAndHide: Story = {
  args: { onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('switch', { name: 'Show ARR' }));
    await expect(args.onChange).toHaveBeenCalled();
    await expect(canvas.getByText('5 of 5 shown')).toBeInTheDocument();
  },
};

/** By keyboard: Enter on a handle picks the column up, the arrows choose where, Enter drops it. */
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
    // React Aria starts the drag on the next frame, moving focus to the first place it can land.
    await waitFor(() => expect(handle).not.toHaveFocus());
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(args.onChange).toHaveBeenCalled());
  },
};

/** Past eight attributes, a search field narrows the list. */
export const Search: Story = {
  args: { initial: MANY },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText('Search attributes'), 'reg');
    await waitFor(() => expect(canvas.getAllByRole('row')).toHaveLength(1));
  },
};

/** A view you can't edit: the switches are read only and there are no handles. */
export const ReadOnly: Story = {
  args: { isReadOnly: true, onChange: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.queryAllByRole('button', { name: /^Move / })).toHaveLength(0);
    await userEvent.click(canvas.getByRole('switch', { name: 'Show ARR' }));
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
    // React Aria starts the drag on the next frame, moving focus to the first place it can land.
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
 * A board's card fields: at most `maxShown` besides the name. The head counts against the limit, and at it the
 * hidden fields' switches are disabled until one is hidden.
 */
export const AtTheLimit: Story = {
  args: { maxShown: 3 },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('3 of 3 shown')).toBeInTheDocument();
    await expect(canvas.getByRole('switch', { name: 'Show ARR' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('switch', { name: 'Show Owner' }));
    await expect(canvas.getByText('2 of 3 shown')).toBeInTheDocument();
    await expect(canvas.getByRole('switch', { name: 'Show ARR' })).toBeEnabled();
  },
};
