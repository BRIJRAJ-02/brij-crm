import { useState } from 'react';
import { GuestLook, type GuestLookValue } from './GuestLook.tsx';

export function GuestLookDemo() {
  const [look, setLook] = useState<GuestLookValue>({ look: 'calm', accent: '#1F5FD6', font: 'sans', scheme: 'light' });
  return (
    <div className="tf-demo">
      <GuestLook value={look} onChange={setLook} host="Priya Raman" title="Discovery call" />
    </div>
  );
}
