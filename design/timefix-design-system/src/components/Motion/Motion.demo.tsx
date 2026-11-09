import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { NumberRoll, TextSwap, TextMorph, SoftText, SuccessCheck, Spinner, Skeleton, DropIn, Collapse, IconSwap, ShimmerText, ThinkingLine } from './Motion.tsx';
import { Button } from '../Button/Button.tsx';

export function MotionDemo() {
  const [n, setN] = useState(1284);
  const [word, setWord] = useState(0);
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState(false);
  const [period, setPeriod] = useState(0);
  const [rows, setRows] = useState<ReadonlyArray<string>>(['Demo booked']);
  const [open, setOpen] = useState(true);
  const [swapped, setSwapped] = useState(false);
  const words = ['Booked', 'Rescheduled', 'Cancelled'];
  const events = ['Ava Chen joined', 'Form answered', 'Deal moved to Won', 'Discovery call booked'];
  const totals = ['$2,140', '$9,860', '$118,400'];
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-24)' }}>
      <div className="tf-stack"><p className="tf-demo-label">NumberRoll</p><span style={{ font: '500 30px/36px var(--font-sans)', letterSpacing: '-0.02em' }}><NumberRoll value={n} /></span>
        <div className="tf-row"><Button size="sm" variant="secondary" onPress={() => setN((v) => v + Math.ceil(Math.random() * 40))}>Add</Button><Button size="sm" variant="ghost" onPress={() => setN((v) => Math.max(0, v - 17))}>Remove</Button></div></div>
      <div className="tf-stack"><p className="tf-demo-label">TextSwap</p><span style={{ font: '500 18px/26px var(--font-sans)' }}><TextSwap swapKey={words[word] ?? ''}>{words[word]}</TextSwap></span>
        <div><Button size="sm" variant="secondary" onPress={() => setWord((w) => (w + 1) % words.length)}>Next state</Button></div></div>
      <div className="tf-stack"><p className="tf-demo-label">TextMorph</p><span style={{ font: '500 18px/26px var(--font-sans)' }}><TextMorph text={copied ? 'Copied' : 'Copy link'} /></span>
        <div><Button size="sm" variant="secondary" onPress={() => setCopied((c) => !c)}>Toggle</Button></div></div>
      <div className="tf-stack"><p className="tf-demo-label">SoftText</p><span style={{ font: '500 18px/26px var(--font-sans)' }}><SoftText>{totals[period] ?? ''}</SoftText> <span className="tf-faint">this {['week', 'month', 'year'][period]}</span></span>
        <div><Button size="sm" variant="secondary" onPress={() => setPeriod((p) => (p + 1) % totals.length)}>Next period</Button></div></div>
      <div className="tf-stack"><p className="tf-demo-label">SuccessCheck and Spinner</p><div className="tf-row" style={{ gap: 'var(--space-16)', color: 'var(--success)' }}><SuccessCheck key={tick} size={24} /><span style={{ color: 'var(--text-secondary)' }}><Spinner size={20} /></span></div>
        <div><Button size="sm" variant="secondary" onPress={() => setTick((t) => t + 1)}>Replay tick</Button></div></div>
      <div className="tf-stack"><p className="tf-demo-label">Skeleton</p>
        <div className="tf-row" style={{ flexWrap: 'nowrap' }}><Skeleton width={28} height={28} round /><div className="tf-stack" style={{ gap: 'var(--space-6)', flex: 1 }}><Skeleton width="70%" /><Skeleton width="45%" height={10} /></div></div>
        <div className="tf-row" style={{ flexWrap: 'nowrap' }}><Skeleton width={28} height={28} round /><div className="tf-stack" style={{ gap: 'var(--space-6)', flex: 1 }}><Skeleton width="60%" /><Skeleton width="35%" height={10} /></div></div></div>
      <div className="tf-stack"><p className="tf-demo-label">DropIn and Collapse</p>
        <div className="tf-stack" style={{ gap: 0 }}>
          {rows.map((r, i) => <DropIn key={r} animate={i === 0 && rows.length > 1}><span className="tf-faint" style={{ display: 'block', padding: 'var(--space-2) 0' }}>{r}</span></DropIn>)}
          <Collapse open={open}><span style={{ display: 'block', padding: 'var(--space-2) 0' }}>Notes from Priya</span></Collapse>
        </div>
        <div className="tf-row"><Button size="sm" variant="secondary" isDisabled={rows.length > events.length} onPress={() => setRows((l) => [events[l.length - 1] ?? 'Done', ...l])}>Add row</Button><Button size="sm" variant="ghost" onPress={() => setOpen((o) => !o)}>{open ? 'Collapse' : 'Expand'}</Button></div></div>
      <div className="tf-stack"><p className="tf-demo-label">IconSwap</p><span style={{ color: 'var(--text-secondary)' }}><IconSwap isB={swapped} a={<Copy size={20} strokeWidth={1.75} />} b={<Check size={20} strokeWidth={1.75} />} /></span>
        <div><Button size="sm" variant="secondary" onPress={() => setSwapped((v) => !v)}>Swap</Button></div></div>
      <div className="tf-stack"><p className="tf-demo-label">ShimmerText and ThinkingLine</p><ShimmerText>Saving…</ShimmerText>
        <ThinkingLine states={['Reading the Northwind deal', 'Checking recent emails', 'Writing a summary']} /></div>
    </div>
  );
}
