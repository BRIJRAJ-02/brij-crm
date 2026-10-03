import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Field } from '../Field/Field.tsx';
import { Form, type FormRefusal, type FormValues } from './Form.tsx';

/** The welcome screen's fields are named by attribute: a refusal's `attributeId` is the field's name. */
const byAttribute = (refusal: FormRefusal) => refusal.attributeId;

const meta = {
  title: 'Molecules/Form',
  component: Form,
  args: {
    submitLabel: 'Create workspace',
    busyLabel: 'Creating workspace',
    onSubmit: fn(),
    fieldFor: byAttribute,
    children: null,
  },
  render: (args) => (
    <Stage width="narrow">
      <Form {...args}>
        <Field label="Workspace name" name="name" defaultValue="Halcyon Labs" />
        <Field label="Web address" name="slug" defaultValue="halcyon-labs" hint="Letters, numbers and dashes." />
      </Form>
    </Stage>
  ),
} satisfies Meta<typeof Form>;

export default meta;
type Story = StoryObj<typeof meta>;

const SLUG_TAKEN: FormRefusal = {
  code: 'SLUG_TAKEN',
  message: 'That address is taken. Try another.',
  attributeId: 'slug',
};

/** Fields stacked, the submit at the end. Enter in a field submits, with each field's text by name. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Workspace name' }));
    await userEvent.keyboard('{Enter}');
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: 'Halcyon Labs', slug: 'halcyon-labs' });
  },
};

/** The server refused a field: `fieldFor` maps the refusal to the field, which shows it and reads as invalid. */
export const FieldRefused: Story = {
  args: { refusals: [SLUG_TAKEN] },
  play: async ({ canvas }) => {
    const slug = canvas.getByRole('textbox', { name: 'Web address' });
    await expect(slug).toHaveAttribute('aria-invalid', 'true');
    await expect(slug).toHaveAccessibleDescription(/That address is taken/);
    await expect(canvas.getByRole('textbox', { name: 'Workspace name' })).not.toHaveAttribute('aria-invalid');
    await expect(canvas.queryByRole('alert')).toBeNull();
  },
};

/** A refusal about no field (or one no field matches) shows above the fields, and is announced. */
export const FormRefused: Story = {
  args: {
    refusals: [
      { code: 'RATE_LIMITED', message: 'Too many tries. Wait a minute, then try again.' },
      { code: 'REQUIRED', message: 'Choose a plan first.', attributeId: 'plan' },
    ],
    fieldFor: (refusal) => (refusal.attributeId === 'slug' ? 'slug' : undefined),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('Too many tries. Wait a minute, then try again.');
    await expect(canvas.getByRole('alert')).toHaveTextContent('Choose a plan first.');
  },
};

/** Waiting for the server: the submit spins with the ongoing verb, and a second submit does nothing. */
export const Busy: Story = {
  args: { isBusy: true },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('button', { name: /Creating workspace/ })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('textbox', { name: 'Workspace name' }));
    await userEvent.keyboard('{Enter}');
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

/** The form can't be sent: the submit is off. */
export const Disabled: Story = {
  args: { isDisabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Create workspace' })).toBeDisabled();
  },
};

/** Buttons in a row at the end, Cancel first, as in a dialog. */
export const WithCancel: Story = {
  args: { actions: <Button>Cancel</Button> },
};

/** Buttons filling the width under the fields, another way to go on under the submit, as on a sign in page. */
export const Stacked: Story = {
  args: { actionsLayout: 'stack', submitLabel: 'Continue', actions: <Button size="lg">Continue with Google</Button> },
  render: (args) => (
    <Stage width="narrow">
      <Form {...args}>
        <Field label="Email" name="email" type="email" />
      </Form>
    </Stage>
  ),
};

function Refusing({ onSubmit }: { readonly onSubmit: (values: FormValues) => void }) {
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  return (
    <Stage width="narrow">
      <Form
        submitLabel="Create workspace"
        refusals={refusals}
        fieldFor={byAttribute}
        onSubmit={(values) => {
          onSubmit(values);
          // A new array with the same refusal each time, as a server would answer.
          setRefusals([{ ...SLUG_TAKEN }]);
        }}
      >
        <Field label="Workspace name" name="name" defaultValue="Halcyon Labs" />
        <Field label="Web address" name="slug" defaultValue="halcyon-labs" />
      </Form>
    </Stage>
  );
}

/** Submitted from the button and refused: focus moves to the refused field. Changing it clears the refusal; the same refusal on the next submit shows again. */
export const RefusalTakesFocus: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => <Refusing onSubmit={args.onSubmit} />,
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Create workspace' }));
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: 'Halcyon Labs', slug: 'halcyon-labs' });
    const slug = canvas.getByRole('textbox', { name: 'Web address' });
    await waitFor(() => expect(slug).toHaveFocus());
    await expect(slug).toHaveAttribute('aria-invalid', 'true');
    await userEvent.keyboard('-hq');
    await userEvent.tab();
    await waitFor(() => expect(slug).not.toHaveAttribute('aria-invalid'));
    await userEvent.click(canvas.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => expect(slug).toHaveAttribute('aria-invalid', 'true'));
  },
};

/** Refused while focus is already in the field (Enter): the refusal is announced. */
export const RefusalAnnounced: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => <Refusing onSubmit={args.onSubmit} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Web address' }));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('That address is taken. Try another.'));
  },
};
