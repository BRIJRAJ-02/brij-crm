import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Field } from '../Field/Field.tsx';
import { Form } from '../Form/Form.tsx';
import { Modal, ModalTrigger } from './Modal.tsx';

const meta = {
  title: 'Molecules/Modal',
  component: Modal,
  args: { title: 'Delete 3 records?', children: null },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

function openDialog() {
  return waitFor(() => {
    const found = document.querySelector('[role="dialog"], [role="alertdialog"]');
    if (found === null) throw new Error('the modal did not open');
    return found;
  });
}

function DeleteConfirm({ onDelete }: { readonly onDelete?: () => void }) {
  return (
    <Modal
      title="Delete 3 records?"
      tone="danger"
      actions={
        <>
          <Button slot="close">Cancel</Button>
          <Button
            variant="danger-solid"
            icon="trash"
            slot="close"
            {...(onDelete === undefined ? {} : { onPress: onDelete })}
          >
            Delete records
          </Button>
        </>
      }
    >
      Their notes, tasks and history are deleted too. You can't undo this.
    </Modal>
  );
}

/** A destructive confirm, opened from the keyboard: focus moves in, Esc closes it and focus returns. */
export const Confirm: Story = {
  render: () => (
    <Stage>
      <ModalTrigger>
        <Button variant="danger" icon="trash">
          Delete
        </Button>
        <DeleteConfirm />
      </ModalTrigger>
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Delete' });
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const dialog = await openDialog();
    await expect(dialog).toHaveAttribute('role', 'alertdialog');
    await expect(dialog).toHaveAccessibleName('Delete 3 records?');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

/** The confirm, open. */
export const ConfirmOpen: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <ModalTrigger defaultOpen>
        <Button variant="danger" icon="trash">
          Delete
        </Button>
        <DeleteConfirm />
      </ModalTrigger>
    </Stage>
  ),
  play: async () => {
    await openDialog();
  },
};

/** A window for a larger task: an icon, the record it works on, and a close button. */
export const Window: Story = {
  render: () => (
    <Stage>
      <ModalTrigger defaultOpen>
        <Button icon="download">Export</Button>
        <Modal
          variant="window"
          title="Export"
          icon="download"
          context={
            <RecordChip
              display={{ objectId: 'lists', recordId: 'l1', name: 'Q4 pipeline', kind: 'other', hue: 'green' }}
              isFlat
            />
          }
          actions={
            <>
              <Button slot="close">Cancel</Button>
              <Button variant="primary" kbd="⌘↵">
                Export 248 deals
              </Button>
            </>
          }
        >
          <Checkbox label="Include archived deals" />
          <Checkbox label="Include notes" description="As a second sheet, one row per note." defaultSelected />
        </Modal>
      </ModalTrigger>
    </Stage>
  ),
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveAccessibleName('Export');
    await expect(dialog.querySelector('button[aria-label="Close"]')).not.toBeNull();
  },
};

/** A short form: a title bar with the close button, Cancel with its Esc keycap, Create with ⌘↵. */
function NewPersonDialog() {
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <Modal
      title="New person"
      actions={
        <>
          <Button slot="close" kbd="ESC">
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-person" kbd="⌘↵">
            Create
          </Button>
        </>
      }
    >
      <Form
        id="new-person"
        label="New person"
        onSubmit={() => {
          setError('Name the person.');
        }}
      >
        <Field label="Name" {...(error === undefined ? {} : { error })} />
      </Form>
    </Modal>
  );
}

/** A form dialog sits in the middle of the viewport, across and up and down, and stays there when an error line grows it. */
export const FormDialog: Story = {
  render: () => (
    <Stage>
      <ModalTrigger defaultOpen>
        <Button icon="plus">New person</Button>
        <NewPersonDialog />
      </ModalTrigger>
    </Stage>
  ),
  play: async ({ userEvent }) => {
    const dialog = await openDialog();
    await expect(dialog.querySelector('button[aria-label="Close"]')).not.toBeNull();
    // Settled after its entrance, then measured.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const centred = async (): Promise<void> => {
      const box = dialog.getBoundingClientRect();
      await expect(Math.abs(box.left + box.width / 2 - globalThis.innerWidth / 2)).toBeLessThanOrEqual(1);
      await expect(Math.abs(box.top + box.height / 2 - globalThis.innerHeight / 2)).toBeLessThanOrEqual(1);
    };
    await centred();
    const create = [...dialog.querySelectorAll('button')].find((button) => button.textContent.includes('Create'));
    if (create === undefined) throw new globalThis.Error('no Create button');
    await userEvent.click(create);
    await waitFor(() => expect(dialog.querySelector('[aria-invalid="true"]')).not.toBeNull());
    await centred();
  },
};

/** Saving: the title bar's close is disabled, and so is a click on the scrim, so what was typed stays. */
export const Busy: Story = {
  render: () => (
    <Stage>
      <Modal
        title="New person"
        isOpen
        isBusy
        actions={
          <>
            <Button slot="close" isDisabled>
              Cancel
            </Button>
            <Button variant="primary" isPending>
              Creating…
            </Button>
          </>
        }
      >
        <Field label="Name" defaultValue="Grace Hopper" />
      </Modal>
    </Stage>
  ),
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog.querySelector('button[aria-label="Close"]')).toHaveAttribute('disabled');
  },
};

/** An action about what the dialog shows (a task's Copy link) sits in the title bar before Close, with its tooltip. */
export const HeaderActions: Story = {
  render: () => (
    <Stage>
      <Modal
        title="Task"
        isOpen
        headerActions={
          <Tooltip content="Copy link">
            <Button variant="ghost" icon="link" label="Copy link" />
          </Tooltip>
        }
      >
        <Field label="Title" isWrapping defaultValue="Send the renewal proposal" />
      </Modal>
    </Stage>
  ),
  play: async () => {
    const dialog = await openDialog();
    const copy = dialog.querySelector('button[aria-label="Copy link"]');
    const close = dialog.querySelector('button[aria-label="Close"]');
    if (copy === null || close === null) throw new globalThis.Error('no header buttons');
    // Copy link comes first, on the same line as Close.
    await expect(copy.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await expect(Math.round(copy.getBoundingClientRect().top)).toBe(Math.round(close.getBoundingClientRect().top));
  },
};

/** A short word about what the dialog shows (a note's "Saved") sits before the header actions, quiet. */
export const Status: Story = {
  render: () => (
    <Stage>
      <Modal
        title="Kickoff call"
        variant="window"
        icon="notebook"
        isOpen
        status="Saved"
        headerActions={
          <Tooltip content="More actions">
            <Button variant="ghost" icon="ellipsis" label="More actions" />
          </Tooltip>
        }
      >
        <Field label="Title" isLabelHidden defaultValue="Kickoff call" />
      </Modal>
    </Stage>
  ),
  play: async () => {
    const dialog = await openDialog();
    const status = dialog.querySelector('[role="status"]');
    await expect(status).toHaveTextContent('Saved');
  },
};

/**
 * The peek: a page read and written in place (a note), as Notion's centre peek. A large panel nearly the window's
 * height, its quiet bar holding the record as a crumb, the status, More and Close, with no title drawn (the page
 * shows its own) and no hairline; the body a centred writing column.
 */
export const Peek: Story = {
  render: () => (
    <Stage>
      <Modal
        variant="peek"
        title="Kickoff call"
        icon="notebook"
        isOpen
        context={
          <RecordChip
            display={{ objectId: 'people', recordId: 'p1', name: 'Brijraj', kind: 'person', hue: 'blue' }}
            isFlat
          />
        }
        status="Saved"
        headerActions={
          <Tooltip content="More actions">
            <Button variant="ghost" icon="ellipsis" label="More actions" />
          </Tooltip>
        }
      >
        <Field label="Title" isLabelHidden variant="title" isWrapping defaultValue="Kickoff call" />
        They want 40 seats by March, and an EU workspace before they sign.
      </Modal>
    </Stage>
  ),
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveAccessibleName('Kickoff call');
    // Settled after its entrance, then measured: the column and three space-32 either side (or the window's width,
    // less the scrim's space-16), a size bar from the window's top and bottom (filling it under bp-page-compact).
    await new Promise((resolve) => setTimeout(resolve, 400));
    const panel = dialog.getBoundingClientRect();
    const token = (name: string) =>
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--${name}`));
    const inset = token('space-16');
    const wide = token('size-column-max') + 6 * token('space-32');
    await expect(Math.round(panel.width)).toBe(Math.min(globalThis.innerWidth - 2 * inset, wide));
    await expect(Math.round(panel.height)).toBe(
      globalThis.innerWidth >= token('bp-page-compact')
        ? globalThis.innerHeight - 2 * token('size-bar')
        : globalThis.innerHeight - 2 * inset,
    );
    // The bar draws no title, no icon and no hairline.
    const heading = dialog.querySelector('h2');
    await expect(heading?.getBoundingClientRect().width ?? 0).toBeLessThanOrEqual(1);
    const close = dialog.querySelector('button[aria-label="Close"]');
    const bar = close?.parentElement?.parentElement;
    if (bar === null || bar === undefined) throw new globalThis.Error('no bar');
    await expect(bar.querySelector(':scope > svg')).toBeNull();
    await expect(getComputedStyle(bar).borderBottomColor).toBe('rgba(0, 0, 0, 0)');
    await expect(dialog.querySelector('[role="status"]')).toHaveTextContent('Saved');
  },
};
