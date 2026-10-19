import type { Meta, StoryObj } from '@storybook/react-vite';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';

const sample = FIELD_SAMPLES.date;

const meta = {
  title: 'Fields/Date field',
  component: AttributeEditor,
  args: { attribute: sample.attribute, value: null, surface: 'form', onCommit: fn() },
} satisfies Meta<typeof AttributeEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The one display, on every surface. */
export const Display: Story = {
  parameters: { crm: { preview: true } },
  render: () => <FieldSurfaces attribute={sample.attribute} value={sample.value} display={sample.display} />,
};

/** Empty: nothing in a cell, a dash elsewhere, and "Empty" for screen readers. */
export const Empty: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <FieldSurfaces attribute={sample.attribute} value={null} />,
};

/** The one editor, in a form: what it commits parses with the type's schema (AC-5). */
export const Editor: Story = {
  args: {},
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ args, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('10202026');
    await expect(args.onCommit).not.toHaveBeenCalled();
    await userEvent.tab();
    await userEvent.tab();
    await waitFor(() => expect(args.onCommit).toHaveBeenCalledWith('2026-10-20'));
    await expect(args.onCommit).toHaveBeenCalledTimes(1);
  },
};

/** The value changes from outside (someone else's edit, a refusal putting it back): the field shows it. */
export const ValueFromOutside: Story = {
  parameters: { crm: { screenshot: false } },
  render: function Render(args) {
    const [value, setValue] = useState<string | null>('2026-10-15');
    return (
      <Stage width="narrow">
        <AttributeEditor {...args} value={value} />
        <Button
          onPress={() => {
            setValue('2026-12-25');
          }}
        >
          Change from outside
        </Button>
      </Stage>
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Change from outside' }));
    await waitFor(() => expect(canvas.getAllByRole('spinbutton', { name: /month/i })[0]).toHaveTextContent('12'));
  },
};
