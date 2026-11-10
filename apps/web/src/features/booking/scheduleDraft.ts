// One schedule's hours, kept on screen until Save (spec 0035, AC-970, AC-977; the owner, 22 October 2026: the
// Availability tab saves like the booking page editor, with the Unsaved changes bar, Discard and Save). The editor
// reads the schedule as the data layer holds it, so another tab's save shows at once; only changes not saved yet are
// held here. A save names the version it builds on; one beaten by another tab is said, and the stored hours show. The
// virtual default (AC-963) is stored by its first save.
import { isDataError, type BookingAvailability, type DataLayer, type ScheduleView } from '@crm/data';
import { useEffect, useRef, useState } from 'react';
import { availabilityIsValid } from './hours.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings } from './strings.ts';

/** The longest name a schedule takes (AC-961). */
export const SCHEDULE_NAME_MAX = 60;

/** What a save says once it lands: the screen raises it as a toast. */
export interface ScheduleSaveNotice {
  readonly tone: 'success' | 'danger';
  readonly message: string;
}

/** What the editor needs. */
export interface ScheduleDraft {
  /** The hours to show: those not saved yet while there are any, else the schedule's own. */
  readonly shown: BookingAvailability;
  /** Changes not saved yet. */
  readonly isDirty: boolean;
  /** The hours read well enough to save (no range marked in red). */
  readonly isValid: boolean;
  readonly isSaving: boolean;
  /** Why the last save failed, while the changes wait on screen. */
  readonly error: string | undefined;
  /** Changes the hours from what is shown now, so several changes in one event all land (Copy to days). */
  readonly change: (next: (current: BookingAvailability) => BookingAvailability) => void;
  /** Saves the changes; answers whether they were stored (false when refused or with nothing to save). */
  readonly save: (given?: BookingAvailability) => Promise<boolean>;
  /** Puts the schedule's own hours back. */
  readonly discard: () => void;
  /**
   * Saves one change at once, apart from the changes waiting for Save (time off for some hours, its delete and its
   * Undo): it goes on top of the stored hours, and any unsaved hours keep it too. Answers whether it was stored.
   */
  readonly commit: (next: (current: BookingAvailability) => BookingAvailability) => Promise<boolean>;
}

/** Props for `useScheduleDraft`. */
export interface ScheduleDraftInput {
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
  /** Said once a save lands, or was beaten by another tab: the screen raises it as a toast. */
  readonly onNotice: (notice: ScheduleSaveNotice) => void;
}

/** One schedule's hours, held on screen until Save, put back by Discard. */
export function useScheduleDraft({
  data,
  slug,
  schedule,
  forMember,
  reload,
  onAdopt,
  onNotice,
}: ScheduleDraftInput): ScheduleDraft {
  const [unsaved, setUnsaved] = useState<BookingAvailability | undefined>(undefined);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const newId = useRef<string | undefined>(undefined);
  // The schedule and version the unsaved hours started from. A save checks against it, not against whatever the
  // list shows by then: another tab's save, a deleted schedule or a moved default mark mean the hours were meant for
  // something that is gone, and saying so beats writing them over it (STALE).
  const base = useRef<{ readonly id: string | null; readonly updatedAt: string | null } | undefined>(undefined);
  // The unsaved hours as last drawn: a save's answer keeps any change made while it was out.
  const latest = useRef<BookingAvailability | undefined>(undefined);
  // A save's answer may land after the editor went (another schedule opened): it then says nothing more.
  const isMounted = useRef(true);
  useEffect(() => {
    // Set here too, not only in the ref's start: StrictMode runs this effect's clean up and then the effect again.
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);
  const shown = unsaved ?? schedule.availability;
  useEffect(() => {
    latest.current = unsaved;
  }, [unsaved]);

  const change = (next: (current: BookingAvailability) => BookingAvailability) => {
    base.current ??= { id: schedule.id, updatedAt: schedule.updatedAt };
    setError(undefined);
    setUnsaved((current) => next(current ?? schedule.availability));
  };

  // One write at a time, Save and the changes saved at once alike, each on the version the last one stored (a delete,
  // then its Undo, before the list redraws; a Save still out when time off is added).
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const lastStored = useRef<ScheduleView | undefined>(undefined);
  const now = useRef(schedule);
  useEffect(() => {
    now.current = schedule;
  }, [schedule]);
  /** The newest version known: the list's, or the last answer when the list hasn't redrawn yet. */
  const newest = (): ScheduleView => {
    const stored = lastStored.current;
    return stored !== undefined &&
      stored.id === now.current.id &&
      (stored.updatedAt ?? '') > (now.current.updatedAt ?? '')
      ? stored
      : now.current;
  };
  const queue = (run: () => Promise<boolean>): Promise<boolean> => {
    const result = chain.current.then(run, run);
    chain.current = result;
    return result;
  };

  /** Saves the unsaved hours (or `given`, the virtual default's first save from a change saved at once). */
  const save = (given?: BookingAvailability): Promise<boolean> => {
    const hours = given ?? unsaved;
    if (hours === undefined || isSaving || !availabilityIsValid(hours)) return Promise.resolve(false);
    setSaving(true);
    setError(undefined);
    return queue(() => {
      const current = newest();
      const from = base.current ?? { id: current.id, updatedAt: current.updatedAt };
      if (from.id !== current.id) {
        // What the hours were meant for changed under them (another tab stored, deleted or moved it).
        setSaving(false);
        setUnsaved(undefined);
        base.current = undefined;
        reload();
        onNotice({ tone: 'danger', message: scheduleStrings.stale });
        return Promise.resolve(false);
      }
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
        // Against the version the changes started from, so a save another tab made meanwhile answers STALE.
        saving = data.schedules.update(
          slug,
          { ...current, updatedAt: from.updatedAt ?? current.updatedAt },
          { availability: hours },
        );
      }
      return saving.then(
        (stored) => {
          lastStored.current = stored;
          if (!isMounted.current) return true;
          setSaving(false);
          // Changes made while it was out stay unsaved, now on top of the stored version.
          if (latest.current === hours) {
            setUnsaved(undefined);
            base.current = undefined;
          } else {
            base.current = { id: stored.id, updatedAt: stored.updatedAt };
          }
          onNotice({ tone: 'success', message: scheduleStrings.hoursSaved(stored.name) });
          return true;
        },
        (failure: unknown) => {
          if (!isMounted.current) return false;
          setSaving(false);
          if (isDataError(failure) && failure.code === 'STALE') {
            // Another tab or person saved first: theirs shows, and saying so beats replacing it unseen.
            setUnsaved(undefined);
            base.current = undefined;
            reload();
            onNotice({ tone: 'danger', message: scheduleStrings.stale });
            return false;
          }
          // Kept on screen, unsaved; the bar says why and Save tries again.
          setError(`${scheduleStrings.hoursFailed} ${isDataError(failure) ? failure.message : strings.somethingWrong}`);
          return false;
        },
      );
    });
  };

  const discard = () => {
    setUnsaved(undefined);
    base.current = undefined;
    setError(undefined);
  };

  const commit = (next: (current: BookingAvailability) => BookingAvailability): Promise<boolean> => {
    // The virtual default isn't stored yet: the change joins its hours, and they are stored now, all together.
    if (schedule.id === null) {
      const hours = next(latest.current ?? schedule.availability);
      base.current ??= { id: schedule.id, updatedAt: schedule.updatedAt };
      latest.current = hours;
      setUnsaved(hours);
      return save(hours);
    }
    return queue(() => {
      const from = newest();
      return data.schedules.update(slug, from, { availability: next(from.availability) }).then(
        (answer) => {
          lastStored.current = answer;
          if (!isMounted.current) return true;
          if (latest.current !== undefined) {
            // Hours waiting for Save keep the change. They build on the version just stored only when they were
            // built on the one it replaced; otherwise their Save still answers STALE, so nobody's week is lost.
            setUnsaved((current) => (current === undefined ? current : next(current)));
            if (base.current?.updatedAt === from.updatedAt)
              base.current = { id: answer.id, updatedAt: answer.updatedAt };
          }
          return true;
        },
        (failure: unknown) => {
          // Said even once the editor has gone (an Undo pressed from the toast after opening another schedule).
          const isStale = isDataError(failure) && failure.code === 'STALE';
          if (isStale) reload();
          onNotice({
            tone: 'danger',
            message: isStale
              ? scheduleStrings.stale
              : `${scheduleStrings.hoursFailed} ${isDataError(failure) ? failure.message : strings.somethingWrong}`,
          });
          return false;
        },
      );
    });
  };

  return {
    shown,
    isDirty: unsaved !== undefined,
    isValid: availabilityIsValid(shown),
    isSaving,
    error,
    change,
    save,
    discard,
    commit,
  };
}
