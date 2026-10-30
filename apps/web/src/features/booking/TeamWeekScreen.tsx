// Brief
// Purpose: the Roster (spec 0037, job J6): Availability's Team view, the team's bookable hours for one dated week, people down the side and the days across, with a footer counting who works.
// Main task: read who works when, and (with Manage) change one person's day for that date only, copy a week to the next, or set usual hours for several people.
// Leaves out: shifts with roles or places, publishing, labour cost, painting cells by drag, a team filter (no teams yet), and the workspace link's coverage (a later row in the footer).
import {
  clockLabel,
  isDataError,
  type DataLayer,
  type DayHours,
  type TeamWeek as Week,
  type TeamWeekDay,
  type TeamWeekRow,
  type VisibleMember,
  type WeeklyHours,
} from '@crm/data';
import { useScheduling } from '@crm/data/react';
import { mondayOf, plusDays, TEAM_WEEK, weekDates } from '@crm/data/roster';
import {
  Button,
  Callout,
  EmptyState,
  Field,
  HoursEditor,
  Link,
  Menu,
  MenuItem,
  memoIntl,
  MenuTrigger,
  Modal,
  PageColumn,
  SectionBar,
  SegmentedControl,
  Select,
  TeamWeek,
  TopBar,
  useFormatSettings,
  type TeamWeekCell,
  type TeamWeekPerson,
} from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBookingsActionSlot, useBookingsToolbarSlot } from '../bookings/toolbarSlot.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { availabilityHref } from './links.ts';
import { teamWeekHref } from './team-week-links.ts';
import { teamWeekStrings as words } from './team-week-strings.ts';
import { timeOffStrings } from './time-off-strings.ts';

/** The days of a week as the weekly hours key them, Monday first. */
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Props for the Team week. */
export interface TeamWeekScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The week shown, by its Monday. */
  readonly week: string;
  /** The name search ('' for everyone). */
  readonly search: string;
  /** The reader's zone: an offset shows only where a person's differs. */
  readonly zone: string;
  /** The members in the reader's See reach, with what the reader may change: the "Set usual hours for…" choices. */
  readonly members: readonly VisibleMember[];
}

/** Mine | Team: Availability's two views (spec 0037, AC-1289). */
export function AvailabilityViewSwitch({
  value,
  onChange,
}: {
  readonly value: 'mine' | 'team';
  readonly onChange: (value: 'mine' | 'team') => void;
}) {
  return (
    <SegmentedControl
      label={words.view}
      size="compact"
      isFitted
      segments={[
        { value: 'mine', label: words.mine },
        { value: 'team', label: words.team },
      ]}
      value={value}
      onChange={(next) => onChange(next === 'team' ? 'team' : 'mine')}
    />
  );
}

/** A date read as a calendar date, in the reader's language. */
function dayWords(date: string, locale: string, style: 'short' | 'long'): string {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  return memoIntl(
    `team-week-day:${locale}:${style}`,
    () =>
      new Intl.DateTimeFormat(
        locale,
        style === 'short'
          ? { weekday: 'short', day: 'numeric', timeZone: 'UTC' }
          : { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' },
      ),
  ).format(new Date(Date.UTC(year, month - 1, day)));
}

/** "2 – 8 Nov 2026" for a week. */
function rangeWords(monday: string, locale: string): string {
  const at = (date: string) => {
    const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  };
  const format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return format.formatRange(at(monday), at(plusDays(monday, 6)));
}

/** The zone's offset now, in minutes from UTC, for the reader's own zone. */
function offsetMinutes(zone: string, monday: string): number {
  const [year = 1970, month = 1, day = 1] = monday.split('-').map(Number);
  const at = new Date(Date.UTC(year, month - 1, day, 12));
  const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((each) => each.type === 'timeZoneName')?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(part ?? '');
  if (match === null) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/**
 * A time as a cell draws it, short as Fresha's roster: "9 am", "9:30 am" (the 12 hour clock, the owner's call, F12);
 * what a screen reader hears keeps the whole "9:00 am".
 */
function shortTime(time: string, locale: string): string {
  if (time === '24:00') return clockLabel(time, locale);
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return memoIntl(
    `team-week-time:${locale}:${String(minutes === 0)}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        ...(minutes === 0 ? {} : { minute: '2-digit' }),
        hourCycle: 'h12',
        timeZone: 'UTC',
      }),
  ).format(new Date(Date.UTC(2000, 0, 1, hours, minutes)));
}

/** A cell as the grid draws it, and what a screen reader hears. */
function cellOf(row: TeamWeekRow, day: TeamWeekDay, locale: string): TeamWeekCell {
  const long = dayWords(day.date, locale, 'long');
  const reason = day.away?.reason === undefined ? undefined : awayReason(day.away.reason);
  if (day.away !== undefined) {
    const lines = [words.away, ...(reason === undefined ? [] : [reason])];
    return { tone: 'away', lines, label: words.cellLabel(long, row.name, lines.join(', ')) };
  }
  if (day.ranges.length === 0) {
    const tail = day.source === 'override' ? `, ${words.thisWeekOnly}` : '';
    return {
      tone: day.source === 'override' ? 'override' : 'off',
      lines: [words.off],
      label: words.cellLabel(long, row.name, `${words.off}${tail}`),
    };
  }
  const lines = day.ranges.map(([start, end]) => words.range(shortTime(start, locale), shortTime(end, locale)));
  const spoken = day.ranges
    .map(([start, end]) => words.rangeWords(clockLabel(start, locale), clockLabel(end, locale)))
    .join(', ');
  return {
    tone: day.source === 'override' ? 'override' : 'usual',
    lines,
    label: words.cellLabel(long, row.name, day.source === 'override' ? `${spoken}, ${words.thisWeekOnly}` : spoken),
  };
}

/** Time off's reason in words, as Availability's Time off section says it. */
const awayReason = (reason: keyof typeof timeOffStrings.reasons): string => timeOffStrings.reasons[reason];

/** A weekday's whole name in the reader's language ("Monday"), from a known Monday. */
const weekdayName = (index: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 2 + index)));

/** The Team week: the strip's switch, stepper and search, the grid, its editor, menus and confirms. */
export function TeamWeekScreen({ data, slug, week, search, zone, members }: TeamWeekScreenProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const { locale } = useFormatSettings();
  const scheduling = data.scheduling.loaded();
  const slot = useBookingsToolbarSlot();
  const actionSlot = useBookingsActionSlot();
  const [copying, setCopying] = useState<TeamWeekRow | undefined>(undefined);
  // Each opening of the usual hours Modal starts afresh (its key), while a close still plays its exit.
  const [usualKey, setUsualKey] = useState(0);
  // "Set usual hours" for one person (from their row) or several ("Set usual hours for…"); undefined when closed.
  const [usualFor, setUsualFor] = useState<readonly string[] | undefined>(undefined);
  const [query, setQuery] = useState(search);
  // The search reaches the address a moment after typing stops, so each key doesn't read the week again.
  useEffect(() => {
    if (query.trim() === search) return undefined;
    const timer = setTimeout(() => void navigate({ href: teamWeekHref(slug, week, query), replace: true }), 300);
    return () => clearTimeout(timer);
  }, [query, search, navigate, slug, week]);
  if (scheduling === undefined) return <TeamWeekPending week={week} />;
  const held = scheduling.teamWeek.held(slug, week, search);
  return (
    <Loaded
      held={held}
      data={data}
      slug={slug}
      week={week}
      zone={zone}
      locale={locale}
      members={members}
      query={query}
      onQuery={setQuery}
      slot={slot}
      actionSlot={actionSlot}
      copying={copying}
      onCopy={setCopying}
      usualFor={usualFor}
      onUsualFor={(ids) => {
        if (ids !== undefined) setUsualKey((key) => key + 1);
        setUsualFor(ids);
      }}
      usualKey={usualKey}
      toast={(tone, message) => toasts.toast({ tone, message })}
    />
  );
}

/** The screen once the store is open. */
function Loaded({
  held,
  data,
  slug,
  week,
  zone,
  locale,
  members,
  query,
  onQuery,
  slot,
  actionSlot,
  copying,
  onCopy,
  usualFor,
  onUsualFor,
  usualKey,
  toast,
}: {
  readonly held: ReturnType<NonNullable<ReturnType<DataLayer['scheduling']['loaded']>>['teamWeek']['held']>;
  readonly data: DataLayer;
  readonly slug: string;
  readonly week: string;
  readonly zone: string;
  readonly locale: string;
  readonly members: readonly VisibleMember[];
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly slot: HTMLElement | null;
  readonly actionSlot: HTMLElement | null;
  readonly copying: TeamWeekRow | undefined;
  readonly onCopy: (row: TeamWeekRow | undefined) => void;
  readonly usualFor: readonly string[] | undefined;
  readonly onUsualFor: (ids: readonly string[] | undefined) => void;
  readonly usualKey: number;
  readonly toast: (tone: 'success' | 'danger', message: string) => void;
}) {
  const navigate = useNavigate();
  const state = useScheduling(held);
  const store = data.scheduling.loaded()?.teamWeek;
  const shown: Week | undefined = state.status === 'ready' ? state.week : undefined;
  const isPast = shown !== undefined && week < shown.thisWeek;
  const changeable = members.filter((each) => each.canChangeHours);
  const go = (next: string) => void navigate({ href: teamWeekHref(slug, next, query) });
  const viewerOffset = offsetMinutes(zone, week);
  const dates = weekDates(week);
  const days = dates.map((date) => ({ id: date, label: dayWords(date, locale, 'short') }));
  const rowOf = (memberId: string) => shown?.rows.find((row) => row.memberId === memberId);
  const isLatest = shown !== undefined && week >= shown.latest;
  const people: TeamWeekPerson[] = useMemo(
    () =>
      (shown?.rows ?? []).map((row) => ({
        id: row.memberId,
        name: row.name,
        meta: words.hours(row.weekMinutes),
        ...(row.offsetMinutes === viewerOffset ? {} : { badge: words.offset(row.offsetMinutes) }),
        ...(row.otherSchedules === 0
          ? {}
          : {
              extra: (
                <Link href={availabilityHref(slug, row.memberId)}>{words.otherSchedules(row.otherSchedules)}</Link>
              ),
            }),
        ...(row.canChange
          ? {
              actions: (
                <MenuTrigger>
                  <Button variant="ghost" icon="ellipsis" label={words.rowActions(row.name)} />
                  <Menu
                    label={words.rowActions(row.name)}
                    onAction={(key) => {
                      if (key === 'copy') onCopy(row);
                      else if (key === 'usual') onUsualFor([row.memberId]);
                    }}
                  >
                    {isPast || isLatest ? null : (
                      <MenuItem id="copy" icon="copy">
                        {words.copyToNext}
                      </MenuItem>
                    )}
                    <MenuItem id="usual" icon="clock">
                      {words.setUsual}
                    </MenuItem>
                  </Menu>
                </MenuTrigger>
              ),
            }
          : {}),
        cells: row.days.map((day) => cellOf(row, day, locale)),
        isEditable: row.canChange && !isPast,
      })),
    [shown, locale, viewerOffset, isPast, isLatest, slug, onCopy, onUsualFor],
  );
  const anyEditable = people.some((person) => person.isEditable);
  const footer =
    shown === undefined
      ? undefined
      : {
          label: words.working,
          // A later row (the workspace link's coverage per day, spec 0037 decision 3) joins here once it lands.
          totals: shown.footer.map((total) => ({
            value: total.working === 0 ? words.nobody : words.people(total.working),
            detail: total.working === 0 ? '' : words.hours(total.minutes),
            label: words.totalLabel(dayWords(total.date, locale, 'long'), total.working, total.minutes),
          })),
        };
  const range = rangeWords(week, locale);
  const thisWeek = shown?.thisWeek;
  const setUsualAction =
    changeable.length === 0 ? null : (
      <Button variant="primary" icon="clock" onPress={() => onUsualFor([])}>
        {words.setUsualFor}
      </Button>
    );
  const tools = (
    <SectionBar
      start={
        <>
          <AvailabilityViewSwitch
            value="team"
            onChange={(next) => {
              if (next === 'mine') void navigate({ href: availabilityHref(slug) });
            }}
          />
          <Button
            variant="secondary"
            isDisabled={thisWeek === undefined || thisWeek === week}
            onPress={() => thisWeek !== undefined && go(thisWeek)}
          >
            {words.thisWeek}
          </Button>
          <Button
            variant="ghost"
            icon="chevron-left"
            label={words.previousWeek}
            isDisabled={shown === undefined || week <= shown.earliest}
            onPress={() => go(plusDays(week, -7))}
          />
          <Button
            variant="ghost"
            icon="chevron-right"
            label={words.nextWeek}
            isDisabled={shown === undefined || week >= shown.latest}
            onPress={() => go(plusDays(week, 7))}
          />
        </>
      }
      title={range}
      isTitleQuiet
      end={
        <>
          <Field
            label={words.search}
            isLabelHidden
            type="search"
            size="sm"
            icon="search"
            placeholder={words.search}
            value={query}
            onChange={onQuery}
          />
          {actionSlot === null && setUsualAction}
        </>
      }
    />
  );
  const body =
    state.status === 'error' ? (
      <PageColumn align="center">
        <EmptyState tone="error" title={words.failed} onRetry={() => held.reload()}>
          {state.error.message}
        </EmptyState>
      </PageColumn>
    ) : (
      <>
        {isPast ? (
          <Callout tone="info">{words.readOnlyWeek}</Callout>
        ) : (
          anyEditable && <Callout tone="info">{words.explain}</Callout>
        )}
        <TeamWeek
          label={words.grid(range)}
          personLabel={words.person}
          days={days}
          people={people}
          isLoading={state.status === 'loading'}
          emptyState={<EmptyState title={words.noMatch}>{words.noMatchBody}</EmptyState>}
          {...(footer === undefined ? {} : { footer })}
          editorLabel={(memberId, index) =>
            words.editorLabel(rowOf(memberId)?.name ?? '', dayWords(dates[index] ?? week, locale, 'long'))
          }
          renderEditor={(memberId, index, close) => {
            const row = rowOf(memberId);
            const day = row?.days[index];
            if (row === undefined || day === undefined || store === undefined) return null;
            return (
              <DayEditor
                day={day}
                locale={locale}
                label={dayWords(day.date, locale, 'short')}
                onCancel={close}
                onSave={(hours) => {
                  close();
                  void store.setDay(slug, row, day.date, hours);
                }}
              />
            );
          }}
        />
        {shown !== undefined && shown.rows.length === 1 && query === '' && (
          <Callout tone="info">{words.seesOnlyYou}</Callout>
        )}
        {state.status === 'ready' && state.more === 'failed' && <Callout tone="danger">{words.moreFailed}</Callout>}
        {state.status === 'ready' && state.week.nextCursor !== undefined && (
          <Button variant="secondary" isPending={state.more === 'loading'} onPress={() => held.more()}>
            {state.more === 'failed' ? words.tryAgain : words.showMore}
          </Button>
        )}
      </>
    );
  return (
    <WorkspacePage
      currentPage="roster"
      page={{
        topBar: <TopBar title={words.title} icon="users" />,
        body: (
          <>
            {slot !== null && createPortal(tools, slot)}
            {actionSlot !== null && createPortal(setUsualAction, actionSlot)}
            {slot === null && tools}
            {body}
            <CopyWeekModal
              row={copying}
              range={rangeWords(plusDays(week, 7), locale)}
              onClose={() => onCopy(undefined)}
              onCopy={async (row) => {
                if (store === undefined) return;
                try {
                  await store.copyWeek(slug, {
                    memberIds: [row.memberId],
                    fromWeekStart: week,
                    toWeekStart: plusDays(week, 7),
                  });
                  toast('success', words.copied(row.name));
                  onCopy(undefined);
                } catch (error) {
                  toast('danger', `${words.failedSave} ${isDataError(error) ? error.message : words.somethingWrong}`);
                }
              }}
            />
            <UsualHoursModal
              key={usualKey}
              locale={locale}
              chosen={usualFor}
              members={changeable}
              usual={usualFor?.length === 1 ? rowOf(usualFor[0] ?? '')?.days : undefined}
              onClose={() => onUsualFor(undefined)}
              onSave={async (ids, weekly) => {
                if (store === undefined) return;
                try {
                  const changed = await store.setUsualHours(slug, { memberIds: ids, weekly });
                  toast('success', words.usualDone(changed));
                  onUsualFor(undefined);
                } catch (error) {
                  toast('danger', `${words.failedSave} ${isDataError(error) ? error.message : words.somethingWrong}`);
                }
              }}
            />
          </>
        ),
      }}
    />
  );
}

/**
 * One cell's editor (AC-1291): the day's ranges in 15 minute steps, Off, and Usual hours (the date's own hours
 * removed); Save writes the date's override.
 */
function DayEditor({
  day,
  locale,
  label,
  onCancel,
  onSave,
}: {
  readonly day: TeamWeekDay;
  readonly locale: string;
  readonly label: string;
  readonly onCancel: () => void;
  readonly onSave: (hours: DayHours) => void;
}) {
  const [ranges, setRanges] = useState<readonly (readonly [string, string])[]>(day.ranges);
  const same = (a: readonly (readonly [string, string])[], b: readonly (readonly [string, string])[]) =>
    JSON.stringify(a) === JSON.stringify(b);
  const isUnchanged = same(ranges, day.ranges);
  const isUsual = same(ranges, day.usual);
  const usualWords =
    day.usual.length === 0
      ? words.off
      : day.usual.map(([start, end]) => words.range(shortTime(start, locale), shortTime(end, locale))).join(', ');
  return (
    <>
      <HoursEditor
        label={words.dayHours(label)}
        rows={[{ id: day.date, label, ranges }]}
        stepMinutes={15}
        isSingleDay
        onChange={(_, next) => setRanges(next.slice(0, TEAM_WEEK.rangesMax))}
      />
      <SectionBar
        start={
          // A change for this date only can go back to the usual week; Save sends it.
          day.source === 'override' &&
          !isUsual && (
            <Button variant="ghost" size="sm" icon="undo-2" onPress={() => setRanges(day.usual)}>
              {words.backToUsual(usualWords)}
            </Button>
          )
        }
        end={
          <>
            <Button size="sm" onPress={onCancel}>
              {words.cancel}
            </Button>
            <Button
              variant="primary"
              size="sm"
              isDisabled={isUnchanged}
              onPress={() => {
                // The usual week's own hours are usual hours, not a change for this date.
                if (isUsual) onSave('usual');
                else onSave(ranges.length === 0 ? 'off' : ranges.map(([start, end]) => [start, end]));
              }}
            >
              {words.save}
            </Button>
          </>
        }
      />
    </>
  );
}

/** "Copy this week to next week" asks first (AC-1445): it replaces next week's hours. */
function CopyWeekModal({
  row,
  range,
  onClose,
  onCopy,
}: {
  readonly row: TeamWeekRow | undefined;
  readonly range: string;
  readonly onClose: () => void;
  readonly onCopy: (row: TeamWeekRow) => Promise<void>;
}) {
  const [isBusy, setBusy] = useState(false);
  // The last row asked about, so the words stay whole while the Modal plays its exit.
  const [last, setLast] = useState(row);
  if (row !== undefined && row !== last) setLast(row);
  const asked = row ?? last;
  return (
    <Modal
      title={words.copyTitle(asked?.name ?? '')}
      isOpen={row !== undefined}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" kbd="ESC" isDisabled={isBusy}>
            {words.cancel}
          </Button>
          <Button
            variant="primary"
            icon="copy"
            isPending={isBusy}
            onPress={() => {
              if (row === undefined) return;
              setBusy(true);
              void onCopy(row).finally(() => setBusy(false));
            }}
          >
            {words.copyAction}
          </Button>
        </>
      }
    >
      {words.copyBody(asked?.name ?? '', range)}
    </Modal>
  );
}

const NINE: readonly (readonly [string, string])[] = [['09:00', '17:00']];

type Week7 = Readonly<Record<(typeof WEEKDAYS)[number], readonly (readonly [string, string])[]>>;

/**
 * "Set usual hours" (one person, from their row) and "Set usual hours for…" (several): the people, one week of hours,
 * and what it replaces said before the button (AC-1292, AC-1445). One audited write per person. The screen keys it
 * per opening, so each starts afresh while a close still plays the Modal's exit.
 */
function UsualHoursModal({
  chosen,
  members,
  usual,
  locale,
  onClose,
  onSave,
}: {
  readonly chosen: readonly string[] | undefined;
  readonly members: readonly VisibleMember[];
  /** One person's week, whose usual hours the form starts from. */
  readonly usual: readonly TeamWeekDay[] | undefined;
  readonly locale: string;
  readonly onClose: () => void;
  readonly onSave: (ids: readonly string[], weekly: WeeklyHours) => Promise<void>;
}) {
  const isOpen = chosen !== undefined;
  // Whom it opened for, kept while the Modal plays its exit (the screen keys it per opening).
  const [opened] = useState(chosen);
  const single = opened?.length === 1 ? members.find((each) => each.id === opened[0]) : undefined;
  const [ids, setIds] = useState<readonly string[]>(chosen ?? []);
  const [isBusy, setBusy] = useState(false);
  const [week, setWeek] = useState<Week7>(
    () =>
      Object.fromEntries(
        WEEKDAYS.map((key, index) => [key, usual?.[index]?.usual ?? (index < 5 ? NINE : [])]),
      ) as unknown as Week7,
  );
  const empty = WEEKDAYS.every((key) => week[key].length === 0);
  return (
    <Modal
      title={words.usualTitle(single?.name)}
      variant="window"
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" kbd="ESC" isDisabled={isBusy}>
            {words.cancel}
          </Button>
          <Button
            variant="primary"
            icon="clock"
            isPending={isBusy}
            isDisabled={ids.length === 0 || empty}
            onPress={() => {
              setBusy(true);
              const weekly = Object.fromEntries(
                WEEKDAYS.map((key) => [key, week[key].map(([start, end]) => [start, end])]),
              ) as unknown as WeeklyHours;
              void onSave(ids, weekly).finally(() => setBusy(false));
            }}
          >
            {words.usualAction}
          </Button>
        </>
      }
    >
      {single === undefined && (
        <Select
          label={words.usualFor}
          selectionMode="multiple"
          isSearchable
          placeholder={words.usualForPlaceholder}
          items={members.map((each) => ({ id: each.id, label: each.name }))}
          values={ids}
          onValuesChange={setIds}
        />
      )}
      <HoursEditor
        label={words.usualWeek}
        rows={WEEKDAYS.map((key, index) => ({ id: key, label: weekdayName(index, locale), ranges: week[key] }))}
        stepMinutes={15}
        onChange={(key, ranges) => setWeek((current) => ({ ...current, [key]: ranges.slice(0, TEAM_WEEK.rangesMax) }))}
      />
      <Callout tone={ids.length === 0 ? 'info' : 'warning'}>{words.usualBody(ids.length)}</Callout>
    </Modal>
  );
}

/** The Team week while the store loads: the strip's place and the grid's skeleton. */
export function TeamWeekPending({ week }: { readonly week?: string | undefined }) {
  const { locale } = useFormatSettings();
  const monday = mondayOf(week ?? new Date().toISOString().slice(0, 10));
  const days = weekDates(monday).map((date) => ({ id: date, label: dayWords(date, locale, 'short') }));
  return (
    <WorkspacePage
      currentPage="roster"
      page={{
        topBar: <TopBar title={words.title} icon="users" isLoading />,
        body: <TeamWeek label={words.grid(rangeWords(monday, locale))} days={days} people={[]} isLoading />,
      }}
    />
  );
}
