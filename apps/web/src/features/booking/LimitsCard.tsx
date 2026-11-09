// Brief
// Purpose: Availability's Limits section (spec 0037, AC-1297 to AC-1299): at most N meetings a day and a week for one person, across every page.
// Main task: pick a limit (No limit, or a number) in each row's Select; the line under it ("4 of 20 this week") says how close they are.
// Leaves out: per page limits (each page's own Limits), rotation caps (the rotation's settings), and any history of changes (Settings › History).
import type { DataLayer, LimitsDraft, MeetingLimits } from '@crm/data';
import { useScheduling } from '@crm/data/react';
import { Card, EmptyState, Select, SettingsRow, Skeleton, type SelectItem } from '@crm/ui';
import { firstName } from './time-off.ts';
import { LIMIT_CHOICES, limitsStrings as strings } from './limits-strings.ts';

/** Props for the section. */
export interface LimitsCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** Whose: undefined is the reader's own; a colleague by id and name. */
  readonly member: { readonly id: string; readonly name: string } | undefined;
}

/** The section: a Card with a settings row per limit, its Select at the row's end. */
export function LimitsCard({ data, slug, member }: LimitsCardProps) {
  const store = data.scheduling.loaded()?.limits;
  return store === undefined ? (
    <LimitsCardPending member={member} />
  ) : (
    <Loaded store={store} slug={slug} member={member} />
  );
}

type LimitsStore = NonNullable<ReturnType<DataLayer['scheduling']['loaded']>>['limits'];

function Loaded({ store, slug, member }: Omit<LimitsCardProps, 'data'> & { readonly store: LimitsStore }) {
  const held = store.held(slug, member?.id);
  const state = useScheduling(held);
  if (state.status === 'loading') return <LimitsCardPending member={member} />;
  const description = member === undefined ? strings.description : strings.descriptionFor(firstName(member.name));
  if (state.status === 'error') {
    return (
      <Card title={strings.title} description={description}>
        <EmptyState layout="row" tone="error" title={strings.failed} onRetry={() => held.reload()}>
          {state.error.message}
        </EmptyState>
      </Card>
    );
  }
  const { limits } = state;
  const readOnlyReason = limits.canChange
    ? undefined
    : member === undefined
      ? strings.setByOthers
      : strings.seeOnly(firstName(member.name));
  const save = (draft: LimitsDraft) => void store.set(slug, member?.id, draft);
  // Read only, the reason joins the description, so each limit's count stays as its hint (AC-1299).
  return (
    <Card
      title={strings.title}
      description={readOnlyReason === undefined ? description : `${description} ${readOnlyReason}`}
    >
      <LimitRow
        kind="day"
        limits={limits}
        readOnlyReason={readOnlyReason}
        onSave={(value) => save({ perDay: value, perWeek: limits.perWeek })}
      />
      <LimitRow
        kind="week"
        limits={limits}
        readOnlyReason={readOnlyReason}
        onSave={(value) => save({ perDay: limits.perDay, perWeek: value })}
      />
    </Card>
  );
}

/** A Select's choice as a limit: `none` is no limit. */
export function limitOf(id: string | null): number | undefined {
  if (id === null || id === NO_LIMIT) return undefined;
  const value = Number(id);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** The Select's id for no limit. */
const NO_LIMIT = 'none';

/**
 * A limit's choices (critic A15: a Switch beside a number box read as two controls for one setting): No limit, then
 * 1 to 10 a day; a week adds the round numbers a week's limit usually takes. A stored number outside them (one set
 * before the Select) stays offered, so the row never reads blank.
 */
export function limitItems(kind: 'day' | 'week', value: number | undefined): readonly SelectItem[] {
  const numbers = new Set<number>(LIMIT_CHOICES[kind]);
  if (value !== undefined) numbers.add(value);
  return [
    { id: NO_LIMIT, label: strings.noLimit },
    ...[...numbers].sort((a, b) => a - b).map((each) => ({ id: String(each), label: String(each) })),
  ];
}

/** One limit as a settings row: its name, how many are booked so far under it, and its Select at the end. */
function LimitRow({
  kind,
  limits,
  readOnlyReason,
  onSave,
}: {
  readonly kind: 'day' | 'week';
  readonly limits: MeetingLimits;
  readonly readOnlyReason: string | undefined;
  readonly onSave: (value: number | undefined) => void;
}) {
  const value = kind === 'day' ? limits.perDay : limits.perWeek;
  const count = kind === 'day' ? limits.today : limits.thisWeek;
  const label = kind === 'day' ? strings.dayField : strings.weekField;
  const description =
    value === undefined
      ? kind === 'day'
        ? strings.dayBooked(count)
        : strings.weekBooked(count)
      : kind === 'day'
        ? strings.dayCount(count, value)
        : strings.weekCount(count, value);
  return (
    <SettingsRow title={label} description={description} control="compact">
      <Select
        label={label}
        isLabelHidden
        size="sm"
        items={limitItems(kind, value)}
        value={value === undefined ? NO_LIMIT : String(value)}
        isReadOnly={readOnlyReason !== undefined}
        onChange={(id) => {
          const next = limitOf(id);
          if (next !== value) onSave(next);
        }}
      />
    </SettingsRow>
  );
}

/** The section while it loads, in its loaded anatomy: both limits' rows, each control a placeholder. */
export function LimitsCardPending({ member }: { readonly member?: { readonly name: string } | undefined } = {}) {
  const row = (label: string) => (
    // The box the row's Select will fill, never a disabled "No limit", which read as the person's real limit.
    <SettingsRow title={label} description={strings.loading} control="compact">
      <Skeleton shape="field" size="sm" />
    </SettingsRow>
  );
  return (
    <Card
      title={strings.title}
      description={member === undefined ? strings.description : strings.descriptionFor(firstName(member.name))}
      isBusy
    >
      {row(strings.dayField)}
      {row(strings.weekField)}
    </Card>
  );
}
