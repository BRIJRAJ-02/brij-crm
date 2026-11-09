import { useState } from 'react';
import { AIAssist, AITag, AIMark } from './AIAssist.tsx';
import { ShimmerText, ThinkingLine } from '../Motion/Motion.tsx';

const answers: Readonly<Record<string, string>> = {
  'Summarise this company': 'Acme Corp is a London logistics software company with about 1,240 people. They are Qualified: Sam ran a 45 minute demo on Tuesday, and Priya is preparing pricing for a one-depot pilot in Leeds. Open risk: their IT team still needs SSO details.',
  'What changed this week?': 'Stage moved from Lead to Qualified, deal value rose from $30,000 to $48,000, and the owner changed to Sam Kim. Two emails went out and a demo is booked for Thursday at 14:00.',
};

export function AIAssistDemo() {
  const [saved, setSaved] = useState(0);
  return (
    <div className="tf-demo tf-demo--canvas" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 'var(--space-16)' }}>
      <AIAssist context="Acme Corp" suggestions={['Summarise this company', 'What changed this week?', 'Draft a follow-up email', 'Who should I talk to next?']}
        thinking={['Reading the timeline', 'Checking 3 notes and 2 emails', 'Writing the answer']}
        onAsk={(q) => new Promise((r) => window.setTimeout(() => r(answers[q] ?? `Here is a short answer about "${q}": Priya Raman is the champion, Maria Bell signs, and the next step is the Thursday demo with Sam Kim.`), 3200))}
        onInsertNote={() => setSaved((n) => n + 1)} />
      <div className="tf-stack">
        <p className="tf-demo-label">AI marks</p>
        <span className="tf-row"><AITag /><AITag>Series B</AITag></span>
        <span className="tf-row" style={{ fontSize: 14 }}>acme.com <AIMark /></span>
        <p className="tf-demo-label">Thinking</p>
        <span className="tf-row" style={{ fontSize: 13 }}><AIMark /><ThinkingLine states={['Finding the company', 'Reading their website', 'Filling 6 attributes']} /></span>
        <span style={{ fontSize: 13 }}><ShimmerText>Enriching 24 records…</ShimmerText></span>
        {saved > 0 && <p className="tf-faint" style={{ fontSize: 13, margin: 0 }}>Saved {saved} answer{saved > 1 ? 's' : ''} as notes.</p>}
      </div>
    </div>
  );
}
