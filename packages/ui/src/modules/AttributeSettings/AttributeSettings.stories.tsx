import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import type { FormRefusal } from '../../molecules/Form/Form.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { AttributeSettings, type AttributeSettingsProps } from './AttributeSettings.tsx';

/** The ten types without setup (spec 0012, milestone 2). */
const WITHOUT_SETUP = [
  'text',
  'long_text',
  'date',
  'checkbox',
  'rating',
  'email',
  'phone',
  'link',
  'location',
  'member',
];

const MEMBERS = [
  { type: 'member' as const, id: '0199a6f2-0000-7000-8000-00000000a001', name: 'Ada Lovelace', email: 'ada@acme.io' },
  { type: 'member' as const, id: '0199a6f2-0000-7000-8000-00000000a002', name: 'Grace Hopper', email: 'grace@acme.io' },
];

type SampleProps = Omit<AttributeSettingsProps, 'isOpen' | 'onOpenChange'>;

/** The dialog open over a page, as a screen opens it; closing it leaves a button to open it again. */
function SampleSettings(props: SampleProps) {
  const [isOpen, setOpen] = useState(true);
  return (
    <Stage>
      <Button
        icon="plus"
        onPress={() => {
          setOpen(true);
        }}
      >
        New attribute
      </Button>
      <AttributeSettings {...props} isOpen={isOpen} onOpenChange={setOpen} />
    </Stage>
  );
}

const meta = {
  title: 'Modules/AttributeSettings',
  component: SampleSettings,
  args: { onSubmit: fn(), typeKeys: WITHOUT_SETUP, members: MEMBERS },
} satisfies Meta<typeof SampleSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

function openDialog() {
  return waitFor(() => {
    const found = document.querySelector<HTMLElement>('[role="dialog"]');
    if (found === null) throw new globalThis.Error('the dialog did not open');
    return found;
  });
}

const inDialog = (dialog: HTMLElement, label: string) => within(dialog).getByLabelText(label);

/**
 * Create: the name first and focused, the API name following it, the type
 * picker with the ten types without setup, Required, Unique for a text, and
 * the default through the type's own editor. Create sends what was chosen.
 */
export const Create: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await expect(dialog).toHaveAccessibleName('New attribute');
    const name = inDialog(dialog, 'Name');
    await waitFor(() => expect(name).toHaveFocus());
    await userEvent.keyboard('Café orders');
    await waitFor(() => expect(inDialog(dialog, 'API name')).toHaveValue('cafe_orders'));
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'text', title: 'Café orders', isMulti: false, defaultValue: undefined }),
      ),
    );
  },
};

/** A name left empty is refused on its field before anything is sent (⌘↵ submits from any field). */
export const NameMissing: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await waitFor(() => expect(inDialog(dialog, 'Name')).toHaveFocus());
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(dialog).toHaveTextContent('Name the attribute.'));
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

/** A date offers no default, a fixed date, or today plus days; a bad number of days is refused on its field. */
export const DateDefault: Story = {
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await userEvent.keyboard('Renewal');
    const type = dialog.querySelector<HTMLElement>('button[aria-haspopup="listbox"]');
    if (type === null) throw new globalThis.Error('No type picker.');
    await userEvent.click(type);
    const date = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (option) => option.textContent === 'Date',
      );
      if (found === undefined) throw new globalThis.Error('No Date option.');
      return found;
    });
    await userEvent.click(date);
    const plusDays = await waitFor(() => within(dialog).getByRole('radio', { name: 'Today plus days' }));
    await userEvent.click(plusDays);
    const days = await waitFor(() => inDialog(dialog, 'Days from today'));
    await userEvent.clear(days);
    await userEvent.type(days, '9999');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(dialog).toHaveTextContent('Give a whole number of days from 0 to 3,650.'));
    await userEvent.clear(days);
    await userEvent.type(days, '7');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'date', defaultValue: { kind: 'offset', duration: 'P7D' } }),
      ),
    );
  },
};

/**
 * Edit: the type, Allow multiple and the API name read only (with a copy
 * button), the rest as they are, and Save. Only what changed is marked.
 */
export const Edit: Story = {
  args: {
    attribute: {
      type: 'email',
      isMulti: true,
      title: 'Email addresses',
      apiSlug: 'email_addresses',
      description: 'Where we write to them.',
      isRequired: false,
      isUnique: true,
    },
  },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await expect(dialog).toHaveAccessibleName('Edit attribute');
    await expect(dialog).toHaveTextContent('Changing the type comes later.');
    await expect(inDialog(dialog, 'Copy the API name')).toBeInTheDocument();
    await waitFor(() => expect(inDialog(dialog, 'Name')).toHaveFocus());
    await userEvent.keyboard(' (work)');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Email addresses (work)', isUnique: true, changed: ['title'] }),
      ),
    );
  },
};

/** A Member's default: none, the member who creates the record, or a chosen member. */
export const MemberDefault: Story = {
  args: {
    attribute: {
      type: 'actor_reference',
      isMulti: false,
      title: 'Account manager',
      apiSlug: 'account_manager',
      isRequired: true,
      isUnique: false,
      defaultValue: { kind: 'current_user' },
    },
  },
};

const REFUSED: readonly FormRefusal[] = [
  {
    code: 'SLUG_TAKEN',
    message: 'An attribute here already uses this API name. Pick another.',
    attributeId: 'apiSlug',
  },
  { code: 'LIMIT_REACHED', message: 'An object holds at most 250 attributes.' },
];

/** The server's refusals: on the API name it names, and the limit above the settings. */
export const Refused: Story = {
  args: { refusals: REFUSED },
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveTextContent('An attribute here already uses this API name. Pick another.');
    await expect(dialog).toHaveTextContent('An object holds at most 250 attributes.');
  },
};

/** Waiting for the server: Create spins with its ongoing verb, and the dialog stays. */
export const Busy: Story = {
  args: { isBusy: true },
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveTextContent('Creating attribute');
  },
};

/** A system attribute, or a member: every setting read only with the reason, and Close alone. */
export const ReadOnly: Story = {
  args: {
    readOnlyReason: 'Created at is set by the system.',
    attribute: {
      type: 'timestamp',
      isMulti: false,
      title: 'Created at',
      apiSlug: 'created_at',
      isRequired: false,
      isUnique: false,
    },
  },
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveAccessibleName('Attribute settings');
    await expect(dialog.querySelector('button[type="submit"]')).toBeNull();
  },
};

const chooseRelationship = fn();

/** With #15's entry: "Relationship" last in the picker, handing the dialog over when chosen. */
export const RelationshipEntry: Story = {
  parameters: { crm: { screenshot: false } },
  args: { relationshipEntry: { label: 'Relationship', onChoose: chooseRelationship } },
  play: async ({ userEvent }) => {
    const dialog = await openDialog();
    const type = dialog.querySelector<HTMLElement>('button[aria-haspopup="listbox"]');
    if (type === null) throw new globalThis.Error('No type picker.');
    await userEvent.click(type);
    const options = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
      if (found.length === 0) throw new globalThis.Error('No options.');
      return found;
    });
    await expect(options.map((option) => option.textContent)).toEqual([
      'Text',
      'Long text',
      'Date',
      'Checkbox',
      'Rating',
      'Email',
      'Phone',
      'Link',
      'Location',
      'Member',
      'Relationship',
    ]);
    const last = options.at(-1);
    if (last === undefined) throw new globalThis.Error('No Relationship.');
    await userEvent.click(last);
    await waitFor(() => expect(chooseRelationship).toHaveBeenCalledOnce());
  },
};
