// Brief
// Purpose: the host's changes to a booking from its card on Bookings (spec 0025, AC-640), after the timefix app's
// booking menu: Reschedule, Copy guest link, Cancel booking.
// Main task: move a booking to another time its page offers, or cancel it with a reason the guest is emailed.
// Leaves out: Request reschedule (offering the guest times), editing the location and adding guests from here; the
// guest does those from their own page.
import { isDataError, type BookingListItem, type PublicSlots } from '@crm/data';
import { Button, ButtonGroup, Callout, DayStrip, Field, Modal, SlotList } from '@crm/ui';
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

/** The card's changes: Reschedule, Copy guest link and Cancel booking; Reschedule and Cancel each open a dialog. */
export function BookingActions({
  booking,
  actions,
  locale,
}: {
  readonly booking: BookingListItem;
  readonly actions: HostBookingActions;
  readonly locale: string;
}) {
  const [open, setOpen] = useState<'move' | 'cancel' | undefined>(undefined);
  const [copying, setCopying] = useState(false);
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
      <ButtonGroup label={strings.changeBooking} layout="row">
        {booking.reschedules < 5 && (
          <Button icon="calendar-clock" onPress={() => setOpen('move')}>
            {strings.reschedule}
          </Button>
        )}
        <Button icon="link" isPending={copying} onPress={() => void copy()}>
          {strings.copyGuestLink}
        </Button>
        <Button variant="danger" icon="circle-x" onPress={() => setOpen('cancel')}>
          {strings.cancelBooking}
        </Button>
      </ButtonGroup>
      {open === 'move' && (
        <MoveDialog booking={booking} actions={actions} locale={locale} onClose={() => setOpen(undefined)} />
      )}
      {open === 'cancel' && <CancelDialog booking={booking} actions={actions} onClose={() => setOpen(undefined)} />}
    </>
  );
}

/** Reschedule: the page's times for the next two weeks, days over times, and a commit that names the new time. */
function MoveDialog({
  booking,
  actions,
  locale,
  onClose,
}: {
  readonly booking: BookingListItem;
  readonly actions: HostBookingActions;
  readonly locale: string;
  readonly onClose: () => void;
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
        onClose();
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
          <Button slot="close" isDisabled={busy}>
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

/** Cancel booking: asks first, with a reason the guest's email carries. */
function CancelDialog({
  booking,
  actions,
  onClose,
}: {
  readonly booking: BookingListItem;
  readonly actions: HostBookingActions;
  readonly onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cancel = () => {
    setBusy(true);
    setError('');
    actions.cancel(booking.id, reason.trim()).then(
      () => {
        actions.notify('success', strings.cancelledToast(booking.visitorName));
        onClose();
      },
      (caught: unknown) => {
        setBusy(false);
        setError(messageOf(caught));
      },
    );
  };
  return (
    <Modal
      title={strings.cancelTitle}
      tone="danger"
      isOpen
      isBusy={busy}
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={busy}>
            {strings.keepBooking}
          </Button>
          <Button variant="danger-solid" isPending={busy} onPress={cancel}>
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
