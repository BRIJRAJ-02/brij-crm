// Brief
// Purpose: Bookings › Routing (spec 0037, AC-1383), for holders of routing.manage: every routed form and team page in one place, and every decision they made.
// Main task: see where each surface sends people when no rule matches and how it did in 30 days; then scan decisions, filter them, and open one to see why it went where it did.
// Leaves out: editing rules (each surface's own Routing card, linked), Skills and Test (L7), Smart (L8), Insights (L9).
import type { DataLayer, MemberSummary, RoutingDecision, RoutingDecisionFilters, RoutingSurface } from '@crm/data';
import { useRoutingDecisions, useRoutingOverview } from '@crm/data/react';
import {
  Badge,
  Button,
  Callout,
  ButtonLink,
  DescriptionList,
  EmptyState,
  InfoTip,
  memoIntl,
  PageColumn,
  Panel,
  RelativeTime,
  SectionBar,
  SegmentedControl,
  Select,
  Skeleton,
  Table,
  TruncatedText,
  useFormatSettings,
  type TableColumn,
} from '@crm/ui';
import { useCallback, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { linksHref, pageEditorHref } from '../booking/links.ts';
import { useBookingsToolbarSlot } from '../bookings/toolbarSlot.ts';
import { formHref } from '../forms/paths.ts';
import { strings } from './tab-strings.ts';

/** What the address holds: the view, the filters, and the decision open. */
export interface RoutingSearch {
  readonly view: 'overview' | 'decisions';
  readonly surface?: string;
  readonly rule?: string;
  readonly host?: string;
  readonly tag?: 'yes' | 'no' | 'none';
  readonly period?: 'today' | '7' | '30' | '90';
  readonly decision?: string;
}

/** Props for the screen. */
export interface RoutingScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly search: RoutingSearch;
  readonly members: readonly MemberSummary[];
  readonly onSearch: (next: Partial<RoutingSearch>) => void;
}

/** A day `days` before today, `YYYY-MM-DD` in UTC (the server reads days in UTC). */
function dayBefore(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** The filters the data layer reads, from the address. */
export function filtersOf(search: RoutingSearch): RoutingDecisionFilters {
  const from =
    search.period === undefined ? undefined : dayBefore(search.period === 'today' ? 0 : Number(search.period) - 1);
  return {
    ...(search.surface === undefined ? {} : { surfaceId: search.surface }),
    ...(search.surface === undefined || search.rule === undefined ? {} : { ruleId: search.rule }),
    ...(search.host === undefined ? {} : { hostId: search.host }),
    ...(search.tag === undefined ? {} : { qualified: search.tag }),
    ...(from === undefined ? {} : { from }),
  };
}

/** Overview and Decisions on the strip's end, as a Bookings tab's tools; at the top of the tab before the layout has one. */
function Toolbar({ children }: { readonly children: ReactNode }) {
  const slot = useBookingsToolbarSlot();
  return slot === null ? <>{children}</> : createPortal(children, slot);
}

/** Bookings › Routing. */
export function RoutingScreen({ data, slug, search, members, onSearch }: RoutingScreenProps) {
  const overviewHeld = useMemo(() => data.routing.overview(slug), [data, slug]);
  const overview = useRoutingOverview(overviewHeld);
  const surfaces = overview.status === 'ready' ? overview.overview.surfaces : [];
  return (
    <PageColumn>
      <Toolbar>
        <SegmentedControl
          label={strings.views}
          size="compact"
          value={search.view}
          onChange={(value) => {
            if (value === 'overview' || value === 'decisions') onSearch({ view: value });
          }}
          segments={[
            { value: 'overview', label: strings.overview },
            { value: 'decisions', label: strings.decisions },
          ]}
        />
      </Toolbar>
      {search.view === 'overview' ? (
        overview.status === 'error' ? (
          <EmptyState tone="error" title={strings.failedTitle} onRetry={() => overviewHeld.reload()}>
            {overview.message === '' ? strings.failedText : overview.message}
          </EmptyState>
        ) : (
          <Overview
            slug={slug}
            surfaces={surfaces}
            isLoading={overview.status === 'loading'}
            onDecisions={(surface) => onSearch({ view: 'decisions', surface, rule: undefined })}
          />
        )
      ) : (
        <Decisions data={data} slug={slug} search={search} surfaces={surfaces} members={members} onSearch={onSearch} />
      )}
    </PageColumn>
  );
}

const OVERVIEW_COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: strings.name, isRowHeader: true, isInline: true },
  { id: 'rules', label: strings.rules, align: 'end', size: 'fit' },
  { id: 'fallback', label: strings.fallback, isInline: true },
  {
    id: 'matched',
    label: strings.matched,
    align: 'end',
    size: 'fit',
    info: <InfoTip label={strings.matched}>{strings.last30}</InfoTip>,
  },
  {
    id: 'booked',
    label: strings.booked,
    align: 'end',
    size: 'fit',
    info: <InfoTip label={strings.booked}>{strings.last30}</InfoTip>,
  },
  { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit', isInline: true },
];

/** Where a surface's rules are edited: the form's Settings tab, the page's Hosts tab. */
const rulesHref = (slug: string, surface: RoutingSurface) =>
  surface.kind === 'form' ? formHref(slug, surface.id, 'settings') : pageEditorHref(slug, surface.id, 'hosts');

function Overview({
  slug,
  surfaces,
  isLoading,
  onDecisions,
}: {
  readonly slug: string;
  readonly surfaces: readonly RoutingSurface[];
  readonly isLoading: boolean;
  readonly onDecisions: (surfaceId: string) => void;
}) {
  const { locale } = useFormatSettings();
  const count = (value: number) => memoIntl(`count:${locale}`, () => new Intl.NumberFormat(locale)).format(value);
  return (
    <Table
      label={strings.surfacesTable}
      columns={OVERVIEW_COLUMNS}
      rows={surfaces}
      getRowId={(surface) => surface.id}
      isLoading={isLoading}
      isScrollable
      onRowAction={onDecisions}
      emptyState={
        // Empty only with no workspace link and no team page with rules: a team page comes first.
        <EmptyState
          icon="git-branch"
          title={strings.emptyTitle}
          actions={
            <ButtonLink variant="secondary" icon="plus" href={linksHref(slug)}>
              {strings.newTeamPage}
            </ButtonLink>
          }
        />
      }
      renderCell={(surface, column) => {
        switch (column) {
          case 'name':
            return (
              <>
                <TruncatedText>{surface.name}</TruncatedText>
                <Badge text={surface.isWorkspaceLink ? strings.workspaceLink : strings.kind[surface.kind]} />
                {surface.status === 'paused' && <Badge text={strings.paused} />}
                {surface.status === 'draft' && <Badge text={strings.draft} />}
              </>
            );
          case 'rules':
            return count(surface.rules);
          case 'fallback':
            return strings.fallbackOf(surface.fallback);
          case 'matched':
            return count(surface.matched);
          case 'booked':
            return count(surface.booked);
          default:
            return (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="list-checks"
                  label={strings.decisionsOf(surface.name)}
                  onPress={() => onDecisions(surface.id)}
                />
                <ButtonLink
                  size="sm"
                  variant="ghost"
                  icon="pencil"
                  label={strings.editRulesOf(surface.name)}
                  href={rulesHref(slug, surface)}
                />
              </>
            );
        }
      }}
    />
  );
}

const DECISION_COLUMNS: readonly TableColumn[] = [
  { id: 'when', label: strings.when, size: 'fit' },
  { id: 'surface', label: strings.surface },
  { id: 'outcome', label: strings.outcome, isRowHeader: true, isInline: true },
  { id: 'guest', label: strings.guest },
  { id: 'booking', label: strings.booking, isInline: true },
];

/** A decision's rule, in words. */
const ruleOf = (decision: RoutingDecision) =>
  decision.rule === undefined
    ? strings.noneMatched
    : strings.ruleLabel(decision.rule.position, decision.rule.name, decision.rule.hidden);

/** Where a decision sent the lead, in words: the page and its hosts, or only its hosts. */
function sentOf(decision: RoutingDecision): string | undefined {
  const hosts = decision.hosts.map((host) => host.name).filter((name) => name !== '');
  if (decision.routedPage !== undefined) {
    const page = strings.sentTo(decision.routedPage.name);
    return hosts.length === 0 ? page : `${page} · ${strings.withHosts(hosts)}`;
  }
  return hosts.length === 0 ? undefined : strings.withHosts(hosts);
}

function Decisions({
  data,
  slug,
  search,
  surfaces,
  members,
  onSearch,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly search: RoutingSearch;
  readonly surfaces: readonly RoutingSurface[];
  readonly members: readonly MemberSummary[];
  readonly onSearch: (next: Partial<RoutingSearch>) => void;
}) {
  const filters = useMemo(() => filtersOf(search), [search]);
  const held = useMemo(() => data.routing.decisions(slug, filters), [data, slug, filters]);
  const state = useRoutingDecisions(held);
  const { locale, timeZone } = useFormatSettings();
  // A moment on the reader's clock: "Tue, 3 Nov, 10:00".
  const format = useCallback(
    (value: string) =>
      memoIntl(
        `routing-moment:${locale}:${timeZone}`,
        () =>
          new Intl.DateTimeFormat(locale, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
            timeZone,
          }),
      ).format(new Date(value)),
    [locale, timeZone],
  );
  const isFiltered = Object.keys(filters).length > 0;
  // A filter change closes the decision open, so it never comes back when the filter is set back.
  const filter = (next: Partial<RoutingSearch>) => onSearch({ ...next, decision: undefined });
  const surface = surfaces.find((each) => each.id === search.surface);
  const open = state.status === 'ready' ? state.decisions.find((each) => each.id === search.decision) : undefined;
  const ruleItems = [
    { id: 'any', label: strings.anyRule },
    ...(surface?.ruleList ?? []).map((rule, index) => ({
      id: rule.id,
      label: strings.ruleLabel(index + 1, rule.name, undefined),
    })),
    { id: 'fallback', label: strings.noneMatched },
  ];
  return (
    <>
      <SectionBar
        start={
          <>
            <Select
              label={strings.surface}
              isLabelHidden
              size="sm"
              items={[
                { id: 'any', label: strings.anySurface },
                ...surfaces.map((each) => ({ id: each.id, label: each.name })),
              ]}
              value={search.surface ?? 'any'}
              // Its choices are the Overview's: until they are read, the address's surface can't show.
              isDisabled={surfaces.length === 0 && search.surface !== undefined}
              onChange={(id) => filter({ surface: id === null || id === 'any' ? undefined : id, rule: undefined })}
            />
            {surface !== undefined && (
              <Select
                label={strings.rule}
                isLabelHidden
                size="sm"
                items={ruleItems}
                value={search.rule ?? 'any'}
                onChange={(id) => filter({ rule: id === null || id === 'any' ? undefined : id })}
              />
            )}
            <Select
              label={strings.host}
              isLabelHidden
              size="sm"
              isSearchable
              items={[
                { id: 'any', label: strings.anyHost },
                ...members.map((member) => ({ id: member.id, label: member.name })),
              ]}
              value={search.host ?? 'any'}
              onChange={(id) => filter({ host: id === null || id === 'any' ? undefined : id })}
            />
            <Select
              label={strings.tag}
              isLabelHidden
              size="sm"
              items={[
                { id: 'any', label: strings.anyTag },
                { id: 'yes', label: strings.qualified },
                { id: 'no', label: strings.notQualified },
                { id: 'none', label: strings.noTag },
              ]}
              value={search.tag ?? 'any'}
              onChange={(id) => filter({ tag: id === 'yes' || id === 'no' || id === 'none' ? id : undefined })}
            />
            <Select
              label={strings.period}
              isLabelHidden
              size="sm"
              items={[
                { id: 'any', label: strings.anyTime },
                { id: 'today', label: strings.today },
                { id: '7', label: strings.days(7) },
                { id: '30', label: strings.days(30) },
                { id: '90', label: strings.days(90) },
              ]}
              value={search.period ?? 'any'}
              onChange={(id) =>
                filter({ period: id === 'today' || id === '7' || id === '30' || id === '90' ? id : undefined })
              }
            />
          </>
        }
      />
      {state.status === 'error' ? (
        <EmptyState tone="error" title={strings.failedTitle} onRetry={() => held.reload()}>
          {state.message === '' ? strings.failedText : state.message}
        </EmptyState>
      ) : (
        <Table
          label={strings.decisionsTable}
          columns={DECISION_COLUMNS}
          rows={state.status === 'ready' ? state.decisions : []}
          getRowId={(decision) => decision.id}
          isLoading={state.status === 'loading'}
          isScrollable
          onRowAction={(id) => onSearch({ decision: id })}
          // A page the reader could see none of (people hidden from them) with more behind it: no empty state, only More.
          emptyState={
            state.status === 'ready' && state.hasMore ? undefined : isFiltered ? (
              <EmptyState
                icon="git-branch"
                title={strings.noMatch}
                actions={
                  <Button
                    variant="secondary"
                    onPress={() =>
                      filter({
                        surface: undefined,
                        rule: undefined,
                        host: undefined,
                        tag: undefined,
                        period: undefined,
                      })
                    }
                  >
                    {strings.clearFilters}
                  </Button>
                }
              />
            ) : (
              <EmptyState icon="git-branch" title={strings.noDecisions} />
            )
          }
          renderCell={(decision, column) => {
            switch (column) {
              case 'when':
                return <RelativeTime value={decision.decidedAt} />;
              case 'surface':
                return <TruncatedText>{decision.surface.name}</TruncatedText>;
              case 'outcome': {
                const sent = sentOf(decision);
                return (
                  <>
                    <TruncatedText>
                      {sent === undefined ? ruleOf(decision) : `${ruleOf(decision)} · ${sent}`}
                    </TruncatedText>
                    {decision.steps.length > 0 && (
                      <Badge text={strings.step(decision.steps.at(-1) ?? { kind: 'contact' })} />
                    )}
                  </>
                );
              }
              case 'guest':
                return <TruncatedText>{decision.guest ?? ''}</TruncatedText>;
              default:
                return decision.booking === undefined ? (
                  strings.notBooked
                ) : (
                  <>
                    <TruncatedText>{decision.booking.hostName}</TruncatedText>
                    {decision.booking.noShow && <Badge text={strings.noShow} />}
                    {decision.booking.status === 'cancelled' && <Badge text={strings.cancelled} />}
                  </>
                );
            }
          }}
        />
      )}
      {state.status === 'ready' && state.moreFailed !== undefined && (
        <Callout tone="danger" isAnnounced>
          {strings.moreFailed}
        </Callout>
      )}
      {state.status === 'ready' && state.hasMore && (
        <Button onPress={() => held.more()} isPending={state.isLoadingMore}>
          {state.moreFailed === undefined ? strings.showMore : strings.tryAgain}
        </Button>
      )}
      {open !== undefined && (
        <Panel title={strings.details} isOpen onClose={() => onSearch({ decision: undefined })}>
          <Explanation decision={open} format={format} />
        </Panel>
      )}
    </>
  );
}

/** One decision, explained (AC-1375): the rule, the tag, where it sent them, what happened, and the booking. */
function Explanation({
  decision,
  format,
}: {
  readonly decision: RoutingDecision;
  readonly format: (value: string) => string;
}) {
  const sent = sentOf(decision);
  const items = [
    { term: strings.surface, description: decision.surface.name },
    { term: strings.rule, description: ruleOf(decision) },
    ...(decision.qualified === undefined
      ? []
      : [
          {
            term: strings.tag,
            description: (
              <Badge
                tone={decision.qualified ? 'accent' : 'neutral'}
                text={decision.qualified ? strings.qualified : strings.notQualified}
              />
            ),
          },
        ]),
    ...(sent === undefined ? [] : [{ term: strings.outcome, description: sent }]),
    ...(decision.steps.length === 0
      ? []
      : [
          {
            term: strings.steps,
            description: decision.steps.map((step) => `${strings.step(step)}.`).join(' '),
          },
        ]),
    ...(decision.skipped.length === 0
      ? []
      : [{ term: strings.skipped, description: strings.skippedLine(decision.skipped) }]),
    ...(decision.guest === undefined ? [] : [{ term: strings.guest, description: decision.guest }]),
    {
      term: strings.booking,
      description:
        decision.booking === undefined
          ? strings.notBooked
          : `${strings.bookedWith(decision.booking.hostName)} · ${format(decision.booking.startsAt)}`,
    },
    { term: strings.decidedAt, description: format(decision.decidedAt) },
  ];
  return <DescriptionList layout="stacked" items={items} />;
}

/** The tab while its first read loads. */
export function RoutingPending() {
  return (
    <PageColumn>
      <Skeleton shape="block" />
    </PageColumn>
  );
}
