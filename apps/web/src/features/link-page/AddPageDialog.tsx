// Brief
// Purpose: make a link page for someone who never signs up (9 Nov 2026): Taylor adds Nick and gets timefix.com/nick.
// Main task: type a name (the link follows it, checked as typed), an email if there is one, then Create page.
// Leaves out: inviting them (no email is sent), what the page holds (its own editor) and making it Live.
import { isDataError, type DataLayer, type TeamLinkPage } from '@crm/data';
import { Button, Callout, Field, Icon, Modal, sharedStrings, Spinner, VisuallyHidden } from '@crm/ui';
import { handleFromName, handleProblem, HANDLE_MAX } from '@crm/contracts/handles';
import { useEffect, useRef, useState } from 'react';
import { addressAsTyped } from '../address/address.ts';
import { publicBookingHost } from '../booking/links.ts';
import { teamStrings as strings } from './team-strings.ts';

/** How long after the last key the link is checked: the same pause the workspace address waits. */
const HANDLE_CHECK_DELAY_MS = 300;

/** A loose address check before anything is sent; the server checks it properly. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Where the typed link stands. */
type HandleState = 'empty' | 'invalid' | 'checking' | 'free' | 'taken' | 'unknown';

/** Props for Add a page. */
export interface AddPageDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** The page was made: its row as Team pages lists it. */
  readonly onAdded: (page: TeamLinkPage) => void;
}

/** The link a name makes, or nothing while there is no name. */
const handleOf = (name: string) => (name.trim() === '' ? '' : handleFromName(name.trim()));

/**
 * A Modal with Name, Email (optional) and the link after the public host. The link follows the name until it is edited
 * by hand, and is checked 300 ms after the last key (a spinner, then a tick and "Available"). A link made from the name
 * that is taken quietly becomes a free one the server suggests (nick-2); one typed by hand that is taken says so, with
 * the free one to pick. Create page sends once; a refusal lands on its field (a link taken meanwhile, an address in use), anything
 * else above the fields. Once something is typed, only Cancel or Esc throws it away. Mount it afresh for each opening.
 */
export function AddPageDialog({ data, slug, isOpen, onClose, onAdded }: AddPageDialogProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [typedHandle, setTypedHandle] = useState<string | undefined>(undefined);
  // A free link the server made from the name, when the name's own was taken: used while the link follows the name.
  const [auto, setAuto] = useState<{ readonly name: string; readonly handle: string } | undefined>(undefined);
  const handle = typedHandle ?? (auto?.name === name ? auto.handle : handleOf(name));
  const [checked, setChecked] = useState<{ readonly handle: string; readonly state: HandleState } | undefined>(
    undefined,
  );
  const [suggestion, setSuggestion] = useState<string | undefined>(undefined);
  const [problems, setProblems] = useState<{ name?: string; email?: string; handle?: string }>({});
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const emailRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const handleRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  // The link's rule first, then the server's answer once typing stops; an answer for an older link is dropped.
  const local: HandleState | undefined =
    handle === '' ? 'empty' : handleProblem(handle) !== undefined ? 'invalid' : undefined;
  useEffect(() => {
    if (local !== undefined) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      data.teamPages.checkHandle(slug, handle, controller.signal).then(
        (answer) => setChecked({ handle, state: answer.isFree ? 'free' : 'taken' }),
        () => {
          if (!controller.signal.aborted) setChecked({ handle, state: 'unknown' });
        },
      );
    }, HANDLE_CHECK_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [data, slug, handle, local]);
  const answered: HandleState = local ?? (checked?.handle === handle ? checked.state : 'checking');
  const isFollowing = typedHandle === undefined;
  // Following the name, a taken link waits for the free one to take its place rather than saying "Taken".
  const [suggestFailed, setSuggestFailed] = useState<string | undefined>(undefined);
  const state: HandleState =
    answered === 'taken' && isFollowing && auto?.name !== name && suggestFailed !== handle ? 'checking' : answered;

  // A taken link: one free one made from the name (or the link) by the server. Following the name, it takes the
  // link's place; typed by hand, it is offered to pick.
  useEffect(() => {
    if (answered !== 'taken') return;
    let isCurrent = true;
    data.teamPages.suggestHandle(slug, name.trim() === '' ? handle : name).then(
      (answer) => {
        if (!isCurrent) return;
        const free = answer.handle !== handle ? answer.handle : undefined;
        if (isFollowing && free !== undefined && auto?.name !== name) setAuto({ name, handle: free });
        else if (isFollowing && free === undefined) setSuggestFailed(handle);
        else setSuggestion(free);
      },
      () => {
        if (isCurrent) setSuggestFailed(handle);
      },
    );
    return () => {
      isCurrent = false;
      setSuggestion(undefined);
    };
  }, [data, slug, answered, handle, name, isFollowing, auto]);

  const isTyped = name !== '' || email !== '' || typedHandle !== undefined;

  const create = () => {
    if (isBusy) return;
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const found = {
      ...(trimmedName === '' ? { name: strings.nameMissing } : {}),
      ...(trimmedEmail !== '' && !EMAIL_SHAPE.test(trimmedEmail) ? { email: strings.emailInvalid } : {}),
      ...(handle === ''
        ? { handle: strings.handleMissing }
        : handleProblem(handle) !== undefined
          ? { handle: handleProblem(handle) }
          : state === 'taken'
            ? { handle: strings.handleTaken }
            : {}),
    };
    if (Object.keys(found).length > 0) {
      setProblems(found);
      // The first field with a problem takes focus, so the keyboard lands where the fix is.
      (found.name !== undefined ? nameRef : found.email !== undefined ? emailRef : handleRef).current?.focus();
      return;
    }
    setBusy(true);
    setProblems({});
    setFailure(undefined);
    data.teamPages
      .addPerson(slug, { name: trimmedName, ...(trimmedEmail === '' ? {} : { email: trimmedEmail }), handle })
      .then(onAdded, (error: unknown) => {
        setBusy(false);
        const message = isDataError(error) ? error.message : sharedStrings.couldntDoThat;
        const field = isDataError(error) ? error.data?.refusals?.[0]?.field : undefined;
        if (isDataError(error) && (error.code === 'SLUG_TAKEN' || field === 'handle')) {
          setProblems({ handle: message });
          setChecked({ handle, state: 'taken' });
          handleRef.current?.focus();
        } else if (field === 'email' || field === 'name') {
          setProblems({ [field]: message });
          (field === 'name' ? nameRef : emailRef).current?.focus();
        } else setFailure(message);
      });
  };

  const pickHandle = (next: string) => {
    setTypedHandle(next);
    setProblems((was) => ({ ...was, handle: undefined }));
  };

  const handleError = problems.handle ?? (state === 'taken' ? strings.handleTaken : undefined);
  const handleHint =
    handleError !== undefined
      ? undefined
      : state === 'invalid'
        ? handleProblem(handle)
        : state === 'checking'
          ? strings.handleChecking
          : state === 'free'
            ? strings.handleFree
            : state === 'unknown'
              ? strings.handleUnknown
              : undefined;

  return (
    <Modal
      title={strings.addTitle}
      description={strings.addText}
      isOpen={isOpen}
      isDismissable={!isTyped}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={isBusy} onPress={create}>
            {isBusy ? strings.adding : strings.addAction}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      <Field
        ref={nameRef}
        label={strings.nameLabel}
        name="name"
        // Naming the person is the dialog's first step, so its field takes focus when it opens.
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        autoFocus
        isRequired
        autoComplete="off"
        maxLength={80}
        value={name}
        isReadOnly={isBusy}
        onChange={(next) => {
          setName(next);
          setProblems((was) => ({
            ...was,
            name: undefined,
            ...(typedHandle === undefined ? { handle: undefined } : {}),
          }));
        }}
        onSubmit={create}
        {...(problems.name === undefined ? {} : { error: problems.name })}
      />
      <Field
        ref={emailRef}
        label={strings.emailLabel}
        labelAside={strings.emailAside}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="off"
        maxLength={254}
        value={email}
        isReadOnly={isBusy}
        hint={strings.emailHint}
        onChange={(next) => {
          setEmail(next);
          setProblems((was) => ({ ...was, email: undefined }));
        }}
        onSubmit={create}
        {...(problems.email === undefined ? {} : { error: problems.email })}
      />
      <Field
        ref={handleRef}
        label={strings.handleLabel}
        name="handle"
        isRequired
        autoComplete="off"
        maxLength={HANDLE_MAX}
        prefix={`${publicBookingHost()}/`}
        value={handle}
        isReadOnly={isBusy}
        onChange={(next) => pickHandle(addressAsTyped(next))}
        onSubmit={create}
        {...(handleHint === undefined ? {} : { hint: handleHint })}
        {...(handleError === undefined ? {} : { error: handleError })}
        {...(state === 'taken' && suggestion !== undefined
          ? { suggestions: { label: strings.handleSuggestions, items: [suggestion], onPick: pickHandle } }
          : {})}
        {...(handleError === undefined && state === 'checking'
          ? { suffix: <Spinner size="sm" label={strings.handleChecking} /> }
          : handleError === undefined && state === 'free'
            ? { suffix: <Icon name="circle-check" size="sm" tone="success" /> }
            : {})}
      />
      {/* The check's answer is said once it settles; the field carries it on screen. */}
      <VisuallyHidden>
        <span role="status">
          {state === 'free' ? strings.handleFreeSaid(handle) : state === 'taken' ? strings.handleTakenSaid(handle) : ''}
        </span>
      </VisuallyHidden>
    </Modal>
  );
}
