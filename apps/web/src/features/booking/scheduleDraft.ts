// One schedule's unsaved hours (spec 0035, AC-970, AC-977), shared by the screens that edit a schedule. The draft is
// undefined until the member changes something, so the screen shows the schedule as the data layer holds it and a
// save in another tab shows at once while nothing is being edited. A draft remembers the version it began from, and a
// save names it: a schedule changed elsewhere meanwhile is refused STALE rather than silently replaced, and the next
// Save replaces it knowingly. The virtual default (AC-963) is stored the first time it is saved.
import { isDataError, type BookingAvailability, type DataLayer, type ScheduleView } from '@crm/data';
import type { SaveBarStatus } from '@crm/ui';
import { useState } from 'react';
import { availabilityIsValid, sameHours } from './hours.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings } from './strings.ts';

/** The hours being edited, and the version they began from (undefined: whichever is current when saved). */
interface Draft {
  readonly hours: BookingAvailability;
  readonly base: string | null | undefined;
  /** The id the virtual default is stored under: minted once, so a retry stores it once. */
  readonly newId: string | undefined;
}

/** What a screen editing a schedule's hours needs. */
export interface ScheduleDraft {
  /** The hours to show: the draft while there is one, else the schedule's own. */
  readonly shown: BookingAvailability;
  readonly isDirty: boolean;
  /** For the SaveBar. */
  readonly status: SaveBarStatus;
  /** Why the last save failed, said on the SaveBar. */
  readonly error: string | undefined;
  /** False while a range is wrong: the SaveBar holds Save back and says why. */
  readonly isValid: boolean;
  /** Changes the hours from what the draft holds now, so several changes in one event all land (Copy to days). */
  readonly change: (next: (current: BookingAvailability) => BookingAvailability) => void;
  readonly save: () => void;
  readonly discard: () => void;
}

/** Props for `useScheduleDraft`. */
export interface ScheduleDraftInput {
  readonly data: DataLayer;
  readonly slug: string;
  readonly schedule: ScheduleView;
  /** Whether the schedule is a colleague's (an admin's view, AC-971): the first save then names its member. */
  readonly forMember: boolean;
  /** Reads the member's schedules again: a first save another tab beat is said as stale, then read. */
  readonly reload: () => void;
  /**
   * The id the virtual default is about to be stored under, said before the save goes out: the data layer shows
   * the stored schedule at once, and a screen keyed by the schedule's id keeps this editor (and its draft) for it.
   */
  readonly onAdopt?: (id: string) => void;
  /** The virtual default, stored by its first save, now has an id. */
  readonly onStored?: (schedule: ScheduleView) => void;
}

/** One schedule's draft, its save and its SaveBar status. */
export function useScheduleDraft({
  data,
  slug,
  schedule,
  forMember,
  reload,
  onAdopt,
  onStored,
}: ScheduleDraftInput): ScheduleDraft {
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [isSaving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [justSaved, setJustSaved] = useState(false);
  const saved = schedule.availability;
  const shown = draft?.hours ?? saved;
  const isDirty = draft !== undefined && !sameHours(draft.hours, saved);
  // Said as stale, and the next Save replaces whatever is stored by then.
  const stale = () => {
    setFailure(scheduleStrings.stale);
    setDraft((current) => (current === undefined ? undefined : { ...current, base: undefined }));
  };

  const change = (next: (current: BookingAvailability) => BookingAvailability) => {
    setJustSaved(false);
    setDraft((current) => ({
      hours: next(current?.hours ?? saved),
      base: current === undefined ? schedule.updatedAt : current.base,
      newId: current?.newId,
    }));
  };

  const save = () => {
    if (isSaving || draft === undefined) return;
    const sent = draft.hours;
    const base = draft.base === undefined ? schedule.updatedAt : draft.base;
    // Begun on the virtual default, which another tab has stored since: its version is one this draft never saw.
    if (schedule.id !== null && base === null) {
      stale();
      return;
    }
    setSaving(true);
    setFailure(undefined);
    let saving: Promise<ScheduleView>;
    if (schedule.id === null) {
      const id = draft.newId ?? data.schedules.newId();
      setDraft((current) => (current === undefined ? undefined : { ...current, newId: id }));
      onAdopt?.(id);
      saving = data.schedules.create(slug, schedule.memberId, {
        id,
        name: schedule.name,
        timeZone: sent.timeZone,
        availability: sent,
        isDefault: true,
        forMember,
      });
    } else {
      saving = data.schedules.update(slug, { ...schedule, updatedAt: base }, { availability: sent });
    }
    saving.then(
      (stored) => {
        setSaving(false);
        setJustSaved(true);
        // An edit made while it saved stays, still unsaved, on the version just stored.
        setDraft((current) =>
          current === undefined || sameHours(current.hours, sent)
            ? undefined
            : { hours: current.hours, base: stored.updatedAt, newId: undefined },
        );
        if (schedule.id === null) onStored?.(stored);
      },
      (error: unknown) => {
        setSaving(false);
        if (isDataError(error) && error.code === 'STALE') {
          stale();
          return;
        }
        // The virtual default's first save, beaten by another tab's: it is stored now, so read it.
        if (isDataError(error) && error.code === 'NAME_TAKEN' && schedule.id === null) {
          stale();
          reload();
          return;
        }
        setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      },
    );
  };

  const discard = () => {
    setDraft(undefined);
    setFailure(undefined);
    setJustSaved(false);
  };

  const status: SaveBarStatus = isSaving
    ? 'saving'
    : isDirty
      ? failure === undefined
        ? 'unsaved'
        : 'error'
      : justSaved
        ? 'saved'
        : 'hidden';
  return { shown, isDirty, status, error: failure, isValid: availabilityIsValid(shown), change, save, discard };
}
