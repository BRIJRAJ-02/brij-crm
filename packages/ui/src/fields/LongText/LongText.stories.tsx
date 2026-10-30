import type { Meta, StoryObj } from '@storybook/react-vite';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import { AttributeDisplay } from '../AttributeDisplay.tsx';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { expect, fn } from 'storybook/test';

const sample = FIELD_SAMPLES.long_text;

const meta = {
  title: 'Fields/Long text field',
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
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Description' }));
    await userEvent.keyboard('First line{Enter}Second line');
    await userEvent.tab();
    await expect(args.onCommit).toHaveBeenCalledWith('First line\nSecond line');
  },
};

/** On the record panel a long note shows six lines, then Show more. */
export const ClampedOnPanel: Story = {
  render: () => (
    <Stage width="narrow">
      <AttributeDisplay
        attribute={sample.attribute}
        value={Array.from({ length: 12 }, (_, line) => `Line ${String(line + 1)} of the meeting notes.`).join('\n')}
        surface="panel"
      />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const more = await canvas.findByRole('button', { name: 'Show more' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    await expect(canvas.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  },
};
