import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { Button } from '../atoms/Button/Button.tsx';
import { Stage } from '../workbench/Stage/Stage.tsx';
import { useToasts } from './UiProvider.tsx';

function ToastButtons() {
  const toasts = useToasts();
  return (
    <Stage>
      <Button
        onPress={() => {
          toasts.toast({ tone: 'success', message: 'Record added successfully' });
        }}
      >
        Show confirmation
      </Button>
      <Button
        onPress={() => {
          toasts.toast({
            tone: 'danger',
            message: 'Couldn’t import 3 rows. Check the date column uses one format, then import again.',
          });
        }}
      >
        Show error
      </Button>
      <Button
        onPress={() => {
          toasts.toast({
            tone: 'success',
            message: '12 people deleted',
            action: { label: 'Undo', onAction: () => undefined },
          });
        }}
      >
        Show with undo
      </Button>
    </Stage>
  );
}

const meta = {
  title: 'Provider/Toasts',
  component: ToastButtons,
  parameters: { crm: { screenshot: false } },
} satisfies Meta<typeof ToastButtons>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Toasts rise at the bottom right. A confirmation leaves after 5 seconds; an error, or a toast with an action, stays. */
export const Toasts: Story = {};

/** By keyboard: Tab reaches the toast after the page's own controls, then its Dismiss; Enter closes it and focus goes back. */
export const Keyboard: Story = {
  play: async ({ canvas, userEvent }) => {
    const findRegion = () => document.querySelector<HTMLElement>('[role="region"][aria-label="Notifications"]');
    await userEvent.tab();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Show error' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    const region = await waitFor(() => {
      const found = findRegion();
      if (found === null) throw new Error('no toast region');
      return found;
    });
    await expect(within(region).getByText(/Couldn’t import 3 rows/)).toBeInTheDocument();

    await userEvent.tab();
    const lastOnPage = canvas.getByRole('button', { name: 'Show with undo' });
    await expect(lastOnPage).toHaveFocus();
    await userEvent.tab();
    await expect(within(region).getByRole('alertdialog')).toHaveFocus();
    await userEvent.tab();
    await expect(within(region).getByRole('button', { name: 'Dismiss' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    // The region leaves with its last toast, and focus returns to where it was.
    await waitFor(() => expect(findRegion()).toBeNull());
    await expect(lastOnPage).toHaveFocus();
  },
};
