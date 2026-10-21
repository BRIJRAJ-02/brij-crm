import type { Meta, StoryObj } from '@storybook/react-vite';
import { DialogTrigger } from 'react-aria-components';
import { expect, fn, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { CountryPicker, type CountryPickerProps } from './CountryPicker.tsx';

const meta = {
  title: 'Molecules/CountryPicker',
  component: CountryPicker,
  args: { label: 'Country', guess: 'IN', onChange: fn() },
  render: (args) => (
    <Stage width="narrow">
      <CountryPicker {...args} />
    </Stage>
  ),
} satisfies Meta<typeof CountryPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The open list: its search field. */
function search() {
  return waitFor(() => {
    const found = document.querySelector<HTMLInputElement>('input[aria-label="Search country or code"]');
    if (found === null) throw new Error('the list did not open');
    return found;
  });
}

/** Nothing chosen yet: the placeholder. */
export const Empty: Story = {};

/** A country chosen: its flag and name. */
export const Chosen: Story = {
  parameters: { crm: { preview: true } },
  args: { defaultValue: 'IN' },
};

/** Opened from the keyboard: the search has focus, typing narrows by name, and Enter chooses. */
export const Searching: Story = {
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Country/ }));
    const field = await search();
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.keyboard('germ');
    await waitFor(() => expect(document.querySelectorAll('[role="option"]')).toHaveLength(1));
    await userEvent.keyboard('{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('DE');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
  },
};

/**
 * A search by dial code finds the country too, with the guessed country pinned first while the search is empty.
 * A code several countries share lists its main country first, marked, so Enter chooses it: +44 is the United
 * Kingdom, not Guernsey.
 */
export const ByDialCode: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Country/ }));
    await search();
    await waitFor(() => expect(document.querySelector('[role="option"]')).toHaveTextContent('India'));
    await userEvent.keyboard('+44');
    await waitFor(() => expect(document.querySelector('[role="option"]')).toHaveTextContent('United Kingdom'));
    await waitFor(() =>
      expect(document.querySelector('[role="option"][data-focused]')).toHaveTextContent('United Kingdom'),
    );
    await userEvent.keyboard('{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('GB');
  },
};

/**
 * Names that start with what is typed come first, and the first is the one marked: "ind" lists India before
 * British Indian Ocean Territory, and "an" Andorra before Afghanistan, so Enter chooses what was meant.
 */
export const BestMatchFirst: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Country/ }));
    await search();
    await userEvent.keyboard('an');
    await waitFor(() => expect(document.querySelector('[role="option"][data-focused]')).toHaveTextContent('Andorra'));
    await userEvent.keyboard('{Backspace}{Backspace}ind');
    await waitFor(() => expect(document.querySelector('[role="option"]')).toHaveTextContent('India'));
    await waitFor(() => expect(document.querySelector('[role="option"][data-focused]')).toHaveTextContent('India'));
    await userEvent.keyboard('{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('IN');
  },
};

/** Opened inside another popover (a grid cell's editor, a filter): the list opens over it and leaves it open. */
function InAPopoverStage(args: CountryPickerProps) {
  return (
    <Stage width="narrow">
      <DialogTrigger defaultOpen>
        <Button icon="phone">Edit</Button>
        <Popover label="Phone" width="menu">
          <CountryPicker {...args} />
        </Popover>
      </DialogTrigger>
    </Stage>
  );
}

/** The popover around it, by its name. */
function outer() {
  return document.querySelector('[role="dialog"][aria-label="Phone"]');
}

/**
 * Inside another popover: a click opens the list and both stay open (the search takes focus only once its own
 * list is in place, so the popover around it never reads the move as focus leaving). Choosing closes the list
 * alone and puts focus back on the trigger; Esc closes the list first, then the popover.
 */
export const InAPopover: Story = {
  // It ends with everything closed; InAPopoverOpen holds the picture.
  parameters: { crm: { screenshot: false } },
  render: (args) => <InAPopoverStage {...args} />,
  play: async ({ args, userEvent }) => {
    await waitFor(() => expect(outer()).not.toBeNull());
    const page = within(document.body);
    const trigger = page.getByRole('button', { name: /Country/ });
    await userEvent.click(trigger);
    const field = await search();
    await waitFor(() => expect(field).toHaveFocus());
    await expect(outer()).not.toBeNull();
    await userEvent.keyboard('ind');
    await waitFor(() => expect(document.querySelector('[role="option"][data-focused]')).toHaveTextContent('India'));
    await userEvent.keyboard('{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('IN');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
    await expect(outer()).not.toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
    // Esc: the list first, then the popover around it.
    await userEvent.keyboard('{Enter}');
    await search();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
    await expect(outer()).not.toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(outer()).toBeNull());
  },
};

/** The list open over the popover it was opened from, the search marking its best match. */
export const InAPopoverOpen: Story = {
  render: (args) => <InAPopoverStage {...args} />,
  play: async ({ userEvent }) => {
    await waitFor(() => expect(outer()).not.toBeNull());
    await userEvent.click(within(document.body).getByRole('button', { name: /Country/ }));
    const field = await search();
    await userEvent.keyboard('ind');
    await waitFor(() => expect(document.querySelector('[role="option"][data-focused]')).toHaveTextContent('India'));
    await expect(outer()).not.toBeNull();
    // The search names its marked option once React Aria has caught up with the typing.
    await waitFor(() =>
      expect(document.getElementById(field.getAttribute('aria-activedescendant') ?? '')).not.toBeNull(),
    );
  },
};

/** A search that fits nothing says so. */
export const NoMatches: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Country/ }));
    await search();
    await userEvent.keyboard('zzzz');
    await waitFor(() => expect(document.body).toHaveTextContent('No matches'));
  },
};

/** Required and left empty. */
export const Invalid: Story = {
  name: 'Error',
  args: { isRequired: true, error: 'Answer this question.' },
};

/** Disabled. */
export const Disabled: Story = {
  args: { defaultValue: 'GB', isDisabled: true },
};

/** Read only, with why. */
export const ReadOnly: Story = {
  args: { defaultValue: 'GB', isReadOnly: true, readOnlyReason: 'Set from the visitor’s address.' },
};

/**
 * A place's country (`list="all"`): every country and territory, with no
 * dial codes, small (`size="sm"`, a filter value or a panel row) and
 * clearable, as the Location editor and a filter's "country is" use it.
 */
export const Place: Story = {
  args: { list: 'all', size: 'sm', isClearable: true, defaultValue: 'GB', searchLabel: 'Search countries' },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Country/ }));
    const field = await waitFor(() => {
      const found = document.querySelector<HTMLInputElement>('input[aria-label="Search countries"]');
      if (found === null) throw new Error('the list did not open');
      return found;
    });
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.keyboard('antarc');
    // A territory with no dialling code is listed, and no option shows a code.
    await waitFor(() => expect(document.querySelector('[role="option"]')).toHaveTextContent('Antarctica'));
    await expect(document.querySelector('[role="listbox"]')).not.toHaveTextContent('+');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(canvas.getByRole('button', { name: /Country/ }));
    await userEvent.click(await within(document.body).findByRole('option', { name: 'Clear' }));
    await expect(args.onChange).toHaveBeenCalledWith(null);
  },
};
