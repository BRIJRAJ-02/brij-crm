// Brief
// Purpose: Settings › Super admin › Booking pages (spec 0047, AC-1631): every booking page together, then each one.
// Main task: see how many people look at booking pages and how many book, and which pages convert.
// Leaves out: who visited or booked (only counts), and changing a page (its editor is its owner's).
import type { OperatorPageDetail, OperatorPageRow, OperatorPages, OperatorPageTotals, OperatorPeriod } from '@crm/data';
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
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { DayChart, PeriodSwitch } from './AdminParts.tsx';
import { figureStat, formatters, kindLabel, stateLabel, type Formatters } from './figures.ts';
import { strings } from './strings.ts';

/** Where the booking pages list is. */
export const adminPagesHref = (slug: string) => `/w/${slug}/settings/admin/booking-pages`;

/** Where one booking page's numbers are. */
export const adminPageHref = (slug: string, pageId: string) => `/w/${slug}/settings/admin/booking-pages/${pageId}`;

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

/** The four figures, and the share of visitors who booked, as one Stats row. */
function totalStats(totals: OperatorPageTotals, period: OperatorPeriod, format: Formatters) {
  return [
    figureStat('views', strings.views, totals.views, period, format),
    figureStat('visitors', strings.visitors, totals.visitors, period, format),
    figureStat('bookings', strings.bookings, totals.bookings, period, format),
    {
      id: 'conversion',
      label: strings.conversion,
      value: format.share(totals.bookings.value, totals.visitors.value),
      comparison: strings.period.before(format.share(totals.bookings.before, totals.visitors.before), period),
    },
    figureStat('cancelled', strings.cancelled, totals.cancelled, period, format),
  ];
}

/** The charts every booking page view shows: views, visitors and bookings a day. */
function PageCharts({ days }: { readonly days: OperatorPages['days'] }) {
  const series = (pick: (day: OperatorPages['days'][number]) => number) =>
    days.map((day) => ({ day: day.day, value: pick(day) }));
  return (
    <SettingsGrid>
      <DayChart title={strings.viewsChart} days={series((day) => day.views)} unit={strings.units.views} />
      <DayChart title={strings.visitorsChart} days={series((day) => day.visitors)} unit={strings.units.visitors} />
      <DayChart title={strings.pageBookingsChart} days={series((day) => day.bookings)} unit={strings.units.bookings} />
    </SettingsGrid>
  );
}

/** Booking pages, loaded: every page together, then the table of pages, most viewed first. */
export function PagesScreen({ pages }: { readonly pages: OperatorPages }) {
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
        return page.owner === undefined ? strings.noOwner : page.owner.name === '' ? page.owner.email : page.owner.name;
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
    <SettingsPage title={strings.pages} actions={<PeriodSwitch period={pages.period} />}>
      <SettingsSection title={strings.allPages} description={strings.countsNote}>
        <Stats label={strings.allPages} items={totalStats(pages.totals, pages.period, format)} />
        <PageCharts days={pages.days} />
      </SettingsSection>
      <SettingsSection title={strings.eachPage}>
        <Table
          label={strings.pagesTable}
          columns={COLUMNS}
          rows={pages.pages}
          getRowId={(page) => page.pageId}
          renderCell={cell}
          isScrollable
          onRowAction={(id) => void navigate({ href: adminPageHref(slug, id) })}
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

/** Booking pages while they load. */
export function PagesPending({ period }: { readonly period: OperatorPeriod }) {
  return (
    <SettingsPage title={strings.pages} actions={<PeriodSwitch period={period} />}>
      <SettingsSection title={strings.allPages}>
        <Stats label={strings.allPages} items={[]} isLoading />
      </SettingsSection>
      <Table
        label={strings.pagesTable}
        columns={COLUMNS}
        rows={[]}
        getRowId={() => ''}
        renderCell={() => null}
        isLoading
      />
    </SettingsPage>
  );
}

/** One booking page, loaded: what it is, its figures against the period before, and its days. */
export function PageScreen({ detail }: { readonly detail: OperatorPageDetail }) {
  const { locale } = useFormatSettings();
  const format = formatters(locale);
  const { slug = '' } = useParams({ strict: false });
  const { page } = detail;
  return (
    <SettingsPage
      title={page.title}
      crumbs={[{ id: 'pages', label: strings.pages, href: adminPagesHref(slug) }]}
      actions={<PeriodSwitch period={detail.period} />}
    >
      <SettingsSection title={strings.pageSection}>
        <Card>
          <DescriptionList
            layout="columns"
            items={[
              { id: 'workspace', term: strings.columns.workspace, description: page.workspaceName },
              {
                id: 'owner',
                term: strings.columns.owner,
                description:
                  page.owner === undefined
                    ? strings.noOwner
                    : page.owner.name === ''
                      ? page.owner.email
                      : `${page.owner.name} (${page.owner.email})`,
              },
              { id: 'kind', term: strings.columns.kind, description: kindLabel(page.kind) },
              { id: 'state', term: strings.columns.state, description: stateLabel(page.status) },
              { id: 'made', term: strings.made, description: format.date(page.createdAt) },
            ]}
          />
        </Card>
      </SettingsSection>
      <SettingsSection title={strings.activitySection} description={strings.countsNote}>
        <Stats label={strings.activitySection} items={totalStats(detail.totals, detail.period, format)} />
        <PageCharts days={detail.days} />
      </SettingsSection>
    </SettingsPage>
  );
}

/** One booking page while it loads. */
export function PagePending({ period }: { readonly period: OperatorPeriod }) {
  const { slug = '' } = useParams({ strict: false });
  return (
    <SettingsPage
      title={strings.pages}
      crumbs={[{ id: 'pages', label: strings.pages, href: adminPagesHref(slug) }]}
      actions={<PeriodSwitch period={period} />}
      isLoading
    >
      <SettingsSection title={strings.activitySection}>
        <Stats label={strings.activitySection} items={[]} isLoading />
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
