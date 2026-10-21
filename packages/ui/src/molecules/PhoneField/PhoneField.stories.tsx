import type { Meta, StoryObj } from '@storybook/react-vite';
import { DialogTrigger } from 'react-aria-components';
import { expect, fn, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { PhoneField, type PhoneFieldProps } from './PhoneField.tsx';

const meta = {
  title: 'Molecules/PhoneField',
  component: PhoneField,
  args: { label: 'Phone or WhatsApp', guess: 'IN', placeholder: '98765 43210', onChange: fn() },
  render: (args) => (
    <Stage width="narrow">
      <PhoneField {...args} />
    </Stage>
  ),
} satisfies Meta<typeof PhoneField>;

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

/** Empty, with the guessed country's code already in front. */
export const Empty: Story = {};

/** A number, laid out for its country as it was typed. */
export const Chosen: Story = {
  parameters: { crm: { preview: true } },
  args: { defaultValue: { country: 'GB', national: '07700 900123' } },
};

/** Choosing a code from the search moves focus to the number. */
export const Searching: Story = {
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Country code/ }));
    const field = await search();
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.keyboard('united king{Enter}');
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Phone or WhatsApp' })).toHaveFocus());
    await expect(args.onChange).toHaveBeenCalledWith({ country: 'GB', national: '' });
  },
};

/** A number pasted with its "+" code switches the country to match. */
export const PastedCode: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Phone or WhatsApp' }));
    await userEvent.paste('+44 7700 900123');
    await waitFor(() => expect(args.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ country: 'GB' })));
    await expect(canvas.getByRole('button', { name: /Country code/ })).toHaveTextContent('+44');
  },
};

/** A code search that fits nothing says so. */
export const NoMatches: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Country code/ }));
    await search();
    await userEvent.keyboard('zzzz');
    await waitFor(() => expect(document.body).toHaveTextContent('No matches'));
  },
};

/** A number that can't be dialled. */
export const Invalid: Story = {
  name: 'Error',
  args: { defaultValue: { country: 'IN', national: '12' }, error: 'Give a phone number we can call.' },
};

/** Disabled. */
export const Disabled: Story = {
  args: { defaultValue: { country: 'GB', national: '07700 900123' }, isDisabled: true },
};

/** Read only, with why. */
export const ReadOnly: Story = {
  args: {
    defaultValue: { country: 'GB', national: '07700 900123' },
    isReadOnly: true,
    readOnlyReason: 'Taken from the enquiry.',
  },
};

/**
 * The chosen country's example number as the placeholder (`showsExample`),
 * written the national way: +91 shows India's, +1 the United States'.
 */
export const ExamplePlaceholder: Story = {
  args: { placeholder: undefined, showsExample: true },
  play: async ({ canvas, userEvent }) => {
    const number = canvas.getByRole('textbox', { name: 'Phone or WhatsApp' });
    await waitFor(() => expect(number).toHaveAttribute('placeholder', '081234 56789'));
    await userEvent.click(canvas.getByRole('button', { name: /Country code/ }));
    await search();
    await userEvent.keyboard('united states');
    const option = await within(document.body).findByRole('option', { name: /^United States/ });
    await userEvent.click(option);
    await waitFor(() => expect(number).toHaveAttribute('placeholder', '(201) 555-0123'));
  },
};

/** The checker (`checksNumber`): a quiet check while the number is valid for its country. */
export const ValidNumber: Story = {
  args: { checksNumber: true, defaultValue: { country: 'IN', national: '98765 43210' } },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByRole('img', { name: 'A valid number' })).toBeInTheDocument());
  },
};

/** The checker says what is wrong only once focus leaves or Enter is pressed, never on each key. */
export const TooShort: Story = {
  args: { checksNumber: true },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Phone or WhatsApp' }));
    await userEvent.keyboard('98765');
    await expect(canvas.queryByText('This number is too short for the country chosen.')).toBeNull();
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(canvas.getByText('This number is too short for the country chosen.')).toBeInTheDocument(),
    );
    // Typing on clears it until the next check.
    await userEvent.keyboard('4');
    await expect(canvas.queryByText('This number is too short for the country chosen.')).toBeNull();
  },
};

/** A full international number pasted in switches the country to match. */
export const PasteSwitchesCountry: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Phone or WhatsApp' }));
    await userEvent.paste('+44 20 7123 4567');
    await waitFor(() => expect(canvas.getByRole('button', { name: /Country code/ })).toHaveTextContent('+44'));
  },
};

/** In a popover, as a grid cell's editor opens it: the field draws its focus with its accent edge alone. */
function InAPopoverStage(args: PhoneFieldProps) {
  return (
    <Stage width="narrow">
      <DialogTrigger defaultOpen>
        <Button icon="phone">Edit</Button>
        <Popover label="Phone" width="menu">
          <PhoneField {...args} />
        </Popover>
      </DialogTrigger>
    </Stage>
  );
}

/** The popover around the field, by its name. */
function outer() {
  return document.querySelector('[role="dialog"][aria-label="Phone"]');
}

/**
 * In a popover (a grid cell's editor): a click on the code opens its list over the popover and leaves both open,
 * the typed number kept and nothing counted as leaving; choosing puts focus back in the number; Esc closes the
 * list first, then the popover.
 */
export const InAPopover: Story = {
  parameters: { crm: { screenshot: false } },
  args: { isLabelHidden: true, size: 'sm', onLeave: fn(), guess: 'US', placeholder: undefined },
  render: (args) => <InAPopoverStage {...args} />,
  play: async ({ args, userEvent }) => {
    await waitFor(() => expect(outer()).not.toBeNull());
    const page = within(document.body);
    const number = page.getByRole<HTMLInputElement>('textbox', { name: 'Phone or WhatsApp' });
    await userEvent.click(number);
    await userEvent.keyboard('2015550123');
    await userEvent.click(page.getByRole('button', { name: /Country code/ }));
    const field = await search();
    await waitFor(() => expect(field).toHaveFocus());
    await expect(outer()).not.toBeNull();
    await expect(args.onLeave).not.toHaveBeenCalled();
    await userEvent.keyboard('ind');
    await waitFor(() => expect(document.querySelector('[role="option"][data-focused]')).toHaveTextContent('India'));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(number).toHaveFocus());
    await expect(page.getByRole('button', { name: /Country code/ })).toHaveTextContent('+91');
    // The digits typed before choosing stay, laid out for the new country once the phone library is in.
    await expect(number.value.replace(/\D/g, '')).toBe('2015550123');
    await expect(args.onLeave).not.toHaveBeenCalled();
    // Esc: the list closes and the popover stays, focus on the code; the next Esc closes the popover.
    await userEvent.click(page.getByRole('button', { name: /Country code/ }));
    await search();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
    await expect(outer()).not.toBeNull();
    await waitFor(() => expect(page.getByRole('button', { name: /Country code/ })).toHaveFocus());
    await expect(args.onLeave).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(outer()).toBeNull());
  },
};

/** The code's list open over the popover the field sits in, the number typed so far kept beside it. */
export const InAPopoverListOpen: Story = {
  args: { isLabelHidden: true, size: 'sm', guess: 'US', placeholder: undefined, showsExample: true },
  render: (args) => <InAPopoverStage {...args} />,
  play: async ({ userEvent }) => {
    await waitFor(() => expect(outer()).not.toBeNull());
    const page = within(document.body);
    await userEvent.click(page.getByRole('textbox', { name: 'Phone or WhatsApp' }));
    await userEvent.keyboard('20155');
    await userEvent.click(page.getByRole('button', { name: /Country code/ }));
    const field = await search();
    await userEvent.keyboard('ind');
    await waitFor(() => expect(document.querySelector('[role="option"][data-focused]')).toHaveTextContent('India'));
    // The search names its marked option once React Aria has caught up with the typing.
    await waitFor(() =>
      expect(document.getElementById(field.getAttribute('aria-activedescendant') ?? '')).not.toBeNull(),
    );
  },
};

/**
 * A refused number in a popover: its edge stays danger, so its halo stays as its sign of focus, and the code
 * button reached by the keyboard draws its own mark.
 */
export const InAPopoverInvalid: Story = {
  args: {
    isLabelHidden: true,
    size: 'sm',
    guess: 'IN',
    placeholder: undefined,
    defaultValue: { country: 'IN', national: '98765' },
    error: 'This number is too short for the country chosen.',
  },
  render: (args) => <InAPopoverStage {...args} />,
  play: async ({ userEvent }) => {
    await waitFor(() => expect(outer()).not.toBeNull());
    const page = within(document.body);
    await userEvent.click(page.getByRole('textbox', { name: 'Phone or WhatsApp' }));
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    const code = page.getByRole('button', { name: /Country code/ });
    await waitFor(() => expect(code).toHaveFocus());
    await expect(getComputedStyle(code).boxShadow).not.toBe('none');
  },
};
