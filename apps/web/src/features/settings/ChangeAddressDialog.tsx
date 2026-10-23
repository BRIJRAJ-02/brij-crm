// Brief
// Purpose: move the workspace to a new web address (Settings › Workspace › General's Change, SS-G3): rare, and it moves everyone.
// Main task: type the new address after "/w/", checked as typed with free ones offered, read what happens to old links, then Change address.
// Leaves out: a typed confirm (nothing is lost: old links keep working), and any other setting.
import { isDataError, type DataLayer } from '@crm/data';
import { Button, Callout, Field, Icon, Modal, Spinner, VisuallyHidden, type Toasts } from '@crm/ui';
import { useCallback, useMemo, useState } from 'react';
import { addressAsTyped, addressCandidates, SLUG_MAX } from '../address/address.ts';
import { useAddress } from '../address/useAddress.ts';
import { strings } from './workspace-strings.ts';

/** Props for the address dialog. */
export interface ChangeAddressDialogProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  /** The workspace's address now. */
  readonly slug: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** The workspace moved: the page opens at its new address. */
  readonly onMoved: (slug: string) => Promise<void>;
}

/**
 * A Modal holding the address Field (a quiet "/w/" before it; a spinner while it asks, a tick and "Free" once it's
 * free, "Taken" with free ones to pick under it), then what happens to links with the old address, then Cancel (ESC)
 * and Change address, which waits until the typed address is free. A click outside won't close it (it holds typing);
 * it stays open while the move saves, and a refusal shows on the field or above it. Mount it afresh for each opening,
 * so it starts from the address now.
 */
export function ChangeAddressDialog({ data, toasts, slug, isOpen, onClose, onMoved }: ChangeAddressDialogProps) {
  const [draft, setDraft] = useState(slug);
  const [isBusy, setBusy] = useState(false);
  // The server's refusal: on the field when it is about the address, above it otherwise.
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  // The address checked as typed, through the one address check; the workspace's own address counts as free.
  const check = useCallback(
    (candidate: string) => (candidate === slug ? Promise.resolve(true) : data.workspaces.slugAvailable(candidate)),
    [data, slug],
  );
  const candidates = useMemo(
    () => addressCandidates(draft.replaceAll('-', ' '), '').filter((each) => each !== slug),
    [draft, slug],
  );
  const address = useAddress(check, candidates, draft);
  const isEdited = draft !== slug;
  const state = isEdited ? address.state : undefined;
  const suggestions = isEdited ? address.suggestions : [];
  // A refusal outranks the check's answer: no tick beside it, and no "Free" said.
  const settled = fieldError === undefined ? state : undefined;
  const canMove = isEdited && settled === 'free' && !isBusy;
  const hint =
    state === 'invalid'
      ? strings.addressRule
      : state === 'checking'
        ? strings.addressChecking
        : state === 'free'
          ? strings.addressFree
          : state === 'unknown'
            ? strings.addressUnknown
            : undefined;
  const shownError = fieldError ?? (state === 'taken' ? strings.addressTaken : undefined);

  const type = (next: string) => {
    setDraft(next);
    setFieldError(undefined);
    setFailure(undefined);
  };
  const move = () => {
    if (!canMove) return;
    setBusy(true);
    setFailure(undefined);
    data.workspace.update(slug, { slug: draft }).then(
      async (updated) => {
        toasts.toast({ tone: 'success', message: strings.moved(updated.slug) });
        // The page opens at the new address, a new page in place of this one, which closes the dialog with it.
        await onMoved(updated.slug);
      },
      (error: unknown) => {
        setBusy(false);
        const message = isDataError(error) ? error.message : strings.somethingWrong;
        const field = isDataError(error) ? error.data?.refusals?.[0]?.field : undefined;
        if (isDataError(error) && (error.code === 'SLUG_TAKEN' || field === 'slug')) setFieldError(message);
        else setFailure(message);
      },
    );
  };

  return (
    <Modal
      title={strings.moveTitle}
      isOpen={isOpen}
      isBusy={isBusy}
      isDismissable={false}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" kbd="ESC" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" isDisabled={!canMove && !isBusy} isPending={isBusy} onPress={move}>
            {strings.moveAction}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      <Field
        label={strings.webAddress}
        autoComplete="off"
        // The dialog's one task, as the Invite dialog's address field.
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        autoFocus
        maxLength={SLUG_MAX}
        prefix={strings.addressPrefix}
        value={draft}
        onChange={(next) => {
          type(addressAsTyped(next));
        }}
        onSubmit={move}
        isReadOnly={isBusy}
        {...(hint === undefined || shownError !== undefined ? {} : { hint })}
        {...(shownError === undefined ? {} : { error: shownError })}
        {...(suggestions.length === 0
          ? {}
          : { suggestions: { label: strings.addressSuggestions, items: suggestions, onPick: type } })}
        {...(settled === 'checking'
          ? { suffix: <Spinner size="sm" label={strings.addressChecking} /> }
          : settled === 'free'
            ? { suffix: <Icon name="circle-check" size="sm" tone="success" /> }
            : {})}
      />
      {/* The answer is said once it settles, and a refusal when it comes; the field carries each on screen. */}
      <VisuallyHidden>
        <span role="status">
          {fieldError !== undefined
            ? fieldError
            : settled === 'free' || settled === 'taken'
              ? [
                  settled === 'free' ? strings.addressFreeSaid(draft) : strings.addressTakenSaid(draft),
                  ...(suggestions.length > 0 ? [strings.addressOthers(suggestions)] : []),
                ].join(' ')
              : ''}
        </span>
      </VisuallyHidden>
      {/* Where it moves, once the typed address is free; until then, what happens to the old one. */}
      <span>{canMove || isBusy ? strings.moveText(slug, draft) : strings.moveKept(slug)}</span>
    </Modal>
  );
}
