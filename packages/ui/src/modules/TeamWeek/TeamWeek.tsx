import { useRef, useState, type ReactNode } from 'react';
import { Button as AriaButton, DialogTrigger } from 'react-aria-components';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { Popover } from '../../molecules/Popover/Popover.tsx';
import { Table, type TableColumn } from '../../molecules/Table/Table.tsx';
import { strings } from './strings.ts';
import styles from './TeamWeek.module.css';

/**
 * One day's column: its id, its whole short heading ("Mon 3"), and optionally its two parts, so the header draws the
 * weekday beside its date ("Mon" "3", today's date in an accent circle, as WeekCalendar marks it).
 */
export interface TeamWeekDay {
  readonly id: string;
  readonly label: string;
  /** The weekday alone ("Mon"); with `date`, the header draws the two apart. */
  readonly weekday?: string;
  /** The date alone ("3"). */
  readonly date?: string;
  /** Today: its header in the link colour over an accent line, its date in an accent circle. */
  readonly isToday?: boolean;
  /** A day few work (the weekend): the whole column a step off the page. */
  readonly isQuiet?: boolean;
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
  /** More on that line, after a middle dot, only when it says something: their zone's offset ("UTC+5:30"). */
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

/**
 * The footer's day: how many work, and their hours ("4 people", "32 h"), and optionally one more quiet line under them
 * (the workspace link's coverage, "Link: 3"). `label` is what a screen reader hears for all of it.
 */
export interface TeamWeekTotal {
  readonly value: string;
  readonly detail: string;
  readonly extra?: string;
  readonly label: string;
}

/** One key of the legend under the grid: a tone's swatch and what it means ("Changed for this date"). */
export interface TeamWeekLegendItem {
  readonly tone: TeamWeekTone;
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
   * The quiet line under the grid: a swatch per tone and what it means, then one hint ("Select a day to change that
   * date only"). It shows only with people.
   */
  readonly legend?: { readonly items: readonly TeamWeekLegendItem[]; readonly hint?: string };
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

/** Which sides of an Away cell run on into the next day's, so a run of days off reads as one band. */
type Join = 'before' | 'after' | 'both';

function joinOf(cells: readonly TeamWeekCell[], index: number): Join | undefined {
  if (cells[index]?.tone !== 'away') return undefined;
  const before = cells[index - 1]?.tone === 'away';
  const after = cells[index + 1]?.tone === 'away';
  return before && after ? 'both' : before ? 'before' : after ? 'after' : undefined;
}

/**
 * The roster's week (spec 0037, the Team week): people down the side, the days across as equals, each cell that day's
 * hours as a calm block, with a footer of totals and a legend under it. Built on Table (its `even` layout), so the
 * arrow keys move between cells, Enter opens an editable cell's Popover and Esc closes it back onto the cell.
 */
export function TeamWeek({
  label,
  days,
  people,
  personLabel = strings.person,
  footer,
  legend,
  renderEditor,
  editorLabel,
  isLoading = false,
  emptyState,
}: TeamWeekProps) {
  const columns: TableColumn[] = [
    { id: 'person', label: personLabel, isRowHeader: true },
    ...days.map((day) => ({
      id: day.id,
      label: day.isToday === true ? strings.today(day.label) : day.label,
      ...(day.weekday === undefined || day.date === undefined
        ? {}
        : {
            heading: <DayHeading day={day} spoken={day.isToday === true ? strings.today(day.label) : day.label} />,
          }),
      ...(day.isToday === true ? { isCurrent: true } : {}),
      ...(day.isQuiet === true ? { tone: 'quiet' as const } : {}),
    })),
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
        layout="even"
        isScrollable
        isLoading={isLoading}
        {...(emptyState === undefined ? {} : { emptyState })}
        getRowId={(row) => (row.kind === 'footer' ? FOOTER : row.person.id)}
        getRowTone={(row) => (row.kind === 'footer' ? 'total' : undefined)}
        renderCell={(row, columnId) => {
          if (row.kind === 'footer') {
            if (columnId === 'person') return <span className={styles.footerLabel}>{footer?.label}</span>;
            const total = footer?.totals[days.findIndex((day) => day.id === columnId)];
            return total === undefined ? null : <Total total={total} />;
          }
          const { person } = row;
          if (columnId === 'person') return <PersonCell person={person} />;
          const index = days.findIndex((day) => day.id === columnId);
          const cell = person.cells[index];
          if (cell === undefined) return null;
          const join = joinOf(person.cells, index);
          return (
            <span className={styles.day}>
              {person.isEditable && renderEditor !== undefined ? (
                <EditableCell
                  cell={cell}
                  join={join}
                  editorLabel={editorLabel?.(person.id, index) ?? cell.label}
                  renderEditor={(close) => renderEditor(person.id, index, close)}
                />
              ) : (
                <span className={styles.cell} data-tone={cell.tone} data-join={join}>
                  <VisuallyHidden>{cell.label}</VisuallyHidden>
                  <CellLines cell={cell} join={join} />
                </span>
              )}
            </span>
          );
        }}
      />
      {legend !== undefined && people.length > 0 && !isLoading && (
        <div className={styles.legend}>
          <ul className={styles.keys} aria-label={strings.legend}>
            {legend.items.map((item) => (
              <li key={item.tone} className={styles.key}>
                <span aria-hidden="true" className={styles.swatch} data-tone={item.tone} />
                {item.label}
              </li>
            ))}
          </ul>
          {legend.hint !== undefined && <p className={styles.hint}>{legend.hint}</p>}
        </div>
      )}
    </div>
  );
}

/** A day's header: its weekday beside its date, today's date in an accent circle; what is heard is `spoken`. */
function DayHeading({ day, spoken }: { readonly day: TeamWeekDay; readonly spoken: string }) {
  return (
    <>
      <VisuallyHidden>{spoken}</VisuallyHidden>
      <span aria-hidden="true" className={styles.heading} data-today={day.isToday === true || undefined}>
        <span className={styles.weekday}>{day.weekday}</span>
        <span className={styles.date}>{day.date}</span>
      </span>
    </>
  );
}

/** One day's total in the footer: the people working over their hours, then any more under them. */
function Total({ total }: { readonly total: TeamWeekTotal }) {
  return (
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
      {total.extra !== undefined && total.extra !== '' && (
        <span aria-hidden="true" className={styles.totalDetail}>
          {total.extra}
        </span>
      )}
    </span>
  );
}

/** The person's cell: their picture, name, the week's hours and their zone's offset, more under it, and the menu. */
function PersonCell({ person }: { readonly person: TeamWeekPerson }) {
  const meta = person.badge === undefined ? person.meta : `${person.meta}${strings.separator}${person.badge}`;
  return (
    <span className={styles.person}>
      <span className={styles.picture}>
        <Avatar name={person.name} id={person.id} size="md" isDecorative />
      </span>
      <span className={styles.who}>
        <span className={styles.name}>
          <TruncatedText>{person.name}</TruncatedText>
        </span>
        <span className={styles.meta}>{meta}</span>
        {person.extra}
      </span>
      {person.actions !== undefined && <span className={styles.actions}>{person.actions}</span>}
    </span>
  );
}

/**
 * A cell's lines as drawn (its label is what is heard). A day that continues an Away band keeps its words' room but
 * hides them, so the band stays one height and says it once.
 */
function CellLines({ cell, join }: { readonly cell: TeamWeekCell; readonly join: Join | undefined }) {
  const continues = join === 'before' || join === 'both';
  return (
    <span aria-hidden="true" className={styles.lines} data-continues={continues || undefined}>
      {cell.lines.map((line, index) => (
        <span key={`${String(index)}-${line}`} className={styles.line} data-first={index === 0 || undefined}>
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
  join,
  editorLabel,
  renderEditor,
}: {
  readonly cell: TeamWeekCell;
  readonly join: Join | undefined;
  readonly editorLabel: string;
  readonly renderEditor: (close: () => void) => ReactNode;
}) {
  const [isOpen, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setOpen}>
      <AriaButton
        ref={trigger}
        className={styles.cell}
        data-tone={cell.tone}
        data-join={join}
        data-editable=""
        aria-label={cell.label}
      >
        <CellLines cell={cell} join={join} />
      </AriaButton>
      {/* A panel's width, never the content's: the day's HoursEditor sizes by a container query, so it has no
          width of its own, and a day with no "Back to usual hours" line collapsed it and cut its times off. */}
      <Popover label={editorLabel} triggerRef={trigger} placement="bottom start" width="panel">
        {renderEditor(() => setOpen(false))}
      </Popover>
    </DialogTrigger>
  );
}
