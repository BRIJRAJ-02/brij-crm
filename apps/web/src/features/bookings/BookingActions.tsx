// Brief
// Purpose: the host's changes to a booking from its card on Bookings (spec 0025, AC-640), after the timefix app's
// booking menu: Reschedule, Copy guest link, Cancel booking.
// Main task: move a booking to another time its page offers, or cancel it with a reason the guest is emailed.
// Leaves out: Request reschedule (offering the guest times), editing the location and adding guests from here; the
// guest does those from their own page.
import { isDataError, type BookingListItem, type PublicSlots } from '@crm/data';
import { Button, ButtonGroup, Callout, DayStrip, Field, focusLater, Modal, SlotList } from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { strings } from './strings.ts';

/** What the card's changes call: the data layer's, bound to the workspace by the route. */
export interface HostBookingActions {
  readonly cancel: (bookingId: string, reason: string) => Promise<void>;
  readonly move: (bookingId: string, start: string) => Promise<void>;
  readonly moveSlots: (bookingId: string, from: string, to: string) => Promise<PublicSlots>;
  readonly guestLink: (bookingId: string) => Promise<{ readonly path: string }>;
  /** Says how a change outside the card went (Copy guest link). */
  readonly notify: (tone: 'success' | 'danger', message: string) => void;
}

/** How far ahead Reschedule looks: two weeks, as the timefix booking menu does. */
const MOVE_DAYS = 14;

/** A refusal's sentence for the member. */
function messageOf(error: unknown): string {
  if (!isDataError(error)) return strings.changeFailed;
  if (error.code === 'SLOT_TAKEN') return strings.timeGone;
  return error.message === '' ? strings.changeFailed : error.message;
}

/** A day key (`yyyy-MM-dd`) of an instant in the member's zone. */
function dayOf(instant: string, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(instant))
    .slice(0, 10);
  return parts;
}

/** A dialog the card's buttons open: Reschedule, or Cancel booking (a confirm). */
export type BookingAsk = 'move' | 'cancel';

/**
 * The card's changes: Reschedule, Copy guest link and Cancel booking; Reschedule and Cancel each open a dialog.
 * The buttons are for a confirmed booking only. In a panel the dialogs open here, and stay while the booking shows
 * cancelled at once (the layer's optimistic cancel), so Cancel's confirm stays busy until the server answers. In a
 * popover (the week's card) they can't: React Aria draws popovers above every dialog, so `onAsk` hands them to the
 * screen, which closes the card and draws `BookingDialog` itself.
 */
export function BookingActions({
  booking,
  actions,
  locale,
  onAsk,
  focusOnMount,
}: {
  readonly booking: BookingListItem;
  readonly actions: HostBookingActions;
  readonly locale: string;
  /** Hands Reschedule and Cancel booking to the screen; left out, they open here. */
  readonly onAsk?: (ask: BookingAsk) => void;
  /** The button to focus as the card opens again after the screen's dialog was dismissed. */
  readonly focusOnMount?: BookingAsk;
}) {
  const [open, setOpen] = useState<BookingAsk | undefined>(undefined);
  // Each opening mounts a fresh dialog (an empty reason, no old refusal).
  const [opens, setOpens] = useState(0);
  const [copying, setCopying] = useState(false);
  const moveRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnMount === undefined) return;
    focusLater(() => (focusOnMount === 'move' ? moveRef.current : cancelRef.current));
    // Only as the card opens again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ask = (kind: BookingAsk) => {
    if (onAsk !== undefined) {
      onAsk(kind);
      return;
    }
    setOpens((count) => count + 1);
    setOpen(kind);
  };
  // The link is read on demand (it is the guest's key), so the clipboard is handed the read itself while the press
  // still counts as the person's (Safari refuses a write made after an awaited request).
  const copy = async () => {
    setCopying(true);
    const url = actions.guestLink(booking.id).then(({ path }) => new URL(path, globalThis.location.origin).toString());
    try {
      if (typeof ClipboardItem === 'function') {
        await navigator.clipboard.write([
          new ClipboardItem({ 'text/plain': url.then((text) => new Blob([text], { type: 'text/plain' })) }),
        ]);
      } else {
        await navigator.clipboard.writeText(await url);
      }
      actions.notify('success', strings.guestLinkCopied);
    } catch (error) {
      actions.notify('danger', isDataError(error) ? messageOf(error) : strings.copyFailed);
    } finally {
      setCopying(false);
    }
  };
  return (
    <>
      {booking.status === 'confirmed' && (
        <ButtonGroup label={strings.changeBooking} layout="row">
          {booking.reschedules < 5 && (
            <Button ref={moveRef} icon="calendar-clock" onPress={() => ask('move')}>
              {strings.reschedule}
            </Button>
          )}
          <Button icon="link" isPending={copying} onPress={() => void copy()}>
            {strings.copyGuestLink}
          </Button>
          <Button ref={cancelRef} variant="danger" icon="circle-x" onPress={() => ask('cancel')}>
            {strings.cancelBooking}
          </Button>
        </ButtonGroup>
      )}
      {onAsk === undefined && opens > 0 && (
        <BookingDialog
          key={opens}
          booking={booking}
          actions={actions}
          locale={locale}
          ask={open}
          onClose={() => setOpen(undefined)}
          onDone={() => setOpen(undefined)}
        />
      )}
    </>
  );
}

/**
 * Reschedule or Cancel booking for one booking, drawn by its card (a panel) or by the screen once the card closed
 * (the week's popover). Mount one per opening (key it), and keep it while it closes, so Cancel's exit plays.
 */
export function BookingDialog({
  booking,
  actions,
  locale,
  ask,
  onClose,
  onDone,
}: {
  readonly booking: BookingListItem;
  readonly actions: HostBookingActions;
  readonly locale: string;
  /** The dialog open now; undefined while it closes. */
  readonly ask: BookingAsk | undefined;
  /** Dismissed: Keep booking, Keep this time, or Esc. */
  readonly onClose: () => void;
  /** It went through: the button that opened it may be gone, so the screen says where focus goes. */
  readonly onDone: () => void;
}) {
  // The dialog stays while it plays its exit.
  const [last, setLast] = useState(ask);
  if (ask !== undefined && ask !== last) setLast(ask);
  const shown = ask ?? last;
  if (shown === 'move') {
    return ask === 'move' ? (
      <MoveDialog booking={booking} actions={actions} locale={locale} onClose={onClose} onDone={onDone} />
    ) : null;
  }
  return shown === 'cancel' ? (
    <CancelDialog booking={booking} actions={actions} isOpen={ask === 'cancel'} onClose={onClose} onDone={onDone} />
  ) : null;
}

/** Reschedule: the page's times for the next two weeks, days over times, and a commit that names the new time. */
function MoveDialog({
  booking,
  actions,
  locale,
  onClose,
  onDone,
}: {
  readonly booking: BookingListItem;
  readonly actions: HostBookingActions;
  readonly locale: string;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [slots, setSlots] = useState<readonly string[] | undefined>(undefined);
  const [day, setDay] = useState<string | undefined>(undefined);
  const [time, setTime] = useState<string | undefined>(undefined);
  const [hour12, setHour12] = useState(
    () => new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12 ?? true,
  );
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  // Its time when the dialog opened: an optimistic move mustn't read the times again.
  const startsAt = useRef(booking.startsAt);
  // Whether the dialog is still up when a move answers (a move to another week takes its card away).
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    let live = true;
    const from = new Date().toISOString();
    const to = new Date(Date.now() + MOVE_DAYS * 86_400_000).toISOString();
    actions.moveSlots(booking.id, from, to).then(
      (answer) => {
        if (live) setSlots(answer.slots.map((slot) => slot.start).filter((start) => start !== startsAt.current));
      },
      (caught: unknown) => {
        if (!live) return;
        setSlots([]);
        setFailed(true);
        setError(messageOf(caught));
      },
    );
    return () => {
      live = false;
    };
    // The routes hold one set of calls per workspace, so this reads again only for another booking or Try again.
  }, [actions, booking.id, reload]);
  const byDay = new Map<string, string[]>();
  for (const start of slots ?? []) byDay.set(dayOf(start, zone), [...(byDay.get(dayOf(start, zone)) ?? []), start]);
  const days = [...byDay.keys()].sort();
  const shown = day !== undefined && byDay.has(day) ? day : days[0];
  const dayName = (key: string) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${key}T12:00:00Z`),
    );
  const timeName = (start: string) =>
    new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hour12, timeZone: zone }).format(
      new Date(start),
    );
  const minutes = Math.round((Date.parse(booking.endsAt) - Date.parse(booking.startsAt)) / 60_000);
  const move = () => {
    if (time === undefined) return;
    setBusy(true);
    setError('');
    actions.move(booking.id, time).then(
      () => {
        actions.notify('success', strings.movedToast(booking.visitorName));
        onDone();
      },
      (caught: unknown) => {
        // The card (and this dialog) may be gone: the refusal still has to be said.
        if (!mounted.current) {
          actions.notify('danger', messageOf(caught));
          return;
        }
        setBusy(false);
        setError(messageOf(caught));
        if (isDataError(caught) && caught.code === 'SLOT_TAKEN') {
          setTime(undefined);
          setSlots(undefined);
          setReload((count) => count + 1);
        }
      },
    );
  };
  return (
    <Modal
      title={strings.rescheduleTitle(booking.pageTitle, booking.visitorName)}
      isOpen
      isBusy={busy}
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={busy} kbd="ESC">
            {strings.keepTime}
          </Button>
          <Button variant="primary" isDisabled={time === undefined} isPending={busy} onPress={move}>
            {busy
              ? strings.moving
              : time === undefined
                ? strings.pickTime
                : strings.moveTo(timeName(time), dayName(dayOf(time, zone)))}
          </Button>
        </>
      }
    >
      {failed ? (
        <Callout
          tone="danger"
          isAnnounced
          actions={
            <Button
              onPress={() => {
                setError('');
                setFailed(false);
                setSlots(undefined);
                setReload((count) => count + 1);
              }}
            >
              {strings.tryAgain}
            </Button>
          }
        >
          {error}
        </Callout>
      ) : slots !== undefined && days.length === 0 ? (
        <Callout tone="info">{strings.noMoveTimes}</Callout>
      ) : (
        <>
          <DayStrip
            days={days}
            value={shown}
            onChange={(next) => {
              setDay(next);
              setTime(undefined);
            }}
          />
          <SlotList
            heading={shown === undefined ? strings.findingTimes : dayName(shown)}
            slots={(shown === undefined ? [] : (byDay.get(shown) ?? [])).map((start) => ({
              id: start,
              label: timeName(start),
              name: strings.slotName(timeName(start), shown === undefined ? '' : dayName(shown), minutes),
            }))}
            value={time}
            onChange={setTime}
            hour12={hour12}
            onHour12Change={setHour12}
            layout="grid"
            isLoading={slots === undefined}
          />
          <p>{strings.timesIn(zone)}</p>
        </>
      )}
      {!failed && error !== '' && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
    </Modal>
  );
}

/**
 * Cancel booking: asks first, naming the booking, with a reason the guest's email carries. The commit stays busy
 * until the server answers (the booking already shows cancelled behind it), and a refusal shows here.
 */
function CancelDialog({
  booking,
  actions,
  isOpen,
  onClose,
  onDone,
}: {
  readonly booking: BookingListItem;
  readonly actions: HostBookingActions;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cancel = () => {
    if (busy) return;
    setBusy(true);
    setError('');
    actions.cancel(booking.id, reason.trim()).then(
      () => {
        actions.notify('success', strings.cancelledToast(booking.visitorName));
        setBusy(false);
        onDone();
      },
      (caught: unknown) => {
        setBusy(false);
        setError(messageOf(caught));
      },
    );
  };
  return (
    <Modal
      title={strings.cancelTitle(booking.pageTitle, booking.visitorName)}
      tone="danger"
      isOpen={isOpen}
      isBusy={busy}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={busy} kbd="ESC">
            {strings.keepBooking}
          </Button>
          <Button variant="danger-solid" icon="circle-x" isPending={busy} onPress={cancel}>
            {busy ? strings.cancelling : strings.confirmCancel}
          </Button>
        </>
      }
    >
      <p>{strings.cancelText(booking.visitorName)}</p>
      <Field
        label={strings.reason}
        hint={strings.reasonHint(booking.visitorName)}
        isMultiline
        maxLength={500}
        value={reason}
        onChange={setReason}
        isDisabled={busy}
      />
      {error !== '' && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
    </Modal>
  );
}
