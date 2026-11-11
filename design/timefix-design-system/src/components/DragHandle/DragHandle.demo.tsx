import { useState } from 'react';
import { Type, Mail, Building2, Phone, AlignLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DragHandle, SortableList } from './DragHandle.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Icon } from '../Icon/Icon.tsx';
import { Kbd } from '../Kbd/Kbd.tsx';

interface Question { readonly id: string; readonly title: string; readonly kind: string; readonly icon: LucideIcon; readonly required?: boolean }
const START: ReadonlyArray<Question> = [
  { id: 'name', title: 'Your name', kind: 'Short text', icon: Type, required: true },
  { id: 'email', title: 'Work email', kind: 'Email', icon: Mail, required: true },
  { id: 'company', title: 'Company', kind: 'Record · Companies', icon: Building2 },
  { id: 'phone', title: 'Phone number', kind: 'Phone', icon: Phone },
  { id: 'topic', title: 'What would you like to discuss?', kind: 'Long text', icon: AlignLeft },
];

export function DragHandleDemo() {
  const [items, setItems] = useState(START);
  return (
    <div className="tf-demo tf-demo--canvas" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--space-24)', alignItems: 'start' }}>
      <div className="tf-stack" style={{ gap: 'var(--space-8)' }}>
        <p className="tf-demo-label" style={{ margin: 0 }}>Discovery call · booking questions</p>
        <SortableList label="Booking questions" items={items} onReorder={setItems} getText={(q) => q.title}>
          {(q) => {
            return (
              <>
                <Icon icon={q.icon} tone="muted" />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ font: '500 14px/20px var(--font-sans)' }}>{q.title}</span>
                  <span style={{ font: '400 13px/18px var(--font-sans)', color: 'var(--text-secondary)' }}>{q.kind}</span>
                </span>
                {q.required && <Tag size="sm">Required</Tag>}
              </>
            );
          }}
        </SortableList>
      </div>
      <div className="tf-stack" style={{ gap: 'var(--space-12)', width: 'var(--size-menu)' }}>
        <p className="tf-demo-label" style={{ margin: 0 }}>Handle states</p>
        <div className="tf-row"><DragHandle reveal="always" label="Move Your name" /><span className="tf-muted" style={{ fontSize: 13 }}>Rest · hover it</span></div>
        <div className="tf-row"><DragHandle reveal="always" isLifted label="Move Work email" /><span className="tf-muted" style={{ fontSize: 13 }}>Lifted</span></div>
        <p className="tf-faint" style={{ margin: 0, fontSize: 13, lineHeight: '20px' }}>
          Tab to a row, then to its grip. <Kbd>Space</Kbd> lifts it, <Kbd>↑</Kbd> <Kbd>↓</Kbd> pick the slot, <Kbd>Space</Kbd> drops, <Kbd>Esc</Kbd> cancels.
        </p>
      </div>
    </div>
  );
}
