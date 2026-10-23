// Brief
// Purpose: Settings › Super admin › Booking pages (spec 0047, AC-1631): every booking page together, then each one.
// Main task: see how many people look at booking pages and how many book, and which pages convert.
// Leaves out: who visited or booked (only counts), and changing a page (its editor is its owner's).
import {
  isDataError,
  type DataLayer,
  type OperatorPageDetail,
  type OperatorPageRow,
  type OperatorPages,
  type OperatorPageTotals,
  type OperatorPeriod,
} from '@crm/data';
import { useOperator } from '@crm/data/react';
import {
  Card,
  DescriptionList,
  EmptyState,
  Link,
  SettingsGrid,
  SettingsSection,
  Stats,
  Table,
  useFormatSettings,
  type TableColumn,
} from '@crm/ui';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMemo } from 'react';
import { SettingsMissing, SettingsPage } from '../settings/SettingsPage.tsx';
import { AdminFailed, useAdminRetry, DayChart, PeriodSwitch, useIsOperator } from './AdminParts.tsx';
import { figureStat, formatters, kindLabel, rateStat, stateLabel, type Formatters } from './figures.ts';
import { strings } from './strings.ts';

/** Where the booking pages list is. */
export const adminPagesHref = (slug: string) => `/w/${slug}/settings/admin/booking-pages`;

/** Where one booking page's numbers are. */
export const adminPageHref = (slug: string, workspaceId: string, pageId: string) =>
  `/w/${slug}/settings/admin/booking-pages/${workspaceId}/${pageId}`;

const COLUMNS: readonly TableColumn[] = [
  { id: 'title', label: strings.columns.page, isRowHeader: true },
  { id: 'workspace', label: strings.columns.workspace },
  { id: 'owner', label: strings.columns.owner },
  { id: 'kind', label: strings.columns.kind },
  { id: 'state', label: strings.columns.state },
  { id: 'views', label: strings.columns.views, align: 'end' },
  { id: 'visitors', label: strings.columns.visitors, align: 'end' },
  { id: 'bookings', label: strings.bookings, align: 'end' },
  { id: 'cancelled', label: strings.columns.cancelled, align: 'end' },
  { id: 'conversion', label: strings.columns.conversion, align: 'end' },
];

/** The four figures and the booking rate, as one Stats row; skeletons while `totals` is undefined. */
function TotalStats({
  label,
  totals,
  period,
  format,
}: {
  readonly label: string;
  readonly totals: OperatorPageTotals | undefined;
  readonly period: OperatorPeriod;
  readonly format: Formatters;
}) {
  return (
    <Stats
      label={label}
      isLoading={totals === undefined}
      items={
        totals === undefined
          ? []
          : [
              figureStat('views', strings.views, totals.views, period, format),
              figureStat('visitors', strings.visitors, totals.visitors, period, format),
              figureStat('bookings', strings.bookings, totals.bookings, period, format),
              rateStat('rate', strings.conversion, totals.bookings, totals.visitors, period, format.share),
              figureStat('cancelled', strings.cancelled, totals.cancelled, period, format),
            ]
      }
    />
  );
}

/** The charts every booking page view shows: views, visitors and bookings a day; empty stubs while loading. */
function PageCharts({
  days,
  period,
}: {
  readonly days: OperatorPages['days'] | undefined;
  readonly period: OperatorPeriod;
}) {
  const series = (pick: (day: OperatorPages['days'][number]) => number) =>
    days?.map((day) => ({ day: day.day, value: pick(day) }));
  return (
    <SettingsGrid>
      <DayChart
        title={strings.viewsChart}
        days={series((day) => day.views)}
        period={period}
        unit={strings.units.views}
      />
      <DayChart
        title={strings.visitorsChart}
        days={series((day) => day.visitors)}
        period={period}
        unit={strings.units.visitors}
      />
      <DayChart
        title={strings.pageBookingsChart}
        days={series((day) => day.bookings)}
        period={period}
        unit={strings.units.bookings}
      />
    </SettingsGrid>
  );
}

/** A page's owner as the list names them: their name, else their email, else nobody. */
function ownerOf(page: OperatorPageRow): string {
  if (page.owner === undefined) return strings.noOwner;
  return page.owner.name === '' ? page.owner.email : page.owner.name;
}

/** Booking pages for a period, its read held in the data layer, loading in place when the period changes. */
export function PagesScreen({ data, period }: { readonly data: DataLayer; readonly period: OperatorPeriod }) {
  const held = useMemo(() => data.operator.pages(period), [data, period]);
  const state = useOperator(held);
  const retry = useAdminRetry(held.retry);
  if (state.status === 'error') {
    return <AdminFailed title={strings.pages} error={state.error} data={data} onRetry={retry} />;
  }
  return <PagesBody period={period} pages={state.status === 'ready' ? state.value : undefined} />;
}

/** Booking pages: every page together, then the table of pages, most viewed first; skeletons while loading. */
export function PagesBody({
  period,
  pages,
}: {
  readonly period: OperatorPeriod;
  readonly pages: OperatorPages | undefined;
}) {
  const { locale } = useFormatSettings();
  const format = formatters(locale);
  const navigate = useNavigate();
  const { slug = '' } = useParams({ strict: false });
  const cell = (page: OperatorPageRow, column: string) => {
    switch (column) {
      case 'title':
        return page.title;
      case 'workspace':
        return page.workspaceName;
      case 'owner':
        return ownerOf(page);
      case 'kind':
        return kindLabel(page.kind);
      case 'state':
        return stateLabel(page.status);
      case 'views':
        return format.count(page.views);
      case 'visitors':
        return format.count(page.visitors);
      case 'bookings':
        return format.count(page.bookings);
      case 'cancelled':
        return format.count(page.cancelled);
      case 'conversion':
        return format.share(page.bookings, page.visitors);
      default:
        return null;
    }
  };
  return (
    <SettingsPage title={strings.pages} actions={<PeriodSwitch period={period} />}>
      <SettingsSection title={strings.allPages} description={strings.countsNote}>
        <TotalStats label={strings.allPages} totals={pages?.totals} period={period} format={format} />
        <PageCharts days={pages?.days} period={period} />
      </SettingsSection>
      <SettingsSection title={strings.eachPage} description={strings.eachPageNote}>
        <Table
          label={strings.pagesTable}
          columns={COLUMNS}
          rows={pages?.pages ?? []}
          getRowId={(page) => page.pageId}
          renderCell={cell}
          isLoading={pages === undefined}
          isScrollable
          onRowAction={(id) => {
            const page = pages?.pages.find((each) => each.pageId === id);
            if (page !== undefined) void navigate({ href: adminPageHref(slug, page.workspaceId, page.pageId) });
          }}
          emptyState={
            <EmptyState icon="calendar-days" title={strings.noPages}>
              {strings.noPagesText}
            </EmptyState>
          }
        />
      </SettingsSection>
    </SettingsPage>
  );
}

/** One booking page for a period, its read held in the data layer. */
export function PageScreen({
  data,
  workspaceId,
  pageId,
  period,
}: {
  readonly data: DataLayer;
  readonly workspaceId: string;
  readonly pageId: string;
  readonly period: OperatorPeriod;
}) {
  const held = useMemo(() => data.operator.page(workspaceId, pageId, period), [data, workspaceId, pageId, period]);
  const state = useOperator(held);
  const retry = useAdminRetry(held.retry);
  const isOperator = useIsOperator();
  if (state.status === 'error') {
    // No such page: its own page for a super admin, and Settings' "nothing here" for anyone else.
    if (isDataError(state.error) && (state.error.code === 'NOT_FOUND' || state.error.code === 'INPUT_INVALID')) {
      return isOperator ? <PageMissing /> : <SettingsMissing backTo="home" />;
    }
    return <AdminFailed title={strings.pages} error={state.error} data={data} onRetry={retry} />;
  }
  return <PageBody period={period} detail={state.status === 'ready' ? state.value : undefined} />;
}

/** One booking page: what it is, its figures against the period before, and its days; skeletons while loading. */
export function PageBody({
  period,
  detail,
}: {
  readonly period: OperatorPeriod;
  readonly detail: OperatorPageDetail | undefined;
}) {
  const { locale } = useFormatSettings();
  const format = formatters(locale);
  const { slug = '' } = useParams({ strict: false });
  const page = detail?.page;
  return (
    <SettingsPage
      title={page?.title ?? strings.pages}
      crumbs={[{ id: 'pages', label: strings.pages, href: adminPagesHref(slug) }]}
      actions={<PeriodSwitch period={period} />}
      isLoading={page === undefined}
    >
      <SettingsSection title={strings.pageSection}>
        <Card isBusy={page === undefined}>
          <DescriptionList
            layout="columns"
            items={
              page === undefined
                ? [
                    { id: 'workspace', term: strings.columns.workspace, description: '', isPlaceholder: true },
                    { id: 'owner', term: strings.columns.owner, description: '', isPlaceholder: true },
                    { id: 'made', term: strings.made, description: '', isPlaceholder: true },
                  ]
                : [
                    { id: 'workspace', term: strings.columns.workspace, description: page.workspaceName },
                    {
                      id: 'owner',
                      term: strings.columns.owner,
                      description:
                        page.owner === undefined || page.owner.name === ''
                          ? ownerOf(page)
                          : `${page.owner.name} (${page.owner.email})`,
                    },
                    { id: 'kind', term: strings.columns.kind, description: kindLabel(page.kind) },
                    { id: 'state', term: strings.columns.state, description: stateLabel(page.status) },
                    { id: 'made', term: strings.made, description: format.date(page.createdAt) },
                  ]
            }
          />
        </Card>
      </SettingsSection>
      <SettingsSection title={strings.activitySection} description={strings.countsNote}>
        <TotalStats label={strings.activitySection} totals={detail?.totals} period={period} format={format} />
        <PageCharts days={detail?.days} period={period} />
      </SettingsSection>
    </SettingsPage>
  );
}

/** No such booking page: the way back to the list. */
export function PageMissing() {
  const { slug = '' } = useParams({ strict: false });
  return (
    <SettingsPage
      title={strings.pageMissing}
      crumbs={[{ id: 'pages', label: strings.pages, href: adminPagesHref(slug) }]}
    >
      <EmptyState
        icon="search"
        title={strings.pageMissing}
        actions={<Link href={adminPagesHref(slug)}>{strings.backToPages}</Link>}
      >
        {strings.pageMissingText}
      </EmptyState>
    </SettingsPage>
  );
}
