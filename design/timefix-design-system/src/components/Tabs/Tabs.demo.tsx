import { useState } from 'react';
import { LayoutGrid, Activity, Mail, StickyNote, CheckSquare, Paperclip, CalendarDays, Users } from 'lucide-react';
import { Tabs, TabPanel, type TabItem } from './Tabs.tsx';

const i = { size: 16, strokeWidth: 1.75 } as const;
const record: ReadonlyArray<TabItem> = [
  { id: 'overview', label: 'Overview', icon: <LayoutGrid {...i} /> },
  { id: 'activity', label: 'Activity', icon: <Activity {...i} /> },
  { id: 'emails', label: 'Emails', icon: <Mail {...i} />, count: 12 },
  { id: 'notes', label: 'Notes', icon: <StickyNote {...i} />, count: 3 },
  { id: 'tasks', label: 'Tasks', icon: <CheckSquare {...i} />, count: 1 },
  { id: 'files', label: 'Files', icon: <Paperclip {...i} />, isDisabled: true },
];
const copy: Readonly<Record<string, string>> = {
  overview: 'Acme Corp · 240 employees · Owner Priya Raman',
  activity: 'Sam Kim changed Stage from Lead to Qualified · 2h ago',
  emails: '12 emails with Acme Corp, the last from Jo Mendes yesterday.',
  notes: '3 notes, the newest: "Wants a demo for the ops team."',
  tasks: '1 open task: Send the proposal to Acme, due Friday.',
  files: '',
};
const meetings: ReadonlyArray<TabItem> = [
  { id: 'upcoming', label: 'Upcoming', icon: <CalendarDays {...i} />, count: 8 },
  { id: 'unconfirmed', label: 'Unconfirmed', count: 2 },
  { id: 'recurring', label: 'Recurring' },
  { id: 'past', label: 'Past', count: 1284 },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'team', label: 'Team', icon: <Users {...i} /> },
];

export function TabsDemo() {
  const [tab, setTab] = useState('emails');
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-24)' }}>
      <div>
        <p className="tf-demo-label">Record tabs with icons and counts</p>
        <Tabs aria-label="Acme Corp" items={record} selectedKey={tab} onSelectionChange={setTab}>
          {record.map((t) => <TabPanel key={t.id} id={t.id}><span className="tf-muted">{copy[t.id]}</span></TabPanel>)}
        </Tabs>
      </div>
      <div style={{ maxWidth: 340 }}>
        <p className="tf-demo-label">Overflow scrolls (340px wide)</p>
        <Tabs aria-label="Bookings" items={meetings} defaultSelectedKey="past" />
      </div>
    </div>
  );
}
