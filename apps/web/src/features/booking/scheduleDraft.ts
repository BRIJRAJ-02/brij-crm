// One schedule's unsaved name and hours (spec 0035, AC-970, AC-977), shared by the screens that edit a schedule. The
// draft is undefined until the member changes something, so the screen shows the schedule as the data layer holds it
// and a save in another tab shows at once while nothing is being edited. A draft remembers the version it began from,
// and a save names it: a schedule changed elsewhere meanwhile is refused STALE rather than silently replaced, and the
// next Save replaces it knowingly. The virtual default (AC-963) is stored the first time it is saved.
import { isDataError, type BookingAvailability, type DataLayer, type ScheduleView } from '@crm/data';
import type { SaveBarStatus } from '@crm/ui';
import { useState } from 'react';
import { availabilityIsValid, sameHours } from './hours.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings } from './strings.ts';

/** The longest name a schedule takes (AC-961). */
export const SCHEDULE_NAME_MAX = 60;

/** The name and hours being edited, and the version they began from (undefined: whichever is current when saved). */
interface Draft {
  readonly hours: BookingAvailability;
  /** As typed; undefined while the name isn't being changed. */
  readonly name: string | undefined;
  readonly base: string | null | undefined;
  /** The id the virtual default is stored under: minted once, so a retry stores it once. */
  readonly newId: string | undefined;
}

/** What a screen editing a schedule needs. */
export interface ScheduleDraft {
  /** The hours to show: the draft's while there is one, else the schedule's own. */
  readonly shown: BookingAvailability;
  /** The name to show, as typed. */
  readonly name: string;
  readonly isDirty: boolean;
  /** For the SaveBar. */
  readonly status: SaveBarStatus;
  /** Why the last save failed, said on the SaveBar. */
  readonly error: string | undefined;
  /** What's wrong with the name, said on its field: empty, or another schedule's. */
  readonly nameError: string | undefined;
  /** Why Save waits (a range or the name is wrong), said on the SaveBar; undefined when it can go. */
  readonly blockedReason: string | undefined;
  /** Changes the hours from what the draft holds now, so several changes in one event all land (Copy to days). */
  readonly change: (next: (current: BookingAvailability) => BookingAvailability) => void;
  /** Renames it in the draft, saved with the hours. */
  readonly rename: (name: string) => void;
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
  const [nameRefusal, setNameRefusal] = useState<string | undefined>(undefined);
  const [justSaved, setJustSaved] = useState(false);
  const saved = schedule.availability;
  const shown = draft?.hours ?? saved;
  const name = draft?.name ?? schedule.name;
  const renamed = name.trim() !== schedule.name;
  const isDirty = draft !== undefined && (!sameHours(draft.hours, saved) || renamed);
  const nameError = name.trim() === '' ? scheduleStrings.nameRequired : renamed ? nameRefusal : undefined;
  const blockedReason = !availabilityIsValid(shown)
    ? strings.fixHours
    : name.trim() === ''
      ? scheduleStrings.nameRequired
      : undefined;
  // Said as stale, and the next Save replaces whatever is stored by then.
  const stale = () => {
    setFailure(scheduleStrings.stale);
    setDraft((current) => (current === undefined ? undefined : { ...current, base: undefined }));
  };
  /** The draft as it begins: the schedule as shown, and the version it is. */
  const begun = (current: Draft | undefined): Draft =>
    current ?? { hours: saved, name: undefined, base: schedule.updatedAt, newId: undefined };

  const change = (next: (current: BookingAvailability) => BookingAvailability) => {
    setJustSaved(false);
    setDraft((current) => {
      const from = begun(current);
      return { ...from, hours: next(from.hours) };
    });
  };

  const rename = (next: string) => {
    setJustSaved(false);
    setNameRefusal(undefined);
    setDraft((current) => ({ ...begun(current), name: next }));
  };

  const save = () => {
    if (isSaving || draft === undefined || blockedReason !== undefined) return;
    const sent = draft.hours;
    const sentName = name.trim();
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
        name: sentName,
        timeZone: sent.timeZone,
        availability: sent,
        isDefault: true,
        forMember,
      });
    } else {
      saving = data.schedules.update(
        slug,
        { ...schedule, updatedAt: base },
        {
          ...(sentName === schedule.name ? {} : { name: sentName }),
          ...(sameHours(sent, saved) ? {} : { availability: sent }),
        },
      );
    }
    const wasVirtual = schedule.id === null;
    const wasRenamed = sentName !== schedule.name;
    saving.then(
      (stored) => {
        setSaving(false);
        setJustSaved(true);
        // An edit made while it saved stays, still unsaved, on the version just stored.
        setDraft((current) => {
          if (current === undefined) return undefined;
          const hoursLeft = !sameHours(current.hours, sent);
          const nameLeft = current.name !== undefined && current.name.trim() !== sentName;
          return hoursLeft || nameLeft
            ? {
                hours: current.hours,
                name: nameLeft ? current.name : undefined,
                base: stored.updatedAt,
                newId: undefined,
              }
            : undefined;
        });
        if (wasVirtual) onStored?.(stored);
      },
      (error: unknown) => {
        setSaving(false);
        if (isDataError(error) && error.code === 'STALE') {
          stale();
          return;
        }
        if (isDataError(error) && error.code === 'NAME_TAKEN') {
          // The virtual default's first save under its own name, beaten by another tab's: it is stored now.
          if (wasVirtual && !wasRenamed) {
            stale();
            reload();
            return;
          }
          setNameRefusal(error.message);
        }
        setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      },
    );
  };

  const discard = () => {
    setDraft(undefined);
    setFailure(undefined);
    setNameRefusal(undefined);
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
  return { shown, name, isDirty, status, error: failure, nameError, blockedReason, change, rename, save, discard };
}
