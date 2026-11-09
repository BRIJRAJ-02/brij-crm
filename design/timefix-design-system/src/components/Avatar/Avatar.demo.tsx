import { Avatar, AvatarGroup, PersonLine } from './Avatar.tsx';
import { StatusDot } from '../Tag/Tag.tsx';

export function AvatarDemo() {
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-20)' }}>
      <div className="tf-row" style={{ gap: 'var(--space-12)' }}>
        <Avatar name="Priya Raman" size={20} /><Avatar name="Sam Kim" /><Avatar name="Jo Mendes" size={36} status="online" /><Avatar name="Maria Bell" size={44} status="away" />
        <Avatar name="Acme Corp" shape="square" /><Avatar name="Northwind" shape="square" size={36} /><Avatar name="Globex" shape="square" size={44} />
        <AvatarGroup names={['Priya Raman', 'Sam Kim', 'Jo Mendes', 'Ava Chen', 'Maria Bell', 'Leo Park', 'Nina Shah']} />
      </div>
      <div className="tf-row" style={{ gap: 'var(--space-32)' }}>
        <PersonLine name="Maria Bell" sub="Plan & billing" size={44} />
        <PersonLine name="Acme Corp" shape="square" size={44} sub={<StatusDot hue="green">Active · day 41</StatusDot>} />
        <PersonLine name="Priya Raman" sub="priya@acme.com" />
      </div>
    </div>
  );
}
