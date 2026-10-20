import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
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
