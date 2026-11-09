import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { ToastProvider, useToast } from '../Toast/Toast.tsx';
import { InviteRows } from '../InviteRows/InviteRows.tsx';
import { TeamList, type Member } from './TeamList.tsx';

const NOW = new Date(2026, 10, 11, 11, 40);
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const seed: ReadonlyArray<Member> = [
  { id: 'u1', name: 'Priya Raman', email: 'priya@northwind.com', role: 'owner', status: 'active', seen: ago(0), isYou: true },
  { id: 'u2', name: 'Sam Kim', email: 'sam@northwind.com', role: 'admin', status: 'active', seen: ago(14) },
  { id: 'u3', name: 'Ava Chen', email: 'ava@northwind.com', role: 'member', status: 'active', seen: ago(60 * 5) },
  { id: 'u4', name: 'Maria Bell', email: 'maria@northwind.com', role: 'member', status: 'active', seen: ago(60 * 30) },
  { id: 'u5', name: 'Jo Mendes', email: 'jo@northwind.com', role: 'member', status: 'invited', seen: ago(60 * 24 * 3) },
];
const nameOf = (email: string) => (email.split('@')[0] ?? email).split(/[._-]/).map((w) => (w[0] ?? '').toUpperCase() + w.slice(1)).join(' ');

function Live() {
  const { toast } = useToast();
  const [members, setMembers] = useState(seed);
  const [inviting, setInviting] = useState(false);
  return (
    <>
      <TeamList members={members} now={NOW} workspace="Northwind"
        action={<Button variant="primary" size="sm" icon={<UserPlus size={14} strokeWidth={1.75} />} onPress={() => setInviting(true)}>Invite people</Button>}
        onRoleChange={(id, role) => setMembers((l) => l.map((m) => (m.id === id ? { ...m, role } : m)))}
        onResend={(id) => toast({ message: `Invite sent again to ${members.find((m) => m.id === id)?.email ?? ''}`, tone: 'success' })}
        onCopyEmail={(email) => toast({ message: `Copied ${email}` })}
        onRemove={(id) => {
          const gone = members.find((m) => m.id === id);
          setMembers((l) => l.filter((m) => m.id !== id));
          if (gone) toast({ message: `${gone.name} removed`, tone: 'success' });
        }} />
      <Dialog isOpen={inviting} onOpenChange={setInviting} title="Invite people" description="They get an email with a link to join Northwind." size="wide">
        <InviteRows autoFocus onSend={(list) => {
          setMembers((l) => [...l, ...list.map((v, i) => ({ id: `n${Date.now()}${i}`, name: nameOf(v.email), email: v.email, role: v.role, status: 'invited' as const, seen: NOW }))]);
          setInviting(false);
          toast({ message: list.length === 1 ? 'Invite sent' : `${list.length} invites sent`, tone: 'success' });
        }} />
      </Dialog>
    </>
  );
}

export function TeamListDemo() {
  return (
    <ToastProvider>
      <div className="tf-demo"><Live /></div>
    </ToastProvider>
  );
}
