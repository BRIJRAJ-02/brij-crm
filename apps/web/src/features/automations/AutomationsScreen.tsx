// Brief
// Purpose: Settings, Automations: what the workspace does for itself, "when X, if Y, do Z", and a log of what it did.
// Main task: switch an automation on or off, add one from a starter chip, change it as a sentence, and read the last runs.
// Leaves out: branches, delays, email and AI steps, a per-run page, and re-running a run.
import {
  AUTOMATIONS_MAX,
  type AttributeDefinition,
  type Automation,
  type AutomationRun,
  type AutomationsHeld,
  type DataLayer,
  type MemberSummary,
  type ObjectSummary,
} from '@crm/data';
import { useAutomations } from '@crm/data/react';
import {
  Badge,
  Button,
  EmptyState,
  Link,
  Menu,
  MenuItem,
  MenuTrigger,
  RelativeTime,
  SettingsStack,
  Switch,
  Table,
  TabPanel,
  Tabs,
  TruncatedText,
  type TableColumn,
} from '@crm/ui';
import { useEffect, useMemo, useState } from 'react';
import { recordHref } from '../records/details.ts';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { AutomationDialog } from './AutomationDialog.tsx';
import { failureWords, offReason, STARTERS, summaryOf, type Names, type StarterId } from './model.ts';
import { strings } from './strings.ts';

/** Props for the Automations screen: what its route loaded through the data layer. */
export interface AutomationsScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly held: AutomationsHeld;
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberSummary[];
}

const LIST_COLUMNS: readonly TableColumn[] = [
  { id: 'on', label: strings.list.on, isLabelHidden: true, size: 'fit' },
  { id: 'automation', label: strings.list.automation, isRowHeader: true, size: 'fill' },
  { id: 'lastRun', label: strings.list.lastRun, size: 'fit' },
  { id: 'actions', label: strings.list.actions, isLabelHidden: true, align: 'end', size: 'fit' },
];

const RUN_COLUMNS: readonly TableColumn[] = [
  { id: 'when', label: strings.runs.columns.when, size: 'fit' },
  { id: 'automation', label: strings.runs.columns.automation, isRowHeader: true, size: 'fill' },
  { id: 'record', label: strings.runs.columns.record, size: 'fit' },
  { id: 'result', label: strings.runs.columns.result, isInline: true, size: 'fit' },
];

/** The dialog that is open: a new automation (from a starter, or blank), or one being changed. */
type Open = { readonly kind: 'new'; readonly starter?: StarterId } | { readonly kind: 'edit'; readonly id: string };

/** The screen. */
export function AutomationsScreen({ data, slug, held, objects, members }: AutomationsScreenProps) {
  const state = useAutomations(held);
  const [tab, setTab] = useState<'automations' | 'runs'>('automations');
  const [open, setOpen] = useState<Open | undefined>(undefined);
  const [fields, setFields] = useState<ReadonlyMap<string, readonly AttributeDefinition[]>>(new Map());
  const ready = state.status === 'ready' ? state : undefined;

  // The fields of every object an automation names, so its row can say "Stage" and "Won".
  const wanted = useMemo(
    () => [
      ...new Set(
        (ready?.automations ?? []).flatMap((each) => (each.trigger.kind === 'task_due' ? [] : [each.trigger.objectId])),
      ),
    ],
    [ready?.automations],
  );
  useEffect(() => {
    let isCurrent = true;
    for (const objectId of wanted) {
      void data.attributes.list(slug, objectId).then((list) => {
        if (isCurrent) setFields((now) => (now.get(objectId) === list ? now : new Map(now).set(objectId, list)));
      });
    }
    return () => {
      isCurrent = false;
    };
  }, [data, slug, wanted]);

  const names: Names = useMemo(
    () => ({ objects, members, attributesOf: (objectId) => fields.get(objectId) }),
    [objects, members, fields],
  );
  const isFull = ready !== undefined && ready.automations.length >= AUTOMATIONS_MAX;
  const nameOfMember = (id: string) => members.find((member) => member.id === id)?.name ?? strings.formerMember;
  const editing = open?.kind === 'edit' ? ready?.automations.find((each) => each.id === open.id) : undefined;

  const newButton = (
    <Button
      variant="primary"
      icon="plus"
      isDisabled={isFull || objects.length === 0}
      onPress={() => setOpen({ kind: 'new' })}
    >
      {strings.newAutomation}
    </Button>
  );

  const body = (() => {
    if (state.status === 'loading') return <EmptyState title={strings.loadingLabel} isLoading />;
    if (state.status === 'error') {
      return (
        <EmptyState tone="error" title={strings.failedTitle} onRetry={() => held.reload()}>
          {state.error.message}
        </EmptyState>
      );
    }
    if (tab === 'runs')
      return <RunsTable runs={state.runs} automations={state.automations} names={names} slug={slug} />;
    if (state.automations.length === 0) {
      return (
        <EmptyState
          icon="zap"
          title={strings.empty.title}
          actions={STARTERS.map((id) => (
            <Button key={id} onPress={() => setOpen({ kind: 'new', starter: id })}>
              {strings.starters[id]}
            </Button>
          ))}
        >
          {strings.empty.text}
        </EmptyState>
      );
    }
    return (
      <Table
        label={strings.list.label}
        columns={LIST_COLUMNS}
        rows={state.automations}
        getRowId={(each) => each.id}
        onRowAction={(id) => setOpen({ kind: 'edit', id })}
        renderCell={(each, column) => {
          const summary = summaryOf(each, names);
          switch (column) {
            case 'on':
              return (
                <Switch
                  label={strings.list.switchLabel(summary)}
                  isLabelHidden
                  isSelected={each.enabled}
                  onChange={(on) => void held.setEnabled(each.id, on)}
                />
              );
            case 'automation':
              return (
                <>
                  <TruncatedText>{summary}</TruncatedText>
                  {offReason(each) !== undefined && <Badge text={offReason(each) ?? ''} />}
                  {each.enabled && <Badge text={strings.list.runAs(nameOfMember(each.runAsMemberId))} />}
                </>
              );
            case 'lastRun':
              return each.lastRunAt === undefined ? strings.list.never : <RelativeTime value={each.lastRunAt} />;
            default:
              return (
                <MenuTrigger>
                  <Button variant="ghost" icon="ellipsis" label={strings.list.rowActions} />
                  <Menu
                    label={strings.list.rowActions}
                    onAction={(key) => {
                      if (key === 'edit') setOpen({ kind: 'edit', id: each.id });
                      if (key === 'delete') void held.remove(each.id);
                    }}
                  >
                    <MenuItem id="edit" icon="pencil">
                      {strings.list.edit}
                    </MenuItem>
                    <MenuItem id="delete" icon="trash" isDanger>
                      {strings.list.delete}
                    </MenuItem>
                  </Menu>
                </MenuTrigger>
              );
          }
        }}
      />
    );
  })();

  return (
    <SettingsPage title={strings.title} actions={newButton} hasTabs>
      <Tabs
        label={strings.tabs.label}
        selectedKey={tab}
        onSelectionChange={(next) => {
          if (next === 'automations' || next === 'runs') setTab(next);
        }}
        tabs={[
          { id: 'automations', label: strings.tabs.automations, count: ready?.automations.length ?? 0 },
          { id: 'runs', label: strings.tabs.runs },
        ]}
      >
        <TabPanel id="automations">{tab === 'automations' && <SettingsStack>{body}</SettingsStack>}</TabPanel>
        <TabPanel id="runs">{tab === 'runs' && <SettingsStack>{body}</SettingsStack>}</TabPanel>
      </Tabs>
      {open !== undefined && (open.kind === 'new' || editing !== undefined) && (
        <AutomationDialog
          data={data}
          slug={slug}
          held={held}
          objects={objects}
          members={members}
          automation={editing}
          starter={open.kind === 'new' ? open.starter : undefined}
          onClose={() => setOpen(undefined)}
        />
      )}
    </SettingsPage>
  );
}

/** The last runs: when, which automation, for what (a link to the record), and how it ended. */
function RunsTable({
  runs,
  automations,
  names,
  slug,
}: {
  readonly runs: readonly AutomationRun[];
  readonly automations: readonly Automation[];
  readonly names: Names;
  readonly slug: string;
}) {
  if (runs.length === 0) {
    return <EmptyState icon="zap" title={strings.runs.empty.title} />;
  }
  return (
    <Table
      label={strings.runs.label}
      columns={RUN_COLUMNS}
      rows={runs}
      getRowId={(run) => run.id}
      renderCell={(run, column) => {
        const automation = automations.find((each) => each.id === run.automationId);
        const object = names.objects.find((each) => each.id === run.objectId);
        switch (column) {
          case 'when':
            return <RelativeTime value={run.at} />;
          case 'automation':
            return (
              <TruncatedText>
                {automation === undefined ? strings.runs.unknownAutomation : summaryOf(automation, names)}
              </TruncatedText>
            );
          case 'record':
            if (run.subjectKind === 'task') return strings.runs.task;
            return object === undefined ? (
              strings.runs.recordGone
            ) : (
              <Link href={recordHref(slug, object.apiSlug, run.subjectId)}>{object.singularName}</Link>
            );
          default:
            return (
              <>
                <Badge text={strings.runs.status[run.status]} />
                {run.status === 'failed' && <TruncatedText>{failureWords(run.code)}</TruncatedText>}
              </>
            );
        }
      }}
    />
  );
}

/** The page's own title and frame while its route loads, so nothing moves when it arrives. */
export function AutomationsPending() {
  return (
    <SettingsPage title={strings.title} isLoading>
      {null}
    </SettingsPage>
  );
}
