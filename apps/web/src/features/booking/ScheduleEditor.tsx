// Brief
// Purpose: the open schedule in the Availability tab (spec 0035, AC-970): its weekly hours, its time zone, its days off and the booking pages that use it, each saved as it changes.
// Main task: change the hours (add, remove or copy a day's ranges), the zone or the days off; each change saves on its own, with Undo.
// Leaves out: which schedule is open and what to do with it (the switcher, in the tab strip), and which schedule a page uses (each page picks in its own editor).
import type { BookingAvailability, DataLayer, ScheduleView } from '@crm/data';
import { Badge, Card, HoursEditor, Link, PageColumn, Select, Skeleton } from '@crm/ui';
import { useMemo, type ReactNode } from 'react';
import { DaysOff } from './DaysOff.tsx';
import { weekRows, WEEKDAYS, withDay, zoneItems, zoneMatches } from './hours.ts';
import { pageEditorHref } from './links.ts';
import { browserZone } from './zone.ts';
import { useScheduleAutosave, type ScheduleSaveNotice } from './scheduleDraft.ts';
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
  /** A save landed or failed: the screen raises it as a toast. */
  readonly onNotice: (notice: ScheduleSaveNotice) => void;
}

/**
 * The editor, the Calendly way: the week with its time zone at its head, the days off and the
 * pages that use it beside it. Every change saves on its own (the owner's save rule), so there is no Save to find.
 */
export function ScheduleEditor({ data, slug, member, schedule, onReload, onAdopt, onNotice }: ScheduleEditorProps) {
  const autosave = useScheduleAutosave({
    data,
    slug,
    schedule,
    forMember: member !== undefined,
    reload: onReload,
    onAdopt,
    onNotice,
  });
  const shown = autosave.shown;
  const change = (next: BookingAvailability) => autosave.change(() => next);
  return (
    <Layout
      week={
        <Card
          title={strings.weeklyHours}
          // The zone the week reads in, at the card's head (the switcher is in the tab strip, as the other tabs'
          // tools are: the owner, 22 October 2026), with where the hours stand, quietly; a toast says each save.
          actions={
            <>
              {autosave.status === 'saving' && <Badge text={scheduleStrings.saving} />}
              {autosave.status === 'failed' && <Badge text={scheduleStrings.notSaved} />}
              <ZoneSelect
                value={shown.timeZone}
                onChange={(zone) => autosave.change((current) => ({ ...current, timeZone: zone }))}
              />
            </>
          }
        >
          <HoursEditor
            label={strings.weeklyHours}
            rows={weekRows(shown)}
            onChange={(day, ranges) => {
              autosave.change((current) => withDay(current, day, ranges));
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
function Layout({ week, aside }: { readonly week: ReactNode; readonly aside: ReactNode }) {
  return (
    <PageColumn stack="main-first" aside={aside}>
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
  if (schedule.pages.length === 0) {
    return <Card title={scheduleStrings.usedByLabel} description={scheduleStrings.usedByNone} />;
  }
  return (
    <Card title={scheduleStrings.usedByLabel}>
      <ul aria-label={scheduleStrings.usedByLabel}>
        {usedByNames(schedule.pages).map((page) => (
          <li key={page.id}>
            <Link href={pageEditorHref(slug, page.id)}>{page.name}</Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The editor while the schedules load: its week and its side cards in their places. */
export function ScheduleEditorPending() {
  return (
    <Layout
      week={
        <Card
          title={strings.weeklyHours}
          isBusy
          actions={<ZoneSelect value={browserZone()} onChange={() => undefined} isDisabled />}
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
