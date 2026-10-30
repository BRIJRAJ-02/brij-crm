import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { Switch } from '../../atoms/Switch/Switch.tsx';
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
      variant="confirm"
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
      Their notes, tasks and history are deleted too. This can’t be undone.
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
    // What happens is the alert's description, said with its question.
    await expect(dialog).toHaveAccessibleDescription(
      'Their notes, tasks and history are deleted too. This can’t be undone.',
    );
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
    const dialog = await openDialog();
    // The footer: Cancel, then the primary, on one row at the end, the same height (on a phone they stack).
    const cancel = within(dialog as HTMLElement)
      .getByRole('button', { name: 'Cancel' })
      .getBoundingClientRect();
    const primary = within(dialog as HTMLElement)
      .getByRole('button', { name: 'Delete records' })
      .getBoundingClientRect();
    await expect(primary.top).toBe(cancel.top);
    await expect(primary.height).toBe(cancel.height);
    await expect(primary.left).toBeGreaterThan(cancel.right);
  },
};

/** A window for a larger task: an icon, the record it works on, and a close button. */
/** `isWide`: a 980px window for a reference with a rail beside its sections. */
export const WindowWide: Story = {
  render: () => (
    <Stage>
      <ModalTrigger defaultOpen>
        <Button icon="layout-grid">All features</Button>
        <Modal
          variant="window"
          isWide
          title="Everything in the product"
          icon="layout-grid"
          context="65 features"
          actions={
            <>
              <Button slot="close">Close</Button>
              <Button variant="primary">Get started</Button>
            </>
          }
        >
          <Checkbox label="Custom objects" defaultSelected isReadOnly />
          <Checkbox label="Saved views with filters, sorts and groups" defaultSelected isReadOnly />
        </Modal>
      </ModalTrigger>
    </Stage>
  ),
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Everything in the product' });
    const wide = getComputedStyle(document.documentElement).getPropertyValue('--size-dialog-wide').trim();
    const column = getComputedStyle(document.documentElement).getPropertyValue('--size-column').trim();
    await expect(Math.round(dialog.getBoundingClientRect().width)).toBe(
      Number.parseFloat(wide) + Number.parseFloat(column),
    );
  },
};

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

/** A short form: a title bar with the close button, Cancel with its Esc keycap and Create with ↵, both by default. */
function NewPersonDialog() {
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <Modal
      title="New person"
      actions={
        <>
          <Button slot="close">Cancel</Button>
          <Button variant="primary" type="submit" form="new-person">
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

/**
 * A control at the footer's start (`footerStart`): New record's "Create more", left of Cancel and Create. Out of the
 * screenshots until its baseline is taken in the pinned image (`pnpm test:visual --update`).
 */
export const FooterStart: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <Modal
        title="New person"
        isOpen
        footerStart={<Switch label="Create more" />}
        actions={
          <>
            <Button slot="close">Cancel</Button>
            <Button variant="primary" kbd="⌘↵">
              Create person
            </Button>
          </>
        }
      >
        <Field label="Name" />
      </Modal>
    </Stage>
  ),
  play: async ({ userEvent }) => {
    const dialog = await openDialog();
    const toggle = within(dialog as HTMLElement).getByRole('switch', { name: 'Create more' });
    await expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await expect(toggle).toBeChecked();
  },
};

/** Saving: the title bar's close is disabled, and a click on the scrim and Esc wait, so what was typed stays. */
export const Busy: Story = {
  args: { onOpenChange: fn() },
  render: (args) => (
    <Stage>
      <Modal
        title="New person"
        isOpen
        isBusy
        {...(args.onOpenChange === undefined ? {} : { onOpenChange: args.onOpenChange })}
        actions={
          <>
            <Button slot="close" isDisabled>
              Cancel
            </Button>
            <Button variant="primary" isPending>
              Creating
            </Button>
          </>
        }
      >
        <Field label="Name" defaultValue="Grace Hopper" />
      </Modal>
    </Stage>
  ),
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await expect(dialog.querySelector('button[aria-label="Close"]')).toHaveAttribute('disabled');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await expect(args.onOpenChange).not.toHaveBeenCalled();
  },
};

/**
 * A step that must be answered (two factor's backup codes): no Close in the title bar, and Esc and a click outside do
 * nothing until the tick lets Done end it. Left out of the screenshots: its face is Form Dialog's less the close
 * button, and the play checks that.
 */
export const MustAnswer: Story = {
  parameters: { crm: { screenshot: false } },
  args: { onOpenChange: fn() },
  render: (args) => (
    <MustAnswerDialog {...(args.onOpenChange === undefined ? {} : { onOpenChange: args.onOpenChange })} />
  ),
  play: async ({ args, userEvent }) => {
    const dialog = await openDialog();
    await expect(dialog.querySelector('button[aria-label="Close"]')).toBeNull();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await expect(args.onOpenChange).not.toHaveBeenCalled();
    const done = within(dialog as HTMLElement).getByRole('button', { name: 'Done' });
    await expect(done).toBeDisabled();
    await userEvent.click(within(dialog as HTMLElement).getByRole('checkbox', { name: 'I’ve saved these' }));
    await expect(done).toBeEnabled();
    await userEvent.click(done);
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
  },
};

function MustAnswerDialog({ onOpenChange }: { readonly onOpenChange?: (isOpen: boolean) => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <Stage>
      <Modal
        title="Save your backup codes"
        isOpen
        isDismissable={false}
        isClosable={saved}
        {...(onOpenChange === undefined ? {} : { onOpenChange })}
        actions={
          <Button variant="primary" slot="close" isDisabled={!saved}>
            Done
          </Button>
        }
      >
        Each code signs you in once. They won’t be shown again.
        <Checkbox label="I’ve saved these" isSelected={saved} onChange={setSaved} />
      </Modal>
    </Stage>
  );
}

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
    // Settled after its entrance, then measured: the column and three space-32 either side, a size bar from the
    // window's top and bottom; under bp-page-compact, the whole window.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const panel = dialog.getBoundingClientRect();
    const token = (name: string) =>
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--${name}`));
    const inset = token('space-16');
    const wide = token('size-column-max') + 6 * token('space-32');
    const isWide = globalThis.innerWidth >= token('bp-page-compact');
    await expect(Math.round(panel.width)).toBe(
      isWide ? Math.min(globalThis.innerWidth - 2 * inset, wide) : globalThis.innerWidth,
    );
    await expect(Math.round(panel.height)).toBe(
      isWide ? globalThis.innerHeight - 2 * token('size-bar') : globalThis.innerHeight,
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

/** A sheet: a phone's card for one thing, the window's width at its foot, Close alone in its bar. */
export const Sheet: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <Modal variant="sheet" title="Booking" isOpen isDismissable>
        Grace Hopper · Intro call, Friday, October 23 at 9:00 AM.
      </Modal>
    </Stage>
  ),
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveAccessibleName('Booking');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const panel = dialog.getBoundingClientRect();
    // The window's width, sitting on its foot.
    await expect(Math.round(panel.width)).toBe(globalThis.innerWidth);
    await expect(Math.round(panel.bottom)).toBe(globalThis.innerHeight);
    await expect(within(dialog as HTMLElement).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  },
};

/** The confirm's shape: no title bar, the question opening a 400px body, Cancel and the danger commit on one row. */
export const ConfirmShape: Story = {
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
    const dialog = await openDialog();
    // No close button: a confirm asks with its buttons only.
    await expect(dialog.querySelector('button[aria-label="Close"]')).toBeNull();
    await expect(within(dialog as HTMLElement).getByRole('heading', { name: 'Delete 3 records?' })).toBeInTheDocument();
    const width = getComputedStyle(document.documentElement).getPropertyValue('--size-dialog-sm').trim();
    await waitFor(() => expect(`${String(Math.round(dialog.getBoundingClientRect().width))}px`).toBe(width));
  },
};

/** A confirm for an end that destroys nothing (Sign out): a plain dialog, so a click outside still dismisses it. */
export const ConfirmPlain: Story = {
  render: () => (
    <Stage>
      <ModalTrigger defaultOpen>
        <Button>Sign out</Button>
        <Modal
          title="Sign out of Acme?"
          variant="confirm"
          actions={
            <>
              <Button slot="close">Cancel</Button>
              <Button variant="primary" slot="close">
                Sign out
              </Button>
            </>
          }
        >
          You can sign back in at any time.
        </Modal>
      </ModalTrigger>
    </Stage>
  ),
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveAttribute('role', 'dialog');
  },
};

/** `form`: a 560px dialog for several fields, as New record's. */
export const FormWide: Story = {
  render: () => (
    <Stage>
      <Modal
        title="New company"
        variant="form"
        icon="building"
        isOpen
        footerStart={<Switch label="Create more" />}
        actions={
          <>
            <Button slot="close">Cancel</Button>
            <Button variant="primary" type="submit" form="new-company">
              Create company
            </Button>
          </>
        }
      >
        <Form id="new-company" label="New company" onSubmit={() => undefined}>
          <Field label="Name" />
          <Field label="Domain" />
        </Form>
      </Modal>
    </Stage>
  ),
  play: async () => {
    const dialog = await openDialog();
    const width = getComputedStyle(document.documentElement).getPropertyValue('--size-dialog-form').trim();
    await waitFor(() => expect(`${String(Math.round(dialog.getBoundingClientRect().width))}px`).toBe(width));
  },
};

/** The footer's keys come by default: Cancel shows ESC, the submit ↵, and ⌘↵ once the dialog holds a long text. */
export const FooterKeys: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <Modal
        title="New note"
        isOpen
        actions={
          <>
            <Button slot="close">Cancel</Button>
            <Button variant="primary" type="submit" form="new-note">
              Add note
            </Button>
          </>
        }
      >
        <Form id="new-note" label="New note" onSubmit={() => undefined}>
          <Field label="Note" isMultiline />
        </Form>
      </Modal>
    </Stage>
  ),
  play: async () => {
    const dialog = await openDialog();
    const cancel = within(dialog as HTMLElement).getByRole('button', { name: 'Cancel' });
    await expect(cancel).toHaveAttribute('aria-keyshortcuts', 'Escape');
    const add = within(dialog as HTMLElement).getByRole('button', { name: 'Add note' });
    await waitFor(() => expect(add.getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+Enter$/u));
  },
};
