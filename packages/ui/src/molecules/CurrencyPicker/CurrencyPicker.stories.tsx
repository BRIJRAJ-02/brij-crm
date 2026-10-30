import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { CurrencyPicker } from './CurrencyPicker.tsx';

const meta = {
  title: 'Molecules/CurrencyPicker',
  component: CurrencyPicker,
  args: { label: 'Currency', onChange: fn() },
  render: (args) => (
    <Stage width="narrow">
      <CurrencyPicker {...args} />
    </Stage>
  ),
} satisfies Meta<typeof CurrencyPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The open list's search field. */
function search() {
  return waitFor(() => {
    const found = document.querySelector<HTMLInputElement>('input[aria-label="Search currencies"]');
    if (found === null) throw new Error('the list did not open');
    return found;
  });
}

/** Nothing chosen yet: the placeholder. */
export const Empty: Story = {};

/** A currency chosen: its name and code. */
export const Chosen: Story = {
  parameters: { crm: { preview: true } },
  args: { value: 'INR' },
};

/** Cleared back to "Automatic" (General's workspace currency). */
export const Clearable: Story = {
  parameters: { crm: { screenshot: false } },
  args: { value: 'EUR', isClearable: true, placeholder: 'Automatic' },
};

/** Opened by a click: the search has focus, typing a code narrows the list, and Enter chooses. */
export const Searching: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Currency/ }));
    const field = await search();
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.keyboard('inr');
    await waitFor(() => expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(0));
    await userEvent.keyboard('{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('INR');
  },
};

/** Read only, with its reason. */
export const ReadOnly: Story = {
  parameters: { crm: { screenshot: false } },
  args: { value: 'GBP', isReadOnly: true, readOnlyReason: 'Only admins change this.' },
};
