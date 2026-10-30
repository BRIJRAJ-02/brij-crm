// The import's Review values step (owner walk 30 Oct 2026, after Attio's):
// shown only when a value won't read as it is. Each select label that names
// no option, and each column's unreadable cells, already has a choice made,
// so one Continue is enough; changing one is a Select or a tick away.
import type { AttributeDefinition } from '@crm/data';
import {
  Button,
  Callout,
  Card,
  Checkbox,
  ProgressBar,
  Select,
  Table,
  type SelectItem,
  type TableColumn,
} from '@crm/ui';
import type { CellGroup, LabelChoice } from './review.ts';
import { strings } from './strings.ts';

/** A select or status column's labels that name no option. */
export interface LabelNote {
  readonly column: number;
  readonly attribute: AttributeDefinition;
  readonly labels: readonly string[];
  /** Whether Create option is offered: the member may add options, and they fit under the limit. */
  readonly canCreate: boolean;
}

/** Props for Review values. */
export interface ReviewStepProps {
  readonly headers: readonly string[];
  readonly labelNotes: readonly LabelNote[];
  readonly choiceOf: (column: number, label: string) => LabelChoice;
  readonly onLabelChoice: (column: number, label: string, choice: LabelChoice) => void;
  readonly groups: readonly CellGroup[];
  /** Whether a column's unreadable cells are left empty (the default), so their rows import without them. */
  readonly isEmptied: (column: number) => boolean;
  readonly onEmptied: (column: number, isEmptied: boolean) => void;
  /** Continue's work under way: options being made, then the rows read again. */
  readonly progress: { readonly label: string; readonly value?: number; readonly max?: number } | undefined;
  readonly error: string | undefined;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

const LABEL_COLUMNS: readonly TableColumn[] = [
  { id: 'label', label: strings.columns.header, isRowHeader: true },
  { id: 'choice', label: strings.columns.target },
];

/** A choice as its Select item id. */
const choiceId = (choice: LabelChoice): string => (choice.kind === 'map' ? `map:${choice.optionId}` : choice.kind);

/** Review values: label choices per select column, then each column's unreadable cells. */
export function ReviewStep({
  headers,
  labelNotes,
  choiceOf,
  onLabelChoice,
  groups,
  isEmptied,
  onEmptied,
  progress,
  error,
  onBack,
  onContinue,
}: ReviewStepProps) {
  const isBusy = progress !== undefined;
  return (
    <Card
      title={strings.steps.review}
      footer={
        <>
          <Button isDisabled={isBusy} onPress={onBack}>
            {strings.back}
          </Button>
          <Button variant="primary" isPending={isBusy} onPress={onContinue}>
            {strings.continue}
          </Button>
        </>
      }
    >
      {error !== undefined && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
      {progress !== undefined &&
        (progress.value === undefined ? (
          <ProgressBar label={progress.label} isIndeterminate />
        ) : (
          <ProgressBar label={progress.label} value={progress.value} maxValue={Math.max(progress.max ?? 1, 1)} />
        ))}
      {labelNotes.map((note) => {
        const items: readonly SelectItem[] = [
          ...(note.canCreate ? [{ id: 'create', label: strings.review.create }] : []),
          { id: 'empty', label: strings.review.empty },
          ...(note.attribute.options ?? [])
            .filter((option) => !option.isArchived)
            .map((option) => ({ id: `map:${option.id}`, label: strings.review.mapTo(option.label) })),
        ];
        const rows = note.labels.map((label) => ({ id: `label-${String(note.column)}-${label}`, label }));
        return (
          <Callout
            key={`labels-${String(note.column)}`}
            tone="info"
            title={strings.review.missingLabels(note.labels.length, note.attribute.title)}
          >
            {!note.canCreate && strings.review.cantCreate}
            <Table
              label={strings.review.missingLabels(note.labels.length, note.attribute.title)}
              columns={LABEL_COLUMNS}
              rows={rows}
              getRowId={(row) => row.id}
              renderCell={(row, columnId) =>
                columnId === 'label' ? (
                  row.label
                ) : (
                  <Select
                    label={strings.review.labelChoice(row.label)}
                    isLabelHidden
                    size="sm"
                    items={items}
                    value={choiceId(choiceOf(note.column, row.label))}
                    isDisabled={isBusy}
                    onChange={(id) => {
                      if (id === 'create' || id === 'empty') onLabelChoice(note.column, row.label, { kind: id });
                      else if (id?.startsWith('map:') === true) {
                        onLabelChoice(note.column, row.label, { kind: 'map', optionId: id.slice('map:'.length) });
                      }
                    }}
                  />
                )
              }
            />
          </Callout>
        );
      })}
      {groups.map((group) => (
        <Callout
          key={`cells-${String(group.column)}`}
          tone="warning"
          title={strings.review.cells(group.count, headers[group.column] ?? group.header)}
          actions={
            <Checkbox
              label={strings.review.leaveEmpty(group.count)}
              isSelected={isEmptied(group.column)}
              isDisabled={isBusy}
              onChange={(isSelected) => onEmptied(group.column, isSelected)}
            />
          }
        >
          {strings.review.cellsText(group.samples, group.reason)}
        </Callout>
      ))}
    </Card>
  );
}
