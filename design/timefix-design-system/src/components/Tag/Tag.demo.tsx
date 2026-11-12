import { useState } from 'react';
import { Send, Sparkles, Zap } from 'lucide-react';
import { Tag, StatusDot, Count } from './Tag.tsx';
import { NumberRoll } from '../Motion/Motion.tsx';
import { Button } from '../Button/Button.tsx';
import type { StatusShape } from '../Icon/StatusIcon.tsx';

const flow: ReadonlyArray<[StatusShape, string]> = [['draft', 'Draft'], ['progress', 'In progress'], ['review', 'In review'], ['done', 'Completed']];

export function TagDemo() {
  const [step, setStep] = useState(0);
  const [n, setN] = useState(3);
  const [shape, label] = flow[step] ?? flow[0]!;
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-16)' }}>
      <div className="tf-row">
        <Tag status="draft">Draft</Tag><Tag status="progress">In progress</Tag><Tag status="review">In review</Tag><Tag status="done">Completed</Tag>
        <Tag status="failed">Failed</Tag><Tag status="waiting">Expired</Tag><Tag hue="purple" icon={<Send size={14} strokeWidth={2} />}>Submitted</Tag>
      </div>
      <div className="tf-row">
        <Tag size="sm" hue="sky">Partner</Tag><Tag size="sm" hue="lime">SMB</Tag><Tag size="sm" hue="yellow">Trial</Tag>
        <Tag size="sm" hue="purple" icon={<Sparkles size={12} strokeWidth={2} />}>AI enriched</Tag><Tag size="sm" outline>$20,000</Tag>
        <Tag size="sm" hue="purple" icon={<Zap size={12} strokeWidth={2} />}>Pro</Tag>
      </div>
      <div className="tf-row">
        <Tag size="pill" status="waiting" hue="orange">Waiting</Tag><Tag size="pill" status="done">Accepted</Tag><Tag size="pill" status="failed">Declined</Tag>
        <span style={{ width: 'var(--space-12)' }} /><StatusDot hue="green">Active · day 41</StatusDot><StatusDot hue="orange">Stalled</StatusDot>
      </div>
      <div className="tf-row" style={{ gap: 'var(--space-12)' }}>
        <Button size="sm" onPress={() => setStep((s) => (s + 1) % flow.length)}>Advance status</Button>
        <span key={shape} className="tf-tag-pop"><Tag status={shape}>{label}</Tag></span>
        <Button size="sm" variant="ghost" onPress={() => setN((v) => v + 1)}>New conflict</Button>
        <Count tone="accent"><NumberRoll value={n} /></Count><Count>12</Count><Count tone="ink">4</Count>
      </div>
    </div>
  );
}
