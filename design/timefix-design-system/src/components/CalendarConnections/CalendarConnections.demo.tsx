import { useState } from 'react';
import { CalendarConnections, type CalendarAccount, type CalendarProvider } from './CalendarConnections.tsx';

const start: ReadonlyArray<CalendarAccount> = [
  { id: 'a1', provider: 'Google', email: 'priya@acme.com', calendars: 3, status: 'connected', checkConflicts: true },
  { id: 'a2', provider: 'Outlook', email: 'priya.raman@northwind.com', calendars: 1, status: 'reconnect', checkConflicts: true },
  { id: 'a3', provider: 'iCloud', email: 'priya.r@icloud.com', calendars: 2, status: 'connected', checkConflicts: false },
];
const wait = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });
const EMAILS: Readonly<Record<CalendarProvider, string>> = { Google: 'priya.personal@gmail.com', Outlook: 'priya@globex.com', iCloud: 'p.raman@icloud.com', CalDAV: 'priya@fastmail.com' };

export function CalendarConnectionsDemo() {
  const [accounts, setAccounts] = useState(start);
  return (
    <div className="tf-demo">
      <CalendarConnections
        accounts={accounts}
        onCheckConflicts={(id, on) => setAccounts((l) => l.map((a) => (a.id === id ? { ...a, checkConflicts: on } : a)))}
        onReconnect={async (id) => { await wait(1100); setAccounts((l) => l.map((a) => (a.id === id ? { ...a, status: 'connected' } : a))); }}
        onConnect={async (provider) => {
          await wait(1200);
          setAccounts((l) => [{ id: `n${l.length + 1}-${provider}`, provider, email: EMAILS[provider], calendars: 1, status: 'connected', checkConflicts: true }, ...l]);
        }}
      />
    </div>
  );
}
