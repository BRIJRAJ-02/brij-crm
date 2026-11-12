import { useEffect, useState } from 'react';
import { DEMO_BOOKING, DEMO_QUESTIONS, demoUpload } from '../HostedForm/HostedForm.demo.tsx';
import type { FormQuestion } from '../HostedForm/answers.ts';
import { FormCard, HostedFormPreview } from './FormPicture.tsx';

const FEEDBACK: ReadonlyArray<FormQuestion> = [
  { id: 'r', kind: 'rating', title: 'How was your Demo (45 min)?' },
  { id: 'w', kind: 'long', title: 'What should we improve?' },
];
const EVENT: ReadonlyArray<FormQuestion> = [
  { id: 'm', kind: 'multi', title: 'Which sessions will you join?', options: ['Keynote', 'Workshop', 'Dinner'] },
];
const wait = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

export function FormPictureDemo() {
  // A response lands every few seconds, so the count rolls.
  const [count, setCount] = useState(142);
  useEffect(() => { const t = window.setInterval(() => setCount((n) => n + 1), 3200); return () => window.clearInterval(t); }, []);
  return (
    <div className="tf-demo tf-demo--canvas tf-stack" style={{ gap: 'var(--space-24)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--space-12)' }}>
        <FormCard name="Work with Acme Corp" status="live" responses={count} updated="Edited 2h ago" questions={DEMO_QUESTIONS} onPress={() => undefined} />
        <FormCard name="Demo feedback" status="draft" responses={0} updated="Edited yesterday" questions={FEEDBACK} onPress={() => undefined} />
        <FormCard name="Northwind summit RSVP" status="closed" responses={1} updated="Closed 3 Nov" questions={EVENT} onPress={() => undefined} />
      </div>
      <HostedFormPreview
        address="timefix.com/f/acme-intake"
        title="Work with Acme Corp"
        description="Two minutes, then we send a proposal within a day."
        questions={DEMO_QUESTIONS.slice(0, 5)}
        booking={DEMO_BOOKING}
        onUpload={demoUpload}
        onSubmit={() => wait(700)}
      />
    </div>
  );
}
