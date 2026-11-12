import { useState } from 'react';
import { Building2, CalendarDays, Settings } from 'lucide-react';
import { Breadcrumbs, type Crumb } from './Breadcrumbs.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';

const i = { size: 16, strokeWidth: 1.75 } as const;
const deep: ReadonlyArray<Crumb> = [
  { id: 'settings', label: 'Settings', icon: <Settings {...i} /> },
  { id: 'workspace', label: 'Workspace' },
  { id: 'objects', label: 'Objects' },
  { id: 'companies', label: 'Companies' },
  { id: 'attributes', label: 'Attributes' },
  { id: 'stage', label: 'Stage' },
];

export function BreadcrumbsDemo() {
  const [last, setLast] = useState<string>('—');
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-20)' }}>
      <div>
        <p className="tf-demo-label">Top bar title</p>
        <Breadcrumbs size="title" onAction={setLast} items={[{ id: 'companies', label: 'Companies', icon: <Building2 {...i} /> }, { id: 'acme', label: 'Acme Corp', icon: <Avatar name="Acme Corp" shape="square" size={20} /> }]} />
      </div>
      <div>
        <p className="tf-demo-label">Three levels</p>
        <Breadcrumbs onAction={setLast} items={[{ id: 'scheduling', label: 'Scheduling', icon: <CalendarDays {...i} /> }, { id: 'pages', label: 'Booking pages' }, { id: 'discovery', label: 'Discovery call 30 min' }]} />
      </div>
      <div>
        <p className="tf-demo-label">Six levels: the middle folds into a menu</p>
        <Breadcrumbs onAction={setLast} items={deep} />
      </div>
      <div style={{ maxWidth: 300 }}>
        <p className="tf-demo-label">Narrow: parents truncate first</p>
        <Breadcrumbs size="sm" onAction={setLast} items={[{ id: 'forms', label: 'Forms' }, { id: 'onboarding', label: 'Customer onboarding questionnaire' }, { id: 'responses', label: 'Responses from Northwind' }]} />
      </div>
      <p className="tf-faint" style={{ margin: 0, fontSize: 13 }}>Last pressed: <span className="tf-muted">{last}</span></p>
    </div>
  );
}
