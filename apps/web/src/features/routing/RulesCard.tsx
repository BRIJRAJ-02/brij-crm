// Brief
// Purpose: a form's or a team page's routing rules (spec 0043, AC-1601, AC-1604, AC-1608, AC-1612), and how each has done.
// Main task: read the rules in order, add or change one in its dialog, reorder or remove one, and check each rule's report to tune it.
// Leaves out: the fallback itself (a form's After sending, a page's rotation, each set in its own card).
import type { DataLayer, RoutingRule } from '@crm/data';
import { usePageRules, useRoutingReport } from '@crm/data/react';
import {
  Button,
  Callout,
  Card,
  EmptyState,
  InfoTip,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  SegmentedControl,
  SettingsRow,
  SettingsSection,
  SettingsStack,
  Skeleton,
  Table,
  type TableColumn,
} from '@crm/ui';
import { useMemo, useState } from 'react';
import { conditionsLine, hiddenFieldFacts, type Fact } from './facts.ts';
import { RuleDialog, type RuleSurface } from './RuleDialog.tsx';
import { strings } from './strings.ts';

/** The most rules a form or page holds (the server checks it too). */
const RULES_MAX = 20;

/** Which surface the report reads. */
export type ReportSurface =
  { readonly kind: 'form'; readonly formId: string } | { readonly kind: 'booking_page'; readonly pageId: string };

/** Props for RulesCard. */
export interface RulesCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly surface: RuleSurface;
  /**
   * The surface the report is read for; absent before the surface exists (no report yet). On a team page it also
   * names the page whose rules the data layer holds: the card shows those, so a change shows at once and a refusal
   * puts it back.
   */
  readonly report?: ReportSurface;
  /** The rules as the caller has them: a form's draft; on a team page, the first paint until the data layer holds the page. */
  readonly rules: readonly RoutingRule[];
  /** What a condition may read; the visit's hidden fields (UTM tags, page, referrer) come after them on every surface. */
  readonly facts: readonly Fact[];
  /** Names the fact picker: "Question" on a form, "Question or field" on a page. */
  readonly factLabel: string;
  /** The card's one line. */
  readonly description: string;
  readonly isReadOnly: boolean;
  /** Says the rules go live on publish (a form's draft differs from its live version). */
  readonly waitsForPublish?: boolean;
  /** A member's name, for routes that narrow to people. */
  readonly nameOf: (memberId: string) => string;
  /** Why there is nothing a condition could read yet ("Add a question first"). */
  readonly emptyFacts: string;
  /** Keeps the new list: a form's draft at once; a page's saved (rejecting with the refusal's words). */
  readonly onRulesChange: (rules: readonly RoutingRule[]) => Promise<void>;
}

type Editing = { readonly index: number; readonly rule?: RoutingRule } | undefined;

const REPORT_COLUMNS: readonly TableColumn[] = [
  { id: 'rule', label: strings.reportRule, isRowHeader: true },
  { id: 'matched', label: strings.matched, align: 'end' },
  { id: 'booked', label: strings.booked, align: 'end' },
  { id: 'noShow', label: strings.noShow, align: 'end' },
  { id: 'qualified', label: strings.qualified, align: 'end' },
];

/**
 * The rules as rows with a menu each, Add a rule, the dialog, the remove confirm and the report. A team page's
 * rules come from the data layer's copy of the page (`data.routing.pageRules`), never a copy of the card's own.
 */
export function RulesCard(props: RulesCardProps) {
  const { report } = props;
  return report?.kind === 'booking_page' ? (
    <PageRulesCard {...props} pageId={report.pageId} />
  ) : (
    <RulesCardBody {...props} />
  );
}

/** A team page's card: its rules as the data layer holds the page, the caller's until the layer holds it. */
function PageRulesCard({ pageId, ...props }: RulesCardProps & { readonly pageId: string }) {
  const held = usePageRules(props.data.routing.pageRules(props.slug, pageId));
  return <RulesCardBody {...props} rules={held ?? props.rules} />;
}

function RulesCardBody({
  data,
  slug,
  surface,
  report,
  rules,
  facts,
  factLabel,
  description,
  isReadOnly,
  waitsForPublish = false,
  nameOf,
  emptyFacts,
  onRulesChange,
}: RulesCardProps) {
  const [editing, setEditing] = useState<Editing>();
  const [removing, setRemoving] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  // Every rule may also read the visit's hidden fields; on a team page they come from the form that sent the visitor.
  const readable = [...facts, ...hiddenFieldFacts(surface.kind)];
  // So the picker's name says so on a form; a team page's "Question or field" already does.
  const pickerLabel = surface.kind === 'form' ? strings.questionOrHidden : factLabel;

  const pageTitle = (pageId: string) =>
    surface.kind === 'form' ? surface.pages.find((page) => page.id === pageId)?.title : undefined;
  const routeLine = (rule: RoutingRule) => {
    const { then } = rule;
    const tag =
      rule.qualified === undefined ? undefined : rule.qualified ? strings.tagQualified : strings.tagNotQualified;
    const route =
      then.kind === 'book'
        ? strings.toPage(pageTitle(then.bookingPageId) ?? strings.missingPage, (then.hosts ?? []).map(nameOf))
        : then.kind === 'message'
          ? strings.toMessage
          : then.kind === 'redirect'
            ? strings.toRedirect(then.url)
            : strings.toHosts(then.hosts.map(nameOf));
    return strings.routeLine(route, tag);
  };

  const keep = async (next: readonly RoutingRule[]): Promise<boolean> => {
    setBusy(true);
    setFailure(undefined);
    try {
      await onRulesChange(next);
      return true;
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, by: -1 | 1) => {
    const next = [...rules];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(index + by, 0, moved);
    void keep(next);
  };

  return (
    <Card
      title={strings.routing}
      description={waitsForPublish ? `${description} ${strings.waitsForPublish}` : description}
      actions={
        <InfoTip label={strings.routing} example={strings.routingTipExample}>
          {strings.routingTip}
        </InfoTip>
      }
    >
      {/* No lines between the rules: space alone sets them apart, as across the Captures editors. */}
      <SettingsStack variant="plain">
        {failure !== undefined && editing === undefined && removing === undefined && (
          <Callout tone="danger">{failure}</Callout>
        )}
        {rules.map((rule, index) => (
          <SettingsRow
            key={rule.id}
            title={strings.ruleTitle(index, rule.name)}
            description={`${strings.when} ${conditionsLine(rule.when, readable)}. ${routeLine(rule)}.`}
          >
            {!isReadOnly && (
              <MenuTrigger>
                <Button variant="ghost" icon="ellipsis" label={strings.ruleMore(index)} />
                <Menu
                  label={strings.ruleMore(index)}
                  onAction={(key) => {
                    // A change still saving finishes first; the menu stays reachable so focus is never lost.
                    if (busy) return;
                    if (key === 'edit') setEditing({ index, rule });
                    if (key === 'up') move(index, -1);
                    if (key === 'down') move(index, 1);
                    if (key === 'remove') setRemoving(index);
                  }}
                >
                  <MenuItem id="edit" icon="pencil">
                    {strings.edit}
                  </MenuItem>
                  {/* Only the moves there is room for: the first has no Move up, the last no Move down. */}
                  {index > 0 && (
                    <MenuItem id="up" icon="arrow-up">
                      {strings.moveUp}
                    </MenuItem>
                  )}
                  {index < rules.length - 1 && (
                    <MenuItem id="down" icon="arrow-down">
                      {strings.moveDown}
                    </MenuItem>
                  )}
                  <MenuSeparator />
                  <MenuItem id="remove" icon="trash" isDanger>
                    {strings.remove}
                  </MenuItem>
                </Menu>
              </MenuTrigger>
            )}
          </SettingsRow>
        ))}
        {!isReadOnly && (
          <Button
            variant="secondary"
            icon="plus"
            isDisabled={busy || rules.length >= RULES_MAX || facts.length === 0}
            onPress={() => {
              setFailure(undefined);
              setEditing({ index: rules.length });
            }}
          >
            {strings.addRule}
          </Button>
        )}
        {!isReadOnly && (rules.length >= RULES_MAX || facts.length === 0) && (
          <Callout tone="info">{rules.length >= RULES_MAX ? strings.ruleLimit : emptyFacts}</Callout>
        )}
        {report !== undefined && rules.length > 0 && (
          <RuleReport data={data} slug={slug} surface={report} rules={rules} />
        )}
      </SettingsStack>
      <RuleDialog
        isOpen={editing !== undefined}
        {...(editing?.rule === undefined ? {} : { rule: editing.rule })}
        index={editing?.index ?? 0}
        surface={surface}
        facts={readable}
        factLabel={pickerLabel}
        isBusy={busy}
        {...(failure === undefined ? {} : { failure })}
        onClose={() => {
          setEditing(undefined);
          setFailure(undefined);
        }}
        onSave={(saved) => {
          const at = editing?.index ?? rules.length;
          const next =
            editing?.rule === undefined ? [...rules, saved] : rules.map((each, i) => (i === at ? saved : each));
          void keep(next).then((ok) => {
            if (ok) setEditing(undefined);
          });
        }}
      />
      <Modal
        title={strings.removeTitle(strings.ruleTitle(removing ?? 0, rules[removing ?? 0]?.name))}
        tone="danger"
        isOpen={removing !== undefined}
        isBusy={busy}
        onOpenChange={(isOpen) => {
          if (!isOpen && !busy) setRemoving(undefined);
        }}
        actions={
          <>
            <Button slot="close" isDisabled={busy} kbd="ESC">
              {strings.cancel}
            </Button>
            <Button
              variant="danger-solid"
              isPending={busy}
              onPress={() => {
                void keep(rules.filter((_, i) => i !== removing)).then((ok) => {
                  if (ok) setRemoving(undefined);
                });
              }}
            >
              {busy ? strings.saving : strings.removeAction}
            </Button>
          </>
        }
      >
        {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
        {strings.removeText}
      </Modal>
    </Card>
  );
}

/** Props for RuleReport. */
interface RuleReportProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly surface: ReportSurface;
  readonly rules: readonly RoutingRule[];
}

/** Each rule's counts over the last 30 or 90 days (AC-1612), held in the data layer while shown. */
function RuleReport({ data, slug, surface, rules }: RuleReportProps) {
  const [days, setDays] = useState<30 | 90>(30);
  const surfaceId = surface.kind === 'form' ? surface.formId : surface.pageId;
  const view = useMemo(
    () =>
      data.routing.report(
        slug,
        surface.kind === 'form' ? { kind: 'form', formId: surfaceId } : { kind: 'booking_page', pageId: surfaceId },
        days,
      ),
    [data, slug, surface.kind, surfaceId, days],
  );
  const state = useRoutingReport(view);

  const nameOf = (ruleId: string | undefined) => {
    if (ruleId === undefined) return strings.fallback;
    const at = rules.findIndex((rule) => rule.id === ruleId);
    return at === -1 ? strings.removedRule : strings.ruleTitle(at, rules[at]?.name);
  };
  // Rules in their list's order, then a removed rule's, then the fallback.
  const rows =
    state.status === 'ready'
      ? [...state.report.rows].sort((a, b) => {
          const place = (id: string | undefined) => {
            if (id === undefined) return Number.MAX_SAFE_INTEGER;
            const at = rules.findIndex((rule) => rule.id === id);
            return at === -1 ? Number.MAX_SAFE_INTEGER - 1 : at;
          };
          return place(a.ruleId) - place(b.ruleId);
        })
      : [];

  return (
    <SettingsSection title={strings.report}>
      <SegmentedControl
        label={strings.reportWindow}
        segments={[
          { value: '30', label: strings.days(30) },
          { value: '90', label: strings.days(90) },
        ]}
        value={String(days)}
        onChange={(value) => setDays(value === '90' ? 90 : 30)}
      />
      {state.status === 'error' ? (
        <EmptyState tone="error" title={strings.reportFailed} onRetry={view.reload} />
      ) : state.status === 'loading' ? (
        <Skeleton width="long" />
      ) : (
        <Table
          label={strings.report}
          isScrollable
          columns={REPORT_COLUMNS}
          rows={rows}
          getRowId={(row) => row.ruleId ?? 'fallback'}
          emptyState={<EmptyState title={strings.reportEmpty}>{strings.reportEmptyText}</EmptyState>}
          renderCell={(row, column) => {
            switch (column) {
              case 'rule':
                return nameOf(row.ruleId);
              case 'matched':
                return String(row.matched);
              case 'booked':
                return strings.share(row.booked, row.matched);
              case 'noShow':
                return strings.share(row.noShow, row.booked);
              default:
                return strings.share(row.qualified, row.matched);
            }
          }}
        />
      )}
    </SettingsSection>
  );
}
