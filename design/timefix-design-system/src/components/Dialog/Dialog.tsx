import { Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Heading, Input, Label, Modal, ModalOverlay, TextField, type TextFieldProps } from 'react-aria-components';
import { useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Button, IconButton } from '../Button/Button.tsx';
import './Dialog.css';

/** How wide a dialog is: `sm` for a confirm, `md` (480) for a short form, `wide` (720) for a picker or a preview. */
export type DialogSize = 'sm' | 'md' | 'wide';

/** Props for Dialog. */
export interface DialogProps {
  /** Controlled open state; leave both off inside a DialogTrigger. */
  readonly isOpen?: boolean;
  readonly onOpenChange?: (isOpen: boolean) => void;
  /** The heading, which also names the dialog: a question or the task ("Invite people"). */
  readonly title: string;
  /** One line under the title. */
  readonly description?: ReactNode;
  readonly children?: ReactNode;
  /** The buttons, quiet way out first and the one primary last. A Button with `slot="close"` closes the dialog. */
  readonly actions?: ReactNode;
  readonly size?: DialogSize;
  /** Draws the × in the corner. Confirms leave it off: Cancel is their one way out. */
  readonly showClose?: boolean;
  /** Esc and a click on the scrim close it (they mean "keep editing"). On by default. */
  readonly isDismissable?: boolean;
  /** Overrides the accessible name when the visible title is not the best one. */
  readonly 'aria-label'?: string;
}

/** Opens the Dialog that follows its Button, and puts focus back on the Button when it closes. */
export function DialogTrigger({ children, isOpen, defaultOpen, onOpenChange }: { readonly children: ReactNode; readonly isOpen?: boolean; readonly defaultOpen?: boolean; readonly onOpenChange?: (isOpen: boolean) => void }) {
  return <AriaDialogTrigger isOpen={isOpen} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>{children}</AriaDialogTrigger>;
}

/** The modal surface over a scrim: one question or a short form, a single card with no header or footer bands. Scales up from 0.96 over 250ms, closes over 150ms. */
export function Dialog({ isOpen, onOpenChange, title, description, children, actions, size = 'md', showClose = true, isDismissable = true, 'aria-label': ariaLabel }: DialogProps) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={isDismissable} className="tf-scrim tf-overlay">
      <Modal className={cx('tf-dialog', `tf-dialog--${size}`)}>
        <AriaDialog className="tf-dialog__dialog" aria-label={ariaLabel}>
          <DialogContent title={title} description={description} actions={actions} showClose={showClose}>{children}</DialogContent>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

/** The inside of a Dialog: title, description, body and actions. Exported so docs and previews can draw a dialog in place, without a scrim. */
export function DialogContent({ title, description, children, actions, showClose = false, isStatic = false }: Pick<DialogProps, 'title' | 'description' | 'children' | 'actions' | 'showClose'> & { readonly isStatic?: boolean }) {
  return (
    <>
      {showClose && !isStatic && <IconButton slot="close" label="Close" size="sm" className="tf-dialog__close"><X size={16} strokeWidth={1.75} /></IconButton>}
      {isStatic ? <h2 className="tf-dialog__title">{title}</h2> : <Heading slot="title" className="tf-dialog__title">{title}</Heading>}
      {description !== undefined && <p className="tf-dialog__desc">{description}</p>}
      {children !== undefined && <div className="tf-dialog__body">{children}</div>}
      {actions !== undefined && <div className="tf-dialog__actions">{actions}</div>}
    </>
  );
}

/** Props for FullScreenDialog. */
export interface FullScreenDialogProps {
  readonly isOpen?: boolean;
  /** Esc asks to close (false): leave the task and go back. */
  readonly onOpenChange?: (isOpen: boolean) => void;
  readonly children: ReactNode;
  /** Names the task for assistive tech ("Sign in", "Set up your workspace"). */
  readonly 'aria-label': string;
  readonly className?: string;
}

/** A task that takes the whole window (sign in, first run): a real modal (focus stays inside, the app behind is hidden from assistive tech, Esc leaves) with no scrim or card. Fades in over 250ms, out over 150ms. */
export function FullScreenDialog({ isOpen = true, onOpenChange, children, 'aria-label': ariaLabel, className }: FullScreenDialogProps) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={false} className="tf-fullscreen">
      <Modal className="tf-fullscreen__modal">
        <AriaDialog className={cx('tf-fullscreen__dialog', className)} aria-label={ariaLabel}>{children}</AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

/** A dialog drawn in place, for documentation and previews. */
export function DialogPreview({ size = 'sm', ...rest }: Pick<DialogProps, 'title' | 'description' | 'children' | 'actions' | 'size'>) {
  return <div className={cx('tf-dialog', `tf-dialog--${size}`, 'tf-dialog--static')}><div className="tf-dialog__dialog"><DialogContent {...rest} isStatic /></div></div>;
}

/** Props for ConfirmDialog. */
export interface ConfirmDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** The question, naming the thing and the count ("Delete Acme Corp?", "Remove 3 records from Pipeline?"). */
  readonly title: string;
  /** One line: what happens and what does not. */
  readonly consequence: ReactNode;
  /** The verb that does it ("Delete company", "Sign out"). Never "OK" or "Yes". */
  readonly confirmLabel: string;
  /** `danger` (red) for delete, remove, disconnect, cancel; `primary` (ink) for sign out. */
  readonly tone?: 'danger' | 'primary';
  /** Runs the action. Return a promise to show a spinner until it settles; the dialog closes after. */
  readonly onConfirm: () => void | Promise<void>;
  readonly cancelLabel?: string;
}

/** One question, one primary action, one quiet way out. Only for sign out, delete, remove, disconnect and cancel; anything reversible gets Undo in a toast instead. Cancel takes focus first. */
export function ConfirmDialog({ isOpen, onOpenChange, title, consequence, confirmLabel, tone = 'danger', onConfirm, cancelLabel = 'Cancel' }: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const confirm = () => {
    const result = onConfirm();
    if (result instanceof Promise) {
      setPending(true);
      result.then(() => onOpenChange(false), () => undefined).finally(() => setPending(false));
    } else onOpenChange(false);
  };
  return (
    <Dialog isOpen={isOpen} onOpenChange={(o) => { if (!pending) onOpenChange(o); }} title={title} description={consequence} size="sm" showClose={false} isDismissable={!pending}
      actions={<>
        <Button variant="ghost" slot="close" autoFocus isDisabled={pending}>{cancelLabel}</Button>
        <Button variant={tone} isPending={pending} onPress={confirm}>{confirmLabel}</Button>
      </>}
    />
  );
}

/** A labelled text input for forms inside overlays (filled grey at rest, white with a blue edge on focus). */
export function DialogField({ label, hideLabel = false, placeholder, className, ...rest }: Omit<TextFieldProps, 'className' | 'children'> & { readonly label: string; readonly hideLabel?: boolean; readonly placeholder?: string; readonly className?: string }) {
  return (
    <TextField {...rest} className={cx('tf-dfield', className)}>
      <Label className={hideLabel ? 'tf-sr-only' : 'tf-dfield__label'}>{label}</Label>
      <Input className="tf-dfield__input" placeholder={placeholder} />
    </TextField>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
interface Row { readonly id: number; readonly value: string; readonly isNew: boolean }

/** Props for InviteDialog. */
export interface InviteDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** Gets the valid addresses; the dialog closes after. */
  readonly onInvite: (emails: readonly string[]) => void;
  readonly title?: string;
  readonly description?: ReactNode;
}

/** The form dialog: invite people by email, one row each, with "Add another" to grow the list. Enter sends. */
export function InviteDialog({ isOpen, onOpenChange, onInvite, title = 'Invite people', description = 'They get an email with a link to join this workspace.' }: InviteDialogProps) {
  const [rows, setRows] = useState<readonly Row[]>([{ id: 0, value: '', isNew: false }]);
  const [showErrors, setShowErrors] = useState(false);
  const valid = rows.map((r) => r.value.trim()).filter((v) => EMAIL.test(v));
  const hasBad = rows.some((r) => r.value.trim() !== '' && !EMAIL.test(r.value.trim()));
  const reset = () => { setRows([{ id: 0, value: '', isNew: false }]); setShowErrors(false); };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (hasBad) { setShowErrors(true); return; }
    if (valid.length === 0) return;
    onInvite(valid);
    onOpenChange(false);
    reset();
  };
  const label = valid.length > 1 ? `Send ${valid.length} invites` : 'Send invite';
  return (
    <Dialog isOpen={isOpen} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }} title={title} description={description}
      actions={<>
        <Button variant="ghost" slot="close">Cancel</Button>
        <Button variant="primary" isDisabled={valid.length === 0} onPress={() => submit()}>{label}</Button>
      </>}>
      <form className="tf-invite" onSubmit={submit} noValidate>
        {rows.map((r, i) => (
          <div key={r.id} className={cx('tf-invite__row', r.isNew && 'tf-invite__row--new')}>
            <div className="tf-invite__inner">
              <DialogField label={`Email ${i + 1}`} hideLabel type="email" placeholder="name@company.com" autoFocus={r.isNew || i === 0}
                value={r.value} isInvalid={showErrors && r.value.trim() !== '' && !EMAIL.test(r.value.trim())}
                onChange={(v) => setRows((list) => list.map((x) => (x.id === r.id ? { ...x, value: v } : x)))} />
              {rows.length > 1 && <IconButton label={`Remove email ${i + 1}`} size="sm" onPress={() => setRows((list) => list.filter((x) => x.id !== r.id))}><X size={14} strokeWidth={1.75} /></IconButton>}
            </div>
          </div>
        ))}
        {showErrors && hasBad && <p className="tf-invite__error" role="alert">Check the addresses in red.</p>}
        <div><Button variant="ghost" size="sm" icon={<Plus size={14} strokeWidth={1.75} />} onPress={() => setRows((list) => [...list, { id: (list[list.length - 1]?.id ?? 0) + 1, value: '', isNew: true }])}>Add another</Button></div>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}

/** One step of a StepDialog. */
export interface DialogStep {
  readonly title: string;
  readonly description?: ReactNode;
  readonly content: ReactNode;
  /** The primary's label on this step; "Continue" by default, the last step's should name the outcome ("Create page"). */
  readonly nextLabel?: string;
}

/** Props for StepDialog. */
export interface StepDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly steps: readonly DialogStep[];
  /** Called on the last step's primary; the dialog closes after. */
  readonly onFinish: () => void;
  /** Whether the current step's primary may be pressed (a required field is empty). */
  readonly canContinue?: (stepIndex: number) => boolean;
}

/** A short wizard in one dialog: steps slide side by side (8px, 250ms) while the card's height eases to the new step's. Back on later steps, Cancel on the first. */
export function StepDialog({ isOpen, onOpenChange, steps, onFinish, canContinue = () => true }: StepDialogProps) {
  const [index, setIndex] = useState(0);
  const close = (o: boolean) => { onOpenChange(o); if (!o) window.setTimeout(() => setIndex(0), 200); };
  const last = index === steps.length - 1;
  const step = steps[index];
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={close} isDismissable className="tf-scrim tf-overlay">
      <Modal className="tf-dialog tf-dialog--md">
        <AriaDialog className="tf-dialog__dialog" aria-label={step?.title}>
          <StepPages index={index} steps={steps} />
          <div className="tf-dialog__actions">
            <span className="tf-stepdlg__count tf-num" aria-live="polite">Step {index + 1} of {steps.length}</span>
            {index === 0 ? <Button variant="ghost" slot="close">Cancel</Button> : <Button variant="ghost" onPress={() => setIndex(index - 1)}>Back</Button>}
            <Button variant="primary" isDisabled={!canContinue(index)} onPress={() => { if (last) { onFinish(); close(false); } else setIndex(index + 1); }}>{step?.nextLabel ?? 'Continue'}</Button>
          </div>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

/** The sliding pages: every step stays mounted (inactive ones inert) so the slide can run both ways. */
function StepPages({ index, steps }: { readonly index: number; readonly steps: readonly DialogStep[] }) {
  const refs = useRef<Array<HTMLElement | null>>([]);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = refs.current[index];
    if (!el) return;
    setHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [index]);
  return (
    <div className="tf-stepdlg__pages" style={{ height } as CSSProperties}>
      {steps.map((s, i): ReactElement => (
        <section key={i} ref={(el) => { refs.current[i] = el; }} className="tf-stepdlg__page" data-state={i < index ? 'before' : i > index ? 'after' : 'current'} inert={i !== index} aria-hidden={i !== index}>
          <h2 className="tf-dialog__title">{s.title}</h2>
          {s.description !== undefined && <p className="tf-dialog__desc">{s.description}</p>}
          <div className="tf-stepdlg__content">{s.content}</div>
        </section>
      ))}
    </div>
  );
}
