import type { Meta, StoryObj } from '@storybook/react-vite';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import { useState } from 'react';
import { Form } from '../../molecules/Form/Form.tsx';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { expect, fn } from 'storybook/test';

const sample = FIELD_SAMPLES.email;

const meta = {
  title: 'Fields/Email field',
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
    await userEvent.click(canvas.getByRole('textbox', { name: 'Email' }));
    await userEvent.keyboard(' Ada@Example.COM ');
    await userEvent.tab();
    await expect(args.onCommit).toHaveBeenCalledWith('ada@example.com');
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
    await userEvent.click(canvas.getByRole('textbox', { name: 'Email' }));
    await userEvent.keyboard('ada@example');
    await userEvent.tab();
    await expect(canvas.getByText(/with a name and a domain/)).toBeInTheDocument();
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};

/** Empty, in a form: an example address as the placeholder, so the shape to type is plain. */
export const Guidance: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Email' })).toHaveAttribute('placeholder', 'ada@example.com');
  },
};

const submitted = fn();

/** Several emails in a form, as New meeting's Also invite. */
function SeveralForm({ onSubmit, isSending = false }: { readonly onSubmit: () => void; readonly isSending?: boolean }) {
  const several = sample.several?.attribute ?? sample.attribute;
  const [value, setValue] = useState<readonly string[]>(['ada@example.com', 'ada@work.example.com']);
  return (
    <Stage width="narrow">
      <Form label="Invite" submitLabel="Send" onSubmit={onSubmit} isBusy={isSending}>
        <AttributeEditor
          attribute={several}
          value={value}
          surface="form"
          isDisabled={isSending}
          onCommit={(next) => {
            setValue(Array.isArray(next) ? next.filter((item): item is string => typeof item === 'string') : []);
          }}
        />
      </Form>
    </Stage>
  );
}

/**
 * Several values in a form: the name leads, over the chips; Enter with an address typed adds it and never submits
 * the form around it, while Enter in the empty add field still does.
 */
export const SeveralInAForm: Story = {
  render: () => <SeveralForm onSubmit={submitted} />,
  play: async ({ canvas, userEvent }) => {
    submitted.mockClear();
    const list = canvas.getByRole('list', { name: 'Emails' });
    await expect(list.querySelectorAll('li')).toHaveLength(2);
    // The name comes before the chips, as a Field's label comes before its box.
    const name = canvas.getByText('Emails', { selector: 'span' });
    await expect(name.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const add = canvas.getByRole('textbox', { name: 'Emails' });
    await userEvent.click(add);
    await userEvent.keyboard('lovelace@example.org{Enter}');
    await expect(canvas.getByRole('list', { name: 'Emails' }).querySelectorAll('li')).toHaveLength(3);
    await expect(submitted).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    await expect(submitted).toHaveBeenCalledTimes(1);
  },
};

/** While the form around it sends: the chips and the add field show faded, and nothing is added or removed. */
export const SeveralWhileSending: Story = {
  render: () => <SeveralForm onSubmit={submitted} isSending />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Emails' })).toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: 'Emails' })).toBeDisabled();
    for (const remove of canvas.getAllByRole('button', { name: /^Remove/ })) await expect(remove).toBeDisabled();
  },
};
