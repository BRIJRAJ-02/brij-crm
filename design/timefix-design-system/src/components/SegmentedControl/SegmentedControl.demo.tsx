import { useState } from 'react';
import { Table2, Columns3, CalendarDays, List, LayoutGrid, Rows3 } from 'lucide-react';
import { SegmentedControl } from './SegmentedControl.tsx';

const i = { size: 16, strokeWidth: 1.75 } as const;
const s = { size: 14, strokeWidth: 1.75 } as const;

export function SegmentedControlDemo() {
  const [view, setView] = useState('board');
  const [clock, setClock] = useState('12h');
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-20)' }}>
      <div className="tf-row" style={{ gap: 'var(--space-24)' }}>
        <div className="tf-stack" style={{ gap: 0 }}>
          <p className="tf-demo-label">View switcher, md</p>
          <SegmentedControl aria-label="View" selectedKey={view} onSelectionChange={setView} items={[
            { id: 'table', label: 'Table', icon: <Table2 {...i} /> },
            { id: 'board', label: 'Board', icon: <Columns3 {...i} /> },
            { id: 'calendar', label: 'Calendar', icon: <CalendarDays {...i} /> },
          ]} />
        </div>
        <div className="tf-stack" style={{ gap: 0 }}>
          <p className="tf-demo-label">Icon only, sm</p>
          <SegmentedControl aria-label="Density" size="sm" defaultSelectedKey="list" items={[
            { id: 'list', icon: <List {...s} />, ariaLabel: 'List' },
            { id: 'grid', icon: <LayoutGrid {...s} />, ariaLabel: 'Grid' },
            { id: 'compact', icon: <Rows3 {...s} />, ariaLabel: 'Compact rows' },
          ]} />
        </div>
      </div>
      <div className="tf-row" style={{ gap: 'var(--space-24)' }}>
        <div className="tf-stack" style={{ gap: 0 }}>
          <p className="tf-demo-label">Ink, sm (booking page clock)</p>
          <SegmentedControl aria-label="Clock" size="sm" variant="ink" selectedKey={clock} onSelectionChange={setClock} items={[{ id: '12h', label: '12h' }, { id: '24h', label: '24h' }]} />
        </div>
        <div className="tf-stack" style={{ gap: 0 }}>
          <p className="tf-demo-label">With a disabled segment</p>
          <SegmentedControl aria-label="Period" defaultSelectedKey="week" items={[{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'year', label: 'Year', isDisabled: true }]} />
        </div>
      </div>
      <div style={{ maxWidth: 360 }}>
        <p className="tf-demo-label">Full width</p>
        <SegmentedControl aria-label="Who can book" isFullWidth defaultSelectedKey="anyone" items={[{ id: 'anyone', label: 'Anyone' }, { id: 'link', label: 'With the link' }, { id: 'team', label: 'Team only' }]} />
      </div>
    </div>
  );
}
