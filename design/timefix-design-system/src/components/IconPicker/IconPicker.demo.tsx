import { useState } from 'react';
import { IconPicker, IconTile } from './IconPicker.tsx';
import type { Hue } from '../Tag/Tag.tsx';

const objects: ReadonlyArray<{ readonly id: string; readonly label: string; readonly icon: string; readonly hue: Hue }> = [
  { id: 'companies', label: 'Companies', icon: 'Building', hue: 'blue' },
  { id: 'people', label: 'People', icon: 'Person', hue: 'green' },
  { id: 'deals', label: 'Deals', icon: 'Handshake', hue: 'orange' },
  { id: 'menus', label: 'Menus', icon: 'Restaurant', hue: 'purple' },
];

export function IconPickerDemo() {
  const [icons, setIcons] = useState<Readonly<Record<string, string>>>(() => Object.fromEntries(objects.map((o) => [o.id, o.icon])));
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-32)' }}>
      <div className="tf-stack" style={{ gap: 'var(--space-4)' }}>
        <p className="tf-demo-label">Objects · press an icon to change it</p>
        {objects.map((o) => (
          <div key={o.id} className="tf-row" style={{ gap: 'var(--space-8)', flexWrap: 'nowrap' }}>
            <IconPicker label={`${o.label} icon`} value={icons[o.id] ?? o.icon} hue={o.hue} onChange={(name) => setIcons((m) => ({ ...m, [o.id]: name }))} />
            <span style={{ font: '500 14px/20px var(--font-sans)' }}>{o.label}</span>
          </div>
        ))}
      </div>
      <div className="tf-stack" style={{ gap: 'var(--space-8)' }}>
        <p className="tf-demo-label">In the sidebar</p>
        {objects.map((o) => (
          <span key={o.id} className="tf-row" style={{ gap: 'var(--space-8)', fontSize: 14 }}><IconTile name={icons[o.id] ?? o.icon} hue={o.hue} size="sm" />{o.label}</span>
        ))}
        <IconPicker label="Disabled icon" value="Lock" isDisabled />
      </div>
    </div>
  );
}
