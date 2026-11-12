// The link page inside a partner's app (spec 0070): the partner's own page around our frame. The frame opens on its start screen, then
// draws the link page screen without the sidebar, the workspace menu or any way into the rest of Timefix. Its own states: timed out,
// session ended, and a browser that blocked sign in. Reached from the Demo menu; nothing here talks to a real partner.
import { useEffect, useState } from 'react';
import { BarChart3, Home, LayoutGrid, LogOut, Megaphone, ShieldAlert, TimerOff, Users, X } from 'lucide-react';
import { FullScreenDialog } from '../Dialog/Dialog.tsx';
import { Button } from '../Button/Button.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { Spinner } from '../Motion/Motion.tsx';
import { useToast } from '../Toast/Toast.tsx';
import type { BookingsState } from '../BookingsFlow/BookingsFlow.tsx';
import { LinkPageScreen } from './grow.tsx';
import type { AppAction, AppState } from './data.ts';

const i16 = { size: 16, strokeWidth: 1.75 } as const;
type Phase = 'opening' | 'open' | 'expired' | 'ended' | 'blocked';

/** The partner's app with our frame in it: start screen, then the link page, and the frame's own ways it can't open. */
export function PartnerFrame({ state, dispatch, handle, bookings, onClose }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly handle: string; readonly bookings?: BookingsState; readonly onClose: () => void }) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>('opening');
  const [noAnswer, setNoAnswer] = useState(false);
  useEffect(() => { if (phase !== 'opening') return undefined; const t = window.setTimeout(() => setPhase('open'), 1200); return () => window.clearTimeout(t); }, [phase]);
  // "Open again" asks the partner's app for a fresh launch; if nothing opens in a few seconds, one line says where to go.
  const again = () => { setNoAnswer(false); setPhase('opening'); };
  return (
    <FullScreenDialog aria-label="Your link page in a partner’s app" onOpenChange={(o) => { if (!o) onClose(); }} className="tf-pframe">
      <div className="tf-pframe__demobar">
        <span className="tf-pframe__demolabel">Demo · a partner’s app showing your link page</span>
        <SegmentedControl aria-label="Frame state" size="sm" selectedKey={phase === 'opening' ? 'open' : phase} onSelectionChange={(k) => setPhase(k === 'open' ? 'opening' : (k as Phase))}
          items={[{ id: 'open', label: 'Opens' }, { id: 'expired', label: 'Timed out' }, { id: 'ended', label: 'Session ended' }, { id: 'blocked', label: 'Sign in blocked' }]} />
        <Button size="sm" variant="secondary" icon={<X size={14} strokeWidth={1.75} />} onPress={onClose}>Close demo</Button>
      </div>
      <div className="tf-pframe__partner">
        {/* The partner's own page: their navigation and heading, drawn plainly so the frame reads as a guest in it. */}
        <nav className="tf-pframe__rail" aria-label="Partner app">
          <span className="tf-pframe__brand" aria-hidden="true"><LayoutGrid {...i16} /></span>
          {[{ icon: <Home {...i16} />, label: 'Home' }, { icon: <Users {...i16} />, label: 'Clients' }, { icon: <Megaphone {...i16} />, label: 'Marketing hub', on: true }, { icon: <BarChart3 {...i16} />, label: 'Reports' }].map((x) => (
            <span key={x.label} className="tf-pframe__railitem" data-on={x.on || undefined}>{x.icon}<span>{x.label}</span></span>
          ))}
        </nav>
        <div className="tf-pframe__host">
          <header className="tf-pframe__hosthead"><h1 className="tf-pframe__hosttitle">Marketing hub</h1><span className="tf-pframe__hostsub">Your link page, without leaving this app</span></header>
          <section className="tf-pframe__frame" aria-label="Link page frame">
            <div className="tf-pframe__framebar"><span>Link page</span></div>
            <div className="tf-pframe__framebody" data-phase={phase}>
              {phase === 'opening' && <div className="tf-pframe__status" role="status"><Spinner size={20} label="Opening" /><span>Opening</span></div>}
              {phase === 'open' && <LinkPageScreen state={state} dispatch={dispatch} handle={handle} bookings={bookings} isEmbedded onBack={() => undefined} />}
              {phase === 'expired' && <EmptyState size="sm" icon={<TimerOff size={20} strokeWidth={1.75} />} title="This timed out" description={noAnswer ? 'If nothing opens, open it again from the app you came from.' : undefined}
                action={<Button variant="primary" onPress={again}>Open again</Button>} />}
              {phase === 'ended' && <EmptyState size="sm" icon={<LogOut size={20} strokeWidth={1.75} />} title="Session ended" description="Open it again from the app you came from." action={<Button variant="primary" onPress={again}>Open again</Button>} />}
              {phase === 'blocked' && <EmptyState size="sm" icon={<ShieldAlert size={20} strokeWidth={1.75} />} title="Your browser blocked sign in here" description="Open the link page in a tab of its own; you stay signed in there."
                action={<Button variant="primary" onPress={() => { toast({ message: 'In a real frame this asks the partner’s app to open a new tab.' }); setNoAnswer(true); setPhase('opening'); }}>Open in a new tab</Button>} />}
            </div>
          </section>
        </div>
      </div>
    </FullScreenDialog>
  );
}
