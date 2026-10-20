import type { Meta, StoryObj } from '@storybook/react-vite';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { loadPhoneLibrary } from './phone-library.ts';
import { expect, fn, waitFor, within } from 'storybook/test';

const sample = FIELD_SAMPLES.phone;

const meta = {
  title: 'Fields/Phone field',
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

/** Several values: three show, then "+N" opens the rest. */
export const Several: Story = {
  render: () => (
    <FieldSurfaces
      attribute={sample.several?.attribute ?? sample.attribute}
      value={sample.several?.value}
      display={sample.several?.display}
      maxVisible={3}
    />
  ),
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
    await loadPhoneLibrary();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await userEvent.click(canvas.getByRole('textbox', { name: 'Phone' }));
    await userEvent.keyboard('+44 20 7123 4567');
    await userEvent.tab();
    await waitFor(() => expect(args.onCommit).toHaveBeenCalledWith({ number: '+442071234567', country: 'GB' }));
  },
};

/** Invalid input shows how to fix it, and commits nothing. */
export const Invalid: Story = {
  parameters: { crm: { screenshot: false } },
  args: {},
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await loadPhoneLibrary();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await userEvent.click(canvas.getByRole('textbox', { name: 'Phone' }));
    await userEvent.keyboard('12');
    await userEvent.tab();
    await waitFor(() => expect(canvas.getByText(/too short for the country chosen/)).toBeInTheDocument());
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};

/**
 * The hosted form's country code before the number (F38): it starts in the
 * attribute's country, its list searches by name or code, choosing moves
 * focus to the number, and the number is checked for the country chosen.
 */
export const CountryCode: Story = {
  args: {},
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await loadPhoneLibrary();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const code = canvas.getByRole('button', { name: /Country code/ });
    await expect(code).toHaveTextContent('+44');
    await userEvent.click(code);
    const page = within(document.body);
    await userEvent.keyboard('india');
    await userEvent.click(await page.findByRole('option', { name: /^India/ }));
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Phone' })).toHaveFocus());
    await expect(code).toHaveTextContent('+91');
    await userEvent.keyboard('98765 43210');
    await userEvent.tab();
    await waitFor(() => expect(args.onCommit).toHaveBeenCalledWith({ number: '+919876543210', country: 'IN' }));
  },
};

/** A stored number opens with its own country in the picker and the national number in the field. */
export const StoredNumber: Story = {
  parameters: { crm: { screenshot: false } },
  args: { value: { number: '+442071234567', country: 'GB' } },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await loadPhoneLibrary();
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Phone' })).toHaveValue('020 7123 4567'));
    await expect(canvas.getByRole('button', { name: /Country code/ })).toHaveTextContent('+44');
  },
};

/** Several numbers: the same country code before the add field; a number typed with its + code moves the code there. */
export const SeveralWithCode: Story = {
  args: { attribute: sample.several?.attribute ?? sample.attribute, value: null },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await loadPhoneLibrary();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await userEvent.click(canvas.getByRole('textbox', { name: 'Phones' }));
    await userEvent.keyboard('+1 201 555 0123');
    await waitFor(() => expect(canvas.getByRole('button', { name: /Country code/ })).toHaveTextContent('+1'));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(args.onCommit).toHaveBeenCalledWith([{ number: '+12015550123', country: 'US' }]));
  },
};
