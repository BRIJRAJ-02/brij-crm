import { useMemo, useState } from 'react';
import { Building2, CircleDot, Tag as TagIcon, User, DollarSign, MapPin } from 'lucide-react';
import { FilterBar, type Density, type FilterField, type FilterRule, type SortRule, type ViewColumn } from './FilterBar.tsx';

const fields: ReadonlyArray<FilterField> = [
  { id: 'stage', name: 'Stage', type: 'status', icon: CircleDot, options: [
    { id: 'lead', label: 'Lead', status: 'draft' }, { id: 'qualified', label: 'Qualified', status: 'progress' },
    { id: 'demo', label: 'Demo booked', status: 'review' }, { id: 'won', label: 'Won', status: 'done' }, { id: 'lost', label: 'Lost', status: 'failed' },
  ] },
  { id: 'segment', name: 'Segment', type: 'select', icon: TagIcon, options: [
    { id: 'smb', label: 'SMB', hue: 'sky' }, { id: 'mid', label: 'Mid-market', hue: 'purple' }, { id: 'ent', label: 'Enterprise', hue: 'orange' },
  ] },
  { id: 'owner', name: 'Owner', type: 'person', icon: User, options: ['Priya Raman', 'Sam Kim', 'Jo Mendes', 'Ava Chen', 'Maria Bell'].map((n) => ({ id: n, label: n })) },
  { id: 'name', name: 'Name', type: 'text', icon: Building2 },
  { id: 'city', name: 'City', type: 'text', icon: MapPin },
  { id: 'arr', name: 'ARR', type: 'number', icon: DollarSign },
];

// 32 companies, generated the same way every time, so the hidden count is real.
const NAMES = ['Acme Corp', 'Northwind', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Stark Labs', 'Wayne Freight'];
const CITIES = ['London', 'Berlin', 'Austin', 'Pune'];
const records = Array.from({ length: 32 }, (_, i) => ({
  name: `${NAMES[i % 8] ?? ''}${i >= 8 ? ` ${Math.floor(i / 8) + 1}` : ''}`,
  stage: ['lead', 'qualified', 'demo', 'won', 'lost'][(i * 3) % 5] ?? 'lead',
  segment: ['smb', 'mid', 'ent'][(i * 7) % 3] ?? 'smb',
  owner: ['Priya Raman', 'Sam Kim', 'Jo Mendes', 'Ava Chen', 'Maria Bell'][i % 5] ?? '',
  city: CITIES[i % 4] ?? '',
  arr: 4000 + ((i * 7919) % 120) * 1000,
}));
type Rec = (typeof records)[number];

function matches(r: Rec, f: FilterRule): boolean {
  const v = r[f.field as keyof Rec];
  if (f.operator === 'is empty') return v === '' || v === undefined;
  if (f.values.length === 0) return true;
  const first = f.values[0] ?? '';
  switch (f.operator) {
    case 'is': return f.values.some((x) => String(v).toLowerCase() === x.toLowerCase());
    case 'is not': return !f.values.includes(String(v));
    case 'contains': return String(v).toLowerCase().includes(first.toLowerCase());
    case 'is greater than': return Number(v) > Number(first);
    case 'is less than': return Number(v) < Number(first);
    default: return true;
  }
}

export function FilterBarDemo() {
  const [filters, setFilters] = useState<ReadonlyArray<FilterRule>>([
    { id: 'f1', field: 'stage', operator: 'is', values: ['qualified', 'demo'] },
    { id: 'f2', field: 'segment', operator: 'is not', values: ['smb'] },
  ]);
  const [sorts, setSorts] = useState<ReadonlyArray<SortRule>>([{ field: 'arr', direction: 'descending' }]);
  const [density, setDensity] = useState<Density>('comfortable');
  const [columns, setColumns] = useState<ReadonlyArray<ViewColumn>>([
    { id: 'name', name: 'Company', icon: Building2, isShown: true, isLocked: true },
    { id: 'stage', name: 'Stage', icon: CircleDot, isShown: true },
    { id: 'segment', name: 'Segment', icon: TagIcon, isShown: true },
    { id: 'owner', name: 'Owner', icon: User, isShown: true },
    { id: 'arr', name: 'ARR', icon: DollarSign, isShown: false },
    { id: 'city', name: 'City', icon: MapPin, isShown: false },
  ]);
  const visible = useMemo(() => records.filter((r) => filters.every((f) => matches(r, f))).length, [filters]);

  return (
    <div className="tf-demo tf-stack" style={{ minHeight: 200 }}>
      <FilterBar
        fields={fields}
        filters={filters}
        onFiltersChange={setFilters}
        sorts={sorts}
        onSortsChange={setSorts}
        columns={columns}
        onColumnsChange={setColumns}
        density={density}
        onDensityChange={setDensity}
        hiddenCount={records.length - visible}
        totalCount={records.length}
        noun="companies"
      />
      <p className="tf-faint" style={{ margin: 0, fontSize: 13 }}>
        Press any part of a chip to change it. {visible} of {records.length} companies match · {columns.filter((c) => c.isShown).length} columns · {density}.
      </p>
    </div>
  );
}
