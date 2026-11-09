import { useState } from 'react';
import { FastForward } from 'lucide-react';
import { TruncatedText, RelativeTime, Separator, VisuallyHidden, Path, useNow } from './Text.tsx';
import { Button } from '../Button/Button.tsx';
import './Text.demo.css';

const MIN = 60_000;
const COMPANIES = ['Acme Corp', 'Northwind Traders International Holdings', 'Globex', 'Initech Software Consulting Group'];

export function TextDemo() {
  const clock = useNow(5_000);
  const [skew, setSkew] = useState(0);
  const now = clock + skew;
  const [base] = useState(() => Date.now());
  const events = [
    { who: 'Priya Raman', what: 'booked Discovery call', at: base - 20_000 },
    { who: 'Sam Kim', what: 'submitted Contact us', at: base - 2 * MIN },
    { who: 'Jo Mendes', what: 'moved Northwind to Demo', at: base - 3 * 60 * MIN },
    { who: 'Ava Chen', what: 'cancelled Demo 45 min', at: base - 26 * 60 * MIN },
  ];
  return (
    <div className="tf-demo tf-text-demo">
      <div className="tf-stack">
        <p className="tf-demo-label">TruncatedText · hover or Tab to a cut name</p>
        <ul className="tf-text-demo__list">
          {COMPANIES.map((c) => <li key={c}><TruncatedText>{c}</TruncatedText></li>)}
        </ul>
        <p className="tf-demo-label">Path</p>
        <Path parts={['Company', 'Owner', 'Email']} />
        <Path parts={['Deal', 'Primary contact', 'Company', 'Country']} />
      </div>
      <Separator orientation="vertical" />
      <div className="tf-stack">
        <div className="tf-row" style={{ justifyContent: 'space-between' }}>
          <p className="tf-demo-label" style={{ margin: 0 }}>RelativeTime · live, exact time in the tooltip</p>
          <Button size="sm" variant="ghost" icon={<FastForward size={14} strokeWidth={1.75} />} onPress={() => setSkew((s) => s + 47 * MIN)}>Skip 47 min</Button>
        </div>
        <ul className="tf-text-demo__feed">
          {events.map((e) => (
            <li key={e.who}><span><strong>{e.who}</strong> <span className="tf-muted">{e.what}</span></span><span className="tf-faint"><RelativeTime value={e.at} now={now} /></span></li>
          ))}
        </ul>
        <Separator />
        <div className="tf-text-demo__signin">
          <Button variant="secondary">Continue with Google</Button>
          <Separator label="or" />
          <Button variant="secondary">Continue with email</Button>
        </div>
        <p className="tf-faint" style={{ margin: 0, fontSize: 13 }}>
          Press Tab from the top of this card: a <VisuallyHidden isFocusable isInline><a href="#main" className="tf-text-demo__skip">Skip to content</a></VisuallyHidden> skip link appears only while focused.
        </p>
      </div>
    </div>
  );
}
