// Brief
// Purpose: the Roster (spec 0037, job J6): Availability's Team view, the team's bookable hours for one dated week, people down the side and the days across, with a footer counting who works.
// Main task: read who works when, and (with Manage) change one person's day for that date only, copy a week to the next, or set usual hours for several people.
// Leaves out: shifts with roles or places, publishing, labour cost and painting cells by drag. The workspace link's coverage is one quiet line under each day's total ("Link: 3"), only while the workspace has a link.
import {
  clockLabel,
  isDataError,
  type CalendarHealthState,
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
  MenuSeparator,
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
  type TeamWeekDay as TeamWeekDayColumn,
  type TeamWeekLegendItem,
  type TeamWeekPerson,
} from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBookingsToolbarSlot } from '../bookings/toolbarSlot.ts';
import { useMyAccess, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import {
  askReconnect,
  askReconnectItem,
  CalendarHealthChip,
  offersAsk,
  useCalendarHealth,
  useSchedulingStore,
} from './CalendarHealth.tsx';
import { todayIn } from './hours.ts';
import { availabilityHref } from './links.ts';
import { teamWeekHref } from './team-week-links.ts';
import { TeamWeekTeamFilter, useWorkspaceTeams } from './TeamWeekTeamFilter.tsx';
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

/** A date's weekday and day of the month apart ("Mon", "2"), in the reader's language. */
function dayParts(date: string, locale: string): { readonly weekday: string; readonly date: string } {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  const parts = memoIntl(
    `team-week-day-parts:${locale}`,
    () => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', timeZone: 'UTC' }),
  ).formatToParts(new Date(Date.UTC(year, month - 1, day)));
  return {
    weekday: parts.find((part) => part.type === 'weekday')?.value ?? '',
    date: parts.find((part) => part.type === 'day')?.value ?? String(day),
  };
}

/**
 * A date read as a calendar date, in the reader's language: short is the weekday first, then the date ("Mon 2"), as
 * a week's columns head them (en-US alone would put "2 Mon"); long is whole ("Monday 2 November").
 */
function dayWords(date: string, locale: string, style: 'short' | 'long'): string {
  if (style === 'short') {
    const parts = dayParts(date, locale);
    return words.dayShort(parts.weekday, parts.date);
  }
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  return memoIntl(
    `team-week-day:${locale}:long`,
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
  ).format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * The week's days as the grid heads them: weekday beside date, today marked, and a day nobody works quiet (from the
 * week's own totals, not the calendar: a salon's Saturday is its busiest day).
 */
function weekDays(monday: string, locale: string, today: string, footer?: Week['footer']): TeamWeekDayColumn[] {
  return weekDates(monday).map((date) => ({
    id: date,
    label: dayWords(date, locale, 'short'),
    ...dayParts(date, locale),
    isToday: date === today,
    isQuiet: footer?.find((total) => total.date === date)?.working === 0,
  }));
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

/** A person's quiet extras after their hours, joined ("UTC+5:30 · View only"), or nothing. */
function badgeOf(parts: readonly (string | undefined)[]): { readonly badge?: string } {
  const shown = parts.filter((part): part is string => part !== undefined);
  return shown.length === 0 ? {} : { badge: shown.join(words.metaSeparator) };
}

/**
 * What goes under a person's name: their calendar's trouble (spec 0037, AC-1314) and the link to their other
 * schedules, either, both or neither.
 */
function extraOf(
  chip: ReactNode,
  state: CalendarHealthState | undefined,
  link: ReactNode | undefined,
): { readonly extra?: ReactNode } {
  const troubled = state?.status === 'ready' && state.health.status !== 'connected';
  if (!troubled) return link === undefined ? {} : { extra: link };
  return {
    extra:
      link === undefined ? (
        chip
      ) : (
        <>
          {chip}
          {link}
        </>
      ),
  };
}

/** Time off's reason in words, as Availability's Time off section says it. */
const awayReason = (reason: keyof typeof timeOffStrings.reasons): string => timeOffStrings.reasons[reason];

/** A weekday's whole name in the reader's language ("Monday"), from a known Monday. */
const weekdayName = (index: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 2 + index)));

/** The Team week: Mine | Team on the strip, one toolbar (the week, search, Copy week, Set usual hours), the grid with its legend, its editor, menus and confirms. */
export function TeamWeekScreen({ data, slug, week, search, zone, members }: TeamWeekScreenProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const { locale } = useFormatSettings();
  const scheduling = data.scheduling.loaded();
  const slot = useBookingsToolbarSlot();
  // Whose week "Copy this week to next week" asks about: one row's (its menu) or everyone the reader may change (the
  // toolbar's Copy week); undefined when closed.
  const [copying, setCopying] = useState<readonly TeamWeekRow[] | undefined>(undefined);
  // Each opening of the usual hours Modal starts afresh (its key), while a close still plays its exit.
  const [usualKey, setUsualKey] = useState(0);
  // "Set usual hours" for one person (from their row) or several ("Set usual hours for…"); undefined when closed.
  const [usualFor, setUsualFor] = useState<readonly string[] | undefined>(undefined);
  const [query, setQuery] = useState(search);
  // The team filter (AC-1289): the screen's own choice, kept while the week changes; a team since deleted is none.
  const teams = useWorkspaceTeams(data, slug);
  const [chosenTeam, setTeam] = useState('');
  const teamId = teams.some((team) => team.id === chosenTeam) ? chosenTeam : '';
  // The search reaches the address a moment after typing stops, so each key doesn't read the week again.
  useEffect(() => {
    if (query.trim() === search) return undefined;
    const timer = setTimeout(() => void navigate({ href: teamWeekHref(slug, week, query), replace: true }), 300);
    return () => clearTimeout(timer);
  }, [query, search, navigate, slug, week]);
  if (scheduling === undefined) return <TeamWeekPending week={week} />;
  const held = scheduling.teamWeek.held(slug, week, search, teamId);
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
      teamFilter={<TeamWeekTeamFilter teams={teams} value={teamId} onChange={setTeam} />}
      isTeamChosen={teamId !== ''}
      slot={slot}
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
  teamFilter,
  isTeamChosen,
  slot,
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
  /** The team filter's Select (absent while the workspace has no teams). */
  readonly teamFilter: ReactNode;
  readonly isTeamChosen: boolean;
  readonly slot: HTMLElement | null;
  readonly copying: readonly TeamWeekRow[] | undefined;
  readonly onCopy: (rows: readonly TeamWeekRow[] | undefined) => void;
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
  const days = weekDays(week, locale, todayIn(zone), shown?.footer);
  const rowOf = (memberId: string) => shown?.rows.find((row) => row.memberId === memberId);
  const isLatest = shown !== undefined && week >= shown.latest;
  const anyChangeable = (shown?.rows ?? []).some((row) => row.canChange);
  // Each person's calendar health (spec 0037, AC-1308, AC-1314): only trouble shows, under their name, and their menu
  // offers Ask to reconnect (AC-1309).
  const healthStore = useSchedulingStore(data);
  const me = useMyAccess()?.memberId;
  const health = useCalendarHealth(
    healthStore,
    slug,
    (shown?.rows ?? []).map((row) => row.memberId),
  );
  const people: TeamWeekPerson[] = useMemo(
    () =>
      (shown?.rows ?? []).map((row) => ({
        id: row.memberId,
        name: row.name,
        meta: words.hours(row.weekMinutes),
        // The zone's offset where it differs from the reader's, and "View only" on a row the reader may not change
        // beside rows they may, since its days are words rather than blocks.
        ...badgeOf([
          row.offsetMinutes === viewerOffset ? undefined : words.offset(row.offsetMinutes),
          !row.canChange && !isPast && anyChangeable ? words.viewOnly : undefined,
        ]),
        ...extraOf(
          <CalendarHealthChip state={health.get(row.memberId)} name={row.name} isQuiet />,
          health.get(row.memberId),
          row.otherSchedules === 0 ? undefined : (
            <Link href={availabilityHref(slug, row.memberId)}>{words.otherSchedules(row.otherSchedules)}</Link>
          ),
        ),
        ...(row.canChange || (row.memberId !== me && offersAsk(health.get(row.memberId)))
          ? {
              actions: (
                <MenuTrigger>
                  <Button variant="ghost" icon="ellipsis" label={words.rowActions(row.name)} />
                  <Menu
                    label={words.rowActions(row.name)}
                    onAction={(key) => {
                      if (key === 'copy') onCopy([row]);
                      else if (key === 'usual') onUsualFor([row.memberId]);
                      else if (key === 'ask-reconnect') askReconnect(healthStore, slug, row.memberId, row.name);
                    }}
                  >
                    {row.memberId === me ? null : askReconnectItem(health.get(row.memberId))}
                    {row.canChange && row.memberId !== me && offersAsk(health.get(row.memberId)) ? (
                      <MenuSeparator />
                    ) : null}
                    {!row.canChange || isPast || isLatest ? null : (
                      <MenuItem id="copy" icon="copy">
                        {words.copyToNext}
                      </MenuItem>
                    )}
                    {row.canChange ? (
                      <MenuItem id="usual" icon="clock">
                        {words.setUsual}
                      </MenuItem>
                    ) : null}
                  </Menu>
                </MenuTrigger>
              ),
            }
          : {}),
        cells: row.days.map((day) => cellOf(row, day, locale)),
        isEditable: row.canChange && !isPast,
      })),
    [shown, locale, viewerOffset, isPast, isLatest, anyChangeable, slug, onCopy, onUsualFor, health, healthStore, me],
  );
  const anyEditable = people.some((person) => person.isEditable);
  // Copy week from the toolbar: everyone on this page the reader may change, one confirm for all (Deputy's and
  // 7shifts' Copy week); a row's menu still copies one person.
  const copyRows = (shown?.rows ?? []).filter((row) => row.canChange);
  // Who the copy leaves out: people not loaded yet, or filtered out by the search.
  const copyIsPartial = query !== '' || (state.status === 'ready' && state.week.nextCursor !== undefined);
  const legend: { readonly items: readonly TeamWeekLegendItem[]; readonly hint?: string } = {
    items: [
      { tone: 'usual', label: words.legendUsual },
      { tone: 'override', label: words.legendChanged },
      { tone: 'off', label: words.off },
      { tone: 'away', label: words.away },
    ],
    ...(anyEditable ? { hint: words.explain } : {}),
  };
  const footer =
    shown === undefined
      ? undefined
      : {
          label: shown.link === undefined ? words.working : words.workingWithLink(shown.link.title),
          // The workspace link's coverage (the brief's decision 3): how many of those working it can book, a quiet
          // line under each day someone works, only while the workspace has a link.
          totals: shown.footer.map((total) => {
            const { link } = shown;
            const linked = total.linked ?? 0;
            const label = words.totalLabel(dayWords(total.date, locale, 'long'), total.working, total.minutes);
            return {
              // Every day draws the same lines, a day nobody works too ("Nobody", "0 h"), so the row reads as one.
              value: total.working === 0 ? words.nobody : words.people(total.working),
              detail: words.hours(total.minutes),
              ...(link === undefined
                ? { label }
                : { extra: words.linkCount(linked), label: words.totalWithLinkLabel(label, link.title, linked) }),
            };
          }),
        };
  const range = rangeWords(week, locale);
  const thisWeek = shown?.thisWeek;
  const viewSwitch = (
    <AvailabilityViewSwitch
      value="team"
      onChange={(next) => {
        if (next === 'mine') void navigate({ href: availabilityHref(slug) });
      }}
    />
  );
  // One toolbar over the grid (Square's and Workable's): the week on the left (This week, the stepper, its dates),
  // then the search and the actions on the right. In Bookings, Mine | Team stays on the tab strip's end, where the
  // Mine side has it, so the switch never moves; on its own page it leads this bar.
  const tools = (
    <SectionBar
      variant="bar"
      start={
        <>
          {slot === null && viewSwitch}
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
          {teamFilter}
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
          {copyRows.length > 0 && (
            <Button variant="secondary" icon="copy" isDisabled={isPast || isLatest} onPress={() => onCopy(copyRows)}>
              {words.copyAll}
            </Button>
          )}
          {changeable.length > 0 && (
            <Button variant="primary" icon="clock" onPress={() => onUsualFor([])}>
              {words.setUsualFor}
            </Button>
          )}
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
      // The page's gutter, as every full width page has it (Members, Bookings' list).
      <PageColumn>
        {isPast && <Callout tone="info">{words.readOnlyWeek}</Callout>}
        <TeamWeek
          label={words.grid(range)}
          personLabel={words.person}
          days={days}
          people={people}
          isLoading={state.status === 'loading'}
          emptyState={
            <EmptyState title={words.noMatch}>{isTeamChosen ? words.noMatchInTeam : words.noMatchBody}</EmptyState>
          }
          {...(footer === undefined ? {} : { footer })}
          legend={legend}
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
      </PageColumn>
    );
  return (
    <WorkspacePage
      currentPage="roster"
      page={{
        topBar: <TopBar title={words.title} icon="users" />,
        body: (
          <>
            {slot !== null && createPortal(<SectionBar start={viewSwitch} />, slot)}
            {tools}
            {body}
            <CopyWeekModal
              rows={copying}
              isPartial={copyIsPartial}
              range={rangeWords(plusDays(week, 7), locale)}
              onClose={() => onCopy(undefined)}
              onCopy={async (rows) => {
                if (store === undefined) return;
                try {
                  // One write takes at most TEAM_WEEK.bulkMax people, so a longer roster goes in turns.
                  const ids = rows.map((row) => row.memberId);
                  let changed = 0;
                  for (let start = 0; start < ids.length; start += TEAM_WEEK.bulkMax) {
                    changed += await store.copyWeek(slug, {
                      memberIds: ids.slice(start, start + TEAM_WEEK.bulkMax),
                      fromWeekStart: week,
                      toWeekStart: plusDays(week, 7),
                    });
                  }
                  toast('success', words.copied(rows, changed));
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

/**
 * "Copy this week to next week" asks first (AC-1445): it replaces next week's hours, for one person (their row's menu)
 * or everyone the reader may change on the page (the toolbar's Copy week).
 */
function CopyWeekModal({
  rows,
  isPartial,
  range,
  onClose,
  onCopy,
}: {
  readonly rows: readonly TeamWeekRow[] | undefined;
  /** Some people aren't on the page (not loaded, or searched out), so the copy says it leaves them alone. */
  readonly isPartial: boolean;
  readonly range: string;
  readonly onClose: () => void;
  readonly onCopy: (rows: readonly TeamWeekRow[]) => Promise<void>;
}) {
  const [isBusy, setBusy] = useState(false);
  // The last rows asked about, so the words stay whole while the Modal plays its exit.
  const [last, setLast] = useState(rows);
  if (rows !== undefined && rows !== last) setLast(rows);
  const asked = rows ?? last ?? [];
  return (
    <Modal
      title={words.copyTitle(asked)}
      isOpen={rows !== undefined}
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
              if (rows === undefined) return;
              setBusy(true);
              void onCopy(rows).finally(() => setBusy(false));
            }}
          >
            {words.copyAction}
          </Button>
        </>
      }
    >
      {words.copyBody(asked, range, isPartial && asked.length > 1)}
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
  const days = weekDays(monday, locale, '');
  return (
    <WorkspacePage
      currentPage="roster"
      page={{
        topBar: <TopBar title={words.title} icon="users" isLoading />,
        body: (
          <PageColumn>
            <TeamWeek label={words.grid(rangeWords(monday, locale))} days={days} people={[]} isLoading />
          </PageColumn>
        ),
      }}
    />
  );
}
