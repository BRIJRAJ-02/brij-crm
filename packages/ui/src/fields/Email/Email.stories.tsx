import type { Meta, StoryObj } from '@storybook/react-vite';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import { useState } from 'react';
import { Form } from '../../molecules/Form/Form.tsx';
import { AttributeDisplay } from '../AttributeDisplay.tsx';
import { AttributeEditor } from '../AttributeEditor.tsx';
import type { FieldAttribute } from '../types.ts';
import { expect, fn, screen, waitFor } from 'storybook/test';

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
function SeveralForm({
  onSubmit,
  isSending = false,
  limit,
}: {
  readonly onSubmit: () => void;
  readonly isSending?: boolean;
  readonly limit?: FieldAttribute['limit'];
}) {
  const several = { ...(sample.several?.attribute ?? sample.attribute), ...(limit === undefined ? {} : { limit }) };
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

/** While the form around it sends: the add field and each Remove are off (the chips stay as they are), and nothing is added or removed. */
export const SeveralWhileSending: Story = {
  render: () => <SeveralForm onSubmit={submitted} isSending />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Emails' })).toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: 'Emails' })).toBeDisabled();
    for (const remove of canvas.getAllByRole('button', { name: /^Remove/ })) await expect(remove).toBeDisabled();
  },
};

/** At the list's limit: one more typed is refused in the add field with the caller's words, and what was typed stays. */
export const SeveralAtTheLimit: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <SeveralForm onSubmit={submitted} limit={{ count: 2, message: 'Up to 2 addresses.' }} />,
  play: async ({ canvas, userEvent }) => {
    const add = canvas.getByRole('textbox', { name: 'Emails' });
    await userEvent.click(add);
    await userEvent.keyboard('lovelace@example.org{Enter}');
    await expect(canvas.getByText('Up to 2 addresses.')).toBeInTheDocument();
    await expect(add).toHaveValue('lovelace@example.org');
    await expect(canvas.getByRole('list', { name: 'Emails' }).querySelectorAll('li')).toHaveLength(2);
  },
};

/** On the record panel each address has Copy after it, on hover or focus (always under a finger). */
export const CopyOnPanel: Story = {
  render: () => (
    <Stage>
      <AttributeDisplay attribute={sample.attribute} value={sample.value as never} surface="panel" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Copy ada@example.com' })).toBeInTheDocument();
  },
};

/** What an email client pastes ("Ada <ada@x.com>", "mailto:") reads as the address. */
export const PastedName: Story = {
  parameters: { crm: { screenshot: false } },
  args: { value: null },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Email' }));
    await userEvent.paste('Ada Lovelace <Ada@Example.com>');
    await userEvent.tab();
    await expect(args.onCommit).toHaveBeenCalledWith('ada@example.com');
  },
};

/** Several: a pasted list adds each address; a chip opens Make primary and Edit, never its link. */
export const SeveralPasteAndPrimary: Story = {
  parameters: { crm: { screenshot: false } },
  args: { attribute: sample.several?.attribute ?? sample.attribute, value: ['ada@example.com', 'b@example.com'] },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Emails' }));
    await userEvent.paste('c@example.com, d@example.com');
    await expect(args.onCommit).toHaveBeenCalledWith([
      'ada@example.com',
      'b@example.com',
      'c@example.com',
      'd@example.com',
    ]);
    await userEvent.click(canvas.getByRole('button', { name: 'b@example.com options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Make primary' }));
    await expect(args.onCommit).toHaveBeenLastCalledWith(['b@example.com', 'ada@example.com']);
  },
};

/**
 * Edit puts a value in the add field, focused, and hides its chip: Esc keeps it as it was, and Enter puts the
 * changed value back in its place, not at the end. Make primary keeps focus on the chip it moved.
 */
export const SeveralEditInPlace: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <SeveralForm onSubmit={submitted} />,
  play: async ({ canvas, userEvent }) => {
    const list = () => canvas.getByRole('list', { name: 'Emails' });
    const add = canvas.getByRole('textbox', { name: 'Emails' });
    await userEvent.click(canvas.getByRole('button', { name: 'ada@example.com options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    await waitFor(() => expect(add).toHaveFocus());
    await expect(add).toHaveValue('ada@example.com');
    await expect(list().querySelectorAll('li')).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    await expect(add).toHaveValue('');
    await expect(list().querySelectorAll('li')).toHaveLength(2);

    await userEvent.click(canvas.getByRole('button', { name: 'ada@example.com options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    await waitFor(() => expect(add).toHaveFocus());
    await userEvent.clear(add);
    await userEvent.keyboard('ada@home.example.com{Enter}');
    await expect(list().querySelectorAll('li')[0]).toHaveTextContent('ada@home.example.com');

    await userEvent.click(canvas.getByRole('button', { name: 'ada@work.example.com options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Make primary' }));
    await waitFor(() => expect(canvas.getByRole('button', { name: 'ada@work.example.com options' })).toHaveFocus());
    await expect(list().querySelectorAll('li')[0]).toHaveTextContent('ada@work.example.com');
  },
};
