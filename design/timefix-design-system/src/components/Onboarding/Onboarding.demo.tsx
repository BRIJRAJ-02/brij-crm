import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { ToastProvider, useToast } from '../Toast/Toast.tsx';
import { Onboarding } from './Onboarding.tsx';

const TAKEN = new Set(['acme', 'northwind-sales', 'demo']);
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function Live() {
  const { toast } = useToast();
  const [run, setRun] = useState(0);
  return (
    <div className="tf-stack">
      <div className="tf-row" style={{ justifyContent: 'space-between' }}>
        <p className="tf-faint" style={{ margin: 0, fontSize: 13 }}>Type a workspace name and watch the preview. “acme” is a taken link.</p>
        <Button size="sm" variant="ghost" icon={<RotateCcw size={14} strokeWidth={1.75} />} onPress={() => setRun(run + 1)}>Start again</Button>
      </div>
      <div style={{ height: 640, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
        <Onboarding key={run} account="priya@northwind.com" owner="Priya Raman"
          checkSlug={async (slug) => { await wait(500); return !TAKEN.has(slug); }}
          onFinish={async (v) => { await wait(900); toast({ message: `${v.workspace} is ready at timefix.com/${v.slug}`, tone: 'success' }); }}
          onSignOut={() => toast({ message: 'Signed out (not really)' })} />
      </div>
    </div>
  );
}

export function OnboardingDemo() {
  return <ToastProvider><div className="tf-demo"><Live /></div></ToastProvider>;
}
