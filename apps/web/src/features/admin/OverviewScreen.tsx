// Brief
// Purpose: Settings › Super admin › Overview (spec 0047, AC-1629): the whole app's numbers for a period.
// Main task: see at a glance whether users sign up, come back and use the product, against the period before.
// Leaves out: any one user or workspace (Users), booking pages (Booking pages) and the website (Website).
import type { DataLayer, OperatorOverview, OperatorPeriod } from '@crm/data';
import { useOperator } from '@crm/data/react';
import { SettingsGrid, SettingsSection, Stats, useFormatSettings } from '@crm/ui';
import { useMemo } from 'react';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { AdminFailed, DayChart, PeriodSwitch } from './AdminParts.tsx';
import { figureStat, formatters, plainStat } from './figures.ts';
import { strings } from './strings.ts';

/** Overview for `period`: its read held in the data layer, loading in place when the period changes. */
export function OverviewScreen({ data, period }: { readonly data: DataLayer; readonly period: OperatorPeriod }) {
  // A new period (or Retry) asks again; the data layer keeps each answer for the app load.
  const held = useMemo(() => data.operator.overview(period), [data, period]);
  const state = useOperator(held);
  if (state.status === 'error') {
    return <AdminFailed title={strings.overview} error={state.error} data={data} onRetry={held.retry} />;
  }
  return <OverviewBody period={period} overview={state.status === 'ready' ? state.value : undefined} />;
}

/** Overview's page: its figures and charts, or their loading shapes while `overview` is undefined. */
export function OverviewBody({
  period,
  overview,
}: {
  readonly period: OperatorPeriod;
  readonly overview: OperatorOverview | undefined;
}) {
  const { locale } = useFormatSettings();
  const format = formatters(locale);
  const series = (pick: (day: OperatorOverview['days'][number]) => number) =>
    overview?.days.map((day) => ({ day: day.day, value: pick(day) }));
  return (
    <SettingsPage title={strings.overview} actions={<PeriodSwitch period={period} />}>
      <SettingsSection title={strings.peopleSection}>
        <Stats
          label={strings.peopleSection}
          isLoading={overview === undefined}
          items={
            overview === undefined
              ? []
              : [
                  plainStat('users', strings.usersTotal, format.count(overview.people.total)),
                  figureStat('new', strings.newUsers, overview.people.new, period, format),
                  figureStat('active', strings.activePeriod, overview.active.period, period, format),
                  plainStat('workspaces', strings.workspacesTotal, format.count(overview.workspaces.total)),
                  figureStat('newWorkspaces', strings.newWorkspaces, overview.workspaces.new, period, format),
                ]
          }
        />
      </SettingsSection>
      <SettingsSection title={strings.rightNow}>
        <Stats
          label={strings.rightNow}
          isLoading={overview === undefined}
          items={
            overview === undefined
              ? []
              : [
                  plainStat('today', strings.activeToday, format.count(overview.active.today)),
                  plainStat('week', strings.activeWeek, format.count(overview.active.week)),
                  plainStat('month', strings.activeMonth, format.count(overview.active.month)),
                ]
          }
        />
      </SettingsSection>
      <SettingsSection title={strings.usageSection}>
        <Stats
          label={strings.usageSection}
          isLoading={overview === undefined}
          items={
            overview === undefined
              ? []
              : [
                  figureStat('records', strings.recordsMade, overview.records, period, format),
                  figureStat('bookings', strings.bookingsMade, overview.bookings, period, format),
                  figureStat('submissions', strings.submissions, overview.submissions, period, format),
                ]
          }
        />
      </SettingsSection>
      <SettingsSection title={strings.everyDay}>
        <SettingsGrid>
          <DayChart
            title={strings.signupsChart}
            days={series((day) => day.signups)}
            period={period}
            unit={strings.units.signups}
          />
          <DayChart
            title={strings.activeChart}
            days={series((day) => day.active)}
            period={period}
            unit={strings.units.active}
          />
          <DayChart
            title={strings.recordsChart}
            days={series((day) => day.records)}
            period={period}
            unit={strings.units.records}
          />
          <DayChart
            title={strings.bookingsChart}
            days={series((day) => day.bookings)}
            period={period}
            unit={strings.units.bookings}
          />
        </SettingsGrid>
      </SettingsSection>
    </SettingsPage>
  );
}
