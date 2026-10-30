import { useRef, useState, type ReactNode } from 'react';
import { Button as AriaButton, DialogTrigger } from 'react-aria-components';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { Popover } from '../../molecules/Popover/Popover.tsx';
import { Table, type TableColumn } from '../../molecules/Table/Table.tsx';
import { strings } from './strings.ts';
import styles from './TeamWeek.module.css';

/** One day's column: its id and its short heading ("Mon 3"). */
export interface TeamWeekDay {
  readonly id: string;
  readonly label: string;
}

/**
 * What a cell's hours are: the week's usual hours, a change for this date only (a dot marks it), a day off, or time
 * off (Away).
 */
export type TeamWeekTone = 'usual' | 'override' | 'off' | 'away';

/** One cell: its lines (each range, or "Off", or "Away" and its reason), its tone, and its whole label. */
export interface TeamWeekCell {
  readonly lines: readonly string[];
  readonly tone: TeamWeekTone;
  /** What a screen reader hears for the cell: "Monday 3 November, Sam Lee: 9:00 AM to 5:00 PM, this week only". */
  readonly label: string;
}

/** One person's row. */
export interface TeamWeekPerson {
  readonly id: string;
  readonly name: string;
  /** A quiet line under the name: their hours this week ("38 h"). */
  readonly meta: string;
  /** A short mark beside the meta line, only when it says something: their zone's offset ("UTC+5:30"). */
  readonly badge?: string;
  /** More under the name: a link to their schedules ("2 pages use other schedules"). */
  readonly extra?: ReactNode;
  /** The row's actions at the end of the person's cell: a MenuTrigger with an options Button. */
  readonly actions?: ReactNode;
  /** One per day, in the days' order. */
  readonly cells: readonly TeamWeekCell[];
  /** Whether the reader may change this person's cells; read only cells are text, never buttons. */
  readonly isEditable: boolean;
}

/** The footer's day: how many work, and their hours ("4 people", "32 h"). */
export interface TeamWeekTotal {
  readonly value: string;
  readonly detail: string;
  readonly label: string;
}

/** Props for TeamWeek. */
export interface TeamWeekProps {
  /** What the grid is ("Team week, 3 to 9 November"). */
  readonly label: string;
  readonly days: readonly TeamWeekDay[];
  readonly people: readonly TeamWeekPerson[];
  /** The person column's heading. */
  readonly personLabel?: string;
  /** The footer row: its heading ("Working") and one total per day. */
  readonly footer?: { readonly label: string; readonly totals: readonly TeamWeekTotal[] };
  /**
   * What an editable cell's Popover holds (an HoursEditor for that day, Off, Usual hours, Save); `close` shuts it
   * and returns focus to the cell. Left out, every cell is read only.
   */
  readonly renderEditor?: (personId: string, dayIndex: number, close: () => void) => ReactNode;
  /** The Popover's name ("Sam Lee, Tuesday 4 November"). */
  readonly editorLabel?: (personId: string, dayIndex: number) => string;
  readonly isLoading?: boolean;
  /** What shows with no people: usually an EmptyState. */
  readonly emptyState?: ReactNode;
}

/** The footer row's id, kept apart from any person's. */
const FOOTER = '__footer';

type Row = { readonly kind: 'person'; readonly person: TeamWeekPerson } | { readonly kind: 'footer' };

/**
 * The roster's week (spec 0037, the Team week): people down the side, the days across, each cell that day's hours,
 * with a footer of totals. Built on Table, so the arrow keys move between cells, Enter opens an editable cell's
 * Popover and Esc closes it back onto the cell.
 */
export function TeamWeek({
  label,
  days,
  people,
  personLabel = strings.person,
  footer,
  renderEditor,
  editorLabel,
  isLoading = false,
  emptyState,
}: TeamWeekProps) {
  const columns: TableColumn[] = [
    { id: 'person', label: personLabel, isRowHeader: true },
    ...days.map((day) => ({ id: day.id, label: day.label, size: 'fit' as const })),
  ];
  const rows: Row[] = [
    ...people.map((person) => ({ kind: 'person' as const, person })),
    ...(footer === undefined || people.length === 0 ? [] : [{ kind: 'footer' as const }]),
  ];
  return (
    <div className={styles.root}>
      <Table
        label={label}
        columns={columns}
        rows={rows}
        isScrollable
        isLoading={isLoading}
        {...(emptyState === undefined ? {} : { emptyState })}
        getRowId={(row) => (row.kind === 'footer' ? FOOTER : row.person.id)}
        renderCell={(row, columnId) => {
          if (row.kind === 'footer') {
            if (columnId === 'person') return <span className={styles.footerLabel}>{footer?.label}</span>;
            const total = footer?.totals[days.findIndex((day) => day.id === columnId)];
            return total === undefined ? null : (
              <span className={styles.total}>
                <VisuallyHidden>{total.label}</VisuallyHidden>
                <span aria-hidden="true" className={styles.totalValue}>
                  {total.value}
                </span>
                {total.detail !== '' && (
                  <span aria-hidden="true" className={styles.totalDetail}>
                    {total.detail}
                  </span>
                )}
              </span>
            );
          }
          const { person } = row;
          if (columnId === 'person') return <PersonCell person={person} />;
          const index = days.findIndex((day) => day.id === columnId);
          const cell = person.cells[index];
          if (cell === undefined) return null;
          return person.isEditable && renderEditor !== undefined ? (
            <EditableCell
              cell={cell}
              editorLabel={editorLabel?.(person.id, index) ?? cell.label}
              renderEditor={(close) => renderEditor(person.id, index, close)}
            />
          ) : (
            <span className={styles.cell} data-tone={cell.tone}>
              <VisuallyHidden>{cell.label}</VisuallyHidden>
              <CellLines cell={cell} />
            </span>
          );
        }}
      />
    </div>
  );
}

/** The person's cell: their picture, name, the week's hours and their zone's offset, more under it, and the menu. */
function PersonCell({ person }: { readonly person: TeamWeekPerson }) {
  return (
    <span className={styles.person}>
      <Avatar name={person.name} id={person.id} size="sm" isDecorative />
      <span className={styles.who}>
        <span className={styles.name}>
          <TruncatedText>{person.name}</TruncatedText>
        </span>
        <span className={styles.meta}>
          {person.meta}
          {person.badge !== undefined && <Badge text={person.badge} size="sm" />}
        </span>
        {person.extra}
      </span>
      {person.actions !== undefined && <span className={styles.actions}>{person.actions}</span>}
    </span>
  );
}

/** A cell's lines as drawn (its label is what is heard). */
function CellLines({ cell }: { readonly cell: TeamWeekCell }) {
  return (
    <span aria-hidden="true" className={styles.lines}>
      {cell.lines.map((line, index) => (
        <span key={`${String(index)}-${line}`} className={styles.line}>
          {line}
        </span>
      ))}
      {cell.tone === 'override' && <span className={styles.dot} />}
    </span>
  );
}

/** An editable cell: a button the size of the cell, opening the editor in a Popover beside it. */
function EditableCell({
  cell,
  editorLabel,
  renderEditor,
}: {
  readonly cell: TeamWeekCell;
  readonly editorLabel: string;
  readonly renderEditor: (close: () => void) => ReactNode;
}) {
  const [isOpen, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setOpen}>
      <AriaButton ref={trigger} className={styles.cell} data-tone={cell.tone} data-editable="" aria-label={cell.label}>
        <CellLines cell={cell} />
      </AriaButton>
      <Popover label={editorLabel} triggerRef={trigger} placement="bottom start">
        {renderEditor(() => setOpen(false))}
      </Popover>
    </DialogTrigger>
  );
}
