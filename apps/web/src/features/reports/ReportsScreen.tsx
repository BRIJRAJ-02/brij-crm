// Brief
// Purpose: how the workspace is doing, as charts over any object: a saved report per tab, drawn from the records
// the reader may see, and one more tab to make a new one.
// Main task: pick an object, a measure, a group and a filter, see the chart at once, and save it for the team.
// Leaves out: a dashboard of several charts on one page, currency conversion, drilling into the records, a date
//   range (the last twelve periods), sharing links, and private reports.
import {
  isDataError,
  type AttributeDefinition,
  type MemberView,
  type ObjectSummary,
  type Permission,
  type ReportView,
} from '@crm/data';
import { useCaptureList, useViewsList } from '@crm/data/react';
import { groupChoices, planReport, type ReportAttribute } from '@crm/contracts/reports';
import {
  Button,
  EmptyState,
  Field,
  PageColumn,
  SegmentedControl,
  Select,
  Tabs,
  Toolbar,
  TopBar,
  useFormatSettings,
  type IconName,
  type SelectItem,
} from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { weekStartOf } from '../workspace/first-day.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import {
  autoName,
  chartsFor,
  draftOfReport,
  draftOn,
  firstDraft,
  groupKeyOf,
  groupLabel,
  keyOfQuestions,
  measureChoices,
  measureKeyOf,
  reportAttributesOf,
  sameReport,
  withChart,
  withFilter,
  withGroup,
  withMeasure,
  type ReportDraft,
} from './builder.ts';
import { PickedFilter } from './PickedFilter.tsx';
import { ReportBody } from './ReportBody.tsx';
import { NEW_REPORT, type ReportsSearch } from './search.ts';
import { strings } from './strings.ts';
import type { FilterGroup } from '@crm/contracts/values';

/** Props for the Reports page: what its route loaded through the data layer, and its address. */
export interface ReportsScreenProps {
  readonly slug: string;
  readonly search: ReportsSearch;
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberView[];
  readonly permissions: readonly Permission[];
  readonly meId: string | undefined;
  /** Every object's live attributes, by object id. */
  readonly attributes: Readonly<Record<string, readonly AttributeDefinition[]>>;
}

const NO_REPORTS: readonly ReportView[] = [];

const CHART_ICONS: Readonly<Record<'bar' | 'line' | 'number', IconName>> = {
  bar: 'chart-bar',
  line: 'chart-line',
  number: 'hash',
};

const CHART_WORDS = { bar: strings.bars, line: strings.line, number: strings.number } as const;

/** What the page holds for the tab open: its draft, and the id a new report is saved under. */
interface Held {
  readonly key: string;
  readonly draft: ReportDraft | undefined;
  readonly newId: string;
}

/** Reports: the tabs, the builder's toolbar and the chart. */
export function ReportsScreen({ slug, search, objects, members, permissions, meId, attributes }: ReportsScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const { timeZone, weekStart } = useFormatSettings();
  const list = useCaptureList(data.reports.view(slug));
  const reports = list.status === 'ready' ? list.items : NO_REPORTS;
  const live = useMemo(() => objects.filter((object) => !object.isArchived), [objects]);
  const attributesByObject = useMemo(
    () => new Map(live.map((object) => [object.id, reportAttributesOf(attributes[object.id] ?? [])])),
    [live, attributes],
  );
  const attributesOf = useCallback(
    (objectId: string): readonly ReportAttribute[] => attributesByObject.get(objectId) ?? [],
    [attributesByObject],
  );
  // The moment the page opened: "the last twelve months" is counted from it for as long as the page stays.
  const [openedAt] = useState(() => new Date().toISOString());

  // The tab open: the address's report, else the first saved one, else a new one.
  const found = search.r === undefined || search.r === NEW_REPORT ? undefined : reports.find((r) => r.id === search.r);
  const selectedKey =
    search.r === NEW_REPORT
      ? NEW_REPORT
      : (found?.id ?? (search.r === undefined ? (reports[0]?.id ?? NEW_REPORT) : NEW_REPORT));
  const report = selectedKey === NEW_REPORT ? undefined : reports.find((r) => r.id === selectedKey);

  const startDraft = (): ReportDraft | undefined =>
    report === undefined ? firstDraft(live, attributesOf) : draftOfReport(report);
  const [held, setHeld] = useState<Held>(() => ({
    key: selectedKey,
    draft: startDraft(),
    newId: data.reports.newId(),
  }));
  let current = held;
  if (held.key !== selectedKey) {
    // Another tab: its own draft, as the report was saved or as a first visit draws.
    current = { key: selectedKey, draft: startDraft(), newId: data.reports.newId() };
    setHeld(current);
  }
  const { draft, newId } = current;
  const update = (change: (draft: ReportDraft) => ReportDraft) => {
    setHeld((now) => (now.draft === undefined ? now : { ...now, draft: change(now.draft) }));
  };

  const [pendingView, setPendingView] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const viewsList = useViewsList(
    useMemo(() => data.views.list(slug, draft?.objectId ?? ''), [data, slug, draft?.objectId]),
  );

  const readFilter = useCallback((viewId: string, name: string, filter: FilterGroup | undefined) => {
    setPendingView((now) => (now === viewId ? undefined : now));
    setHeld((now) =>
      now.draft === undefined
        ? now
        : { ...now, draft: { ...now.draft, config: withFilter(now.draft.config, filter, name) } },
    );
  }, []);
  const failFilter = useCallback(
    (viewId: string) => {
      setPendingView((now) => (now === viewId ? undefined : now));
      setHeld((now) => (now.draft === undefined ? now : { ...now, draft: { ...now.draft, filterChoice: 'all' } }));
      toasts.toast({ tone: 'danger', message: strings.viewFailed });
    },
    [toasts],
  );

  const tabs = [
    ...reports.map((each) => ({ id: each.id, label: each.name, icon: 'chart-bar' as const })),
    { id: NEW_REPORT, label: strings.newReport, icon: 'plus' as const },
  ];
  const open = (id: string) => {
    void navigate({ to: '/w/$slug/reports', params: { slug }, search: { r: id } });
  };

  if (draft === undefined) {
    return (
      <WorkspacePage
        page={{
          topBar: <TopBar title={strings.reports} icon="chart-bar" />,
          body: (
            <EmptyState icon="chart-bar" title={strings.noObjectsTitle}>
              {strings.noObjectsText}
            </EmptyState>
          ),
        }}
      />
    );
  }

  const object = live.find((each) => each.id === draft.objectId);
  const attrs = attributesOf(draft.objectId);
  const { config } = draft;
  const canEdit = report === undefined || report.creatorMemberId === meId || permissions.includes('views.manage');
  const isDirty = report === undefined || !sameReport(draft, report);
  const groupChoicesNow = groupChoices(attrs);
  const planned = planReport(config, {
    objectId: draft.objectId,
    attributes: attrs,
    members: members.map((member) => ({ id: member.id, name: member.name })),
    now: openedAt,
    timeZone,
    weekStart: weekStartOf(weekStart),
  });
  const plan = 'plan' in planned ? planned.plan : undefined;
  const planKey = plan === undefined ? 'none' : keyOfQuestions([plan.questions, plan.slices, plan.unit]);
  const groupAttribute =
    config.groupBy === undefined ? undefined : attrs.find((each) => each.id === config.groupBy?.attributeId);
  const measureId = config.measure.fn === 'count' ? undefined : config.measure.attributeId;
  const measureAttribute = measureId === undefined ? undefined : attrs.find((each) => each.id === measureId);

  const apply = (next: typeof config, objectId = draft.objectId) => {
    const plural = objects.find((each) => each.id === objectId)?.pluralName ?? '';
    update((now) => ({
      ...now,
      objectId,
      config: next,
      name: now.isNameChosen ? now.name : autoName(plural, attributesOf(objectId), next),
    }));
  };

  const changeObject = (objectId: string | null) => {
    const next = live.find((each) => each.id === objectId);
    if (next === undefined || next.id === draft.objectId) return;
    setPendingView(undefined);
    update((now) => ({
      ...draftOn(next, attributesOf(next.id)),
      ...(now.isNameChosen ? { name: now.name, isNameChosen: true } : {}),
    }));
  };

  const changeFilter = (choice: string | null) => {
    if (choice === null || choice === draft.filterChoice) return;
    if (choice === 'all') {
      setPendingView(undefined);
      update((now) => ({ ...now, filterChoice: 'all', config: withFilter(now.config, undefined, undefined) }));
    } else if (choice !== 'kept') {
      setPendingView(choice);
      update((now) => ({ ...now, filterChoice: choice }));
    }
  };

  const objectItems: readonly SelectItem[] = live.map((each) => ({
    id: each.id,
    label: each.pluralName,
    icon: each.icon,
  }));
  const measureItems = measureChoices(attrs).map((choice) => ({ id: choice.key, label: choice.label }));
  const groupItems: readonly SelectItem[] = [
    ...groupChoicesNow.map((choice) => ({ id: choice.key, label: groupLabel(choice, attrs) })),
    { id: 'none', label: strings.total },
  ];
  const filterItems: readonly SelectItem[] = [
    { id: 'all', label: strings.allRecords },
    ...viewsList.views.map((view) => ({ id: view.id, label: view.name, icon: 'list-filter' as const })),
    ...(config.filter !== undefined && !viewsList.views.some((view) => view.id === draft.filterChoice)
      ? [{ id: 'kept', label: config.filterName ?? strings.savedFilter, icon: 'list-filter' as const }]
      : []),
  ];
  const charts = chartsFor(attrs);

  const save = () => {
    const name = draft.name.trim() === '' ? autoName(object?.pluralName ?? '', attrs, config) : draft.name.trim();
    setIsSaving(true);
    const done =
      report === undefined
        ? data.reports.create(slug, { id: newId, objectId: draft.objectId, name, config }).then((made) => {
            open(made.id);
          })
        : data.reports.update(slug, report.id, { name, config }).then(() => undefined);
    done
      .then(() => {
        toasts.toast({ tone: 'success', message: strings.saved });
      })
      .catch((error: unknown) => {
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.saveFailed });
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const remove = () => {
    if (report === undefined) return;
    const gone = report;
    const next = reports.find((each) => each.id !== gone.id);
    data.reports
      .remove(slug, gone.id)
      .then(() => {
        open(next?.id ?? NEW_REPORT);
        toasts.toast({
          tone: 'success',
          message: strings.deleted,
          action: {
            label: strings.undo,
            onAction: () => {
              data.reports
                .create(slug, { id: gone.id, objectId: gone.objectId, name: gone.name, config: gone.config })
                .then(() => {
                  open(gone.id);
                })
                .catch(() => {
                  toasts.toast({ tone: 'danger', message: strings.restoreFailed });
                });
            },
          },
        });
      })
      .catch((error: unknown) => {
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.saveFailed });
      });
  };

  return (
    <WorkspacePage
      page={{
        topBar: <TopBar title={strings.reports} icon="chart-bar" />,
        viewBar: (
          <Tabs
            variant="bar"
            label={strings.tabsLabel}
            tabs={tabs}
            selectedKey={selectedKey}
            onSelectionChange={open}
          />
        ),
        toolbar: (
          <Toolbar
            label={strings.builderLabel}
            end={
              <>
                {report !== undefined && canEdit && (
                  <Button variant="ghost-danger" icon="trash" label={strings.deleteReport} onPress={remove} />
                )}
                {canEdit && isDirty && (
                  <Button variant="primary" isPending={isSaving} onPress={save}>
                    {strings.save}
                  </Button>
                )}
              </>
            }
          >
            <Select
              label={strings.object}
              isLabelHidden
              size="sm"
              items={objectItems}
              value={draft.objectId}
              onChange={changeObject}
            />
            <Select
              label={strings.measure}
              isLabelHidden
              size="sm"
              items={measureItems}
              value={measureKeyOf(config)}
              onChange={(key) => {
                if (key !== null) apply(withMeasure(config, key));
              }}
            />
            <Select
              label={strings.groupBy}
              isLabelHidden
              size="sm"
              items={groupItems}
              value={config.groupBy === undefined ? 'none' : groupKeyOf(config)}
              onChange={(key) => {
                if (key !== null) apply(withGroup(config, key, attrs));
              }}
            />
            <Select
              label={strings.filter}
              isLabelHidden
              size="sm"
              items={filterItems}
              value={draft.filterChoice}
              onChange={changeFilter}
            />
            <SegmentedControl
              label={strings.chartType}
              size="compact"
              value={config.chart}
              onChange={(chart) => {
                if (chart === 'bar' || chart === 'line' || chart === 'number') apply(withChart(config, chart, attrs));
              }}
              segments={charts.map((chart) => ({
                value: chart,
                label: CHART_WORDS[chart],
                icon: CHART_ICONS[chart],
                isIconOnly: true,
              }))}
            />
            {pendingView !== undefined && (
              <PickedFilter
                key={pendingView}
                slug={slug}
                viewId={pendingView}
                attributes={attrs}
                onRead={readFilter}
                onFailed={failFilter}
              />
            )}
          </Toolbar>
        ),
        body: (
          <PageColumn>
            <Field
              label={strings.name}
              isLabelHidden
              variant="title"
              placeholder={strings.namePlaceholder}
              value={draft.name}
              maxLength={100}
              isReadOnly={!canEdit}
              onChange={(name) => {
                update((now) => ({ ...now, name, isNameChosen: true }));
              }}
            />
            <ReportBody
              key={`${selectedKey}:${draft.objectId}:${planKey}`}
              slug={slug}
              plan={plan}
              config={config}
              name={draft.name.trim() === '' ? (object?.pluralName ?? strings.reports) : draft.name}
              valueLabel={
                measureAttribute === undefined
                  ? (object?.pluralName ?? strings.count)
                  : config.measure.fn === 'avg'
                    ? strings.avgOf(measureAttribute.title)
                    : strings.sumOf(measureAttribute.title)
              }
              groupTitle={groupAttribute?.title}
              isPending={pendingView !== undefined}
              isPipeline={config.measure.fn === 'sum' && groupAttribute?.type === 'status' && config.chart === 'bar'}
              canEdit={canEdit}
              onWeights={(weights) => {
                update((now) => {
                  const { weights: _weights, ...rest } = now.config;
                  return { ...now, config: weights === undefined ? rest : { ...rest, weights } };
                });
              }}
            />
          </PageColumn>
        ),
      }}
    />
  );
}
