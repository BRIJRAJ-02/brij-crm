import { useState } from 'react';
import { CalendarPlus, Copy, RotateCw } from 'lucide-react';
import { MeetingCard, MeetingList, type Meeting, type MeetingStatus } from './MeetingList.tsx';
import { Button } from '../Button/Button.tsx';

const NOW = new Date(2026, 10, 11, 11, 40);
const at = (day: number, h: number, m: number) => new Date(2026, 10, day, h, m);
const seed: ReadonlyArray<Meeting> = [
  { id: 'm1', start: at(11, 9, 30), end: at(11, 10, 0), title: 'Discovery call', invitee: { name: 'Sam Kim', email: 'sam@northwind.com' }, place: 'video', placeLabel: 'Google Meet', status: 'completed' },
  { id: 'm2', start: at(11, 10, 30), end: at(11, 11, 15), title: 'Demo', invitee: { name: 'Ava Chen', email: 'ava@globex.com' }, place: 'video', placeLabel: 'Zoom', status: 'no-show' },
  { id: 'm3', start: at(11, 13, 0), end: at(11, 13, 30), title: 'Discovery call', invitee: { name: 'Jo Mendes', email: 'jo@initech.io' }, place: 'phone', placeLabel: 'Phone call', status: 'confirmed' },
  { id: 'm4', start: at(11, 15, 0), end: at(11, 15, 45), title: 'Demo', invitee: { name: 'Maria Bell', email: 'maria@acme.com' }, guests: ['Priya Raman'], place: 'video', placeLabel: 'Google Meet', status: 'pending' },
  { id: 'm5', start: at(12, 10, 0), end: at(12, 11, 0), title: 'Site visit', invitee: { name: 'Priya Raman', email: 'priya@acme.com' }, place: 'in-person', placeLabel: '12 Harbour Street', status: 'confirmed' },
  { id: 'm6', start: at(12, 16, 30), end: at(12, 17, 0), title: 'Renewal check-in', invitee: { name: 'Sam Kim', email: 'sam@northwind.com' }, place: 'video', placeLabel: 'Google Meet', status: 'confirmed' },
  { id: 'm7', start: at(14, 9, 0), end: at(14, 9, 30), title: 'Discovery call', invitee: { name: 'Ava Chen', email: 'ava@globex.com' }, place: 'video', placeLabel: 'Google Meet', status: 'confirmed' },
];

export function MeetingListDemo() {
  const [list, setList] = useState(seed);
  const [prior, setPrior] = useState<Readonly<Record<string, MeetingStatus>>>({});
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [opened, setOpened] = useState<string>();
  const [fresh, setFresh] = useState<string>();
  const book = () => {
    const id = `new-${list.length}`;
    const m: Meeting = { id, start: at(12, 13, 0), end: at(12, 13, 30), title: 'Discovery call', invitee: { name: 'Maria Bell', email: 'maria@acme.com' }, place: 'video', placeLabel: 'Google Meet', status: 'confirmed' };
    setList((l) => [...l, m].sort((a, b) => a.start.getTime() - b.start.getTime()));
    setFresh(id);
    window.setTimeout(() => setFresh(undefined), 1600);
  };
  const setStatus = (id: string, status: MeetingStatus) => setList((l) => l.map((m) => (m.id === id ? { ...m, status } : m)));
  const refresh = () => { setLoading(true); window.setTimeout(() => setLoading(false), 1000); };
  const first = list[2] ?? seed[2];
  const second = list[4] ?? seed[4];
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-20)' }}>
      <div className="tf-row">
        <Button size="sm" icon={<RotateCw size={14} strokeWidth={1.75} />} onPress={refresh}>Refresh</Button>
        <Button size="sm" icon={<CalendarPlus size={14} strokeWidth={1.75} />} onPress={book} isDisabled={empty}>New booking</Button>
        <Button size="sm" variant="ghost" onPress={() => setEmpty((v) => !v)}>{empty ? 'Show meetings' : 'Show empty'}</Button>
        <span className="tf-muted" style={{ fontSize: 13 }} role="status">{opened ? `Opened ${opened}` : 'Click a row, or Tab to it and press Enter.'}</span>
      </div>
      <p className="tf-demo-label" style={{ margin: 0 }}>List</p>
      <div style={{ maxHeight: 340, overflowY: 'auto', marginTop: 'calc(var(--space-12) * -1)' }}>
        <MeetingList meetings={empty ? [] : list} now={NOW} loading={loading} highlightId={fresh}
          onOpen={(m) => setOpened(`${m.title} with ${m.invitee.name}`)}
          onCancel={(m) => { setPrior((p) => ({ ...p, [m.id]: m.status })); setStatus(m.id, 'cancelled'); }}
          onUndoCancel={(m) => setStatus(m.id, prior[m.id] ?? 'confirmed')}
          onNoShow={(m) => setStatus(m.id, 'no-show')}
          onConfirm={(m) => setStatus(m.id, 'confirmed')} onDecline={(m) => setStatus(m.id, 'cancelled')}
          emptyAction={<Button size="sm" icon={<Copy size={14} strokeWidth={1.75} />}>Copy booking link</Button>} />
      </div>
      <section aria-label="Card variant">
      <p className="tf-demo-label">Card variant</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 320px))', gap: 'var(--space-16)' }}>
        {first && <MeetingCard meeting={first} strip={{ tone: 'success', text: 'Today, in 1 h 20 min', action: 'Join meeting' }} />}
        {second && <MeetingCard meeting={second} strip={{ tone: 'warning', text: '2 conflicted', action: 'See conflict' }} />}
      </div>
      </section>
    </div>
  );
}
