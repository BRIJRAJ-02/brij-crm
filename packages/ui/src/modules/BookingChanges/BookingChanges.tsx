import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Button, ButtonGroup } from '../../atoms/Button/Button.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import styles from './BookingChanges.module.css';
import { strings } from './strings.ts';

/** What adding a guest answered, as the page's client words it. */
export type GuestsOutcome =
  | { readonly kind: 'done'; readonly added: number }
  /** The address was refused: the line under the field. */
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

/** What removing a guest or cancelling answered: done, or a line to show. */
export type CancelOutcome = { readonly kind: 'done' } | { readonly kind: 'failed'; readonly message: string };

/** Which change is open. */
type Mode = 'idle' | 'move' | 'guests' | 'cancel';

/** Props for BookingChanges. */
export interface BookingChangesProps {
  readonly hostName: string;
  /** Everyone invited besides the guest themselves. */
  readonly guests: readonly string[];
  /** Move to another time is offered (the page takes bookings, and it has moves left). */
  readonly canMove: boolean;
  /** The picker Move opens: the page draws it (the booking page's own modules), with its commit bar. */
  readonly move: ReactNode;
  /** A quiet line under the picker: which clock its times are on ("Times in Dubai time (GMT+4)"). */
  readonly moveNote?: string;
  /** Opens this change first: the guest arrived from that link in their email. */
  readonly startsWith?: 'move' | 'cancel';
  /** The most guests a booking takes. */
  readonly maxGuests?: number;
  /** Invites one more person by email. */
  readonly onInvite: (email: string) => Promise<GuestsOutcome>;
  /** Takes a guest off. */
  readonly onRemove: (email: string) => Promise<CancelOutcome>;
  readonly onCancel: (reason: string) => Promise<CancelOutcome>;
}

/** A rough email shape; the server checks it properly. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A guest's changes to their booking (spec 0025, AC-675 to AC-677), after
 * the timefix app's guest page and the manage pages of Cal.com, Calendly and
 * GetYourGuide: "Need a change?" over one row of actions, Move to another
 * time and Guests as equal quiet disclosures (the open one held down and read
 * as expanded) and Cancel booking at the row's end as a quiet destructive
 * one. Each opens its panel (a named region) under the row, and focus moves
 * into it. Guests is one list (each
 * guest with Remove) over one email field whose Add, or Enter, invites them.
 * Cancel always asks first, with an optional reason.
 */
export function BookingChanges({
  hostName,
  guests,
  canMove,
  move,
  moveNote,
  startsWith,
  maxGuests = 10,
  onInvite,
  onRemove,
  onCancel,
}: BookingChangesProps) {
  const [mode, setMode] = useState<Mode>(startsWith === 'move' && !canMove ? 'idle' : (startsWith ?? 'idle'));
  const headingId = useId();
  const panelId = useId();
  const panelTitleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  // An opened panel takes focus, so a keyboard or a screen reader lands in it (not on arrival from an email link).
  // Keep it hands focus back to Cancel booking once the confirm is gone.
  const backToCancel = useRef(false);
  useEffect(() => {
    if (backToCancel.current) {
      backToCancel.current = false;
      cancelButton.current?.focus();
    } else if (opened.current) panel.current?.focus();
  }, [mode]);
  const toggle = (next: Mode) => () => {
    opened.current = true;
    setMode((current) => (current === next ? 'idle' : next));
  };

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.heading}>
          {strings.heading}
        </h2>
        <div className={styles.actions}>
          {canMove && (
            <Button icon="calendar-clock" isExpanded={mode === 'move'} controls={panelId} onPress={toggle('move')}>
              {strings.move}
            </Button>
          )}
          <Button icon="user-plus" isExpanded={mode === 'guests'} controls={panelId} onPress={toggle('guests')}>
            {guests.length > 0 ? strings.guestsCount(guests.length) : strings.addGuests}
          </Button>
          <span className={styles.end}>
            <Button
              ref={cancelButton}
              variant="danger"
              icon="circle-x"
              isExpanded={mode === 'cancel'}
              controls={panelId}
              onPress={toggle('cancel')}
            >
              {strings.cancelBooking}
            </Button>
          </span>
        </div>
      </div>
      {mode !== 'idle' && (
        <div
          ref={panel}
          id={panelId}
          role="region"
          aria-labelledby={panelTitleId}
          tabIndex={-1}
          className={styles.panel}
        >
          {mode === 'move' && (
            <>
              <h3 id={panelTitleId} className={styles.title}>
                {strings.pickNewTime}
              </h3>
              {move}
              {moveNote !== undefined && <p className={styles.note}>{moveNote}</p>}
            </>
          )}
          {mode === 'guests' && (
            <GuestsPanel
              titleId={panelTitleId}
              guests={guests}
              maxGuests={maxGuests}
              onInvite={onInvite}
              onRemove={onRemove}
            />
          )}
          {mode === 'cancel' && (
            <CancelPanel
              titleId={panelTitleId}
              hostName={hostName}
              onCancel={onCancel}
              onKeep={() => {
                backToCancel.current = true;
                setMode('idle');
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}

/** Guests: who is on it (each with Remove), then one email field whose Add, or Enter, invites them. */
function GuestsPanel({
  titleId,
  guests,
  maxGuests,
  onInvite,
  onRemove,
}: {
  readonly titleId: string;
  readonly guests: readonly string[];
  readonly maxGuests: number;
  readonly onInvite: (email: string) => Promise<GuestsOutcome>;
  readonly onRemove: (email: string) => Promise<CancelOutcome>;
}) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [failure, setFailure] = useState('');
  const [status, setStatus] = useState('');
  const [isAdding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | undefined>(undefined);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  // After an add or a remove: the field when it is there, else (the list full) the panel's title.
  const refocus = () => globalThis.requestAnimationFrame(() => (field.current ?? title.current)?.focus());
  const isFull = guests.length >= maxGuests;

  const add = async () => {
    const value = email.trim().toLowerCase();
    if (isAdding) return;
    if (!EMAIL.test(value)) {
      setError(strings.guestInvalid);
      return;
    }
    setAdding(true);
    setError('');
    setFailure('');
    setStatus('');
    const outcome = await onInvite(value);
    setAdding(false);
    if (outcome.kind === 'done') {
      setEmail('');
      setStatus(outcome.added === 0 ? strings.alreadyOn(value) : strings.invited(value));
      refocus();
    } else if (outcome.kind === 'invalid') setError(outcome.message);
    else setFailure(outcome.message);
  };
  const remove = async (guest: string) => {
    setRemoving(guest);
    setStatus('');
    setError('');
    setFailure('');
    const outcome = await onRemove(guest);
    setRemoving(undefined);
    if (outcome.kind === 'done') {
      setStatus(strings.removed(guest));
      refocus();
    } else setFailure(outcome.message);
  };

  return (
    <>
      <div className={styles.bar}>
        <h3 id={titleId} ref={title} tabIndex={-1} className={styles.title}>
          {strings.guests}
        </h3>
        <span className={styles.count}>{strings.count(guests.length, maxGuests)}</span>
      </div>
      {guests.length > 0 && (
        <ul className={styles.list} aria-labelledby={titleId}>
          {guests.map((guest) => (
            <li key={guest} className={styles.guest}>
              <Avatar name={guest} size="sm" isDecorative />
              <span className={styles.email}>{guest}</span>
              <Button
                variant="ghost"
                icon="x"
                label={strings.remove(guest)}
                isDisabled={removing !== undefined}
                onPress={() => void remove(guest)}
              />
            </li>
          ))}
        </ul>
      )}
      {isFull ? (
        <p className={styles.text}>{strings.full(maxGuests)}</p>
      ) : (
        <div className={styles.add}>
          <span className={styles.addField}>
            <Field
              ref={field}
              label={strings.addGuest}
              isLabelHidden
              name="guest"
              type="email"
              autoComplete="email"
              placeholder={strings.guestPlaceholder}
              maxLength={254}
              value={email}
              onChange={(next) => {
                setEmail(next);
                setError('');
              }}
              onSubmit={() => void add()}
              {...(error === '' ? {} : { error })}
            />
          </span>
          <Button size="lg" icon="plus" isPending={isAdding} onPress={() => void add()}>
            {isAdding ? strings.adding : strings.add}
          </Button>
        </div>
      )}
      {failure !== '' && (
        <Callout tone="danger" isAnnounced>
          {failure}
        </Callout>
      )}
      <p className={styles.status} role="status">
        {status}
      </p>
      <p className={styles.note}>{strings.guestsNote}</p>
    </>
  );
}

/** "Cancel this booking?", an optional reason, then Yes, cancel it or Keep it. */
function CancelPanel({
  titleId,
  hostName,
  onCancel,
  onKeep,
}: {
  readonly titleId: string;
  readonly hostName: string;
  readonly onCancel: (reason: string) => Promise<CancelOutcome>;
  readonly onKeep: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [isBusy, setBusy] = useState(false);
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        void onCancel(reason.trim()).then((outcome) => {
          // A done cancel replaces this panel with the cancelled booking; only a failure stays.
          if (outcome.kind === 'failed') {
            setBusy(false);
            setError(outcome.message);
          }
        });
      }}
    >
      <h3 id={titleId} className={styles.title}>
        {strings.cancelTitle}
      </h3>
      <p className={styles.text}>{strings.cancelText(hostName)}</p>
      <Field
        label={strings.reason}
        hint={strings.reasonHint(hostName)}
        isMultiline
        maxLength={500}
        value={reason}
        onChange={setReason}
        isDisabled={isBusy}
      />
      {error !== '' && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
      <ButtonGroup label={strings.cancelTitle} layout="row">
        <Button isDisabled={isBusy} onPress={onKeep}>
          {strings.keep}
        </Button>
        <Button type="submit" variant="danger-solid" isPending={isBusy}>
          {isBusy ? strings.cancelling : strings.confirmCancel}
        </Button>
      </ButtonGroup>
    </form>
  );
}
