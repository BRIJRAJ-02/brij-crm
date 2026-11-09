// Brief
// Purpose: the host's changes to a booking from its card on Bookings (spec 0025, AC-640), after the timefix app's
// booking menu: Reschedule, Copy guest link, Link to a record and Unlink record (polish F2), Cancel booking.
// Main task: move a booking to another time its page offers, cancel it with a reason the guest is emailed, or file
// it under a deal or another record.
// Leaves out: Request reschedule (offering the guest times), editing the location and adding guests from here; the
// guest does those from their own page.
import {
  isDataError,
  type BookingAssignment,
  type BookingListItem,
  type ObjectSummary,
  type PublicSlots,
  type ReassignedBooking,
  type RecordRefDisplay,
  type RotationView,
} from '@crm/data';
import {
  Button,
  Callout,
  DayStrip,
  Field,
  focusLater,
  Form,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  SlotList,
  useFormatSettings,
  type ToastAction,
} from '@crm/ui';
import type { ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { zoneName } from '../../public/booking/time.ts';
import { clockTime, shortDay, zoneLabel } from './meeting-format.ts';
import { LinkRecordDialog } from './lazy-parts.tsx';
import { strings } from './strings.ts';
import { useNow } from './useNow.ts';

/** What the card's changes call: the data layer's, bound to the workspace by the route. */
export interface HostBookingActions {
  readonly cancel: (bookingId: string, reason: string) => Promise<void>;
  /** Moves a booking; with `minutes` (the week's drag on its foot) it takes a new length too. */
  readonly move: (bookingId: string, start: string, minutes?: number) => Promise<void>;
  /** The times a booking could move to in a range; with `minutes`, where it could be given that length. */
  readonly moveSlots: (bookingId: string, from: string, to: string, minutes?: number) => Promise<PublicSlots>;
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
  /** Adds or changes the meeting's link by hand (B-07): shown at once, the guest emailed; throws on a refusal. */
  readonly setMeetingLink?: (bookingId: string, url: string) => Promise<void>;
  /** Says how a change outside the card went (Copy guest link, a link taken off with its Undo). */
  readonly notify: (tone: 'success' | 'danger', message: string, action?: ToastAction) => void;
  /** Linking a booking to a record by hand (polish F2); left out, the card offers no link. */
  readonly linking?: BookingLinking;
}

/** What linking a booking to a record by hand needs (polish F2), bound to the workspace by the route. */
export interface BookingLinking {
  /** The workspace, whose records the picker searches. */
  readonly slug: string;
  /** The objects a booking may be linked to: those the member may change, but People and Companies, Deals first. */
  readonly objects: readonly ObjectSummary[];
  /** Links the booking, or takes the link off with `null`: shown at once, back on a refusal (which it throws). */
  readonly link: (bookingId: string, record: RecordRefDisplay | null) => Promise<void>;
  /** A record's page, for the linked record's chip. */
  readonly hrefOf: (record: RecordRefDisplay) => string | undefined;
}

/** How far ahead Reschedule looks: two weeks, as the timefix booking menu does. */
const MOVE_DAYS = 14;

/** What a refused link or unlink says: the server's words, else the plain line for which it was. */
function linkMessageOf(error: unknown, fallback: string = strings.linkFailed): string {
  return isDataError(error) && error.message !== '' ? error.message : fallback;
}

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

/**
 * A dialog the card's buttons open: Reschedule, Cancel booking (a confirm), Reassign and Host away's Reassign (both
 * drawn by its screen), or Link to a record.
 */
export type BookingAsk = 'move' | 'cancel' | 'reassign' | 'reassignAway' | 'link' | 'meetingLink';

/**
 * The card's changes in its footer, one row as Google Calendar's and Cal.com's event cards hold them (Join, before
 * them, is the card's own, so a reader without these still joins): Reschedule, then More (Copy guest link, Reassign,
 * Cancel booking in the danger tone, which still asks first); once it has started, Mark no show.
 * Reschedule and Cancel each open a dialog. The buttons are for a confirmed booking only. In a panel the dialogs open here, and stay while the booking shows
 * cancelled at once (the layer's optimistic cancel), so Cancel's confirm stays busy until the server answers. In a
 * popover (the week's card) they can't: a dialog must never open under the card it came from, so `onAsk` hands
 * them, Reassign too, to the screen, which closes the card first and draws the dialog itself.
 */
export function useBookingActions({
  booking,
  actions,
  onAsk,
  focusOnMount,
  onReassign,
}: {
  readonly booking: BookingListItem;
  readonly actions: HostBookingActions;
  /** Hands Reschedule, Cancel booking and Reassign to the screen; left out, they open here. */
  readonly onAsk?: (ask: BookingAsk) => void;
  /** The button to focus as the card opens again after the screen's dialog was dismissed. */
  readonly focusOnMount?: BookingAsk;
  /** Opens Reassign for a round robin booking an admin may hand to someone else (spec 0029, AC-748). */
  readonly onReassign?: () => void;
}): {
  readonly actions: ReactNode;
  readonly dialogs: ReactNode;
  /** Focuses More, when the footer has it: where focus goes when a control on the card goes away under it. */
  readonly focusMore?: () => void;
  /** The guest's link, read on the press, for the card's CopyButton. */
  readonly guestLink: () => Promise<string>;
  /**
   * Takes the hand made link off at once, with Undo (polish F2), when the card has More and the member may change the
   * link: the linked record's object is one they may link from. The card's row offers it as its ×; More holds it too.
   */
  readonly unlink?: () => void;
  /** Opens one of the card's dialogs (or hands it to the screen): the meeting popup's ⋯ menu asks through it. */
  readonly ask: (kind: BookingAsk) => void;
  /** Marks it a no show, or takes the mark back, once it has started (the popup's ⋯ menu). */
  readonly markNoShow: () => void;
  /** Whether a record may be linked from here, and the linked one unlinked (the popup's ⋯ menu). */
  readonly canLink: boolean;
  readonly canUnlinkRecord: boolean;
  /** It has started: Reschedule and Cancel are gone, Mark no show is offered. */
  readonly hasStarted: boolean;
} {
  const [open, setOpen] = useState<BookingAsk | undefined>(undefined);
  // Each opening mounts a fresh dialog (an empty reason, no old refusal).
  const [opens, setOpens] = useState(0);
  const moveRef = useRef<HTMLButtonElement>(null);
  // Cancel, beside Reschedule: focus goes back to it when its confirm is dismissed.
  const cancelRef = useRef<HTMLButtonElement>(null);
  // More (Link to a record, Reassign): where focus goes when a control on the card goes away under it.
  const moreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnMount === undefined) return;
    focusLater(() =>
      focusOnMount === 'move'
        ? moveRef.current
        : focusOnMount === 'cancel'
          ? cancelRef.current
          : (moreRef.current ?? cancelRef.current),
    );
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
  /**
   * The guest's link, read only on the press (it is the guest's key): CopyButton hands the clipboard the read itself
   * and says Copied in place, so no toast (C11). A refused read throws, and CopyButton says it couldn't copy.
   */
  const guestLink = () =>
    actions.guestLink(booking.id).then(({ path }) => new URL(path, globalThis.location.origin).toString());
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
  // Link to a record (polish F2), past or ahead, while there is an object to link from.
  const { linking } = actions;
  const canLink = (linking?.objects.length ?? 0) > 0;
  const linked = booking.linkedRecord;
  // Unlink only a record whose object the member may link from: on any other, the link isn't theirs to change.
  const canUnlink =
    linking !== undefined && linked !== undefined && linking.objects.some((object) => object.id === linked.objectId);
  // At once, with Undo (the owner's rule: an undoable removal stays one press). The control goes with the link, so
  // focus goes to More, which holds Link to a record.
  const unlink = () => {
    if (linking === undefined || linked === undefined) return;
    focusLater(() => moreRef.current ?? cancelRef.current);
    linking.link(booking.id, null).then(
      () => {
        actions.notify('success', strings.unlinkedToast(linked.name), {
          label: strings.undo,
          onAction: () => {
            linking.link(booking.id, linked).catch((error: unknown) => {
              actions.notify('danger', linkMessageOf(error));
            });
          },
        });
      },
      (error: unknown) => {
        actions.notify('danger', linkMessageOf(error, strings.unlinkFailed));
      },
    );
  };
  const linkItems = canLink ? (
    <>
      <MenuItem id="link" icon="link">
        {linked === undefined ? strings.linkRecord : strings.changeLinkedRecord}
      </MenuItem>
      {canUnlink && (
        <MenuItem id="unlink" icon="unlink">
          {strings.unlinkRecord}
        </MenuItem>
      )}
    </>
  ) : null;
  // One row, as Calendly's booking panel keeps it (B-06): Reschedule, Cancel beside it in the danger tone (still
  // asking first), then More holding Link to a record and Reassign. Join goes before them, from the card. Once
  // started, Mark no show, with More holding Link to a record.
  const moreMenu = (items: ReactNode) => (
    <MenuTrigger>
      <Button ref={moreRef} size="lg" variant="ghost" icon="ellipsis" label={strings.moreForBooking} />
      <Menu
        label={strings.moreForBooking}
        onAction={(key) => {
          if (key === 'reassign') {
            // In the week's popover the screen closes the card first, so Reassign never opens under it.
            if (onAsk === undefined) onReassign?.();
            else onAsk('reassign');
          } else if (key === 'link') ask('link');
          else if (key === 'unlink') unlink();
        }}
      >
        {items}
      </Menu>
    </MenuTrigger>
  );
  const footer = !isConfirmed ? undefined : hasStarted ? (
    <>
      <Button size="lg" icon="user-x" isPending={marking} onPress={() => void markNoShow()}>
        {booking.noShow === true ? strings.undoNoShow : strings.markNoShow}
      </Button>
      {canLink && moreMenu(linkItems)}
    </>
  ) : (
    <>
      {booking.reschedules < 5 && (
        <Button ref={moveRef} size="lg" icon="calendar-clock" onPress={() => ask('move')}>
          {strings.reschedule}
        </Button>
      )}
      <Button ref={cancelRef} size="lg" variant="danger" label={strings.cancelBooking} onPress={() => ask('cancel')}>
        {strings.cancelShort}
      </Button>
      {(canLink || onReassign !== undefined) &&
        moreMenu(
          <>
            {linkItems}
            {onReassign !== undefined && (
              <MenuItem id="reassign" icon="users-round">
                {strings.reassignAction}
              </MenuItem>
            )}
          </>,
        )}
    </>
  );
  const dialogs =
    onAsk === undefined && opens > 0 ? (
      <BookingDialog
        key={opens}
        booking={booking}
        actions={actions}
        ask={open}
        onClose={() => setOpen(undefined)}
        onDone={() => setOpen(undefined)}
      />
    ) : undefined;
  const hasMore = isConfirmed && (canLink || (!hasStarted && onReassign !== undefined));
  const hasFocusTarget = isConfirmed && (hasMore || !hasStarted);
  return {
    actions: footer,
    dialogs,
    guestLink,
    ask,
    markNoShow: () => void markNoShow(),
    canLink,
    canUnlinkRecord: canUnlink,
    hasStarted,
    ...(hasFocusTarget ? { focusMore: () => focusLater(() => moreRef.current ?? cancelRef.current) } : {}),
    ...(hasMore && canUnlink ? { unlink } : {}),
  };
}

/**
 * Reschedule or Cancel booking for one booking, drawn by its card (a panel) or by the screen once the card closed
 * (the week's popover). Mount one per opening (key it), and keep it while it closes, so Cancel's exit plays.
 */
export function BookingDialog({
  booking,
  actions,
  ask,
  onClose,
  onDone,
}: {
  readonly booking: BookingListItem;
  readonly actions: HostBookingActions;
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
    return ask === 'move' ? <MoveDialog booking={booking} actions={actions} onClose={onClose} onDone={onDone} /> : null;
  }
  if (shown === 'link') {
    // Linked, the card opens again showing the record, with focus back on More (`onClose`).
    return actions.linking === undefined ? null : (
      // Its own chunk (the field set's record picker brings every field editor): see `lazy-parts.tsx`.
      <LinkRecordDialog
        booking={booking}
        linking={actions.linking}
        notify={actions.notify}
        isOpen={ask === 'link'}
        onClose={onClose}
      />
    );
  }
  if (shown === 'meetingLink') {
    return actions.setMeetingLink === undefined || ask !== 'meetingLink' ? null : (
      <MeetingLinkDialog
        booking={booking}
        setMeetingLink={actions.setMeetingLink}
        notify={actions.notify}
        onClose={onClose}
      />
    );
  }
  return shown === 'cancel' ? (
    <CancelDialog booking={booking} actions={actions} isOpen={ask === 'cancel'} onClose={onClose} onDone={onDone} />
  ) : null;
}

/** Reschedule: the page's times for the next two weeks, days over times, and a commit that names the new time. */
function MoveDialog({
  booking,
  actions,
  onClose,
  onDone,
}: {
  readonly booking: BookingListItem;
  readonly actions: HostBookingActions;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  // The member's zone (their Preferences, else the browser's), the one the week is drawn in.
  const { timeZone: zone } = useFormatSettings();
  const [openedAt] = useState(() => Date.now());
  const [slots, setSlots] = useState<readonly string[] | undefined>(undefined);
  const [day, setDay] = useState<string | undefined>(undefined);
  const [time, setTime] = useState<string | undefined>(undefined);
  // The admin's clock is twelve hours (the redesign's ruling: "9:30 am" everywhere in Meetings).
  const hour12 = true;
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
  // Meetings' one way of writing them (meeting-format.ts): "Tue 10 Nov", "10:30 am".
  const today = dayOf(new Date(openedAt).toISOString(), zone);
  const dayName = (key: string) => shortDay(key, today);
  const timeName = (start: string) => clockTime(start, zone);
  const minutes = Math.round((Date.parse(booking.endsAt) - Date.parse(booking.startsAt)) / 60_000);
  // The guest's own clock under each time (B-05), when it reads differently from the member's: a move is never
  // made blind to their night. A zone this browser doesn't know shows nothing.
  const theirZone = booking.visitorTimeZone;
  const theirPlace = theirZone === '' ? '' : zoneName(theirZone).replace(/ time$/, '');
  const theirTimeOf = (start: string): string | undefined => {
    if (theirZone === '' || theirZone === zone) return undefined;
    try {
      const theirs = clockTime(start, theirZone);
      return theirs === timeName(start) ? undefined : theirs;
    } catch {
      return undefined;
    }
  };
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
      title={strings.rescheduleWith(firstNameOf(booking.visitorName))}
      // The zone the times are in, beside the title, as the offset is on the day shown (past a daylight saving change).
      context={strings.timesIn(
        zoneLabel(zone, shown === undefined ? openedAt : Date.parse(byDay.get(shown)?.[0] ?? '') || openedAt),
      )}
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
          <Button
            variant="primary"
            isDisabled={time === undefined}
            isPending={busy}
            onPress={move}
            {...(time === undefined ? {} : { label: strings.moveTo(timeName(time), dayName(dayOf(time, zone))) })}
          >
            {busy ? strings.moving : strings.reschedule}
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
            slots={(shown === undefined ? [] : (byDay.get(shown) ?? [])).map((start) => {
              const name = strings.slotName(timeName(start), shown === undefined ? '' : dayName(shown), minutes);
              const theirs = theirTimeOf(start);
              return {
                id: start,
                label: timeName(start),
                ...(theirs === undefined
                  ? { name }
                  : {
                      name: strings.slotTheirsName(name, theirs, theirPlace),
                      detail: strings.slotTheirs(theirs, theirPlace),
                    }),
              };
            })}
            value={time}
            onChange={setTime}
            hour12={hour12}
            layout="grid"
            isLoading={slots === undefined}
          />
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

/** A guest's first name, for a question or a toast ("Cancel meeting with Rahul?"). */
export const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * The one cancel confirm (the owner's ruling of 9 November 2026), from a row's ⋯ and from the popup alike: the
 * question, an optional note the guest's email carries, and Keep / Cancel meeting. It emails the guest, so there is no
 * Undo; the commit stays busy until the server answers, and a refusal shows here. Decline for a request is the same.
 */
export function CancelConfirm({
  guestName,
  isRequest = false,
  isOpen = true,
  onCancel,
  onClose,
}: {
  readonly guestName: string;
  /** A request: Decline, not Cancel meeting. */
  readonly isRequest?: boolean;
  /** Closing (its exit plays); the caller keeps it mounted until then. */
  readonly isOpen?: boolean;
  /** Cancels (or declines) with the note, rejecting with the refusal's words. */
  readonly onCancel: (note: string) => Promise<void>;
  readonly onClose: () => void;
}) {
  const first = firstNameOf(guestName);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const commit = () => {
    if (busy) return;
    setBusy(true);
    setError('');
    onCancel(note.trim()).then(
      () => setBusy(false),
      (caught: unknown) => {
        setBusy(false);
        setError(messageOf(caught));
      },
    );
  };
  return (
    <Modal
      variant="confirm"
      tone="danger"
      title={isRequest ? strings.declineRequestOf(first) : strings.cancelMeetingWith(first)}
      isOpen={isOpen}
      isBusy={busy}
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={busy}>
            {strings.keep}
          </Button>
          <Button variant="danger-solid" isPending={busy} onPress={commit}>
            {busy
              ? isRequest
                ? strings.declining
                : strings.cancelling
              : isRequest
                ? strings.decline
                : strings.cancelMeeting}
          </Button>
        </>
      }
    >
      {error !== '' && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
      <Field
        label={strings.noteTo(first)}
        labelAside={strings.optional}
        maxLength={500}
        value={note}
        onChange={setNote}
        isDisabled={busy}
        onSubmit={commit}
      />
    </Modal>
  );
}

/** Cancel meeting, from the popup's ⋯, a row's ⋯ or the week's card: the one compact confirm. */
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
  return (
    <CancelConfirm
      guestName={booking.visitorName}
      isOpen={isOpen}
      onClose={onClose}
      onCancel={(note) =>
        actions.cancel(booking.id, note).then(() => {
          actions.notify('success', strings.cancelledTold(firstNameOf(booking.visitorName)));
          onDone();
        })
      }
    />
  );
}

/** Whether a pasted meeting link is one the server takes: https, with a host name. */
function isMeetingLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname.includes('.');
  } catch {
    return false;
  }
}

/**
 * Add meeting link (B-07): a video call no calendar made a link for. The host pastes the call's https link; it shows on
 * the booking at once and the guest and their guests are emailed it. A refusal stays here, with what was typed.
 */
export function MeetingLinkDialog({
  booking,
  setMeetingLink,
  notify,
  onClose,
}: {
  readonly booking: BookingListItem;
  readonly setMeetingLink: (bookingId: string, url: string) => Promise<void>;
  readonly notify: HostBookingActions['notify'];
  readonly onClose: () => void;
}) {
  const formId = useId();
  const [url, setUrl] = useState(booking.videoUrl ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const isChange = booking.videoUrl !== undefined;
  const save = () => {
    if (busy) return;
    const link = url.trim();
    if (!isMeetingLink(link)) {
      setError(strings.meetingLinkInvalid);
      return;
    }
    setBusy(true);
    setError(undefined);
    setMeetingLink(booking.id, link).then(
      () => {
        notify('success', strings.meetingLinkSaved(booking.visitorName));
        onClose();
      },
      (caught: unknown) => {
        setBusy(false);
        setError(messageOf(caught));
      },
    );
  };
  const title = isChange ? strings.changeMeetingLink : strings.addMeetingLink;
  return (
    <Modal
      title={title}
      isOpen
      isBusy={busy}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={busy}>
            {strings.close}
          </Button>
          <Button variant="primary" type="submit" form={formId} kbd="⌘↵" isPending={busy}>
            {busy ? strings.savingMeetingLink : strings.saveMeetingLink}
          </Button>
        </>
      }
    >
      <Form id={formId} isBusy={busy} onSubmit={save} label={title}>
        <Field
          label={strings.meetingLinkField}
          hint={strings.meetingLinkHint(booking.visitorName)}
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder={strings.meetingLinkPlaceholder}
          value={url}
          onChange={(next) => {
            setUrl(next);
            setError(undefined);
          }}
          isDisabled={busy}
          {...(error === undefined ? {} : { error })}
        />
      </Form>
    </Modal>
  );
}
