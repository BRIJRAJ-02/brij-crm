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

/** News about someone else's change: the info tone. */
function InfoButton() {
  const toasts = useToasts();
  return (
    <Stage>
      <Button
        onPress={() => {
          toasts.toast({ tone: 'info', message: 'Bea Ruiz changed the filters on this view.' });
        }}
      >
        Show news
      </Button>
    </Stage>
  );
}

/** Work under way, then how it ended: the busy toast gives way to the result with its action. */
function BusyButton() {
  const toasts = useToasts();
  return (
    <Stage>
      <Button
        onPress={() => {
          const key = toasts.toast({ tone: 'info', message: 'Exporting People…', isBusy: true });
          globalThis.setTimeout(() => {
            toasts.dismiss(key);
            toasts.toast({
              tone: 'success',
              message: 'People.csv is ready',
              action: { label: 'Download', onAction: () => undefined },
            });
          }, 300);
        }}
      >
        Export
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

/** The info tone: news about what someone else did, with the info icon, leaving like a confirmation. */
export const Info: Story = {
  render: () => <InfoButton />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Show news' }));
    const region = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[role="region"][aria-label="Notifications"]');
      if (found === null) throw new Error('no toast region');
      return found;
    });
    await expect(within(region).getByText('Bea Ruiz changed the filters on this view.')).toBeInTheDocument();
    await userEvent.click(within(region).getByRole('button', { name: 'Dismiss' }));
  },
};

/** Busy: a spinner while the work runs, then the result's toast with its action in its place. */
export const Busy: Story = {
  render: () => <BusyButton />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Export' }));
    const region = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[role="region"][aria-label="Notifications"]');
      if (found === null) throw new Error('no toast region');
      return found;
    });
    await expect(within(region).getByRole('progressbar', { name: 'Exporting People…' })).toBeInTheDocument();
    await waitFor(() => expect(within(region).getByRole('button', { name: 'Download' })).toBeInTheDocument());
    await expect(within(region).queryByText('Exporting People…')).not.toBeInTheDocument();
    await userEvent.click(within(region).getByRole('button', { name: 'Dismiss' }));
  },
};
