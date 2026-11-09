import { useState } from 'react';
import { Button } from '../Button/Button.tsx';
import { Callout } from './Callout.tsx';

export function CalloutDemo() {
  const [shown, setShown] = useState(true);
  const [log, setLog] = useState('');
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-12)', alignItems: 'start' }}>
      <div className="tf-stack" style={{ gap: 'var(--space-8)' }}>
        <Callout tone="info">Guests see times in their own time zone.</Callout>
        <Callout tone="success" title="Google Calendar connected">New bookings land on priya@northwind.com.</Callout>
        <Callout tone="neutral">Tip: press <strong>N</strong> anywhere to start a new meeting.</Callout>
      </div>
      <div className="tf-stack" style={{ gap: 'var(--space-8)' }}>
        <Callout tone="danger" title="Outlook stopped syncing" action={{ label: 'Reconnect', onPress: () => setLog('Opening Outlook…') }}>
          Guests may book over meetings until you sign in again.
        </Callout>
        {shown ? (
          <Callout tone="warning" onDismiss={() => setShown(false)} action={{ label: 'See plans', onPress: () => setLog('Opening plans…') }}>
            You've used 820 of 1,000 bookings this month.
          </Callout>
        ) : (
          <div><Button size="sm" variant="ghost" onPress={() => setShown(true)}>Show the warning again</Button></div>
        )}
        <span className="tf-faint" style={{ fontSize: 13 }} aria-live="polite">{log}</span>
      </div>
    </div>
  );
}
