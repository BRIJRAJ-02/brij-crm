import type { Meta, StoryObj } from '@storybook/react-vite';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { expect, fn, waitFor } from 'storybook/test';

const sample = FIELD_SAMPLES.location;

const meta = {
  title: 'Fields/Location field',
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
    await userEvent.click(canvas.getByRole('textbox', { name: 'City' }));
    await userEvent.keyboard('London');
    // The country is picked by name, in the provider's language, from a searchable list.
    await userEvent.click(canvas.getByRole('button', { name: /Country/ }));
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', 'Search countries'));
    await userEvent.keyboard('United Kingdom');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(canvas.getByRole('button', { name: /United Kingdom/ })).toBeInTheDocument());
    await userEvent.click(canvas.getByRole('textbox', { name: 'City' }));
    await userEvent.tab({ shift: true });
    await userEvent.click(document.body);
    await expect(args.onCommit).toHaveBeenLastCalledWith({ locality: 'London', countryCode: 'GB' });
  },
};
