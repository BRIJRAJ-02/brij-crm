// Brief
// Purpose: change the workspace's web address (Settings › Workspace › General, SS-G3): the one place it is typed, since it is rare and moves everyone.
// Main task: type the part after "/w/" (checked as typed, free ones offered when it's taken), read what happens to old links, then Change address.
// Leaves out: the name and time zone (they save on the page), and a typed confirm: nothing is lost, old links keep working.
import { isDataError, type DataLayer } from '@crm/data';
import { Button, Callout, Field, focusLater, Icon, Modal, Spinner, VisuallyHidden } from '@crm/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { addressAsTyped, addressCandidates, SLUG_MAX } from '../address/address.ts';
import { useAddress } from '../address/useAddress.ts';
import { strings } from './workspace-strings.ts';

/** Props for the address dialog. */
export interface ChangeAddressDialogProps {
  readonly data: DataLayer;
  /** The address the page was opened at, which the change is sent to. */
  readonly slug: string;
  /** The workspace's address now, which the field starts from. */
  readonly from: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** The workspace moved: the page says so and opens itself at the new address, or rejects when it couldn't. */
  readonly onMoved: (to: string) => Promise<void>;
}

/**
 * A Modal with the address Field after a quiet "/w/", checked as typed the way first run checks it (a spinner while
 * it asks, a tick and "Free", "Taken" with free ones to pick under it), the sentence on what happens to old links,
 * then Cancel (ESC) and Change address, which waits until a new address is free (or couldn't be checked: the server
 * checks it again). The field takes focus on opening, and once a new address is typed a click outside no longer
 * closes it. It stays open while the change is sent; a refusal shows on the field, anything else above it. If the
 * workspace moved but the page couldn't open there, it says so (announced, with focus on Cancel, which now reads
 * Close) and sends nothing more. Mount it afresh for each opening (a `key`), so the field starts from the address
 * again.
 */
export function ChangeAddressDialog({ data, slug, from, isOpen, onClose, onMoved }: ChangeAddressDialogProps) {
  const [draft, setDraft] = useState(from);
  const [isBusy, setBusy] = useState(false);
  // The server's refusal of the address, on the field; anything else that went wrong, in a Callout over it.
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  // Where the workspace moved, when the page then couldn't open there: a reload does, and a second change would be
  // sent to the old address.
  const [movedTo, setMovedTo] = useState<string | undefined>(undefined);
  // The address checked as typed, through the one address check; the workspace's own address counts as free.
  const check = useCallback(
    (candidate: string) => (candidate === from ? Promise.resolve(true) : data.workspaces.slugAvailable(candidate)),
    [data, from],
  );
  const candidates = useMemo(
    () => addressCandidates(draft.replaceAll('-', ' '), '').filter((each) => each !== from),
    [draft, from],
  );
  const address = useAddress(check, candidates, draft);
  // Change address turns disabled once the move is lost, so focus goes to Close rather than fall out of the dialog.
  const closeRef = useRef<HTMLButtonElement>(null);
  const isNew = draft !== from;
  // No check, hint or mark while the field still holds the address it has now.
  const state = isNew ? address.state : undefined;
  const suggestions = isNew ? address.suggestions : [];
  const canChange =
    isNew && refusal === undefined && movedTo === undefined && (state === 'free' || state === 'unknown');
  // "Moves from /w/a to /w/b" stays put while the address is checked, and goes only for one it can't move to.
  const saysWhere = isNew && refusal === undefined && movedTo === undefined && state !== 'invalid' && state !== 'taken';

  const commit = () => {
    if (!canChange || isBusy) return;
    setBusy(true);
    setRefusal(undefined);
    setFailure(undefined);
    data.workspace.update(slug, { slug: draft }).then(
      // The page moves to the new address, and this dialog goes with the old page.
      (updated) => {
        onMoved(updated.slug).catch(() => {
          // It moved, but the page couldn't open there: the dialog waits no longer, and says where it is now.
          setBusy(false);
          setMovedTo(updated.slug);
          focusLater(() => closeRef.current);
        });
      },
      (error: unknown) => {
        setBusy(false);
        const message = isDataError(error) ? error.message : strings.somethingWrong;
        const field = isDataError(error) ? error.data?.refusals?.[0]?.field : undefined;
        if (isDataError(error) && (error.code === 'SLUG_TAKEN' || field === 'slug')) setRefusal(message);
        else setFailure(message);
      },
    );
  };
  const pick = (next: string) => {
    setDraft(next);
    setRefusal(undefined);
  };

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
  const shown = refusal ?? (state === 'taken' ? strings.addressTaken : undefined);
  // A refusal outranks the check's answer: no tick beside it, and no "Free" said.
  const settled = refusal === undefined ? state : undefined;
  return (
    <Modal
      title={strings.moveTitle}
      isOpen={isOpen}
      // A typed address is only thrown away by Cancel or Esc.
      isDismissable={!isNew}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" kbd="ESC" ref={closeRef} isDisabled={isBusy}>
            {movedTo === undefined ? strings.cancel : strings.close}
          </Button>
          <Button variant="primary" isDisabled={!canChange} isPending={isBusy} onPress={commit}>
            {strings.moveAction}
          </Button>
        </>
      }
    >
      {movedTo !== undefined ? (
        <Callout tone="warning" isAnnounced>
          {strings.movedReload(movedTo)}
        </Callout>
      ) : (
        failure !== undefined && <Callout tone="danger">{failure}</Callout>
      )}
      <Field
        label={strings.webAddress}
        // Typing the address is the dialog's one job, so its field takes focus when it opens.
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        autoFocus
        isReadOnly={movedTo !== undefined}
        autoComplete="off"
        maxLength={SLUG_MAX}
        prefix={strings.addressPrefix}
        value={draft}
        onChange={(next) => {
          pick(addressAsTyped(next));
        }}
        onSubmit={commit}
        {...(hint === undefined || shown !== undefined ? {} : { hint })}
        {...(shown === undefined ? {} : { error: shown })}
        {...(suggestions.length === 0
          ? {}
          : { suggestions: { label: strings.addressSuggestions, items: suggestions, onPick: pick } })}
        {...(settled === 'checking'
          ? { suffix: <Spinner size="sm" label={strings.addressChecking} /> }
          : settled === 'free'
            ? { suffix: <Icon name="circle-check" size="sm" tone="success" /> }
            : {})}
      />
      {/* The answer is said once it settles, and a refusal when it comes; the field carries each on screen. */}
      <VisuallyHidden>
        <span role="status">
          {refusal !== undefined
            ? refusal
            : settled === 'free' || settled === 'taken'
              ? [
                  settled === 'free' ? strings.addressFreeSaid(draft) : strings.addressTakenSaid(draft),
                  ...(suggestions.length > 0 ? [strings.addressOthers(suggestions)] : []),
                ].join(' ')
              : ''}
        </span>
      </VisuallyHidden>
      {/* "Moves from /w/a to /w/b" unless the address can't be moved to; otherwise, what happens to the old one. */}
      <span>{saysWhere ? strings.moveText(from, draft) : strings.moveTextAny(from)}</span>
    </Modal>
  );
}
