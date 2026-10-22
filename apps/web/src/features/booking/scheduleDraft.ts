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
  readonly save: () => void;
  /** Puts the schedule's own hours back. */
  readonly discard: () => void;
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

  const change = (next: (current: BookingAvailability) => BookingAvailability) => {
    setError(undefined);
    setUnsaved((current) => next(current ?? schedule.availability));
  };

  const save = () => {
    const hours = unsaved;
    if (hours === undefined || isSaving || !availabilityIsValid(hours)) return;
    setSaving(true);
    setError(undefined);
    let saving: Promise<ScheduleView>;
    if (schedule.id === null) {
      newId.current ??= data.schedules.newId();
      onAdopt?.(newId.current);
      saving = data.schedules.create(slug, schedule.memberId, {
        id: newId.current,
        name: schedule.name,
        timeZone: hours.timeZone,
        availability: hours,
        isDefault: true,
        forMember,
      });
    } else {
      saving = data.schedules.update(slug, schedule, { availability: hours });
    }
    saving.then(
      (stored) => {
        if (!isMounted.current) return;
        setSaving(false);
        setUnsaved(undefined);
        onNotice({ tone: 'success', message: scheduleStrings.hoursSaved(stored.name) });
      },
      (failure: unknown) => {
        if (!isMounted.current) return;
        setSaving(false);
        if (isDataError(failure) && failure.code === 'STALE') {
          // Another tab or person saved first: theirs shows, and saying so beats replacing it unseen.
          setUnsaved(undefined);
          reload();
          onNotice({ tone: 'danger', message: scheduleStrings.stale });
          return;
        }
        // Kept on screen, unsaved; the bar says why and Save tries again.
        setError(`${scheduleStrings.hoursFailed} ${isDataError(failure) ? failure.message : strings.somethingWrong}`);
      },
    );
  };

  const discard = () => {
    setUnsaved(undefined);
    setError(undefined);
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
  };
}
