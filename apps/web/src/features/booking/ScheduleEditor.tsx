// Brief
// Purpose: the open schedule in the Availability tab (spec 0035, AC-970): its weekly hours, its time zone, its days off and the booking pages that use it.
// Main task: change the hours (add, remove or copy a day's ranges), the zone or the days off, then Save in the Unsaved changes bar (or Discard), as in the booking page editor.
// Leaves out: which schedule is open and what to do with it (the switcher, in the tab strip), and which schedule a page uses (each page picks in its own editor).
import type { BookingAvailability, DataLayer, ScheduleView } from '@crm/data';
import {
  Button,
  Card,
  EmptyState,
  HoursEditor,
  LinkList,
  PageColumn,
  SaveBar,
  Select,
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
      week={<WeekCard availability={shown} onChange={draft.change} />}
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

/**
 * A schedule's week in its Card: the zone it reads in at the card's head, the day rows under it. Availability's
 * schedule editor and a booking page's Hours tab draw the same one, so the hours edit the same way in both.
 */
export function WeekCard({
  availability,
  onChange,
  isReadOnly = false,
}: {
  readonly availability: BookingAvailability;
  /** Changes the hours from what is shown now, so several changes in one event all land (Copy to days). */
  readonly onChange: (next: (current: BookingAvailability) => BookingAvailability) => void;
  /** Shows the week with nothing to change (a page the reader can't change). */
  readonly isReadOnly?: boolean;
}) {
  return (
    <Card
      title={strings.weeklyHours}
      // The zone the week reads in, at the card's head, said once.
      actions={
        <ZoneSelect
          value={availability.timeZone}
          isReadOnly={isReadOnly}
          onChange={(zone) => onChange((current) => ({ ...current, timeZone: zone }))}
        />
      }
    >
      <HoursEditor
        label={strings.weeklyHours}
        rows={weekRows(availability)}
        isReadOnly={isReadOnly}
        onChange={(day, ranges) => {
          onChange((current) => withDay(current, day, ranges));
        }}
      />
    </Card>
  );
}

/** The schedule's time zone, searchable, each zone with its offset: the week reads in it. */
function ZoneSelect({
  value,
  onChange,
  isDisabled = false,
  isReadOnly = false,
}: {
  readonly value: string;
  readonly onChange: (zone: string) => void;
  readonly isDisabled?: boolean;
  /** Shows the zone with nothing to change (a page the reader can't change), as the week beside it. */
  readonly isReadOnly?: boolean;
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
      isReadOnly={isReadOnly}
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
  // One card anatomy with Days off: the title, then its content in the body, a quiet line when there is none.
  if (schedule.pages.length === 0) {
    return (
      <Card title={scheduleStrings.usedByLabel}>
        <EmptyState layout="row" icon="link" title={scheduleStrings.usedByNone} />
      </Card>
    );
  }
  const hrefOf = (id: string) => pageEditorHref(slug, id);
  // Clean rows, not a bulleted list of links (the owner, 22 October 2026): each page's title, and the row opens its
  // editor. No Live chip: only live pages book by a schedule, so every row would say it.
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
          chips: [],
          href: hrefOf(page.id),
        }))}
        onOpen={(id) => void navigate({ href: hrefOf(id) })}
      />
    </Card>
  );
}

/** The week's card while the schedules load, in its loaded shape: Availability's and a booking page's Hours tab. */
export function WeekCardPending() {
  // The member's zone (Preferences), as the schedule will show once it loads.
  const { timeZone } = useFormatSettings();
  return (
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
  );
}

/** The editor while the schedules load: its week and its side cards in their places. */
export function ScheduleEditorPending() {
  return (
    <Layout
      week={<WeekCardPending />}
      aside={
        <>
          {/* Days off in its loaded anatomy: a row's place, then Add day off under it. */}
          <Card title={strings.daysOff} isBusy>
            <EmptyState layout="row" isLoading title={strings.daysOffLoading} />
            <Button icon="plus" isDisabled>
              {strings.addDayOff}
            </Button>
          </Card>
          {/* The rows Used by draws once loaded, in their loading shape. */}
          <Card title={scheduleStrings.usedByLabel}>
            <LinkList
              label={scheduleStrings.usedByLabel}
              density="compact"
              placement="card"
              isToolbarHidden
              searchLabel={scheduleStrings.usedByLabel}
              status="loading"
              rows={[]}
              onOpen={() => undefined}
            />
          </Card>
        </>
      }
    />
  );
}
