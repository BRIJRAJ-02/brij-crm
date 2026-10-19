import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { PhoneField } from './PhoneField.tsx';

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
