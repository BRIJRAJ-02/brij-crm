// Brief
// Purpose: Settings › Super admin › Website (spec 0047, AC-1632): the marketing site's visits, from its own beacon.
// Main task: see how many people visit, which pages they read, and where they come from.
// Leaves out: who a visitor is (a daily id, never an address), and the app's own pages (Overview).
import type { DataLayer, OperatorPeriod, OperatorRank, OperatorSite } from '@crm/data';
import { useOperator } from '@crm/data/react';
import {
  Card,
  EmptyState,
  SettingsGrid,
  SettingsSection,
  Stats,
  Table,
  useFormatSettings,
  type TableColumn,
} from '@crm/ui';
import { useMemo } from 'react';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { AdminFailed, DayChart, PeriodSwitch } from './AdminParts.tsx';
import { figureStat, formatters, rateStat, type Formatters } from './figures.ts';
import { strings } from './strings.ts';

const columns = (name: string): readonly TableColumn[] => [
  { id: 'name', label: name, isRowHeader: true, size: 'fill' },
  { id: 'visitors', label: strings.columns.visitors, align: 'end', size: 'fit' },
  { id: 'views', label: strings.columns.views, align: 'end', size: 'fit' },
];

/** One ranking in a Card: its rows, "None in this period", or skeleton rows while `rows` is undefined. */
function Ranking({
  title,
  rows,
  name = (row) => row.name,
  format,
}: {
  readonly title: string;
  readonly rows: readonly OperatorRank[] | undefined;
  readonly name?: (row: OperatorRank) => string;
  readonly format: Formatters;
}) {
  return (
    <Card title={title}>
      <Table
        label={title}
        columns={columns(title)}
        rows={rows ?? []}
        getRowId={(row) => row.name}
        isLoading={rows === undefined}
        renderCell={(row, column) =>
          column === 'name' ? name(row) : format.count(column === 'visitors' ? row.visitors : row.views)
        }
        emptyState={<EmptyState layout="row" title={strings.noneInPeriod} />}
      />
    </Card>
  );
}

/** Website for a period, its read held in the data layer, loading in place when the period changes. */
export function SiteScreen({ data, period }: { readonly data: DataLayer; readonly period: OperatorPeriod }) {
  const held = useMemo(() => data.operator.site(period), [data, period]);
  const state = useOperator(held);
  if (state.status === 'error') {
    return <AdminFailed title={strings.website} error={state.error} data={data} onRetry={held.retry} />;
  }
  return <SiteBody period={period} site={state.status === 'ready' ? state.value : undefined} />;
}

/** Website: its figures, days and rankings, or their loading shapes while `site` is undefined. */
export function SiteBody({
  period,
  site,
}: {
  readonly period: OperatorPeriod;
  readonly site: OperatorSite | undefined;
}) {
  const { locale } = useFormatSettings();
  const format = formatters(locale);
  // Never counted: the site isn't sending visits yet (a quiet period still shows the page, its lists empty).
  if (site !== undefined && !site.hasVisits) {
    return (
      <SettingsPage title={strings.website} actions={<PeriodSwitch period={period} />}>
        <EmptyState icon="globe" title={strings.noVisits}>
          {strings.noVisitsText}
        </EmptyState>
      </SettingsPage>
    );
  }
  return (
    <SettingsPage title={strings.website} actions={<PeriodSwitch period={period} />}>
      <SettingsSection title={strings.visits} description={strings.siteNote}>
        <Stats
          label={strings.visits}
          isLoading={site === undefined}
          items={
            site === undefined
              ? []
              : [
                  figureStat('visitors', strings.visitorsStat, site.visitors, period, format),
                  figureStat('views', strings.pageViews, site.views, period, format),
                  rateStat('ratio', strings.viewsPerVisitor, site.views, site.visitors, period, format.ratio),
                ]
          }
        />
        <SettingsGrid>
          <DayChart
            title={strings.visitorsStat}
            days={site?.days.map((day) => ({ day: day.day, value: day.visitors }))}
            period={period}
            unit={strings.units.visitors}
          />
          <DayChart
            title={strings.pageViews}
            days={site?.days.map((day) => ({ day: day.day, value: day.views }))}
            period={period}
            unit={strings.units.views}
          />
        </SettingsGrid>
      </SettingsSection>
      <SettingsSection title={strings.breakdown}>
        <SettingsGrid>
          <Ranking title={strings.topPages} rows={site?.pages} format={format} />
          <Ranking title={strings.referrers} rows={site?.referrers} format={format} />
          <Ranking title={strings.sources} rows={site?.sources} format={format} />
          <Ranking
            title={strings.countries}
            rows={site?.countries}
            name={(row) => format.country(row.name)}
            format={format}
          />
          <Ranking
            title={strings.devices}
            rows={site?.devices}
            name={(row) => strings.deviceNames[row.name] ?? row.name}
            format={format}
          />
        </SettingsGrid>
      </SettingsSection>
    </SettingsPage>
  );
}
