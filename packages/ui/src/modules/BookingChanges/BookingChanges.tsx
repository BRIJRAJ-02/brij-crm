import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { PersonLine } from '../../molecules/PersonLine/PersonLine.tsx';
import { InviteRows } from '../InviteRows/InviteRows.tsx';
import { createInviteRow, type InviteRow } from '../InviteRows/invite-rows.ts';
import styles from './BookingChanges.module.css';
import { strings } from './strings.ts';

/** What inviting guests answered, as the page's client words it. */
export type GuestsOutcome =
  | { readonly kind: 'done'; readonly added: number }
  /** An address was refused: the line under its row (`index`, the place among those sent), else under the first. */
  | { readonly kind: 'invalid'; readonly message: string; readonly index?: number }
  | { readonly kind: 'failed'; readonly message: string };

/** What removing a guest or cancelling answered: done, or a line to show. */
export type CancelOutcome = { readonly kind: 'done' } | { readonly kind: 'failed'; readonly message: string };

/** Which change is open under the row (Cancel asks in a dialog instead). */
type Mode = 'idle' | 'move' | 'guests';

/**
 * The words a page may put in place of the built in ones: a table reservation (spec 0066 B7) says "Change time" and
 * "Cancel reservation", and asks "Cancel your table for 4 at Somewhere?". Anything left out keeps the built in copy.
 */
export interface BookingChangesLabels {
  /** Move's button ("Move to another time"). */
  readonly move?: string;
  /** The picker's heading ("Pick a new time"). */
  readonly pickNewTime?: string;
  /** The row's cancel and the confirm's cancel ("Cancel booking"). */
  readonly cancel?: string;
  /** The confirm's dismiss ("Keep booking"). */
  readonly keep?: string;
  /** The confirm's question, whole ("Cancel Intro call with Ada Lovelace?"). */
  readonly cancelTitle?: string;
  /** The confirm's one sentence ("Ada will be told, and it comes off both calendars."). */
  readonly cancelText?: string;
}

/** Props for BookingChanges. */
export interface BookingChangesProps {
  /** The page's own words for move and cancel (see BookingChangesLabels). */
  readonly labels?: BookingChangesLabels;
  /** The booking's name ("Intro call"): the cancel confirm asks about it by name. */
  readonly title: string;
  readonly hostName: string;
  /** Everyone invited besides the guest themselves. */
  readonly guests: readonly string[];
  /** Move to another time is offered (the page takes bookings, and it has moves left). */
  readonly canMove: boolean;
  /** The picker Move opens: the page draws it (the booking page's own modules), with its commit bar. */
  readonly move: ReactNode;
  /** A quiet line under the picker: which clock its times are on ("Times in Dubai time (GMT+4)"). */
  readonly moveNote?: string;
  /**
   * Cancel is offered (spec 0062, AC-6202): false inside the page's cancel cutoff, when only the host can cancel it.
   * Defaults to true, as every page was before.
   */
  readonly canCancel?: boolean;
  /**
   * One line under the row when a change is the host's now (inside a cutoff): "Too close to the meeting to change it
   * here. Reply to your confirmation email."
   */
  readonly lockedNote?: string;
  /** Opens this change first: the guest arrived from that link in their email. */
  readonly startsWith?: 'move' | 'cancel';
  /**
   * The most guests a booking takes. `0` leaves the guests change out: a table reservation (spec 0066 B7) changes its
   * party size in Move instead.
   */
  readonly maxGuests?: number;
  /** Invites more people by email, every filled row at once. */
  readonly onInvite: (emails: readonly string[]) => Promise<GuestsOutcome>;
  /** Takes a guest off. */
  readonly onRemove: (email: string) => Promise<CancelOutcome>;
  readonly onCancel: (reason: string) => Promise<CancelOutcome>;
  /**
   * The booking is on a calendar (its event exists): only then does the cancel confirm say it comes off both
   * calendars (critic B-18). Left out, it says the host is told and the invite withdrawn.
   */
  readonly isOnCalendar?: boolean;
}

/** A guest's line has nothing under the address. */
const NO_META: readonly string[] = [];

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
 * Removing a guest and cancelling each ask first in a confirm dialog (the
 * house's ask first pattern), the cancel with an optional reason.
 */
export function BookingChanges({
  labels,
  title,
  hostName,
  guests,
  canMove,
  canCancel = true,
  lockedNote,
  move,
  moveNote,
  startsWith,
  maxGuests = 10,
  onInvite,
  onRemove,
  onCancel,
  isOnCalendar = false,
}: BookingChangesProps) {
  const [mode, setMode] = useState<Mode>(startsWith === 'move' && canMove ? 'move' : 'idle');
  // Arriving from the email's Cancel link opens the confirm straight away.
  const [isCancelOpen, setCancelOpen] = useState(startsWith === 'cancel' && canCancel);
  const headingId = useId();
  const panelId = useId();
  const panelTitleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  // An opened panel takes focus, so a keyboard or a screen reader lands in it (not on arrival from an email link).
  useEffect(() => {
    if (opened.current) panel.current?.focus();
  }, [mode]);
  const toggle = (next: Mode) => () => {
    opened.current = true;
    setMode((current) => (current === next ? 'idle' : next));
  };

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <div className={styles.head}>
        {/* The card's foot (the v5 mock): Reschedule, Guests and Cancel as quiet actions, the heading for screen readers. */}
        <VisuallyHidden>
          <h2 id={headingId}>{strings.heading}</h2>
        </VisuallyHidden>
        <div className={styles.actions}>
          {canMove && (
            <Button
              variant="ghost"
              icon="calendar-clock"
              isExpanded={mode === 'move'}
              controls={panelId}
              onPress={toggle('move')}
            >
              {labels?.move ?? strings.move}
            </Button>
          )}
          {maxGuests > 0 && (
            <Button
              variant="ghost"
              icon="user-plus"
              isExpanded={mode === 'guests'}
              controls={panelId}
              onPress={toggle('guests')}
            >
              {strings.guestsButton}
            </Button>
          )}
          {canCancel && (
            <span className={styles.end}>
              <Button ref={cancelButton} variant="ghost-danger" onPress={() => setCancelOpen(true)}>
                {labels?.cancel ?? strings.cancelBooking}
              </Button>
            </span>
          )}
        </div>
        {lockedNote !== undefined && <p className={styles.note}>{lockedNote}</p>}
      </div>
      {mode !== 'idle' && (
        <div
          // A change switched to another (Move to Guests) opens anew, so the band grows to its new content.
          key={mode}
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
                {labels?.pickNewTime ?? strings.pickNewTime}
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
        </div>
      )}
      <CancelDialog
        labels={labels}
        title={title}
        hostName={hostName}
        isOnCalendar={isOnCalendar}
        isOpen={isCancelOpen}
        onCancel={onCancel}
        onKeep={() => {
          setCancelOpen(false);
          // Back on Cancel booking, also when the dialog opened on arrival with nothing focused before it.
          focusLater(() => cancelButton.current);
        }}
      />
    </section>
  );
}

/**
 * Guests: who is on it (each with Remove, which asks first), then "Invite more" as the booking form's rows, one email
 * a row with its ×, and Invite, live once a row holds an address, which sends every filled row at once.
 */
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
  readonly onInvite: (emails: readonly string[]) => Promise<GuestsOutcome>;
  readonly onRemove: (email: string) => Promise<CancelOutcome>;
}) {
  const [rows, setRows] = useState<readonly InviteRow[]>(() => [createInviteRow()]);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState('');
  const [status, setStatus] = useState('');
  const [isAdding, setAdding] = useState(false);
  // The guest whose Remove is asking first.
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const title = useRef<HTMLHeadingElement>(null);
  const room = Math.max(0, maxGuests - guests.length);
  // The addresses the rows would invite: well formed, not on it already, each once, no more than there is room for.
  const known = new Set(guests.map((guest) => guest.toLowerCase()));
  const picked = rows.flatMap((row) => {
    const email = row.email.trim().toLowerCase();
    if (!EMAIL.test(email) || known.has(email)) return [];
    known.add(email);
    return [{ row, email }];
  });
  const toInvite = picked.slice(0, room);
  // Invite is live once any row holds text: a row it can't send says why under itself rather than leaving a pale button.
  const hasText = rows.some((row) => row.email.trim() !== '');
  /** Each filled row's problem: not an address, or someone already on it (said, never dropped in silence). */
  const rowProblems = (): Record<string, string> => {
    const onIt = new Set(guests.map((guest) => guest.toLowerCase()));
    return Object.fromEntries(
      rows.flatMap((row): (readonly [string, string])[] => {
        const email = row.email.trim().toLowerCase();
        if (email === '') return [];
        if (!EMAIL.test(email)) return [[row.id, strings.guestInvalid]];
        if (onIt.has(email)) return [[row.id, strings.alreadyOn]];
        return [];
      }),
    );
  };

  const invite = async () => {
    if (isAdding) return;
    // A filled row that can't go says so under itself, and nothing goes until it is fixed or removed.
    const problems = rowProblems();
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }
    if (toInvite.length === 0) return;
    setAdding(true);
    setErrors({});
    setFailure('');
    setStatus('');
    const emails = toInvite.map((each) => each.email);
    const outcome = await onInvite(emails);
    setAdding(false);
    if (outcome.kind === 'done') {
      setRows([createInviteRow()]);
      setStatus(outcome.added === 0 ? strings.alreadyOnAll : strings.invitedSome(emails));
      globalThis.requestAnimationFrame(() => title.current?.focus());
    } else if (outcome.kind === 'invalid') {
      const at = toInvite[outcome.index ?? 0] ?? toInvite[0];
      // The rows sent before the refused one went: they leave, so only what is still to send stays.
      const sent = new Set(toInvite.slice(0, outcome.index ?? 0).map((each) => each.row.id));
      if (sent.size > 0) setRows((current) => current.filter((row) => !sent.has(row.id)));
      if (at === undefined) setFailure(outcome.message);
      else setErrors({ [at.row.id]: outcome.message });
    } else setFailure(outcome.message);
  };
  const removed = (guest: string) => {
    setConfirming(undefined);
    setStatus(strings.removed(guest));
    // The row and its Remove are gone: the panel's title, once the dialog has closed.
    focusLater(() => title.current);
  };

  return (
    <>
      <div className={styles.bar}>
        <h3 id={titleId} ref={title} tabIndex={-1} className={styles.title}>
          {strings.guests}
        </h3>
        <span className={styles.count}>
          {/* Keyed by its words, so a new count swaps in place. */}
          <span key={guests.length} className={styles.swap}>
            {strings.count(guests.length, maxGuests)}
          </span>
        </span>
      </div>
      {guests.length > 0 && (
        <ul className={styles.guestList} aria-label={strings.invitedList}>
          {guests.map((guest) => (
            <li key={guest}>
              {/* One person as a line (PersonLine): the initial, the address cut with its tooltip, Remove at the end. */}
              <PersonLine
                id={guest}
                name={guest}
                meta={NO_META}
                size="sm"
                end={
                  <Button
                    variant="ghost"
                    label={strings.remove(guest)}
                    onPress={() => {
                      setStatus('');
                      setFailure('');
                      setConfirming(guest);
                    }}
                  >
                    {strings.removeShort}
                  </Button>
                }
              />
            </li>
          ))}
        </ul>
      )}
      {room === 0 ? (
        <p className={styles.text}>{strings.full(maxGuests)}</p>
      ) : (
        // The booking form's rows (the owner, 9 November 2026: one guest format everywhere).
        <InviteRows
          rows={rows}
          onChange={(next) => {
            setRows(next);
            // A row's problem goes once that row changes; the others keep theirs.
            setErrors((current) =>
              Object.fromEntries(
                Object.entries(current).filter(([id, _]) =>
                  next.some((row) => row.id === id && rows.find((each) => each.id === id)?.email === row.email),
                ),
              ),
            );
          }}
          onBlurRow={(id) => {
            const problem = rowProblems()[id];
            if (problem !== undefined) setErrors((current) => ({ ...current, [id]: problem }));
          }}
          max={room}
          fieldSize="lg"
          isDisabled={isAdding}
          errors={errors}
          onSubmit={() => void invite()}
          guests={{
            label: strings.inviteMore,
            aside: strings.upTo(room),
            first: strings.addGuests,
            another: strings.addAnother,
            rowLabel: strings.newGuestRow,
            full: strings.roomLeft(room),
            action: (
              <Button
                variant="primary"
                size="lg"
                isDisabled={!hasText}
                isPending={isAdding}
                onPress={() => void invite()}
              >
                {isAdding ? strings.adding : strings.invite(toInvite.length)}
              </Button>
            ),
          }}
        />
      )}
      {failure !== '' && (
        <Callout tone="danger" isAnnounced>
          {failure}
        </Callout>
      )}
      <p className={styles.status} role="status">
        {/* The region stays put for screen readers; what it says fades in each time it changes. */}
        {status !== '' && (
          <span key={status} className={styles.swap}>
            {status}
          </span>
        )}
      </p>
      <p className={styles.note}>{strings.guestsNote}</p>
      {confirming !== undefined && (
        <RemoveDialog
          guest={confirming}
          onRemove={onRemove}
          onDone={() => removed(confirming)}
          onDismiss={() => setConfirming(undefined)}
        />
      )}
    </>
  );
}

/** "Remove ann@…?": asks first, stays busy until the server answers, and shows a refusal inside. */
function RemoveDialog({
  guest,
  onRemove,
  onDone,
  onDismiss,
}: {
  readonly guest: string;
  readonly onRemove: (email: string) => Promise<CancelOutcome>;
  readonly onDone: () => void;
  readonly onDismiss: () => void;
}) {
  const [error, setError] = useState('');
  const [isBusy, setBusy] = useState(false);
  const remove = () => {
    if (isBusy) return;
    setBusy(true);
    setError('');
    void onRemove(guest).then((outcome) => {
      setBusy(false);
      if (outcome.kind === 'done') onDone();
      else setError(outcome.message);
    });
  };
  return (
    <Modal
      title={strings.removeTitle(guest)}
      variant="confirm"
      tone="danger"
      isOpen
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onDismiss();
      }}
      actions={
        <>
          {/* No keycap on a public page's dialog (critic A26): a guest isn't reading shortcuts. */}
          <Button slot="close" kbd={[]} isDisabled={isBusy}>
            {strings.dismiss}
          </Button>
          <Button variant="danger-solid" icon="x" isPending={isBusy} onPress={remove}>
            {isBusy ? strings.removing : strings.confirmRemove}
          </Button>
        </>
      }
    >
      {error !== '' && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
      <p>{strings.removeText}</p>
    </Modal>
  );
}

/**
 * "Cancel Intro call with Ada Lovelace?": one sentence, an optional reason the host sees, Keep booking (Esc) and
 * Cancel booking. Busy until the server answers; a done cancel redraws the receipt, a refusal shows here.
 */
function CancelDialog({
  labels,
  title,
  hostName,
  isOnCalendar,
  isOpen,
  onCancel,
  onKeep,
}: {
  readonly labels: BookingChangesLabels | undefined;
  readonly title: string;
  readonly hostName: string;
  readonly isOnCalendar: boolean;
  readonly isOpen: boolean;
  readonly onCancel: (reason: string) => Promise<CancelOutcome>;
  readonly onKeep: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [isBusy, setBusy] = useState(false);
  const cancel = () => {
    if (isBusy) return;
    setBusy(true);
    setError('');
    void onCancel(reason.trim()).then((outcome) => {
      // A done cancel replaces the changes with the cancelled booking; only a failure stays.
      if (outcome.kind === 'failed') {
        setBusy(false);
        setError(outcome.message);
      }
    });
  };
  return (
    <Modal
      title={labels?.cancelTitle ?? strings.cancelTitle(title, hostName)}
      tone="danger"
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onKeep();
      }}
      actions={
        <>
          <Button slot="close" kbd={[]} isDisabled={isBusy}>
            {labels?.keep ?? strings.keep}
          </Button>
          <Button variant="danger-solid" icon="circle-x" isPending={isBusy} onPress={cancel}>
            {isBusy ? strings.cancelling : (labels?.cancel ?? strings.confirmCancel)}
          </Button>
        </>
      }
    >
      {error !== '' && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
      <p>{labels?.cancelText ?? (isOnCalendar ? strings.cancelText(hostName) : strings.cancelTextPlain(hostName))}</p>
      <Field
        label={strings.reason}
        hint={strings.reasonHint(hostName)}
        isMultiline
        maxLength={500}
        value={reason}
        onChange={setReason}
        isDisabled={isBusy}
      />
    </Modal>
  );
}
