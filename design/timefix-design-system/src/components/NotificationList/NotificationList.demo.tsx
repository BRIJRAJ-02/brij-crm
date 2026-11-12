import { useState } from 'react';
import { Plus } from 'lucide-react';
import { NotificationList, NotificationBell, type Notification } from './NotificationList.tsx';
import { Button } from '../Button/Button.tsx';

const start: ReadonlyArray<Notification> = [
  { id: 'n1', actor: 'Sam Kim', action: 'mentioned you on', object: 'Acme Corp', excerpt: 'Can you send the one-depot pricing before Thursday?', time: '12m', group: 'Today', read: false },
  { id: 'n2', actor: 'Maria Bell', action: 'booked', object: 'Demo · 45 min', excerpt: 'Thu 13 Nov, 14:00 to 14:45 · Google Meet', time: '1h', group: 'Today', read: false },
  { id: 'n3', actor: 'Jo Mendes', action: 'assigned you', object: 'Follow up with Maria about SSO', time: '3h', group: 'Today', read: true },
  { id: 'n4', actor: 'Ava Chen', action: 'replied on', object: 'Globex', excerpt: 'Their budget opens in January, let us park it until then.', time: 'Mon', group: 'Earlier', read: true },
  { id: 'n5', actor: 'Priya Raman', action: 'submitted', object: 'Pilot request form', time: 'Sun', group: 'Earlier', read: false },
];
const incoming: ReadonlyArray<Pick<Notification, 'actor' | 'action' | 'object' | 'excerpt'>> = [
  { actor: 'Maria Bell', action: 'commented on', object: 'Northwind', excerpt: 'They signed the pilot.' },
  { actor: 'Sam Kim', action: 'mentioned you on', object: 'Initech', excerpt: 'Worth a win-back call?' },
];

export function NotificationListDemo() {
  const [items, setItems] = useState(start);
  const [k, setK] = useState(0);
  const unread = items.filter((n) => !n.read).length;
  const list = (
    <NotificationList items={items}
      onOpen={(id) => setItems((l) => l.map((n) => (n.id === id ? { ...n, read: true } : n)))}
      onReadChange={(id, read) => setItems((l) => l.map((n) => (n.id === id ? { ...n, read } : n)))}
      onReadAll={() => setItems((l) => l.map((n) => ({ ...n, read: true })))}
      onArchive={(id) => setItems((l) => l.filter((n) => n.id !== id))} />
  );
  return (
    <div className="tf-demo">
      <div className="tf-inbox-demo">
        <div className="tf-inbox-demo__bar">
          <Button size="sm" variant="secondary" icon={<Plus size={14} strokeWidth={1.75} />}
            onPress={() => { const s = incoming[k % incoming.length]; if (s) setItems((l) => [{ ...s, id: `x${k}`, time: 'now', group: 'Today', read: false }, ...l]); setK(k + 1); }}>Simulate a new one</Button>
          <NotificationBell count={unread}>{list}</NotificationBell>
        </div>
        {list}
      </div>
    </div>
  );
}
