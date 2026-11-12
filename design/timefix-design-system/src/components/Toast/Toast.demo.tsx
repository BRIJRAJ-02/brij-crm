import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { SuccessCheck } from '../Motion/Motion.tsx';
import { ToastProvider, useToast } from './Toast.tsx';

const stack = ['Booking confirmed with Ava Chen', 'Discovery call moved to 3:30 PM', 'Link copied'];

function Live() {
  const { toast } = useToast();
  const [people, setPeople] = useState(['Priya Raman', 'Sam Kim', 'Jo Mendes', 'Maria Bell']);
  const remove = (name: string) => {
    const at = people.indexOf(name);
    setPeople((p) => p.filter((x) => x !== name));
    toast({ message: `${name} deleted`, tone: 'success', action: { label: 'Undo', onAction: () => setPeople((p) => (p.includes(name) ? p : [...p.slice(0, at), name, ...p.slice(at)])) } });
  };
  return (
    <div className="tf-stack">
      <p className="tf-demo-label" style={{ margin: 0 }}>Live (bottom centre of the window)</p>
      <div className="tf-row">
        <Button variant="primary" onPress={() => toast({ message: 'Changes saved', tone: 'success' })}>Save changes</Button>
        <Button onPress={() => toast({ message: 'Link copied' })}>Copy link</Button>
        <Button onPress={() => toast({ message: "Couldn't reach Google Calendar. Try again in a minute.", tone: 'danger' })}>Fail a sync</Button>
        <Button variant="ghost" onPress={() => stack.forEach((m, k) => window.setTimeout(() => toast({ message: m, tone: k === 2 ? 'neutral' : 'success' }), k * 300))}>Send three</Button>
      </div>
      <div className="tf-row">
        {people.map((p) => <Button key={p} size="sm" variant="soft" iconEnd={<X size={14} strokeWidth={1.75} />} onPress={() => remove(p)}>{p}</Button>)}
        {people.length === 0 && <span className="tf-faint" style={{ fontSize: 13 }}>Everyone deleted. Undo brings them back.</span>}
      </div>
    </div>
  );
}

export function ToastDemo() {
  return (
    <ToastProvider>
      <div className="tf-demo tf-demo--canvas" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-24)', alignItems: 'end' }}>
        <div className="tf-stack">
          <p className="tf-demo-label" style={{ margin: 0 }}>A stack of three, in place (hover to spread)</p>
          <div className="tf-toast-stage">
            {[2, 1, 0].map((d) => (
              <div key={d} className="tf-toast" data-depth={String(d)} data-tone={d === 0 ? 'success' : 'neutral'}>
                {d === 0 && <span className="tf-toast__icon"><SuccessCheck size={16} /></span>}
                <span className="tf-toast__content"><span>{d === 0 ? 'Jo Mendes deleted' : d === 1 ? 'Link copied' : 'Changes saved'}</span></span>
                {d === 0 && <span className="tf-barbtn tf-barbtn--solid tf-barbtn--sm">Undo</span>}
                <span className="tf-barbtn tf-barbtn--ghost tf-barbtn--sm tf-barbtn--icon"><X size={14} strokeWidth={1.75} /></span>
              </div>
            ))}
          </div>
        </div>
        <Live />
      </div>
    </ToastProvider>
  );
}
