// Brief
// Purpose: the open schedule in the Availability tab (spec 0035, AC-970): its weekly hours, its time zone, its days off and the booking pages that use it.
// Main task: change the hours (add, remove or copy a day's ranges), the zone or the days off, then Save in the Unsaved changes bar (or Discard), as in the booking page editor.
// Leaves out: which schedule is open and what to do with it (the switcher, in the tab strip), and which schedule a page uses (each page picks in its own editor).
import type { BookingAvailability, DataLayer, ScheduleView } from '@crm/data';
import {
  Card,
  HoursEditor,
  LinkList,
  PageColumn,
  SaveBar,
  Select,
  Skeleton,
  useFormatSettings,
  type SaveBarStatus,
} from '@crm/ui';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useMemo, type ReactNode } from 'react';
import { DaysOff } from './DaysOff.tsx';
import { weekRows, WEEKDAYS, withDay, zoneItems, zoneMatches } from './hours.ts';
import { pageEditorHref } from './links.ts';
import { useScheduleDraft, type ScheduleSaveNotice } from './scheduleDraft.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings } from './strings.ts';

/** Props for the editor. */
export interface ScheduleEditorProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** Whose, when they aren't the reader's: an admin editing a colleague's schedule (AC-971). */
  readonly member: string | undefined;
  readonly schedule: ScheduleView;
  /** Reads the member's schedules again: a save another tab beat shows theirs. */
  readonly onReload: () => void;
  /** The virtual default is about to be stored under this id: the screen keeps this editor for it. */
  readonly onAdopt: (id: string) => void;
  /** A save landed, or another tab's beat it: the screen raises it as a toast. */
  readonly onNotice: (notice: ScheduleSaveNotice) => void;
}

/**
 * The editor, the Calendly way: the week with its time zone at its head, the days off and the pages that use it
 * beside it. Changes wait on screen until Save in the Unsaved changes bar (⌘S), and Discard puts them back; leaving
 * with changes asks first (the owner, 22 October 2026: it saves like the booking page editor).
 */
export function ScheduleEditor({ data, slug, member, schedule, onReload, onAdopt, onNotice }: ScheduleEditorProps) {
  const draft = useScheduleDraft({
    data,
    slug,
    schedule,
    forMember: member !== undefined,
    reload: onReload,
    onAdopt,
    onNotice,
  });
  const shown = draft.shown;
  const change = (next: BookingAvailability) => draft.change(() => next);
  // Leaving with unsaved changes asks first, in the app and when the tab closes, as the booking page editor does.
  useBlocker({
    shouldBlockFn: () => draft.isDirty && !globalThis.confirm(strings.leaveConfirm),
    enableBeforeUnload: () => draft.isDirty,
  });
  const status: SaveBarStatus = !draft.isDirty
    ? 'hidden'
    : draft.isSaving
      ? 'saving'
      : draft.error === undefined
        ? 'unsaved'
        : 'error';
  return (
    <Layout
      footer={
        <SaveBar
          status={status}
          {...(draft.error === undefined ? {} : { error: draft.error })}
          {...(draft.isValid ? {} : { blockedReason: scheduleStrings.invalidLeft })}
          onSave={draft.save}
          onDiscard={draft.discard}
        />
      }
      week={
        <Card
          title={strings.weeklyHours}
          // The zone the week reads in, at the card's head (the switcher is in the tab strip, as the other tabs'
          // tools are: the owner, 22 October 2026).
          actions={
            <ZoneSelect
              value={shown.timeZone}
              onChange={(zone) => draft.change((current) => ({ ...current, timeZone: zone }))}
            />
          }
        >
          <HoursEditor
            label={strings.weeklyHours}
            rows={weekRows(shown)}
            onChange={(day, ranges) => {
              draft.change((current) => withDay(current, day, ranges));
            }}
          />
        </Card>
      }
      aside={
        <>
          <DaysOff availability={shown} onChange={change} />
          <UsedBy slug={slug} schedule={schedule} />
        </>
      }
    />
  );
}

/** The editor's places, shared with its loading shape so the page lands where the skeleton was. */
function Layout({
  week,
  aside,
  footer,
}: {
  readonly week: ReactNode;
  readonly aside: ReactNode;
  readonly footer?: ReactNode;
}) {
  return (
    <PageColumn stack="main-first" aside={aside} {...(footer === undefined ? {} : { footer })}>
      {week}
    </PageColumn>
  );
}

/** The schedule's time zone, searchable, each zone with its offset: the week reads in it. */
function ZoneSelect({
  value,
  onChange,
  isDisabled = false,
}: {
  readonly value: string;
  readonly onChange: (zone: string) => void;
  readonly isDisabled?: boolean;
}) {
  const zones = useMemo(() => zoneItems(value, new Date()), [value]);
  return (
    <Select
      label={strings.timeZone}
      isLabelHidden
      size="sm"
      showsDescription
      items={zones}
      filter={zoneMatches}
      isSearchable
      isDisabled={isDisabled}
      value={value}
      onChange={(zone) => {
        if (zone !== null && zone !== value) onChange(zone);
      }}
    />
  );
}

/** A page's name in Used by: its title, numbered when another page here has the same one ("Intro call (2)"). */
function usedByNames(pages: ScheduleView['pages']): readonly { readonly id: string; readonly name: string }[] {
  const seen = new Map<string, number>();
  return pages.map((page) => {
    const count = (seen.get(page.title) ?? 0) + 1;
    seen.set(page.title, count);
    return { id: page.id, name: count === 1 ? page.title : `${page.title} (${String(count)})` };
  });
}

/** The booking pages that book by the schedule, each a quiet link to its editor; none says so. */
function UsedBy({ slug, schedule }: { readonly slug: string; readonly schedule: ScheduleView }) {
  const navigate = useNavigate();
  if (schedule.pages.length === 0) {
    return <Card title={scheduleStrings.usedByLabel} description={scheduleStrings.usedByNone} />;
  }
  const hrefOf = (id: string) => pageEditorHref(slug, id);
  // Clean rows, not a bulleted list of links (the owner, 22 October 2026): each page's title, Live (only live pages
  // book by a schedule), and the row opens its editor.
  return (
    <Card title={scheduleStrings.usedByLabel}>
      <LinkList
        label={scheduleStrings.usedByLabel}
        density="compact"
        placement="card"
        isToolbarHidden
        searchLabel={scheduleStrings.usedByLabel}
        rows={usedByNames(schedule.pages).map((page) => ({
          id: page.id,
          title: page.name,
          address: '',
          chips: [strings.live],
          href: hrefOf(page.id),
        }))}
        onOpen={(id) => void navigate({ href: hrefOf(id) })}
      />
    </Card>
  );
}

/** The editor while the schedules load: its week and its side cards in their places. */
export function ScheduleEditorPending() {
  // The member's zone (Preferences), as the schedule will show once it loads.
  const { timeZone } = useFormatSettings();
  return (
    <Layout
      week={
        <Card
          title={strings.weeklyHours}
          isBusy
          actions={<ZoneSelect value={timeZone} onChange={() => undefined} isDisabled />}
        >
          <HoursEditor
            label={strings.weeklyHours}
            rows={WEEKDAYS.map((day) => ({ id: day, label: strings.weekday[day], ranges: [] }))}
            onChange={() => undefined}
            isLoading
          />
        </Card>
      }
      aside={
        <>
          <Card title={strings.daysOff} isBusy>
            <Skeleton lines={3} />
          </Card>
          <Card title={scheduleStrings.usedByLabel} isBusy>
            <Skeleton lines={2} />
          </Card>
        </>
      }
    />
  );
}
