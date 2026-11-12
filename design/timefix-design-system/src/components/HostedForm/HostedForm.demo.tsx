import { getLocalTimeZone, today as todayIn, type CalendarDate } from '@internationalized/date';
import { useState } from 'react';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { HostedForm, type BookingSource, type FormQuestion, type HostedFormMode, type QuestionKind } from './HostedForm.tsx';

const wait = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

/** The Acme Corp intake form: every answer type, in the order a real form would ask them. */
export const DEMO_QUESTIONS: ReadonlyArray<FormQuestion> = [
  { id: 'name', kind: 'short', title: 'What should we call you?', required: true, placeholder: 'Priya Raman' },
  { id: 'email', kind: 'email', title: 'Your work email', description: 'We send the proposal here.', required: true },
  { id: 'team', kind: 'choice', title: 'How big is your team?', required: true, options: ['Just me', '2 to 10', '11 to 50', 'More than 50'] },
  { id: 'needs', kind: 'multi', title: 'What do you want to run on Timefix?', options: ['Scheduling', 'Forms', 'Link pages', 'CRM'] },
  { id: 'source', kind: 'dropdown', title: 'Where did you hear about us?', options: ['A friend', 'Search', 'LinkedIn', 'A podcast', 'Product Hunt', 'Somewhere else'] },
  { id: 'phone', kind: 'phone', title: 'A number we can call' },
  { id: 'rating', kind: 'rating', title: 'How was your last demo?' },
  { id: 'start', kind: 'date', title: 'When would you like to start?' },
  { id: 'brief', kind: 'long', title: 'Anything we should read first?' },
  { id: 'files', kind: 'file', title: 'Attach a brief or a logo' },
  { id: 'address', kind: 'address', title: 'Where should the invoice go?' },
  { id: 'rank', kind: 'ranking', title: 'Rank what matters most', options: ['Price', 'Support', 'Integrations', 'Ease of use'] },
  { id: 'sign', kind: 'signature', title: 'Sign to accept the terms', required: true },
  { id: 'call', kind: 'booking', title: 'Book a Discovery call (30 min)', description: 'With Priya Raman on Google Meet.' },
];

const seed = (d: CalendarDate) => d.year * 400 + d.month * 31 + d.day;
const weekday = (d: CalendarDate) => new Date(d.year, d.month - 1, d.day).getDay();
const isDayOpen = (d: CalendarDate) => weekday(d) !== 0 && weekday(d) !== 6 && seed(d) % 4 !== 0;
/** Weekday slots 9:00 to 4:30, a few taken by a stable hash. */
export const DEMO_BOOKING: BookingSource = {
  durationMinutes: 30,
  today: todayIn(getLocalTimeZone()),
  isDayOpen,
  slotsFor: (d) => {
    if (!isDayOpen(d)) return [];
    const out: number[] = [];
    for (let m = 9 * 60; m <= 16 * 60 + 30; m += 30) if ((seed(d) + m / 30) % 5 !== 0 && m !== 13 * 60) out.push(m);
    return out;
  },
};

/** Pretend upload: a little every 200ms until it lands. */
export const demoUpload = (_file: File, onProgress: (p: number) => void) => new Promise<void>((resolve) => {
  let p = 0;
  const t = window.setInterval(() => {
    p += 10 + Math.random() * 18;
    if (p >= 100) { window.clearInterval(t); resolve(); } else onProgress(p);
  }, 200);
});

export function HostedFormDemo() {
  const [mode, setMode] = useState<HostedFormMode>('one');
  const [kind, setKind] = useState<'all' | QuestionKind>('all');
  const [run, setRun] = useState(0);
  const questions = kind === 'all' ? DEMO_QUESTIONS : DEMO_QUESTIONS.filter((q) => q.kind === kind || q.id === 'name');
  return (
    <div className="tf-demo tf-demo--canvas tf-stack" style={{ gap: 'var(--space-16)' }}>
      <div className="tf-row" style={{ justifyContent: 'space-between' }}>
        <SegmentedControl aria-label="Layout" size="sm" selectedKey={mode} onSelectionChange={(k) => { setMode(k === 'page' ? 'page' : 'one'); setRun((n) => n + 1); }}
          items={[{ id: 'one', label: 'One at a time' }, { id: 'page', label: 'All on one page' }]} />
        <SegmentedControl aria-label="Questions" size="sm" selectedKey={kind} onSelectionChange={(k) => { setKind(k === 'all' ? 'all' : (k as QuestionKind)); setRun((n) => n + 1); }}
          items={[{ id: 'all', label: 'Every type' }, { id: 'booking', label: 'Booking' }, { id: 'ranking', label: 'Ranking' }, { id: 'signature', label: 'Signature' }]} />
      </div>
      <HostedForm
        key={`${mode}-${kind}-${run}`}
        mode={mode}
        title="Work with Acme Corp"
        description="Two minutes, then we send a proposal within a day."
        questions={questions}
        booking={DEMO_BOOKING}
        onUpload={demoUpload}
        onSubmit={() => wait(900)}
        onFinishLater={async () => { await wait(600); return 'https://timefix.com/f/acme-intake?resume=7f3a'; }}
      />
    </div>
  );
}
