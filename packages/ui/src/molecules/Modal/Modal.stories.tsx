import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { Switch } from '../../atoms/Switch/Switch.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { useToasts } from '../../provider/context.ts';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Field } from '../Field/Field.tsx';
import { Form } from '../Form/Form.tsx';
import { MonthRangeCalendar } from '../DatePicker/DatePicker.tsx';
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
    // Enter never destroys: focus stays off the commit.
    await expect(within(dialog as HTMLElement).getByRole('button', { name: 'Delete records' })).not.toHaveFocus();
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

/** `aside`: a side pane beside a window's body, previewing what the body picks (the form template gallery). */
export const WindowAside: Story = {
  render: () => (
    <Stage>
      <ModalTrigger defaultOpen>
        <Button icon="clipboard-list">New form</Button>
        <Modal
          variant="window"
          isWide
          title="Start a form"
          icon="clipboard-list"
          aside={<p>The picked template, as a visitor sees it.</p>}
          actions={
            <>
              <Button slot="close">Cancel</Button>
              <Button variant="primary">Use Feedback</Button>
            </>
          }
        >
          <Checkbox label="Blank form" isReadOnly />
          <Checkbox label="Feedback" defaultSelected isReadOnly />
        </Modal>
      </ModalTrigger>
    </Stage>
  ),
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Start a form' });
    const pane = within(dialog).getByText('The picked template, as a visitor sees it.');
    // Beside the body on a wide window, never under it.
    if (globalThis.innerWidth >= 1024) {
      await expect(pane.getBoundingClientRect().left).toBeGreaterThan(
        within(dialog).getByText('Feedback').getBoundingClientRect().right,
      );
    }
  },
};

/** `lead`: a column at the body's start, beside the fields (the time off popup's month), stacked above them on a phone. */
export const WindowLead: Story = {
  render: () => (
    <Stage>
      <ModalTrigger defaultOpen>
        <Button icon="plus">Add time off</Button>
        <Modal
          variant="window"
          title="Add time off"
          lead={
            <MonthRangeCalendar
              label="Days"
              value={{ start: '2026-10-19', end: '2026-10-20' }}
              onChange={() => undefined}
              minValue="2026-10-08"
            />
          }
          actions={
            <>
              <Button slot="close">Cancel</Button>
              <Button variant="primary">Add time off</Button>
            </>
          }
        >
          <Field label="Note" />
        </Modal>
      </ModalTrigger>
    </Stage>
  ),
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add time off' });
    const month = within(dialog).getByRole('application', { name: /Days/ });
    const note = within(dialog).getByRole('textbox', { name: 'Note' });
    // Beside the fields on a wide screen, above them on a phone.
    if (globalThis.innerWidth >= 700) {
      await expect(note.getBoundingClientRect().left).toBeGreaterThan(month.getBoundingClientRect().right);
    } else {
      await expect(note.getBoundingClientRect().top).toBeGreaterThan(month.getBoundingClientRect().bottom);
    }
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
              <Button variant="primary">Export 248 deals</Button>
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

/**
 * A short form: a title bar with the close button, Cancel with its Esc keycap and Create with ⌘↵ (it submits a
 * library Form, which ⌘↵ submits from any control), both by default.
 */
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
    const submit = within(dialog as HTMLElement).getByRole('button', { name: 'Create' });
    await expect(submit.getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+Enter$/u);
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
            <Button variant="primary">Create person</Button>
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
      isWide ? globalThis.innerHeight - 2 * token('size-topbar') : globalThis.innerHeight,
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

/** A public page's sheet card (the guest menu's dish): a bottom sheet on a phone, a card centred over a wider window. */
export const SheetCard: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <Modal variant="sheet-card" title="Flat white" isOpen>
        A double shot with steamed milk.
      </Modal>
    </Stage>
  ),
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveAccessibleName('Flat white');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const panel = dialog.getBoundingClientRect();
    if (globalThis.innerWidth >= 480) {
      // Centred, never the window's width.
      await expect(panel.width).toBeLessThan(globalThis.innerWidth);
      await expect(Math.abs(panel.left - (globalThis.innerWidth - panel.right))).toBeLessThan(2);
    } else {
      await expect(Math.round(panel.bottom)).toBe(globalThis.innerHeight);
    }
  },
};

/** A public page's side sheet (the guest menu's picks): a bottom sheet on a phone, a panel at the end edge wider. */
export const SheetSide: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <Modal variant="sheet-side" title="Your picks" isOpen>
        Two flat whites and a bottle of Etna Rosso.
      </Modal>
    </Stage>
  ),
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveAccessibleName('Your picks');
    // Finish the slide in rather than wait it out: a test page pauses animations, and in WebKit a slow runner was
    // still mid slide after 400ms (10 Nov 2026).
    await settleAnimations();
    const panel = dialog.getBoundingClientRect();
    await expect(Math.round(panel.right)).toBe(globalThis.innerWidth);
    await expect(Math.round(panel.bottom)).toBe(globalThis.innerHeight);
  },
};

/** A drawer: a full height panel at the end edge for a long list, with the standard title bar and footer. */
export const Drawer: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <Modal variant="drawer" title="Members" isOpen actions={<Button slot="close">Done</Button>}>
        Ada Lovelace, Grace Hopper and Alan Turing share this rotation.
      </Modal>
    </Stage>
  ),
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveAccessibleName('Members');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const panel = dialog.getBoundingClientRect();
    // Full height, sitting on the end edge.
    await expect(Math.round(panel.height)).toBe(globalThis.innerHeight);
    await expect(Math.round(panel.right)).toBe(globalThis.innerWidth);
    await expect(within(dialog as HTMLElement).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  },
};

/** A drawer (or a sheet) whose Save raises a toast, the toast being what the person reads after pressing it. */
function DrawerSaving({ variant = 'drawer' }: { readonly variant?: 'drawer' | 'sheet' }) {
  const toasts = useToasts();
  return (
    <Modal
      variant={variant}
      title="Members"
      isOpen
      actions={
        <>
          <Button slot="close">Cancel</Button>
          <Button
            variant="primary"
            onPress={() => {
              toasts.toast({ tone: 'success', message: 'Members saved' });
            }}
          >
            Save
          </Button>
        </>
      }
    >
      Ada Lovelace, Grace Hopper and Alan Turing share this rotation.
    </Modal>
  );
}

/** Presses Save, then checks the toast it raised sits clear of the footer holding Save and Cancel. */
async function keepsToastOffFooter() {
  const dialog = await openDialog();
  await userEvent.click(within(dialog as HTMLElement).getByRole('button', { name: 'Save' }));
  const toast = await waitFor(() => {
    const found = document.querySelector('[data-toast-region] [role="alertdialog"]');
    if (found === null) throw new Error('no toast');
    return found;
  });
  await settleAnimations();
  const foot = within(dialog as HTMLElement).getByRole('button', { name: 'Save' }).parentElement;
  if (foot === null) throw new Error('no footer');
  await waitFor(async () => {
    const a = toast.getBoundingClientRect();
    const b = foot.getBoundingClientRect();
    const overlaps = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    await expect(overlaps).toBe(false);
  });
  await expect(toast).toHaveTextContent('Members saved');
}

/**
 * A toast raised while a drawer is open rises above the drawer's footer, so Save and Cancel stay in reach (a toast
 * sat on Save at the bottom right, 4 November 2026). The toast is still announced and still reachable by Tab.
 */
export const DrawerWithToast: Story = {
  render: () => (
    <Stage>
      <DrawerSaving />
    </Stage>
  ),
  play: keepsToastOffFooter,
};

/** A bottom sheet's buttons stay clear too: the toast rises above them. */
export const SheetWithToast: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <DrawerSaving variant="sheet" />
    </Stage>
  ),
  play: keepsToastOffFooter,
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

/**
 * A confirm for an end that destroys nothing (Sign out): a plain dialog, so a click outside still dismisses it. It
 * opens on its primary, which shows ↵, so Enter answers it.
 */
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
    const signOut = within(dialog as HTMLElement).getByRole('button', { name: 'Sign out' });
    await waitFor(() => expect(signOut).toHaveFocus());
    await expect(signOut).toHaveAttribute('aria-keyshortcuts', 'Enter');
  },
};

/** A form holding input (`isDismissable={false}`) dims the page with the full scrim, as an alert does. */
export const HoldsInput: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <Modal title="New person" isOpen isDismissable={false} actions={<Button slot="close">Cancel</Button>}>
        Something typed.
      </Modal>
    </Stage>
  ),
  play: async () => {
    await openDialog();
    await expect(document.querySelector('[data-holds-input]')).not.toBeNull();
  },
};

/**
 * `description`: one quiet line under the title saying what the dialog makes (New list), read as the dialog's
 * description.
 */
export const Description: Story = {
  render: () => (
    <Stage>
      <Modal
        title="New list"
        description="A hand-picked set of people, with its own stages and columns."
        isOpen
        isDismissable={false}
        actions={
          <>
            <Button slot="close">Cancel</Button>
            <Button variant="primary" type="submit" form="new-list">
              Create list
            </Button>
          </>
        }
      >
        <Form id="new-list" label="New list" onSubmit={() => undefined}>
          <Field label="Name" placeholder="e.g. Hiring pipeline" />
        </Form>
      </Modal>
    </Stage>
  ),
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveAccessibleDescription('A hand-picked set of people, with its own stages and columns.');
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

/**
 * A primary that acts on press, not a Form's submit (Edit social links' Save): the footer gives it ⌘↵ and presses it
 * on ⌘↵ from any control in the dialog, the value just typed included. While it is off, the key does nothing.
 */
export const PressKey: Story = {
  parameters: { crm: { screenshot: false } },
  render: function Render() {
    const [name, setName] = useState('');
    const [saved, setSaved] = useState<string | undefined>(undefined);
    return (
      <Stage>
        <Modal
          title="Edit social links"
          isOpen
          actions={
            <>
              <Button slot="close">Cancel</Button>
              <Button variant="primary" isDisabled={name === 'off'} onPress={() => setSaved(name)}>
                Save
              </Button>
            </>
          }
        >
          <Field label="Handle" value={name} onChange={setName} />
          <Switch label="Show on the page" />
          {saved !== undefined && <p>Saved {saved}</p>}
        </Modal>
      </Stage>
    );
  },
  play: async ({ userEvent }) => {
    const dialog = (await openDialog()) as HTMLElement;
    const save = within(dialog).getByRole('button', { name: 'Save' });
    const shortcut = save.getAttribute('aria-keyshortcuts') ?? '';
    await expect(shortcut).toMatch(/^(Meta|Control)\+Enter$/u);
    const mod = shortcut.startsWith('Meta') ? 'Meta' : 'Control';
    // Off: the key presses nothing.
    await userEvent.click(within(dialog).getByRole('textbox', { name: 'Handle' }));
    await userEvent.keyboard(`off{${mod}>}{Enter}{/${mod}}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(within(dialog).queryByText(/^Saved/u)).toBeNull();
    // From a text field, with what was just typed.
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Handle' }));
    await userEvent.keyboard(`ada{${mod}>}{Enter}{/${mod}}`);
    await waitFor(() => expect(within(dialog).getByText('Saved ada')).toBeVisible());
    // From a control that is not a text field.
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Show on the page' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Handle' }), 'x');
    within(dialog).getByRole('switch', { name: 'Show on the page' }).focus();
    await userEvent.keyboard(`{${mod}>}{Enter}{/${mod}}`);
    await waitFor(() => expect(within(dialog).getByText('Saved adax')).toBeVisible());
  },
};

/** An alert's commit destroys: no key presses it, so its primary-looking button shows none. */
export const AlertNoPressKey: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <Modal
        title="Remove this webhook?"
        tone="danger"
        isOpen
        actions={
          <>
            <Button slot="close">Cancel</Button>
            <Button variant="primary">Remove</Button>
          </>
        }
      >
        Deliveries stop at once.
      </Modal>
    </Stage>
  ),
  play: async () => {
    const dialog = (await openDialog()) as HTMLElement;
    await expect(within(dialog).getByRole('button', { name: 'Remove' })).not.toHaveAttribute('aria-keyshortcuts');
  },
};

/** A drawer holding typed changes (`isDirty`, spec 0073): Esc asks before throwing them away; Discard changes closes. */
export const DirtyDrawer: Story = {
  args: { onOpenChange: fn() },
  render: function DirtyDrawer(args) {
    const [isOpen, setOpen] = useState(true);
    const [name, setName] = useState('Haircut');
    return (
      <Stage>
        <Button onPress={() => setOpen(true)}>Edit service</Button>
        <Modal
          title="Edit service"
          variant="drawer"
          isOpen={isOpen}
          isDirty={name !== 'Haircut'}
          onOpenChange={(open) => {
            setOpen(open);
            args.onOpenChange?.(open);
          }}
          actions={
            <>
              <Button slot="close">Cancel</Button>
              <Button variant="primary">Save</Button>
            </>
          }
        >
          <Field label="Name" value={name} onChange={setName} />
        </Modal>
      </Stage>
    );
  },
  play: async ({ args, userEvent }) => {
    const drawer = await openDialog();
    const field = within(drawer as HTMLElement).getByRole('textbox', { name: 'Name' });
    await userEvent.click(field);
    await userEvent.keyboard(' and beard');
    await userEvent.keyboard('{Escape}');
    const ask = await waitFor(() => within(document.body).getByRole('alertdialog'));
    await expect(ask).toHaveAccessibleName('Discard your unsaved changes?');
    await expect(args.onOpenChange).not.toHaveBeenCalled();
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull());
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.click(within(drawer as HTMLElement).getByRole('button', { name: 'Cancel' }));
    const again = await waitFor(() => within(document.body).getByRole('alertdialog'));
    await userEvent.click(within(again).getByRole('button', { name: 'Discard changes' }));
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  },
};

/** Guarded inside a ModalTrigger: the trigger's own close asks too, and Discard changes closes it. */
export const DirtyInTrigger: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <ModalTrigger>
        <Button>Edit note</Button>
        <Modal title="Edit note" variant="form" isDirty actions={<Button slot="close">Cancel</Button>}>
          <Field label="Note" defaultValue="Call back Friday, changed" />
        </Modal>
      </ModalTrigger>
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Edit note' }));
    const dialog = await openDialog();
    await userEvent.click(within(dialog as HTMLElement).getByRole('button', { name: 'Cancel' }));
    const ask = await waitFor(() => within(document.body).getByRole('alertdialog'));
    await expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await userEvent.click(within(ask).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(document.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull());
  },
};

/** The same drawer with nothing changed: Esc closes it at once, with no question. */
export const CleanDrawer: Story = {
  args: { onOpenChange: fn() },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <Modal
        title="Edit service"
        variant="drawer"
        isOpen
        isDirty={false}
        {...(args.onOpenChange === undefined ? {} : { onOpenChange: args.onOpenChange })}
        actions={<Button slot="close">Done</Button>}
      >
        <Field label="Name" defaultValue="Haircut" />
      </Modal>
    </Stage>
  ),
  play: async ({ args, userEvent }) => {
    await openDialog();
    await userEvent.keyboard('{Escape}');
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
    await expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  },
};
