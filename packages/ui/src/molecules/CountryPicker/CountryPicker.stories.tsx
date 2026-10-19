import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { CountryPicker } from './CountryPicker.tsx';

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

/** A search by dial code finds the country too, with the guessed country pinned first while the search is empty. */
export const ByDialCode: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Country/ }));
    await search();
    await waitFor(() => expect(document.querySelector('[role="option"]')).toHaveTextContent('India'));
    await userEvent.keyboard('+44');
    await waitFor(() => expect(document.querySelector('[role="option"]')).toHaveTextContent('Guernsey'));
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
