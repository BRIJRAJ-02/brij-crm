// Brief
// Purpose: the host's changes to a booking from its card on Bookings (spec 0025, AC-640), after the timefix app's
// booking menu: Reschedule, Copy guest link, Cancel booking.
// Main task: move a booking to another time its page offers, or cancel it with a reason the guest is emailed.
// Leaves out: Request reschedule (offering the guest times), editing the location and adding guests from here; the
// guest does those from their own page.
import {
  isDataError,
  type BookingAssignment,
  type BookingListItem,
  type PublicSlots,
  type ReassignedBooking,
  type RotationView,
} from '@crm/data';
import {
  Button,
  Callout,
  DayStrip,
  Field,
  focusLater,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  SlotList,
  useFormatSettings,
} from '@crm/ui';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { zoneDisplay } from '../../public/booking/time.ts';
import { strings } from './strings.ts';
import { useNow } from './useNow.ts';

/** What the card's changes call: the data layer's, bound to the workspace by the route. */
export interface HostBookingActions {
  readonly cancel: (bookingId: string, reason: string) => Promise<void>;
  readonly move: (bookingId: string, start: string) => Promise<void>;
  readonly moveSlots: (bookingId: string, from: string, to: string) => Promise<PublicSlots>;
  readonly guestLink: (bookingId: string) => Promise<{ readonly path: string }>;
  /** Why a round robin booking went to its host (spec 0029, AC-742); none for a personal page's booking. */
  readonly assignments: (bookingId: string) => Promise<readonly BookingAssignment[]>;
  /** Gives one round robin seat to someone else (spec 0029, AC-748). */
  readonly reassign: (
    bookingId: string,
    to: { readonly rotationId?: string; readonly memberId?: string; readonly memberName?: string },
  ) => Promise<ReassignedBooking>;
  /** The rotations the reader may see, for the reassign dialog's names. */
  readonly rotations: () => Promise<readonly RotationView[]>;
  /** Marks a past booking as a no show, or takes the mark back (spec 0043, AC-1613). */
  readonly markNoShow: (bookingId: string, noShow: boolean) => Promise<void>;
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
 * The card's changes in its footer, one row as Google Calendar's and Cal.com's event cards hold them (Join, before
 * them, is the card's own, so a reader without these still joins): Reschedule, then More (Copy guest link, Reassign,
 * Cancel booking in the danger tone, which still asks first); once it has started, Mark no show.
 * Reschedule and Cancel each open a dialog. The buttons are for a confirmed booking only. In a panel the dialogs open here, and stay while the booking shows
 * cancelled at once (the layer's optimistic cancel), so Cancel's confirm stays busy until the server answers. In a
 * popover (the week's card) they can't: React Aria draws popovers above every dialog, so `onAsk` hands them to the
 * screen, which closes the card and draws `BookingDialog` itself.
 */
export function useBookingActions({
  booking,
  actions,
  locale,
  onAsk,
  focusOnMount,
  onReassign,
}: {
  readonly booking: BookingListItem;
  readonly actions: HostBookingActions;
  readonly locale: string;
  /** Hands Reschedule and Cancel booking to the screen; left out, they open here. */
  readonly onAsk?: (ask: BookingAsk) => void;
  /** The button to focus as the card opens again after the screen's dialog was dismissed. */
  readonly focusOnMount?: BookingAsk;
  /** Opens Reassign for a round robin booking an admin may hand to someone else (spec 0029, AC-748). */
  readonly onReassign?: () => void;
}): { readonly actions: ReactNode; readonly dialogs: ReactNode } {
  const [open, setOpen] = useState<BookingAsk | undefined>(undefined);
  // Each opening mounts a fresh dialog (an empty reason, no old refusal).
  const [opens, setOpens] = useState(0);
  const [copying, setCopying] = useState(false);
  const moveRef = useRef<HTMLButtonElement>(null);
  // More, which holds Cancel booking: focus goes back to it when Cancel's confirm is dismissed.
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
  // A no show (spec 0043, AC-1613): once the meeting has started, its host marks it, and can take it back.
  const [marking, setMarking] = useState(false);
  const now = useNow();
  const hasStarted = Date.parse(booking.startsAt) <= now.getTime();
  const markNoShow = async () => {
    const noShow = booking.noShow !== true;
    setMarking(true);
    try {
      await actions.markNoShow(booking.id, noShow);
      actions.notify('success', noShow ? strings.markedNoShow : strings.unmarkedNoShow);
    } catch (error) {
      actions.notify('danger', messageOf(error));
    } finally {
      setMarking(false);
    }
  };
  const isConfirmed = booking.status === 'confirmed';
  // One row, as Google Calendar and Cal.com keep it: Reschedule, then More holding Copy guest link, Reassign and
  // Cancel booking (danger, still asking first). Join goes before them, from the card.
  const footer = !isConfirmed ? undefined : hasStarted ? (
    <Button size="lg" icon="user-x" isPending={marking} onPress={() => void markNoShow()}>
      {booking.noShow === true ? strings.undoNoShow : strings.markNoShow}
    </Button>
  ) : (
    <>
      {booking.reschedules < 5 && (
        <Button ref={moveRef} size="lg" icon="calendar-clock" onPress={() => ask('move')}>
          {strings.reschedule}
        </Button>
      )}
      <MenuTrigger>
        <Button
          ref={cancelRef}
          size="lg"
          variant="ghost"
          icon="ellipsis"
          label={strings.moreForBooking}
          isPending={copying}
        />
        <Menu
          label={strings.moreForBooking}
          onAction={(key) => {
            if (key === 'copy') void copy();
            else if (key === 'reassign') onReassign?.();
            else if (key === 'cancel') ask('cancel');
          }}
        >
          <MenuItem id="copy" icon="link">
            {strings.copyGuestLink}
          </MenuItem>
          {onReassign !== undefined && (
            <MenuItem id="reassign" icon="users-round">
              {strings.reassignAction}
            </MenuItem>
          )}
          <MenuItem id="cancel" icon="circle-x" isDanger>
            {strings.cancelBooking}
          </MenuItem>
        </Menu>
      </MenuTrigger>
    </>
  );
  const dialogs =
    onAsk === undefined && opens > 0 ? (
      <BookingDialog
        key={opens}
        booking={booking}
        actions={actions}
        locale={locale}
        ask={open}
        onClose={() => setOpen(undefined)}
        onDone={() => setOpen(undefined)}
      />
    ) : undefined;
  return { actions: footer, dialogs };
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
  // The member's zone (their Preferences, else the browser's), the one the week is drawn in.
  const { timeZone: zone } = useFormatSettings();
  const [openedAt] = useState(() => Date.now());
  const [slots, setSlots] = useState<readonly string[] | undefined>(undefined);
  const [day, setDay] = useState<string | undefined>(undefined);
  const [time, setTime] = useState<string | undefined>(undefined);
  // The member's own clock, as the rest of the app shows times; the 12h or 24h switch is the visitor's, on the
  // public page (the host's Reschedule follows the language, as Google Calendar follows its settings).
  const hour12 = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12 ?? true;
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
            layout="grid"
            isLoading={slots === undefined}
          />
          {/* The offset as it is on the day shown, which may be past a daylight saving change. */}
          <p>
            {strings.timesIn(
              zoneDisplay(zone, shown === undefined ? openedAt : Date.parse(byDay.get(shown)?.[0] ?? '') || openedAt),
            )}
          </p>
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
      {error !== '' && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
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
    </Modal>
  );
}
