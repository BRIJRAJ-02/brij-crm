import { useState } from 'react';
import { AtSign, Building2, Calendar, CircleDot, Globe, MapPin, Phone, Briefcase, User } from 'lucide-react';
import { DescriptionList, type DescriptionItem } from './DescriptionList.tsx';
import { RecordChip } from '../RecordChip/RecordChip.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { PersonLine } from '../Avatar/Avatar.tsx';

export function DescriptionListDemo() {
  const [values, setValues] = useState<Readonly<Record<string, string>>>({
    email: 'priya@acme.com', phone: '+44 20 7946 0958', title: 'Head of Revenue Operations', website: 'acme.com', location: '',
  });
  const items: ReadonlyArray<DescriptionItem> = [
    { id: 'email', label: 'Email', icon: AtSign, type: 'email', value: values.email },
    { id: 'phone', label: 'Phone', icon: Phone, type: 'phone', value: values.phone },
    { id: 'company', label: 'Company', icon: Building2, display: <RecordChip name="Acme Corp" kind="company" /> },
    { id: 'title', label: 'Job title', icon: Briefcase, value: values.title },
    { id: 'website', label: 'Website', icon: Globe, type: 'url', value: values.website },
    { id: 'location', label: 'Location', icon: MapPin, value: values.location },
    { id: 'stage', label: 'Stage', icon: CircleDot, display: <Tag size="sm" status="progress">Qualified</Tag> },
    { id: 'owner', label: 'Owner', icon: User, display: <PersonLine name="Sam Kim" size={20} /> },
    { id: 'created', label: 'Created', icon: Calendar, value: '3 Nov 2026, 14:20', isReadOnly: true },
  ];
  return (
    <div className="tf-demo" style={{ maxWidth: 480 }}>
      <p className="tf-demo-label">Priya Raman · click a value to edit it, hover email or phone to copy</p>
      <DescriptionList label="Priya Raman's details" items={items} onChange={(id, v) => setValues((s) => ({ ...s, [id]: v }))} />
    </div>
  );
}
