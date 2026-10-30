// Brief
// Purpose: Availability's Limits section (spec 0037, AC-1297 to AC-1299): at most N meetings a day and a week for one person, across every page.
// Main task: turn a limit on and set its number; the count beside it ("4 of 20 this week") says how close they are.
// Leaves out: per page limits (each page's own Limits), rotation caps (the rotation's settings), and any history of changes (Settings › History).
import type { DataLayer, LimitsDraft, MeetingLimits } from '@crm/data';
import { useScheduling } from '@crm/data/react';
import { Card, EmptyState, Field, Switch } from '@crm/ui';
import { useState } from 'react';
import { firstName } from './time-off.ts';
import { LIMIT_RANGES, LIMIT_STARTS, limitsStrings as strings } from './limits-strings.ts';

/** Props for the section. */
export interface LimitsCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** Whose: undefined is the reader's own; a colleague by id and name. */
  readonly member: { readonly id: string; readonly name: string } | undefined;
}

/** The section: a Card with a Switch per limit, and its number once it is on. */
export function LimitsCard({ data, slug, member }: LimitsCardProps) {
  const store = data.scheduling.loaded()?.limits;
  return store === undefined ? <LimitsCardPending /> : <Loaded store={store} slug={slug} member={member} />;
}

type LimitsStore = NonNullable<ReturnType<DataLayer['scheduling']['loaded']>>['limits'];

function Loaded({ store, slug, member }: Omit<LimitsCardProps, 'data'> & { readonly store: LimitsStore }) {
  const held = store.held(slug, member?.id);
  const state = useScheduling(held);
  if (state.status === 'loading') return <LimitsCardPending />;
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

/** A typed limit as a number in its range, or undefined when it isn't one. */
export function parseLimit(text: string, kind: 'day' | 'week'): number | undefined {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  const range = LIMIT_RANGES[kind];
  return value >= range.min && value <= range.max ? value : undefined;
}

/**
 * One limit: its Switch (on saves the last number, or a starting one; off clears it), and once on its number,
 * saved on Enter or when focus leaves, with the count as its hint.
 */
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
  // What the field holds while typed in; undefined shows the saved number.
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  // The number it had, so turning it off and on again brings it back.
  const [last, setLast] = useState<number>(value ?? LIMIT_STARTS[kind]);
  if (value !== undefined && value !== last) setLast(value);
  const isReadOnly = readOnlyReason !== undefined;
  const isOn = value !== undefined;
  const commit = () => {
    if (draft === undefined) return;
    const parsed = parseLimit(draft, kind);
    if (parsed === undefined) {
      setError(kind === 'day' ? strings.dayRange : strings.weekRange);
      return;
    }
    setDraft(undefined);
    setError(undefined);
    if (parsed !== value) onSave(parsed);
  };
  return (
    <>
      <Switch
        label={kind === 'day' ? strings.daySwitch : strings.weekSwitch}
        {...(isOn ? {} : { description: kind === 'day' ? strings.dayBooked(count) : strings.weekBooked(count) })}
        isSelected={isOn}
        isReadOnly={isReadOnly}
        onChange={(on) => {
          setDraft(undefined);
          setError(undefined);
          onSave(on ? last : undefined);
        }}
      />
      {value !== undefined && (
        <Field
          label={kind === 'day' ? strings.dayField : strings.weekField}
          value={draft ?? String(value)}
          inputMode="numeric"
          autoComplete="off"
          size="sm"
          hint={kind === 'day' ? strings.dayCount(count, value) : strings.weekCount(count, value)}
          {...(error === undefined ? {} : { error })}
          isReadOnly={isReadOnly}
          onChange={(text) => {
            setDraft(text);
            if (error !== undefined) setError(undefined);
          }}
          onSubmit={commit}
          onBlur={commit}
          onEscape={() => {
            setDraft(undefined);
            setError(undefined);
          }}
        />
      )}
    </>
  );
}

/** The section while it loads, in its loaded anatomy: both Switches' places. */
export function LimitsCardPending() {
  return (
    <Card title={strings.title} description={strings.description} isBusy>
      <EmptyState layout="row" isLoading title={strings.loading} />
    </Card>
  );
}
