// Brief
// Purpose: Settings › Super admin › Overview (spec 0047, AC-1629): the whole app's numbers for a period.
// Main task: see at a glance whether people sign up, come back and use the product, against the period before.
// Leaves out: any one person or workspace (Users), booking pages (Booking pages) and the website (Website).
import type { OperatorOverview, OperatorPeriod } from '@crm/data';
import { SettingsGrid, SettingsSection, Stats, useFormatSettings } from '@crm/ui';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { DayChart, PeriodSwitch } from './AdminParts.tsx';
import { figureStat, formatters, plainStat } from './figures.ts';
import { strings } from './strings.ts';

/** Overview, loaded. */
export function OverviewScreen({ overview }: { readonly overview: OperatorOverview }) {
  const { locale } = useFormatSettings();
  const format = formatters(locale);
  const { period } = overview;
  const series = (pick: (day: OperatorOverview['days'][number]) => number) =>
    overview.days.map((day) => ({ day: day.day, value: pick(day) }));
  return (
    <SettingsPage title={strings.overview} actions={<PeriodSwitch period={period} />}>
      <SettingsSection title={strings.peopleSection}>
        <Stats
          label={strings.peopleSection}
          items={[
            plainStat('accounts', strings.accounts, format.count(overview.people.total)),
            figureStat('new', strings.newAccounts, overview.people.new, period, format),
            plainStat('today', strings.activeToday, format.count(overview.active.today)),
            plainStat('week', strings.activeWeek, format.count(overview.active.week)),
            plainStat('month', strings.activeMonth, format.count(overview.active.month)),
          ]}
        />
      </SettingsSection>
      <SettingsSection title={strings.usageSection}>
        <Stats
          label={strings.usageSection}
          items={[
            {
              ...figureStat('workspaces', strings.newWorkspaces, overview.workspaces.new, period, format),
              comparison: strings.workspacesTotal(format.count(overview.workspaces.total)),
            },
            figureStat('records', strings.recordsMade, overview.records, period, format),
            figureStat('bookings', strings.bookingsMade, overview.bookings, period, format),
            figureStat('submissions', strings.submissions, overview.submissions, period, format),
          ]}
        />
      </SettingsSection>
      <SettingsSection title={strings.everyDay}>
        <SettingsGrid>
          <DayChart title={strings.signupsChart} days={series((day) => day.signups)} unit={strings.units.signups} />
          <DayChart title={strings.activeChart} days={series((day) => day.active)} unit={strings.units.active} />
          <DayChart title={strings.recordsChart} days={series((day) => day.records)} unit={strings.units.records} />
          <DayChart title={strings.bookingsChart} days={series((day) => day.bookings)} unit={strings.units.bookings} />
        </SettingsGrid>
      </SettingsSection>
    </SettingsPage>
  );
}

/** Overview while it loads: the same sections, their figures as skeletons. */
export function OverviewPending({ period }: { readonly period: OperatorPeriod }) {
  return (
    <SettingsPage title={strings.overview} actions={<PeriodSwitch period={period} />}>
      <SettingsSection title={strings.peopleSection}>
        <Stats label={strings.peopleSection} items={[]} isLoading />
      </SettingsSection>
      <SettingsSection title={strings.usageSection}>
        <Stats label={strings.usageSection} items={[]} isLoading />
      </SettingsSection>
    </SettingsPage>
  );
}
