import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import {
  RelationshipSettings,
  type RelationshipSettingsObject,
  type RelationshipSettingsProps,
} from './RelationshipSettings.tsx';

const PEOPLE = '0199a6f2-0000-7000-8000-0000000b0001';
const COMPANIES = '0199a6f2-0000-7000-8000-0000000b0002';
const DEALS = '0199a6f2-0000-7000-8000-0000000b0003';

const OBJECTS: readonly RelationshipSettingsObject[] = [
  { id: PEOPLE, singularName: 'Person', pluralName: 'People', icon: 'user', hue: 'blue' },
  { id: COMPANIES, singularName: 'Company', pluralName: 'Companies', icon: 'building', hue: 'purple' },
  { id: DEALS, singularName: 'Deal', pluralName: 'Deals', icon: 'handshake', hue: 'green' },
];

type SampleProps = Omit<RelationshipSettingsProps, 'isOpen' | 'onOpenChange'>;

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
        Add attribute
      </Button>
      <RelationshipSettings {...props} isOpen={isOpen} onOpenChange={setOpen} />
    </Stage>
  );
}

const meta = {
  title: 'Modules/RelationshipSettings',
  component: SampleSettings,
  args: { mode: 'create', objects: OBJECTS, from: { objectId: PEOPLE }, onSubmit: fn() },
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

/** Opens a Select in the dialog by its label and picks the option with these words. */
async function choose(
  dialog: HTMLElement,
  userEvent: { click: (element: Element) => Promise<void> },
  label: string,
  option: string,
) {
  const trigger = await waitFor(() => {
    const found = [...dialog.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"]')].find((button) =>
      (button.getAttribute('aria-labelledby') ?? '')
        .split(' ')
        .some((id) => document.getElementById(id)?.textContent === label),
    );
    if (found === undefined) throw new globalThis.Error(`No ${label} picker.`);
    return found;
  });
  await userEvent.click(trigger);
  const item = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
      each.textContent.includes(option),
    );
    if (found === undefined) throw new globalThis.Error(`No ${option} option.`);
    return found;
  });
  await userEvent.click(item);
  await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
}

/**
 * Create from People's table: People is set, the related object is chosen
 * first (it has focus), the four choices are phrased with both objects, the
 * names follow the objects and the choice, and the sentence restates it.
 */
export const Create: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await expect(dialog).toHaveAccessibleName('New relationship');
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-haspopup')).toBe('listbox'));
    await choose(dialog, userEvent, 'Related object', 'Companies');
    await expect(
      within(dialog).getByRole('radio', { name: 'Each person has one company, each company has many people' }),
    ).toBeChecked();
    await expect(inDialog(dialog, 'Name on People')).toHaveValue('Company');
    await expect(inDialog(dialog, 'Name on Companies')).toHaveValue('People');
    await expect(dialog).toHaveTextContent(
      'People get “Company”, holding one company. Companies get “People”, holding many people.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /Create relationship/ }));
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith({
        cardinality: 'many_to_one',
        from: { objectId: PEOPLE, title: 'Company' },
        to: { objectId: COMPANIES, title: 'People' },
        changed: [],
      }),
    );
  },
};

/** Each of the four cardinalities: the names follow what each side holds until typed over. */
export const EveryCardinality: Story = {
  args: { to: { objectId: COMPANIES } },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    const cases = [
      ['Each person has many companies, each company has one person', 'one_to_many', 'Companies', 'Person'],
      ['Each person has many companies, each company has many people', 'many_to_many', 'Companies', 'People'],
      ['Each person has one company, each company has one person', 'one_to_one', 'Company', 'Person'],
      ['Each person has one company, each company has many people', 'many_to_one', 'Company', 'People'],
    ] as const;
    for (const [choice, cardinality, fromName, toName] of cases) {
      await userEvent.click(within(dialog).getByRole('radio', { name: choice }));
      await expect(inDialog(dialog, 'Name on People')).toHaveValue(fromName);
      await expect(inDialog(dialog, 'Name on Companies')).toHaveValue(toName);
      await userEvent.click(within(dialog).getByRole('button', { name: /Create relationship/ }));
      await waitFor(() =>
        expect(args.onSubmit).toHaveBeenLastCalledWith(
          expect.objectContaining({
            cardinality,
            from: { objectId: PEOPLE, title: fromName },
            to: { objectId: COMPANIES, title: toName },
          }),
        ),
      );
    }
  },
};

/** A name typed over stays when the choice changes, and is marked changed. */
export const TypedName: Story = {
  parameters: { crm: { screenshot: false } },
  args: { to: { objectId: COMPANIES } },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    const near = inDialog(dialog, 'Name on People');
    await waitFor(() => expect(near).toHaveFocus());
    await userEvent.clear(near);
    await userEvent.type(near, 'Employer');
    await userEvent.click(
      within(dialog).getByRole('radio', { name: 'Each person has many companies, each company has many people' }),
    );
    await expect(near).toHaveValue('Employer');
    await expect(inDialog(dialog, 'Name on Companies')).toHaveValue('People');
    await userEvent.click(within(dialog).getByRole('button', { name: /Create relationship/ }));
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ from: { objectId: PEOPLE, title: 'Employer' }, changed: ['from.title'] }),
      ),
    );
  },
};

/**
 * A relationship from People to itself (Manager and Reports): the second
 * name says it is the reverse side, and two names alike are refused on it
 * before anything is sent.
 */
export const SelfRelation: Story = {
  args: { to: { objectId: PEOPLE } },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    const first = inDialog(dialog, 'Name on People');
    const second = inDialog(dialog, 'Reverse name on People');
    await waitFor(() => expect(first).toHaveFocus());
    await userEvent.clear(first);
    await userEvent.type(first, 'Manager');
    await userEvent.clear(second);
    await userEvent.type(second, 'manager');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(dialog).toHaveTextContent('Give each side its own name.'));
    await expect(args.onSubmit).not.toHaveBeenCalled();
    await userEvent.clear(second);
    await userEvent.type(second, 'Reports');
    await expect(dialog).toHaveTextContent(
      'People get “Manager”, holding one person, and “Reports”, holding many people.',
    );
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          from: { objectId: PEOPLE, title: 'Manager' },
          to: { objectId: PEOPLE, title: 'Reports' },
        }),
      ),
    );
  },
};

/** Neither end preset (the schema map): both objects are chosen, and Create waits for both. */
export const BothEndsChoosable: Story = {
  args: { from: undefined },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await expect(
      within(dialog).getByRole('radio', { name: 'Each record has one record, each record has many records' }),
    ).toBeChecked();
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-haspopup')).toBe('listbox'));
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(dialog).toHaveTextContent('Choose an object for this side.'));
    await expect(args.onSubmit).not.toHaveBeenCalled();
    await choose(dialog, userEvent, 'Object', 'Deals');
    await choose(dialog, userEvent, 'Related object', 'Companies');
    await expect(inDialog(dialog, 'Name on Deals')).toHaveValue('Company');
    await expect(inDialog(dialog, 'Name on Companies')).toHaveValue('Deals');
  },
};

/** Both ends preset (a link drawn on the schema map): only the choice and the names are left. */
export const BothEndsPreset: Story = {
  parameters: { crm: { screenshot: false } },
  args: { from: { objectId: DEALS }, to: { objectId: PEOPLE }, cardinality: 'many_to_many' },
  play: async ({ userEvent }) => {
    const dialog = await openDialog();
    await waitFor(() => expect(inDialog(dialog, 'Name on Deals')).toHaveFocus());
    await expect(inDialog(dialog, 'Name on Deals')).toHaveValue('People');
    await expect(inDialog(dialog, 'Name on People')).toHaveValue('Deals');
    await expect(within(dialog).queryAllByRole('button', { name: /Object/ })).toEqual([]);
    await userEvent.keyboard('{Escape}');
  },
};

/**
 * Edit: both objects and the cardinality read only with why, the names as
 * they are, and Save sends only the names that changed.
 */
export const Edit: Story = {
  args: {
    mode: 'edit',
    from: { objectId: COMPANIES, title: 'Investors' },
    to: { objectId: PEOPLE, title: 'Investments' },
    cardinality: 'many_to_many',
  },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await expect(dialog).toHaveAccessibleName('Edit relationship');
    await expect(dialog).toHaveTextContent(
      'The objects and how records link can’t change once the relationship exists.',
    );
    const chosen = within(dialog).getByRole('radio', {
      name: 'Each company has many people, each person has many companies',
    });
    await expect(chosen).toBeChecked();
    await expect(within(dialog).getByRole('radiogroup')).toHaveAttribute('aria-readonly', 'true');
    const near = inDialog(dialog, 'Name on Companies');
    await waitFor(() => expect(near).toHaveFocus());
    await userEvent.clear(near);
    await userEvent.type(near, 'Backers');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith({
        cardinality: 'many_to_many',
        from: { objectId: COMPANIES, title: 'Backers' },
        to: { objectId: PEOPLE, title: 'Investments' },
        changed: ['from.title'],
      }),
    );
  },
};

/** Edit of a relationship from People to itself keeps its two names apart. */
export const EditSelf: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    mode: 'edit',
    from: { objectId: PEOPLE, title: 'Manager' },
    to: { objectId: PEOPLE, title: 'Reports' },
    cardinality: 'many_to_one',
  },
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    const second = inDialog(dialog, 'Reverse name on People');
    await userEvent.clear(second);
    await userEvent.type(second, 'Manager');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(dialog).toHaveTextContent('Give each side its own name.'));
    await expect(args.onSubmit).not.toHaveBeenCalled();
    // The refusal's field settles (its colours transition) before axe reads the contrast.
    await waitFor(() => expect(document.getAnimations().filter((each) => each.playState === 'running')).toEqual([]));
  },
};

/** Read only, for someone who can't change the schema: the reason once, every setting locked, and Close alone. */
export const ReadOnly: Story = {
  args: {
    mode: 'edit',
    from: { objectId: PEOPLE, title: 'Company' },
    to: { objectId: COMPANIES, title: 'Team' },
    cardinality: 'many_to_one',
    readOnlyReason: 'Only workspace owners and admins can change attributes.',
  },
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveAccessibleName('Relationship settings');
    await expect(dialog).toHaveTextContent('Only workspace owners and admins can change attributes.');
    await expect(dialog.querySelector('button[type="submit"]')).toBeNull();
    await expect(inDialog(dialog, 'Name on People')).toHaveAttribute('readonly');
  },
};

/** Waiting for the server: the primary spins with its ongoing verb, Cancel is off, and Esc keeps the dialog. */
export const Busy: Story = {
  args: { to: { objectId: COMPANIES }, isBusy: true },
  play: async ({ userEvent }) => {
    const dialog = await openDialog();
    await expect(within(dialog).getByRole('button', { name: /Creating relationship/ })).toBeInTheDocument();
    await expect(within(dialog).getByRole('button', { name: /Cancel/ })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  },
};

/** The server refused a name on the far side (taken there): it shows on that name, and goes once it changes. */
export const RefusedName: Story = {
  args: {
    to: { objectId: COMPANIES },
    refusals: [
      {
        code: 'SLUG_TAKEN',
        message: 'Companies already has an attribute with this name. Pick another.',
        attributeId: 'to.title',
      },
    ],
  },
  play: async ({ userEvent }) => {
    const dialog = await openDialog();
    const far = inDialog(dialog, 'Name on Companies');
    await waitFor(() => expect(far).toHaveAttribute('aria-invalid', 'true'));
    await expect(dialog).toHaveTextContent('Companies already has an attribute with this name. Pick another.');
    await userEvent.type(far, ' team');
    await waitFor(() => expect(far).not.toHaveAttribute('aria-invalid', 'true'));
  },
};

/** A refusal about no one side (an object full of attributes) shows above the settings. */
export const RefusedLimit: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    to: { objectId: COMPANIES },
    refusals: [{ code: 'LIMIT_REACHED', message: 'Companies already holds 250 attributes, the most an object can.' }],
  },
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveTextContent('Companies already holds 250 attributes, the most an object can.');
  },
};
