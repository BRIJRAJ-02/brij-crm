import { useState } from 'react';
import { Button } from '../Button/Button.tsx';
import { Steps } from './Steps.tsx';

const flow = [
  { id: 'details', label: 'Details' }, { id: 'times', label: 'Availability' },
  { id: 'questions', label: 'Questions' }, { id: 'confirm', label: 'Confirm' },
];
const setup = [
  { id: 'cal', label: 'Connect your calendar', description: 'Google Calendar, so guests never book over a meeting.' },
  { id: 'page', label: 'Create a booking page', description: 'Discovery call, 30 min.' },
  { id: 'share', label: 'Share your link', description: 'Paste it in your email signature.' },
];

export function StepsDemo() {
  const [at, setAt] = useState(1);
  const [v, setV] = useState(1);
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 'var(--space-32)' }}>
      <div className="tf-stack" style={{ gap: 'var(--space-20)' }}>
        <p className="tf-demo-label" style={{ margin: 0 }}>Horizontal, done steps go back</p>
        <Steps aria-label="New booking page" steps={flow} current={at} onStepPress={setAt} />
        <div className="tf-row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" isDisabled={at === 0} onPress={() => setAt(at - 1)}>Back</Button>
          <Button variant="primary" onPress={() => setAt(at >= flow.length ? 0 : at + 1)}>{at >= flow.length ? 'Start again' : at === flow.length - 1 ? 'Create page' : 'Continue'}</Button>
        </div>
      </div>
      <div className="tf-stack">
        <p className="tf-demo-label" style={{ margin: 0 }}>Vertical</p>
        <Steps aria-label="Get started" orientation="vertical" steps={setup} current={v} />
        <div><Button size="sm" onPress={() => setV(v >= setup.length ? 0 : v + 1)}>{v >= setup.length ? 'Reset' : 'Mark step done'}</Button></div>
      </div>
    </div>
  );
}
