import type { Meta, StoryObj } from '@storybook/react-vite';
import { useId, useState } from 'react';
import { expect, fn, screen, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import type { FormRefusal } from '../../molecules/Form/Form.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { relationshipStep } from '../RelationshipSettings/RelationshipSettings.tsx';
import { AttributeSettings, type AttributeSettingsProps } from './AttributeSettings.tsx';
import { typeChangeStep, type TypeChangeStepProps } from './TypeChangeStep.tsx';

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
 * Create: the name first and focused, the type picker with the ten types
 * without setup, and the rest folded under More settings: Required, Unique for a text, and
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
    // The API name is made from the name: no field for it on create.
    await expect(within(dialog).queryByLabelText('API name')).toBeNull();
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
    await userEvent.click(within(dialog).getByRole('button', { name: 'More settings' }));
    const plusDays = await waitFor(() => within(dialog).getByRole('radio', { name: 'Today plus days' }));
    await userEvent.click(plusDays);
    const days = await waitFor(() => inDialog(dialog, 'Days from today'));
    await userEvent.clear(days);
    await userEvent.type(days, '9999');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(dialog).toHaveTextContent('A whole number, 0 to 3,650.'));
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

const restoreArchived = fn();

/**
 * A name an archived attribute holds: Create quietly takes the next free API name (`price_2`), with a quiet way to
 * restore the archived one instead. A name a live attribute holds is refused on the name.
 */
export const ArchivedApiName: Story = {
  args: {
    apiNames: { live: new Set(['name']), archived: new Set(['price']), onRestore: restoreArchived },
  },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await waitFor(() => expect(inDialog(dialog, 'Name')).toHaveFocus());
    await userEvent.keyboard('Price');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore the archived Price' }));
    await expect(restoreArchived).toHaveBeenCalledWith('price');
    await userEvent.click(inDialog(dialog, 'Name'));
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Price', apiSlug: 'price_2' })),
    );
    await userEvent.clear(inDialog(dialog, 'Name'));
    await userEvent.keyboard('Name');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(dialog).toHaveTextContent('Name taken here. Pick another.'));
  },
};

/** Unique refused for values records share: the reason on Unique, and the way to the table under it. */
export const UniqueDuplicates: Story = {
  args: {
    attribute: {
      type: 'text',
      isMulti: false,
      title: 'Code',
      apiSlug: 'code',
      isRequired: false,
      isUnique: true,
    },
    refusals: [
      {
        code: 'UNIQUE_HAS_DUPLICATES',
        message: 'Code can’t be unique yet: 3 values are used by more than one record. Merge or change them first.',
        attributeId: 'isUnique',
      },
    ],
    duplicatesLink: { label: 'Open Contracts', href: '/w/acme/objects/contracts' },
  },
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveTextContent('3 values are used by more than one record');
    await expect(within(dialog).getByRole('link', { name: 'Open Contracts' })).toBeInTheDocument();
  },
};

/** A Required When set through the API: one read only line under the rules, which the dialog never edits. */
export const RulesNote: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    attribute: {
      type: 'date',
      isMulti: false,
      title: 'Close date',
      apiSlug: 'close_date',
      isRequired: false,
      isUnique: false,
    },
    rulesNote: 'Required when Stage matches (set through the API).',
  },
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveTextContent('Required when Stage matches (set through the API).');
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

/** With #15's entry: "Relationship" last in the picker, handing the dialog over when chosen, with the name typed so far. */
export const RelationshipEntry: Story = {
  parameters: { crm: { screenshot: false } },
  args: { relationshipEntry: { label: 'Relationship', onChoose: chooseRelationship } },
  play: async ({ userEvent }) => {
    const dialog = await openDialog();
    await waitFor(() => expect(inDialog(dialog, 'Name')).toHaveFocus());
    await userEvent.keyboard('Investors');
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
    await expect(chooseRelationship).toHaveBeenCalledWith({ title: 'Investors' });
    // The list has gone (its exit fade over) before the story ends.
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
  },
};

/** The attribute dialog handing over to RelationshipSettings' step in its own Modal, as the screen wires it. */
function HandOver(props: SampleProps) {
  const [isOpen, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ readonly title: string } | undefined>(undefined);
  const formId = useId();
  const step =
    draft === undefined
      ? undefined
      : relationshipStep({
          formId,
          mode: 'create',
          objects: [
            {
              id: '0199a6f2-0000-7000-8000-0000000c0001',
              singularName: 'Company',
              pluralName: 'Companies',
              icon: 'building',
              hue: 'purple',
            },
            {
              id: '0199a6f2-0000-7000-8000-0000000c0002',
              singularName: 'Person',
              pluralName: 'People',
              icon: 'user',
              hue: 'blue',
            },
          ],
          from: { objectId: '0199a6f2-0000-7000-8000-0000000c0001', title: draft.title },
          onSubmit: () => undefined,
        });
  return (
    <Stage>
      <Button
        icon="plus"
        onPress={() => {
          setDraft(undefined);
          setOpen(true);
        }}
      >
        Add attribute
      </Button>
      <AttributeSettings
        {...props}
        isOpen={isOpen}
        onOpenChange={setOpen}
        relationshipEntry={{ label: 'Relationship', onChoose: setDraft }}
        {...(step === undefined ? {} : { step })}
      />
    </Stage>
  );
}

/**
 * Relationship chosen: RelationshipSettings' step takes the dialog's place in
 * the same Modal, with the name typed so far, and Esc puts focus back on what
 * opened the dialog (spec 0014).
 */
export const RelationshipHandOver: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => <HandOver {...args} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add attribute' }));
    const dialog = await openDialog();
    await waitFor(() => expect(inDialog(dialog, 'Name')).toHaveFocus());
    await userEvent.keyboard('Investors');
    const type = dialog.querySelector<HTMLElement>('button[aria-haspopup="listbox"]');
    if (type === null) throw new globalThis.Error('No type picker.');
    await userEvent.click(type);
    const relationship = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (option) => option.textContent === 'Relationship',
      );
      if (found === undefined) throw new globalThis.Error('No Relationship option.');
      return found;
    });
    await userEvent.click(relationship);
    // The same dialog, now the relationship's: the related object has focus, the name typed is this side's.
    await waitFor(() => expect(dialog).toHaveAccessibleName('New relationship'));
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-haspopup')).toBe('listbox'));
    await expect(dialog.isConnected).toBe(true);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Add attribute' })).toHaveFocus());
  },
};

/** Ids for new options in the stories: the screen mints UUIDs v7; here they only need to differ. */
const optionIds = () => {
  const made = { count: 0 };
  return () => {
    made.count += 1;
    return `0199a6f2-0000-7000-8000-${String(made.count).padStart(12, '0')}`;
  };
};

/** Picks a type by its picker label. */
async function chooseType(
  dialog: HTMLElement,
  label: string,
  userEvent: { click: (element: Element) => Promise<void> },
) {
  const type = dialog.querySelector<HTMLElement>('button[aria-haspopup="listbox"]');
  if (type === null) throw new globalThis.Error('No type picker.');
  await userEvent.click(type);
  const option = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (each) => each.textContent === label,
    );
    if (found === undefined) throw new globalThis.Error(`No ${label} option.`);
    return found;
  });
  await userEvent.click(option);
  await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
  // Focus is back on the picker, so ⌘↵ submits from there.
  await waitFor(() => expect(type).toHaveFocus());
}

/**
 * A new select (AC-230): its options typed in one go in the blank row it
 * opens with, each the next hue; Create sends them with the attribute.
 */
export const CreateSelect: Story = {
  args: { typeKeys: undefined, newOptionId: optionIds(), optionsLimit: 500 },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await userEvent.keyboard('Tier');
    await chooseType(dialog, 'Select', userEvent);
    await expect(dialog).toHaveTextContent('0 of 500');
    await userEvent.click(within(dialog).getByRole('textbox', { name: 'New option' }));
    await userEvent.keyboard('Gold{Enter}');
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'New option' })).toHaveFocus());
    await userEvent.keyboard('Silver{Enter}{Escape}');
    await expect(dialog).toHaveTextContent('2 of 500');
    // Esc hands focus to Add option a frame later; ⌘↵ waits for it, as a person's next key would.
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Add option' })).toHaveFocus());
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'select',
          isMulti: false,
          options: [
            expect.objectContaining({ label: 'Gold', hue: 'gray', isArchived: false }),
            expect.objectContaining({ label: 'Silver', hue: 'red', isArchived: false }),
          ],
        }),
      ),
    );
  },
};

/** Opened where only a select or status will do (a board with nothing to group by): it starts on Select. */
export const StartsOnSelect: Story = {
  args: { typeKeys: undefined, initialTypeKey: 'select', newOptionId: optionIds(), optionsLimit: 500 },
  play: async () => {
    const dialog = await openDialog();
    // Select's options editor is there from the start, with no type chosen by hand.
    await expect(dialog).toHaveTextContent('0 of 500');
    await expect(within(dialog).getByRole('button', { name: 'Add option' })).toBeVisible();
  },
};

/** Opened from an import's column: the column's header as the name, and its values as a select's first options. */
export const StartsFromImportColumn: Story = {
  args: {
    typeKeys: undefined,
    initialTypeKey: 'select',
    initialDraft: { title: 'Tier', optionLabels: ['Gold', 'Silver'] },
    newOptionId: optionIds(),
    optionsLimit: 500,
  },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await expect(inDialog(dialog, 'Name')).toHaveValue('Tier');
    await expect(dialog).toHaveTextContent('2 of 500');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Tier',
          type: 'select',
          options: [expect.objectContaining({ label: 'Gold' }), expect.objectContaining({ label: 'Silver' })],
        }),
      ),
    );
  },
};

/** A new status starts with its three stages, Not started, In progress (open) and Done (won), editable before create. */
export const CreateStatus: Story = {
  args: { typeKeys: undefined, newOptionId: optionIds() },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await userEvent.keyboard('Stage');
    await chooseType(dialog, 'Status', userEvent);
    const stages = within(dialog).getByRole('grid', { name: 'Stages' });
    await expect(within(stages).getAllByRole('row')).toHaveLength(3);
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'status',
          options: [
            expect.objectContaining({ label: 'Not started', hue: 'gray', outcome: 'open' }),
            expect.objectContaining({ label: 'In progress', hue: 'blue', outcome: 'open' }),
            expect.objectContaining({ label: 'Done', hue: 'green', outcome: 'won' }),
          ],
        }),
      ),
    );
  },
};

/** A number shows plain, as a percent or compact (each with its example), with its decimals under it. */
export const TypeSettings: Story = {
  args: { typeKeys: undefined },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await userEvent.keyboard('Margin');
    await chooseType(dialog, 'Number', userEvent);
    // A Select's button is named by its value, then its label ("Plain 1,234.5 Display").
    const display = within(dialog).getByRole('button', { name: /Display$/ });
    await userEvent.click(display);
    await userEvent.click(await screen.findByRole('option', { name: /^Percent/ }));
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
    // Focus is back on the picker, so ⌘↵ submits from there.
    await waitFor(() => expect(display).toHaveFocus());
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'number',
          config: { display: 'percent' },
          changed: expect.arrayContaining(['config']) as unknown,
        }),
      ),
    );
  },
};

/** A phone's Default country, for numbers typed without their code; empty means the workspace's. */
export const PhoneSettings: Story = {
  args: { typeKeys: undefined },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await userEvent.keyboard('Mobile');
    await chooseType(dialog, 'Phone', userEvent);
    await expect(within(dialog).getByRole('button', { name: /Default country$/ })).toBeInTheDocument();
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ type: 'phone', config: {} })),
    );
  },
};

/** A currency's default code: a searchable list, starting at the workspace's currency (the stories' en-US: USD). */
export const CurrencySettings: Story = {
  args: { typeKeys: undefined },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await userEvent.keyboard('Deal value');
    await chooseType(dialog, 'Currency', userEvent);
    await expect(dialog).toHaveTextContent('USD');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'currency', config: { defaultCurrency: 'USD' } }),
      ),
    );
  },
};

const TIER_OPTIONS = [
  { id: '0199a6f2-0000-7000-8000-00000000b001', label: 'Silver', hue: 'gray' as const, isArchived: false },
  { id: '0199a6f2-0000-7000-8000-00000000b002', label: 'Gold', hue: 'yellow' as const, isArchived: true },
  { id: '0199a6f2-0000-7000-8000-00000000b003', label: 'Platinum', hue: 'sky' as const, isArchived: false },
];

const optionWrites = {
  onAdd: fn(),
  onChange: fn(),
  onMove: fn(),
  onArchive: fn(),
  onRestore: fn(),
};

/**
 * Editing a select: its options save as they change (the hint says so), Save
 * keeps the rest. A required default naming an archived option says what new
 * records get meanwhile (AC-236): the first live option.
 */
export const EditOptions: Story = {
  args: {
    attribute: {
      type: 'select',
      isMulti: false,
      title: 'Tier',
      apiSlug: 'tier',
      isRequired: true,
      isUnique: false,
      defaultValue: { kind: 'static', value: '0199a6f2-0000-7000-8000-00000000b002' },
      options: TIER_OPTIONS,
    },
    optionsLimit: 500,
    newOptionId: optionIds(),
    optionWrites,
  },
  play: async ({ userEvent }) => {
    const dialog = await openDialog();
    await expect(dialog).toHaveTextContent('Options save as you go.');
    await expect(dialog).toHaveTextContent('Archived. New records get Silver.');
    const silver = within(dialog).getByRole('textbox', { name: 'Option 1' });
    await userEvent.tripleClick(silver);
    await userEvent.keyboard('Steel{Enter}');
    await expect(optionWrites.onChange).toHaveBeenCalledWith('0199a6f2-0000-7000-8000-00000000b001', {
      label: 'Steel',
    });
    // Checked at rest: the dialog in, and the pointer off every control.
    await userEvent.unhover(silver);
    await waitFor(() => expect(document.querySelector('[data-entering]')).toBeNull());
  },
};

/** An optional default naming an archived option: new records get no value meanwhile. */
export const ArchivedDefault: Story = {
  args: {
    attribute: {
      type: 'select',
      isMulti: false,
      title: 'Tier',
      apiSlug: 'tier',
      isRequired: false,
      isUnique: false,
      defaultValue: { kind: 'static', value: '0199a6f2-0000-7000-8000-00000000b002' },
      options: TIER_OPTIONS,
    },
    optionWrites,
  },
  parameters: { crm: { screenshot: false } },
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveTextContent('Archived. New records get no value.');
    await waitFor(() => expect(document.querySelector('[data-entering]')).toBeNull());
  },
};

/** A member reads a status's stages: tags, outcomes as words, nothing to change. */
export const ReadOnlyStages: Story = {
  args: {
    readOnlyReason: 'Only workspace owners and admins can change attributes.',
    attribute: {
      type: 'status',
      isMulti: false,
      title: 'Stage',
      apiSlug: 'stage',
      isRequired: false,
      isUnique: false,
      options: [
        { id: 'a', label: 'Lead', hue: 'gray', isArchived: false, outcome: 'open', targetDays: 7 },
        { id: 'b', label: 'Won', hue: 'green', isArchived: false, outcome: 'won' },
      ],
    },
  },
  parameters: { crm: { screenshot: false } },
  play: async () => {
    const dialog = await openDialog();
    await expect(within(dialog).queryByRole('button', { name: 'Add stage' })).toBeNull();
    await expect(dialog).toHaveTextContent('Open, 7 days target');
    await waitFor(() => expect(document.querySelector('[data-entering]')).toBeNull());
  },
};

/** A typed option refused on its row (a label taken) keeps Create back, saying why, until it is fixed. */
export const OptionRefusedKeepsCreate: Story = {
  args: { typeKeys: undefined, newOptionId: optionIds() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await userEvent.keyboard('Tier');
    await chooseType(dialog, 'Select', userEvent);
    await userEvent.click(within(dialog).getByRole('textbox', { name: 'New option' }));
    await userEvent.keyboard('Gold{Enter}gold');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(dialog).toHaveTextContent('Fix the options marked above.'));
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

/** The object's own attributes a rule's condition may name (spec 0013). */
const STAGE_ATTRIBUTE = {
  id: 'stage',
  name: 'Stage',
  type: 'status' as const,
  allowMultiple: false,
  isRequired: false,
  isUnique: false,
  isReadOnly: false,
  options: [
    { id: 'lead', label: 'Lead', hue: 'gray' as const, archived: false },
    { id: 'won', label: 'Won', hue: 'green' as const, archived: false },
  ],
};

const REFERENCE = {
  type: 'text' as const,
  isMulti: false,
  title: 'Reference',
  apiSlug: 'reference',
  isRequired: false,
  isUnique: false,
  rules: [
    { id: 'short', kind: 'length' as const, params: { max: 12 } },
    {
      id: 'digits',
      kind: 'pattern' as const,
      params: { preset: 'digits', ignoreCase: false },
      condition: {
        conjunction: 'and' as const,
        conditions: [{ attributeId: 'stage', operator: 'is' as const, value: 'won' }],
      },
    },
  ],
};

/**
 * Rules (spec 0013, AC-252): an attribute's rules under its settings, each
 * reading as the message it gives; a new one from Add rule; Save sends the
 * list, with `rules` among what changed.
 */
export const Rules: Story = {
  args: { attribute: REFERENCE, ruleAttributes: [STAGE_ATTRIBUTE], newRuleId: () => 'new-rule' },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await expect(within(dialog).getByRole('grid', { name: 'Rules' })).toBeInTheDocument();
    await expect(dialog).toHaveTextContent('Reference can have at most 12 characters.');
    await expect(dialog).toHaveTextContent('Reference can only contain digits when Stage is Won.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Length' }));
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    await waitFor(() => expect(inDialog(dialog, 'At least, in characters')).toHaveFocus());
    await userEvent.keyboard('2');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          changed: ['rules'],
          rules: [
            { id: 'short', kind: 'length', params: { max: 12 } },
            expect.objectContaining({ id: 'digits', kind: 'pattern' }),
            { id: 'new-rule', kind: 'length', params: { min: 2 } },
          ],
        }),
      ),
    );
  },
};

/** A rule's settings refused: its row opens, the message on the setting it names. */
export const RuleRefused: Story = {
  args: {
    attribute: REFERENCE,
    ruleAttributes: [STAGE_ATTRIBUTE],
    refusals: [{ code: 'CONFIG_INVALID', message: 'Text holds at most 500 characters.', attributeId: 'rules.0.max' }],
  },
  parameters: { crm: { screenshot: false } },
  play: async () => {
    const dialog = await openDialog();
    await expect(within(dialog).getByRole('textbox', { name: 'At most, in characters' })).toHaveAccessibleDescription(
      /Text holds at most 500 characters\./,
    );
  },
};

/** Read only (a member): the rules as sentences, with nothing to change. */
export const ReadOnlyRules: Story = {
  args: {
    attribute: REFERENCE,
    readOnlyReason: 'Only workspace owners and admins can change attributes.',
  },
  parameters: { crm: { screenshot: false } },
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveTextContent('Reference can have at most 12 characters.');
    await expect(within(dialog).queryByRole('button', { name: 'Add rule' })).toBeNull();
  },
};

/** What a check found, for the Change type stories. */
type Check = TypeChangeStepProps['check'];

/** Props for the Change type sample: the dialog's, the check it shows, and the filtered table's link. */
type ChangingTypeProps = SampleProps & {
  readonly check: Check;
  readonly failedLink?: TypeChangeStepProps['failedLink'];
};

/** An edit whose "Change type…" opens the step in the same Modal, as the screen does, with a check fixed by `check`. */
function ChangingType({ check, failedLink, ...args }: ChangingTypeProps) {
  const [isOpen, setOpen] = useState(true);
  const [isChanging, setChanging] = useState(false);
  const [target, setTarget] = useState('long_text');
  const [config, setConfig] = useState<Readonly<Record<string, unknown>>>({});
  return (
    <Stage>
      <Button
        onPress={() => {
          setOpen(true);
        }}
      >
        Edit attribute
      </Button>
      <AttributeSettings
        {...args}
        isOpen={isOpen}
        onOpenChange={setOpen}
        onChangeType={() => {
          setChanging(true);
        }}
        {...(isChanging
          ? {
              step: typeChangeStep({
                targets: ['long_text', 'email', 'link', 'phone'],
                target,
                config,
                onTargetChange: setTarget,
                onConfigChange: setConfig,
                check,
                onRetry: fn(),
                failedLink,
                isBusy: false,
                onBack: () => {
                  setChanging(false);
                },
                onApply: fn(),
              }),
            }
          : {})}
      />
    </Stage>
  );
}

const CONTACT = {
  type: 'text' as const,
  isMulti: false,
  title: 'Contact',
  apiSlug: 'contact',
  isRequired: false,
  isUnique: true,
};

/**
 * Change type (the field types pass): "Change type…" under the type opens the step in the same dialog, its first
 * safe target chosen and checked. Every value converts, Unique turns off: Change type is on. Back returns.
 */
export const ChangeType: Story = {
  args: { attribute: CONTACT },
  render: (args) => (
    <ChangingType
      {...args}
      check={{ total: 1204, converts: 1204, fails: 0, consequences: ['Unique turns off.'], blockers: [] }}
    />
  ),
  play: async ({ userEvent }) => {
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change type…' }));
    await waitFor(() => expect(dialog).toHaveAccessibleName('Change type'));
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-haspopup')).toBe('listbox'));
    await expect(within(dialog).getByText('All 1,204 values convert. Unique turns off.')).toBeInTheDocument();
    await expect(within(dialog).getByRole('button', { name: 'Change type' })).toBeEnabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(dialog).toHaveAccessibleName('Edit attribute'));
    // Back returns focus to what opened the step, and the settings as they were.
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Change type…' })).toHaveFocus());
  },
};

/** Values that don't convert: the reason, the records as a filtered table, and Change type off until they're fixed. */
export const ChangeTypeBlocked: Story = {
  args: { attribute: CONTACT },
  render: (args) => (
    <ChangingType
      {...args}
      check={{
        total: 1204,
        converts: 1201,
        fails: 3,
        consequences: [],
        blockers: ['3 values can’t become Email: Not an email address. Fix them first.'],
      }}
      failedLink={{ label: 'Show 3 records', href: '/w/acme/people' }}
    />
  ),
  play: async ({ userEvent }) => {
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change type…' }));
    await expect(within(dialog).getByRole('link', { name: 'Show 3 records' })).toBeInTheDocument();
    await expect(within(dialog).getByRole('button', { name: 'Change type' })).toBeDisabled();
  },
};

/** While the values are read: Change type waits. */
export const ChangeTypeChecking: Story = {
  parameters: { crm: { screenshot: false } },
  args: { attribute: CONTACT },
  render: (args) => <ChangingType {...args} check="loading" />,
  play: async ({ userEvent }) => {
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change type…' }));
    await expect(within(dialog).getByText('Checking every value…')).toBeInTheDocument();
    await expect(within(dialog).getByRole('button', { name: 'Change type' })).toBeDisabled();
  },
};

/** The check failed (offline, a timeout): it says so with Try again, and Change type waits. */
export const ChangeTypeCheckFailed: Story = {
  parameters: { crm: { screenshot: false } },
  args: { attribute: CONTACT },
  render: (args) => <ChangingType {...args} check="error" />,
  play: async ({ userEvent }) => {
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change type…' }));
    await expect(within(dialog).getByText('Couldn’t check the values.')).toBeInTheDocument();
    await expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeEnabled();
    await expect(within(dialog).getByRole('button', { name: 'Change type' })).toBeDisabled();
  },
};
