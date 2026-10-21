// Brief
// Purpose: the open schedule in the Availability tab (spec 0035, AC-970): its weekly hours, its time zone, its days off and the booking pages that use it, each saved as it changes.
// Main task: change the hours (add, remove or copy a day's ranges), the zone or the days off; each change saves on its own, with Undo.
// Leaves out: which schedule is open and what to do with it (the switcher handed in), and which schedule a page uses (each page picks in its own editor).
import type { BookingAvailability, DataLayer, ScheduleView } from '@crm/data';
import {
  Badge,
  Card,
  HoursEditor,
  Link,
  LinkList,
  PageColumn,
  SectionBar,
  Select,
  Skeleton,
  type LinkRow,
} from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, type ReactNode } from 'react';
import { DaysOff } from './DaysOff.tsx';
import { weekRows, WEEKDAYS, withDay, zoneItems, zoneMatches } from './hours.ts';
import { linksHref, pageEditorHref } from './links.ts';
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
  /** The schedule switcher, at the head of the editor. */
  readonly switcher: ReactNode;
  /** Reads the member's schedules again: a save another tab beat shows theirs. */
  readonly onReload: () => void;
  /** The virtual default is about to be stored under this id: the screen keeps this editor for it. */
  readonly onAdopt: (id: string) => void;
  /** A save landed or failed: the screen raises it as a toast. */
  readonly onNotice: (notice: ScheduleSaveNotice) => void;
}

/**
 * The editor, the Calendly way: the switcher and the time zone on one row, the week below, the days off and the
 * pages that use it beside it. Every change saves on its own (the owner's save rule), so there is no Save to find.
 */
export function ScheduleEditor({
  data,
  slug,
  member,
  schedule,
  switcher,
  onReload,
  onAdopt,
  onNotice,
}: ScheduleEditorProps) {
  const navigate = useNavigate();
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
      bar={
        <SectionBar
          start={switcher}
          end={
            <>
              {/* Where the hours stand, quietly: a toast says each landed save, with Undo. */}
              {autosave.status === 'saving' && <Badge text={scheduleStrings.saving} />}
              {autosave.status === 'failed' && <Badge text={scheduleStrings.notSaved} />}
              <ZoneSelect
                value={shown.timeZone}
                onChange={(zone) => autosave.change((current) => ({ ...current, timeZone: zone }))}
              />
            </>
          }
        />
      }
      week={
        <Card title={strings.weeklyHours} description={scheduleStrings.weeklyHoursText}>
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
          <UsedBy
            slug={slug}
            schedule={schedule}
            onOpen={(pageId) => void navigate({ href: pageEditorHref(slug, pageId) })}
          />
        </>
      }
    />
  );
}

/** The editor's places, shared with its loading shape so the page lands where the skeleton was. */
function Layout({
  bar,
  week,
  aside,
}: {
  readonly bar: ReactNode;
  readonly week: ReactNode;
  readonly aside: ReactNode;
}) {
  return (
    <PageColumn stack="main-first" aside={aside}>
      {bar}
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

/** The booking pages that book by the schedule, each opening its editor; none says how a page picks one. */
function UsedBy({
  slug,
  schedule,
  onOpen,
}: {
  readonly slug: string;
  readonly schedule: ScheduleView;
  readonly onOpen: (pageId: string) => void;
}) {
  if (schedule.pages.length === 0) {
    return (
      <Card title={scheduleStrings.usedByLabel} description={scheduleStrings.noPagesUseIt}>
        <Link href={linksHref(slug)}>{scheduleStrings.goToPages}</Link>
      </Card>
    );
  }
  const rows: readonly LinkRow[] = schedule.pages.map((page) => ({
    id: page.id,
    title: page.title,
    address: '',
    chips: [],
    href: pageEditorHref(slug, page.id),
  }));
  return (
    <Card
      title={scheduleStrings.usedByLabel}
      description={schedule.isDefault ? scheduleStrings.usedByDefaultText : scheduleStrings.usedByText}
    >
      <LinkList
        density="compact"
        placement="card"
        label={scheduleStrings.usedByLabel}
        searchLabel={scheduleStrings.usedByLabel}
        isToolbarHidden
        rows={rows}
        onOpen={onOpen}
      />
    </Card>
  );
}

/** The editor while the schedules load: its row, its week and its side cards in their places. */
export function ScheduleEditorPending({ switcher }: { readonly switcher: ReactNode }) {
  return (
    <Layout
      bar={
        <SectionBar start={switcher} end={<ZoneSelect value={browserZone()} onChange={() => undefined} isDisabled />} />
      }
      week={
        <Card title={strings.weeklyHours} description={scheduleStrings.weeklyHoursText} isBusy>
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
          <Card title={strings.daysOff} description={strings.daysOffText} isBusy>
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
