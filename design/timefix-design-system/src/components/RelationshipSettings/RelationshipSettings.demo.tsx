import { useState } from 'react';
import { Building2, Handshake, UsersRound } from 'lucide-react';
import { RelationshipSettings, type Relationship, type SchemaObject } from './RelationshipSettings.tsx';

const OBJECTS: ReadonlyArray<SchemaObject> = [
  { id: 'companies', singular: 'Company', plural: 'Companies', icon: Building2, hue: 'blue' },
  { id: 'people', singular: 'Person', plural: 'People', icon: UsersRound, hue: 'green' },
  { id: 'deals', singular: 'Deal', plural: 'Deals', icon: Handshake, hue: 'orange' },
];

export function RelationshipSettingsDemo() {
  const [created, setCreated] = useState<Relationship>({ fromId: 'companies', toId: 'people', cardinality: 'oneToMany', fromName: 'People', toName: 'Company' });
  const [existing, setExisting] = useState<Relationship>({ fromId: 'deals', toId: 'people', cardinality: 'manyToMany', fromName: 'Contacts', toName: 'Deals' });
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 'var(--space-32)', alignItems: 'start' }}>
      <div className="tf-stack">
        <p className="tf-demo-label">New relationship. Pick how records link; names follow until you type one.</p>
        <RelationshipSettings objects={OBJECTS} value={created} onChange={setCreated} />
      </div>
      <div className="tf-stack">
        <p className="tf-demo-label">Existing: objects and cardinality are fixed, names can change.</p>
        <RelationshipSettings objects={OBJECTS} value={existing} onChange={setExisting} mode="edit" />
      </div>
    </div>
  );
}
