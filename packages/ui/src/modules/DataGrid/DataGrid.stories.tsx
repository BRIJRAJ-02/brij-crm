import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { expect, fn, screen, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { BulkActionBar } from '../BulkActionBar/BulkActionBar.tsx';
import type { CellChange } from '../../fields/types.ts';
import { arraySource } from '../../lib/list-source.ts';
import { hoverFresh, shownTooltip } from '../../workbench/pointer.ts';
import type { AttributeType } from '@crm/contracts/values';
import type { FieldAttribute } from '../../fields/types.ts';
import { attributeOf } from '../../workbench/attributes.ts';
import { sampleColumn, sampleColumns, sampleRows, type SampleRow } from '../../workbench/grid-samples.ts';
import {
  FIELD_SAMPLES,
  SAMPLE_COMPANIES,
  SAMPLE_MEMBERS,
  SAMPLE_STAGES,
  sampleMemberSearch,
} from '../../workbench/field-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { DataGrid, type GridStatus, type RowNote, type RowSource } from './DataGrid.tsx';
import type { GridEditorProps } from './GridCell.tsx';
import type { GridColumnAction } from './GridHeaderCell.tsx';
import type { GridColumn } from './grid-columns.ts';
import type { GridGroup } from './grid-groups.ts';
import { noRows, withRows, type GridSelection } from './grid-selection.ts';

interface SampleGridProps {
  readonly count?: number;
  readonly columnCount?: number;
  readonly status?: GridStatus;
  readonly selected?: readonly string[];
  readonly footer?: Readonly<Record<string, ReactNode>>;
  /** The footer's ghost "+ New company" under the row header. */
  readonly addRow?: { readonly label: string; readonly onAdd: () => void };
  /** Rows at these indexes are still loading. */
  readonly isLoading?: (index: number) => boolean;
  readonly cellErrors?: ReadonlyMap<string, string>;
  readonly onRowOpen?: (rowId: string) => void;
  readonly confirmsPaste?: boolean;
  /** Notes on rows by id: a record made here, a row that left the view. */
  readonly rowNotes?: ReadonlyMap<string, RowNote>;
  /** Columns not read yet for these rows (a column just shown): their cells draw skeletons. */
  readonly unknown?: { readonly rows: readonly string[]; readonly column: string };
  readonly sort?: { readonly columnId: string; readonly direction: 'ascending' | 'descending' };
  /** Each row header shows the row's picture (initials here). */
  readonly withAvatars?: boolean;
  /** Rows with no name: their row header says `untitled`, muted. */
  readonly unnamed?: readonly string[];
  /** Retry on the error state; does nothing unless given. */
  readonly onRetry?: () => void;
  /** The "+" header after the last column (spec 0012). */
  readonly onAddColumn?: () => void;
  /** The screen's own column menu items (spec 0012). */
  readonly columnActions?: (columnId: string) => readonly GridColumnAction[];
  /** "Create" in a select or status cell's list (spec 0012, AC-238). */
  readonly onCreateOption?: (rowId: string, columnId: string, label: string) => void;
  /** A bar floating over the grid's foot (spec 0022): the BulkActionBar while rows are ticked. */
  readonly floatingBar?: ReactNode;
  /** The floating bar drawn from the grid's own selection, as a screen draws its BulkActionBar. */
  readonly barFor?: (selection: GridSelection, clear: () => void) => ReactNode;
  /** `narrow` holds the grid to a phone's width less its gutters, or narrower. */
  readonly stageWidth?: 'auto' | 'narrow';
  /** Every column read only, as the trash's are, with the headers' locks left out. */
  readonly isAllReadOnly?: boolean;
}

/** A grid over sample companies that keeps its own edits, columns and selection, as a screen would. */
function SampleGrid({
  count = 200,
  columnCount,
  status = 'ready',
  selected = [],
  footer,
  addRow,
  isLoading,
  cellErrors,
  onRowOpen,
  confirmsPaste,
  rowNotes,
  unknown,
  sort,
  withAvatars = false,
  unnamed = [],
  onRetry = () => undefined,
  onAddColumn,
  columnActions,
  onCreateOption,
  floatingBar,
  barFor,
  stageWidth = 'auto',
  isAllReadOnly = false,
}: SampleGridProps) {
  const [data, setData] = useState(() =>
    sampleRows(count).map((row) =>
      unnamed.includes(row.id) ? { ...row, values: { ...row.values, name: null } } : row,
    ),
  );
  const [layout, setLayout] = useState(
    (): { readonly columns: readonly GridColumn[]; readonly pinnedCount: number } => ({
      columns: sampleColumns(columnCount).map((column) =>
        isAllReadOnly
          ? {
              ...column,
              attribute: { ...column.attribute, isReadOnly: true, readOnlyReason: 'Restore it to change it.' },
            }
          : column,
      ),
      pinnedCount: 1,
    }),
  );
  const [selection, setSelection] = useState<GridSelection>(() => withRows(noRows(), selected, true));
  const apply = (changes: readonly CellChange[]) => {
    setData((rows) =>
      rows.map((row) => {
        const mine = changes.filter((change) => change.rowId === row.id);
        if (mine.length === 0) return row;
        // A new owner shows by name, as the data layer would send it.
        const owner = mine.find((change) => change.columnId === 'owner')?.value as { readonly id?: string } | null;
        const member = SAMPLE_MEMBERS.find((each) => each.id === owner?.id);
        return {
          ...row,
          values: { ...row.values, ...Object.fromEntries(mine.map((c) => [c.columnId, c.value])) },
          displays: member === undefined ? row.displays : { ...row.displays, owner: member },
        };
      }),
    );
  };
  const source: RowSource<SampleRow> = {
    count: data.length,
    getItem: (index) => (isLoading?.(index) === true ? undefined : data[index]),
    getKey: (row) => row.id,
  };
  // Reference editors search the sample members and companies.
  const editorProps = (column: GridColumn): GridEditorProps => {
    if (column.attribute.type === 'actor_reference') {
      const me = SAMPLE_MEMBERS[0];
      return {
        onSearch: sampleMemberSearch as never,
        ...(me === undefined ? {} : { me }),
      };
    }
    if (column.attribute.type === 'record_reference') {
      return { onSearch: () => arraySource(SAMPLE_COMPANIES, (company) => company.recordId) as never };
    }
    return {};
  };
  return (
    <Stage height="grid" width={stageWidth}>
      <DataGrid<SampleRow>
        label="Companies"
        columns={layout.columns}
        pinnedCount={layout.pinnedCount}
        rows={source}
        getValue={(row, id) => row.values[id] ?? null}
        getDisplay={(row, id) => row.displays[id]}
        rowHeader="name"
        hideColumnLocks={isAllReadOnly}
        selection={selection}
        onSelectionChange={setSelection}
        onColumnsChange={(columns, pinnedCount) => {
          setLayout({ columns, pinnedCount });
        }}
        onCellChange={(change) => {
          apply([change]);
        }}
        onCellsChange={apply}
        status={status}
        members={SAMPLE_MEMBERS}
        editorProps={editorProps}
        onRetry={onRetry}
        {...(footer === undefined ? {} : { footer })}
        {...(addRow === undefined ? {} : { addRow })}
        {...(cellErrors === undefined ? {} : { cellErrors })}
        {...(onRowOpen === undefined ? {} : { onRowOpen })}
        {...(confirmsPaste === undefined ? {} : { confirmsPaste })}
        {...(rowNotes === undefined ? {} : { rowNotes })}
        {...(sort === undefined ? {} : { sort, onSort: () => undefined })}
        {...(withAvatars ? { rowAvatar: () => undefined, untitled: 'Unnamed company' } : {})}
        {...(onAddColumn === undefined ? {} : { onAddColumn })}
        {...(columnActions === undefined ? {} : { columnActions })}
        {...(onCreateOption === undefined ? {} : { onCreateOption })}
        {...(floatingBar === undefined ? {} : { floatingBar })}
        {...(barFor === undefined
          ? {}
          : {
              floatingBar: barFor(selection, () => {
                setSelection(noRows());
              }),
            })}
        {...(unknown === undefined
          ? {}
          : {
              isCellKnown: (row: SampleRow, id: string) => !(id === unknown.column && unknown.rows.includes(row.id)),
            })}
      />
    </Stage>
  );
}

/** A grid of 200 companies with a button that asks it to focus row 151, as a screen does after making a record. */
function FocusRowGrid() {
  const [rows] = useState(() => sampleRows(200));
  const [focusRow, setFocusRow] = useState<{ readonly index: number } | undefined>(undefined);
  return (
    <Stage height="grid">
      <Button
        onPress={() => {
          setFocusRow({ index: 150 });
        }}
      >
        Focus row 151
      </Button>
      <DataGrid<SampleRow>
        label="Companies"
        columns={sampleColumns()}
        pinnedCount={1}
        rows={arraySource(rows, (row) => row.id)}
        getValue={(row, id) => row.values[id] ?? null}
        getDisplay={(row, id) => row.displays[id]}
        rowHeader="name"
        {...(focusRow === undefined ? {} : { focusRow })}
      />
    </Stage>
  );
}

interface TypeColumn {
  readonly attribute: FieldAttribute;
  readonly value: unknown;
  readonly display?: unknown;
}

/** Every attribute type as a column, then the same type holding several values where it can. */
function everyTypeColumns(): readonly TypeColumn[] {
  const columns: TypeColumn[] = [{ attribute: attributeOf('text', 'Name', { isRequired: true }), value: 'Northwind' }];
  for (const type of Object.keys(FIELD_SAMPLES) as AttributeType[]) {
    // The name is the text column.
    if (type === 'text') continue;
    const sample = FIELD_SAMPLES[type];
    // The row header is the name, so the personal name column takes another one.
    const name = type === 'personal_name' ? 'Contact' : sample.attribute.name;
    columns.push({ ...sample, attribute: { ...sample.attribute, id: type, name } });
    if (sample.several !== undefined) {
      columns.push({ ...sample.several, attribute: { ...sample.several.attribute, id: `${type}_many` } });
    }
  }
  return columns;
}

/** A grid with a column per attribute type: a row of samples, a row of empty values, and the samples again. */
function EveryTypeGrid({ cellErrors }: { readonly cellErrors?: ReadonlyMap<string, string> }) {
  const [typeColumns] = useState(everyTypeColumns);
  const [rows, setRows] = useState<readonly SampleRow[]>(() =>
    [0, 1, 2].map((index) => ({
      id: `row-${String(index)}`,
      values: Object.fromEntries(typeColumns.map((each) => [each.attribute.id, index === 1 ? null : each.value])),
      displays: Object.fromEntries(
        typeColumns.map((each) => [each.attribute.id, index === 1 ? undefined : each.display]),
      ),
    })),
  );
  const [columns, setColumns] = useState<readonly GridColumn[]>(() =>
    typeColumns.map((each) => sampleColumn(each.attribute)),
  );
  const apply = (changes: readonly CellChange[]) => {
    setRows((current) =>
      current.map((row) => {
        const mine = changes.filter((change) => change.rowId === row.id);
        if (mine.length === 0) return row;
        return { ...row, values: { ...row.values, ...Object.fromEntries(mine.map((c) => [c.columnId, c.value])) } };
      }),
    );
  };
  const editorProps = (column: GridColumn): GridEditorProps => {
    if (column.attribute.type === 'actor_reference') {
      return { onSearch: () => arraySource(SAMPLE_MEMBERS, (member) => member.id ?? member.name) as never };
    }
    if (column.attribute.type === 'record_reference') {
      return { onSearch: () => arraySource(SAMPLE_COMPANIES, (company) => company.recordId) as never };
    }
    return {};
  };
  return (
    <Stage height="grid">
      <DataGrid<SampleRow>
        label="Every type"
        columns={columns}
        pinnedCount={1}
        rows={arraySource(rows, (row) => row.id)}
        getValue={(row, id) => row.values[id] ?? null}
        getDisplay={(row, id) => row.displays[id]}
        rowHeader="name"
        onColumnsChange={setColumns}
        onCellChange={(change) => {
          apply([change]);
        }}
        onCellsChange={apply}
        editorProps={editorProps}
        {...(cellErrors === undefined ? {} : { cellErrors })}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/DataGrid',
  component: SampleGrid,
} satisfies Meta<typeof SampleGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

const cell = (canvas: HTMLElement, row: number, col: number) =>
  canvas.querySelector<HTMLElement>(`[data-cell="${String(row)}:${String(col)}"]`);
const focused = () => document.activeElement?.closest('[data-cell]')?.getAttribute('data-cell');

/**
 * A clipboard event as the browser fires it, on the focused cell. Firefox ignores a `clipboardData`
 * passed in and fills its own from `dataType` and `data`, so both are given and the event's own is read back.
 */
function clipboardEvent(type: 'copy' | 'paste', text = ''): DataTransfer | null {
  const clipboardData = new DataTransfer();
  if (text !== '') clipboardData.setData('text/plain', text);
  const init: ClipboardEventInit & { readonly dataType: string; readonly data: string } = {
    clipboardData,
    dataType: 'text/plain',
    data: text,
    bubbles: true,
    cancelable: true,
  };
  const event = new ClipboardEvent(type, init);
  document.activeElement?.dispatchEvent(event);
  return event.clipboardData;
}

/** Mod+C: the text the grid put on the clipboard. */
const copyFromFocus = () => clipboardEvent('copy')?.getData('text/plain');

/** Mod+V, with `text` on the clipboard. */
const pasteIntoFocus = (text: string) => clipboardEvent('paste', text);

/** 200 companies: the name pinned as the row header, each value through the field set. Only the rows on screen draw. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    const grid = canvas.getByRole('grid', { name: 'Companies' });
    await expect(grid).toHaveAttribute('aria-rowcount', '201');
    await expect(grid).toHaveAttribute('aria-colcount', '10');
    await expect(canvas.getAllByRole('row').length).toBeLessThan(100);
    await expect(canvas.getByRole('rowheader', { name: /Northwind Traders/ })).toBeInTheDocument();
    // A narrow column's type icon gives way only when its name needs the room: the icon is in sight before the
    // name when both fit, and wrapped out of the one line lead (below it) when they don't.
    for (const header of canvas.getAllByRole('columnheader')) {
      const lead = header.querySelector('[class*="header-cell-lead"]');
      const icon = lead?.querySelector('svg')?.getBoundingClientRect();
      const name = lead?.querySelector('[data-truncated], [class*="truncated-text"]');
      const box = lead?.getBoundingClientRect();
      if (icon === undefined || box === undefined || name === null || name === undefined) continue;
      const isIconShown = icon.top >= box.top - 1 && icon.bottom <= box.bottom + 1;
      if (isIconShown) await expect(icon.right).toBeLessThanOrEqual(name.getBoundingClientRect().left + 1);
      // Hidden only when the name and the icon beside it wouldn't both fit.
      else {
        const gap = Number.parseFloat(getComputedStyle(lead as Element).columnGap);
        await expect(name.scrollWidth + gap + icon.width).toBeGreaterThan(box.width);
      }
    }
  },
};

type Keys = (keys: string) => Promise<void>;

/** Presses keys one at a time, as a person does, waiting for focus to land on `at` (a row:col cell) when given. */
function presser(keyboard: Keys) {
  return async (keys: readonly string[], at?: string) => {
    for (const key of keys) {
      await keyboard(key);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (at !== undefined) await waitFor(() => expect(focused()).toBe(at));
  };
}

/** Every column read only, as in the trash: the headers leave out their lock each, since every one would repeat it. */
export const HideColumnLocks: Story = {
  args: { isAllReadOnly: true, count: 12 },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('grid', { name: 'Companies' })).toBeInTheDocument();
    await expect(canvas.queryByLabelText('Read only')).not.toBeInTheDocument();
  },
};

/** The keyboard model (AC-8): arrows, Home and End, Enter to edit and move down, typing to replace, Esc to cancel, Delete to clear. */
export const Keyboard: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await waitFor(() => expect(focused()).toBe('0:1'));
    await press(['{ArrowRight}', '{ArrowDown}'], '1:2');
    await press(['{End}'], '1:9');
    await press(['{Home}'], '1:0');

    // Typing replaces the value; Enter commits and moves down.
    await press(['{ArrowRight}', '{ArrowRight}'], '1:2');
    await press(['a']);
    await waitFor(() => expect(document.activeElement?.tagName).toBe('INPUT'));
    await userEvent.keyboard('cme.io');
    await press(['{Enter}'], '2:2');
    await expect(cell(canvasElement, 1, 2)).toHaveTextContent('acme.io');

    // Esc cancels and keeps the value.
    await press(['{ArrowUp}'], '1:2');
    await press(['{Enter}']);
    await waitFor(() => expect(document.activeElement?.tagName).toBe('INPUT'));
    await userEvent.keyboard('nope');
    await press(['{Escape}'], '1:2');
    await expect(cell(canvasElement, 1, 2)).toHaveTextContent('acme.io');

    // Delete clears; the required name refuses with the field's error.
    await press(['{Delete}']);
    await waitFor(() => expect(cell(canvasElement, 1, 2)).not.toHaveTextContent('acme.io'));
    await press(['{ArrowLeft}'], '1:1');
    await press(['{Delete}']);
    await waitFor(() => expect(cell(canvasElement, 1, 1)).toHaveAttribute('data-invalid'));
  },
};

/** Space ticks the row's checkbox; Shift with an arrow draws a cell range; Esc clears it (AC-8). */
export const Selection: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await press(['{Home}'], '0:0');
    await press([' ']);
    await waitFor(() => expect(canvas.getAllByRole('row', { selected: true })).toHaveLength(1));
    await press(['{ArrowRight}'], '0:1');
    await press(['{Shift>}{ArrowRight}{/Shift}', '{Shift>}{ArrowDown}{/Shift}'], '1:2');
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-in-range]')).toHaveLength(4));
    await press(['{Escape}']);
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-in-range]')).toHaveLength(0));
  },
};

/** Esc clears a cell range first, then, with no range, the ticked rows (spec 0022, AC-522). */
export const EscapeClearsTickedRows: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await press(['{Home}'], '0:0');
    await press([' ']);
    await waitFor(() => expect(canvas.getAllByRole('row', { selected: true })).toHaveLength(1));
    await press(['{ArrowRight}'], '0:1');
    await press(['{Shift>}{ArrowDown}{/Shift}'], '1:1');
    await press(['{Escape}']);
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-in-range]')).toHaveLength(0));
    await expect(canvas.getAllByRole('row', { selected: true })).toHaveLength(1);
    await press(['{Escape}']);
    await waitFor(() => expect(canvas.queryAllByRole('row', { selected: true })).toHaveLength(0));
  },
};

/** A cell range copies as tab separated text, and a pasted block goes through each column's type; refused cells are reported (AC-8). */
export const CopyAndPaste: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await press(['{ArrowRight}'], '0:2');
    await press(['{Shift>}{ArrowDown}{/Shift}'], '1:2');
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-in-range]')).toHaveLength(2));
    await expect(copyFromFocus()).toBe('northwindtraders.com\nglobextraders.com');
    await press(['{ArrowDown}', '{ArrowDown}', '{ArrowDown}'], '4:2');
    pasteIntoFocus('copied.com\tnot a number');
    await waitFor(() => expect(cell(canvasElement, 4, 2)).toHaveTextContent('copied.com'));
    await waitFor(() => expect(document.querySelector('[data-tone="danger"]')).not.toBeNull());
  },
};

/**
 * A screen that confirms a paste itself once its write lands (with Undo, spec 0006) turns the grid's own
 * confirmation off: a full paste lands quietly here, while one that left cells out is still counted.
 */
export const PasteConfirmedByTheScreen: Story = {
  args: { confirmsPaste: false },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await press(['{ArrowRight}'], '0:2');
    pasteIntoFocus('pasted.com');
    await waitFor(() => expect(cell(canvasElement, 0, 2)).toHaveTextContent('pasted.com'));
    await expect(document.querySelector('[data-tone="success"]')).toBeNull();
    pasteIntoFocus('again.com\tnot a number');
    await waitFor(() => expect(document.querySelector('[data-tone="danger"]')).not.toBeNull());
  },
};

/** The column menu is the keyboard route to moving, pinning, hiding and resizing columns (AC-8). */
export const ColumnMenu: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await press(['{ArrowRight}'], '0:2');
    await press(['{ArrowUp}'], '-1:2');
    await press(['{Alt>}{ArrowDown}{/Alt}']);
    await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    await press(['{ArrowDown}']);
    await press(['{Enter}']);
    await waitFor(() => expect(cell(canvasElement, -1, 3)).toHaveTextContent('Domain'));
  },
};

/** By pointer: a header dragged past the middle of the next one lands after it; a line marks that side meanwhile. */
export const ReorderColumnByDrag: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvasElement }) => {
    const from = cell(canvasElement, -1, 2);
    const to = cell(canvasElement, -1, 3);
    await expect(from).not.toBeNull();
    await expect(to).not.toBeNull();
    if (from === null || to === null) return;
    const name = from.textContent;
    const start = from.getBoundingClientRect();
    const end = to.getBoundingClientRect();
    const y = start.top + start.height / 2;
    const send = (target: EventTarget, type: string, x: number) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 1,
          isPrimary: true,
          clientX: x,
          clientY: y,
        }),
      );
    send(from, 'pointerdown', start.left + start.width / 2);
    send(document, 'pointermove', start.left + start.width / 2 + 12);
    await waitFor(() => expect(from).toHaveAttribute('data-dragging'));
    send(document, 'pointermove', end.right - 4);
    await waitFor(() => expect(to).toHaveAttribute('data-drop-target', 'after'));
    send(document, 'pointerup', end.right - 4);
    await waitFor(() => expect(cell(canvasElement, -1, 3)).toHaveTextContent(name));
  },
};

/** Companies grouped by stage, each stage's rows under its tinted header, folding as the screen keeps them. */
function GroupedGrid({ folded = [] }: { readonly folded?: readonly string[] }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(folded));
  const all = sampleRows(16);
  const stages = SAMPLE_STAGES.filter((stage) => !stage.archived);
  // As the data layer would send them: sorted by stage, with a folded stage's rows left out.
  let start = 0;
  const groups: GridGroup[] = [];
  const shown: SampleRow[] = [];
  for (const stage of stages) {
    const inStage = all.filter((row) => row.values.stage === stage.id);
    const isCollapsed = collapsed.has(stage.id);
    groups.push({ id: stage.id, title: stage.label, hue: stage.hue, count: inStage.length, start, isCollapsed });
    if (!isCollapsed) {
      shown.push(...inStage);
      start += inStage.length;
    }
  }
  return (
    <Stage height="grid">
      <DataGrid<SampleRow>
        label="Companies by stage"
        columns={sampleColumns(6)}
        pinnedCount={1}
        rows={arraySource(shown, (row) => row.id)}
        getValue={(row, id) => row.values[id] ?? null}
        getDisplay={(row, id) => row.displays[id]}
        rowHeader="name"
        groups={groups}
        onGroupToggle={(id, isCollapsed) => {
          setCollapsed((was) => {
            const next = new Set(was);
            if (isCollapsed) next.add(id);
            else next.delete(id);
            return next;
          });
        }}
      />
    </Stage>
  );
}

/** Grouped by a status (13 Oct reference batch 4): each stage under a header tinted in its hue, with its count. */
export const Grouped: StoryObj<typeof GroupedGrid> = {
  render: () => <GroupedGrid />,
  play: async ({ canvas }) => {
    const lead = await canvas.findByRole('button', { name: /Lead/ });
    await expect(lead).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('button', { name: /Qualified/ })).toBeInTheDocument();
  },
};

/**
 * A header folds its stage: the rows go and the header stays, with its count. By keyboard the header is a stop in
 * the grid's column of lines: Up from the stage's first row reaches it, Left folds, Right opens, Down goes back.
 */
export const GroupFolds: StoryObj<typeof GroupedGrid> = {
  parameters: { crm: { screenshot: false } },
  render: () => <GroupedGrid />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const grid = canvas.getByRole('grid', { name: 'Companies by stage' });
    const before = Number(grid.getAttribute('aria-rowcount'));
    await userEvent.click(canvas.getByRole('button', { name: /Lead/ }));
    await waitFor(() => expect(canvas.getByRole('button', { name: /Lead/ })).toHaveAttribute('aria-expanded', 'false'));
    await waitFor(() => expect(Number(grid.getAttribute('aria-rowcount'))).toBeLessThan(before));
    await userEvent.click(canvas.getByRole('button', { name: /Lead/ }));
    await waitFor(() => expect(canvas.getByRole('button', { name: /Lead/ })).toHaveAttribute('aria-expanded', 'true'));
    // By keyboard, from the first row's name.
    const first = cell(canvasElement, 0, 1);
    await expect(first).not.toBeNull();
    if (first === null) return;
    await userEvent.click(first);
    await userEvent.keyboard('{ArrowUp}');
    const lead = canvas.getByRole('button', { name: /Lead/ });
    await waitFor(() => expect(lead).toHaveFocus());
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(canvas.getByRole('button', { name: /Lead/ })).toHaveAttribute('aria-expanded', 'false'));
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(canvas.getByRole('button', { name: /Lead/ })).toHaveAttribute('aria-expanded', 'true'));
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(cell(canvasElement, 0, 1)).toHaveFocus());
  },
};

/** Every stage folded: the headers alone, with their counts, and no empty state. */
export const GroupsAllFolded: StoryObj<typeof GroupedGrid> = {
  render: () => <GroupedGrid folded={SAMPLE_STAGES.filter((stage) => !stage.archived).map((stage) => stage.id)} />,
  play: async ({ canvas }) => {
    for (const name of ['Lead', 'Qualified', 'Proposal', 'Won']) {
      await expect(canvas.getByRole('button', { name: new RegExp(name) })).toHaveAttribute('aria-expanded', 'false');
    }
    await expect(canvas.queryByText('No records')).not.toBeInTheDocument();
  },
};

const editAttribute = fn();
const archiveAttribute = fn();

/**
 * For those who may change the schema (spec 0012): a "+" header after the
 * last column (Add attribute), reached by End in the header row and pressed
 * with Enter, and the screen's own items after the column menu's.
 */
export const SchemaActions: Story = {
  args: {
    onAddColumn: fn(),
    columnActions: (columnId: string) =>
      columnId === 'name'
        ? [{ id: 'edit', label: 'Edit attribute', icon: 'pencil', onAction: editAttribute }]
        : [
            { id: 'edit', label: 'Edit attribute', icon: 'pencil', onAction: editAttribute },
            { id: 'archive', label: 'Archive attribute', icon: 'archive', isDanger: true, onAction: archiveAttribute },
          ],
  },
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    const columns = sampleColumns().length;
    await expect(canvas.getByRole('button', { name: 'Add attribute' })).toBeInTheDocument();
    await userEvent.tab();
    await press(['{ArrowUp}'], '-1:1');
    await press(['{End}'], `-1:${String(columns + 1)}`);
    await press(['{Enter}']);
    await waitFor(() => expect(args.onAddColumn).toHaveBeenCalledOnce());
    // Down from the "+" lands on the last column's first cell.
    await press(['{ArrowDown}'], `0:${String(columns)}`);
    await press(['{ArrowUp}', '{Home}', '{ArrowRight}', '{ArrowRight}'], '-1:2');
    await press(['{Enter}']);
    const menu = await waitFor(() => {
      const found = document.querySelector('[role="menu"]');
      if (found === null) throw new globalThis.Error('No menu yet.');
      return found;
    });
    await expect(menu).toHaveTextContent('Archive attribute');
    const edit = menu.querySelector('[data-key="extra:edit"]');
    if (!(edit instanceof HTMLElement)) throw new globalThis.Error('No Edit attribute item.');
    await userEvent.click(edit);
    await waitFor(() => expect(editAttribute).toHaveBeenCalledOnce());
    // The menu has gone (its exit fade over) before the story ends.
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    await expect(cell(canvasElement, -1, 2)).toBeInTheDocument();
  },
};

/** Twenty columns: the unpinned ones virtualise too, and the name stays pinned while the rest scroll. */
export const ManyColumns: Story = {
  args: { columnCount: 20 },
  // The first screen of columns is the default story's.
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('grid')).toHaveAttribute('aria-colcount', '21');
    await expect(canvas.getAllByRole('columnheader').length).toBeLessThan(21);
    // Arrowing past the first screen drops columns off the start; the focused cell keeps focus.
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await press(['{End}'], '0:20');
    await press(['{Home}'], '0:0');
    for (let col = 1; col <= 16; col += 1) await press(['{ArrowRight}'], `0:${String(col)}`);
    // Scrolled sideways, the pinned name column casts its edge over the columns under it.
    await waitFor(() => expect(canvas.getByRole('grid')).toHaveAttribute('data-scrolled-x'));
  },
};

/** Scrolled sideways: the pinned name column's edge (`shadow-pinned-edge`) over the columns passing under it. */
export const PinnedEdge: Story = {
  args: { columnCount: 20 },
  play: async ({ canvas }) => {
    const grid = canvas.getByRole('grid');
    grid.scrollLeft = 400;
    grid.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(grid).toHaveAttribute('data-scrolled-x'));
  },
};

/** Rows still loading draw skeletons in their cells (AC-9). */
export const RowsLoading: Story = {
  args: { isLoading: (index: number) => index % 4 === 2 },
};

/** While the view loads: the header and skeleton rows, marked busy. */
export const Loading: Story = {
  args: { status: 'loading' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('grid')).toHaveAttribute('aria-busy', 'true');
  },
};

/** No records yet. */
export const Empty: Story = {
  args: { count: 0 },
};

/** The load failed, with a retry. */
export const Error: Story = {
  args: { status: 'error' },
};

/** A failed load whose Retry brings the rows back, as a screen's would. */
function RetryingGrid() {
  const [status, setStatus] = useState<GridStatus>('error');
  return (
    <SampleGrid
      status={status}
      onRetry={() => {
        setStatus('ready');
      }}
    />
  );
}

/** Retry leaves with the error state; the grid that comes back takes focus, so the keyboard carries on there. */
export const RetryKeepsFocus: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <RetryingGrid />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    const grid = canvas.getByRole('grid', { name: 'Companies' });
    // The grid, or the cell it hands focus to.
    await waitFor(() => expect(grid.contains(grid.ownerDocument.activeElement)).toBe(true));
  },
};

/** The viewer can't see this view. */
export const NoAccess: Story = {
  args: { status: 'no-access' },
};

/** Row headers with each row's picture before its name, and a row with no name, which says so, muted. */
export const RowPicturesAndUnnamed: Story = {
  args: { withAvatars: true, unnamed: ['company-1'] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Unnamed company')).toBeVisible();
    await expect(canvas.getByRole('row', { name: /Unnamed company/ })).toBeInTheDocument();
  },
};

/** Opens the last column's editor (Open deals, a number), types a word and presses Enter, which it refuses. */
async function refuseInLastColumn(canvasElement: HTMLElement, userEvent: { keyboard: Keys; tab: () => Promise<void> }) {
  const press = presser((keys) => userEvent.keyboard(keys));
  await userEvent.tab();
  await waitFor(() => expect(focused()).toBe('0:1'));
  await press(['{End}'], '0:12');
  const grid = canvasElement.querySelector<HTMLElement>('[role="grid"]');
  const scrollWidth = grid?.scrollWidth ?? 0;
  await press(['m']);
  await waitFor(() => expect(document.activeElement?.tagName).toBe('INPUT'));
  await userEvent.keyboard('any{Enter}');
  const error = await waitFor(() => {
    const found = cell(canvasElement, 0, 12)?.querySelector<HTMLElement>('[slot="errorMessage"]');
    if (found === null || found === undefined) throw new globalThis.Error('No error under the cell yet.');
    return found;
  });
  return { grid, error, scrollWidth };
}

/** Waits until `inner` sits wholly inside the grid's visible box and the window, sideways and down. */
async function expectInside(grid: HTMLElement | null, inner: HTMLElement) {
  if (grid === null) throw new globalThis.Error('No grid.');
  await waitFor(() => {
    const box = inner.getBoundingClientRect();
    const frame = grid.getBoundingClientRect();
    const start = Math.max(frame.left + grid.clientLeft, 0);
    const end = Math.min(frame.left + grid.clientLeft + grid.clientWidth, document.documentElement.clientWidth);
    const top = frame.top + grid.clientTop;
    const outside = {
      start: box.left < start - 0.5 ? start - box.left : 0,
      end: box.right > end + 0.5 ? box.right - end : 0,
      top: box.top < top - 0.5 ? top - box.top : 0,
      bottom: box.bottom > top + grid.clientHeight + 0.5 ? box.bottom - top - grid.clientHeight : 0,
    };
    return expect(outside).toEqual({ start: 0, end: 0, top: 0, bottom: 0 });
  });
}

/**
 * A value refused in the last column (F37): its error shifts in from the grid's end edge, so all of it shows,
 * and the grid gains no sideways scroll for it.
 */
export const LastColumnError: Story = {
  args: { columnCount: 12 },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvasElement, userEvent }) => {
    const { grid, error, scrollWidth } = await refuseInLastColumn(canvasElement, userEvent);
    await expectInside(grid, error);
    await expect(error).toHaveTextContent(/\S/);
    // The error adds nothing to scroll to.
    await expect(grid?.scrollWidth).toBe(scrollWidth);
  },
};

/** The same refusal on a phone's narrow grid: the error is no wider than the grid, and stays inside it. */
export const LastColumnErrorNarrow: Story = {
  args: { columnCount: 12, stageWidth: 'narrow' },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvasElement, userEvent }) => {
    const { grid, error } = await refuseInLastColumn(canvasElement, userEvent);
    await expectInside(grid, error);
  },
};

/** Some rows selected, a refused value from the data layer, and a read only column. */
export const SelectedAndRefused: Story = {
  args: {
    columnCount: 20,
    selected: ['company-1', 'company-2'],
    cellErrors: new Map([['company-0:domain', 'Another company already has this domain.']]),
  },
};

/**
 * The person's own rows while the view settles (spec 0006, AC-56): a company they just made sits first, noted
 * New, and one they edited out of the view's filter keeps its row, noted. A column just shown draws skeletons
 * in rows not read for it yet, and they don't open an editor.
 */
export const RowNotesAndUnreadCells: Story = {
  args: {
    rowNotes: new Map<string, RowNote>([
      ['company-0', 'new'],
      ['company-2', 'no-longer-matches'],
    ]),
    unknown: { rows: ['company-3', 'company-4'], column: 'domain' },
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('New')).toBeVisible();
    // "New" never shrinks to "N…": the name beside it gives way instead.
    const fresh = canvas.getByText('New');
    await expect(fresh.scrollWidth).toBeLessThanOrEqual(fresh.clientWidth);
    await expect(canvas.getByText('Doesn’t match this view')).toBeVisible();
    // The note is part of the row header, so it is read with the name.
    await expect(cell(canvasElement, 0, 1)).toHaveTextContent('New');
    await expect(cell(canvasElement, 3, 2)?.querySelector('[data-shape]')).not.toBeNull();
    await expect(cell(canvasElement, 1, 2)?.querySelector('[data-shape]')).toBeNull();
  },
};

/** Sorted by Employees, descending: the header says so (aria-sort) and shows the direction's arrow. */
export const Sorted: Story = {
  args: { sort: { columnId: 'employees', direction: 'descending' } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('columnheader', { name: /Employees/ })).toHaveAttribute('aria-sort', 'descending');
    await expect(canvas.getByRole('columnheader', { name: /Domain/ })).not.toHaveAttribute('aria-sort');
  },
};

/** Calculations the screen worked out, under their columns. */
export const Footer: Story = {
  args: { footer: { employees: '1,234 avg', arr: 'USD 91,234,560 sum' } },
};

/**
 * A bar floating over the foot (spec 0022): the BulkActionBar centres on the
 * grid, and the last row scrolls clear of it, so the bar never hides the
 * focused cell.
 */
export const FloatingBar: Story = {
  args: {
    count: 30,
    selected: ['company-1', 'company-2'],
    floatingBar: (
      <BulkActionBar placement="floating" count={2} total={30} onClear={() => undefined}>
        <Button variant="danger" icon="trash">
          Delete
        </Button>
      </BulkActionBar>
    ),
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    const grid = canvas.getByRole('grid', { name: 'Companies' });
    const bar = canvas.getByRole('toolbar', { name: 'Selected records' });
    // The bar as drawn is FloatingBar's surface around the toolbar. Its padding is 12 before the count and 8 after
    // Clear (whose own padding makes up the rest), so the toolbar inside sits 2 px right of the bar's centre.
    const surface = bar.parentElement;
    await expect(surface).not.toBeNull();
    if (surface === null) return;
    const gridBox = grid.getBoundingClientRect();
    const barBox = surface.getBoundingClientRect();
    // Centred on the grid, inside it.
    await expect(Math.abs(barBox.left + barBox.width / 2 - (gridBox.left + gridBox.width / 2))).toBeLessThan(2);
    await expect(barBox.bottom).toBeLessThanOrEqual(gridBox.bottom);
    // The last row, focused by the keyboard, sits clear of the bar.
    const first = canvasElement.querySelector('[data-cell="0:3"]');
    await expect(first).not.toBeNull();
    if (first === null) return;
    await userEvent.click(first);
    await press(['{Meta>}{End}{/Meta}'], '29:9');
    await waitFor(() => {
      const last = canvasElement.querySelector('[data-cell="29:9"]');
      return expect(last?.getBoundingClientRect().bottom ?? Infinity).toBeLessThanOrEqual(
        bar.getBoundingClientRect().top,
      );
    });
  },
};

/**
 * While the floating bar shows, it says the count and the grid doesn't, so a
 * tick is said once: the first by the grid (the bar arrives with its count,
 * quietly), the next by the bar.
 */
export const FloatingBarSpeaks: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    count: 30,
    barFor: (selection, clear) => {
      const selected = selection.kind === 'some' ? selection.ids.size : 0;
      return selected === 0 ? undefined : (
        <BulkActionBar placement="floating" count={selected} total={30} onClear={clear}>
          <Button variant="danger" icon="trash">
            Delete
          </Button>
        </BulkActionBar>
      );
    },
  },
  play: async ({ canvas, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await press(['{Home}'], '0:0');
    await press([' ']);
    await waitFor(() => expect(canvas.getByText('1 row selected')).toBeInTheDocument());
    await press(['{ArrowDown}'], '1:0');
    await press([' ']);
    await waitFor(() => expect(canvas.getByText('2 selected')).toBeInTheDocument());
    await expect(canvas.queryByText('2 rows selected')).toBeNull();
  },
};

/** A ghost "+ New company" opens the footer under the row header, beside the count; a click or Enter adds a row. */
export const AddRow: Story = {
  args: {
    count: 4,
    footer: { name: '4 records' },
    addRow: { label: 'New company', onAdd: fn() },
  },
  play: async ({ args, canvas, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    const cell = canvas.getByRole('gridcell', { name: /New company/ });
    await expect(cell).toHaveTextContent('4 records');
    await userEvent.click(cell);
    await expect(args.addRow?.onAdd).toHaveBeenCalledTimes(1);
    await press(['{Enter}']);
    await expect(args.addRow?.onAdd).toHaveBeenCalledTimes(2);
  },
};

/** The footer is the last row the keys reach; it reads, and nothing in it edits. */
export const FooterByKeyboard: Story = {
  args: { footer: { employees: '1,234 avg', arr: 'USD 91,234,560 sum' } },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await expect(canvas.getByRole('grid')).toHaveAttribute('aria-rowcount', '202');
    await userEvent.tab();
    await press(['{Meta>}{End}{/Meta}'], '200:9');
    await press(['{Home}', '{ArrowRight}', '{ArrowRight}', '{ArrowRight}'], '200:3');
    await expect(document.activeElement).toHaveTextContent('1,234 avg');
  },
};

/** Space on the header's checkbox selects the rows on screen, and again clears them (AC-8). */
export const HeaderCheckbox: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await press(['{Home}', '{ArrowUp}'], '-1:0');
    await press([' ']);
    await waitFor(() => expect(canvas.getAllByRole('row', { selected: true }).length).toBeGreaterThan(5));
    await waitFor(() => expect(canvas.getByText(/rows selected/)).toBeInTheDocument());
    await press([' ']);
    await waitFor(() => expect(canvas.queryAllByRole('row', { selected: true })).toHaveLength(0));
  },
};

/**
 * By pointer: a click on the checkbox of a row that isn't focused ticks it (focusing the row gives it an element
 * of its own, so the grid ticks on the press), a second click clears it, and a clicked cell carries the ring.
 */
export const PointerSelection: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const box = (row: number) =>
      cell(canvasElement, row, 0)?.querySelector('[class*="box"]') ?? cell(canvasElement, row, 0);
    const third = box(3);
    if (third === null) throw new globalThis.Error('No checkbox on row 3');
    await userEvent.click(third);
    await waitFor(() => expect(canvas.getAllByRole('row', { selected: true })).toHaveLength(1));
    const fifth = box(5);
    if (fifth === null) throw new globalThis.Error('No checkbox on row 5');
    await userEvent.click(fifth);
    await waitFor(() => expect(canvas.getAllByRole('row', { selected: true })).toHaveLength(2));
    const again = box(5);
    if (again === null) throw new globalThis.Error('No checkbox on row 5');
    await userEvent.click(again);
    await waitFor(() => expect(canvas.getAllByRole('row', { selected: true })).toHaveLength(1));
    // A clicked cell is the active one, ringed while the grid holds focus.
    const target = cell(canvasElement, 2, 3);
    if (target === null) throw new globalThis.Error('No cell 2:3');
    await userEvent.click(target);
    await waitFor(() => expect(cell(canvasElement, 2, 3)).toHaveAttribute('data-active'));
  },
};

/** A select or a status edits as its list, open at once: Enter, then the arrows and Enter choose; Esc leaves the value (AC-8). */
export const ListEditors: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    const inList = () => document.activeElement?.closest('[role="listbox"]');
    await userEvent.tab();
    await press(['{ArrowRight}', '{ArrowRight}', '{ArrowRight}', '{ArrowRight}'], '0:5');
    await press(['{Enter}']);
    await waitFor(() => expect(inList()).not.toBeNull());
    await press(['{ArrowDown}', '{Enter}'], '0:5');
    await waitFor(() => expect(cell(canvasElement, 0, 5)).toHaveTextContent('Fintech'));
    await press(['{ArrowRight}'], '0:6');
    await press(['{Enter}']);
    await waitFor(() => expect(inList()).not.toBeNull());
    await press(['{Escape}'], '0:6');
    await expect(cell(canvasElement, 0, 6)).toHaveTextContent('Lead');
  },
};

/** For someone who may shape the schema, a select cell's list searches and offers "Create" for a label it lacks; choosing it ends the edit (spec 0012, AC-238). */
export const CreateOptionInCell: Story = {
  args: { onCreateOption: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await press(['{ArrowRight}', '{ArrowRight}', '{ArrowRight}', '{ArrowRight}'], '0:5');
    await press(['{Enter}']);
    const search = await screen.findByRole('textbox', { name: /^Search/ });
    await waitFor(() => expect(search).toHaveFocus());
    await userEvent.keyboard('Robotics');
    await userEvent.click(await screen.findByRole('option', { name: 'Create "Robotics"' }));
    await expect(args.onCreateOption).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'Robotics');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await waitFor(() => expect(cell(canvasElement, 0, 5)).toHaveAttribute('data-active'));
  },
};

/** A date or a member edits in a popover on the cell, its first control focused; typing starts the member search with that key (AC-8). */
export const PopoverEditors: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await press(['{End}', '{ArrowLeft}', '{ArrowLeft}'], '0:7');
    await press(['{Enter}']);
    await waitFor(() => expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull());
    await press(['{Escape}'], '0:7');
    await press(['{ArrowRight}'], '0:8');
    await press(['g']);
    await waitFor(() => expect(document.activeElement).toHaveValue('g'));
    // "g" matches Grace Hopper and Alan Turing; Me (Ada) isn't pinned once a search is typed.
    await press(['{ArrowDown}', '{Enter}'], '0:8');
    await waitFor(() => expect(cell(canvasElement, 0, 8)).toHaveTextContent('Grace Hopper'));
  },
};

/** The rest of the keyboard (AC-8): F2, Tab and Shift Tab commit and move, the Page keys, Mod with Home and End, Mod+A, Space on a checkbox and on the name. */
export const MoreKeys: Story = {
  args: { onRowOpen: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await press(['{F2}']);
    await waitFor(() => expect(document.activeElement?.tagName).toBe('INPUT'));
    await userEvent.keyboard(' Ltd');
    await press(['{Tab}'], '0:2');
    await expect(cell(canvasElement, 0, 1)).toHaveTextContent('Northwind Traders Ltd');
    await press(['{F2}']);
    await waitFor(() => expect(document.activeElement?.tagName).toBe('INPUT'));
    await press(['{Shift>}{Tab}{/Shift}'], '0:1');
    await press(['{PageDown}']);
    await waitFor(() => expect(Number(focused()?.split(':')[0])).toBeGreaterThan(3));
    await press(['{PageUp}'], '0:1');
    await press(['{Meta>}{End}{/Meta}'], '199:9');
    await press(['{Meta>}{Home}{/Meta}'], '0:0');
    await press(['{Meta>}a{/Meta}']);
    await waitFor(() => expect(canvas.getAllByRole('row', { selected: true }).length).toBeGreaterThan(5));
    await press(['{End}'], '0:9');
    await expect(cell(canvasElement, 0, 9)).toHaveTextContent('Is customer, checked');
    await press([' ']);
    await waitFor(() => expect(cell(canvasElement, 0, 9)).toHaveTextContent('Is customer, not checked'));
    await press(['{Home}', '{ArrowRight}'], '0:1');
    await press([' ']);
    await expect(args.onRowOpen).toHaveBeenCalledWith('company-0');
  },
};

/** A rating in a cell: a typed digit or the arrows choose a draft, Enter commits it, Esc drops it (AC-8). */
export const RatingKeys: Story = {
  args: { columnCount: 11 },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await press(['{End}'], '0:11');
    await press(['3']);
    await press(['{Enter}'], '1:11');
    await expect(canvas.getAllByRole('img', { name: 'Fit: 3 out of 5 stars' }).length).toBeGreaterThan(0);
    await press(['{Enter}']);
    await press(['{ArrowRight}', '{Escape}'], '1:11');
    await expect(canvas.getAllByRole('img', { name: 'Fit: 2 out of 5 stars' }).length).toBeGreaterThan(0);
  },
};

/** Resize from the header: Alt with Right starts it, then Left and Right step the width, announced; any other key leaves (AC-8). */
export const ResizeByKeyboard: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    const width = () => Number(/Domain, (\d+) pixels wide/.exec(canvas.getByRole('status').textContent)?.[1]);
    await userEvent.tab();
    await press(['{ArrowRight}'], '0:2');
    await press(['{ArrowUp}'], '-1:2');
    await press(['{Alt>}{ArrowRight}{/Alt}'], '-1:2');
    await waitFor(() => expect(width()).toBeGreaterThan(0));
    const before = width();
    await press(['{ArrowRight}']);
    await waitFor(() => expect(width()).toBe(before + 8));
    await press(['{ArrowDown}'], '0:2');
    await expect(canvas.getByRole('status')).not.toHaveTextContent(/pixels wide/);
    await waitFor(() => expect(document.querySelector('[role="tooltip"]')).toBeNull());
  },
};

/** Hide from the column menu keeps focus in the header, on the column that takes its place. */
export const HideKeepsFocus: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await press(['{ArrowRight}'], '0:2');
    await press(['{ArrowUp}'], '-1:2');
    await press(['{Alt>}{ArrowDown}{/Alt}']);
    await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    await press(['{End}', '{Enter}'], '-1:2');
    await expect(cell(canvasElement, -1, 2)).toHaveTextContent('Employees');
  },
};

/** Pin from the column menu: the column joins the pinned run and sticks with the name. */
export const PinFromMenu: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await press(['{ArrowRight}'], '0:2');
    await press(['{ArrowUp}'], '-1:2');
    await press(['{Alt>}{ArrowDown}{/Alt}']);
    await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    await press(['{End}', '{ArrowUp}', '{Enter}'], '-1:2');
    await waitFor(() => expect(cell(canvasElement, -1, 2)).toHaveAttribute('data-sticky'));
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  },
};

/** Scrolling the focused row off screen keeps it focused, so the next key still works. */
export const ScrollKeepsFocus: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await waitFor(() => expect(focused()).toBe('0:1'));
    const grid = canvas.getByRole('grid');
    grid.scrollTop = 3000;
    const drawnFarDown = () =>
      [...canvasElement.querySelectorAll('[role="row"]')].some((row) => Number(row.getAttribute('aria-rowindex')) > 50);
    await waitFor(() => expect(drawnFarDown()).toBe(true));
    await expect(focused()).toBe('0:1');
    await press(['{ArrowDown}'], '1:1');
    await waitFor(() => expect(grid.scrollTop).toBeLessThan(3000));
  },
};

/** A screen moves focus to a row it just made (`focusRow`): the grid scrolls to it and focuses its first cell. */
export const FocusRow: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <FocusRowGrid />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Focus row 151' }));
    await waitFor(() => expect(focused()).toBe('150:1'));
    await expect(cell(canvasElement, 150, 1)).toHaveTextContent(/./);
  },
};

/** One tooltip serves every cell: a refused cell's reason shows at once on keyboard focus, Esc hides it, and a pointer resting on the cell shows it after the delay. */
export const CellTips: Story = {
  args: { cellErrors: new Map([['company-0:domain', 'Another company already has this domain.']]) },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    const reason = 'Another company already has this domain.';
    await userEvent.tab();
    await press(['{ArrowRight}'], '0:2');
    await expect(await shownTooltip()).toHaveTextContent(reason);
    await expect(cell(canvasElement, 0, 2)).toHaveAccessibleDescription(reason);
    await press(['{Escape}']);
    await waitFor(() => expect(document.querySelector('[role="tooltip"]')).toBeNull());
    const refused = cell(canvasElement, 0, 2);
    await expect(refused).not.toBeNull();
    if (refused === null) return;
    await hoverFresh(userEvent, refused);
    await expect(await shownTooltip()).toHaveTextContent(reason);
    await userEvent.unhover(refused);
    await waitFor(() => expect(document.querySelector('[role="tooltip"]')).toBeNull());
  },
};

/** A column per attribute type at rest: a row of values, a row of empty ones, a refused value, and the read only types. */
export const EveryType: Story = {
  render: () => (
    <EveryTypeGrid cellErrors={new Map([['row-0:email', 'Another person already has this email address.']])} />
  ),
};

/** A column of several emails, at a column's usual width: whole chips, then "+N" for the rest. */
function FoldedChipsGrid() {
  const emails = FIELD_SAMPLES.email.several;
  const [rows] = useState<readonly SampleRow[]>(() => [
    { id: 'row-0', values: { name: 'Northwind', emails: emails?.value ?? null }, displays: {} },
  ]);
  const columns: readonly GridColumn[] = [
    sampleColumn(attributeOf('text', 'Name', { isRequired: true })),
    { ...sampleColumn({ ...(emails?.attribute ?? FIELD_SAMPLES.email.attribute), id: 'emails' }) },
  ];
  return (
    <Stage height="grid">
      <DataGrid<SampleRow>
        label="Folded chips"
        columns={columns}
        pinnedCount={1}
        rows={arraySource(rows, (row) => row.id)}
        getValue={(row, id) => row.values[id] ?? null}
        rowHeader="name"
      />
    </Stage>
  );
}

/** Several values fold into "+N" at what fits the column (measured once per value and width), never squashed. */
export const FoldedChips: Story = {
  render: () => <FoldedChipsGrid />,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('button[aria-label^="Show"]')).not.toBeNull());
  },
};

/** Arrows from the first row's name to the EveryType column `id`, then Enter edits it. */
async function editColumn(
  userEvent: { tab: () => Promise<void>; keyboard: (keys: string) => Promise<void> },
  id: string,
) {
  const press = presser((keys) => userEvent.keyboard(keys));
  await userEvent.tab();
  // Its place in the row: after the checkbox column.
  const at = everyTypeColumns().findIndex((each) => each.attribute.id === id) + 1;
  await expect(at).toBeGreaterThan(1);
  for (let col = 2; col <= at; col += 1) await press(['{ArrowRight}'], `0:${String(col)}`);
  await press(['{Enter}']);
}

/** The panel a popover editor opened, once it is there. */
function openDialog(): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelector<HTMLElement>('[role="dialog"]');
    if (found === null) throw new globalThis.Error('the popover did not open');
    return found;
  });
}

/**
 * A typed editor is the cell itself: the input at the cell's height and
 * padding with no box of its own, and while its text is refused, the danger
 * edge in place of the focus ring, with the reason under the cell.
 */
export const EditInCell: Story = {
  render: () => <EveryTypeGrid />,
  play: async ({ canvasElement, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    await userEvent.tab();
    await press(['{ArrowRight}', '{ArrowRight}'], '0:3');
    await press(['1', '2', 'x', '{Enter}']);
    const input = cell(canvasElement, 0, 3)?.querySelector('input');
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    await expect(input).toHaveFocus();
  },
};

/**
 * Several values can't fit a row, so they edit in a popover under the cell:
 * the list, the add field focused, and its hint, all on the panel. The cell
 * keeps its ring while its popover is open.
 */
export const EditInPopover: Story = {
  render: () => <EveryTypeGrid />,
  play: async ({ userEvent }) => {
    await editColumn(userEvent, 'phone_many');
    const dialog = await openDialog();
    // Written the international way once the phone library (loaded on demand) lands, as stored until then.
    await waitFor(() => expect(dialog).toHaveTextContent(/\+44 ?20 ?7123 ?4567/));
    // The add field is the phone field itself, focused, with the country code picker before it (F38).
    await expect(document.activeElement).toHaveAttribute('type', 'tel');
    await expect(within(dialog).getByRole('button', { name: /Country code/ })).toBeInTheDocument();
  },
};

/**
 * The phone's country code inside the cell's popover: a click opens its list over the popover and both stay open
 * (nothing commits), typing marks the best match ("ind", India), and the field in the popover draws its focus
 * with its accent edge alone, the cell keeping its ring.
 */
export const EditPhoneCodeInPopover: Story = {
  render: () => <EveryTypeGrid />,
  play: async ({ userEvent }) => {
    await editColumn(userEvent, 'phone_many');
    const dialog = await openDialog();
    await waitFor(() => expect(document.activeElement).toHaveAttribute('type', 'tel'));
    await userEvent.keyboard('20155');
    await userEvent.click(within(dialog).getByRole('button', { name: /Country code/ }));
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', 'Search country or code'));
    await userEvent.keyboard('ind');
    await waitFor(() => expect(document.querySelector('[role="option"][data-focused]')).toHaveTextContent('India'));
    // The search names its marked option once React Aria has caught up with the typing.
    await waitFor(() =>
      expect(
        document.getElementById(document.activeElement?.getAttribute('aria-activedescendant') ?? ''),
      ).not.toBeNull(),
    );
    // The cell's editor is still open, its typed number kept.
    await expect(dialog.isConnected).toBe(true);
    const number = within(dialog).getByRole<HTMLInputElement>('textbox');
    await expect(number.value.replace(/\D/g, '')).toBe('20155');
    // A contact's number: no autofill, and password managers told to leave it alone (the owner, 21 October 2026).
    await expect(number).toHaveAttribute('autocomplete', 'off');
    await expect(number).toHaveAttribute('data-1p-ignore');
    await expect(number).toHaveAttribute('data-lpignore', 'true');
  },
};

/**
 * The owner's case (21 October 2026): a cell holding several numbers, the add row's country picker by pointer.
 * The list opens over the editor, a click on a country closes the list alone, the editor stays with its numbers,
 * and focus is back in the number.
 */
export const EditPhoneCodePickInList: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <EveryTypeGrid />,
  play: async ({ userEvent }) => {
    await editColumn(userEvent, 'phone_many');
    const dialog = await openDialog();
    const number = within(dialog).getByRole<HTMLInputElement>('textbox');
    await waitFor(() => expect(number).toHaveFocus());
    // The numbers already in the cell are listed above the add row.
    await expect(within(dialog).getAllByRole('button', { name: /Remove/ }).length).toBeGreaterThanOrEqual(2);
    await userEvent.click(within(dialog).getByRole('button', { name: /Country code/ }));
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull());
    await expect(dialog.isConnected).toBe(true);
    await userEvent.keyboard('india');
    await waitFor(() => expect(document.querySelector('[role="option"][data-focused]')).toHaveTextContent('India'));
    const india = document.querySelector<HTMLElement>('[role="option"][data-focused]');
    await expect(india).not.toBeNull();
    if (india !== null) await userEvent.click(india);
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
    await expect(dialog.isConnected).toBe(true);
    await waitFor(() => expect(number).toHaveFocus());
    await expect(within(dialog).getByRole('button', { name: /Country code/ })).toHaveTextContent('+91');
  },
};

/**
 * Choosing a code in the cell's popover puts focus back in the number with the digits kept; Esc closes the
 * list first, then the editor, and nothing was committed on the way.
 */
export const EditPhoneCodeKeys: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <EveryTypeGrid />,
  play: async ({ canvasElement, userEvent }) => {
    await editColumn(userEvent, 'phone_many');
    const dialog = await openDialog();
    await waitFor(() => expect(document.activeElement).toHaveAttribute('type', 'tel'));
    // The cell's place in the row: after the checkbox column.
    const at = everyTypeColumns().findIndex((each) => each.attribute.id === 'phone_many') + 1;
    const before = cell(canvasElement, 0, at)?.textContent;
    await userEvent.keyboard('20155');
    // By the keyboard: back to the code, open its list, choose by typing.
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName(/Country code/));
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', 'Search country or code'));
    await userEvent.keyboard('ind{Enter}');
    const number = within(dialog).getByRole<HTMLInputElement>('textbox');
    await waitFor(() => expect(number).toHaveFocus());
    await expect(within(dialog).getByRole('button', { name: /Country code/ })).toHaveTextContent('+91');
    await expect(number.value.replace(/\D/g, '')).toBe('20155');
    // Esc: the list first (the editor stays), then the editor.
    await userEvent.click(within(dialog).getByRole('button', { name: /Country code/ }));
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
    await expect(dialog.isConnected).toBe(true);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await expect(cell(canvasElement, 0, at)?.textContent).toBe(before);
  },
};

/**
 * A status (or a short select) is its list, open at once from the cell: the
 * cell is the trigger with no box of its own and keeps its ring, and the list
 * opens at least a menu wide, so no option is cut to the cell's width.
 */
export const EditListInCell: Story = {
  render: () => <EveryTypeGrid />,
  play: async ({ userEvent }) => {
    await editColumn(userEvent, 'status');
    await waitFor(() => expect(document.activeElement?.closest('[role="listbox"]')).not.toBeNull());
    await expect(document.querySelector('[role="listbox"]')).toHaveTextContent('Qualified');
  },
};

/**
 * A member cell searches inside its popover: the search focused at once and
 * the members under it, each with the email that tells two people apart,
 * never a menu over the panel.
 */
export const EditMemberInPopover: Story = {
  render: () => <EveryTypeGrid />,
  play: async ({ userEvent }) => {
    await editColumn(userEvent, 'actor_reference');
    const dialog = await openDialog();
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', 'Search Owner'));
    await waitFor(() => expect(dialog).toHaveTextContent('grace@northwind.com'));
    await expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  },
};

/** A select holding several searches and checks in its popover, each option drawn once, as its tag. */
export const EditTagsInPopover: Story = {
  render: () => <EveryTypeGrid />,
  play: async ({ userEvent }) => {
    await editColumn(userEvent, 'select_many');
    const dialog = await openDialog();
    await waitFor(() => expect(dialog.querySelectorAll('[role="menuitemcheckbox"]').length).toBeGreaterThan(3));
    await expect(document.activeElement).toHaveAttribute('aria-label', 'Search Tags');
  },
};
