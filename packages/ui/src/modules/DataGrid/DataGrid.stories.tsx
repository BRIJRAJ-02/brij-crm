import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import type { CellChange } from '../../fields/types.ts';
import { arraySource } from '../../lib/list-source.ts';
import { hoverFresh, shownTooltip } from '../../workbench/pointer.ts';
import { sampleColumns, sampleRows, type SampleRow } from '../../workbench/grid-samples.ts';
import { SAMPLE_COMPANIES, SAMPLE_MEMBERS } from '../../workbench/field-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { DataGrid, type GridStatus, type RowSource } from './DataGrid.tsx';
import type { GridEditorProps } from './GridCell.tsx';
import type { GridColumn } from './grid-columns.ts';
import { noRows, withRows, type GridSelection } from './grid-selection.ts';

interface SampleGridProps {
  readonly count?: number;
  readonly columnCount?: number;
  readonly status?: GridStatus;
  readonly selected?: readonly string[];
  readonly footer?: Readonly<Record<string, ReactNode>>;
  /** Rows at these indexes are still loading. */
  readonly isLoading?: (index: number) => boolean;
  readonly cellErrors?: ReadonlyMap<string, string>;
  readonly onRowOpen?: (rowId: string) => void;
}

/** A grid over sample companies that keeps its own edits, columns and selection, as a screen would. */
function SampleGrid({
  count = 200,
  columnCount,
  status = 'ready',
  selected = [],
  footer,
  isLoading,
  cellErrors,
  onRowOpen,
}: SampleGridProps) {
  const [data, setData] = useState(() => sampleRows(count));
  const [layout, setLayout] = useState(() => ({ columns: sampleColumns(columnCount), pinnedCount: 1 }));
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
      const others = SAMPLE_MEMBERS.filter((member) => member.id !== me?.id);
      return {
        onSearch: () => arraySource(others, (member) => member.id ?? member.name) as never,
        ...(me === undefined ? {} : { me }),
      };
    }
    if (column.attribute.type === 'record_reference') {
      return { onSearch: () => arraySource(SAMPLE_COMPANIES, (company) => company.recordId) as never };
    }
    return {};
  };
  return (
    <Stage height="grid">
      <DataGrid<SampleRow>
        label="Companies"
        columns={layout.columns}
        pinnedCount={layout.pinnedCount}
        rows={source}
        getValue={(row, id) => row.values[id] ?? null}
        getDisplay={(row, id) => row.displays[id]}
        rowHeader="name"
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
        onRetry={() => undefined}
        {...(footer === undefined ? {} : { footer })}
        {...(cellErrors === undefined ? {} : { cellErrors })}
        {...(onRowOpen === undefined ? {} : { onRowOpen })}
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

/** Twenty columns: the unpinned ones virtualise too, and the name stays pinned while the rest scroll. */
export const ManyColumns: Story = {
  args: { columnCount: 20 },
  // The first screen of columns is the default story's.
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('grid')).toHaveAttribute('aria-colcount', '21');
    await expect(canvas.getAllByRole('columnheader').length).toBeLessThan(21);
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

/** The viewer can't see this view. */
export const NoAccess: Story = {
  args: { status: 'no-access' },
};

/** Some rows selected, a refused value from the data layer, and a read only column. */
export const SelectedAndRefused: Story = {
  args: {
    columnCount: 20,
    selected: ['company-1', 'company-2'],
    cellErrors: new Map([['company-0:domain', 'Another company already has this domain.']]),
  },
};

/** Calculations the screen worked out, under their columns. */
export const Footer: Story = {
  args: { footer: { employees: '1,234 avg', arr: 'USD 91,234,560 sum' } },
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
    await press(['{ArrowDown}', '{ArrowDown}', '{Enter}'], '0:8');
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

/** Resize from the column menu: Left and Right step the width, which is announced, and any other key leaves (AC-8). */
export const ResizeByKeyboard: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const press = presser((keys) => userEvent.keyboard(keys));
    const width = () => Number(/Domain, (\d+) pixels wide/.exec(canvas.getByRole('status').textContent)?.[1]);
    await userEvent.tab();
    await press(['{ArrowRight}'], '0:2');
    await press(['{ArrowUp}'], '-1:2');
    await press(['{Alt>}{ArrowDown}{/Alt}']);
    await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    await press(['{End}', '{Enter}'], '-1:2');
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
    await press(['{End}', '{ArrowUp}', '{Enter}'], '-1:2');
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
    await press(['{End}', '{ArrowUp}', '{ArrowUp}', '{Enter}'], '-1:2');
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
