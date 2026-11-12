import { useState } from 'react';
import { Link, LearnMoreLink } from './Link.tsx';

export function LinkDemo() {
  const [n, setN] = useState(0);
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-16)', maxWidth: 'var(--size-measure)' }}>
      <p style={{ margin: 0 }}>
        Guests pick a time on <Link href="/booking/discovery-call">Discovery call</Link>, and the invite goes to the host in{' '}
        <Link href="https://calendar.google.com">Google Calendar</Link>. Questions? Write to <Link href="mailto:hello@timefix.com">hello@timefix.com</Link>.
      </p>
      <p className="tf-muted" style={{ margin: 0, fontSize: 13 }}>
        Contact us · <Link variant="muted" href="/forms/contact-us/submissions" label="12 submissions to Contact us">12 submissions</Link> · edited by{' '}
        <Link variant="muted" href="/people/priya-raman">Priya Raman</Link>
      </p>
      <div className="tf-row" style={{ gap: 'var(--space-24)' }}>
        <LearnMoreLink href="#booking-pages" />
        <LearnMoreLink onPress={() => setN((v) => v + 1)}>See all meetings</LearnMoreLink>
        <Link weight="strong" onPress={() => setN((v) => v + 1)}>Resend invite</Link>
        <span className="tf-faint tf-num" style={{ fontSize: 13 }} aria-live="polite">Pressed {n}</span>
      </div>
      <p className="tf-faint" style={{ margin: 0, fontSize: 13 }}>
        A <Link href="javascript:alert(1)">javascript: link</Link> renders as plain text.
      </p>
    </div>
  );
}
