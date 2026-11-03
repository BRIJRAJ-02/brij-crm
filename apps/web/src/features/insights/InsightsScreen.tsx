// Brief
// Purpose: Insights (spec 0067): for every public page the workspace serves (forms, booking pages, the link page),
//   how many came, how many finished, where they came from and where they stopped, over a period, against the one
//   before; the recent sessions, naming a person only where the reader may already read that submission or booking.
// Main task: see whether a page is working and which source brings people who finish, then share the numbers.
// Leaves out: live updates (a visit sends no change event; the page reads again on return), per product panels
//   (menus, QR codes, reservations and events come with those products), goals and alerts, and a custom period
//   picker (the address takes one; the controls offer the five ranges).
import type {
  DataLayer,
  InsightPage,
  InsightPages,
  InsightPeriod,
  InsightRange,
  InsightNumbersState,
  InsightSession,
  InsightSessionFilter,
  InsightSessionsState,
  Insights,
} from '@crm/data';
import { useInsightRead } from '@crm/data/react';
import {
  Button,
  ButtonLink,
  Card,
  DescriptionList,
  EmptyState,
  Modal,
  PageColumn,
  SegmentedControl,
  SectionBar,
  Select,
  Skeleton,
  Stats,
  Table,
  Toolbar,
  TopBar,
  useFormatSettings,
  type SelectItem,
} from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { capturesHref } from '../workspace/objects.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { saveFile } from '../link-page/qr-png.ts';
import { figure, insightsCsv, sourceWord, stepWord } from './format.ts';
import { InsightsBody } from './InsightsBody.tsx';
import type { InsightsSearch } from './search.ts';
import { ShareDialog } from './ShareDialog.tsx';
import { strings } from './strings.ts';

/** The ranges the period control offers, in order. */
const RANGES: readonly InsightRange[] = ['7', '30', '90', '365', 'all'];

/** Props for the Insights screen: the data layer, the workspace, and what the address asks. */
export interface InsightsScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly search: InsightsSearch;
}

/** The picker's value for a filter, and back. */
const pickerValue = (pages: InsightPages) =>
  pages.pageId !== undefined
    ? `page:${pages.kind ?? ''}:${pages.pageId}`
    : pages.kind !== undefined
      ? `kind:${pages.kind}`
      : 'all';

function pagesOfValue(value: string): InsightsSearch {
  if (value.startsWith('kind:')) {
    const kind = value.slice(5);
    return kind === 'form' || kind === 'booking' || kind === 'link' ? { kind } : {};
  }
  if (value.startsWith('page:')) {
    const [, kind, page] = value.split(':');
    return (kind === 'form' || kind === 'booking' || kind === 'link') && page !== undefined ? { kind, page } : {};
  }
  return {};
}

/** The page picker's items (AC-6710): every page, a kind, or one page the reader may see. */
function pickerItems(pages: readonly InsightPage[]): SelectItem[] {
  const forms = pages.filter((page) => page.kind === 'form');
  const booking = pages.filter((page) => page.kind === 'booking');
  const link = pages.filter((page) => page.kind === 'link');
  return [
    { id: 'all', label: strings.allPages, icon: 'layout-grid' },
    ...(forms.length > 0
      ? [
          { id: 'kind:form', label: strings.allForms, icon: 'file-text' as const },
          ...forms.map((page) => ({ id: `page:form:${page.id}`, label: page.name, description: strings.forms })),
        ]
      : []),
    ...(booking.length > 0
      ? [
          { id: 'kind:booking', label: strings.allBookingPages, icon: 'calendar-days' as const },
          ...booking.map((page) => ({
            id: `page:booking:${page.id}`,
            label: page.name,
            description: strings.bookingPages,
          })),
        ]
      : []),
    ...link.map((page) => ({ id: `page:link:${page.id}`, label: page.name, icon: 'id-card' as const })),
  ];
}

/** The signed in Insights screen. */
export function InsightsScreen({ data, slug, search }: InsightsScreenProps) {
  const navigate = useNavigate();
  const { toasts } = useRouteContext({ from: '__root__' });
  const range: InsightRange = search.range ?? '30';
  const pages: InsightPages = useMemo(
    () => ({
      ...(search.kind === undefined ? {} : { kind: search.kind }),
      ...(search.page === undefined ? {} : { pageId: search.page }),
    }),
    [search.kind, search.page],
  );
  const period: InsightPeriod = useMemo(() => ({ range }), [range]);
  const view = useMemo(() => data.insights.numbers(slug, period, pages), [data, slug, period, pages]);
  const state = useInsightRead(view);
  const [filter, setFilter] = useState<InsightSessionFilter>({});
  const [isSharing, setSharing] = useState(false);
  const sessionsView = useMemo(
    () => data.insights.sessions(slug, period, pages, filter),
    [data, slug, period, pages, filter],
  );
  const sessions = useInsightRead(sessionsView);

  const go = (next: InsightsSearch) => {
    void navigate({ to: '/w/$slug/insights', params: { slug }, search: next });
  };
  const known: readonly InsightPage[] = state.status === 'ready' ? state.insights.pages : [];

  const toolbar = (
    <Toolbar
      label={strings.insights}
      end={
        <>
          <Button
            variant="ghost"
            icon="download"
            isDisabled={state.status !== 'ready'}
            onPress={() => {
              if (state.status !== 'ready') return;
              const shown = sessions.status === 'ready' ? sessions.items : [];
              const csv = insightsCsv(state.insights, shown);
              saveFile(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `insights-${slug}-${range}.csv`);
              toasts.toast({ tone: 'success', message: strings.exported });
            }}
          >
            {strings.export}
          </Button>
          <Button
            variant="secondary"
            icon="share"
            isDisabled={state.status !== 'ready' || known.length === 0}
            onPress={() => setSharing(true)}
          >
            {strings.share}
          </Button>
        </>
      }
    >
      <Select
        label={strings.pages}
        isLabelHidden
        size="sm"
        items={pickerItems(known)}
        value={pickerValue(pages)}
        onChange={(value) => {
          if (value !== null)
            go({ ...(search.range === undefined ? {} : { range: search.range }), ...pagesOfValue(value) });
        }}
      />
      <SegmentedControl
        label={strings.period}
        size="compact"
        value={range}
        onChange={(next) => {
          const found = RANGES.find((each) => each === next);
          if (found !== undefined) go({ ...search, range: found });
        }}
        segments={RANGES.map((each) => ({ value: each, label: strings.rangeShort[each] }))}
      />
    </Toolbar>
  );

  return (
    <WorkspacePage
      currentPage="insights"
      page={{
        topBar: <TopBar title={strings.insights} icon="chart-line" />,
        toolbar,
        body: (
          <PageColumn>
            <Body
              state={state}
              sessions={sessions}
              filter={filter}
              onFilter={setFilter}
              onMore={() => sessionsView.more()}
              onSessionsRetry={() => sessionsView.reload()}
              onRetry={() => view.reload()}
              slug={slug}
              onLonger={() => go({ ...search, range: '90' })}
              onPickKind={() => go({ ...search, kind: 'form', page: undefined })}
            />
            {isSharing && state.status === 'ready' && (
              <ShareDialog data={data} slug={slug} pages={pages} range={range} onClose={() => setSharing(false)} />
            )}
          </PageColumn>
        ),
      }}
    />
  );
}

/** The page's body by its state: loading, failed, nothing yet, nothing in the period, or the numbers. */
function Body({
  state,
  sessions,
  filter,
  onFilter,
  onMore,
  onSessionsRetry,
  onRetry,
  onLonger,
  onPickKind,
  slug,
}: {
  readonly state: InsightNumbersState;
  readonly sessions: InsightSessionsState;
  readonly filter: InsightSessionFilter;
  readonly onFilter: (next: InsightSessionFilter) => void;
  readonly onMore: () => void;
  readonly onSessionsRetry: () => void;
  readonly onRetry: () => void;
  readonly onLonger: () => void;
  readonly onPickKind: () => void;
  readonly slug: string;
}) {
  if (state.status === 'loading') {
    return (
      <>
        <Stats label={strings.summary} items={[]} isLoading />
        <Skeleton shape="fill" />
      </>
    );
  }
  if (state.status === 'error') {
    return (
      <EmptyState tone="error" title={strings.failedTitle} onRetry={onRetry}>
        {state.message}
      </EmptyState>
    );
  }
  const { insights, isRefreshing } = state;
  if (insights.pages.length === 0) {
    return (
      <EmptyState
        icon="chart-line"
        title={strings.noPagesTitle}
        actions={
          <ButtonLink variant="primary" href={capturesHref(slug)}>
            {strings.emptyAction}
          </ButtonLink>
        }
      >
        {strings.noPagesText}
      </EmptyState>
    );
  }
  if (insights.totals.visits === 0 && (insights.previous?.visits ?? 0) === 0) {
    // Nothing ever, or nothing in a long period: the one next action is to share a page, or to look further back.
    const isLong = insights.grain === 'week';
    return (
      <EmptyState
        icon="chart-line"
        title={isLong ? strings.emptyTitle : strings.noneInPeriod}
        actions={
          isLong ? (
            <ButtonLink variant="primary" href={capturesHref(slug)}>
              {strings.emptyAction}
            </ButtonLink>
          ) : (
            <Button variant="primary" onPress={onLonger}>
              {strings.noneInPeriodAction}
            </Button>
          )
        }
      >
        {isLong ? strings.emptyText : strings.noneInPeriodText}
      </EmptyState>
    );
  }
  return (
    <>
      <InsightsBody
        numbers={insights}
        isRefreshing={isRefreshing}
        sourcesAside={<OtherSites insights={insights} />}
        onPickKind={onPickKind}
      />
      <Sessions
        insights={insights}
        sessions={sessions}
        filter={filter}
        onFilter={onFilter}
        onMore={onMore}
        onSessionsRetry={onSessionsRetry}
      />
    </>
  );
}

/** The hosts under Other (AC-6714): only to a signed in member, never on a share link. */
function OtherSites({ insights }: { readonly insights: Insights }) {
  const { locale } = useFormatSettings();
  if (insights.others.length === 0) return null;
  return (
    <Table
      label={strings.otherHosts}
      columns={[
        { id: 'host', label: strings.otherHosts, isRowHeader: true },
        { id: 'visits', label: strings.visits, align: 'end', size: 'fit' },
      ]}
      rows={insights.others}
      getRowId={(row) => row.host}
      renderCell={(row, column) => (column === 'host' ? row.host : figure(row.visits, locale))}
    />
  );
}

/** The Sessions table (AC-6715): filterable by outcome, source and step, a page at a time, each opening its details. */
function Sessions({
  insights,
  sessions,
  filter,
  onFilter,
  onMore,
  onSessionsRetry,
}: {
  readonly insights: Insights;
  readonly sessions: InsightSessionsState;
  readonly filter: InsightSessionFilter;
  readonly onFilter: (next: InsightSessionFilter) => void;
  readonly onMore: () => void;
  readonly onSessionsRetry: () => void;
}) {
  const { locale, timeZone } = useFormatSettings();
  const [open, setOpen] = useState<InsightSession | undefined>(undefined);
  const when = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }),
    [locale, timeZone],
  );
  const without = (key: keyof InsightSessionFilter): InsightSessionFilter =>
    Object.fromEntries(Object.entries(filter).filter(([each]) => each !== key));
  const sourceItems: SelectItem[] = [
    { id: '', label: strings.anySource },
    ...insights.sources
      .map((row) => row.source)
      .filter((source, at, all) => all.indexOf(source) === at)
      .map((source) => ({ id: source, label: sourceWord(source) })),
  ];
  const stepItems: SelectItem[] = [
    { id: '', label: strings.anyStep },
    ...['view', 'start', 'time', 'details', 'finish'].map((step) => ({ id: step, label: stepWord(step) })),
  ];
  const rows = sessions.status === 'ready' ? sessions.items : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  return (
    <Card
      title={strings.sessions}
      footerNote={strings.sessionsHint}
      {...(sessions.status === 'ready' && sessions.hasMore
        ? {
            footer: (
              <Button variant="ghost" isPending={sessions.isLoadingMore} onPress={onMore}>
                {strings.more}
              </Button>
            ),
          }
        : {})}
    >
      <SectionBar
        start={
          <>
            <Select
              label={strings.outcome}
              isLabelHidden
              size="sm"
              items={[
                { id: 'any', label: strings.anyOutcome },
                { id: 'yes', label: strings.onlyFinished },
                { id: 'no', label: strings.onlyLeft },
              ]}
              value={filter.finished === undefined ? 'any' : filter.finished ? 'yes' : 'no'}
              onChange={(value) =>
                onFilter(
                  value === 'yes'
                    ? { ...filter, finished: true }
                    : value === 'no'
                      ? { ...filter, finished: false }
                      : without('finished'),
                )
              }
            />
            <Select
              label={strings.source}
              isLabelHidden
              size="sm"
              items={sourceItems}
              value={filter.source ?? ''}
              onChange={(value) =>
                onFilter(value === null || value === '' ? without('source') : { ...filter, source: value })
              }
            />
            <Select
              label={strings.furthest}
              isLabelHidden
              size="sm"
              items={stepItems}
              value={filter.step ?? ''}
              onChange={(value) =>
                onFilter(value === null || value === '' ? without('step') : { ...filter, step: value })
              }
            />
          </>
        }
      />
      {sessions.status === 'error' ? (
        <EmptyState tone="error" layout="row" title={sessions.message} onRetry={onSessionsRetry} />
      ) : (
        <Table
          label={strings.sessions}
          isScrollable
          isLoading={sessions.status === 'loading'}
          columns={[
            { id: 'when', label: strings.when, isRowHeader: true, size: 'fit' },
            { id: 'page', label: strings.page },
            { id: 'outcome', label: strings.outcome, size: 'fit' },
            { id: 'person', label: strings.person },
            { id: 'source', label: strings.source },
            { id: 'medium', label: strings.medium },
            { id: 'campaign', label: strings.campaign },
            { id: 'step', label: strings.furthest, size: 'fit' },
          ]}
          rows={rows}
          getRowId={(row) => row.id}
          onRowAction={(id) => setOpen(byId.get(id))}
          emptyState={<EmptyState layout="row" title={strings.noSessions} />}
          renderCell={(row, column) => {
            switch (column) {
              case 'when':
                return when.format(new Date(row.at));
              case 'page':
                return row.pageName;
              case 'outcome':
                return row.finished ? strings.finished : strings.notFinished;
              case 'person':
                // A name only through the door (AC-6715): everyone else reads Finished, with no name.
                return row.person?.name ?? row.person?.email ?? '—';
              case 'source':
                return sourceWord(row.source);
              case 'medium':
                return row.medium ?? '—';
              case 'campaign':
                return row.campaign ?? '—';
              default:
                return stepWord(row.furthestStep, row.pageKind);
            }
          }}
        />
      )}
      {open !== undefined && <SessionDetails session={open} onClose={() => setOpen(undefined)} />}
    </Card>
  );
}

/** One session's landing address parameters (AC-6715). */
function SessionDetails({ session, onClose }: { readonly session: InsightSession; readonly onClose: () => void }) {
  const landing = session.landing;
  const items = [
    ...(session.person?.name === undefined ? [] : [{ term: strings.person, description: session.person.name }]),
    ...(session.person?.email === undefined
      ? []
      : [
          {
            term: strings.email,
            description: session.person.email,
            copy: { value: session.person.email, label: strings.copyEmail },
          },
        ]),
    { term: strings.page, description: session.pageName },
    { term: strings.furthest, description: stepWord(session.furthestStep, session.pageKind) },
    ...(landing === undefined
      ? []
      : [
          ...(['utm_source', 'utm_medium', 'utm_campaign'] as const).flatMap((key) =>
            landing[key] === undefined ? [] : [{ term: key, description: landing[key] }],
          ),
          ...(['utm_term', 'utm_content'] as const).flatMap((key) =>
            landing[key] === true ? [{ term: key, description: strings.present }] : [],
          ),
          ...(landing.gclid === true ? [{ term: 'gclid', description: strings.clickId }] : []),
          ...(landing.fbclid === true ? [{ term: 'fbclid', description: strings.clickId }] : []),
        ]),
  ];
  return (
    <Modal
      title={strings.sessionDetails}
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      actions={<Button slot="close">{strings.close}</Button>}
      {...(landing === undefined ? { hint: strings.noLanding } : {})}
    >
      <DescriptionList items={items} />
    </Modal>
  );
}
