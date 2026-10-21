// One schedule's hours, saved as they change (spec 0035, AC-970, AC-977; the owner's save rule, 21 October 2026:
// selects and switches save at once, with a quiet toast and Undo). The Availability tab's editor reads the schedule as
// the data layer holds it, so another tab's save shows at once; only hours not yet saved (a burst of changes, or a
// range that doesn't read yet) are held here. Saves go one at a time, each naming the version the last one stored, so
// a burst never refuses itself as stale; one beaten by another tab is said, and the stored hours show. The virtual
// default (AC-963) is stored the first time its hours change.
import { isDataError, type BookingAvailability, type DataLayer, type ScheduleView } from '@crm/data';
import { useEffect, useRef, useState } from 'react';
import { availabilityIsValid } from './hours.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings } from './strings.ts';

/** The longest name a schedule takes (AC-961). */
export const SCHEDULE_NAME_MAX = 60;

/** How long the hours wait after a change before they save, so a run of picks saves once. */
const SETTLE_MS = 500;

/** What a save says once it lands or fails. */
export interface ScheduleSaveNotice {
  readonly tone: 'success' | 'danger';
  readonly message: string;
  /** Undo (the hours before this save) or Try again. */
  readonly action?: { readonly label: string; readonly onAction: () => void };
}

/** What the editor needs. */
export interface ScheduleAutosave {
  /** The hours to show: those not saved yet while there are any, else the schedule's own. */
  readonly shown: BookingAvailability;
  /** Where the hours stand: saving, the last save failed (Try again is on its toast), or neither. */
  readonly status: 'idle' | 'saving' | 'failed';
  /** Changes the hours from what is shown now, so several changes in one event all land (Copy to days). */
  readonly change: (next: (current: BookingAvailability) => BookingAvailability) => void;
}

/** Props for `useScheduleAutosave`. */
export interface ScheduleAutosaveInput {
  readonly data: DataLayer;
  readonly slug: string;
  readonly schedule: ScheduleView;
  /** Whether the schedule is a colleague's (an admin's view, AC-971): the first save then names its member. */
  readonly forMember: boolean;
  /** Reads the member's schedules again: a save another tab beat shows theirs. */
  readonly reload: () => void;
  /**
   * The id the virtual default is about to be stored under, said before the save goes out: the data layer shows
   * the stored schedule at once, and a screen keyed by the schedule's id keeps this editor for it.
   */
  readonly onAdopt?: (id: string) => void;
  /** Said once a save lands or fails: the screen raises it as a toast. */
  readonly onNotice: (notice: ScheduleSaveNotice) => void;
}

/** One schedule's hours, saved as they change. */
export function useScheduleAutosave({
  data,
  slug,
  schedule,
  forMember,
  reload,
  onAdopt,
  onNotice,
}: ScheduleAutosaveInput): ScheduleAutosave {
  const [unsaved, setUnsaved] = useState<BookingAvailability | undefined>(undefined);
  const [status, setStatus] = useState<'idle' | 'saving' | 'failed'>('idle');
  // The save machinery's own bookkeeping, outside render: what is held, what is out, and the version it builds on.
  const held = useRef<BookingAvailability | undefined>(undefined);
  const before = useRef<BookingAvailability | undefined>(undefined);
  const latest = useRef(schedule);
  const isOut = useRef(false);
  const newId = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // An Undo pressed while a save was out: the chained save is the undo.
  const pendingUndo = useRef(false);
  const notice = useRef(onNotice);
  useEffect(() => {
    notice.current = onNotice;
  });
  useEffect(() => {
    // The held list moved (a save landed, another tab's arrived): the next save builds on it, unless one of ours is
    // out, whose answer is newer.
    if (!isOut.current) latest.current = schedule;
  }, [schedule]);

  const hold = (hours: BookingAvailability | undefined) => {
    held.current = hours;
    setUnsaved(hours);
  };

  const send = (isUndo: boolean) => {
    const hours = held.current;
    if (hours === undefined || !availabilityIsValid(hours)) return;
    if (isOut.current) {
      if (isUndo) pendingUndo.current = true;
      return;
    }
    const current = latest.current;
    const was = before.current ?? current.availability;
    isOut.current = true;
    setStatus('saving');
    let saving: Promise<ScheduleView>;
    if (current.id === null) {
      newId.current ??= data.schedules.newId();
      onAdopt?.(newId.current);
      saving = data.schedules.create(slug, current.memberId, {
        id: newId.current,
        name: current.name,
        timeZone: hours.timeZone,
        availability: hours,
        isDefault: true,
        forMember,
      });
    } else {
      saving = data.schedules.update(slug, current, { availability: hours });
    }
    saving.then(
      (stored) => {
        isOut.current = false;
        latest.current = stored;
        setStatus('idle');
        if (held.current !== hours) {
          // Changed while it saved: the newer hours go next, and its Undo still goes back to before the first.
          const undo = isUndo || pendingUndo.current;
          pendingUndo.current = false;
          send(undo);
          return;
        }
        hold(undefined);
        before.current = undefined;
        notice.current(
          isUndo
            ? { tone: 'success', message: scheduleStrings.hoursPutBack(stored.name) }
            : {
                tone: 'success',
                message: scheduleStrings.hoursSaved(stored.name),
                action: { label: scheduleStrings.undo, onAction: () => putBack(was) },
              },
        );
      },
      (error: unknown) => {
        isOut.current = false;
        pendingUndo.current = false;
        if (isDataError(error) && error.code === 'STALE') {
          setStatus('idle');
          // Another tab or person saved first: theirs shows, and saying so beats replacing it unseen.
          hold(undefined);
          before.current = undefined;
          reload();
          notice.current({ tone: 'danger', message: scheduleStrings.stale });
          return;
        }
        // Kept on screen, unsaved, with Try again; a change made meanwhile still goes once it settles.
        setStatus('failed');
        if (held.current !== hours) settle(false);
        notice.current({
          tone: 'danger',
          message: `${scheduleStrings.hoursFailed} ${isDataError(error) ? error.message : strings.somethingWrong}`,
          action: { label: scheduleStrings.tryAgain, onAction: () => send(isUndo) },
        });
      },
    );
  };

  const settle = (isUndo: boolean) => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      send(isUndo);
    }, SETTLE_MS);
  };

  const change = (next: (current: BookingAvailability) => BookingAvailability) => {
    const from = held.current ?? latest.current.availability;
    before.current ??= latest.current.availability;
    hold(next(from));
    settle(false);
  };

  const putBack = (hours: BookingAvailability) => {
    before.current = undefined;
    hold(hours);
    send(true);
  };

  // Closing the tab while hours wait or save asks first.
  const isHolding = unsaved !== undefined || status === 'saving';
  useEffect(() => {
    if (!isHolding) return undefined;
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    globalThis.addEventListener('beforeunload', ask);
    return () => globalThis.removeEventListener('beforeunload', ask);
  }, [isHolding]);

  // Leaving with hours still settling saves them now, rather than dropping them; hours that don't read yet say so.
  useEffect(
    () => () => {
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
        send(false);
      }
      if (held.current !== undefined && !availabilityIsValid(held.current)) {
        notice.current({ tone: 'danger', message: scheduleStrings.invalidLeft });
      }
    },
    // The save on leaving reads the refs as they are then; it is made once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return { shown: unsaved ?? schedule.availability, status, change };
}
