import { useEffect, useRef, useState } from 'react';
import { RemoteCursor, RemoteCaret, PresenceGroup, type PresencePerson } from './Presence.tsx';
import { Tag } from '../Tag/Tag.tsx';
import './Presence.demo.css';

const PEOPLE: ReadonlyArray<PresencePerson> = [
  { name: 'Priya Raman', status: 'active', activity: 'Editing Discovery call' },
  { name: 'Sam Kim', status: 'active', activity: 'Viewing questions' },
  { name: 'Jo Mendes', status: 'idle' },
  { name: 'Ava Chen', status: 'active' },
  { name: 'Maria Bell', status: 'idle' },
  { name: 'Leo Park', status: 'idle' },
];

/** Two fake pointers tracing slow loops, sampled every 120ms the way a realtime channel would deliver them. */
function usePointers() {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [size, setSize] = useState({ w: 480, h: 200 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => ro.disconnect();
    const id = window.setInterval(() => setT((v) => v + 0.12), 120);
    return () => { ro.disconnect(); window.clearInterval(id); };
  }, []);
  const at = (fx: number, fy: number, ax: number, ay: number, k: number) => ({
    x: Math.round(size.w * (fx + ax * Math.sin(t * 0.7 + k))),
    y: Math.round(size.h * (fy + ay * Math.sin(t * 1.1 + k * 2))),
  });
  return { ref, a: at(0.3, 0.42, 0.16, 0.22, 0), b: at(0.66, 0.5, 0.2, 0.26, 2), idle: Math.sin(t * 0.4) > 0.6 };
}

export function PresenceDemo() {
  const { ref, a, b, idle } = usePointers();
  return (
    <div className="tf-demo tf-demo--canvas tf-stack" style={{ gap: 'var(--space-12)' }}>
      <div className="tf-row" style={{ justifyContent: 'space-between' }}>
        <span className="tf-presence-demo__title">Discovery call · booking page</span>
        <PresenceGroup people={PEOPLE} />
      </div>
      <div ref={ref} className="tf-presence-demo__board">
        <div className="tf-presence-demo__card"><Tag status="progress">Draft</Tag><strong>Discovery call</strong><span className="tf-muted">30 min · Google Meet</span></div>
        <div className="tf-presence-demo__card"><Tag status="done">Live</Tag><strong>Demo</strong><span className="tf-muted">45 min · Zoom</span></div>
        <RemoteCursor name="Sam Kim" x={a.x} y={a.y} />
        <RemoteCursor name="Ava Chen" x={b.x} y={b.y} isIdle={idle} />
      </div>
      <p className="tf-presence-demo__note">
        Notes for the call: ask about the Northwind rollout<RemoteCaret name="Priya Raman" /> and who signs off on seats.
      </p>
    </div>
  );
}
