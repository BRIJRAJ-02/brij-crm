// Brief
// Purpose: Settings › Super admin › Website (spec 0047, AC-1632): the marketing site's visits, from its own beacon.
// Main task: see how many people visit, which pages they read, and where they come from.
// Leaves out: who a visitor is (a daily id, never an address), and the app's own pages (Overview).
import type { OperatorPeriod, OperatorRank, OperatorSite } from '@crm/data';
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
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { DayChart, PeriodSwitch } from './AdminParts.tsx';
import { figureStat, formatters, type Formatters } from './figures.ts';
import { strings } from './strings.ts';

const columns = (name: string): readonly TableColumn[] => [
  { id: 'name', label: name, isRowHeader: true, size: 'fill' },
  { id: 'visitors', label: strings.columns.visitors, align: 'end', size: 'fit' },
  { id: 'views', label: strings.columns.views, align: 'end', size: 'fit' },
];

/** One ranking in a Card: its rows, or "None in this period". */
function Ranking({
  title,
  rows,
  name = (row) => row.name,
  format,
}: {
  readonly title: string;
  readonly rows: readonly OperatorRank[];
  readonly name?: (row: OperatorRank) => string;
  readonly format: Formatters;
}) {
  return (
    <Card title={title}>
      <Table
        label={title}
        columns={columns(title)}
        rows={rows}
        getRowId={(row) => row.name}
        renderCell={(row, column) =>
          column === 'name' ? name(row) : format.count(column === 'visitors' ? row.visitors : row.views)
        }
        emptyState={<EmptyState layout="row" title={strings.noneInPeriod} />}
      />
    </Card>
  );
}

/** Website, loaded. */
export function SiteScreen({ site }: { readonly site: OperatorSite }) {
  const { locale } = useFormatSettings();
  const format = formatters(locale);
  const { period } = site;
  const nothingEver = site.visitors.value === 0 && site.visitors.before === 0;
  return (
    <SettingsPage title={strings.website} actions={<PeriodSwitch period={period} />}>
      {nothingEver ? (
        <EmptyState icon="globe" title={strings.noVisits}>
          {strings.noVisitsText}
        </EmptyState>
      ) : (
        <>
          <SettingsSection title={strings.visits} description={strings.siteNote}>
            <Stats
              label={strings.visits}
              items={[
                figureStat('visitors', strings.visitorsStat, site.visitors, period, format),
                figureStat('views', strings.pageViews, site.views, period, format),
                {
                  id: 'ratio',
                  label: strings.viewsPerVisitor,
                  value: format.ratio(site.views.value, site.visitors.value),
                  comparison: strings.period.before(format.ratio(site.views.before, site.visitors.before), period),
                },
              ]}
            />
            <SettingsGrid>
              <DayChart
                title={strings.visitorsStat}
                days={site.days.map((day) => ({ day: day.day, value: day.visitors }))}
                unit={strings.units.visitors}
              />
              <DayChart
                title={strings.pageViews}
                days={site.days.map((day) => ({ day: day.day, value: day.views }))}
                unit={strings.units.views}
              />
            </SettingsGrid>
          </SettingsSection>
          <SettingsSection title={strings.breakdown}>
            <SettingsGrid>
              <Ranking title={strings.topPages} rows={site.pages} format={format} />
              <Ranking title={strings.referrers} rows={site.referrers} format={format} />
              <Ranking title={strings.sources} rows={site.sources} format={format} />
              <Ranking
                title={strings.countries}
                rows={site.countries}
                name={(row) => format.country(row.name)}
                format={format}
              />
              <Ranking
                title={strings.devices}
                rows={site.devices}
                name={(row) => strings.deviceNames[row.name] ?? row.name}
                format={format}
              />
            </SettingsGrid>
          </SettingsSection>
        </>
      )}
    </SettingsPage>
  );
}

/** Website while it loads. */
export function SitePending({ period }: { readonly period: OperatorPeriod }) {
  return (
    <SettingsPage title={strings.website} actions={<PeriodSwitch period={period} />}>
      <SettingsSection title={strings.visits}>
        <Stats label={strings.visits} items={[]} isLoading />
      </SettingsSection>
    </SettingsPage>
  );
}
