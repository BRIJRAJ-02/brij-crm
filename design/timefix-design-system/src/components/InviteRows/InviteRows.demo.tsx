import { ToastProvider, useToast } from '../Toast/Toast.tsx';
import { InviteRows } from './InviteRows.tsx';

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function Live() {
  const { toast } = useToast();
  return (
    <div className="tf-stack" style={{ maxWidth: 'var(--size-dialog)' }}>
      <div>
        <p style={{ margin: 0, font: '500 15px/22px var(--font-sans)' }}>Invite people to Northwind</p>
        <p className="tf-faint" style={{ margin: 0, fontSize: 13 }}>Paste a list like “Ava Chen &lt;ava@globex.com&gt;, sam@northwind.com, jo@initech” to split it into rows.</p>
      </div>
      <InviteRows onSend={async (list) => {
        await wait(800);
        toast({ message: list.length === 1 ? `Invite sent to ${list[0]?.email ?? ''}` : `${list.length} invites sent`, tone: 'success' });
      }} />
    </div>
  );
}

export function InviteRowsDemo() {
  return (
    <ToastProvider>
      <div className="tf-demo"><Live /></div>
    </ToastProvider>
  );
}
