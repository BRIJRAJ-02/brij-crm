import { useMemo, useState } from 'react';
import type { Selection, SortDescriptor } from 'react-aria-components';
import { Building2, CircleDot, Tag as TagIcon, User, Users, Calendar, DollarSign } from 'lucide-react';
import { DataGrid, type GridColumn, type GridRecord } from './DataGrid.tsx';
import { Button } from '../Button/Button.tsx';

const columns: ReadonlyArray<GridColumn> = [
  { id: 'name', name: 'Company', type: 'name', icon: Building2, width: 200, minWidth: 140 },
  { id: 'stage', name: 'Stage', type: 'status', icon: CircleDot, width: 150, options: [
    { id: 'lead', label: 'Lead', status: 'draft' }, { id: 'qualified', label: 'Qualified', status: 'progress' },
    { id: 'demo', label: 'Demo booked', status: 'review' }, { id: 'won', label: 'Won', status: 'done' }, { id: 'lost', label: 'Lost', status: 'failed' },
  ] },
  { id: 'segment', name: 'Segment', type: 'select', icon: TagIcon, width: 130, options: [
    { id: 'smb', label: 'SMB', hue: 'sky' }, { id: 'mid', label: 'Mid-market', hue: 'purple' }, { id: 'ent', label: 'Enterprise', hue: 'orange' },
  ] },
  { id: 'owner', name: 'Owner', type: 'person', icon: User, width: 150, isReadOnly: true },
  { id: 'arr', name: 'ARR', type: 'number', icon: DollarSign, width: 110 },
  { id: 'seats', name: 'Seats', type: 'number', icon: Users, width: 90 },
  { id: 'next', name: 'Next meeting', type: 'date', icon: Calendar, width: 150, isReadOnly: true },
];

const seed: ReadonlyArray<GridRecord> = [
  { id: 'acme', values: { name: 'Acme Corp', stage: 'qualified', segment: 'mid', owner: 'Priya Raman', arr: 48200, seats: 40, next: '2026-11-12' } },
  { id: 'northwind', values: { name: 'Northwind', stage: 'demo', segment: 'ent', owner: 'Sam Kim', arr: 126000, seats: 180, next: '2026-11-16' } },
  { id: 'globex', values: { name: 'Globex', stage: 'lead', segment: 'smb', owner: 'Jo Mendes', arr: 9600, seats: 8 } },
  { id: 'initech', values: { name: 'Initech', stage: 'won', segment: 'mid', owner: 'Ava Chen', arr: 61500, seats: 52, next: '2026-11-12' } },
  { id: 'umbrella', values: { name: 'Umbrella Health', stage: 'lost', segment: 'ent', owner: 'Maria Bell', arr: 0, seats: 0 } },
];

export function DataGridDemo() {
  const [rows, setRows] = useState(seed);
  const [sort, setSort] = useState<SortDescriptor>({ column: 'arr', direction: 'descending' });
  const [selected, setSelected] = useState<Selection>(new Set(['northwind']));
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);

  const sorted = useMemo(() => {
    const col = String(sort.column);
    const dir = sort.direction === 'descending' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const x = a.values[col] ?? '';
      const y = b.values[col] ?? '';
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }, [rows, sort]);

  const reload = () => { setLoading(true); window.setTimeout(() => setLoading(false), 1400); };
  const count = selected === 'all' ? rows.length : selected.size;

  return (
    <div className="tf-demo tf-stack">
      <div className="tf-row">
        <Button size="sm" onPress={reload} isDisabled={loading}>Reload</Button>
        <Button size="sm" variant={empty ? 'soft' : 'ghost'} onPress={() => setEmpty((e) => !e)}>{empty ? 'Show rows' : 'Show empty'}</Button>
        <span className="tf-faint" style={{ fontSize: 13 }}>
          {count > 0 ? `${count} selected · ` : ''}Double-click or press Enter on a cell to edit it.
        </span>
      </div>
      <DataGrid
        label="Companies"
        columns={columns}
        rows={empty ? [] : sorted}
        sortDescriptor={sort}
        onSortChange={setSort}
        selectedKeys={selected}
        onSelectionChange={setSelected}
        isLoading={loading}
        emptyState="No companies match these filters."
        onCellChange={(rowId, colId, value) => setRows((rs) => rs.map((r) => {
          if (r.id !== rowId) return r;
          const col = columns.find((c) => c.id === colId);
          const n = Number(value.replace(/[^0-9.]/g, ''));
          return { ...r, values: { ...r.values, [colId]: col?.type === 'number' ? (Number.isFinite(n) ? n : 0) : value } };
        }))}
        onAddRow={() => {
          const id = `new-${Date.now()}`;
          setRows((rs) => [...rs, { id, values: { name: 'Untitled company', stage: 'lead' } }]);
          setSort({ column: 'name', direction: 'ascending' });
          return id;
        }}
        addLabel="New company"
      />
    </div>
  );
}
