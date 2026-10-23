// Brief
// Purpose: a rotation's Distribution tab (spec 0037, AC-1329, AC-1330): who got how many meetings in its window against their fair share by weight, how, and the last 12 weeks.
// Main task: see whether the share is fair, and (admins) adjust a member's count with a note, or undo an adjustment.
// Leaves out: changing weights and caps (Edit rotation), reassigning a booking (Bookings), and chart axes (the weeks are a
// small bar chart per member on one shared scale, with a table of the same numbers a switch away).
import { isDataError, type DataLayer, type RotationDistribution, type RotationView } from '@crm/data';
import {
  Badge,
  BarStrip,
  Button,
  Callout,
  EmptyState,
  Field,
  Modal,
  RecordChip,
  RelativeTime,
  SectionBar,
  SegmentedControl,
  Select,
  SettingsStack,
  Skeleton,
  Table,
  type TableColumn,
} from '@crm/ui';
import { useEffect, useState } from 'react';
import { strings } from './rotation-strings.ts';

/** Props for the panel. */
export interface DistributionPanelProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly rotation: RotationView;
  /** Says an adjustment landed. */
  readonly onNotice: (message: string) => void;
}

type Row = RotationDistribution['rows'][number];
type Adjustment = RotationDistribution['adjustments'][number];

const SHARE_COLUMNS: readonly TableColumn[] = [
  { id: 'member', label: strings.columns.member, isRowHeader: true },
  { id: 'count', label: strings.distribution.count, align: 'end' },
  { id: 'fair', label: strings.distribution.fair, align: 'end' },
  { id: 'difference', label: strings.distribution.difference, align: 'end' },
  { id: 'adjusted', label: strings.distribution.adjusted, align: 'end' },
  { id: 'how', label: strings.distribution.how },
];

/** A member's own view: their count and how, without the share, which comes from everyone's total. */
const OWN_COLUMNS: readonly TableColumn[] = SHARE_COLUMNS.filter(
  (column) => column.id !== 'fair' && column.id !== 'difference',
);

const ADJUSTMENT_COLUMNS: readonly TableColumn[] = [
  { id: 'member', label: strings.columns.member, isRowHeader: true },
  { id: 'units', label: strings.distribution.change, align: 'end' },
  { id: 'note', label: strings.distribution.note },
  { id: 'by', label: strings.distribution.by },
  { id: 'at', label: strings.distribution.when },
  { id: 'undo', label: strings.distribution.undo, isLabelHidden: true, align: 'end' },
];

/** A number with one decimal at most, signed when asked. */
function numberText(value: number, signed = false): string {
  const text = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(Math.abs(value));
  if (!signed || value === 0) return value < 0 ? `-${text}` : text;
  return value > 0 ? `+${text}` : `-${text}`;
}

/** The panel: reads the distribution when it mounts (the tab opening) and again after each change. */
export function DistributionPanel({ data, slug, rotation, onNotice }: DistributionPanelProps) {
  const [read, setRead] = useState<
    | { readonly status: 'loading' }
    | { readonly status: 'ready'; readonly value: RotationDistribution }
    | {
        readonly status: 'error';
        readonly message: string;
      }
  >({ status: 'loading' });
  const [version, setVersion] = useState(0);
  const [isAdjusting, setAdjusting] = useState(false);
  const [undoing, setUndoing] = useState<string | undefined>(undefined);
  const [weeksAs, setWeeksAs] = useState<'chart' | 'table'>('chart');
  useEffect(() => {
    let isCurrent = true;
    data.rotations.distribution(slug, rotation.id).then(
      (value) => {
        if (isCurrent) setRead({ status: 'ready', value });
      },
      (error: unknown) => {
        if (isCurrent) setRead({ status: 'error', message: isDataError(error) ? error.message : strings.failedText });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, rotation.id, version]);

  if (read.status === 'loading') return <Skeleton lines={4} />;
  if (read.status === 'error') {
    return (
      <EmptyState tone="error" title={strings.distribution.failed} onRetry={() => setVersion((at) => at + 1)}>
        {read.message}
      </EmptyState>
    );
  }
  const { value } = read;
  const weekLabel = (start: string) =>
    new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(start));
  const weekColumns: readonly TableColumn[] = [
    { id: 'member', label: strings.columns.member, isRowHeader: true },
    ...value.weekStarts.map((start) => ({ id: start, label: weekLabel(start), align: 'end' as const })),
  ];
  const firstWeek = value.weekStarts[0];
  const lastWeek = value.weekStarts.at(-1);
  const chartColumns: readonly TableColumn[] = [
    { id: 'member', label: strings.columns.member, isRowHeader: true },
    {
      id: 'weeks',
      label:
        firstWeek === undefined || lastWeek === undefined
          ? strings.distribution.weeksTitle
          : strings.distribution.weeksRange(weekLabel(firstWeek), weekLabel(lastWeek)),
    },
    { id: 'total', label: strings.distribution.total, align: 'end' },
  ];
  // One scale for every member's strip, so a quieter member's bars stay short beside a busier one's.
  const weekMax = Math.max(0, ...value.rows.flatMap((row) => row.weeks));
  const weekCell = (row: Row, column: string) => {
    if (column === 'member') return chip(row);
    if (column === 'weeks') {
      return (
        <BarStrip
          label={strings.distribution.memberWeeks(row.name)}
          max={weekMax}
          bars={value.weekStarts.map((start, index) => {
            const count = row.weeks[index] ?? 0;
            return { id: start, label: strings.distribution.weekBar(weekLabel(start), count), value: count };
          })}
        />
      );
    }
    if (column === 'total') return numberText(row.weeks.reduce((sum, count) => sum + count, 0));
    const index = value.weekStarts.indexOf(column);
    return String(row.weeks[index] ?? 0);
  };
  const chip = (row: { readonly memberId: string; readonly name: string }) => (
    <RecordChip display={{ type: 'member', id: row.memberId, name: row.name }} isFlat />
  );
  const shareCell = (row: Row, column: string) => {
    switch (column) {
      case 'member':
        return chip(row);
      case 'count':
        return numberText(row.count);
      case 'fair':
        if (!row.isOn) return strings.distribution.off;
        return row.fairShare === undefined ? '' : numberText(row.fairShare);
      case 'difference':
        return row.isOn && row.difference !== undefined ? numberText(row.difference, true) : '';
      case 'adjusted':
        return row.adjusted === 0 ? '' : numberText(row.adjusted, true);
      default:
        return strings.distribution.howLine(row.reasons);
    }
  };
  const undo = (adjustment: Adjustment) => {
    setUndoing(adjustment.id);
    data.rotations.undoAdjustment(slug, rotation.id, adjustment.id).then(
      () => {
        setUndoing(undefined);
        onNotice(strings.distribution.undone(adjustment.memberName));
        setVersion((at) => at + 1);
      },
      () => {
        setUndoing(undefined);
        onNotice(strings.somethingWrong);
      },
    );
  };
  const adjustmentCell = (row: Adjustment, column: string) => {
    switch (column) {
      case 'member':
        return chip({ memberId: row.memberId, name: row.memberName });
      case 'units':
        return numberText(row.units, true);
      case 'note':
        return row.note;
      case 'by':
        return row.byName;
      case 'at':
        return <RelativeTime value={row.at} />;
      default:
        if (row.voidedAt !== undefined) return <Badge text={strings.distribution.undoneBadge} />;
        return value.canAdjust ? (
          <Button
            variant="ghost"
            size="sm"
            isPending={undoing === row.id}
            isDisabled={undoing !== undefined && undoing !== row.id}
            onPress={() => {
              undo(row);
            }}
          >
            {strings.distribution.undo}
          </Button>
        ) : null;
    }
  };
  return (
    <SettingsStack>
      {/* What the numbers are, said once as the section's line rather than a note over the tab each time (SS-R9). */}
      <SectionBar
        title={strings.distribution.shareTitle(value.windowDays)}
        description={strings.distribution.intro(value.windowDays)}
        end={
          value.canAdjust ? (
            <Button
              icon="sliders-horizontal"
              onPress={() => {
                setAdjusting(true);
              }}
            >
              {strings.distribution.adjust}
            </Button>
          ) : undefined
        }
      />
      <Table
        label={strings.distribution.shareLabel(rotation.name)}
        columns={value.canAdjust ? SHARE_COLUMNS : OWN_COLUMNS}
        rows={value.rows}
        getRowId={(row) => row.memberId}
        renderCell={shareCell}
        isScrollable
      />
      <SectionBar
        title={strings.distribution.weeksTitle}
        end={
          <SegmentedControl
            label={strings.distribution.weeksShow}
            size="compact"
            value={weeksAs}
            onChange={(next) => {
              setWeeksAs(next === 'table' ? 'table' : 'chart');
            }}
            segments={[
              { value: 'chart', label: strings.distribution.weeksChart, icon: 'chart-bar' },
              { value: 'table', label: strings.distribution.weeksTable, icon: 'table' },
            ]}
          />
        }
      />
      <Table
        label={strings.distribution.weeksLabel(rotation.name)}
        columns={weeksAs === 'chart' ? chartColumns : weekColumns}
        rows={value.rows}
        getRowId={(row) => row.memberId}
        renderCell={weekCell}
        isScrollable
      />
      {value.adjustments.length > 0 && (
        <>
          <SectionBar title={strings.distribution.adjustmentsTitle} />
          <Table
            label={strings.distribution.adjustmentsLabel(rotation.name)}
            columns={ADJUSTMENT_COLUMNS}
            rows={value.adjustments}
            getRowId={(row) => row.id}
            renderCell={adjustmentCell}
            isScrollable
          />
        </>
      )}
      {isAdjusting && (
        <AdjustDialog
          data={data}
          slug={slug}
          rotation={rotation}
          onClose={() => {
            setAdjusting(false);
          }}
          onDone={(name) => {
            setAdjusting(false);
            onNotice(strings.distribution.adjustedNotice(name));
            setVersion((at) => at + 1);
          }}
        />
      )}
    </SettingsStack>
  );
}

/** A whole number from -20 to 20, never 0, or undefined. */
function unitsOf(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^[+-]?\d{1,2}$/u.test(trimmed)) return undefined;
  const units = Number(trimmed);
  return units === 0 || Math.abs(units) > 20 ? undefined : units;
}

/** Adjust a member's count with a note (AC-1329). */
function AdjustDialog({
  data,
  slug,
  rotation,
  onClose,
  onDone,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly rotation: RotationView;
  readonly onClose: () => void;
  readonly onDone: (name: string) => void;
}) {
  const [memberId, setMemberId] = useState<string | null>(rotation.members[0]?.memberId ?? null);
  const [units, setUnits] = useState('');
  const [note, setNote] = useState('');
  const [hasTried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const parsed = unitsOf(units);
  const save = () => {
    setTried(true);
    if (memberId === null || parsed === undefined || note.trim() === '' || busy) return;
    setBusy(true);
    setError(undefined);
    data.rotations.adjust(slug, rotation.id, { memberId, units: parsed, note: note.trim() }).then(
      (made) => {
        setBusy(false);
        onDone(made.memberName);
      },
      (failure: unknown) => {
        setBusy(false);
        setError(isDataError(failure) ? failure.message : strings.somethingWrong);
      },
    );
  };
  return (
    <Modal
      title={strings.distribution.adjustTitle(rotation.name)}
      isOpen
      isBusy={busy}
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={busy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={busy} onPress={save}>
            {busy ? strings.saving : strings.distribution.adjust}
          </Button>
        </>
      }
    >
      <SettingsStack>
        {error !== undefined && (
          <Callout tone="danger" isAnnounced>
            {error}
          </Callout>
        )}
        <Select
          label={strings.columns.member}
          items={rotation.members.map((member) => ({ id: member.memberId, label: member.name }))}
          value={memberId}
          onChange={setMemberId}
        />
        <Field
          label={strings.distribution.by20}
          hint={strings.distribution.by20Hint}
          inputMode="numeric"
          maxLength={3}
          value={units}
          onChange={setUnits}
          {...(hasTried && parsed === undefined ? { error: strings.distribution.unitsInvalid } : {})}
        />
        <Field
          label={strings.distribution.note}
          isMultiline
          maxLength={200}
          value={note}
          onChange={setNote}
          {...(hasTried && note.trim() === '' ? { error: strings.distribution.noteRequired } : {})}
        />
      </SettingsStack>
    </Modal>
  );
}
